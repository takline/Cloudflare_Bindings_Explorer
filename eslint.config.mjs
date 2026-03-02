import pluginJs from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  {files: ["**/*.{js,mjs,cjs,ts}"]},
  {languageOptions: { globals: globals.node }},
  {
    ignores: ["test/fixtures/", "test-fixtures/", "dist/", "out/", "node_modules/", "examples/", "example/"],
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-var-requires": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn"],
      "@typescript-eslint/no-require-imports": "off", // Allow require in JS files generally as this is a legacy codebase being modernized
      "@typescript-eslint/no-explicit-any": "off",
      "no-control-regex": "off",
      "no-undef": "off", // Typescript handles this, but for JS files? VSCode globals?
      "no-useless-escape": "off"
    }
  },
  {
    files: ["test/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.jest,
        vscode: "readonly"
      }
    }
  },
  {
      files: ["src/**/*.js", "src/**/*.mjs"],
      languageOptions: {
          globals: {
              vscode: "readonly"
          }
      },
      rules: {
           // Extension specific rules
      }
  }
];
