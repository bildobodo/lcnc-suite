# LCNC Suite Architecture Handoff

## Context

This handoff summarizes architectural observations from the LCNC Suite frontend/backend review. It is written as a planning document, not as a patch plan. The review covered the current `development` branch context and the issues filed on GitHub as `#17` through `#32`.

The overall read: LCNC Suite has solved many difficult practical problems already, but it has reached the point where implicit architecture should become explicit. The system is powerful, but too much authority, state, validation, protocol behavior, and persistence coordination is currently concentrated in a few broad modules.

The next maturity step is to separate:

- machine-control authority
- websocket protocol
- runtime state and cache validity
- persistence ownership
- frontend interaction convenience

The goal is not a rewrite. The goal is to harden the control system architecture while preserving the working behavior that already exists.

## Reviewer Re-Baseline — 2026-06-03

> Added during review of the **actual** `development` branch state (commits through `2564c27`). The "Current Shape" descriptions below were written against an earlier snapshot; several are now **stale** — a meaningful slice of Phase 1 already shipped in the `feat(security)` / `fix(security)` / `chore(hardening)` commits. **Re-baseline before acting on this document.** The executable plan derived from this section lives in `REFACTOR_PLAN.md`.

### Status of each section vs. actual code

| § | Topic | Doc framing | Actual state | Evidence |
|---|-------|-------------|--------------|----------|
| 1 | Backend command policy | gap | **Partial** — only `require_armed()` + `reject_if_auto_running()`; no per-command policy | `gateway.py:3420-3441`, `:3496-3498` |
| 2 | Request IDs / typed protocol | gap | **Not present** — global `lastReply` ref; session-id resume only | `lcncWs.ts:60` |
| 3 | Payload validation | "casts directly with int()/float()" | **Partial / partly stale** — `finite_float()` exists, tested, wired into newer paths | `gateway_util.py:105-117` |
| 4 | Gateway modularity | gap | **Not present** — ~6800-line `gateway.py` monolith | `gateway.py` |
| 5 | Runtime epochs | gap | **Partial** — version counters + INI-change invalidation already exist | version counters in `gateway.py` |
| 6 | Persistence locks | gap | **Partial** — per-subsystem `threading`/`asyncio` locks; no store classes | `gateway.py:2429` |
| 7 | Frontend typed dispatcher | gap | **Not present** — raw `send()`/`fire()` + `lastReply` | `lcncWs.ts` |
| 8 | Security / auth | "unauth WS, wildcard CORS, unauth mutations" | **DONE / stale** — token+origin gate on WS, token on HTTP mutations, CORS restricted when allow-list set | `gateway.py:5710-5717` |
| 9 | Testing | thin | **Minimal** — util + frontend permission tests only; ~1% command-path coverage | `test_gateway_util.py` |

### Corrections to the recommendations

1. **§1 is the highest-value open item** — but scope it to the *safety-relevant invariants* (homed-before-motion, idle-before-mode-change, no-MDI-while-running, eoffset-contamination). Do **not** mirror all 14 frontend permission classes server-side; that is a double-maintenance tax. Frame it as *authorization*, not safety-of-last-resort — HAL still owns abort (see `feedback_armed_is_authorization_not_deadman`).
2. **§8 is essentially closed.** Two residuals only: (a) the token is served in `index.html`, so it is **not** a defense against an attacker already on the LAN — tracked in `project_stronger_token_mode`; (b) CORS falls back to `["*"]` when no allow-list is set — make that a documented, conscious decision rather than a silent fallback.
3. **§6**: the settings/tool locks are `threading.Lock` inside an asyncio gateway. If those writes run on the event loop they block it — decide `asyncio.Lock` + executor vs. threading deliberately.
4. **§2 / §7 (requestIds, typed dispatcher) are lower value for a single-operator UI.** Do them opportunistically for the real request/reply flows (tool-table fetch, `halshow_dump`, settings) — skip the big-bang migration unless the multi-client / pendant goal is actually pursued.
5. **§5 epochs are speculative** without an observed stale-cache / INI-switch bug; version counters + INI invalidation already exist. Downgrade until there is a symptom.

### Roadmap ordering fix

The original roadmap runs **Modularization (Phase 4) before Tests (Phase 5)** — backwards for a safety-critical ~6800-line file with ~1% command coverage. **Write characterization tests *before* carving up the monolith.** Revised order (see `REFACTOR_PLAN.md`):

1. Backend safety-invariant command policy (§1, scoped subset)
2. Characterization tests for command handlers (§9) — *before* any extraction
3. Tool/settings store with real transaction locks (§6); resolve threading-vs-asyncio
4. Extract 3–4 gateway seams (§4) — now covered by tests (not 15 files)
5. requestIds / epochs / dispatcher (§2 / §5 / §7) — only as concrete needs appear

## High-Level Architectural Read

The current architecture appears to have grown successfully around a pragmatic gateway and a rich frontend:

- One large Python gateway handles LinuxCNC command dispatch, status polling, websocket fanout, REST endpoints, telemetry, preview generation, file operations, settings, tool tables, HAL interactions, safety/session behavior, and caches.
- One rich Vue frontend handles machine controls, viewer state, permissions, websocket connection management, panels, settings, probing, tool management, diagnostics, and visual state.
- The websocket stream carries status, events, initialization frames, and command replies.
- The frontend has a meaningful permission model, but backend enforcement is not yet equally expressive.
- Several caches and state versions exist, but not all are keyed to the active LinuxCNC configuration/session context.

This is a normal growth pattern for a product that moved fast and built useful features. The architectural risk is that machine-control authority, transport convenience, and UI assumptions are now too tightly coupled.

## 1. Backend Should Become The Authority

### Current Shape

The frontend computes detailed permission classes and disables controls based on machine state. The backend often checks only whether the websocket client is armed before executing a command.

This means the frontend currently carries too much policy responsibility. A direct websocket client can bypass some frontend-only restrictions.

> **Reviewer (2026-06-03):** Accurate, and this is the **highest-value open item**. Scope the backend gate to the *safety-relevant invariant subset* (homed-before-motion, idle-before-mode-change, no-MDI-while-running, eoffset-contamination) rather than mirroring all 14 frontend classes. It is authorization, not abort-safety — HAL owns abort.

### Preferred Shape

The frontend should answer:

> Should this control be visible/enabled for the operator?

The backend should answer:

> Is this command allowed right now?

LinuxCNC then answers:

> Can this operation be executed by the machine runtime?

Backend commands should be assigned explicit policy classes, for example:

- `always`: estop, disarm, acknowledge safety trip
- `idle`: idle-only non-motion actions
- `jog`: armed, enabled, homed, idle
- `ready`: cycle start, MDI, run-from-line
- `running`: pause/feed hold actions
- `paused`: resume/step actions
- `setup`: settings, tool table, probing setup
- `fileOp`: upload, load, unload, delete

### Benefits

- Buggy or malicious clients cannot bypass disabled frontend controls.
- Backend behavior becomes predictable and auditable.
- Safety and state policy live in one place.
- Future clients, mobile UIs, pendant UIs, or APIs inherit the same rules.
- Tests can validate command eligibility across machine states.

### Drawbacks

- Existing commands may start failing in states where they currently pass.
- Edge cases must be defined clearly.
- Frontend and backend permission names need to stay aligned.
- Requires careful rollout to avoid blocking legitimate workflows.

### Estimated Effort

- First useful pass: 2-4 days.
- Robust command matrix with tests: 1-2 weeks.

## 2. Typed Websocket Protocol With Request IDs

### Current Shape

Websocket commands are sent as JSON payloads. Replies are emitted as generic `reply` messages. The frontend stores the latest reply globally and components infer ownership from payload shape and local loading state.

This works in simple flows but becomes fragile when multiple components send commands concurrently.

### Preferred Shape

Each command should carry a request ID:

```json
{
  "type": "command",
  "requestId": "abc123",
  "cmd": "get_tool_table"
}
```

The backend should echo the request ID:

```json
{
  "type": "reply",
  "requestId": "abc123",
  "ok": true,
  "tools": []
}
```

The frontend command API should look more like:

```ts
const reply = await command("get_tool_table", {}, { timeoutMs: 3000 });
```

### Benefits

- Components receive the replies that belong to them.
- Errors route to the caller that caused them.
- Timeouts become straightforward.
- Retries and cancellation become safer.
- Debug logs can trace request lifecycle.
- Removes fragile `lastReply` watchers from component data flow.

### Drawbacks

- Many frontend command callers need migration.
- Some fire-and-forget flows must be classified.
- Existing status/event/reply message types need clear separation.

### Estimated Effort

- Basic request IDs and typed command helper: 2-4 days.
- Full migration of important flows: 1-2 weeks.

## 3. Formal Command Validation

### Current Shape

Many backend commands cast websocket payload fields directly with `int(...)`, `float(...)`, and direct indexing. Validation is mixed into command execution and malformed payload handling is inconsistent.

> **Reviewer (2026-06-03) — partly stale:** `finite_float()` (NaN/Inf rejection) now exists in `gateway_util.py:105-117`, is unit-tested, and is wired into the newer jog/tool paths. The remaining work is *coverage* (extend it to the older `int()`/`float()` casts), not greenfield.

### Preferred Shape

Command schemas should validate data before execution reaches LinuxCNC calls.

Examples:

- `JogCommand`
- `IncrementalJogCommand`
- `SetFeedOverrideCommand`
- `LoadFileCommand`
- `SaveToolCommand`
- `RunFromLineCommand`

Each schema should validate:

- required fields
- type
- numeric range
- finite numeric values
- allowed enum values
- path/file constraints
- command-specific safety assumptions

### Benefits

- Bad commands return bounded `{ ok: false }` replies.
- Malformed payloads do not accidentally trigger websocket disconnect behavior.
- Prevents `NaN`, `Infinity`, invalid axes, impossible tool numbers, and negative values where unsafe.
- Makes the API self-documenting.
- Enables fuzz and schema tests.

### Drawbacks

- Adds schema boilerplate.
- Current permissive behavior may become rejected.
- Requires choosing a schema approach such as Pydantic, msgspec, dataclasses, or hand-written validators.

### Estimated Effort

- High-risk commands first: 2-3 days.
- All command families with tests: 1-2 weeks.

## 4. Split The Gateway Into Services

### Current Shape

The gateway module carries too many domains at once:

- FastAPI app setup
- websocket endpoint
- LinuxCNC command handling
- status polling
- machine safety/session state
- settings persistence
- tool table persistence
- file upload/load/delete
- gcode preview generation
- surface and compensation grid caches
- HAL topology
- telemetry

### Preferred Shape

An incremental modular shape could be:

```text
lcnc_gateway/
  app.py
  websocket.py
  protocol.py
  command_dispatch.py
  command_policy.py
  command_schemas.py
  linuxcnc_service.py
  status_poller.py
  safety.py
  settings_store.py
  tool_store.py
  file_store.py
  preview_service.py
  surface_service.py
  hal_service.py
  telemetry.py
```

This should be done gradually. The key is to extract stable seams after policy, validation, and protocol behavior are clearer.

### Benefits

- Smaller files with clearer ownership.
- Easier targeted tests.
- Safer future changes.
- Less accidental coupling between unrelated domains.
- New contributors can reason about the system faster.
- Command policy, persistence, and websocket protocol become easier to harden.

### Drawbacks

- Refactor risk.
- Easy to over-abstract too early.
- LinuxCNC runtime behavior must remain stable during extraction.
- Globals/imports can become messy if extraction is not staged.

### Estimated Effort

- Careful incremental extraction: 2-4 weeks.
- Clean modular backend with broad tests: 1-2 months.

### Recommendation

Do not start with this as the first task. First add command policy, validation, request IDs, and persistence boundaries. Then module extraction becomes safer and less speculative.

## 5. Introduce Runtime Epochs

### Current Shape

The app already uses version counters for several resources. That is good. However, some cached data is not tied strongly enough to the runtime context that produced it.

Important contexts include:

- LinuxCNC connection epoch
- active INI/config epoch
- loaded file epoch
- viewer/machine-config epoch
- websocket client session epoch

### Preferred Shape

Cache versions should be derived from or associated with runtime epochs.

Example:

```text
machineConfigEpoch = hash(STAT.ini_filename + machine.json mtime)
surfaceCacheEpoch = machineConfigEpoch + probe-results.txt mtime
previewEpoch = activeFile path + mtime + parser version
```

Frontend messages can include epochs so stale messages from old runtime contexts are ignored.

### Benefits

- Avoids stale viewer, surface, and compensation data.
- Makes reconnect behavior cleaner.
- Makes cache invalidation explicit.
- Helps diagnose LinuxCNC restarts and INI switches.
- Lets the frontend reset only the state that actually became invalid.

### Drawbacks

- Adds metadata to messages.
- Frontend needs to compare epochs and reset state carefully.
- Requires deciding what constitutes a new machine context.

### Estimated Effort

- Basic INI/config/file epochs: 3-5 days.
- Full cache/session epoch model across frontend/backend: 1-2 weeks.

## 6. Persistence Layer With Locks And Transactions

### Current Shape

Atomic writes are used, which is a good primitive. But atomic write is not the same as a transaction. Related read-modify-write operations are not consistently protected by resource-level locks.

Risk areas:

- settings writes from REST and websocket
- tool table plus tool metadata
- tool renumber
- tool imports
- multi-tab saves

### Preferred Shape

Each persisted resource should have a store object that owns its own lock and transaction semantics.

Example:

```python
class SettingsStore:
    async def load(self): ...
    async def save_section(self, section, data): ...
```

```python
class ToolStore:
    async def list_tools(self): ...
    async def save_tool(self, tool): ...
    async def renumber_tool(self, old_number, new_tool): ...
    async def import_tools(self, tools): ...
```

### Benefits

- Prevents lost updates.
- Keeps tool table and metadata consistent.
- Centralizes validation and backup behavior.
- Makes concurrency tests possible.
- Reduces duplicated save paths.

### Drawbacks

- Requires changing both REST and websocket mutation paths.
- Blocking file IO needs careful handling.
- Tool table semantics must be defined precisely.

### Estimated Effort

- Settings lock/store: 1-2 days.
- Tool store with transactional renumber/import: 3-6 days.
- Comprehensive persistence tests: about 1 week.

## 7. Frontend Typed Command Dispatcher

### Current Shape

The frontend uses a mix of raw `send(...)`, policy-aware `fire(...)`, `lastReply` watchers, and component-specific reply handling.

### Preferred Shape

Introduce one typed command client:

```ts
await machineCommand.run("cycle_start", {}, {
  permission: "ready",
  timeoutMs: 3000,
});

await machineCommand.run("save_tool", payload, {
  permission: "setup",
  timeoutMs: 5000,
});
```

Reserve fire-and-forget emits for non-command messages:

```ts
machineCommand.emit("heartbeat", payload);
machineCommand.emit("client_diag", payload);
machineCommand.emit("tab_visibility", payload);
```

### Benefits

- One place for request IDs.
- One place for frontend permission checks.
- One place for timeout and error behavior.
- Cleaner loading states.
- Removes fragile component watchers over global reply state.
- Makes frontend command behavior more testable.

### Drawbacks

- Requires touching many components.
- Some existing flows assume global reply behavior.
- Need to classify command vs telemetry vs read-only request.

### Estimated Effort

- Dispatcher plus high-risk panels: 3-5 days.
- Full migration: 1-2 weeks.

## 8. Security Boundary And Deployment Modes

### Current Shape

The default deployment posture is convenient but too open for a machine-control network. LAN visibility, wildcard CORS, unauthenticated websocket control, and unauthenticated mutation routes create a broad control surface.

> **Reviewer (2026-06-03) — stale, essentially closed:** token + origin gates on the WS (`gateway.py:5710-5717`), `require_token` on every HTTP mutation route, and CORS restricted to the allow-list when one is set, all shipped in the `#17` / security commits. Residuals: (a) the token is served in `index.html`, so it is not a defense against an attacker already on the LAN (`project_stronger_token_mode`); (b) CORS still falls back to `["*"]` with no allow-list — make that a documented decision.

### Preferred Shape

Define explicit deployment modes:

```text
local kiosk:
  bind 127.0.0.1
  strict mutation rules

development:
  relaxed CORS
  explicit unsafe opt-in

LAN:
  auth required
  configured allowed origins

remote/admin:
  auth required
  likely TLS/reverse proxy support
```

### Benefits

- Safer default deployment.
- Clearer admin/operator expectations.
- Easier documentation.
- Reduced chance of accidental LAN exposure.
- Better future support for remote or multi-client use.

### Drawbacks

- Adds setup friction.
- Users may need tokens, passwords, or pairing.
- Auth must be designed so it does not disrupt real shop workflows.

### Estimated Effort

- Basic token/session auth and origin allowlist: 3-7 days.
- Polished deployment/auth model: 2-4 weeks.

## 9. Testing Architecture

### Current Shape

The existing checks are useful but thin. Syntax/build checks catch some failures, but the most important risks are command/protocol/state regressions.

### Preferred Shape

Layered tests:

- Pure unit tests: path validation, command schemas, permission evaluation.
- Backend service tests: settings store, tool store, persistence locks.
- Websocket protocol tests: request/reply correlation, malformed commands, reconnect behavior.
- Frontend unit tests: permissions and command dispatcher.
- Playwright smoke tests: core panels render, controls disable correctly, responsive layouts.
- Simulation tests: LinuxCNC-dependent flows where practical.

### Benefits

- Faster iteration.
- Safer refactoring.
- Prevents regressions in safety gates.
- Documents expected behavior.
- Makes large module extraction more realistic.

### Drawbacks

- Initial setup time.
- Some LinuxCNC behavior is hard to test without simulation.
- Tests need to stay focused so they do not become brittle.

### Estimated Effort

- Useful baseline: about 1 week.
- Good coverage around command/protocol/persistence: 2-4 weeks.

## Suggested Roadmap

> **Reviewer (2026-06-03):** Superseded by the revised order in the **Reviewer Re-Baseline** section above and `REFACTOR_PLAN.md`. Key change: **tests come before modularization** (original Phase 5 → before Phase 4), and Phase 1's auth/origin/queue-drop items are already done.

### Phase 1: Safety And Protocol Hardening

Estimated effort: 2-4 weeks.

Tasks:

- Add backend auth/origin controls.
- Add backend command permission gates.
- Add command payload validation.
- Add websocket request IDs.
- Drop or revalidate queued commands after reconnect.

Rationale:

This phase reduces the highest risk without requiring a large refactor.

### Phase 2: State Correctness

Estimated effort: 1-2 weeks.

Tasks:

- Add machine/config/file epochs.
- Invalidate surface/grid caches on config changes.
- Version viewer init explicitly.
- Add resource-level persistence locks.

Rationale:

This phase addresses stale state, cache validity, and multi-tab consistency.

### Phase 3: Frontend Command Cleanup

Estimated effort: 1-2 weeks.

Tasks:

- Add typed command dispatcher.
- Remove component dependency on global `lastReply`.
- Normalize raw `send(...)` usage.
- Improve loading/error states for command flows.

Rationale:

This phase makes the frontend easier to reason about and prepares it for safer backend protocol changes.

### Phase 4: Backend Modularization

Estimated effort: 2-4 weeks.

Tasks:

- Extract command dispatch, policy, and schemas.
- Extract settings/tool stores.
- Extract status/cache services.
- Keep LinuxCNC runtime behavior stable.

Rationale:

Once protocol and command behavior are explicit, backend extraction is safer.

### Phase 5: Quality Systems

Estimated effort: first useful pass 1-2 weeks, then ongoing.

Tasks:

- Add lint/typecheck.
- Add backend unit tests.
- Add frontend unit tests.
- Add Playwright smoke tests.
- Add bundle size budget.

Rationale:

The system needs repeatable checks before large architectural changes.

## Net Architectural Take

LCNC Suite is not badly built. It is a successful application that has outgrown implicit architecture.

The frontend is strong and feature-rich. The backend already has many good primitives:

- atomic writes
- cached preview data
- websocket worker thinking
- version counters
- safety comments and cleanup paths
- HAL integration
- LinuxCNC polling and command orchestration

The next step is to make authority explicit:

- backend owns permission
- protocol owns correlation
- schemas own validation
- stores own persistence
- epochs own cache validity
- frontend owns interaction, not trust

That shift would make LCNC Suite feel less like a large app around LinuxCNC and more like a proper machine-control platform.

