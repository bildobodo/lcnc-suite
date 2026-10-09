"""R115: plan-model controls, NOT tests of an implemented run_basis/range.

Usage: python3 plan-checks.py ARCHIVE OUTPUT_JSON
Loads only the existing pure pinned_ctx helper, not the gateway. R114 sweep
outputs are read as evidence; no collision sweep is rerun or implemented here.
"""
import ast
import copy
import hashlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Optional

root = Path(sys.argv[1])
tree = ast.parse((root / "lcnc-gateway/bulk_pipeline.py").read_text())
fn = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "pinned_ctx")
scope = {"Optional": Optional}
exec(compile(ast.Module(body=[fn], type_ignores=[]), "pinned_ctx-extract", "exec"), scope)
pinned = scope["pinned_ctx"]

def digest(ctx):
    # A deliberately limited model digest, not a proposed production schema.
    return hashlib.sha256(json.dumps(ctx, sort_keys=True).encode()).hexdigest()

file = "/model/program.ngc"
published = SimpleNamespace(
    published_ctx={"file": file, "g5x_index": 1, "var_patches": {"5221": 0}},
    published_params={"text": "5221 0\n", "g92": [0, 0, 0]},
    published_rotary_seed={"a": 0, "b": 0, "c": 0},
    published_tlo={"loaded_tool": 1},
    tool_basis={"xyz": [0, 0, 0], "mode": 0}, PINNED_NICE=19)

# F4 1b: snapshot the actual start context, separately from mutable publications.
run = {"run_id": 1, "tool_basis_rev": 9, "verified": True,
       "file": file, "source": "same-source", "ctx": copy.deepcopy(pinned(published, file))}
run["ctx_digest"] = digest(run["ctx"])
origin = {"pinned": True, "version": 3, "file": file, "source": run["source"],
          "for_run": {k: run[k] for k in ("run_id", "ctx_digest", "tool_basis_rev")}}

def dispatch_check(ctx):
    return digest(ctx) == run["ctx_digest"]

def publication_check(current_run):
    return current_run["verified"] and all(
        origin["for_run"][key] == current_run[key] for key in origin["for_run"])

def client_check(label, current_run):
    return (label["pinned"] and label["version"] == 3
            and label["file"] == current_run["file"]
            and label["source"] == current_run["source"]
            and current_run["verified"]
            and all(label["for_run"][k] == current_run[k] for k in label["for_run"]))

# R114 A -> B: mutate even nested publication members. Only the archive/model
# objects are changed. An immutable copy of A must remain A.
published.published_ctx["g5x_index"] = 2
published.published_ctx["var_patches"]["5221"] = 100
published.published_params["g92"][0] = 100
published.tool_basis["xyz"][2] = 20
ctx_b = pinned(published, file)
sent = copy.deepcopy(run["ctx"])
controls = {
    "A_still_admitted_after_B": dispatch_check(sent) and publication_check(run) and client_check(origin, run),
    "B_with_A_label_rejected_before_dispatch": not dispatch_check(ctx_b),
    "same_path_changed_source_rejected": not client_check({**origin, "source": "new-source"}, run),
    "same_source_changed_path_rejected": not client_check({**origin, "file": "/other/program.ngc"}, run),
    "new_run_rejected_at_publication": not publication_check({**run, "run_id": 2}),
    "same_version_new_basis_revision_rejected": not client_check(origin, {**run, "tool_basis_rev": 10}),
}
sent["g92_offset"][0] = 123
controls["changed_built_context_rejected"] = not dispatch_check(sent)
controls["snapshot_survives_nested_mutation"] = digest(run["ctx"]) == run["ctx_digest"]
assert all(controls.values()), controls

# Audit the stored real sweep results from R114 against F4's replacement
# contract. This is a contract/evidence comparison, not a new execution of the
# not-yet-existing provisional/full coordinator.
review_dir = root / "docs/reviews"
read = lambda name: json.loads((review_dir / f"viewer-palette-fest.r114.codex-{name}.json").read_text())
feed, rapid, unknown = map(read, ("feed-seam", "rapid-seam", "two-phase-control"))
assert feed["full"]["result"]["hits"] == []
rapid_hits = rapid["full"]["result"]["hits"]
assert [(x["line"], x.get("continuation")) for x in rapid_hits] == [(8, None), (10, 8), (11, 8)]
assert [x["line"] for x in unknown["full"]["hits"]] == [9]
assert any("cannot know" in n for n in unknown["full"]["notes"])

out = {
    "scope": "Plan-model checks of F4 using the real pinned_ctx helper; stored R114 sweep evidence read, not rerun. No implemented run_basis/range/coordinator or native gateway is tested.",
    "context_controls": controls,
    "start_context_digest": run["ctx_digest"],
    "later_publication_digest": digest(ctx_b),
    "complete_result_contract": {
        "feed": "Provisional boundary is replaced; completed full result has no collision.",
        "rapid": {"required_full_hits": rapid_hits, "merge_needed": False},
        "unknown_first_move": {"required_full_hits": unknown["full"]["hits"], "required_notes": unknown["full"]["notes"]},
        "incomplete_full_result": "The plan's 3c caveat must remain; completion/termination alone is not full coverage. Not executed here."
    }
}
Path(sys.argv[2]).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
print("PASS: 8 explicit context-model controls; 3 stored R114 full-sweep outcomes checked against the replacement contract. No product implementation tested.")
