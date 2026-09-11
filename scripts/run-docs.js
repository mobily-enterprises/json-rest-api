#!/usr/bin/env node

import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.join(__dirname, '..')
const docsRoot = path.join(projectRoot, 'docs')
const LOCAL_URL = 'http://localhost:4000/json-rest-api/'
const BROWSER_DELAY_MS = 3000

function parseMode (argv = []) {
  if (argv.includes('--serve') || argv.includes('--dev')) {
    return 'serve'
  }

  return 'build'
}

async function runCommand (command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      timeout: 600000,
      killSignal: 'SIGKILL',
      ...options
    })

    proc.on('error', reject)
    proc.on('close', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`Command failed ${signal ? `with signal ${signal}` : `with code ${code}`}`))
    })
  })
}

async function ensureBundlerDependencies () {
  try {
    await runCommand('bundle', ['check'], { cwd: docsRoot })
  } catch {
    console.log('Installing Jekyll dependencies...')
    await runCommand('bundle', ['install'], { cwd: docsRoot })
  }
}

async function openBrowser (url) {
  const platform = process.platform
  const command = platform === 'darwin'
    ? 'open'
    : platform === 'win32'
      ? 'start'
      : 'xdg-open'

  try {
    await runCommand(command, [url], { timeout: 15000 })
    console.log(`Opened browser at ${url}`)
  } catch {
    console.log(`Visit ${url} in your browser`)
  }
}

async function buildDocs () {
  console.log('Building documentation site...')
  await runCommand('bundle', ['exec', 'jekyll', 'build'], { cwd: docsRoot })
}

async function serveDocs () {
  console.log('Starting documentation server...')

  const jekyll = spawn('bundle', ['exec', 'jekyll', 'serve', '--watch'], {
    cwd: docsRoot,
    stdio: 'pipe',
    shell: process.platform === 'win32'
  })

  let shuttingDown = false
  let browserOpened = false
  const launchBrowser = () => {
    if (browserOpened || shuttingDown) return
    browserOpened = true
    clearTimeout(browserTimer)
    if (!process.argv.includes('--no-open')) openBrowser(LOCAL_URL)
  }

  jekyll.stdout.on('data', (data) => {
    const output = data.toString()
    process.stdout.write(output)

    if (output.includes('Server running') || output.includes('Server address:')) {
      launchBrowser()
    }
  })

  jekyll.stderr.on('data', (data) => {
    process.stderr.write(data)
  })

  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    clearTimeout(browserTimer)
    console.log('\nShutting down Jekyll server...')
    jekyll.kill()
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  jekyll.on('error', (err) => {
    console.error('Jekyll server error:', err)
    clearTimeout(browserTimer)
    process.exitCode = 1
  })

  jekyll.on('close', (code) => {
    clearTimeout(browserTimer)
    process.off('SIGINT', shutdown)
    process.off('SIGTERM', shutdown)
    if (!shuttingDown && code !== 0) {
      console.error(`Jekyll server exited with code ${code}`)
      process.exitCode = code || 1
    }
  })

  const browserTimer = setTimeout(launchBrowser, BROWSER_DELAY_MS)
}

async function main () {
  const mode = parseMode(process.argv.slice(2))

  try {
    await ensureBundlerDependencies()

    if (mode === 'serve') {
      await serveDocs()
      return
    }

    await buildDocs()
  } catch (error) {
    console.error('Error:', error.message)
    process.exit(1)
  }
}

main()
