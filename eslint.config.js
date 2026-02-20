import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-unused-vars": ["warn", {
				argsIgnorePattern: "^_",
				varsIgnorePattern: "^_",
			}],
			"no-empty": ["error", { allowEmptyCatch: true }],
			"@typescript-eslint/no-require-imports": "off",
		},
	},
	{
		ignores: [
			"dist/",
			"node_modules/",
			"*.config.js",
		],
	},
);
