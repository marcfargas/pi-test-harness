import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

function commandSpec(command, args) {
	if (command !== "npm") return { command, args };
	const npmCli = process.env.npm_execpath;
	if (npmCli) return { command: process.execPath, args: [npmCli, ...args] };
	return { command: process.platform === "win32" ? "npm.cmd" : "npm", args };
}

function run(command, args, options = {}) {
	const spec = commandSpec(command, args);
	execFileSync(spec.command, spec.args, {
		stdio: "inherit",
		...options,
	});
}

const root = resolve(import.meta.dirname, "..");
const packSpec = commandSpec("npm", ["pack", "--json"]);
const packJson = execFileSync(packSpec.command, packSpec.args, {
	cwd: root,
	encoding: "utf8",
});
const [{ filename }] = JSON.parse(packJson);
const tarball = join(root, filename);
const consumerDir = mkdtempSync(join(tmpdir(), "pi-test-harness-consumer-"));

try {
	writeFileSync(join(consumerDir, "package.json"), JSON.stringify({ type: "module", private: true }, null, 2));
	run("npm", [
		"install",
		"--silent",
		tarball,
		"@earendil-works/pi-agent-core@^0.75.4",
		"@earendil-works/pi-ai@^0.75.4",
		"@earendil-works/pi-coding-agent@^0.75.4",
	], { cwd: consumerDir });

	writeFileSync(join(consumerDir, "smoke.mjs"), `
import {
  createMockPi,
  createTestSession,
  when,
  calls,
  says,
} from "@marcfargas/pi-test-harness";

if (typeof createMockPi !== "function") throw new Error("createMockPi missing");
if (typeof createTestSession !== "function") throw new Error("createTestSession missing");
if (typeof when !== "function" || typeof calls !== "function" || typeof says !== "function") {
  throw new Error("playbook DSL exports missing");
}
console.log("consumer import smoke ok");
`);
	run("node", ["smoke.mjs"], { cwd: consumerDir });
} finally {
	rmSync(tarball, { force: true });
	rmSync(consumerDir, { recursive: true, force: true });
}
