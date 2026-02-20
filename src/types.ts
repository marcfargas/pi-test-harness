/**
 * Shared types for pi-test-harness.
 */

import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

// ── Playbook types ──────────────────────────────────────────

export interface PlaybookAction {
	type: "call" | "say";
	/** For "call": tool name */
	toolName?: string;
	/** For "call": static or late-bound params */
	params?: Record<string, unknown> | (() => Record<string, unknown>);
	/** For "say": text content */
	text?: string;
	/** Optional callback after tool execution */
	thenCallback?: (result: ToolResultRecord) => void;
}

export interface Turn {
	prompt: string;
	actions: PlaybookAction[];
}

// ── Mock types ──────────────────────────────────────────────

export interface ToolResult {
	content: Array<{ type: string; text: string }>;
	details?: unknown;
	isError?: boolean;
}

export type MockToolHandler =
	| string
	| ToolResult
	| ((params: Record<string, unknown>) => string | ToolResult);

export interface MockUIConfig {
	confirm?: boolean | ((title: string, message: string) => boolean);
	select?: number | string | ((title: string, items: string[]) => string | undefined);
	input?: string | ((title: string, placeholder?: string) => string | undefined);
	editor?: string | ((title: string, prefilled?: string) => string | undefined);
}

// ── Event collection types ──────────────────────────────────

export interface ToolCallRecord {
	step: number;
	toolName: string;
	input: Record<string, unknown>;
	blocked: boolean;
	blockReason?: string;
}

export interface ToolResultRecord {
	step: number;
	toolName: string;
	toolCallId: string;
	text: string;
	content: Array<{ type: string; text?: string }>;
	isError: boolean;
	details?: unknown;
	mocked: boolean;
}

export interface UICallRecord {
	method: string;
	args: unknown[];
	returnValue?: unknown;
}

export interface TestEvents {
	all: AgentSessionEvent[];
	toolCalls: ToolCallRecord[];
	toolResults: ToolResultRecord[];
	messages: AgentMessage[];
	ui: UICallRecord[];

	toolCallsFor(name: string): ToolCallRecord[];
	toolResultsFor(name: string): ToolResultRecord[];
	blockedCalls(): ToolCallRecord[];
	uiCallsFor(method: string): UICallRecord[];
	/** Ordered list of tool names as they were called */
	toolSequence(): string[];
}

// ── Session types ───────────────────────────────────────────

export interface TestSessionOptions {
	/** Extension file paths to load */
	extensions?: string[];
	/** Extension factory functions (inline) */
	extensionFactories?: Array<(pi: any) => void>;
	/** Working directory (auto temp dir if omitted, cleaned on dispose) */
	cwd?: string;
	/** System prompt override */
	systemPrompt?: string;

	/** Mock tool execution (intercepts tool.execute()) */
	mockTools?: Record<string, MockToolHandler>;
	/** Mock UI responses */
	mockUI?: MockUIConfig;

	/** Abort on real tool throw (default: true) */
	propagateErrors?: boolean;
}

export interface TestSession {
	/** Run a conversation script */
	run(...turns: Turn[]): Promise<void>;
	/** Real session underneath */
	session: any; // AgentSession — avoid import cycle
	/** Working directory */
	cwd: string;
	/** Collected events */
	events: TestEvents;
	/** Playbook consumption state */
	playbook: { consumed: number; remaining: number };
	/** Cleanup */
	dispose(): void;
}

// ── MockPi types ────────────────────────────────────────────

/** Configuration for a single mock pi invocation response. */
export interface MockPiCall {
	/** Text output from the mock agent */
	output?: string;
	/** Exit code (default: 0) */
	exitCode?: number;
	/** Stderr output */
	stderr?: string;
	/** Delay in ms before responding */
	delay?: number;
	/** Raw JSONL events to emit instead of default message_end */
	jsonl?: object[];
	/** Files to write before exiting (path → content) */
	writeFiles?: Record<string, string>;
}

/** Mock pi CLI for testing extensions that spawn pi as a subprocess. */
export interface MockPi {
	/** Create temp dir with pi shim, prepend to PATH */
	install(): void;
	/** Remove from PATH, delete temp dir */
	uninstall(): void;
	/** Queue a response for the next pi invocation */
	onCall(response: MockPiCall): void;
	/** Clear the response queue and reset the call counter */
	reset(): void;
	/** Number of times the mock pi has been invoked */
	callCount(): number;
	/** The temporary directory containing the queue and shim */
	dir: string;
}

// ── Sandbox types ───────────────────────────────────────────

export interface SandboxOptions {
	/** Package directory (runs npm pack) */
	packageDir: string;
	/** Expected resources after install */
	expect?: {
		extensions?: number;
		tools?: string[];
		skills?: number;
	};
	/** Optional smoke test in the sandbox */
	smoke?: {
		mockTools?: Record<string, MockToolHandler>;
		script: Turn[];
	};
}

export interface SandboxResult {
	loaded: {
		extensions: number;
		extensionErrors: string[];
		tools: string[];
		skills: number;
	};
	smoke?: {
		events: TestEvents;
	};
}
