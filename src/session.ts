/**
 * TestSession — orchestrates a test run with playbook, mock tools, and mock UI.
 *
 * 1. Creates a real pi environment (extensions, tools, hooks, session)
 * 2. Replaces streamFn with playbook
 * 3. Intercepts tool.execute() for mockTools
 * 4. Injects mock UI context
 * 5. Collects events
 * 6. Runs conversation script
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	createAgentSession,
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
	type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { createPlaybookStreamFn, type PlaybookState } from "./playbook.js";
import { interceptToolExecution } from "./mock-tools.js";
import { createMockUIContext } from "./mock-ui.js";
import { createEventCollector } from "./events.js";
import { formatPlaybookDiagnostic } from "./diagnostics.js";
import type {
	TestSessionOptions,
	TestSession,
	Turn,
	ToolCallRecord,
} from "./types.js";

export async function createTestSession(options: TestSessionOptions = {}): Promise<TestSession> {
	const propagateErrors = options.propagateErrors ?? true;
	const ownsTmpDir = !options.cwd;
	const cwd = options.cwd ?? fs.mkdtempSync(path.join(os.tmpdir(), "pi-test-harness-"));

	// Ensure cwd exists
	if (!fs.existsSync(cwd)) {
		fs.mkdirSync(cwd, { recursive: true });
	}

	// Build resource loader with extensions
	const settingsManager = SettingsManager.inMemory();
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: cwd, // Use cwd as agent dir to avoid touching real ~/.pi
		settingsManager,
		additionalExtensionPaths: options.extensions?.map((p) => path.resolve(cwd, p)) ?? [],
		extensionFactories: options.extensionFactories,
		systemPromptOverride: options.systemPrompt ? () => options.systemPrompt! : undefined,
	});
	await loader.reload();

	// Use a real model definition (never actually called — playbook replaces streamFn)
	const playbookModel = getModel("openai", "gpt-4o");

	// Create real session with in-memory persistence
	const { session, extensionsResult } = await createAgentSession({
		cwd,
		agentDir: cwd,
		model: playbookModel,
		sessionManager: SessionManager.inMemory(),
		settingsManager,
		resourceLoader: loader,
	});

	// Override getApiKey to bypass real auth checks (on both agent and session)
	(session.agent as any).getApiKey = async () => "test-key";
	// The session also validates via _modelRegistry.getApiKey — patch it
	const origModelRegistry = (session as any)._modelRegistry;
	if (origModelRegistry) {
		origModelRegistry.getApiKey = async () => "test-key";
		origModelRegistry.getApiKeyForProvider = async () => "test-key";
	}

	// Check for extension load errors
	if (extensionsResult.errors.length > 0) {
		session.dispose();
		if (ownsTmpDir && fs.existsSync(cwd)) {
			fs.rmSync(cwd, { recursive: true, force: true });
		}
		const errors = extensionsResult.errors
			.map((e) => `  ${e.path}: ${e.error}`)
			.join("\n");
		throw new Error(`Extension load errors:\n${errors}`);
	}

	// Event collection
	const events = createEventCollector();
	let currentStep = 0;

	// Subscribe to session events
	session.subscribe((event: AgentSessionEvent) => {
		events.all.push(event);

		// Collect tool call events
		if (event.type === "tool_execution_start") {
			const record: ToolCallRecord = {
				step: currentStep,
				toolName: event.toolName,
				input: (event as any).args ?? {},
				blocked: false,
			};
			events.toolCalls.push(record);
		}

		if (event.type === "tool_execution_end") {
			if (event.isError) {
				// Check if this was a block (look at the most recent tool call)
				const lastCall = events.toolCalls[events.toolCalls.length - 1];
				if (lastCall && lastCall.toolName === event.toolName) {
					// Check if the error message indicates blocking
					const resultText = event.result?.content
						?.filter((c: any) => c.type === "text")
						?.map((c: any) => c.text)
						?.join("\n") ?? "";
					if (resultText.includes("blocked") || resultText.includes("Plan mode")) {
						lastCall.blocked = true;
						lastCall.blockReason = resultText;
					}
				}
			}
		}

		// Collect messages
		if (event.type === "message_end") {
			events.messages.push(event.message);
		}
	});

	// Playbook state (initialized on run())
	let playbookState: PlaybookState | null = null;

	// Mock UI context
	const mockUI = createMockUIContext(options.mockUI, events.ui);

	// Inject mock UI context via bindExtensions
	await session.bindExtensions({
		uiContext: mockUI,
		onError: (err) => {
			console.error(`[pi-test-harness] Extension error: ${err.event} — ${err.error}`);
		},
	});

	const testSession: TestSession = {
		session,
		cwd,
		events,

		get playbook() {
			return {
				consumed: playbookState?.consumed ?? 0,
				remaining: playbookState?.remaining ?? 0,
			};
		},

		async run(...turns: Turn[]): Promise<void> {
			// Create playbook streamFn
			const { streamFn, state } = createPlaybookStreamFn(turns);
			playbookState = state;

			// Replace the model with the playbook
			(session.agent as any).streamFn = streamFn;
			(session.agent as any).getApiKey = () => "test-key";

			// Intercept tool execution for mockTools
			if (options.mockTools) {
				const currentTools = (session.agent as any).state.tools as AgentTool[];
				const runner = session.extensionRunner;
				const interceptedTools = interceptToolExecution(
					currentTools,
					options.mockTools,
					events.toolResults,
					state,
					propagateErrors,
					runner,
				);
				(session.agent as any).setTools(interceptedTools);
			}

			// Run each turn
			for (const turn of turns) {
				currentStep = state.consumed;
				await session.prompt(turn.prompt);
				await (session.agent as any).waitForIdle();
			}

			// Auto-assert: playbook fully consumed
			if (state.remaining > 0) {
				// Collect remaining actions for diagnostics
				const allActions = turns.flatMap((t) => t.actions);
				const remaining = allActions.slice(state.consumed);
				const diagnostic = formatPlaybookDiagnostic("remaining", state, remaining);
				throw new Error(diagnostic);
			}
		},

		dispose(): void {
			session.dispose();
			if (ownsTmpDir && fs.existsSync(cwd)) {
				fs.rmSync(cwd, { recursive: true, force: true });
			}
		},
	};

	return testSession;
}
