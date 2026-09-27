# snagthisvid.com

The SnagThis website: a static site with no build step. `index.html` is the home page (with the playable demo), `privacy.html` is the privacy policy (also the Chrome Web Store privacy policy URL), `help.html` is help and troubleshooting (the extension's **Troubleshooting** link opens it), and `404.html` is the not-found page. All pages share `styles.css` and `main.js`. `_headers` sets the security headers and caching.

## Preview locally

```sh
npx http-server site
```

Then open the address it prints. `/privacy` and `/help` work locally too, because http-server adds `.html`; missing pages show `404.html`.

## Cloudflare deployment

The site deploys as a Cloudflare **Worker with static assets**, configured by `wrangler.jsonc` in this folder (`.assetsignore` keeps the config and this README off the public site). In **Workers & Pages → Create → Import a repository**, choose this repository and set:

| Setting | Value |
| --- | --- |
| Project name | `snagthis` (must match `name` in `wrangler.jsonc`) |
| Build command | *(empty)* |
| Deploy command | `npx wrangler deploy` |
| Advanced settings → Path | `site` |
| Production branch | `main` |

Every push to `main` redeploys. `/privacy` serves `privacy.html`, unknown paths get `404.html` with a 404 status, and `_headers` applies.

### Custom domain

In the Worker, open **Settings → Domains & Routes → Add → Custom domain** and enter `snagthisvid.com` (and `www.snagthisvid.com` if you want it). With the domain's DNS on Cloudflare, the record is created for you.

## Editing notes

- Keep the Content Security Policy strict: no inline `<script>` or `<style>`, no `style="…"` attributes and no `data:` URIs. Put styles in `styles.css` and scripts in `main.js`.
- Files in `fonts/`, `img/` and `media/` are cached for a year. When you change one, give it a new file name.
- Don’t name specific video sites or platforms anywhere on the site (Chrome Web Store policy).
- Update the effective date in `privacy.html` and `lastmod` in `sitemap.xml` when the policy changes.
- The product recordings in `media/ui/` come from `scripts/capture-site-media.cjs` (see its header). Re-run it after the app or popup changes; it writes new hashed file names and updates `index.html` for you.
