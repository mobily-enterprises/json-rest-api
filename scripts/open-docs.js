#!/usr/bin/env node

/**
 * Open the GitHub Pages documentation site
 */

import { spawn } from 'child_process';

const GITHUB_PAGES_URL = 'https://mobily-enterprises.github.io/json-rest-api/';

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
        spawn(command, [url], { shell: true });
        console.log(`🌐 Opening ${url}`);
    } catch (err) {
        console.log(`💡 Visit ${url} in your browser`);
    }
}

openBrowser(GITHUB_PAGES_URL);