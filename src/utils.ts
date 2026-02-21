/**
 * Utility helpers for pi-test-harness consumers.
 */

import { rmSync } from "node:fs";

/**
 * Remove a file, silently ignoring EPERM/EBUSY errors.
 *
 * **Why this exists**: On Windows, pi extensions that open SQLite databases
 * do so in the `session_start` event handler. The corresponding close happens
 * in `session_shutdown` — but that event fires at Node.js **process exit**,
 * NOT when `session.dispose()` is called. This means DB files remain locked
 * for the lifetime of the test runner process.
 *
 * Safe pattern in afterEach:
 * ```ts
 * afterEach(() => {
 *   safeRmSync(dbPath);
 *   safeRmSync(dbPath + "-wal");
 *   safeRmSync(dbPath + "-shm");
 * });
 * ```
 *
 * Files are cleaned up by the OS when the process exits (or on next run).
 * Using unique DB paths per test ensures isolation.
 */
/**
 * Returns true for errno codes that represent a Windows file-lock condition.
 * Exported for unit testing — not part of the public API contract.
 * @internal
 */
export function _isLockedFileError(err: unknown): boolean {
	const code = (err as NodeJS.ErrnoException).code;
	return code === "EPERM" || code === "EBUSY";
}

export function safeRmSync(filePath: string): void {
	try {
		rmSync(filePath, { force: true });
	} catch (err) {
		// Only swallow Windows file-lock errors. Everything else (permissions,
		// bad path type, disk full) should still propagate so failures are visible.
		if (!_isLockedFileError(err)) throw err;
	}
}
