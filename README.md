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

GitHub Pages serves `public/404.html` for unknown paths. It hands the requested URL to the SPA, which then asks the CMS whether that path is a published page or redirect. This keeps new CMS pages dynamic without adding application routes or rebuilding the site.

The custom domain is defined in `public/CNAME`. GitHub Pages HTTPS should be enforced after DNS is connected.
