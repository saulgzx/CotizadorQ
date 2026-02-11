const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**']
  },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true }
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        navigator: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        FileReader: 'readonly',
        Image: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URLSearchParams: 'readonly',
        React: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-undef': 'off',
      'no-useless-escape': 'off'
    }
  },
  {
    files: ['src/**/*.test.{js,jsx}', 'src/test/**/*.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly'
      }
    }
  }
];
