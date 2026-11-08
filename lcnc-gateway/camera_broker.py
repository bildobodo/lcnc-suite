"""Single-producer camera fan-out (P3 / M5).

One producer task captures + JPEG-encodes at the configured FPS into a shared latest
frame + a monotonic sequence; every ``/camera/stream`` viewer awaits the next sequence
and streams the *same* bytes (newest-wins, stale frames dropped). Without this, each
viewer ran its own capture+encode loop, so N viewers paid N× the cost.

This module owns ONLY the async fan-out + lifecycle. The blocking, device-touching cv2
I/O (capture/encode/open/release) and the background-task registry are **injected**, so
camera_broker has no cv2 / HAL / gateway dependency and is unit-testable in isolation.
All broker state is touched only on the event loop (single-threaded); the injected
blocking calls run off-loop via ``asyncio.to_thread``.
"""
import asyncio
import os
from typing import Callable, Optional


class CameraBroker:
    _GRACE_S = 2.0

    def __init__(
        self,
        grab_jpeg: Callable[[], Optional[bytes]],   # blocking: read + imencode one frame
        device_init: Callable[[], bool],            # blocking: open device, returns availability
        device_release: Callable[[], None],         # blocking: release device
        register_bg_task: Callable[[asyncio.Task], asyncio.Task],
        fps_env: str = "LCNC_CAMERA_FPS",
    ) -> None:
        self._grab = grab_jpeg
        self._init = device_init
        self._release = device_release
        self._register = register_bg_task
        self._fps_env = fps_env
        self._subscribers = 0
        self._task: Optional[asyncio.Task] = None
        self._cond = asyncio.Condition()
        self._latest: Optional[bytes] = None
        self._seq = 0
        self._stop_handle: Optional[asyncio.TimerHandle] = None
        # Serialize ALL start/stop transitions: two simultaneous first subscribers
        # must not both open the device + start a producer, and a grace-stop release
        # must not race a re-subscribe reusing the device. Teardown is awaited — no
        # fire-and-forget release task.
        self._lock = asyncio.Lock()
        # Ended by end_epoch (the camera switched off — settings split package
        # 3): every stream of an older epoch ends, frames or not, and a
        # subscription that read the switch before it is refused.
        self.epoch = 0

    async def subscribe(self, epoch: Optional[int] = None) -> Optional[bool]:
        """Register a viewer; start the producer on the first. False if no
        camera; None when `epoch` (read before the caller checked its switch)
        has ended meanwhile."""
        async with self._lock:
            if epoch is not None and epoch != self.epoch:
                return None
            if self._stop_handle is not None:      # a viewer arrived within the grace
                self._stop_handle.cancel()
                self._stop_handle = None
            self._subscribers += 1
            if self._task is None or self._task.done():
                ok = await asyncio.to_thread(self._init)
                if not ok:
                    self._subscribers -= 1
                    return False
                self._task = self._register(asyncio.create_task(self._produce()))
            return True

    def unsubscribe(self, epoch: Optional[int] = None) -> None:
        # Sync, on the loop. Schedule a grace-stop when the last viewer leaves.
        # A viewer of an ENDED epoch was already counted out by end_epoch: its
        # late leave changes nothing of a newer epoch's viewers (Codex R344).
        if epoch is not None and epoch != self.epoch:
            return
        self._subscribers = max(0, self._subscribers - 1)
        if self._subscribers == 0 and self._task is not None and self._stop_handle is None:
            loop = asyncio.get_event_loop()
            self._stop_handle = loop.call_later(
                self._GRACE_S,
                lambda: self._register(asyncio.create_task(self._grace_stop())),
            )

    async def _grace_stop(self) -> None:
        async with self._lock:
            self._stop_handle = None
            if self._subscribers > 0:              # re-subscribed during the grace
                return
            await self._teardown()

    async def end_epoch(self) -> int:
        """End every stream now: the waiting ones wake and end, the producer
        stops and the device is released — no grace. Returns the number of
        viewers it ended. The broker serves a later epoch as before."""
        async with self._lock:
            n = self._subscribers
            if self._stop_handle is not None:
                self._stop_handle.cancel()
                self._stop_handle = None
            self.epoch += 1
            async with self._cond:
                self._cond.notify_all()
            self._subscribers = 0
            if self._task is not None:
                await self._teardown()
            return n

    async def aclose(self) -> None:
        """Awaitable shutdown for lifespan: stop the producer + release the device."""
        async with self._lock:
            if self._stop_handle is not None:
                self._stop_handle.cancel()
                self._stop_handle = None
            self._subscribers = 0
            await self._teardown()

    async def _teardown(self) -> None:
        # Caller holds self._lock. Cancel + AWAIT the producer, then release — so
        # nothing closes a device a later subscriber has already reopened.
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        await asyncio.to_thread(self._release)

    async def _produce(self) -> None:
        fps = int(os.environ.get(self._fps_env, "15"))
        delay = 1.0 / max(1, fps)
        grab_failing = False  # edge-triggered failure reporting — no silent spin
        while True:
            jpeg = await asyncio.to_thread(self._grab)
            if jpeg is None:
                # Device gone / read failing: without this, the loop would spin
                # silently at FPS forever while every viewer hangs frame-less.
                # Edge-triggered (log once + on recovery), like hal_reader's
                # missing-pin reporting.
                if not grab_failing:
                    grab_failing = True
                    print("[CAMERA] frame grab failing (device disconnected?) — "
                          "viewers receive no frames until it recovers", flush=True)
            else:
                if grab_failing:
                    grab_failing = False
                    print("[CAMERA] frame grab recovered", flush=True)
                async with self._cond:
                    self._latest = jpeg
                    self._seq += 1
                    self._cond.notify_all()
            await asyncio.sleep(delay)

    async def frames(self, epoch: Optional[int] = None):
        """Yield the latest shared JPEG, newest-wins (a slow viewer drops frames,
        never the producer or other viewers) — until `epoch` (default: the
        current one) ends."""
        mine = self.epoch if epoch is None else epoch
        last_seq = -1
        while True:
            async with self._cond:
                await self._cond.wait_for(lambda: self._seq != last_seq or self.epoch != mine)
                if self.epoch != mine:
                    return
                last_seq = self._seq
                jpeg = self._latest
            if jpeg is not None:
                yield jpeg
