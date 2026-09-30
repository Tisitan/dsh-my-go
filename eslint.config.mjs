// ESLint 扁平配置：bug 向最小规则集。
// 基线 = @eslint/js recommended（只含正确性与陷阱类规则）；风格与格式化规则显式关闭——不设风格门禁。
import js from '@eslint/js'
import globals from 'globals'

const STYLE_OFF = {
  indent: 'off',
  quotes: 'off',
  semi: 'off',
  'comma-dangle': 'off',
  'comma-spacing': 'off',
  'key-spacing': 'off',
  'keyword-spacing': 'off',
  'space-infix-ops': 'off',
  'space-before-function-paren': 'off',
  'object-curly-spacing': 'off',
  'arrow-parens': 'off',
  'max-len': 'off',
  'no-multiple-empty-lines': 'off',
  'no-trailing-spaces': 'off',
  'no-tabs': 'off',
  'eol-last': 'off',
  'no-irregular-whitespace': 'off',
  'no-extra-boolean-cast': 'off',
  'no-useless-escape': 'off',
  'no-unexpected-multiline': 'off',
  'no-regex-spaces': 'off',
  curly: 'off',
  'dot-notation': 'off',
  'no-else-return': 'off',
  eqeqeq: 'off',
  'prefer-const': 'off',
  'no-var': 'off',
}

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'docs/legacy-broker-ts/**',
      'docs/design/panel-graph-demo.html',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...STYLE_OFF,
      // 约定化选项：`_` 前缀 = 有意保留的占位（形参与变量），rest 兄弟 = 有意剔除字段——都不是死代码。
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
        caughtErrors: 'none',
      }],
    },
  },
  {
    // 客户端半（src/）：在浏览器里运行，浏览器全局合法；特性探测（typeof window 等）同样在册。
    files: ['src/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
]
