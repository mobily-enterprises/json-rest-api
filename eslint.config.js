import neostandard from 'neostandard'

export default [
  ...neostandard({
    ignores: ['node_modules/**', 'docs/**', 'tests/**', 'examples/**']
  }),
  {
    files: ['index.js'],
    rules: {
      'import-x/export': 'off'
    }
  }
]
