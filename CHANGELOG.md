# @marcfargas/pi-test-harness

## 0.5.0

### Minor Changes

- [#3](https://github.com/marcfargas/pi-test-harness/pull/3) [`225e123`](https://github.com/marcfargas/pi-test-harness/commit/225e123ce6ce2790f739aa3083ad1add3f09e752) Thanks [@marcfargas](https://github.com/marcfargas)! - Add `ToolBlockedError` and `safeRmSync` to the public API.

  **`ToolBlockedError`** — a typed error class thrown when an extension hook blocks a mocked tool call. Use `instanceof ToolBlockedError` to distinguish hook blocks from real execution errors in tests, instead of matching error message strings.

  ```ts
  import { ToolBlockedError } from "@marcfargas/pi-test-harness";

  // Test that a blocked call doesn't crash, just records an error
  const result = t.events.toolResultsFor("bash")[0];
  expect(result.isError).toBe(true);

  // Or catch it where propagateErrors is relevant
  try {
    await t.run(when("Try write", [calls("bash", {}), says("Done.")]));
  } catch (err) {
    if (err instanceof ToolBlockedError) {
      // Expected — extension hook blocked the call
    } else throw err;
  }
  ```

  **`safeRmSync(filePath)`** — removes a file, swallowing `EPERM` and `EBUSY` errors only. Intended for `afterEach` cleanup of extension-owned SQLite files on Windows, where `session_shutdown` (which closes DB connections) fires at process exit rather than on `session.dispose()`.

  ```ts
  import { safeRmSync } from "@marcfargas/pi-test-harness";

  afterEach(() => {
    t?.dispose();
    safeRmSync(dbPath);
    safeRmSync(dbPath + "-wal");
    safeRmSync(dbPath + "-shm");
  });
  ```

### Patch Changes

- [#3](https://github.com/marcfargas/pi-test-harness/pull/3) [`225e123`](https://github.com/marcfargas/pi-test-harness/commit/225e123ce6ce2790f739aa3083ad1add3f09e752) Thanks [@marcfargas](https://github.com/marcfargas)! - Fix tool event collection and block detection.

  - **`toolResultsFor()` / `toolCallsFor()` now work without `mockTools`**. Previously these always returned `[]` when `mockTools` was not configured, because real tools were not wrapped for collection. Now all tools are always wrapped, regardless of whether mocks are configured.

  - **Fix double-wrapping on multiple `run()` calls**. Calling `run()` twice in one test would wrap already-wrapped tools again, causing double-counted results and incorrect step numbers. The original tools are now captured once at session creation and reused on every `run()` call.

  - **Fix block detection regression in `wrapForCollection`**. The `ToolBlockedError` class is thrown by the harness's own mock block path, but pi's native hook chain throws a plain `Error` with a message. Block detection now uses a hybrid check (`instanceof ToolBlockedError` + message fallback) so both paths are correctly classified as blocks rather than test failures.

## 0.4.1

### Patch Changes

- [`58693d2`](https://github.com/marcfargas/pi-test-harness/commit/58693d2bab91651fe647dffe740643ab3af13cbf) Thanks [@marcfargas](https://github.com/marcfargas)! - Address code review findings for v0.4.0 standalone release.

  - **Breaking**: Remove deprecated `call()`/`say()` DSL aliases (use `calls()`/`says()` instead)
  - Fix diagnostic messages to reference current `calls()`/`says()` API names
  - Fix release workflow for npm Trusted Publishers (`--provenance`)
  - Record all mock UI method calls for assertion consistency (`setFooter`, `setHeader`, etc.)
  - Scope playbook `toolCallCounter` to factory closure for concurrency safety
  - Add `verifySandboxInstall()` test suite (4 tests with dummy extension fixture)
  - Update package description to mention all three test layers

## 0.4.0

### Minor Changes

- [`688e5fa`](https://github.com/marcfargas/pi-mf-extensions/commit/688e5faa29a1c2673699d5e120b95b619e451ae6) Thanks [@marcfargas](https://github.com/marcfargas)! - Ship compiled `.js` + `.d.ts` output instead of raw TypeScript sources

  Previously, the package shipped only `.ts` source files and relied on consumers having a TypeScript-aware loader (jiti, vitest). Node 24's `--experimental-strip-types` refuses to process `.ts` files inside `node_modules/`, making the package unusable with `node --test` or any Node-native test runner.

  Now:

  - Package exports point to pre-compiled `dist/index.js` (with `dist/index.d.ts` for types)
  - Source `.ts` files are still included for debugging/source maps
  - Build step (`tsc -p tsconfig.build.json`) runs automatically before publish via `prepublishOnly`

## 0.3.0

### Minor Changes

- Rename DSL: `call()` → `calls()`, `say()` → `says()`.

  The new names read more naturally as playbook declarations:
  `when("Deploy", [calls("bash", ...), says("Done.")])` reads as
  "when prompted 'Deploy', the model calls bash then says 'Done.'"

  The old `call()` and `say()` are kept as deprecated aliases (removal in v0.4).

## 0.2.0

### Minor Changes

- Initial release.

  - Playbook DSL (`when`, `call`, `say`) for scripting agent conversations without LLM calls
  - `createTestSession()` — creates real pi `AgentSession` with extension loading, hooks, and events
  - Mock tool execution — intercept `tool.execute()` per-tool with static, dynamic, or full result handlers
  - Mock UI context — configurable responses for `confirm`, `select`, `input`, `editor` with call recording
  - Event collection — query helpers for tool calls, tool results, blocked calls, UI interactions, and messages
  - Late-bound params and `.then()` callbacks for dynamic multi-step tool flows
  - Playbook diagnostics — clear error messages on exhausted/unconsumed actions with step-level detail
  - Error propagation control — abort on real tool throw (default) or capture as error results
  - `verifySandboxInstall()` — npm pack → temp install → verify extensions and tools load correctly

### Patch Changes

- Fix mocked tools bypassing extension hooks (tool_call/tool_result).

  - Mocked tools now fire `emitToolCall`/`emitToolResult` via the extension runner,
    so extension blocking (e.g., plan mode) works correctly in tests
  - Blocked tool results are recorded in `toolResults` before throwing
  - `wrapForCollection` now propagates `isError` from real tool results (was hardcoded `false`)
  - Hook-blocked tools no longer treated as test failures with `propagateErrors: true`
