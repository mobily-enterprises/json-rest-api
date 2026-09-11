import neostandard from 'neostandard'

export default [
  ...neostandard({
    ignores: ['node_modules/**', 'docs/**', 'examples/**']
  }),
  {
    files: ['index.js'],
    rules: {
      'import-x/export': 'off'
    }
  }
]
