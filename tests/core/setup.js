import { createApi, Schema } from '../../index.js'
import express from 'express'
import { exec } from 'child_process'
import { promisify } from 'util'
import { robustTeardown } from '../lib/test-teardown.js'
import path from 'path'
import { fileURLToPath } from 'url'

const execAsync = promisify(exec)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Helper to run curl commands
export async function curl(command) {
  try {
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    })
    
    // Try to parse as JSON if possible
    try {
      return { 
        success: true, 
        data: JSON.parse(stdout), 
        raw: stdout,
        stderr 
      }
    } catch {
      return { 
        success: true, 
        data: null, 
        raw: stdout,
        stderr 
      }
    }
  } catch (error) {
    // Extract HTTP status code from curl error
    const statusMatch = error.stderr?.match(/HTTP\/[\d.]+\s+(\d+)/)
    const statusCode = statusMatch ? parseInt(statusMatch[1]) : null
    
    // Try to parse error response body
    let errorData = null
    try {
      // Extract JSON from stderr (curl outputs response body there on error)
      const jsonMatch = error.stdout?.match(/\{.*\}/s)
      if (jsonMatch) {
        errorData = JSON.parse(jsonMatch[0])
      }
    } catch {}
    
    return {
      success: false,
      error: error.message,
      stderr: error.stderr,
      stdout: error.stdout,
      statusCode,
      data: errorData,
      code: error.code
    }
  }
}

// Test schemas
export const userSchema = new Schema({
  name: { type: 'string', required: true, min: 2, max: 50, searchable: true },
  email: { type: 'string', format: 'email', required: true, searchable: true },
  age: { type: 'number', min: 0, max: 150 },
  bio: { type: 'string', max: 500 },
  password: { type: 'string', silent: true, min: 6 },
  isActive: { type: 'boolean', default: true, searchable: true },
  role: { type: 'string', enum: ['admin', 'user', 'guest'], default: 'user', searchable: true },
  tags: { type: 'array', items: { type: 'string' } },
  metadata: { type: 'object' },
  createdAt: { type: 'datetime', onCreate: 'now()' },
  updatedAt: { type: 'datetime', onUpdate: 'now()' }
})

export const postSchema = new Schema({
  title: { type: 'string', required: true, searchable: true },
  content: { type: 'string', required: true },
  authorId: { 
    type: 'id', 
    required: true,
    refs: { 
      resource: 'users',
      join: {
        eager: true,
        fields: ['id', 'name', 'email'],
        preserveId: true
      }
    }
  },
  categoryId: {
    type: 'id',
    refs: {
      resource: 'categories'
    }
  },
  status: { type: 'string', enum: ['draft', 'published', 'archived'], default: 'draft', searchable: true },
  publishedAt: { type: 'datetime' },
  tags: { type: 'array', searchable: true },
  views: { type: 'number', default: 0, min: 0 },
  position: { type: 'number' }
})

export const categorySchema = new Schema({
  name: { type: 'string', required: true, searchable: true },
  description: { type: 'string' },
  parentId: {
    type: 'id',
    refs: {
      resource: 'categories',
      join: {
        eager: false
      }
    }
  },
  position: { type: 'number' }
})

export const commentSchema = new Schema({
  postId: {
    type: 'id',
    required: true,
    searchable: true,
    refs: {
      resource: 'posts'
    }
  },
  userId: {
    type: 'id',
    required: true,
    searchable: true,
    refs: {
      resource: 'users',
      join: {
        eager: true,
        fields: ['id', 'name']
      }
    }
  },
  content: { type: 'string', required: true, min: 1, max: 1000 },
  parentId: {
    type: 'id',
    refs: {
      resource: 'comments'
    }
  },
  createdAt: { type: 'datetime', onCreate: 'now()' }
})

// Start test server
export async function startTestServer(storageType = 'memory', options = {}) {
  const app = express()
  
  // Get database connection if MySQL
  let connection = null
  const mysqlConfig = {
    host: 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: 'test_json_api',
    timezone: 'Z',
    multipleStatements: true
  }
  
  if (storageType === 'mysql') {
    const mysql = await import('mysql2/promise')
    connection = await mysql.createConnection(mysqlConfig)
    
    // Clear database
    await connection.execute('SET FOREIGN_KEY_CHECKS = 0')
    const [tables] = await connection.execute(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'test_json_api'"
    )
    for (const { table_name } of tables) {
      await connection.execute(`DROP TABLE IF EXISTS \`${table_name}\``)
    }
    await connection.execute('SET FOREIGN_KEY_CHECKS = 1')
  }
  
  // Create API
  const apiOptions = {
    storage: storageType,
    http: { app },
    debug: options.debug || false,
    ...options.apiOptions
  }
  
  if (storageType === 'mysql') {
    apiOptions.mysql = { connection: mysqlConfig }
  }
  
  const api = createApi(apiOptions)
  
  // Add resources
  api.addResource('users', userSchema, options.userOptions)
  api.addResource('posts', postSchema, options.postOptions)
  api.addResource('categories', categorySchema, options.categoryOptions)
  api.addResource('comments', commentSchema, options.commentOptions)
  
  // Add any custom hooks
  if (options.hooks) {
    for (const [name, handler] of Object.entries(options.hooks)) {
      api.hook(name, handler)
    }
  }
  
  // Start server on random port
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, () => resolve(srv))
  })
  
  const port = server.address().port
  const baseUrl = `http://localhost:${port}`
  
  return {
    api,
    app,
    server,
    connection,
    baseUrl,
    port,
    async cleanup() {
      await new Promise(resolve => server.close(resolve))
      if (connection) {
        await robustTeardown({ api, connection })
      }
    }
  }
}

// Helper to create curl command with common options
export function curlCmd(url, options = {}) {
  let cmd = `curl -s` // -s silent
  
  // For HEAD requests, use -I instead of -i
  if (options.method === 'HEAD') {
    cmd += ' -I'
  } else {
    cmd += ' -i' // -i include headers
  }
  
  if (options.method && options.method !== 'HEAD') {
    cmd += ` -X ${options.method}`
  }
  
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      cmd += ` -H "${key}: ${value}"`
    }
  }
  
  if (options.data) {
    const jsonData = typeof options.data === 'string' 
      ? options.data 
      : JSON.stringify(options.data)
    // Escape single quotes for shell
    const escapedData = jsonData.replace(/'/g, "'\\''")
    cmd += ` -d '${escapedData}'`
  }
  
  if (options.verbose) {
    cmd += ' -v'
  }
  
  // Properly encode URL for shell
  const encodedUrl = url.replace(/\[/g, '%5B').replace(/\]/g, '%5D')
  
  return `${cmd} "${encodedUrl}"`
}

// Parse curl response with headers
export function parseResponse(raw) {
  const parts = raw.split('\r\n\r\n')
  const headerSection = parts[0]
  const body = parts.slice(1).join('\r\n\r\n').trim()
  
  // Parse status line
  const statusLine = headerSection.split('\r\n')[0]
  const statusMatch = statusLine.match(/HTTP\/[\d.]+\s+(\d+)\s*(.*)/)
  const status = statusMatch ? parseInt(statusMatch[1]) : null
  const statusText = statusMatch ? statusMatch[2] : null
  
  // Parse headers
  const headers = {}
  const headerLines = headerSection.split('\r\n').slice(1)
  for (const line of headerLines) {
    const colonIndex = line.indexOf(':')
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim().toLowerCase()
      const value = line.substring(colonIndex + 1).trim()
      headers[key] = value
    }
  }
  
  // Parse body
  let data = null
  if (body) {
    try {
      data = JSON.parse(body)
    } catch {
      data = body
    }
  }
  
  return {
    status,
    statusText,
    headers,
    body,
    data
  }
}

// Test runner helper
export async function runHttpTests(name, fn) {
  console.log(`\n${'='.repeat(50)}`)
  console.log(`HTTP Tests: ${name}`)
  console.log(`${'='.repeat(50)}`)
  
  for (const storageType of ['memory', 'mysql']) {
    if (storageType === 'mysql' && !process.env.MYSQL_USER) {
      console.log(`⚠️  Skipping MySQL tests (set MYSQL_USER and MYSQL_PASSWORD)`)
      continue
    }
    
    console.log(`\n--- Testing with ${storageType} storage ---`)
    
    let context = null
    try {
      context = await startTestServer(storageType)
      await fn(context, storageType)
      console.log(`✅ ${name} (${storageType}) - PASSED`)
    } catch (error) {
      console.error(`❌ ${name} (${storageType}) - FAILED:`, error.message)
      if (error.response) {
        console.error('Response:', error.response)
      }
      throw error
    } finally {
      if (context) {
        await context.cleanup()
      }
    }
  }
}

// Assertion helpers
export function assertStatus(response, expectedStatus) {
  if (response.status !== expectedStatus) {
    const error = new Error(`Expected status ${expectedStatus}, got ${response.status}`)
    error.response = response
    throw error
  }
}

export function assertJsonApiResponse(response) {
  if (!response.data || typeof response.data !== 'object') {
    throw new Error('Response is not valid JSON:API format')
  }
  
  // Single resource
  if (response.data.data && !Array.isArray(response.data.data)) {
    if (!response.data.data.type || !response.data.data.id) {
      throw new Error('Single resource missing type or id')
    }
  }
  
  // Collection
  if (response.data.data && Array.isArray(response.data.data)) {
    for (const item of response.data.data) {
      if (!item.type || (!item.id && item.id !== null)) {
        throw new Error('Collection item missing type or id')
      }
    }
  }
}

export function assertHasHeader(response, header, value = null) {
  const headerLower = header.toLowerCase()
  if (!response.headers[headerLower]) {
    throw new Error(`Missing header: ${header}`)
  }
  
  if (value !== null && response.headers[headerLower] !== value) {
    throw new Error(`Header ${header} expected "${value}", got "${response.headers[headerLower]}"`)
  }
}

// Wait helper for async operations
export function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}