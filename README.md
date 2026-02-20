# @marcfargas/pi-test-harness

Test harness for [pi](https://github.com/mariozechner/pi-coding-agent) extensions — playbook-based model mocking with real extension execution.

## Why

Testing pi extensions is hard. Extensions register tools, subscribe to hooks, intercept tool calls, use UI — all deeply integrated with pi's runtime. Mocking everything produces tests that don't reflect reality. Not testing produces extensions that break in production.

pi-test-harness takes a different approach: **let pi be pi.** Everything runs for real — extension loading, tool registration, hooks, event lifecycle, session state. Only the model is replaced (via `streamFn`), and optionally tool execution is intercepted for tools you don't want to run for real.

The result: tests that exercise real code paths, in ~10 lines of setup, with zero LLM calls.

## Install

```bash
npm install --save-dev @marcfargas/pi-test-harness
```

### Peer dependencies

- `@mariozechner/pi-coding-agent` >= 0.50.0
- `@mariozechner/pi-ai`
- `@mariozechner/pi-agent-core`

## Quick Start

```typescript
import { describe, it, expect, afterEach } from "vitest";
import {
  createTestSession,
  when, calls, says,
  type TestSession,
} from "@marcfargas/pi-test-harness";

describe("my extension", () => {
  let t: TestSession;
  afterEach(() => t?.dispose());

  it("calls a tool and responds", async () => {
    t = await createTestSession({
      extensions: ["./src/index.ts"],
      mockTools: {
        bash: (params) => `$ ${params.command}\nfile1.txt\nfile2.txt`,
        read: "file contents here",
        write: "written",
        edit: "edited",
      },
    });

    await t.run(
      when("List files in the project", [
        calls("bash", { command: "ls" }),
        says("Found 2 files: file1.txt and file2.txt"),
      ]),
    );

    expect(t.events.toolResultsFor("bash")).toHaveLength(1);
    expect(t.events.toolResultsFor("bash")[0].text).toContain("file1.txt");
    expect(t.events.toolResultsFor("bash")[0].mocked).toBe(true);
  });
});
```

## Architecture

```
┌───────────────────────────────────────────┐
│  Real pi environment                      │
│                                           │
│  Extensions ─── loaded for real           │
│  Tool registry ─ real hooks + wrapping    │
│  Session state ─ in-memory persistence    │
│                                           │
│  ┌─────────────────────────────────────┐  │
│  │         Agent Loop                  │  │
│  │                                     │  │
│  │  streamFn ──── REPLACED by playbook │  │
│  │  tool.execute() INTERCEPTED if mock │  │
│  │  ctx.ui.* ──── INTERCEPTED + logged │  │
│  └─────────────────────────────────────┘  │
└───────────────────────────────────────────┘
```

Three substitution points at the boundary — everything else runs through pi's real code:

| What | Substituted with | Purpose |
|------|-----------------|---------|
| `streamFn` | Playbook | Scripts what the model "decides" |
| `tool.execute()` | Mock handler | Controls what tools "return" (hooks still fire) |
| `ctx.ui.*` | Mock UI | Controls what the user "answers" |

## Playbook DSL

The playbook replaces the LLM. Instead of calling a model, the agent loop consumes scripted actions in order.

### `when(prompt, actions)`

Defines a conversation turn — the prompt you'll send and what the model does in response:

```typescript
when("Deploy the app", [
  calls("bash", { command: "npm run build" }),
  calls("bash", { command: "gcloud run deploy" }),
  says("Deployed successfully."),
])
```

### `calls(tool, params)`

The model calls a tool. Pi's hooks fire, the tool executes (real or mocked), result feeds back:

```typescript
calls("plan_mode", { enable: true })
calls("bash", { command: "ls -la" })
```

### `says(text)`

The model emits text. The agent turn ends:

```typescript
says("All done. The deployment is complete.")
```

### Multi-turn conversations

Pass multiple turns to `run()`:

```typescript
await t.run(
  when("What files are in the project?", [
    calls("bash", { command: "ls" }),
    says("Found 3 files."),
  ]),
  when("Now read the README", [
    calls("read", { path: "README.md" }),
    says("Here's what it says..."),
  ]),
);
```

## Mock Tools

`mockTools` intercepts `tool.execute()` for specific tools. Pi's tool registry and event flow remain untouched. Extension hooks (`tool_call`, `tool_result`) fire for mocked tools via the extension runner — so hook-based blocking (e.g., plan mode) works correctly even with mocked tools.

```typescript
const t = await createTestSession({
  extensions: ["./src/index.ts"],
  mockTools: {
    // Static string → becomes { content: [{ type: "text", text: "..." }] }
    bash: "command output here",

    // Dynamic function → receives params, returns string or ToolResult
    read: (params) => `contents of ${params.path}`,

    // Full ToolResult for precise control
    write: {
      content: [{ type: "text", text: "Written successfully" }],
      details: { bytesWritten: 42 },
    },
  },
});
```

**Extension-registered tools execute for real** unless they appear in `mockTools`. This lets you test your extension's actual tool logic while controlling the built-in tools.

## Late-bound Params & `.then()`

When one tool call produces a value needed by the next, use `.then()` to capture it and `() => params` for late binding:

```typescript
let planId = "";

await t.run(
  when("Create and approve a plan", [
    calls("plan_propose", {
      title: "Send invoice",
      steps: [{ description: "Send email", tool: "go-easy", operation: "send" }],
    }).then((result) => {
      // Extract the plan ID from the tool result
      planId = result.text.match(/PLAN-[a-f0-9]+/)![0];
    }),
    // Late-bound: params resolved at call time, after .then() has fired
    calls("plan_approve", () => ({ id: planId })),
    says("Plan approved and executing."),
  ]),
);

expect(planId).toMatch(/^PLAN-/);
```

## Mock UI

Extensions that call `ctx.ui.confirm()`, `ctx.ui.select()`, etc. get mock responses. All calls are recorded for assertions.

```typescript
const t = await createTestSession({
  extensions: ["./src/index.ts"],
  mockUI: {
    confirm: false,                    // deny all confirmations
    select: 0,                         // always pick first item
    input: "user input text",          // return fixed string
    editor: "edited content",          // return fixed string
  },
});

// ... run playbook ...

// Assert the extension asked for confirmation
expect(t.events.uiCallsFor("confirm")).toHaveLength(1);
expect(t.events.uiCallsFor("confirm")[0].returnValue).toBe(false);
```

Dynamic handlers are also supported:

```typescript
mockUI: {
  confirm: (title, message) => title.includes("Delete") ? false : true,
  select: (title, items) => items.find(i => i.includes("staging")),
}
```

**Defaults** (when no mock config is provided): `confirm → true`, `select → first item`, `input → ""`, `editor → ""`.

## Event Collection

Every session event, tool call, tool result, message, and UI interaction is collected:

```typescript
// Tool events
t.events.toolCallsFor("bash")        // ToolCallRecord[] for "bash"
t.events.toolResultsFor("bash")      // ToolResultRecord[] for "bash"
t.events.blockedCalls()              // tools blocked by hooks (e.g., plan mode)

// UI events
t.events.uiCallsFor("notify")       // UICallRecord[] for notify()
t.events.uiCallsFor("confirm")      // UICallRecord[] for confirm()

// Messages and raw events
t.events.messages                    // AgentMessage[]
t.events.all                        // AgentSessionEvent[] (everything)
```

### ToolResultRecord

```typescript
interface ToolResultRecord {
  step: number;                // playbook step index
  toolName: string;
  toolCallId: string;
  text: string;                // concatenated text content
  content: Array<{ type: string; text?: string }>;
  isError: boolean;
  mocked: boolean;             // true if mockTools handled it
}
```

## Error Propagation

By default (`propagateErrors: true`), real tool errors abort the test with a diagnostic pointing to the exact playbook step:

```
Error during tool execution at playbook step 3 (call "bash"):
  ENOENT: no such file or directory '/foo/bar'
  at Object.readFileSync (node:fs:...)

This error was thrown by the real tool execution, not by the playbook.
To capture errors as tool results instead of aborting, set:
  createTestSession({ propagateErrors: false })
```

Set `propagateErrors: false` to capture errors as `isError: true` in the result instead:

```typescript
const t = await createTestSession({
  propagateErrors: false,
  // ...
});
```

## Playbook Diagnostics

The harness auto-asserts that all playbook actions are consumed after `run()` completes. If the playbook is exhausted early or has remaining unconsumed actions, you get a clear diagnostic:

```
Playbook exhausted unexpectedly.
  Consumed 2 action(s).
  Last consumed: calls("bash", {"command":"ls"}) at step 2

  The agent loop called streamFn but no more playbook actions were available.
  This usually means a tool call produced an unexpected result that caused
  additional streamFn calls (retries, error handling).
```

```
Playbook not fully consumed after run() completed.
  Consumed 1 of 3 action(s).
  Remaining:
    - calls("write", {"path":"out.txt","content":"hello"})
    - says("Done writing.")

  The agent loop ended before all playbook actions were used.
  This usually means a tool was blocked by a hook or returned early,
  causing fewer streamFn calls than expected.
```

## Sandbox Install Verification

Catches broken packages before publish — verifies that `npm pack` → install → load actually works:

```typescript
import { verifySandboxInstall } from "@marcfargas/pi-test-harness";

const result = await verifySandboxInstall({
  packageDir: "./packages/my-extension",
  expect: {
    extensions: 1,
    tools: ["my_tool", "my_other_tool"],
    skills: 0,
  },
});

expect(result.loaded.extensionErrors).toEqual([]);
expect(result.loaded.tools).toContain("my_tool");
```

Optionally run a smoke test inside the sandbox:

```typescript
const result = await verifySandboxInstall({
  packageDir: "./packages/my-extension",
  expect: { extensions: 1 },
  smoke: {
    mockTools: { bash: "ok", read: "contents", write: "written", edit: "edited" },
    script: [
      when("Test", [
        calls("my_tool", { value: "test" }),
        says("Works."),
      ]),
    ],
  },
});
```

## Mock Pi CLI

For extensions that spawn `pi --mode json -p` as a subprocess (e.g., subagent orchestrators), `createMockPi()` puts a fake `pi` binary in PATH that returns controllable responses.

```typescript
import { createMockPi } from "@marcfargas/pi-test-harness";

const mockPi = createMockPi();
mockPi.install();  // creates temp dir with pi shim, prepends PATH

// Queue responses (consumed in order, last one repeats)
mockPi.onCall({ output: "Hello from agent", exitCode: 0 });
mockPi.onCall({ stderr: "agent crashed", exitCode: 1 });
mockPi.onCall({
  jsonl: [
    { type: "tool_execution_start", toolName: "bash" },
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done" }] } },
  ],
});

// Write files during execution (e.g., chain_dir output simulation)
mockPi.onCall({
  output: "Result written",
  writeFiles: { "/tmp/output.md": "# Result\nDone." },
});

// Reset queue between tests
mockPi.reset();

// Check invocation count
expect(mockPi.callCount()).toBe(0);

// Cleanup
mockPi.uninstall();  // restores PATH, deletes temp dir
```

### How it works

1. `install()` creates a temp directory with a platform-specific shim (`pi.cmd` on Windows, `pi` shell script on Linux)
2. The shim is prepended to PATH so `child_process.spawn("pi", ...)` resolves to it
3. Each invocation reads the next response from a file-based queue (`queue.json` + `counter`)
4. When the queue is exhausted, the last response repeats
5. If no responses are queued, the mock echoes the task text

### Response options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `output` | `string` | echo task | Text in the `message_end` event |
| `exitCode` | `number` | `0` | Process exit code |
| `stderr` | `string` | — | Written to stderr |
| `delay` | `number` | `0` | Delay in ms before responding |
| `jsonl` | `object[]` | — | Raw JSONL events (replaces default `message_end`) |
| `writeFiles` | `Record<string, string>` | — | Files to create (path → content) |

### Safety features

- **Exit handler**: PATH is restored on process exit even if `uninstall()` isn't called (test crash safety)
- **Key validation**: Typos like `{ ouptut: "..." }` throw immediately instead of silently passing
- **Timeout**: Mock script exits after 30s to prevent hanging tests

### Concurrency

Designed for **serial subprocess spawns** within a single test. If your test spawns multiple pi processes concurrently, responses may be consumed out of order.

### Test layer summary

| Layer | What it mocks | Use when |
|-------|--------------|----------|
| `createTestSession` | LLM (`streamFn`) | Testing extension logic in-process |
| `verifySandboxInstall` | Nothing (real install) | Verifying npm package works |
| `createMockPi` | pi CLI binary | Testing subprocess-spawning extensions |

## API Reference

### `createTestSession(options?)`

Creates a test session with a real pi environment.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `extensions` | `string[]` | `[]` | Extension file paths to load |
| `extensionFactories` | `Function[]` | `[]` | Inline extension factory functions |
| `cwd` | `string` | auto temp dir | Working directory (cleaned on dispose if auto) |
| `systemPrompt` | `string` | — | Override the system prompt |
| `mockTools` | `Record<string, MockToolHandler>` | — | Tool execution interceptors |
| `mockUI` | `MockUIConfig` | defaults | UI mock configuration |
| `propagateErrors` | `boolean` | `true` | Abort test on real tool throw |

Returns `Promise<TestSession>`.

### `TestSession`

| Property / Method | Type | Description |
|-------------------|------|-------------|
| `run(...turns)` | `Promise<void>` | Run the conversation script |
| `session` | `AgentSession` | The real pi session underneath |
| `cwd` | `string` | Working directory |
| `events` | `TestEvents` | All collected events |
| `playbook` | `{ consumed, remaining }` | Playbook consumption state |
| `dispose()` | `void` | Cleanup temp dir and session |

### `verifySandboxInstall(options)`

| Option | Type | Description |
|--------|------|-------------|
| `packageDir` | `string` | Package directory (must have `package.json`) |
| `expect.extensions` | `number` | Expected extension count |
| `expect.tools` | `string[]` | Expected tool names |
| `expect.skills` | `number` | Expected skill count |
| `smoke.mockTools` | `Record<string, MockToolHandler>` | Mock tools for smoke test |
| `smoke.script` | `Turn[]` | Playbook script for smoke test |

### `createMockPi()`

Creates a mock pi CLI with file-based response queue.

Returns `MockPi`:

| Property / Method | Type | Description |
|-------------------|------|-------------|
| `install()` | `void` | Create shim, prepend to PATH |
| `uninstall()` | `void` | Restore PATH, delete temp dir |
| `onCall(response)` | `void` | Queue a `MockPiCall` response |
| `reset()` | `void` | Clear queue and counter |
| `callCount()` | `number` | Number of times mock pi was invoked |
| `dir` | `string` | Temp directory path |

### `MockToolHandler`

```typescript
type MockToolHandler =
  | string                                             // static text
  | ToolResult                                         // full result object
  | ((params: Record<string, unknown>) => string | ToolResult);  // dynamic
```

### `MockUIConfig`

```typescript
interface MockUIConfig {
  confirm?: boolean | ((title: string, message: string) => boolean);
  select?: number | string | ((title: string, items: string[]) => string | undefined);
  input?: string | ((title: string, placeholder?: string) => string | undefined);
  editor?: string | ((title: string, prefilled?: string) => string | undefined);
}
```

## Real-World Example: Testing pi-planner

Testing an extension that registers 8 tools, blocks writes in plan mode, and manages plan lifecycle:

```typescript
import { createTestSession, when, calls, says, type TestSession } from "@marcfargas/pi-test-harness";
import * as path from "node:path";

const EXTENSION = path.resolve(__dirname, "../../src/index.ts");
const MOCKS = {
  bash: (p: Record<string, unknown>) => `mock: ${p.command}`,
  read: "mock contents", write: "mock written", edit: "mock edited",
};

describe("pi-planner", () => {
  let t: TestSession;
  afterEach(() => t?.dispose());

  it("enters plan mode and proposes a plan", async () => {
    t = await createTestSession({
      extensions: [EXTENSION],
      mockTools: MOCKS,
    });

    let planId = "";

    await t.run(
      when("Plan the deployment", [
        calls("plan_mode", { enable: true }),
        calls("plan_propose", {
          title: "Deploy v2",
          steps: [
            { description: "Build", tool: "bash", operation: "build" },
            { description: "Deploy", tool: "gcloud", operation: "deploy" },
          ],
        }).then((r) => {
          planId = r.text.match(/PLAN-[a-f0-9]+/)![0];
        }),
        says("Plan proposed."),
      ]),
    );

    expect(planId).toMatch(/^PLAN-/);
    expect(t.events.toolResultsFor("plan_mode")[0].text).toContain("enabled");
    expect(t.events.uiCallsFor("notify")).toHaveLength(1);
  });
});
```

## Design Philosophy

> **Let pi be pi.** The less we fake, the more real the test.

The harness minimizes substitution. Extensions load through pi's real loader (jiti). Tools go through pi's real wrapping pipeline (`wrapToolsWithExtensions`). Hooks fire through pi's real `ExtensionRunner`. Events flow through pi's real event system.

Only the LLM boundary is replaced — because that's the one thing you **can't** run in a test.

## License

MIT
