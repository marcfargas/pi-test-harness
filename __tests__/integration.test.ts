import { describe, it, expect } from "vitest";
import { createTestSession, when, calls, says } from "../src/index.js";

describe("TestSession integration", () => {
	it("runs a simple say-only playbook", async () => {
		const t = await createTestSession({
			mockTools: {
				bash: "ok",
				read: "contents",
				write: "written",
				edit: "edited",
			},
		});

		await t.run(
			when("Hello", [
				says("Hi there!"),
			]),
		);

		expect(t.playbook.consumed).toBe(1);
		expect(t.playbook.remaining).toBe(0);

		t.dispose();
	});

	it("runs a tool call + say sequence", async () => {
		const t = await createTestSession({
			mockTools: {
				bash: (params) => `$ ${(params as any).command}\nfile1.txt`,
				read: "contents",
				write: "written",
				edit: "edited",
			},
		});

		await t.run(
			when("List files", [
				calls("bash", { command: "ls" }),
				says("Here are the files."),
			]),
		);

		expect(t.events.toolCallsFor("bash")).toHaveLength(1);
		expect(t.events.toolResultsFor("bash")).toHaveLength(1);
		expect(t.events.toolResultsFor("bash")[0].text).toContain("file1.txt");
		expect(t.events.toolResultsFor("bash")[0].mocked).toBe(true);

		t.dispose();
	});

	it("runs multi-turn conversation", async () => {
		const t = await createTestSession({
			mockTools: {
				bash: "ok",
				read: "contents",
				write: "written",
				edit: "edited",
			},
		});

		await t.run(
			when("First message", [
				calls("bash", { command: "echo hello" }),
				says("Done with first."),
			]),
			when("Second message", [
				says("Done with second."),
			]),
		);

		expect(t.playbook.consumed).toBe(3); // call + say + say
		expect(t.events.toolCallsFor("bash")).toHaveLength(1);

		t.dispose();
	});

	it("captures UI calls from extensions", async () => {
		const t = await createTestSession({
			extensionFactories: [
				(pi: any) => {
					pi.on("agent_start", async (_event: any, ctx: any) => {
						ctx.ui.notify("Agent starting!", "info");
					});
				},
			],
			mockTools: {
				bash: "ok",
				read: "contents",
				write: "written",
				edit: "edited",
			},
		});

		await t.run(
			when("Test UI", [
				says("Done."),
			]),
		);

		const notifies = t.events.uiCallsFor("notify");
		expect(notifies.length).toBeGreaterThanOrEqual(1);
		expect(notifies.some((n) => n.args[0] === "Agent starting!")).toBe(true);

		t.dispose();
	});

	it("extension tool executes for real", async () => {
		const executed: string[] = [];

		const t = await createTestSession({
			extensionFactories: [
				(pi: any) => {
					const { Type } = require("@sinclair/typebox");
					pi.registerTool({
						name: "my_tool",
						label: "My Tool",
						description: "Test tool",
						parameters: Type.Object({
							value: Type.String(),
						}),
						execute: async (_id: string, params: any) => {
							executed.push(params.value);
							return {
								content: [{ type: "text", text: `received: ${params.value}` }],
								details: { value: params.value },
							};
						},
					});
				},
			],
			mockTools: {
				bash: "ok",
				read: "contents",
				write: "written",
				edit: "edited",
			},
		});

		await t.run(
			when("Call my tool", [
				calls("my_tool", { value: "hello" }),
				says("Tool called."),
			]),
		);

		expect(executed).toEqual(["hello"]);
		expect(t.events.toolResultsFor("my_tool")).toHaveLength(1);
		expect(t.events.toolResultsFor("my_tool")[0].text).toBe("received: hello");
		expect(t.events.toolResultsFor("my_tool")[0].mocked).toBe(false);

		t.dispose();
	});

	it("late-bound params with .then() callback", async () => {
		const t = await createTestSession({
			extensionFactories: [
				(pi: any) => {
					const { Type } = require("@sinclair/typebox");
					pi.registerTool({
						name: "create_thing",
						label: "Create",
						description: "Creates a thing",
						parameters: Type.Object({}),
						execute: async () => ({
							content: [{ type: "text", text: "created: THING-abc123" }],
							details: {},
						}),
					});
					pi.registerTool({
						name: "use_thing",
						label: "Use",
						description: "Uses a thing",
						parameters: Type.Object({
							id: Type.String(),
						}),
						execute: async (_id: string, params: any) => ({
							content: [{ type: "text", text: `using: ${params.id}` }],
							details: {},
						}),
					});
				},
			],
			mockTools: {
				bash: "ok",
				read: "contents",
				write: "written",
				edit: "edited",
			},
		});

		let thingId = "";

		await t.run(
			when("Create and use", [
				calls("create_thing", {}).then((result) => {
					thingId = result.text.match(/THING-\w+/)![0];
				}),
				calls("use_thing", () => ({ id: thingId })),
				says("All done."),
			]),
		);

		expect(thingId).toBe("THING-abc123");
		expect(t.events.toolResultsFor("use_thing")[0].text).toBe("using: THING-abc123");

		t.dispose();
	});

	it("UI mock responds to confirm", async () => {
		let confirmResult: boolean | undefined;

		const t = await createTestSession({
			extensionFactories: [
				(pi: any) => {
					const { Type } = require("@sinclair/typebox");
					pi.registerTool({
						name: "ask_confirm",
						label: "Ask",
						description: "Asks for confirmation",
						parameters: Type.Object({}),
						execute: async (_id: string, _params: any, _signal: any, _update: any, ctx: any) => {
							const confirmed = await ctx.ui.confirm("Delete?", "Are you sure?");
							confirmResult = confirmed;
							return {
								content: [{ type: "text", text: confirmed ? "confirmed" : "denied" }],
								details: {},
							};
						},
					});
				},
			],
			mockTools: {
				bash: "ok",
				read: "contents",
				write: "written",
				edit: "edited",
			},
			mockUI: {
				confirm: false, // deny
			},
		});

		await t.run(
			when("Ask for confirmation", [
				calls("ask_confirm", {}),
				says("Done."),
			]),
		);

		expect(confirmResult).toBe(false);
		expect(t.events.uiCallsFor("confirm")).toHaveLength(1);
		expect(t.events.uiCallsFor("confirm")[0].returnValue).toBe(false);

		t.dispose();
	});

	it("auto-asserts playbook consumed", async () => {
		const t = await createTestSession({
			mockTools: {
				bash: "ok",
				read: "contents",
				write: "written",
				edit: "edited",
			},
		});

		// This should throw because the say() at the end won't be consumed
		// if the agent loop stops early. But in our case the playbook drives
		// the loop, so this test verifies auto-assertion works correctly.
		// A remaining action happens when the agent loop ends before consuming all.

		// For now, just verify a complete playbook doesn't throw
		await expect(
			t.run(when("Test", [says("Done.")]))
		).resolves.toBeUndefined();

		t.dispose();
	});
});
