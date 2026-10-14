import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules", "coverage", "bench/results", "bench/fixture"] },
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      complexity: ["error", 10],
      "max-depth": ["error", 3],
      "max-params": ["error", 4],
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 40, skipBlankLines: true, skipComments: true }],
      "no-console": "error",
      eqeqeq: "error",
    },
  },
  {
    // A describe() callback holds a whole suite, so the per-function cap does not fit test files.
    // Vitest types its matchers (expect.stringContaining and friends) as `any`.
    files: ["test/**/*.ts"],
    rules: { "max-lines-per-function": "off", "@typescript-eslint/no-unsafe-assignment": "off" },
  },
  {
    // The benchmark is a command-line program: printing is its job.
    files: ["bench/run.ts"],
    rules: { "no-console": "off" },
  },
  {
    files: ["eslint.config.js"],
    ...tseslint.configs.disableTypeChecked,
  },
);
