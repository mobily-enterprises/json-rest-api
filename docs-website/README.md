# JSON REST API Documentation Website

This directory contains the GitHub Pages website for the JSON REST API documentation.

## 🚀 How to Deploy to GitHub Pages

### Option 1: Deploy from `docs-website` directory (Recommended)

1. **Push this directory to your GitHub repository**:
   ```bash
   git add docs-website/
   git commit -m "Add documentation website"
   git push origin main
   ```

2. **Enable GitHub Pages**:
   - Go to your repository on GitHub
   - Click on **Settings** (in the repository navigation)
   - Scroll down to **Pages** section (in the left sidebar)
   - Under **Source**, select **Deploy from a branch**
   - Under **Branch**, select `main` and `/docs-website` folder
   - Click **Save**

3. **Wait for deployment** (usually takes 2-5 minutes)

4. **Access your site**:
   - GitHub will show the URL at the top of the Pages settings
   - It will be: `https://[your-username].github.io/json-rest-api/`
   - Or if you set up a custom domain: `https://jsonrestapi.yourdomain.com`

### Option 2: Deploy using GitHub Actions

Create `.github/workflows/deploy-docs.yml`:

```yaml
name: Deploy Documentation

on:
  push:
    branches: [ main ]
    paths:
      - 'docs/**'
      - 'docs-website/**'
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pages: write
      id-token: write

    steps:
    - uses: actions/checkout@v4
    
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
    
    - name: Sync documentation
      run: node scripts/sync-docs-website.js
    
    - name: Deploy to GitHub Pages
      uses: peaceiris/actions-gh-pages@v3
      with:
        github_token: ${{ secrets.GITHUB_TOKEN }}
        publish_dir: ./docs-website
```

## 📝 Updating Documentation

When you update any documentation in the `docs/` directory:

1. **Run the sync script**:
   ```bash
   npm run sync-docs
   # or
   node scripts/sync-docs-website.js
   ```

2. **Commit and push**:
   ```bash
   git add docs-website/content/
   git commit -m "Update documentation"
   git push
   ```

The changes will automatically deploy to GitHub Pages!

## 🛠️ Local Development

To test the website locally:

1. **Install a local server** (if you don't have one):
   ```bash
   npm install -g http-server
   ```

2. **Run the server**:
   ```bash
   cd docs-website
   http-server -p 8080
   ```

3. **Open in browser**:
   ```
   http://localhost:8080
   ```

## 📁 Directory Structure

```
docs-website/
├── index.html          # Main HTML file
├── style.css           # Styles
├── app.js              # JavaScript app
├── content/            # Synced markdown files
│   ├── index.md       # Homepage content
│   ├── GUIDE.md       # Main guide
│   ├── QUICKSTART.md  # Quick start guide
│   └── ...            # Other documentation
├── .nojekyll          # Disable Jekyll processing
├── CNAME              # Custom domain (optional)
└── README.md          # This file
```

## 🎨 Customization

### Change Theme Colors

Edit `style.css` and modify the CSS variables:

```css
:root {
    --primary-color: #0366d6;  /* Change this */
    --border-color: #e1e4e8;
    --bg-color: #f6f8fa;
    --text-color: #24292e;
}
```

### Add Custom Domain

1. Edit `CNAME` file with your domain
2. Configure your domain's DNS to point to GitHub Pages
3. Enable HTTPS in GitHub Pages settings

### Modify Navigation

Edit the navigation in `index.html`:

```html
<div class="nav-section">
    <h3>Your Section</h3>
    <ul>
        <li><a href="#" onclick="loadDoc('YOUR_DOC')">Your Page</a></li>
    </ul>
</div>
```

## 🔧 Troubleshooting

### Site not updating?
- Check GitHub Pages deployment status in Actions tab
- Clear browser cache (Ctrl+Shift+R)
- Wait a few minutes for changes to propagate

### 404 errors?
- Ensure all markdown files are in `content/` directory
- Run sync script after adding new docs
- Check file names match exactly (case-sensitive)

### Custom domain not working?
- Verify DNS settings (A records or CNAME)
- Check CNAME file has correct domain
- Enable HTTPS in GitHub Pages settings

## 📄 License

This documentation website is part of the JSON REST API project.