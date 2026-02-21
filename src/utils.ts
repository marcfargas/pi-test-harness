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
export function safeRmSync(filePath: string): void {
    try {
        rmSync(filePath, { force: true });
    } catch {
        // EPERM / EBUSY: file may be locked (e.g., SQLite WAL file on Windows).
        // The lock is released at process exit — this is expected and safe to ignore.
    }
}
