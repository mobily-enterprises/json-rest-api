# Deploying the Documentation Website on GitHub Pages

This project uses GitHub Pages to host documentation directly from the `/docs` folder.

## Quick Start (2 steps)

### 1. Enable GitHub Pages
1. Go to your repository on GitHub.com
2. Click **Settings** → **Pages** (in left sidebar)
3. Under **Source**, select **Deploy from a branch**
4. Under **Branch**, choose:
   - Branch: `main`
   - Folder: `/docs`
5. Click **Save**

### 2. Access Your Site
- Wait 2-5 minutes for initial deployment
- Your site will be at: `https://[your-username].github.io/json-rest-api/`
- The URL appears at the top of the Pages settings

## How It Works

GitHub Pages automatically:
- Serves files from the `/docs` folder
- Processes Markdown files using Jekyll
- Uses the `_config.yml` for theme and settings
- Shows `index.md` as the homepage

## Making Changes

Simply edit any `.md` files in the `/docs` folder:

```bash
# Edit documentation
vim docs/GUIDE.md

# Commit and push
git add docs/
git commit -m "Update documentation"
git push
```

The website updates automatically within minutes!

## Local Preview (Optional)

To preview the site locally with Jekyll:

```bash
# Install Jekyll (one time)
gem install bundler jekyll

cd docs
bundle config set --local path 'vendor/bundle'
bundle install
bundle exec jekyll serve


# Open http://localhost:4000
```

## Custom Domain (Optional)

1. Create `docs/CNAME` with your domain
2. Add DNS records pointing to GitHub:
   - A records: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - OR CNAME record: `[your-username].github.io`
3. Enable HTTPS in Pages settings

## Troubleshooting

**Site not showing?**
- Check Actions tab for deployment status
- Verify Pages is enabled in Settings
- Ensure `/docs` folder is selected

**404 errors?**
- Check file names (case-sensitive!)
- Verify links use `.md` extension
- Clear browser cache

That's it! No build scripts or generators needed - GitHub Pages handles everything. 🎉