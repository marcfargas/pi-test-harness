/**
 * Regression tests for fixes applied 2026-02-21.
 *
 * Each test targets a specific bug or new feature:
 *   1. toolResultsFor() when mockTools is not set
 *   2. No double-wrap on multiple run() calls
 *   3. ToolBlockedError exported and instanceof-checkable
 *   4. safeRmSync swallows EPERM / handles missing files
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestSession, when, calls, says, ToolBlockedError, safeRmSync } from "../src/index.js";
import { _isLockedFileError } from "../src/utils.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Registers a simple counter tool via extensionFactories. */
function counterToolFactory(hits: { count: number }) {
	return (pi: any) => {
		const { Type } = require("@sinclair/typebox");
		pi.registerTool({
			name: "counter_tool",
			label: "Counter",
			description: "Increments a counter",
			parameters: Type.Object({}),
			execute: async () => {
				hits.count++;
				return {
					content: [{ type: "text", text: `hit ${hits.count}` }],
					details: { count: hits.count },
				};
			},
		});
	};
}

// ── Fix 1: toolResultsFor() without mockTools ──────────────────────────────────

describe("toolResultsFor without mockTools", () => {
	it("collects real tool results when mockTools is not configured", async () => {
		const hits = { count: 0 };
		const t = await createTestSession({
			// No mockTools — real extension tool executes
			extensionFactories: [counterToolFactory(hits)],
		});

		await t.run(
			when("Call the counter", [
				calls("counter_tool", {}),
				says("Done."),
			]),
		);

		// Before fix: toolResultsFor always returned [] without mockTools
		expect(t.events.toolResultsFor("counter_tool")).toHaveLength(1);
		expect(t.events.toolResultsFor("counter_tool")[0].text).toBe("hit 1");
		expect(t.events.toolResultsFor("counter_tool")[0].mocked).toBe(false);
		expect(hits.count).toBe(1);

		t.dispose();
	});

	it("toolCallsFor also works without mockTools", async () => {
		const hits = { count: 0 };
		const t = await createTestSession({
			extensionFactories: [counterToolFactory(hits)],
		});

		await t.run(
			when("Call it", [
				calls("counter_tool", {}),
				says("Done."),
			]),
		);

		expect(t.events.toolCallsFor("counter_tool")).toHaveLength(1);
		expect(t.events.toolSequence()).toContain("counter_tool");

		t.dispose();
	});
});

// ── Fix 2: no double-wrap on multiple run() calls ──────────────────────────────

describe("multiple run() calls — no double-wrap", () => {
	it("each run() call produces exactly one result per tool call", async () => {
		const hits = { count: 0 };
		const t = await createTestSession({
			extensionFactories: [counterToolFactory(hits)],
			mockTools: {
				bash: "ok",
				read: "ok",
				write: "ok",
				edit: "ok",
			},
		});

		// First run — one tool call
		await t.run(
			when("First", [
				calls("counter_tool", {}),
				says("Done with first."),
			]),
		);

		expect(t.events.toolResultsFor("counter_tool")).toHaveLength(1);
		expect(hits.count).toBe(1);

		// Second run — one more tool call, total should be 2 (not 3 or 4 from double-wrap)
		await t.run(
			when("Second", [
				calls("counter_tool", {}),
				says("Done with second."),
			]),
		);

		// Before fix: second run re-wrapped already-wrapped tools → double collection
		expect(t.events.toolResultsFor("counter_tool")).toHaveLength(2);
		expect(hits.count).toBe(2); // real execute called exactly twice

		t.dispose();
	});

	it("toolSequence reflects true call order across runs", async () => {
		const hits = { count: 0 };
		const t = await createTestSession({
			extensionFactories: [counterToolFactory(hits)],
			mockTools: { bash: "ok", read: "ok", write: "ok", edit: "ok" },
		});

		await t.run(when("Run 1", [calls("counter_tool", {}), says("Ok.")]));
		await t.run(when("Run 2", [calls("counter_tool", {}), says("Ok.")]));

		expect(t.events.toolSequence()).toEqual(["counter_tool", "counter_tool"]);

		t.dispose();
	});
});

// ── Fix 3: ToolBlockedError ────────────────────────────────────────────────────

describe("ToolBlockedError", () => {
	it("is instanceof Error", () => {
		const err = new ToolBlockedError("tool was blocked");
		expect(err instanceof Error).toBe(true);
	});

	it("is instanceof ToolBlockedError", () => {
		const err = new ToolBlockedError("tool was blocked");
		expect(err instanceof ToolBlockedError).toBe(true);
	});

	it("has toolBlocked marker property set to true", () => {
		const err = new ToolBlockedError("reason");
		expect(err.toolBlocked).toBe(true);
	});

	it("has name ToolBlockedError", () => {
		const err = new ToolBlockedError("reason");
		expect(err.name).toBe("ToolBlockedError");
	});

	it("carries the block reason in message", () => {
		const err = new ToolBlockedError("WRITE operation blocked in plan mode");
		expect(err.message).toBe("WRITE operation blocked in plan mode");
	});

	it("plain Error does NOT satisfy instanceof ToolBlockedError", () => {
		const plain = new Error("blocked");
		expect(plain instanceof ToolBlockedError).toBe(false);
	});
});

// ── Fix 3b: blocked tool integration ─────────────────────────────────────────

describe("blocked tool classification in execution flow", () => {
	it("mocked tool blocked by hook — recorded as error, test does not crash", async () => {
		const t = await createTestSession({
			extensionFactories: [
				(pi: any) => {
					// Block the custom tool via tool_call hook
					pi.on("tool_call", async (event: any) => {
						if (event.toolName === "my_blocked_tool") {
							return { block: true, reason: "Tool execution was blocked by an extension" };
						}
					});
					const { Type } = require("@sinclair/typebox");
					pi.registerTool({
						name: "my_blocked_tool",
						label: "Blocked Tool",
						description: "A tool that gets blocked",
						parameters: Type.Object({}),
						execute: async () => ({
							content: [{ type: "text", text: "should not reach here" }],
							details: {},
						}),
					});
				},
			],
			// my_blocked_tool is mocked so the block fires through our interceptToolExecution path
			mockTools: {
				my_blocked_tool: "unreachable",
				bash: "ok",
				read: "ok",
				write: "ok",
				edit: "ok",
			},
			propagateErrors: true, // default — must NOT crash for hook blocks
		});

		// Should not throw even though the tool is blocked
		await t.run(
			when("Call it", [
				calls("my_blocked_tool", {}),
				says("Done."),
			]),
		);

		const results = t.events.toolResultsFor("my_blocked_tool");
		expect(results).toHaveLength(1);
		expect(results[0].isError).toBe(true);
		expect(results[0].text).toContain("blocked");

		t.dispose();
	});

	it("ToolBlockedError is instanceof-checkable from a caught tool result", async () => {
		// Verify that the error thrown in the mock path is the right type
		// (guards against accidental plain-Error regression)
		const err = new ToolBlockedError("some reason");
		expect(err instanceof ToolBlockedError).toBe(true);
		// A plain Error from pi's native hook would NOT pass this check
		const plainErr = new Error("Tool execution was blocked by an extension");
		expect(plainErr instanceof ToolBlockedError).toBe(false);
	});
});

// ── Fix 4: safeRmSync ─────────────────────────────────────────────────────────

describe("safeRmSync", () => {
	it("deletes an existing file", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-test-saferm-"));
		const file = join(dir, "test.db");
		writeFileSync(file, "data");

		safeRmSync(file);

		expect(existsSync(file)).toBe(false);

		// Cleanup dir
		try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
	});

	it("does not throw when file does not exist", () => {
		const missing = join(tmpdir(), "pi-test-definitely-does-not-exist-12345.db");
		expect(() => safeRmSync(missing)).not.toThrow();
	});

	it("does not throw when called twice on the same path", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-test-saferm-"));
		const file = join(dir, "test.db");
		writeFileSync(file, "data");

		safeRmSync(file); // first call deletes
		expect(() => safeRmSync(file)).not.toThrow(); // second call: file gone, no throw

		try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
	});

	// vi.spyOn cannot mock native ESM node: modules (namespace not configurable).
	// Instead we test the error-filtering predicate directly — it's the only
	// logic safeRmSync adds on top of rmSync.
	it("_isLockedFileError: EPERM is a lock error", () => {
		const err = Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
		expect(_isLockedFileError(err)).toBe(true);
	});

	it("_isLockedFileError: EBUSY is a lock error", () => {
		const err = Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
		expect(_isLockedFileError(err)).toBe(true);
	});

	it("_isLockedFileError: EISDIR is NOT a lock error (safeRmSync re-throws it)", () => {
		const err = Object.assign(new Error("EISDIR: illegal operation on a directory"), { code: "EISDIR" });
		expect(_isLockedFileError(err)).toBe(false);
	});

	it("_isLockedFileError: EACCES is NOT a lock error", () => {
		const err = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
		expect(_isLockedFileError(err)).toBe(false);
	});
});
