---
"@marcfargas/pi-test-harness": patch
---

Fix tool event collection and block detection.

- **`toolResultsFor()` / `toolCallsFor()` now work without `mockTools`**. Previously these always returned `[]` when `mockTools` was not configured, because real tools were not wrapped for collection. Now all tools are always wrapped, regardless of whether mocks are configured.

- **Fix double-wrapping on multiple `run()` calls**. Calling `run()` twice in one test would wrap already-wrapped tools again, causing double-counted results and incorrect step numbers. The original tools are now captured once at session creation and reused on every `run()` call.

- **Fix block detection regression in `wrapForCollection`**. The `ToolBlockedError` class is thrown by the harness's own mock block path, but pi's native hook chain throws a plain `Error` with a message. Block detection now uses a hybrid check (`instanceof ToolBlockedError` + message fallback) so both paths are correctly classified as blocks rather than test failures.
