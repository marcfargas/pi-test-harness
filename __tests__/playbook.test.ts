import { describe, it, expect } from "vitest";
import { createPlaybookStreamFn, when, calls, says, call, say } from "../src/playbook.js";
import type { Model, Context } from "@mariozechner/pi-ai";

function mockModel(): Model<any> {
	return {
		id: "test",
		name: "test",
		api: "openai-responses",
		provider: "test",
		baseUrl: "https://test.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 2048,
	};
}

function mockContext(): Context {
	return {
		systemPrompt: "test",
		messages: [],
		tools: [],
	};
}

describe("when/calls/says DSL", () => {
	it("when() creates a Turn with prompt and actions", () => {
		const turn = when("hello", [says("hi")]);
		expect(turn.prompt).toBe("hello");
		expect(turn.actions).toHaveLength(1);
		expect(turn.actions[0].type).toBe("say");
		expect(turn.actions[0].text).toBe("hi");
	});

	it("calls() creates a call action with static params", () => {
		const c = calls("bash", { command: "ls" });
		expect(c.action.type).toBe("call");
		expect(c.action.toolName).toBe("bash");
		expect(c.action.params).toEqual({ command: "ls" });
	});

	it("calls() supports late-bound params", () => {
		let value = "initial";
		const c = calls("tool", () => ({ id: value }));
		// Params are a function, not resolved yet
		expect(typeof c.action.params).toBe("function");
		value = "changed";
		const resolved = (c.action.params as () => Record<string, unknown>)();
		expect(resolved).toEqual({ id: "changed" });
	});

	it("calls().then() chains a callback", () => {
		const captured: unknown[] = [];
		const c = calls("tool", {}).then((result) => {
			captured.push(result);
		});
		expect(c.action.thenCallback).toBeDefined();
	});

	it("when() with mixed calls/says actions", () => {
		const turn = when("do things", [
			calls("plan_mode", { enable: true }),
			calls("plan_propose", { title: "test" }),
			says("done"),
		]);
		expect(turn.actions).toHaveLength(3);
		expect(turn.actions[0].type).toBe("call");
		expect(turn.actions[0].toolName).toBe("plan_mode");
		expect(turn.actions[1].type).toBe("call");
		expect(turn.actions[1].toolName).toBe("plan_propose");
		expect(turn.actions[2].type).toBe("say");
	});

	it("deprecated call/say aliases still work", () => {
		const turn = when("legacy", [
			call("bash", { command: "ls" }),
			say("done"),
		]);
		expect(turn.actions).toHaveLength(2);
		expect(turn.actions[0].type).toBe("call");
		expect(turn.actions[1].type).toBe("say");
	});
});

describe("PlaybookStreamFn", () => {
	it("dequeues actions in order", async () => {
		const turns = [
			when("test", [
				calls("bash", { command: "ls" }),
				says("here are the files"),
			]),
		];
		const { streamFn, state } = createPlaybookStreamFn(turns);
		const model = mockModel();
		const ctx = mockContext();

		// First call: should return tool call
		const stream1 = streamFn(model, ctx);
		const result1 = await stream1.result();
		expect(result1.stopReason).toBe("toolUse");
		expect(result1.content[0].type).toBe("toolCall");
		expect((result1.content[0] as any).name).toBe("bash");
		expect(state.consumed).toBe(1);
		expect(state.remaining).toBe(1);

		// Second call: should return text
		const stream2 = streamFn(model, ctx);
		const result2 = await stream2.result();
		expect(result2.stopReason).toBe("stop");
		expect(result2.content[0].type).toBe("text");
		expect((result2.content[0] as any).text).toBe("here are the files");
		expect(state.consumed).toBe(2);
		expect(state.remaining).toBe(0);
	});

	it("returns exhausted message when playbook is done", async () => {
		const turns = [when("test", [says("only one")])];
		const { streamFn } = createPlaybookStreamFn(turns);
		const model = mockModel();
		const ctx = mockContext();

		// Consume the only action
		await streamFn(model, ctx).result();

		// Extra call — should get exhausted message
		const stream = streamFn(model, ctx);
		const result = await stream.result();
		expect(result.stopReason).toBe("stop");
		expect((result.content[0] as any).text).toContain("PLAYBOOK EXHAUSTED");
	});

	it("resolves late-bound params at dequeue time", async () => {
		let dynamicId = "unknown";
		const turns = [
			when("test", [
				calls("tool", () => ({ id: dynamicId })),
				says("done"),
			]),
		];
		const { streamFn } = createPlaybookStreamFn(turns);
		const model = mockModel();
		const ctx = mockContext();

		// Change the value before dequeuing
		dynamicId = "resolved-123";

		const stream = streamFn(model, ctx);
		const result = await stream.result();
		const toolCall = result.content[0] as any;
		expect(toolCall.arguments).toEqual({ id: "resolved-123" });
	});

	it("flattens multiple turns into single queue", async () => {
		const turns = [
			when("first", [says("response 1")]),
			when("second", [says("response 2")]),
		];
		const { streamFn, state } = createPlaybookStreamFn(turns);
		const model = mockModel();
		const ctx = mockContext();

		await streamFn(model, ctx).result();
		expect(state.consumed).toBe(1);

		await streamFn(model, ctx).result();
		expect(state.consumed).toBe(2);
		expect(state.remaining).toBe(0);
	});
});
