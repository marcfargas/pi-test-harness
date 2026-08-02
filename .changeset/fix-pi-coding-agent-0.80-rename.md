---
"@marcfargas/pi-test-harness": minor
---

Fix `createTestSession()` against `@earendil-works/pi-coding-agent >= 0.80.0` / `@earendil-works/pi-ai >= 0.80.0`.

- **`getModel` import (#8).** `@earendil-works/pi-ai@0.80+` removed `getModel` from its main entry (moved
  to the deprecated `/compat` shim). `createTestSession()` now uses `getBuiltinModel` from
  `@earendil-works/pi-ai/providers/all` instead, per the deprecation notice's own recommendation.
- **Auth-bypass patch.** `AgentSession`'s internal auth surface was renamed from `_modelRegistry` to
  `_modelRuntime` in `@earendil-works/pi-coding-agent@0.80+` (and the auth-check calls now take provider
  id strings instead of `Model` objects). Without this, every `t.run(...)` failed with `"No API key found
  for <provider>"` even though the playbook fully replaces `streamFn` and no real model call ever happens.
  `createTestSession()` now patches whichever shape is present, so both pre-0.80 (`_modelRegistry`) and
  0.80+ (`_modelRuntime`) pi-coding-agent releases bypass real auth checks in tests.
- CI's integration matrix now also verifies `0.80.10`, in addition to the existing `0.74.2` / `0.75.4`
  coverage, so a regression like this is caught going forward.

Note: `0.81.0` renamed `agent.streamFn` to `agent.streamFunction`, which silently breaks the harness's
model-mocking mechanism entirely (every `run()` reports "Playbook not fully consumed... Consumed 0 of N
action(s)"). That's a separate, unresolved issue and not addressed by this fix.
