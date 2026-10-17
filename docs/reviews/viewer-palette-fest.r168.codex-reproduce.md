# R168: C1 review evidence

Reviewed source: `9abc2195`, in an isolated `git archive` at `/tmp/codex-r168-pxyqpr1x/repo`. The live review request and amended plan were snapshotted separately; hashes in the manifest. No tracked source was edited.

## Own red probes

Copy `viewer-palette-fest.r168.codex-rapid.test.ts` and `viewer-palette-fest.r168.codex-sweep.test.ts` to `lcnc-webui/src/viewer/` in an archive of the reviewed source, naming them `r168.codex-rapid.test.ts` and `r168.codex-sweep.test.ts`. Supply existing npm dependencies. Set `R168_OUT` to an existing temporary directory.

```sh
R168_OUT=/tmp/codex-r168-pxyqpr1x nice -n 15 node node_modules/vitest/vitest.mjs run src/viewer/r168.codex-rapid.test.ts src/viewer/r168.codex-sweep.test.ts --maxWorkers=1
```

Both fail on the same assertion: the merged target lacks `T_RAPID`, although the current generation contains `IV_RAPID` and its target alone is rapid.

- `rapid.test.ts`: minimal real ContactStore / ContactView inputs. Held open feed contact to coverage 3; current generation extends the same contact to 8 and records a rapid touch. Stable key, one contact, missing rapid in the union.
- `sweep.test.ts`: no geometry mock. The existing PLUNGE box machine is fed down to Z=-43, dragged 3 mm on a rapid, then retracted. The original sweep is parked at its natural checkpoint after the feed (coverage 43). A new generation runs the same whole track. Its [40,49] contact has flags 134 (decided enter/exit + rapid); the held open interval has flags 2. The union correctly extends to 49 and keeps `C0|0|0`, but loses rapid. `NaN` open exit serializes as JSON null.

These are synchronous unit tests of the real sweep and view functions, not a browser or live worker-failure test. The current-only target is the positive control in both probes. Logs and JSON are stored separately. No product fix is included.

## Existing tests repeated

```sh
nice -n 15 node node_modules/vitest/vitest.mjs run src/viewer/collision.test.ts src/viewer/collisionHorizon.test.ts src/viewer/collisionInside.test.ts src/viewer/collisionOracle.test.ts src/viewer/collisionRange.test.ts src/viewer/collisionRangeOracle.test.ts src/viewer/contactView.test.ts src/viewer/contactViewUnion.test.ts src/viewer/machineGantry.test.ts src/viewer/machineModel.test.ts src/viewer/machineTrsrn.test.ts src/viewer/sweepShards.test.ts src/viewer/toolBasis.test.ts src/viewer/toolChangePayloads.test.ts --maxWorkers=1 --reporter=json --outputFile=/tmp/codex-r168-pxyqpr1x/unit.json
```

This selects all 14 changed test files, using the ordinary oracle corpus, not `COLLISION_HUNT=deep`. The report and a compact summary give the outcome. Claude's full frontend gate and mutation reports were inspected, not rerun. No browser server or machine commands were used.
