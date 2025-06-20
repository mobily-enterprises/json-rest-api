// Markdown renderer configuration
marked.setOptions({
    highlight: function(code, lang) {
        if (Prism.languages[lang]) {
            return Prism.highlight(code, Prism.languages[lang], lang);
        }
        return code;
    },
    breaks: true,
    gfm: true
});

// State
let currentDoc = 'index';
const cache = new Map();

// Load markdown document
async function loadDoc(docName) {
    const contentEl = document.getElementById('content');
    
    // Show loading state
    contentEl.innerHTML = '<div class="loading">Loading...</div>';
    
    // Update active nav item
    document.querySelectorAll('.nav-section a').forEach(a => a.classList.remove('active'));
    event?.target?.classList.add('active');
    
    try {
        let content;
        
        // Check cache first
        if (cache.has(docName)) {
            content = cache.get(docName);
        } else {
            // Fetch the markdown file
            const response = await fetch(`content/${docName}.md`);
            if (!response.ok) {
                throw new Error(`Failed to load ${docName}`);
            }
            content = await response.text();
            cache.set(docName, content);
        }
        
        // Process the markdown
        let html;
        if (docName === 'index') {
            // Homepage gets special treatment
            html = renderHomepage();
        } else {
            // Fix relative links in the content
            content = fixRelativeLinks(content, docName);
            html = marked.parse(content);
        }
        
        // Update content
        contentEl.innerHTML = html;
        
        // Highlight code blocks
        Prism.highlightAll();
        
        // Scroll to top
        window.scrollTo(0, 0);
        
        // Update URL
        currentDoc = docName;
        history.pushState({ doc: docName }, '', `#${docName}`);
        
        // Close mobile menu
        closeSidebar();
        
    } catch (error) {
        contentEl.innerHTML = `
            <div class="error">
                <h2>Error loading documentation</h2>
                <p>${error.message}</p>
                <p>Please try again or <a href="https://github.com/mobily-enterprises/json-rest-api/issues">report an issue</a>.</p>
            </div>
        `;
    }
}

// Fix relative links in markdown content
function fixRelativeLinks(content, currentFile) {
    // Fix links to other docs
    content = content.replace(/\]\(\.\/([^)]+)\.md\)/g, (match, file) => {
        return `](#" onclick="loadDoc('${file}')`;
    });
    
    // Fix links to examples
    content = content.replace(/\]\(\.\/examples\/([^)]+)\)/g, (match, file) => {
        return `](https://github.com/mobily-enterprises/json-rest-api/blob/main/docs/examples/${file})`;
    });
    
    // Fix links to parent directory docs
    content = content.replace(/\]\(\.\.\/examples\/([^)]+)\)/g, (match, file) => {
        return `](https://github.com/mobily-enterprises/json-rest-api/blob/main/examples/${file})`;
    });
    
    return content;
}

// Render homepage
function renderHomepage() {
    return `
        <div class="hero">
            <h1>JSON REST API</h1>
            <p>Build powerful REST APIs in minutes, not hours</p>
            <div class="hero-buttons">
                <a href="#" onclick="loadDoc('QUICKSTART')" class="hero-button">Get Started</a>
                <a href="https://github.com/mobily-enterprises/json-rest-api" class="hero-button secondary">View on GitHub</a>
            </div>
        </div>
        
        <h2>🚀 Why JSON REST API?</h2>
        
        <div class="features">
            <div class="feature">
                <h3>⚡ Lightning Fast Setup</h3>
                <p>Create a full-featured REST API with just a few lines of code. No boilerplate, no configuration hell.</p>
            </div>
            
            <div class="feature">
                <h3>🛡️ Secure by Default</h3>
                <p>Built-in JWT authentication, RBAC authorization, CORS handling, and field-level security.</p>
            </div>
            
            <div class="feature">
                <h3>🔌 Plugin Architecture</h3>
                <p>Extend functionality with plugins. Storage adapters, authentication, versioning, and more.</p>
            </div>
            
            <div class="feature">
                <h3>📊 Powerful Queries</h3>
                <p>Advanced filtering, sorting, pagination, and joins. Handle complex queries with ease.</p>
            </div>
            
            <div class="feature">
                <h3>✅ Schema Validation</h3>
                <p>Define your data structure once. Automatic validation, type coercion, and error handling.</p>
            </div>
            
            <div class="feature">
                <h3>🎯 Best Practices</h3>
                <p>JSON:API compliant, RESTful design, proper error handling, and comprehensive documentation.</p>
            </div>
        </div>
        
        <h2>Quick Example</h2>
        
        <pre><code class="language-javascript">import { createApi, Schema } from 'json-rest-api';

const api = createApi({ storage: 'memory' });

api.addResource('tasks', new Schema({
  title: { type: 'string', required: true },
  done: { type: 'boolean', default: false }
}));

// That's it! Full CRUD API ready at /api/tasks</code></pre>
        
        <h2>Ready to start?</h2>
        
        <p>Check out the <a href="#" onclick="loadDoc('QUICKSTART')">Quick Start Guide</a> to build your first API in 5 minutes!</p>
    `;
}

// Toggle mobile sidebar
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

function closeSidebar() {
    if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.remove('open');
    }
}

// Handle browser back/forward
window.addEventListener('popstate', (event) => {
    const doc = event.state?.doc || 'index';
    loadDoc(doc);
});

// Handle initial load
document.addEventListener('DOMContentLoaded', () => {
    // Check URL hash
    const hash = window.location.hash.slice(1);
    const initialDoc = hash || 'index';
    
    // Find and click the corresponding nav item
    const links = document.querySelectorAll('.nav-section a');
    for (const link of links) {
        if (link.getAttribute('onclick')?.includes(initialDoc)) {
            link.click();
            return;
        }
    }
    
    // Fallback to loading directly
    loadDoc(initialDoc);
});

// Close sidebar on outside click (mobile)
document.addEventListener('click', (event) => {
    const sidebar = document.getElementById('sidebar');
    const isClickInsideSidebar = sidebar.contains(event.target);
    const isMenuToggle = event.target.classList.contains('menu-toggle');
    
    if (!isClickInsideSidebar && !isMenuToggle && sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
    }
});