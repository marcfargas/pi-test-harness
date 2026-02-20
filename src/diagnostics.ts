/**
 * Playbook diagnostic messages — clear errors when things diverge.
 */

import type { PlaybookAction } from "./types.js";

function formatAction(action: PlaybookAction): string {
	if (action.type === "say") {
		return `say("${action.text?.slice(0, 60)}${(action.text?.length ?? 0) > 60 ? "..." : ""}")`;
	}
	if (action.type === "call") {
		const params = typeof action.params === "function" ? "<late-bound>" : JSON.stringify(action.params);
		const truncated = params.length > 80 ? params.slice(0, 80) + "..." : params;
		return `call("${action.toolName}", ${truncated})`;
	}
	return `unknown(${action.type})`;
}

export function formatPlaybookDiagnostic(
	type: "exhausted" | "remaining",
	state: { consumed: number; remaining: number; consumedActions: PlaybookAction[] },
	remainingActions?: PlaybookAction[],
): string {
	if (type === "exhausted") {
		const last = state.consumedActions[state.consumedActions.length - 1];
		const lines = [
			`Playbook exhausted unexpectedly.`,
			`  Consumed ${state.consumed} action(s).`,
		];
		if (last) {
			lines.push(`  Last consumed: ${formatAction(last)} at step ${state.consumed}`);
		}
		lines.push(
			"",
			"  The agent loop called streamFn but no more playbook actions were available.",
			"  This usually means a tool call produced an unexpected result that caused",
			"  additional streamFn calls (retries, error handling).",
		);
		return lines.join("\n");
	}

	if (type === "remaining" && remainingActions) {
		const lines = [
			`Playbook not fully consumed after run() completed.`,
			`  Consumed ${state.consumed} of ${state.consumed + remainingActions.length} action(s).`,
			`  Remaining:`,
		];
		for (const action of remainingActions.slice(0, 5)) {
			lines.push(`    - ${formatAction(action)}`);
		}
		if (remainingActions.length > 5) {
			lines.push(`    ... +${remainingActions.length - 5} more`);
		}
		lines.push(
			"",
			"  The agent loop ended before all playbook actions were used.",
			"  This usually means a tool was blocked by a hook or returned early,",
			"  causing fewer streamFn calls than expected.",
		);
		return lines.join("\n");
	}

	return "Unknown playbook diagnostic.";
}

export function formatToolError(
	step: number,
	toolName: string,
	error: unknown,
): string {
	const message = error instanceof Error ? error.message : String(error);
	const stack = error instanceof Error ? error.stack : undefined;
	const lines = [
		`Error during tool execution at playbook step ${step} (call "${toolName}"):`,
		`  ${message}`,
	];
	if (stack) {
		const stackLines = stack.split("\n").slice(1, 4);
		for (const line of stackLines) {
			lines.push(`  ${line.trim()}`);
		}
	}
	lines.push(
		"",
		"This error was thrown by the real tool execution, not by the playbook.",
		"To capture errors as tool results instead of aborting, set:",
		"  createTestSession({ propagateErrors: false })",
	);
	return lines.join("\n");
}
