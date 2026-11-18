# The one input adaptation for Codex's R400 probes rerun at 11afacdc (R401):
# the R400 construction put the whole options set (2779 records) into BOTH
# group files; under the per-group rule (VM-I34 B) that is 2779 foreign
# records. This splits the set by each group's own listing, in a COPY of the
# mg5c7 artefacts (Codex's /tmp/r400-input untouched). The probe script
# itself (docs/reviews/vor-maschine.rp5.r400.codex-probes.py) ran unchanged:
#   python3 -I vor-maschine.rp5.r400.codex-probes.py --root <archive of 11afacdc>
#           --gate <copy>/gate-merge.json --out <out>.json
import json, sys
S = sys.argv[1]; L = f"{S}/mg5c7copy/gate-merge.logs"
allopts = json.load(open(f"{S}/mg5c7copy/all.options.json"))
rel = lambda f: f.split("/lcnc-webui/src/")[-1]
for g in ("unit-light", "unit-heavy"):
    keys = {(rel(x["file"]), x["name"]) for x in json.load(open(f"{L}/{g}.list.json"))}
    part = [x for x in allopts if (rel(x["file"]), x["fullName"]) in keys]
    json.dump(part, open(f"{L}/{g}.options.json", "w"))
    print(g, "listed", len(keys), "records", len(part))
