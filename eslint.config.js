import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'node_modules', 'playwright-report', 'test-results', 'owner-private'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Effects here start async loads from the DB worker; the rule flags those loaders too.
      'react-hooks/set-state-in-effect': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // DATABASE_SCHEMA §3 note (audit L5): only the ledger trigger may change stock totals.
      'no-restricted-syntax': ['error',
        { selector: 'Literal[value=/SET[ ]+(on_hand|reserved)/i]', message: 'Stock totals change only through stock_movements (ledger).' },
        { selector: 'TemplateElement[value.raw=/SET[ ]+(on_hand|reserved)/i]', message: 'Stock totals change only through stock_movements (ledger).' },
        { selector: "MemberExpression[property.name='innerHTML']", message: 'No innerHTML: user text must never be parsed as HTML.' },
      ],
    },
  },
  {
    // The schema itself defines the trigger that is allowed to write the totals.
    files: ['src/core/db/schema.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
