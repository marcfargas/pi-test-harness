// Minimal pi extension that registers one tool
import { Type } from "@sinclair/typebox";

export default function (pi) {
	pi.registerTool({
		name: "dummy_tool",
		label: "Dummy Tool",
		description: "A test tool for sandbox verification",
		parameters: Type.Object({
			value: Type.String({ description: "Test value" }),
		}),
		execute: async (_id, params) => ({
			content: [{ type: "text", text: `echo: ${params.value}` }],
			details: {},
		}),
	});
}
