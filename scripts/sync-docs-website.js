#!/usr/bin/env node

/**
 * Sync documentation files to the website
 * 
 * This script copies all markdown documentation from the docs/ directory
 * to the docs-website/content/ directory for the GitHub Pages site.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.join(__dirname, '..');
const docsDir = path.join(projectRoot, 'docs');
const websiteContentDir = path.join(projectRoot, 'docs-website', 'content');

async function syncDocs() {
    console.log('🔄 Syncing documentation to website...\n');
    
    try {
        // Create content directory if it doesn't exist
        await fs.mkdir(websiteContentDir, { recursive: true });
        
        // Get all markdown files from docs directory
        const files = await fs.readdir(docsDir);
        const mdFiles = files.filter(f => f.endsWith('.md'));
        
        // Copy each markdown file
        for (const file of mdFiles) {
            const source = path.join(docsDir, file);
            const dest = path.join(websiteContentDir, file);
            
            console.log(`📄 Copying ${file}...`);
            await fs.copyFile(source, dest);
        }
        
        // Create homepage content from README or custom content
        console.log('📄 Creating homepage...');
        const homepageContent = `# JSON REST API

Build powerful REST APIs in minutes with automatic validation, relationships, and advanced querying.

## Features

- 🚀 **Quick Setup** - Create a full API in under 5 minutes
- 🔌 **Plugin System** - Extend with storage adapters, auth, and more
- 🛡️ **Secure by Default** - JWT auth, RBAC, field security built-in
- 📊 **Advanced Queries** - Filtering, sorting, pagination, joins
- ✅ **Schema Validation** - Automatic validation and type safety
- 🎯 **Best Practices** - JSON:API compliant, RESTful design

## Get Started

Check out the [Quick Start Guide](QUICKSTART.md) to build your first API!

## Installation

\`\`\`bash
npm install json-rest-api
\`\`\`

## Example

\`\`\`javascript
import { createApi, Schema } from 'json-rest-api';

const api = createApi({ storage: 'memory' });

api.addResource('users', new Schema({
  name: { type: 'string', required: true },
  email: { type: 'string', required: true }
}));

// Full CRUD API ready at /api/users
\`\`\`
`;
        
        await fs.writeFile(path.join(websiteContentDir, 'index.md'), homepageContent);
        
        console.log('\n✅ Documentation synced successfully!');
        console.log(`📁 Files copied to: ${websiteContentDir}`);
        
    } catch (error) {
        console.error('❌ Error syncing documentation:', error);
        process.exit(1);
    }
}

// Run the sync
syncDocs();