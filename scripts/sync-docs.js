#!/usr/bin/env node

/**
 * Sync documentation files to the Jekyll docs site
 * 
 * This script copies markdown documentation from the root directory
 * to the docs/ directory for the GitHub Pages Jekyll site.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.join(__dirname, '..');
const docsDir = path.join(projectRoot, 'docs');

// Files to sync from root to docs
const filesToSync = [
  'README.md',
  'QUICKSTART.md',
  'GUIDE.md',
  'API.md',
  'ONBOARDING.md',
  'COMPARISON.md',
  'DISCOVERY.md',
  'JSON-API-COMPLIANCE.md',
  'SECURITY.md'
];

// Pattern for GUIDE_*.md files
const guidePattern = /^GUIDE_\d+_.*\.md$/;

async function syncDocs() {
    console.log('🔄 Syncing documentation to Jekyll site...\n');
    
    try {
        // Ensure docs directory exists
        await fs.mkdir(docsDir, { recursive: true });
        
        // Get all files in root directory
        const rootFiles = await fs.readdir(projectRoot);
        
        // Find all GUIDE_*.md files
        const guideFiles = rootFiles.filter(f => guidePattern.test(f));
        
        // Combine explicit files and guide files
        const allFiles = [...new Set([...filesToSync, ...guideFiles])];
        
        // Copy each file that exists
        for (const file of allFiles) {
            const source = path.join(projectRoot, file);
            const dest = path.join(docsDir, file);
            
            try {
                await fs.access(source);
                console.log(`📄 Copying ${file}...`);
                await fs.copyFile(source, dest);
            } catch (err) {
                console.log(`⚠️  Skipping ${file} (not found)`);
            }
        }
        
        // Handle enterprise directory if it exists
        const enterpriseSource = path.join(projectRoot, 'enterprise');
        const enterpriseDest = path.join(docsDir, 'enterprise');
        
        try {
            await fs.access(enterpriseSource);
            console.log('\n📁 Syncing enterprise directory...');
            await fs.mkdir(enterpriseDest, { recursive: true });
            
            const enterpriseFiles = await fs.readdir(enterpriseSource);
            for (const file of enterpriseFiles) {
                if (file.endsWith('.md')) {
                    console.log(`📄 Copying enterprise/${file}...`);
                    await fs.copyFile(
                        path.join(enterpriseSource, file),
                        path.join(enterpriseDest, file)
                    );
                }
            }
        } catch (err) {
            console.log('⚠️  No enterprise directory found');
        }
        
        // Handle examples directory if it exists
        const examplesSource = path.join(projectRoot, 'examples');
        const examplesDest = path.join(docsDir, 'examples');
        
        try {
            await fs.access(examplesSource);
            console.log('\n📁 Syncing examples directory...');
            await fs.mkdir(examplesDest, { recursive: true });
            
            const exampleFiles = await fs.readdir(examplesSource);
            for (const file of exampleFiles) {
                if (file.endsWith('.js') || file.endsWith('.md')) {
                    console.log(`📄 Copying examples/${file}...`);
                    await fs.copyFile(
                        path.join(examplesSource, file),
                        path.join(examplesDest, file)
                    );
                }
            }
        } catch (err) {
            console.log('⚠️  No examples directory found');
        }
        
        console.log('\n✅ Documentation synced successfully!');
        console.log(`📁 Files copied to: ${docsDir}`);
        console.log('\n💡 Run "npm run docs:dev" to preview the site locally');
        
    } catch (error) {
        console.error('❌ Error syncing documentation:', error);
        process.exit(1);
    }
}

// Run the sync
syncDocs();