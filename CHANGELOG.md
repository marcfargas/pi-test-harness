# @marcfargas/pi-test-harness

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
