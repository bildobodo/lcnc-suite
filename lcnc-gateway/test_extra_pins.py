"""Extra-pins configuration (live switchkins sampling, TCP phase-2 refinement).

Pins the gating rule for the `motion.switchkins-type` extra pin:

- switchable declared kins (marker policy 'twin' or 'unchecked') → the
  gateway asks the reader to sample it as snapshot field `kins_type`;
- trivkins / no [KINS] (policy 'ignore') → the pin is NOT requested — it
  doesn't exist on those configs and would sit in the reader's missing-pin
  reminder forever.

Same fake-binding pattern as test_ws_lifecycle: install fake_linuxcnc
BEFORE importing gateway, monkeypatch the seams (_parse_kins_decl, the
bridge's reader_connected, _reader_request), restore in finally.
"""
import asyncio
import unittest

import fake_linuxcnc

linuxcnc = fake_linuxcnc.install()  # MUST precede `import gateway`

import gateway  # noqa: E402


class _StubBridge:
    reader_connected = True


class TestExtraPinsKinsGating(unittest.TestCase):
    def _configured_pins(self, kins_decl):
        """Run _reader_configure_extra_pins with `kins_decl` as the parsed
        declaration; return the pins dict it pushed to the reader."""
        pushed = {}

        async def fake_request(req, **kwargs):
            pushed["req"] = req
            pushed["pins"] = kwargs.get("pins")
            return {"ok": True}

        orig = (gateway._parse_kins_decl, gateway._hal_bridge,
                gateway._reader_request, gateway.load_settings)
        gateway._parse_kins_decl = lambda: kins_decl
        gateway._hal_bridge = _StubBridge()
        gateway._reader_request = fake_request
        gateway.load_settings = lambda: {}
        try:
            asyncio.run(gateway._reader_configure_extra_pins())
        finally:
            (gateway._parse_kins_decl, gateway._hal_bridge,
             gateway._reader_request, gateway.load_settings) = orig
        self.assertEqual(pushed.get("req"), "set_extra_pins")
        return pushed.get("pins") or {}

    def test_switchable_kins_requests_the_pin(self):
        for decl in (
            {"module": "xyzac-trt-kins", "type": "xyzac-trt",
             "identity_first": True, "params": {}},          # twin
            {"module": "weird-kins", "type": "weird",
             "identity_first": False, "params": {}},         # unchecked
        ):
            pins = self._configured_pins(decl)
            self.assertEqual(pins.get("kins_type"), "motion.switchkins-type",
                             f"switchable decl must sample the pin: {decl}")

    def test_trivkins_and_undeclared_do_not_request_the_pin(self):
        for decl in (
            None,                                            # no [KINS] / no STAT
            {"module": "trivkins", "type": "trivkins",
             "identity_first": False, "params": {}},
        ):
            pins = self._configured_pins(decl)
            self.assertNotIn("kins_type", pins,
                             f"non-switchable decl must not sample the pin: {decl}")

    # ── TWP plane-frame pins (W8) ──────────────────────────────────────────
    # A machine parked in TWP entering sim needs the LIVE frame, not the
    # loaded program's first marker; these pins are how it gets one.

    def test_trsrn_requests_the_three_frame_pins_under_the_module_prefix(self):
        pins = self._configured_pins(
            {"module": "xyzacb_trsrn", "type": "xyzacb-trsrn",
             "identity_first": False, "params": {}})
        # "<module>_kins." — the comp prefixes its own name, unlike trt where
        # the prefix IS the module. parse_kins_config special-cases the same
        # quirk; deriving it here keeps a future module rename honest.
        self.assertEqual(pins.get("kins_pre_rot"), "xyzacb_trsrn_kins.pre-rot")
        self.assertEqual(pins.get("kins_primary_angle"),
                         "xyzacb_trsrn_kins.primary-angle")
        self.assertEqual(pins.get("kins_secondary_angle"),
                         "xyzacb_trsrn_kins.secondary-angle")
        # still switchable, so the type pin rides along
        self.assertEqual(pins.get("kins_type"), "motion.switchkins-type")

    def test_non_trsrn_configs_do_not_request_the_frame_pins(self):
        # Gated on the TYPE, not on "is it switchable": a trt machine is
        # switchable and has no such pins, so asking would park three entries
        # in the reader's missing-pin reminder for the life of the session.
        for decl in (
            None,
            {"module": "trivkins", "type": "trivkins",
             "identity_first": False, "params": {}},
            {"module": "xyzac-trt-kins", "type": "xyzac-trt",
             "identity_first": True, "params": {}},
            {"module": "weird-kins", "type": "weird",
             "identity_first": False, "params": {}},
        ):
            pins = self._configured_pins(decl)
            for f in ("kins_pre_rot", "kins_primary_angle", "kins_secondary_angle"):
                self.assertNotIn(f, pins, f"{f} must not be sampled for {decl}")


if __name__ == "__main__":
    unittest.main()
