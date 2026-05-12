// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'lib',
    ignores: [
      '**/.tmigrate/**',
      'packages/**/*.js',
      'packages/**/*.md',
    ],
    rules: {
      'no-console': 'off',
      'ts/explicit-function-return-type': 'off',
    },
  },
)
