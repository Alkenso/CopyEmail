# CopyEmail landing page

The static site lives in `public/`. Run these commands from `web/`.

- Preview locally with `npx wrangler pages dev`.
- Deploy to Cloudflare Pages with `npx wrangler pages deploy`.
- For Git integration, use `web` as the root directory, `exit 0` as the build command, and `public` as the output directory.

The Chrome Web Store link is active. Set `STORE_LINKS.safariMac` and `STORE_LINKS.safariIOS` in `public/index.html` when their destinations are available.
