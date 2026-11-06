"""F-TOOLMEASURE.S4b (Codex R321–R323 FI-I53): every number of the
toolsetter map (toolsetterRules.contract.json — the one map of the form and
the gateway) is the one tool_touch_off.ngc reads for its value, and every use
of the ranges #3004–#3013 and #3100–#3116 in the CODE of the routine and of
m600.ngc is a read into the variable its meaning names, or the one known
write. The meaning is bound by an independent table key → the routine's
variable name, never derived from the map itself.

The code is read the way LinuxCNC reads a line: comments out — `( … )` and
`;` to the end — then every space and tab out (LinuxCNC ignores them outside
comments, also inside a parameter: `# 3107` is #3107), names in lower case.
A parameter is `#<name>` or `#` and digits; any other form after `#` (an
indirect `#[…]`, `##`, a decimal index) fails the check rather than slipping
past a narrow pattern — a bounded reader that refuses what it does not know,
not an interpreter. Pure text; no gateway."""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROUTINE = ROOT / "subroutines" / "tool_length_probe" / "tool_touch_off.ngc"
WRAPPER = ROOT / "subroutines" / "tool_length_probe" / "m600.ngc"
CONTRACT = ROOT / "lcnc-webui" / "src" / "toolsetterRules.contract.json"

#: what each form key MEANS — the routine's own variable for it
KEY_TO_NAME = {
    "fastFeed": "fast_probe_fr", "slowFeed": "slow_probe_fr", "traverseFeed": "traverse_fr",
    "maxZTravel": "z_max_travel", "retractDist": "retract_distance", "spindleZeroHeight": "spindle_zero_height",
    "offsetDirection": "tool_setter_offset_direction",
    "touchX": "tool_touch_x_coords", "touchY": "tool_touch_y_coords", "touchZ": "tool_touch_z_coords",
    "useToolTable": "use_tool_table", "toolMinDis": "tool_min_dis", "brakeAfter": "brake_after_M600",
    "goBackToStart": "go_back_to_start_pos", "spindleStopM": "spindle_stop_m", "disablePrePos": "disable_pre_pos",
    "addReps": "addreps", "lastTry": "lasttry", "offsetDiameter": "offset_diameter", "offsetValue": "offset_value",
    "finderTouchX": "finder_touch_x_coords", "finderTouchY": "finder_touch_y_coords", "finderDiffZ": "finder_diff_z",
}
#: reads in the ranges that are NOT form fields, named with the routine's own words
NAMED_UNMAPPED = {3008: "xy_max_travel", 3011: "tool_diameter_probe_mode", 3012: "tool_diameter_offset_mode",
                  3116: "rfl_skip_tool"}
#: the one write in the ranges, normalized: the routine clears the gateway's skip flag
KNOWN_WRITES = {"#3116=0"}
IN_RANGE = set(range(3004, 3014)) | set(range(3100, 3117))
READ = re.compile(r"#<(\w+)>=#(\d+)\Z")
NAMED = re.compile(r"#<[^<>#]+>")
NUMBERED = re.compile(r"#(\d+)(?![\d.])")


def code_lines(text: str):
    """(line number, code) — comments out, every space and tab out, lower
    case; an unterminated `(` is returned as None (a problem of its own)."""
    for i, raw in enumerate(text.splitlines(), 1):
        out, j = [], 0
        while j < len(raw):
            c = raw[j]
            if c == "(":
                k = raw.find(")", j)
                if k < 0:
                    out = None
                    break
                j = k + 1
                continue
            if c == ";":
                break
            out.append(c)
            j += 1
        if out is None:
            yield i, None
            continue
        code = re.sub(r"[ \t]+", "", "".join(out)).lower()
        if code:
            yield i, code


def wanted_names() -> dict:
    """number → the one variable it may be read into."""
    var_map = json.loads(CONTRACT.read_text())["varMap"]
    out = {n: KEY_TO_NAME[k].lower() for k, n in var_map.items()}
    out.update(NAMED_UNMAPPED)
    return out


def problems(name: str, text: str, wanted: dict) -> list:
    """Every use of the ranges that is neither a read into its own variable
    nor the known write, and every parameter form this reader does not
    know."""
    out = []
    for i, code in code_lines(text):
        if code is None:
            out.append(f"{name}:{i} an unterminated comment")
            continue
        rest = NAMED.sub("", code)            # named parameters are no number
        unknown = rest.count("#") - len(NUMBERED.findall(rest))
        if unknown:
            out.append(f"{name}:{i} a parameter form this check does not read: {code}")
        read = READ.match(code)
        for n in map(int, NUMBERED.findall(rest)):
            if n not in IN_RANGE:
                continue
            if read and int(read.group(2)) == n:
                if wanted.get(n) != read.group(1):
                    out.append(f"{name}:{i} reads #{n} into {read.group(1)}, its variable is {wanted.get(n)}")
            elif code not in KNOWN_WRITES:
                out.append(f"{name}:{i} uses #{n} in an unknown form: {code}")
    return out


class TestTheMapIsTheRoutinesReads(unittest.TestCase):

    def reads(self):
        out = {}
        for _i, code in code_lines(ROUTINE.read_text()):
            m = READ.match(code or "")
            if m:
                out.setdefault(int(m.group(2)), []).append(m.group(1))
        return out

    def test_every_mapped_number_is_read_into_the_keys_own_variable(self):
        var_map = json.loads(CONTRACT.read_text())["varMap"]
        self.assertEqual(set(var_map), set(KEY_TO_NAME), "the table names every form key")
        reads = self.reads()
        for key, number in var_map.items():
            with self.subTest(key=key):
                self.assertEqual(reads.get(number), [KEY_TO_NAME[key].lower()],
                                 f"#{number} is read into {reads.get(number)}, not {KEY_TO_NAME[key]}")

    def test_every_use_of_the_ranges_is_its_own_read_or_the_known_write(self):
        wanted = wanted_names()
        for path in (ROUTINE, WRAPPER):
            with self.subTest(file=path.name):
                self.assertEqual(problems(path.name, path.read_text(), wanted), [])

    def test_the_probe_number_is_not_a_toolsetter_field(self):
        self.assertNotIn(3014, json.loads(CONTRACT.read_text())["varMap"].values())


class TestTheCheckSeesEverySpelling(unittest.TestCase):
    """FI-I53's counter-cases: a line added to the real routine text."""

    def check(self, extra: str) -> list:
        return problems("tool_touch_off.ngc", ROUTINE.read_text() + "\n" + extra + "\n", wanted_names())

    def test_a_read_spelled_with_spaces_or_split_digits_is_seen(self):
        for extra in ("#<r323_extra> = # 3107", "#<r323_extra> = #31 07", "#<r323_extra>\t=\t#3107",
                      "#<R323_EXTRA> = #3107", "G0 X[# 3107]", "#3116 = 1"):
            with self.subTest(extra=extra):
                self.assertTrue(self.check(extra), "unseen")

    def test_an_unknown_parameter_form_fails(self):
        for extra in ("#<x> = #[3100 + 7]", "#<x> = ##3107", "#<x> = #3107.0", "#<x> = #", "G0 X1 (open"):
            with self.subTest(extra=extra):
                self.assertTrue(self.check(extra), "unseen")

    def test_comments_and_the_routines_own_spellings_pass(self):
        for extra in ("(#3107 in a comment)", "G0 X1 ; #3107 after the comment mark",
                      "#<spindle_stop_m> = # 3107"):
            with self.subTest(extra=extra):
                self.assertEqual(self.check(extra), [])


if __name__ == "__main__":
    unittest.main()
