import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginUnusedImports from "eslint-plugin-unused-imports";
import pluginTs from "typescript-eslint";

// typescript-eslint ships flat-config ARRAYS: they must sit at the top level of the exported
// array (flat config forbids an `extends` key), scoped to the files they apply to.
const tsRecommended = pluginTs.configs.recommended.map((config) => ({
  ...config,
  files: ["ciel-core/**/*.ts"],
}));

// Two different codebases live in this repository:
//   src/        the Base44 console (React, generated boilerplate included)
//   ciel-core/  the portable core (TypeScript syntax, no type annotations by design)
// They get different rules because they have different constraints.

const shared = {
  plugins: { "unused-imports": pluginUnusedImports },
  rules: {
    "no-unused-vars": "off",
    "unused-imports/no-unused-imports": "error",
    "unused-imports/no-unused-vars": ["warn", {
      vars: "all", varsIgnorePattern: "^_", args: "after-used", argsIgnorePattern: "^_",
      caughtErrors: "all", caughtErrorsIgnorePattern: "^_",
    }],
  },
};

export default [
  // ---------------------------------------------------------------- src (React)
  {
    files: [
      "src/components/**/*.{js,mjs,cjs,jsx}",
      "src/pages/**/*.{js,mjs,cjs,jsx}",
      "src/lib/**/*.{js,jsx}",
    ],
    ignores: ["src/components/ui/**/*"],
    ...pluginJs.configs.recommended,
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: "detect" } },
    plugins: {
      react: pluginReact,
      "react-hooks": pluginReactHooks,
      "unused-imports": pluginUnusedImports,
    },
    rules: {
      ...shared.rules,
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react/no-unknown-property": ["error", { ignore: ["cmdk-input-wrapper", "toast-close"] }],
      "react-hooks/rules-of-hooks": "error",
    },
  },

  // ---------------------------------------------------------------- ciel-core (TypeScript)
  // Deliberately not type-aware: the core is unannotated by design, so a type-checked config
  // would report implicit-any noise instead of real defects. Correctness is enforced by the
  // portable test suite; this block enforces the mechanical rules a test cannot see.
  ...tsRecommended,
  {
    files: ["ciel-core/**/*.ts"],
    plugins: { "unused-imports": pluginUnusedImports },
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, Deno: "readonly", Bun: "readonly" },
      parser: pluginTs.parser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    rules: {
      ...shared.rules,
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-undef": "error",
      // The code stores heterogeneous JSON records on purpose; the contract is enforced at
      // the boundary (validators), not by the shape of an object literal.
      "@typescript-eslint/no-explicit-any": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-constant-condition": "off",
      "no-useless-escape": "error",
    },
  },

  // ---------------------------------------------------------------- tools & config
  {
    files: ["ciel-core/bin/**/*.mjs", "vite.config.js", "eslint.config.js", "tailwind.config.js", "postcss.config.js"],
    ...pluginJs.configs.recommended,
    languageOptions: { globals: { ...globals.node }, parserOptions: { ecmaVersion: 2022, sourceType: "module" } },
    rules: { "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }] },
  },

  {
    ignores: ["dist/**", "node_modules/**", ".output/**", "coverage/**"],
  },
];
