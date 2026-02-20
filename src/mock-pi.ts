/**
 * createMockPi — mock pi CLI for testing extensions that spawn pi as a subprocess.
 *
 * Creates a temp directory with a `pi` shim (`.cmd` on Windows, shell script on Linux)
 * that prepends to PATH. The shim invokes a mock-pi-script.mjs that reads queued
 * responses from a file-based queue. Responses are consumed in order; the last one
 * repeats when the queue is exhausted.
 *
 * ```ts
 * const mockPi = createMockPi();
 * mockPi.install();
 *
 * mockPi.onCall({ output: "Hello from agent" });
 * mockPi.onCall({ stderr: "crashed", exitCode: 1 });
 *
 * // ... test code that spawns pi ...
 *
 * mockPi.reset();
 * mockPi.uninstall();
 * ```
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { MockPi, MockPiCall } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Valid keys for MockPiCall — used for runtime validation. */
const VALID_MOCK_PI_CALL_KEYS = new Set([
	"output",
	"exitCode",
	"stderr",
	"delay",
	"jsonl",
	"writeFiles",
]);

/**
 * Resolve the mock-pi-script.mjs path.
 *
 * During dev (vitest): src/mock-pi.ts → sibling src/mock-pi-script.mjs
 * After build (dist):  dist/mock-pi.js → ../src/mock-pi-script.mjs
 */
function findMockPiScript(): string {
	// Direct sibling (running from src/ via vitest)
	const sibling = path.join(__dirname, "mock-pi-script.mjs");
	if (fs.existsSync(sibling)) return sibling;

	// One level up to package root, then into src/ (running from dist/)
	const fromDist = path.join(__dirname, "..", "src", "mock-pi-script.mjs");
	if (fs.existsSync(fromDist)) return fromDist;

	throw new Error(
		"Could not find mock-pi-script.mjs. Searched:\n" +
			`  ${sibling}\n` +
			`  ${fromDist}`,
	);
}

/**
 * Create a mock pi CLI for testing extensions that spawn pi as a subprocess.
 *
 * **Concurrency constraint**: Designed for serial subprocess spawns within a single test.
 * If your test spawns multiple pi processes concurrently, responses may be consumed
 * out of order. Use separate `createMockPi()` instances for concurrent scenarios,
 * or ensure your test logic doesn't depend on response ordering.
 */
export function createMockPi(): MockPi {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-mock-"));
	let originalPath: string | undefined;
	let installed = false;

	const queueFile = path.join(dir, "queue.json");
	const counterFile = path.join(dir, "counter");

	// Initialize empty queue
	fs.writeFileSync(queueFile, "[]");
	fs.writeFileSync(counterFile, "0");

	const scriptPath = findMockPiScript();
	const nodeExe = process.execPath;

	// Safety net: restore PATH if process exits without uninstall()
	const exitHandler = () => {
		if (originalPath !== undefined) {
			process.env.PATH = originalPath;
		}
	};

	return {
		dir,

		install() {
			if (installed) return;
			originalPath = process.env.PATH;

			if (process.platform === "win32") {
				// Windows: .cmd batch file shim
				const cmd = [
					"@echo off",
					`set "MOCK_PI_QUEUE_DIR=${dir}"`,
					`"${nodeExe}" "${scriptPath}" %*`,
				].join("\r\n") + "\r\n";
				fs.writeFileSync(path.join(dir, "pi.cmd"), cmd);
			} else {
				// Linux/macOS: shell script shim
				const sh = [
					"#!/bin/sh",
					`MOCK_PI_QUEUE_DIR="${dir}" exec "${nodeExe}" "${scriptPath}" "$@"`,
				].join("\n") + "\n";
				const piPath = path.join(dir, "pi");
				fs.writeFileSync(piPath, sh);
				fs.chmodSync(piPath, 0o755);
			}

			process.env.PATH = `${dir}${path.delimiter}${originalPath}`;
			process.on("exit", exitHandler);
			installed = true;
		},

		uninstall() {
			if (!installed) return;
			process.removeListener("exit", exitHandler);
			if (originalPath !== undefined) {
				process.env.PATH = originalPath;
				originalPath = undefined;
			}
			try {
				fs.rmSync(dir, { recursive: true, force: true });
			} catch {
				// Best-effort cleanup
			}
			installed = false;
		},

		onCall(response: MockPiCall) {
			// Validate keys to catch typos early
			const unknown = Object.keys(response).filter(
				(k) => !VALID_MOCK_PI_CALL_KEYS.has(k),
			);
			if (unknown.length > 0) {
				throw new Error(
					`Unknown MockPiCall key(s): ${unknown.join(", ")}. ` +
						`Valid keys: ${[...VALID_MOCK_PI_CALL_KEYS].join(", ")}`,
				);
			}

			const queue: MockPiCall[] = JSON.parse(fs.readFileSync(queueFile, "utf-8"));
			queue.push(response);
			fs.writeFileSync(queueFile, JSON.stringify(queue));
		},

		reset() {
			fs.writeFileSync(queueFile, "[]");
			fs.writeFileSync(counterFile, "0");
		},

		callCount(): number {
			try {
				return parseInt(fs.readFileSync(counterFile, "utf-8").trim(), 10) || 0;
			} catch {
				return 0;
			}
		},
	};
}
