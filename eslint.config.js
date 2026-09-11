import neostandard from 'neostandard'

export default [
  ...neostandard({
    ignores: ['node_modules/**', 'docs/**', 'examples/**', 'old/**']
  }),
  {
    files: ['index.js'],
    rules: {
      'import-x/export': 'off'
    }
  }
]
