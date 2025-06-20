# 🌐 How to Deploy the Documentation Website on GitHub Pages

This guide shows you how to deploy the JSON REST API documentation as a beautiful website using GitHub Pages.

## Quick Start (3 steps)

### 1️⃣ Push to GitHub
```bash
git add docs-website/
git commit -m "Add documentation website"
git push origin main
```

### 2️⃣ Enable GitHub Pages
1. Go to your repository on GitHub.com
2. Click **Settings** → **Pages** (in left sidebar)
3. Under **Source**, select **Deploy from a branch**
4. Under **Branch**, choose:
   - Branch: `main`
   - Folder: `/docs-website`
5. Click **Save**

### 3️⃣ Access Your Site
- Wait 2-5 minutes
- Your site will be at: `https://[your-username].github.io/json-rest-api/`
- The URL appears at the top of the Pages settings

## Keeping Docs in Sync

When you update documentation in the `docs/` folder:

```bash
# 1. Sync the changes to the website
npm run sync-docs

# 2. Commit and push
git add docs-website/content/
git commit -m "Update documentation"
git push
```

The website updates automatically!

## Test Locally

```bash
# Start local server
npm run docs:dev

# Open in browser
# http://localhost:8080
```

## Custom Domain (Optional)

1. Edit `docs-website/CNAME` with your domain
2. Add DNS records pointing to GitHub:
   - A records: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - OR CNAME record: `[your-username].github.io`
3. Enable HTTPS in Pages settings

## Troubleshooting

**Site not showing?**
- Check Actions tab for deployment status
- Verify Pages is enabled in Settings
- Clear browser cache

**404 errors?**
- Run `npm run sync-docs` after adding new docs
- Check file names (case-sensitive!)

## How It Works

1. **Original docs stay in `/docs`** - Your markdown files remain where they are
2. **Sync script copies to website** - `npm run sync-docs` copies them to `/docs-website/content`
3. **Website renders markdown** - JavaScript app converts markdown to beautiful HTML
4. **GitHub Pages serves it** - Automatically deploys when you push

That's it! Your documentation is now a professional website. 🎉