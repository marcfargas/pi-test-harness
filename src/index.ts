/**
 * @marcfargas/pi-test-harness
 *
 * Test harness for pi extensions — playbook-based model mocking,
 * session testing, sandbox install verification.
 */

// DSL builders
export { when, calls, says } from "./playbook.js";

// Deprecated aliases (remove in v0.4)
export { call, say } from "./playbook.js";

// Session
export { createTestSession } from "./session.js";

// Sandbox
export { verifySandboxInstall } from "./sandbox.js";

// Mock Pi
export { createMockPi } from "./mock-pi.js";

// Types
export type {
	TestSession,
	TestSessionOptions,
	TestEvents,
	ToolCallRecord,
	ToolResultRecord,
	UICallRecord,
	MockToolHandler,
	MockUIConfig,
	SandboxOptions,
	SandboxResult,
	MockPi,
	MockPiCall,
	Turn,
	PlaybookAction,
} from "./types.js";
