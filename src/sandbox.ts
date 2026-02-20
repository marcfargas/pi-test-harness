/**
 * Sandbox install verification — verifies npm packages work when installed clean.
 *
 * 1. npm pack → tarball
 * 2. Install in temp dir
 * 3. DefaultResourceLoader discovers extensions/skills
 * 4. Verify resources load without errors
 * 5. Optional smoke test
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { DefaultResourceLoader, SettingsManager } from "@mariozechner/pi-coding-agent";
import type { SandboxOptions, SandboxResult } from "./types.js";
import { createTestSession } from "./session.js";

export async function verifySandboxInstall(options: SandboxOptions): Promise<SandboxResult> {
	const packageDir = path.resolve(options.packageDir);

	// Validate package directory
	const pkgJsonPath = path.join(packageDir, "package.json");
	if (!fs.existsSync(pkgJsonPath)) {
		throw new Error(`No package.json found at ${pkgJsonPath}`);
	}
	const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
	const pkgName = pkgJson.name;

	// Create sandbox temp dir
	const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sandbox-"));

	try {
		// 1. npm pack → tarball
		const packOutput = execSync("npm pack --pack-destination .", {
			cwd: packageDir,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();

		// The output is the tarball filename
		const tarballName = packOutput.split("\n").pop()!.trim();
		const tarballSrc = path.join(packageDir, tarballName);
		const tarballDest = path.join(sandboxDir, tarballName);
		try {
			fs.copyFileSync(tarballSrc, tarballDest);
		} finally {
			// Always clean up tarball from source (even if copy fails)
			try { if (fs.existsSync(tarballSrc)) fs.unlinkSync(tarballSrc); } catch { /* best-effort */ }
		}

		// 2. Create minimal package.json in sandbox
		const sandboxPkg = {
			name: "pi-test-sandbox",
			private: true,
			type: "module",
			dependencies: {
				[pkgName]: `file:./${tarballName}`,
			},
		};
		fs.writeFileSync(
			path.join(sandboxDir, "package.json"),
			JSON.stringify(sandboxPkg, null, 2),
		);

		// 3. npm install
		execSync("npm install --ignore-scripts=false", {
			cwd: sandboxDir,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});

		// 4. Find the installed package and use DefaultResourceLoader
		const installedPkgDir = path.join(sandboxDir, "node_modules", ...pkgName.split("/"));

		if (!fs.existsSync(installedPkgDir)) {
			throw new Error(`Package not found after install: ${installedPkgDir}`);
		}

		// Read installed package.json for pi manifest
		const installedPkgJson = JSON.parse(
			fs.readFileSync(path.join(installedPkgDir, "package.json"), "utf-8"),
		);
		const piManifest = installedPkgJson.pi;

		// Resolve extension paths from the installed package
		const extensionPaths: string[] = [];
		if (piManifest?.extensions) {
			for (const ext of piManifest.extensions) {
				const resolved = path.resolve(installedPkgDir, ext);
				if (fs.existsSync(resolved)) {
					extensionPaths.push(resolved);
				} else {
					// Try as glob/directory
					const dir = path.resolve(installedPkgDir, ext);
					if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
						const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts") || f.endsWith(".js"));
						extensionPaths.push(...files.map((f) => path.join(dir, f)));
					}
				}
			}
		}

		// Load extensions via DefaultResourceLoader
		const settingsManager = SettingsManager.inMemory();
		const loader = new DefaultResourceLoader({
			cwd: sandboxDir,
			agentDir: sandboxDir,
			settingsManager,
			additionalExtensionPaths: extensionPaths,
		});
		await loader.reload();

		const extensionsResult = loader.getExtensions();
		const skillsResult = loader.getSkills();

		// Collect tool names from loaded extensions
		const toolNames: string[] = [];
		for (const ext of extensionsResult.extensions) {
			for (const [name] of (ext as any).tools ?? new Map()) {
				toolNames.push(name);
			}
		}

		const result: SandboxResult = {
			loaded: {
				extensions: extensionsResult.extensions.length,
				extensionErrors: extensionsResult.errors.map((e) => `${e.path}: ${e.error}`),
				tools: toolNames,
				skills: skillsResult.skills.length,
			},
		};

		// 5. Verify expectations
		if (options.expect) {
			if (options.expect.extensions !== undefined) {
				if (extensionsResult.extensions.length !== options.expect.extensions) {
					throw new Error(
						`Expected ${options.expect.extensions} extension(s), got ${extensionsResult.extensions.length}`,
					);
				}
			}
			if (options.expect.tools) {
				for (const expectedTool of options.expect.tools) {
					if (!toolNames.includes(expectedTool)) {
						throw new Error(
							`Expected tool "${expectedTool}" not found. Available: ${toolNames.join(", ")}`,
						);
					}
				}
			}
			if (options.expect.skills !== undefined) {
				if (skillsResult.skills.length !== options.expect.skills) {
					throw new Error(
						`Expected ${options.expect.skills} skill(s), got ${skillsResult.skills.length}`,
					);
				}
			}
		}

		// 6. Optional smoke test
		if (options.smoke) {
			const t = await createTestSession({
				extensions: extensionPaths,
				cwd: sandboxDir,
				mockTools: options.smoke.mockTools,
			});

			await t.run(...options.smoke.script);
			result.smoke = { events: t.events };
			t.dispose();
		}

		return result;
	} finally {
		// Clean up sandbox (retry for Windows EBUSY on open handles)
		if (fs.existsSync(sandboxDir)) {
			try {
				fs.rmSync(sandboxDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
			} catch {
				// Best-effort cleanup — temp dir will be cleaned by OS
			}
		}
	}
}
