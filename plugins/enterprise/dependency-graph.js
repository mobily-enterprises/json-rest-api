import { ApiError } from '../../index.js'

export const DependencyGraphPlugin = {
  install(api, options = {}) {
    const {
      detectCircular = true,
      maxDepth = 10,
      exportFormat = 'json' // json, dot, mermaid
    } = options

    // Build dependency graph on demand
    const buildDependencyGraph = () => {
      const graph = {
        nodes: {},
        edges: []
      }

      // Add all resources as nodes
      for (const [name, resource] of Object.entries(api.resources)) {
        graph.nodes[name] = {
          name,
          schema: resource.schema,
          dependencies: [],
          dependents: [],
          fields: {}
        }
      }

      // Build edges from refs
      for (const [resourceName, resource] of Object.entries(api.resources)) {
        if (!resource.schema) continue
        
        for (const [fieldName, fieldConfig] of Object.entries(resource.schema.fields)) {
          if (fieldConfig.refs) {
            const targetResource = fieldConfig.refs.resource || fieldConfig.refs
            
            // Record edge
            graph.edges.push({
              from: resourceName,
              to: targetResource,
              field: fieldName,
              type: fieldConfig.refs.type || 'reference',
              required: fieldConfig.required || false
            })

            // Update nodes
            if (graph.nodes[resourceName]) {
              graph.nodes[resourceName].dependencies.push({
                resource: targetResource,
                field: fieldName,
                required: fieldConfig.required
              })
              graph.nodes[resourceName].fields[fieldName] = targetResource
            }

            if (graph.nodes[targetResource]) {
              graph.nodes[targetResource].dependents.push({
                resource: resourceName,
                field: fieldName,
                required: fieldConfig.required
              })
            }
          }
        }
      }

      return graph
    }

    // Detect circular dependencies using DFS
    const detectCircularDependencies = (graph) => {
      const circles = []
      const visited = {}
      const recursionStack = {}

      const dfs = (node, path = []) => {
        visited[node] = true
        recursionStack[node] = true
        path.push(node)

        const dependencies = graph.nodes[node]?.dependencies || []
        for (const dep of dependencies) {
          const target = dep.resource
          
          if (!visited[target]) {
            dfs(target, [...path])
          } else if (recursionStack[target]) {
            // Found circular dependency
            const circleStart = path.indexOf(target)
            const circle = path.slice(circleStart)
            circle.push(target) // Complete the circle
            circles.push(circle)
          }
        }

        recursionStack[node] = false
      }

      // Check each unvisited node
      for (const node of Object.keys(graph.nodes)) {
        if (!visited[node]) {
          dfs(node)
        }
      }

      return circles
    }

    // Impact analysis - what breaks if a resource changes
    const analyzeImpact = (resourceName, graph, depth = 0) => {
      if (depth > maxDepth) return { direct: [], indirect: [] }

      const impacts = {
        direct: [],
        indirect: []
      }

      const resource = graph.nodes[resourceName]
      if (!resource) return impacts

      // Direct impacts (resources that depend on this one)
      impacts.direct = resource.dependents.map(dep => ({
        resource: dep.resource,
        field: dep.field,
        required: dep.required,
        severity: dep.required ? 'high' : 'medium'
      }))

      // Indirect impacts (cascade effects)
      const visited = new Set([resourceName])
      const queue = resource.dependents.map(d => ({ ...d, depth: 1 }))

      while (queue.length > 0 && depth < maxDepth) {
        const current = queue.shift()
        if (visited.has(current.resource)) continue
        
        visited.add(current.resource)
        const currentNode = graph.nodes[current.resource]
        
        if (currentNode && current.depth > 1) {
          impacts.indirect.push({
            resource: current.resource,
            path: current.path || [resourceName, current.resource],
            depth: current.depth
          })
        }

        // Add next level
        if (currentNode && current.depth < maxDepth) {
          for (const dep of currentNode.dependents) {
            queue.push({
              ...dep,
              depth: current.depth + 1,
              path: [...(current.path || [resourceName, current.resource]), dep.resource]
            })
          }
        }
      }

      return impacts
    }

    // Export graph in different formats
    const exportGraph = (graph, format = exportFormat) => {
      switch (format) {
        case 'dot':
          return exportToDot(graph)
        case 'mermaid':
          return exportToMermaid(graph)
        case 'json':
        default:
          return graph
      }
    }

    const exportToDot = (graph) => {
      let dot = 'digraph DependencyGraph {\n'
      dot += '  rankdir=LR;\n'
      dot += '  node [shape=box];\n\n'

      // Add nodes
      for (const node of Object.keys(graph.nodes)) {
        dot += `  "${node}";\n`
      }
      dot += '\n'

      // Add edges
      for (const edge of graph.edges) {
        const style = edge.required ? 'solid' : 'dashed'
        dot += `  "${edge.from}" -> "${edge.to}" [label="${edge.field}", style=${style}];\n`
      }

      dot += '}'
      return dot
    }

    const exportToMermaid = (graph) => {
      let mermaid = 'graph LR\n'

      // Add nodes and edges
      for (const edge of graph.edges) {
        const arrow = edge.required ? '-->' : '-.->'
        mermaid += `  ${edge.from}[${edge.from}] ${arrow}|${edge.field}| ${edge.to}[${edge.to}]\n`
      }

      return mermaid
    }

    // Migration helper - detect what needs updating when schema changes
    const analyzeMigration = (resourceName, schemaChanges) => {
      const graph = buildDependencyGraph()
      const impacts = analyzeImpact(resourceName, graph)
      
      const migration = {
        resource: resourceName,
        changes: schemaChanges,
        requiredUpdates: []
      }

      // Check if removed fields are referenced elsewhere
      if (schemaChanges.removedFields) {
        for (const field of schemaChanges.removedFields) {
          // This is a simplified check - in reality would need deeper analysis
          for (const impact of impacts.direct) {
            migration.requiredUpdates.push({
              resource: impact.resource,
              field: impact.field,
              action: 'update_reference',
              reason: `References removed field ${resourceName}.${field}`
            })
          }
        }
      }

      // Check if type changes affect references
      if (schemaChanges.typeChanges) {
        for (const [field, change] of Object.entries(schemaChanges.typeChanges)) {
          if (change.from === 'id' && change.to !== 'id') {
            // ID field changed to non-ID, breaks references
            for (const impact of impacts.direct) {
              migration.requiredUpdates.push({
                resource: impact.resource,
                field: impact.field,
                action: 'remove_reference',
                reason: `${resourceName}.${field} is no longer an ID field`
              })
            }
          }
        }
      }

      return migration
    }

    // API methods
    api.dependencies = {
      graph: () => buildDependencyGraph(),
      
      circles: () => {
        const graph = buildDependencyGraph()
        return detectCircularDependencies(graph)
      },
      
      impact: (resourceName) => {
        const graph = buildDependencyGraph()
        return analyzeImpact(resourceName, graph)
      },
      
      export: (format) => {
        const graph = buildDependencyGraph()
        return exportGraph(graph, format)
      },
      
      migration: (resourceName, changes) => {
        return analyzeMigration(resourceName, changes)
      },
      
      validate: () => {
        const graph = buildDependencyGraph()
        const circles = detectCircularDependencies(graph)
        
        if (circles.length > 0 && detectCircular) {
          throw new ApiError(`Circular dependencies detected: ${circles.map(c => c.join(' -> ')).join(', ')}`, 500)
        }
        
        return {
          valid: circles.length === 0,
          circles,
          stats: {
            resources: Object.keys(graph.nodes).length,
            relationships: graph.edges.length,
            maxDependencies: Math.max(...Object.values(graph.nodes).map(n => n.dependencies.length)),
            maxDependents: Math.max(...Object.values(graph.nodes).map(n => n.dependents.length))
          }
        }
      }
    }

    // Auto-validate on resource addition if configured
    if (detectCircular) {
      api.hook('afterAddResource', async () => {
        // Delay validation to allow all resources to be added first
        setTimeout(() => {
          try {
            api.dependencies.validate()
          } catch (error) {
            console.error(error.message)
            if (options.strict) {
              throw error
            }
          }
        }, 0)
      })
    }
  }
}