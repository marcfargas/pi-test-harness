/**
 * Tool execution interceptor — wraps tool.execute() for tools in mockTools.
 *
 * For mocked tools, we:
 *  1. Fire extension tool_call hooks (which can block execution)
 *  2. Return mock results instead of calling the real tool
 *  3. Fire extension tool_result hooks (which can modify results)
 *
 * This preserves the full extension hook chain while avoiding real tool execution.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ExtensionRunner } from "@mariozechner/pi-coding-agent";
import type { MockToolHandler, ToolResult, ToolResultRecord } from "./types.js";
import type { PlaybookState } from "./playbook.js";
import { formatToolError } from "./diagnostics.js";

function normalizeMockResult(
	handler: MockToolHandler,
	params: Record<string, unknown>,
): ToolResult {
	let raw: string | ToolResult;

	if (typeof handler === "string") {
		raw = handler;
	} else if (typeof handler === "function") {
		raw = handler(params);
	} else {
		raw = handler;
	}

	if (typeof raw === "string") {
		return {
			content: [{ type: "text", text: raw }],
			details: {},
		};
	}

	return raw;
}

/**
 * Intercept tool execution for mocked tools.
 * Returns the modified tools array (original tools wrapped where needed).
 *
 * When an extensionRunner is provided, mocked tools fire tool_call/tool_result
 * hooks so that extension blocking (e.g., plan mode) works correctly.
 */
export function interceptToolExecution(
	tools: AgentTool[],
	mockTools: Record<string, MockToolHandler>,
	toolResults: ToolResultRecord[],
	playbookState: PlaybookState,
	propagateErrors: boolean,
	extensionRunner?: ExtensionRunner,
): AgentTool[] {
	return tools.map((tool) => {
		const mockHandler = mockTools[tool.name];
		if (!mockHandler) {
			// No mock — wrap for event collection but keep real execution
			return wrapForCollection(tool, toolResults, playbookState, propagateErrors, false);
		}

		// Mock — replace execute() but fire extension hooks
		return {
			...tool,
			execute: async (
				toolCallId: string,
				params: Record<string, unknown>,
				_signal?: AbortSignal,
				_onUpdate?: any,
			) => {
				const step = playbookState.consumed;

				// Fire tool_call hook — extensions can block execution
				if (extensionRunner?.hasHandlers("tool_call")) {
					const callResult = await extensionRunner.emitToolCall({
						type: "tool_call",
						toolName: tool.name,
						toolCallId,
						input: params,
					} as any);

					if (callResult?.block) {
						const reason = callResult.reason || "Tool execution was blocked by an extension";

						// Record the block in toolResults before throwing so
						// toolResultsFor() can see it
						const record: ToolResultRecord = {
							step,
							toolName: tool.name,
							toolCallId,
							text: reason,
							content: [{ type: "text", text: reason }],
							isError: true,
							details: undefined,
							mocked: true,
						};
						toolResults.push(record);
						fireThenCallback(playbookState, toolCallId, record);

						// Match pi's wrapper behavior: throw an Error so the agent
						// loop records isError: true in the tool_execution_end event
						throw new Error(reason);
					}
				}

				// Not blocked — compute mock result
				const result = normalizeMockResult(mockHandler, params);

				// Fire tool_result hook — extensions can modify the result
				if (extensionRunner?.hasHandlers("tool_result")) {
					const resultHook = await extensionRunner.emitToolResult({
						type: "tool_result",
						toolName: tool.name,
						toolCallId,
						input: params,
						content: result.content,
						details: result.details,
						isError: false,
					} as any);

					if (resultHook) {
						result.content = (resultHook.content as typeof result.content) ?? result.content;
						result.details = resultHook.details ?? result.details;
					}
				}

				// Record in events
				const text = result.content
					.filter((c) => c.type === "text")
					.map((c) => c.text)
					.join("\n");

				const record: ToolResultRecord = {
					step,
					toolName: tool.name,
					toolCallId,
					text,
					content: result.content,
					isError: result.isError ?? false,
					details: result.details,
					mocked: true,
				};
				toolResults.push(record);

				// Fire .then() callback if pending
				fireThenCallback(playbookState, toolCallId, record);

				return {
					content: result.content,
					details: result.details ?? {},
				};
			},
		} as AgentTool;
	});
}

/**
 * Wrap a real tool for event collection (non-mocked tools).
 */
function wrapForCollection(
	tool: AgentTool,
	toolResults: ToolResultRecord[],
	playbookState: PlaybookState,
	propagateErrors: boolean,
	mocked: boolean,
): AgentTool {
	const originalExecute = tool.execute;

	return {
		...tool,
		execute: async (
			toolCallId: string,
			params: Record<string, unknown>,
			signal?: AbortSignal,
			onUpdate?: any,
		) => {
			const step = playbookState.consumed;

			try {
				const result = await originalExecute.call(tool, toolCallId, params, signal, onUpdate);

				const text = (result.content ?? [])
					.filter((c: any) => c.type === "text")
					.map((c: any) => c.text)
					.join("\n");

				const record: ToolResultRecord = {
					step,
					toolName: tool.name,
					toolCallId,
					text,
					content: result.content ?? [],
					isError: !!(result as any).isError,
					details: result.details,
					mocked,
				};
				toolResults.push(record);

				// Fire .then() callback if pending
				fireThenCallback(playbookState, toolCallId, record);

				return result;
			} catch (err) {
				const errMsg = err instanceof Error ? err.message : String(err);

				// Check if this was an extension hook blocking the tool
				// (not a real execution error — don't propagate as test failure)
				const isBlockedByHook = errMsg.includes("blocked")
					|| errMsg.includes("Plan mode")
					|| errMsg.includes("WRITE operation");

				const record: ToolResultRecord = {
					step,
					toolName: tool.name,
					toolCallId,
					text: errMsg,
					content: [{ type: "text", text: errMsg }],
					isError: true,
					details: undefined,
					mocked,
				};
				toolResults.push(record);

				// Fire .then() callback with error result
				fireThenCallback(playbookState, toolCallId, record);

				if (isBlockedByHook) {
					// Hook blocked the tool — re-throw so agent loop records
					// isError in events, but don't treat as test failure
					throw err;
				}

				if (propagateErrors) {
					const diagnostic = formatToolError(step, tool.name, err);
					throw new Error(diagnostic, { cause: err });
				}

				// Capture as error result instead of throwing
				return {
					content: [{ type: "text", text: errMsg }],
					details: {},
					isError: true,
				};
			}
		},
	} as AgentTool;
}

function fireThenCallback(state: PlaybookState, toolCallId: string, record: ToolResultRecord): void {
	// Look up by tool call ID first (unique per call), then fall back to tool name
	const callback = state.pendingCallbacks.get(toolCallId)
		?? state.pendingCallbacks.get(record.toolName);
	const key = state.pendingCallbacks.has(toolCallId) ? toolCallId : record.toolName;
	if (callback) {
		state.pendingCallbacks.delete(key);
		try {
			callback(record);
		} catch (err) {
			console.warn(`[pi-test-harness] .then() callback error for ${record.toolName}: ${err}`);
		}
	}
}
