import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import ts from "@typescript-eslint/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import parser from "@typescript-eslint/parser";
import globals from "globals";

export default defineConfig([
  js.configs.recommended,
  {
    name: "node-bun-config",
    files: ["{src,tests}/server/**/*.{ts,tsx}"],
    languageOptions: {
      parser,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        console: true,
        process: true,
        module: true,
        require: true,
        Bun: true,
        logger: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": ts,
    },
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    settings: {
      "import/resolver": {
        node: true,
      },
    },
  },
  {
    name: "client-react-config",
    files: ["{src,tests}/client/**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      parser,
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        ...globals.browser,
        console: true,
        process: true,
        module: true,
        require: true,
      },
    },
    plugins: {
      "@typescript-eslint": ts,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // TypeScript already checks for undefined/unused bindings — the base
      // rules don't understand TS-only constructs (interface method
      // signatures, function-type params) and misfire on them.
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": "warn",
    },
  },
]);
