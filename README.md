# johnnyduvert.se

A static React site for Johnny Duvert, powered by the Oortis headless CMS. There are no page-specific routes in the app: `/` resolves the site's `homepage` relation and every other path resolves a published `page_translations.path` at runtime.

## Local development

Requirements: Node.js 22+ and a running PocketBase instance for `../headless-cms`.

```sh
cp .env.example .env.local
npm install
npm run dev
```

`VITE_CMS_URL` must point to the CMS API. The default example uses `http://127.0.0.1:8090` for local development.

Useful checks:

```sh
npm run lint
npm test
npm run build
```

## GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and publishes `dist/` with GitHub Pages. Configure the repository variable `VITE_CMS_URL` with the public **HTTPS** URL of the PocketBase API before running it. That API must allow browser requests from `https://www.johnnyduvert.se`.

The build generates `404.html` from the built `index.html` (see `vite.config.ts`). GitHub Pages serves it for unknown paths. Without a preview token it hands the requested URL to the app root, which asks the CMS whether that path is a published page or redirect. This keeps new CMS pages dynamic without adding application routes or rebuilding the site.

For a project site (`https://owner.github.io/<repository>/`) build with `VITE_BASE_PATH=/<repository>/`. `VITE_SITE_URL` optionally pins the deployment root; otherwise it is the browser origin plus the base path.

## Page preview

The CMS Preview button opens `<primary_url><path>?preview=<token>`. Set the site's `primary_url` in the CMS to the deployment root (`https://www.johnnyduvert.se/`). Preview runs entirely in the browser, following `../headless-cms/docs/preview-requirements.md`:

- `index.html` contains the early bootstrap (no-referrer, `noindex,nofollow`, hidden `#page-content`); the generated `404.html` includes it too, so previews of new or unpublished paths render in place despite the HTTP 404.
- `src/preview.ts` resolves the site from the public site key, then polls `GET /api/cms/preview` once per second with the token in the `X-CMS-Preview` header. Snapshots and the token stay in memory only.
- The page renders with the normal layout; menus, media and feeds load from the public API in the snapshot's language. A fixed indicator shows expiry and connection status. Expiry, `404` and `410` remove the preview immediately, even while offline.
- Following a link off the previewed page ends the preview and loads the published page.

The CMS API's CORS policy must allow the site's origin and the `X-CMS-Preview` request header.

The custom domain is defined in `public/CNAME`. GitHub Pages HTTPS should be enforced after DNS is connected.
