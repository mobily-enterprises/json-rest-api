import { ApiError } from '../index.js'
import readline from 'readline'

export const CLIPlugin = {
  install(api, options = {}) {
    api.cli = {
      start() {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
          prompt: 'api> '
        })

        console.log('JSON REST API CLI')
        console.log('Commands: <resource>.<method>(...args), help, exit')
        console.log('Example: users.get(1), users.create({name: "John"})')
        
        rl.prompt()

        rl.on('line', async (line) => {
          const trimmed = line.trim()
          
          if (trimmed === 'exit') {
            rl.close()
            return
          }

          if (trimmed === 'help') {
            console.log('\nAvailable resources:', Object.keys(api.resources).join(', '))
            console.log('Methods: get(id), query(options), create(data), update(id, data), delete(id)\n')
            rl.prompt()
            return
          }

          if (trimmed === '') {
            rl.prompt()
            return
          }

          try {
            const result = await api.cli.execute(trimmed)
            console.log(JSON.stringify(result, null, 2))
          } catch (error) {
            console.error('Error:', error.message)
          }

          rl.prompt()
        })

        rl.on('close', () => {
          console.log('\nGoodbye!')
          process.exit(0)
        })
      },

      async execute(command) {
        const match = command.match(/^(\w+)\.(\w+)\((.*)\)$/)
        if (!match) {
          throw new Error('Invalid command format. Use: resource.method(args)')
        }

        const [, resource, method, argsString] = match
        
        if (!api.resources[resource]) {
          throw new Error(`Unknown resource: ${resource}`)
        }

        let args = []
        if (argsString.trim()) {
          try {
            args = new Function(`return [${argsString}]`)()
          } catch (e) {
            throw new Error(`Invalid arguments: ${e.message}`)
          }
        }

        const methodMap = {
          get: 'get',
          query: 'query', 
          create: 'insert',
          update: 'update',
          delete: 'delete'
        }

        const actualMethod = methodMap[method] || method
        
        if (!api.resources[resource][actualMethod]) {
          throw new Error(`Unknown method: ${method}`)
        }

        return await api.resources[resource][actualMethod](...args)
      },

      async runCommand(args) {
        const [command, ...params] = args
        
        if (command === 'get' && params.length >= 2) {
          const [resource, id] = params
          return await api.resources[resource].get(id)
        }
        
        if (command === 'create' && params.length >= 2) {
          const [resource, ...dataArgs] = params
          const data = dataArgs.join(' ')
          try {
            const parsed = JSON.parse(data)
            return await api.resources[resource].insert(parsed)
          } catch (e) {
            throw new Error('Invalid JSON data')
          }
        }

        if (command === 'list' && params.length >= 1) {
          const [resource] = params
          return await api.resources[resource].query()
        }

        throw new Error('Unknown command. Try: get, create, list')
      }
    }
  }
}