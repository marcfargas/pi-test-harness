/**
 * PlaybookStreamFn — replaces the model with scripted responses.
 *
 * The playbook is a queue of actions. Each streamFn call dequeues the next
 * action and returns it as an AssistantMessageEventStream.
 */

import {
	createAssistantMessageEventStream,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import type { PlaybookAction, Turn, ToolResultRecord } from "./types.js";
import { formatPlaybookDiagnostic } from "./diagnostics.js";

// ── DSL builders ────────────────────────────────────────────

/** Chainable call action builder */
class CallAction {
	readonly action: PlaybookAction;

	constructor(toolName: string, params: Record<string, unknown> | (() => Record<string, unknown>)) {
		this.action = { type: "call", toolName, params };
	}

	then(callback: (result: ToolResultRecord) => void): CallAction {
		this.action.thenCallback = callback;
		return this;
	}
}

/**
 * The model calls a tool.
 * @param toolName Tool to call
 * @param params Static params or function for late binding
 */
export function calls(
	toolName: string,
	params: Record<string, unknown> | (() => Record<string, unknown>) = {},
): CallAction {
	return new CallAction(toolName, params);
}

/**
 * The model emits text. Agent loop ends for this turn.
 */
export function says(text: string): PlaybookAction {
	return { type: "say", text };
}

/**
 * @deprecated Use `calls()` instead. Will be removed in v0.4.
 */
export const call = calls;

/**
 * @deprecated Use `says()` instead. Will be removed in v0.4.
 */
export const say = says;

/**
 * Define one user→model turn.
 * @param prompt The actual user prompt text
 * @param actions What the model does in response (call/say sequence)
 */
export function when(prompt: string, actions: Array<CallAction | PlaybookAction>): Turn {
	return {
		prompt,
		actions: actions.map((a) => (a instanceof CallAction ? a.action : a)),
	};
}

// ── PlaybookStreamFn ────────────────────────────────────────

let toolCallCounter = 0;

function resolveParams(params: Record<string, unknown> | (() => Record<string, unknown>) | undefined): Record<string, unknown> {
	if (!params) return {};
	if (typeof params === "function") return params();
	return params;
}

function createAssistantMessage(action: PlaybookAction): AssistantMessage {
	const content: AssistantMessage["content"] = [];

	if (action.type === "say") {
		content.push({ type: "text", text: action.text ?? "" });
	} else if (action.type === "call") {
		toolCallCounter++;
		const resolvedParams = resolveParams(action.params);
		content.push({
			type: "toolCall",
			id: `playbook-tc-${toolCallCounter}`,
			name: action.toolName!,
			arguments: resolvedParams,
		});
	}

	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "test",
		model: "playbook",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: action.type === "call" ? "toolUse" : "stop",
		timestamp: Date.now(),
	};
}

export interface PlaybookState {
	consumed: number;
	remaining: number;
	/** The action objects for each consumed step (for diagnostics) */
	consumedActions: PlaybookAction[];
	/** Callbacks pending for completed tool calls */
	pendingCallbacks: Map<string, (result: ToolResultRecord) => void>;
}

export function createPlaybookStreamFn(turns: Turn[]): {
	streamFn: (model: Model<any>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream;
	state: PlaybookState;
} {
	// Flatten all turns into a single action queue
	const queue: PlaybookAction[] = [];
	for (const turn of turns) {
		queue.push(...turn.actions);
	}

	const state: PlaybookState = {
		consumed: 0,
		remaining: queue.length,
		consumedActions: [],
		pendingCallbacks: new Map(),
	};

	// Reset counter for test isolation
	toolCallCounter = 0;

	const streamFn = (
		_model: Model<any>,
		_context: Context,
		_options?: SimpleStreamOptions,
	): AssistantMessageEventStream => {
		const stream = createAssistantMessageEventStream();
		const action = queue.shift();

		if (!action) {
			// Playbook exhausted
			const diagnostic = formatPlaybookDiagnostic("exhausted", state);
			const fallback: AssistantMessage = {
				role: "assistant",
				content: [{ type: "text", text: `[PLAYBOOK EXHAUSTED] ${diagnostic}` }],
				api: "openai-responses",
				provider: "test",
				model: "playbook",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop",
				timestamp: Date.now(),
			};
			queueMicrotask(() => {
				stream.push({ type: "done", reason: "stop", message: fallback });
			});
			return stream;
		}

		state.consumed++;
		state.remaining = queue.length;
		state.consumedActions.push(action);

		const message = createAssistantMessage(action);

		// Register callback if present (keyed by tool call ID for uniqueness)
		if (action.type === "call" && action.thenCallback) {
			const tcContent = message.content.find((c) => c.type === "toolCall");
			const tcId = tcContent && "id" in tcContent ? (tcContent as any).id : action.toolName!;
			state.pendingCallbacks.set(tcId, action.thenCallback);
		}

		queueMicrotask(() => {
			stream.push({
				type: "done",
				reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
				message,
			});
		});

		return stream;
	};

	return { streamFn, state };
}
