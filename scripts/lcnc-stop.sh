#!/usr/bin/env bash
# Tear down a LinuxCNC-as-DISPLAY suite session completely.
#
# Why this exists. When LinuxCNC runs the suite as its DISPLAY the tree is
#
#     linuxcnc <ini>            (the stock /usr/bin/linuxcnc script)
#       └── lcnc-suite -ini …   (our launcher)
#             ├── uvicorn …     (the gateway — this IS the display process)
#             └── npm run dev   (Vite, only when WEBUI_DEV=1)
#
# and `restart.sh` does not know about it: that script kills whatever holds
# port 8000/5173, which decapitates the launcher and leaves `linuxcnc` and
# the realtime side half-standing. Starting LinuxCNC again then fails while
# LOOKING like a config fault — the new instance cannot claim HAL, and on
# its way out its teardown unloads the realtime threads out from under the
# OLD instance, so the surviving gateway reports every pin missing:
#
#     [READER] 27 pin(s) still missing: ['axis.z.eoffset', …]
#
# Nothing in that message says "a previous session is still running", which
# is the actual cause and the whole reason for this script.
#
# Usage: scripts/lcnc-stop.sh [--dry-run|--force]
#   --dry-run  list what WOULD be stopped, kill nothing
#   --force    skip the graceful TERM wait, SIGKILL immediately
#
# Exit 0 = nothing running, or everything stopped. Exit 1 = something
# survived (named, never a silent partial stop). --dry-run exits 0 always.
set -uo pipefail

MODE="${1:-}"
say() { printf '%s\n' "$*"; }

# ── identifying a suite process ─────────────────────────────────────────
# Matched POSITIONALLY on argv, never by substring over the whole command
# line. This is the difference between a stop script and a foot-gun: any
# shell that merely MENTIONS these strings — the terminal you typed the
# command in, a grep, an editor — carries them in its command line, and a
# `pgrep -f` / `pkill -f` pattern happily matches it. A first cut of this
# script did exactly that: it matched its own invoking shell, walked that
# shell's children, and announced "stopping 20 process(es)" on a system
# that was already clean. A real launcher has its path at argv[1]; a shell
# quoting that path has "-c" there. So look at the slot, not the text.
is_suite_proc() {
  local pid=$1 argv=()
  [ -r "/proc/$pid/cmdline" ] || return 1
  mapfile -d '' -t argv < "/proc/$pid/cmdline" 2>/dev/null || return 1
  [ ${#argv[@]} -gt 0 ] || return 1
  case "${argv[1]:-}" in
    /usr/bin/linuxcnc) return 0 ;;                 # stock launcher script
  esac
  # ${x##*/} not basename: argv[1] is arbitrary and frequently starts with
  # "-", which basename reads as its own option and spews usage errors.
  local a1="${argv[1]:-}"
  [ "${a1##*/}" = "lcnc-suite" ] && return 0
  # gateway: python3 -m uvicorn gateway:app …  (argv[1] is "-m")
  if [ "${argv[1]:-}" = "-m" ] && [ "${argv[2]:-}" = "uvicorn" ]; then
    case "${argv[3]:-}" in gateway:app) return 0 ;; esac
  fi
  return 1
}

# Never touch this script or anything that launched it.
PROTECTED=" "
_p=$$
while [ "${_p:-0}" -gt 1 ]; do
  PROTECTED="$PROTECTED$_p "
  _p=$(awk '{print $4}' "/proc/$_p/stat" 2>/dev/null) || break
done
protected() { case "$PROTECTED" in *" $1 "*) return 0 ;; esac; return 1; }

ROOTS=()
for d in /proc/[0-9]*; do
  pid=${d#/proc/}
  protected "$pid" && continue
  is_suite_proc "$pid" && ROOTS+=("$pid")
done

if [ ${#ROOTS[@]} -eq 0 ]; then
  say "no suite session running"
else
  # Children before parents: killing a parent first orphans its children
  # onto init, where they keep holding port 8000 and the HAL sockets —
  # the exact stale state this script exists to clear.
  # The roots overlap by construction — uvicorn is BOTH a root (argv match)
  # and a child of the launcher — so collect() would list the same pid two
  # or three times. Killing twice is harmless; reporting "20 processes"
  # when there are nine is not, so dedupe as we go.
  ALL=()
  declare -A SEEN=()
  collect() {
    local p=$1 kid
    protected "$p" && return
    [ -n "${SEEN[$p]:-}" ] && return
    SEEN[$p]=1
    for kid in $(pgrep -P "$p" 2>/dev/null); do collect "$kid"; done
    ALL+=("$p")
  }
  for r in "${ROOTS[@]}"; do collect "$r"; done

  if [ "$MODE" = "--dry-run" ]; then
    say "would stop ${#ALL[@]} process(es):"
    for p in "${ALL[@]}"; do
      say "  $p  $(tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | cut -c1-100)"
    done
    exit 0
  fi

  say "stopping ${#ALL[@]} process(es)"
  if [ "$MODE" = "--force" ]; then
    for p in "${ALL[@]}"; do kill -KILL "$p" 2>/dev/null; done
  else
    for p in "${ALL[@]}"; do kill -TERM "$p" 2>/dev/null; done
    for _ in $(seq 1 15); do
      alive=0
      for p in "${ALL[@]}"; do [ -d "/proc/$p" ] && alive=1; done
      [ "$alive" -eq 0 ] && break
      sleep 1
    done
    for p in "${ALL[@]}"; do
      [ -d "/proc/$p" ] && { say "  SIGKILL $p (ignored TERM)"; kill -KILL "$p" 2>/dev/null; }
    done
  fi
fi

[ "$MODE" = "--dry-run" ] && exit 0

# ── realtime + runtime plumbing ─────────────────────────────────────────
# halrun -U is idempotent and safe when nothing is loaded. The sockets and
# FIFO live on tmpfs by design (see CLAUDE.md); a stale one makes the next
# gateway's reader connect to nothing.
halrun -U >/dev/null 2>&1
rm -f /tmp/webui-reader.sock /tmp/webui-safety.sock /tmp/lcnc-fifo.* 2>/dev/null

# ── verify, and SAY so — a stop that half-worked must not look clean ────
rc=0
for d in /proc/[0-9]*; do
  pid=${d#/proc/}
  protected "$pid" && continue
  if is_suite_proc "$pid"; then
    say "STILL RUNNING: $pid $(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | cut -c1-90)"
    rc=1
  fi
done
for port in 8000 5173; do
  if ss -ltn 2>/dev/null | grep -q ":$port "; then
    say "port $port STILL BOUND"; rc=1
  fi
done
[ "$rc" -eq 0 ] && say "clean: no suite processes, ports 8000/5173 free, HAL unloaded"
exit "$rc"
