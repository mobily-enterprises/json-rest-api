#!/usr/bin/env node

/**
 * Run the documentation site
 * 
 * This script:
 * 1. Syncs documentation files
 * 2. Builds the Jekyll site
 * 3. Starts the server
 * 4. Opens the browser
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

// Delay before opening browser (milliseconds)
const BROWSER_DELAY = 3000;

// Site URLs
const LOCAL_URL = 'http://localhost:4000/json-rest-api/';
const GITHUB_PAGES_URL = 'https://mobily-enterprises.github.io/json-rest-api/';

async function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, {
            stdio: 'inherit',
            shell: true,
            ...options
        });
        
        proc.on('error', reject);
        proc.on('exit', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Command failed with code ${code}`));
            }
        });
    });
}

async function openBrowser(url) {
    const platform = process.platform;
    let command;
    
    if (platform === 'darwin') {
        command = 'open';
    } else if (platform === 'win32') {
        command = 'start';
    } else {
        // Linux
        command = 'xdg-open';
    }
    
    try {
        await runCommand(command, [url]);
        console.log(`\n🌐 Opened browser at ${url}`);
    } catch (err) {
        console.log(`\n💡 Visit ${url} in your browser`);
    }
}

async function main() {
    console.log('📚 Starting documentation site...\n');
    
    try {
        // Step 1: Sync documentation
        console.log('1️⃣  Syncing documentation files...');
        await runCommand('npm', ['run', 'docs:sync']);
        
        // Step 2: Install Jekyll dependencies if needed
        const bundleLockPath = path.join(projectRoot, 'docs', 'Gemfile.lock');
        try {
            await fs.access(bundleLockPath);
        } catch {
            console.log('\n2️⃣  Installing Jekyll dependencies...');
            await runCommand('bundle', ['install'], {
                cwd: path.join(projectRoot, 'docs')
            });
        }
        
        // Step 3: Start Jekyll server in background
        console.log('\n3️⃣  Starting Jekyll server...');
        const jekyll = spawn('bundle', ['exec', 'jekyll', 'serve', '--watch'], {
            cwd: path.join(projectRoot, 'docs'),
            stdio: 'pipe',
            shell: true
        });
        
        // Handle server output
        jekyll.stdout.on('data', (data) => {
            const output = data.toString();
            process.stdout.write(output);
            
            // Open browser when server is ready
            if (output.includes('Server running') || output.includes('Server address:')) {
                setTimeout(() => openBrowser(LOCAL_URL), 1000);
            }
        });
        
        jekyll.stderr.on('data', (data) => {
            process.stderr.write(data);
        });
        
        // Handle shutdown
        process.on('SIGINT', () => {
            console.log('\n\n👋 Shutting down Jekyll server...');
            jekyll.kill();
            process.exit(0);
        });
        
        jekyll.on('error', (err) => {
            console.error('❌ Jekyll server error:', err);
            process.exit(1);
        });
        
        jekyll.on('exit', (code) => {
            if (code !== 0 && code !== null) {
                console.error(`❌ Jekyll server exited with code ${code}`);
                process.exit(code);
            }
        });
        
        // Wait a bit then try to open browser anyway (in case we missed the server ready message)
        setTimeout(() => openBrowser(LOCAL_URL), BROWSER_DELAY);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

// Run the script
main();