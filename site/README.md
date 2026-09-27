# snagthisvid.com

The SnagThis website: a static site with no build step. `index.html` is the home page (with the playable demo), `privacy.html` is the privacy policy (also the Chrome Web Store privacy policy URL), `help.html` is help and troubleshooting (the extension's **Troubleshooting** link opens it), and `404.html` is the not-found page. All pages share `styles.css` and `main.js`. `_headers` sets the security headers and caching.

## Preview locally

```sh
npx http-server site
```

Then open the address it prints. `/privacy` and `/help` work locally too, because http-server adds `.html`; missing pages show `404.html`.

## Cloudflare Pages

Connect this repository in **Workers & Pages → Create → Pages → Connect to Git**, with:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Build command | *(empty)* |
| Build output directory | `site` |
| Production branch | `main` |

Pages serves `privacy.html` at `/privacy`, uses `404.html` for missing pages, and applies `_headers`.

### Custom domain

In the Pages project, open **Custom domains → Set up a custom domain**, enter `snagthisvid.com` and follow the prompts. If the domain's DNS is on Cloudflare, the record is added for you; otherwise add the CNAME it shows at your DNS provider. Add `www.snagthisvid.com` the same way if you want it, and redirect it to the apex domain with a Bulk Redirect or Redirect Rule.

## Editing notes

- Keep the Content Security Policy strict: no inline `<script>` or `<style>`, no `style="…"` attributes and no `data:` URIs. Put styles in `styles.css` and scripts in `main.js`.
- Files in `fonts/`, `img/` and `media/` are cached for a year. When you change one, give it a new file name.
- Don’t name specific video sites or platforms anywhere on the site (Chrome Web Store policy).
- Update the effective date in `privacy.html` and `lastmod` in `sitemap.xml` when the policy changes.
