"""R477: executable readings of the written plan, NOT product tests.

The store/cache do not exist yet. These small models show that the literal
rules do not imply the claimed invariants, without attributing code to them.
"""
import json

out = []
def record(case, **values):
    out.append(dict(case=case, **values))

# 1.3 held decisions; 1.4 explicit marker fallback, check unchanged; 4 same
# reason/body in simulation and the result's card.
held_result = 'shape'
record('disconnect', held_result=held_result, marker='table cylinder',
       same_as_card=(held_result == 'table cylinder'))
held_result = 'table cylinder'
publication_after_late_proof = 'shape'
record('late proof during run', held_result=held_result,
       marker_from_publication=publication_after_late_proof,
       same_as_card=(held_result == publication_after_late_proof))

# 1.3 insertion + 8 per T, unchanged identity/library. No deletion rule is
# specified. Small tables here demonstrate growth independently of row caps.
seen = {}
for table_number in range(5):
    table = [(2*table_number+1, 6, 40), (2*table_number+2, 6, 40)]
    for T, D, Z in table:
        rows = seen.setdefault(T, [])
        rows[:] = [(D, Z)] + [row for row in rows if row != (D, Z)]
        del rows[8:]
    record('successive two-tool tables', table_number=table_number,
           current_tools=len(table), seen_tools=len(seen),
           max_rows_per_tool=max(map(len, seen.values())))

# Record is {T,D,Z,meta} from one decoded reply. A new decoded object per
# reply is not interned by merely giving it the same library revision.
rows = [dict(T=13,D=1.875,Z=60+i*.001,
             meta=json.loads('{"native_mesh":{"vertices":[[1,2,3]],"triangles":[[0,0,0]]}}'))
        for i in range(8)]
record('same library, eight proven Z rows', seen_rows=len(rows),
       distinct_meta_objects=len({id(row['meta']) for row in rows}),
       distinct_meta_contents=len({json.dumps(row['meta']) for row in rows}))

# 1.5 private entry has an owner, not a map slot. Its own late result cannot
# pass the written universal map-membership condition.
private_entry = object()
generation_map = {i: object() for i in range(32)}
record('private build completes', owner_alive=True, generation_alive=True,
       late_result_publishable=private_entry in generation_map.values())

print(json.dumps({'kind':'plan models only', 'cases':out},indent=2))
