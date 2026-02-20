import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { verifySandboxInstall, when, calls, says } from "../src/index.js";

const DUMMY_EXTENSION = path.resolve(__dirname, "fixtures/dummy-extension");

describe("verifySandboxInstall", () => {
	it("installs and loads a dummy extension package", async () => {
		const result = await verifySandboxInstall({
			packageDir: DUMMY_EXTENSION,
			expect: {
				extensions: 1,
				tools: ["dummy_tool"],
			},
		});

		expect(result.loaded.extensionErrors).toEqual([]);
		expect(result.loaded.extensions).toBe(1);
		expect(result.loaded.tools).toContain("dummy_tool");
	}, 30_000); // npm pack + install can be slow

	it("detects missing expected tools", async () => {
		await expect(
			verifySandboxInstall({
				packageDir: DUMMY_EXTENSION,
				expect: {
					extensions: 1,
					tools: ["nonexistent_tool"],
				},
			}),
		).rejects.toThrow(/Expected tool "nonexistent_tool" not found/);
	}, 30_000);

	it("detects wrong extension count", async () => {
		await expect(
			verifySandboxInstall({
				packageDir: DUMMY_EXTENSION,
				expect: {
					extensions: 5, // wrong
				},
			}),
		).rejects.toThrow(/Expected 5 extension\(s\), got/);
	}, 30_000);

	it("runs a smoke test in the sandbox", async () => {
		const result = await verifySandboxInstall({
			packageDir: DUMMY_EXTENSION,
			expect: {
				extensions: 1,
				tools: ["dummy_tool"],
			},
			smoke: {
				mockTools: {
					bash: "ok",
					read: "contents",
					write: "written",
					edit: "edited",
				},
				script: [
					when("Test the dummy tool", [
						calls("dummy_tool", { value: "hello" }),
						says("Tool works."),
					]),
				],
			},
		});

		expect(result.smoke).toBeDefined();
		expect(result.smoke!.events.toolResultsFor("dummy_tool")).toHaveLength(1);
		expect(result.smoke!.events.toolResultsFor("dummy_tool")[0].text).toBe("echo: hello");
	}, 60_000); // smoke test includes full session setup
});
