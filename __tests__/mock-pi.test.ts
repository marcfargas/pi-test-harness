import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { createMockPi } from "../src/mock-pi.js";
import type { MockPi } from "../src/types.js";

/**
 * Helper: run pi via the mock shim and return stdout.
 * Uses shell: true so cmd.exe (Windows) or /bin/sh (Linux) resolves the shim.
 */
function runPi(args: string, env?: Record<string, string>): string {
	return execSync(`pi ${args}`, {
		encoding: "utf-8",
		env: { ...process.env, ...env },
		timeout: 10_000,
	}).trim();
}

/** Parse the first (or only) line of pi JSONL output. */
function parseOutput(raw: string): any {
	return JSON.parse(raw.split("\n")[0]);
}

/** Extract the assistant text from a standard message_end event. */
function textOf(raw: string): string {
	const parsed = parseOutput(raw);
	return parsed.message.content[0].text;
}

describe("createMockPi", () => {
	let mockPi: MockPi;

	beforeEach(() => {
		mockPi = createMockPi();
		mockPi.install();
	});

	afterEach(() => {
		mockPi.uninstall();
	});

	// ── Installation ────────────────────────────────────────

	it("creates a pi shim in the temp dir", () => {
		const shimName = process.platform === "win32" ? "pi.cmd" : "pi";
		expect(fs.existsSync(path.join(mockPi.dir, shimName))).toBe(true);
	});

	it("prepends temp dir to PATH", () => {
		expect(process.env.PATH!.startsWith(mockPi.dir)).toBe(true);
	});

	it("install() is idempotent", () => {
		const pathBefore = process.env.PATH;
		mockPi.install(); // second call
		expect(process.env.PATH).toBe(pathBefore);
	});

	it("uninstall() restores PATH", () => {
		const pathBefore = process.env.PATH;
		mockPi.uninstall();
		expect(process.env.PATH).not.toContain(mockPi.dir);
		// Re-create for afterEach
		mockPi = createMockPi();
		mockPi.install();
		// Verify new PATH is different from what uninstall restored
		expect(process.env.PATH).not.toBe(pathBefore);
	});

	it("uninstall() is idempotent", () => {
		mockPi.uninstall();
		mockPi.uninstall(); // no throw
		// Re-create for afterEach
		mockPi = createMockPi();
		mockPi.install();
	});

	// ── Default behavior (no queue) ─────────────────────────

	it("echoes the task by default", () => {
		const text = textOf(runPi('"hello world"'));
		expect(text).toContain("hello world");
	});

	it("returns a valid message_end JSONL event", () => {
		const parsed = parseOutput(runPi('"test"'));
		expect(parsed.type).toBe("message_end");
		expect(parsed.message.role).toBe("assistant");
		expect(parsed.message.model).toBe("mock/test-model");
		expect(parsed.message.usage).toBeDefined();
	});

	// ── Queued responses ────────────────────────────────────

	it("onCall() returns a custom text response", () => {
		mockPi.onCall({ output: "custom response" });
		expect(textOf(runPi('"test"'))).toBe("custom response");
	});

	it("sequential calls consume the queue in order", () => {
		mockPi.onCall({ output: "first" });
		mockPi.onCall({ output: "second" });
		mockPi.onCall({ output: "third" });

		expect(textOf(runPi('"1"'))).toBe("first");
		expect(textOf(runPi('"2"'))).toBe("second");
		expect(textOf(runPi('"3"'))).toBe("third");
	});

	it("last response repeats when queue is exhausted", () => {
		mockPi.onCall({ output: "only one" });

		expect(textOf(runPi('"1"'))).toBe("only one");
		expect(textOf(runPi('"2"'))).toBe("only one"); // repeat
		expect(textOf(runPi('"3"'))).toBe("only one"); // still repeating
	});

	it("callCount() tracks invocations", () => {
		expect(mockPi.callCount()).toBe(0);
		mockPi.onCall({ output: "a" });

		runPi('"1"');
		expect(mockPi.callCount()).toBe(1);

		runPi('"2"');
		expect(mockPi.callCount()).toBe(2);
	});

	// ── Exit code ───────────────────────────────────────────

	it("exitCode: 0 succeeds", () => {
		mockPi.onCall({ output: "ok", exitCode: 0 });
		expect(textOf(runPi('"test"'))).toBe("ok");
	});

	it("exitCode: 1 throws on execSync", () => {
		mockPi.onCall({ output: "fail", exitCode: 1 });
		expect(() => runPi('"test"')).toThrow();
	});

	// ── Stderr ──────────────────────────────────────────────

	it("stderr output is written to stderr", () => {
		mockPi.onCall({ output: "ok", stderr: "warning message" });

		const result = execSync('pi "test"', {
			encoding: "utf-8",
			timeout: 10_000,
		});
		// stdout still has the output
		expect(textOf(result.trim())).toBe("ok");
		// stderr was written (can't easily capture in execSync without stdio config,
		// but the process didn't crash — that's the key assertion)
	});

	// ── JSONL mode ──────────────────────────────────────────

	it("jsonl mode outputs raw events", () => {
		const events = [
			{ type: "tool_execution_start", toolName: "bash" },
			{
				type: "message_end",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "done" }],
				},
			},
		];
		mockPi.onCall({ jsonl: events });

		const raw = runPi('"test"');
		const lines = raw.split("\n");
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[0]).type).toBe("tool_execution_start");
		expect(JSON.parse(lines[1]).type).toBe("message_end");
	});

	// ── File writing ────────────────────────────────────────

	it("writeFiles creates files before exiting", () => {
		const outFile = path.join(mockPi.dir, "test-output.txt");
		mockPi.onCall({
			output: "done",
			writeFiles: { [outFile]: "file content here" },
		});

		runPi('"test"');
		expect(fs.existsSync(outFile)).toBe(true);
		expect(fs.readFileSync(outFile, "utf-8")).toBe("file content here");
	});

	it("writeFiles creates nested directories", () => {
		const outFile = path.join(mockPi.dir, "deep", "nested", "file.md");
		mockPi.onCall({
			output: "done",
			writeFiles: { [outFile]: "# Result\nDone." },
		});

		runPi('"test"');
		expect(fs.readFileSync(outFile, "utf-8")).toBe("# Result\nDone.");
	});

	// ── Reset ───────────────────────────────────────────────

	it("reset() clears the queue and counter", () => {
		mockPi.onCall({ output: "queued" });
		runPi('"consume"');

		mockPi.reset();

		expect(mockPi.callCount()).toBe(0);
		// Should get default echo behavior, not "queued"
		const text = textOf(runPi('"hello after reset"'));
		expect(text).toContain("hello after reset");
	});

	it("can queue new responses after reset", () => {
		mockPi.onCall({ output: "old" });
		mockPi.reset();
		mockPi.onCall({ output: "new" });

		expect(textOf(runPi('"test"'))).toBe("new");
	});

	// ── CLI argument handling ───────────────────────────────

	it("handles --session-dir flag", () => {
		const sessionDir = path.join(mockPi.dir, "sessions");
		mockPi.onCall({ output: "with session" });

		runPi(`--session-dir "${sessionDir}" "test"`);

		expect(fs.existsSync(sessionDir)).toBe(true);
		const files = fs.readdirSync(sessionDir);
		expect(files.some((f) => f.startsWith("session-"))).toBe(true);
	});

	it("handles @file task input", () => {
		const taskFile = path.join(mockPi.dir, "task.txt");
		fs.writeFileSync(taskFile, "task from file");

		const text = textOf(runPi(`@${taskFile}`));
		expect(text).toContain("task from file");
	});

	it("ignores pi flags like -p and --mode", () => {
		mockPi.onCall({ output: "ok" });
		expect(textOf(runPi('--mode json -p "test"'))).toBe("ok");
	});

	// ── Delay ───────────────────────────────────────────────

	it("delay works without hanging", () => {
		mockPi.onCall({ output: "delayed", delay: 50 });

		const start = Date.now();
		expect(textOf(runPi('"test"'))).toBe("delayed");
		const elapsed = Date.now() - start;
		expect(elapsed).toBeGreaterThanOrEqual(40); // allow some timing slack
	});

	// ── Validation ──────────────────────────────────────────

	it("onCall() rejects unknown keys (catches typos)", () => {
		expect(() => {
			mockPi.onCall({ ouptut: "typo" } as any);
		}).toThrow(/Unknown MockPiCall key.*ouptut/);
	});

	it("onCall() rejects multiple unknown keys", () => {
		expect(() => {
			mockPi.onCall({ ouptut: "a", exitCod: 1 } as any);
		}).toThrow(/ouptut|exitCod/);
	});

	it("onCall() accepts all valid keys together", () => {
		expect(() => {
			mockPi.onCall({
				output: "ok",
				exitCode: 0,
				stderr: "warn",
				delay: 10,
				jsonl: [{ type: "test" }],
				writeFiles: { "/tmp/test.txt": "content" },
			});
		}).not.toThrow();
	});

	it("onCall() accepts empty object", () => {
		expect(() => {
			mockPi.onCall({});
		}).not.toThrow();
	});

	// ── Multiple features in one call ───────────────────────

	it("combines output, stderr, writeFiles, and exitCode", () => {
		const outFile = path.join(mockPi.dir, "combined.txt");
		mockPi.onCall({
			output: "combined",
			stderr: "some warning",
			writeFiles: { [outFile]: "written" },
			exitCode: 0,
		});

		const text = textOf(runPi('"test"'));
		expect(text).toBe("combined");
		expect(fs.readFileSync(outFile, "utf-8")).toBe("written");
	});
});
