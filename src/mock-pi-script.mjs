#!/usr/bin/env node
/**
 * Mock pi CLI for integration tests.
 *
 * Reads response queue from MOCK_PI_QUEUE_DIR (set by the shim created by createMockPi).
 * Each invocation consumes the next entry from the queue. When the queue is exhausted,
 * the last entry repeats. If no entries are queued, outputs a default echo response.
 *
 * Queue protocol:
 *   {queueDir}/queue.json  — JSON array of MockPiCall objects
 *   {queueDir}/counter     — integer: current call index (auto-incremented)
 */

import * as fs from "node:fs";
import * as path from "node:path";

// Safety timeout — prevent hanging tests if something goes wrong
const TIMEOUT_MS = 30_000;
setTimeout(() => {
	process.stderr.write("mock-pi-script: timeout after 30s\n");
	process.exit(124);
}, TIMEOUT_MS).unref();

// ---------------------------------------------------------------------------
// Queue directory (set by the shim script)
// ---------------------------------------------------------------------------
const queueDir = process.env.MOCK_PI_QUEUE_DIR;
if (!queueDir) {
	process.stderr.write("mock-pi-script: MOCK_PI_QUEUE_DIR not set\n");
	process.exit(99);
}

// ---------------------------------------------------------------------------
// Parse CLI arguments (matches what pi-subagents passes to pi)
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
let task = "";
let sessionDir = null;

let i = 0;
while (i < args.length) {
	const arg = args[i];

	// Flags with a value — skip the value
	if (
		arg === "--session-dir" ||
		arg === "--mode" ||
		arg === "--models" ||
		arg === "--tools" ||
		arg === "--extension" ||
		arg === "--append-system-prompt"
	) {
		if (arg === "--session-dir") sessionDir = args[i + 1] ?? null;
		i += 2;
		continue;
	}

	// Flags without a value
	if (arg === "-p" || arg === "--no-session" || arg === "--no-extensions") {
		i++;
		continue;
	}

	// @file — read task from file
	if (arg?.startsWith("@")) {
		try {
			task = fs.readFileSync(arg.slice(1), "utf-8");
		} catch {
			task = "(could not read " + arg.slice(1) + ")";
		}
		i++;
		continue;
	}

	// Positional — treat as task text
	if (arg && !arg.startsWith("-")) {
		task = arg;
	}
	i++;
}

// ---------------------------------------------------------------------------
// Read queue and counter
// ---------------------------------------------------------------------------
let queue = [];
const queueFile = path.join(queueDir, "queue.json");
if (fs.existsSync(queueFile)) {
	try {
		queue = JSON.parse(fs.readFileSync(queueFile, "utf-8"));
	} catch {
		// Malformed queue — treat as empty
	}
}

const counterFile = path.join(queueDir, "counter");
let counter = 0;
if (fs.existsSync(counterFile)) {
	try {
		counter = parseInt(fs.readFileSync(counterFile, "utf-8").trim(), 10) || 0;
	} catch {
		// Missing or unreadable — start at 0
	}
}

// Increment counter for next invocation
fs.writeFileSync(counterFile, String(counter + 1));

// Get the current entry (repeat last when exhausted, null if no queue)
const entry =
	queue.length > 0 ? queue[Math.min(counter, queue.length - 1)] : null;

// ---------------------------------------------------------------------------
// Delay
// ---------------------------------------------------------------------------
if (entry?.delay > 0) {
	await new Promise((r) => setTimeout(r, entry.delay));
}

// ---------------------------------------------------------------------------
// Stderr
// ---------------------------------------------------------------------------
if (entry?.stderr) {
	process.stderr.write(entry.stderr + "\n");
}

// ---------------------------------------------------------------------------
// Write files (for chain_dir output simulation)
// ---------------------------------------------------------------------------
if (entry?.writeFiles) {
	for (const [filePath, content] of Object.entries(entry.writeFiles)) {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content);
	}
}

// ---------------------------------------------------------------------------
// JSONL output
// ---------------------------------------------------------------------------
if (entry?.jsonl) {
	for (const event of entry.jsonl) {
		console.log(typeof event === "string" ? event : JSON.stringify(event));
	}
} else {
	const taskClean = task.replace(/^Task:\s*/i, "").slice(0, 500);
	const output = entry?.output ?? "Mock output for: " + taskClean;
	console.log(
		JSON.stringify({
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text: output }],
				model: "mock/test-model",
				usage: {
					input: 100,
					output: 50,
					cacheRead: 0,
					cacheWrite: 0,
					cost: { total: 0.001 },
				},
			},
		}),
	);
}

// ---------------------------------------------------------------------------
// Session file (if requested)
// ---------------------------------------------------------------------------
if (sessionDir) {
	fs.mkdirSync(sessionDir, { recursive: true });
	fs.writeFileSync(
		path.join(sessionDir, "session-" + Date.now() + ".jsonl"),
		JSON.stringify({ type: "session_start" }) + "\n",
	);
}

process.exit(entry?.exitCode ?? 0);
