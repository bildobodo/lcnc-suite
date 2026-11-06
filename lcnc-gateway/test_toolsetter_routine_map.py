"""F-TOOLMEASURE.S4b (Codex R321–R322): every number of the toolsetter map
(toolsetterRules.contract.json — the one map of the form and the gateway) is
the one tool_touch_off.ngc reads for its value, and every read of the ranges
#3004–#3013 and #3100–#3116 in the routine's CODE is either mapped or named
here. The meaning is bound by an independent table key → the routine's
variable name, never derived from the map itself. Pure text; no gateway."""
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
#: the one write in the ranges: the routine clears the gateway's skip flag
KNOWN_WRITES = {"#3116 = 0"}
IN_RANGE = set(range(3004, 3014)) | set(range(3100, 3117))
READ = re.compile(r"^#<(\w+)>\s*=\s*#(\d+)$")


def code_lines(path: Path):
    """(line number, code) with comments removed — `( … )` and `; …`."""
    for i, raw in enumerate(path.read_text().splitlines(), 1):
        code = re.sub(r"\([^)]*\)", "", raw.split(";", 1)[0]).strip()
        if code:
            yield i, code


class TestTheMapIsTheRoutinesReads(unittest.TestCase):

    def reads(self):
        out = {}
        for _i, code in code_lines(ROUTINE):
            m = READ.match(code)
            if m:
                out.setdefault(int(m.group(2)), []).append(m.group(1))
        return out

    def test_every_mapped_number_is_read_into_the_keys_own_variable(self):
        var_map = json.loads(CONTRACT.read_text())["varMap"]
        self.assertEqual(set(var_map), set(KEY_TO_NAME), "the table names every form key")
        reads = self.reads()
        for key, number in var_map.items():
            with self.subTest(key=key):
                self.assertEqual(reads.get(number), [KEY_TO_NAME[key]],
                                 f"#{number} is read into {reads.get(number)}, not {KEY_TO_NAME[key]}")

    def test_every_read_of_the_ranges_is_mapped_or_named(self):
        mapped = set(json.loads(CONTRACT.read_text())["varMap"].values())
        for path in (ROUTINE, WRAPPER):
            for i, code in code_lines(path):
                for n in map(int, re.findall(r"#(\d{4})(?!\d)", code)):
                    if n not in IN_RANGE:
                        continue
                    with self.subTest(file=path.name, line=i, number=n):
                        m = READ.match(code)
                        if m and int(m.group(2)) == n:
                            if n in mapped:
                                continue
                            self.assertEqual(NAMED_UNMAPPED.get(n), m.group(1),
                                             f"{path.name}:{i} reads #{n} — neither mapped nor named")
                        else:
                            self.assertIn(code, KNOWN_WRITES, f"{path.name}:{i} uses #{n} in an unknown form: {code}")

    def test_the_probe_number_is_not_a_toolsetter_field(self):
        self.assertNotIn(3014, json.loads(CONTRACT.read_text())["varMap"].values())


if __name__ == "__main__":
    unittest.main()
