/**
 * Event collection — passively collects all events during a test run.
 */

import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { TestEvents, ToolCallRecord, ToolResultRecord, UICallRecord } from "./types.js";

export function createEventCollector(): TestEvents {
	const all: AgentSessionEvent[] = [];
	const toolCalls: ToolCallRecord[] = [];
	const toolResults: ToolResultRecord[] = [];
	const messages: AgentMessage[] = [];
	const ui: UICallRecord[] = [];

	return {
		all,
		toolCalls,
		toolResults,
		messages,
		ui,

		toolCallsFor(name: string): ToolCallRecord[] {
			return toolCalls.filter((tc) => tc.toolName === name);
		},

		toolResultsFor(name: string): ToolResultRecord[] {
			return toolResults.filter((tr) => tr.toolName === name);
		},

		blockedCalls(): ToolCallRecord[] {
			return toolCalls.filter((tc) => tc.blocked);
		},

		uiCallsFor(method: string): UICallRecord[] {
			return ui.filter((u) => u.method === method);
		},

		toolSequence(): string[] {
			return toolCalls.map((tc) => tc.toolName);
		},
	};
}
