# GFV website

The landing page and the documentation, built into plain static files. There is no framework: the pages come from
`scripts/build-site.mjs`, the styles from `site/assets/site.css` and the small bit of behaviour from
`site/assets/site.js`. The documentation is generated from the Markdown guides in this repository, so it cannot drift
from them.

## Build and preview

```bash
pnpm site:preview     # builds with a local address and serves http://127.0.0.1:4400
pnpm site:build       # builds into site/dist for deployment
```

## Settings

| Variable    | Meaning                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SITE_URL`  | Where the site lives, for canonical links, the sitemap and social cards. A path in it (like `/gui-for-vps`) becomes the base path automatically. |
| `BASE_PATH` | Overrides the base path. Leave it empty for a custom domain or a `*.vercel.app` address.                                                         |
| `CNAME`     | A custom domain to write into a `CNAME` file (GitHub Pages).                                                                                     |

## What to edit

- **Landing page text and layout:** `landing()` in `scripts/build-site.mjs`.
- **Docs content:** the Markdown files. `docs/USER_GUIDE.md` is split into one page per `##` heading. The sidebar order
  is the `NAV` list in the build script.
- **Look and feel:** `site/assets/site.css` (colour tokens are at the top, light and dark).
- **Images:** `site/assets/img/`. Screenshots are WebP, made from `docs/screenshots` and `docs/preview.png`.

## Deploying

See the notes in the pull request or the project documentation: GitHub Pages is set up by `.github/workflows/pages.yml`.
Vercel, Netlify and Cloudflare Pages work with the build command `pnpm site:build` and the output directory `site/dist`.
