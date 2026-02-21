---
"@marcfargas/pi-test-harness": minor
---

Add `ToolBlockedError` and `safeRmSync` to the public API.

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
