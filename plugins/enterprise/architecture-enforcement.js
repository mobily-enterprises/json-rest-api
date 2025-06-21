import { ApiError } from '../../index.js'

export const ArchitectureEnforcementPlugin = {
  install(api, options = {}) {
    const {
      namingConventions = {},
      requiredPlugins = [],
      requiredHooks = {},
      allowedOperations = {},
      relationshipRules = {},
      environment = process.env.NODE_ENV || 'development'
    } = options

    const violations = []

    api.hook('afterAddResource', async (context) => {
      const { name, options: resourceOptions } = context
      
      // Check naming conventions
      if (namingConventions.resources) {
        const pattern = new RegExp(namingConventions.resources)
        if (!pattern.test(name)) {
          violations.push(`Resource '${name}' violates naming convention: ${namingConventions.resources}`)
        }
      }

      // Check required hooks
      if (requiredHooks[name] || requiredHooks['*']) {
        const required = [...(requiredHooks[name] || []), ...(requiredHooks['*'] || [])]
        const implemented = Object.keys(resourceOptions.hooks || {})
        
        for (const hook of required) {
          if (!implemented.includes(hook)) {
            violations.push(`Resource '${name}' missing required hook: ${hook}`)
          }
        }
      }

      // Check schema field naming
      if (namingConventions.fields && resourceOptions.schema) {
        const fieldPattern = new RegExp(namingConventions.fields)
        for (const field of Object.keys(resourceOptions.schema.fields)) {
          if (!fieldPattern.test(field)) {
            violations.push(`Field '${name}.${field}' violates naming convention: ${namingConventions.fields}`)
          }
        }
      }

      // Validate relationships
      if (resourceOptions.schema) {
        for (const [field, config] of Object.entries(resourceOptions.schema.fields)) {
          if (config.refs) {
            // Check relationship patterns
            if (relationshipRules.allowedPatterns) {
              const allowed = relationshipRules.allowedPatterns.some(pattern => {
                if (pattern.from === name || pattern.from === '*') {
                  if (pattern.to === config.refs || pattern.to === '*') {
                    return true
                  }
                }
                return false
              })
              
              if (!allowed) {
                violations.push(`Relationship '${name}.${field}' -> '${config.refs}' is not allowed by architecture rules`)
              }
            }

            // Check max relationships per resource
            if (relationshipRules.maxPerResource) {
              const refCount = Object.values(resourceOptions.schema.fields)
                .filter(f => f.refs).length
              if (refCount > relationshipRules.maxPerResource) {
                violations.push(`Resource '${name}' has ${refCount} relationships, max allowed: ${relationshipRules.maxPerResource}`)
              }
            }
          }
        }
      }
    })

    // Check required plugins on API start
    api.hook('beforeOperation', { priority: -1000 }, async (context) => {
      if (!api._architectureChecked) {
        api._architectureChecked = true

        // Check required plugins
        for (const required of requiredPlugins) {
          if (!api._installedPlugins?.includes(required)) {
            violations.push(`Required plugin '${required}' is not installed`)
          }
        }

        // Check operation restrictions
        const operation = `${context.method}:${context.resource}`
        if (allowedOperations[environment]) {
          const allowed = allowedOperations[environment]
          if (allowed.blockedOperations?.includes(operation)) {
            throw new ApiError(`Operation '${operation}' is not allowed in ${environment} environment`, 403)
          }
          
          if (allowed.blockedResources?.includes(context.resource)) {
            throw new ApiError(`Resource '${context.resource}' is not accessible in ${environment} environment`, 403)
          }
        }

        // Report all violations
        if (violations.length > 0) {
          const message = 'Architecture violations detected:\n' + violations.map(v => `  - ${v}`).join('\n')
          if (options.strict !== false) {
            throw new ApiError(message, 500)
          } else {
            console.warn(message)
          }
        }
      }
    })

    // Track installed plugins
    api._installedPlugins = api._installedPlugins || []
    api._installedPlugins.push('ArchitectureEnforcementPlugin')

    // Audit trail enforcement
    if (options.enforceAudit) {
      api.hook('afterInsert', { priority: -100 }, async (context) => {
        if (!context.auditRecorded) {
          throw new ApiError(`Audit trail not recorded for insert on '${context.resource}'`, 500)
        }
      })
      
      api.hook('afterUpdate', { priority: -100 }, async (context) => {
        if (!context.auditRecorded) {
          throw new ApiError(`Audit trail not recorded for update on '${context.resource}'`, 500)
        }
      })
      
      api.hook('afterDelete', { priority: -100 }, async (context) => {
        if (!context.auditRecorded) {
          throw new ApiError(`Audit trail not recorded for delete on '${context.resource}'`, 500)
        }
      })
    }

    // API to check current violations
    api.checkArchitecture = () => {
      return {
        valid: violations.length === 0,
        violations: [...violations]
      }
    }

    // Method to register custom architecture rules
    api.addArchitectureRule = (rule) => {
      if (rule.type === 'custom') {
        api.hook('afterAddResource', async (context) => {
          const result = await rule.validate(context)
          if (!result.valid) {
            violations.push(result.message)
          }
        })
      }
    }
  }
}