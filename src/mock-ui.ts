/**
 * Mock UI context — intercepts ctx.ui.* calls from extensions.
 * All calls are collected for assertions. Interactive methods return
 * configured mock responses.
 */

import type { MockUIConfig, UICallRecord } from "./types.js";

/**
 * Create a mock ExtensionUIContext that records all calls and returns
 * configured responses.
 */
export function createMockUIContext(config: MockUIConfig = {}, uiLog: UICallRecord[]): any {
	function record(method: string, args: unknown[], returnValue?: unknown): void {
		uiLog.push({ method, args, returnValue });
	}

	const mockUI = {
		async select(title: string, options: string[], _opts?: any): Promise<string | undefined> {
			let result: string | undefined;
			const handler = config.select;
			if (handler === undefined || handler === null) {
				result = options[0]; // default: first item
			} else if (typeof handler === "number") {
				result = options[handler];
			} else if (typeof handler === "string") {
				result = options.find((o) => o === handler) ?? options[0];
			} else if (typeof handler === "function") {
				result = handler(title, options);
			}
			record("select", [title, options], result);
			return result;
		},

		async confirm(title: string, message: string, _opts?: any): Promise<boolean> {
			let result: boolean;
			const handler = config.confirm;
			if (handler === undefined || handler === null) {
				result = true; // default: approve
			} else if (typeof handler === "boolean") {
				result = handler;
			} else if (typeof handler === "function") {
				result = handler(title, message);
			} else {
				result = true;
			}
			record("confirm", [title, message], result);
			return result;
		},

		async input(title: string, placeholder?: string, _opts?: any): Promise<string | undefined> {
			let result: string | undefined;
			const handler = config.input;
			if (handler === undefined || handler === null) {
				result = "";
			} else if (typeof handler === "string") {
				result = handler;
			} else if (typeof handler === "function") {
				result = handler(title, placeholder);
			}
			record("input", [title, placeholder], result);
			return result;
		},

		async editor(title: string, prefill?: string): Promise<string | undefined> {
			let result: string | undefined;
			const handler = config.editor;
			if (handler === undefined || handler === null) {
				result = "";
			} else if (typeof handler === "string") {
				result = handler;
			} else if (typeof handler === "function") {
				result = handler(title, prefill);
			}
			record("editor", [title, prefill], result);
			return result;
		},

		notify(message: string, type?: string): void {
			record("notify", [message, type]);
		},

		onTerminalInput(): () => void {
			return () => {};
		},

		setStatus(key: string, text: string | undefined): void {
			record("setStatus", [key, text]);
		},

		setWorkingMessage(message?: string): void {
			record("setWorkingMessage", [message]);
		},

		setWidget(key: string, content: any, _options?: any): void {
			record("setWidget", [key, content]);
		},

		setFooter(): void {},
		setHeader(): void {},

		setTitle(title: string): void {
			record("setTitle", [title]);
		},

		async custom<T>(): Promise<T> {
			return undefined as never;
		},

		pasteToEditor(): void {},
		setEditorText(): void {},
		getEditorText(): string { return ""; },
		setEditorComponent(): void {},

		get theme(): any {
			// Return a minimal theme stub
			return {
				fg: (_color: string, text: string) => text,
				bold: (text: string) => text,
				italic: (text: string) => text,
				strikethrough: (text: string) => text,
			};
		},

		getAllThemes(): any[] { return []; },
		getTheme(): any { return undefined; },
		setTheme(): any { return { success: false, error: "Test mode" }; },
		getToolsExpanded(): boolean { return false; },
		setToolsExpanded(): void {},
	};

	return mockUI;
}
