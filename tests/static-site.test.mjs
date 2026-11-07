import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("uses a framework-neutral static GitHub Pages build", async () => {
  const [packageJson, workflow, cname] = await Promise.all([
    read("package.json"),
    read(".github/workflows/deploy.yml"),
    read("public/CNAME"),
  ]);
  const manifest = JSON.parse(packageJson);

  assert.equal(manifest.scripts.build, "tsc --noEmit && vite build");
  assert.equal(typeof manifest.devDependencies.vite, "string");
  for (const forbidden of ["wrangler", "vinext", "next", "@cloudflare/vite-plugin"]) {
    assert.equal(manifest.dependencies?.[forbidden], undefined);
    assert.equal(manifest.devDependencies?.[forbidden], undefined);
  }
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /\.nojekyll/);
  assert.match(workflow, /git push -q origin master/);
  assert.doesNotMatch(workflow, /--force/);
  assert.match(workflow, /VITE_CMS_URL/);
  assert.equal(cname.trim(), "www.johnnyduvert.se");
});

test("restores arbitrary GitHub Pages paths before the app starts", async () => {
  const [config, entry] = await Promise.all([read("vite.config.ts"), read("src/main.tsx")]);

  // 404.html is generated from the built index.html (see vite.config.ts).
  assert.match(config, /fileName: "404\.html"/);
  assert.match(config, /location\.pathname \+ location\.search \+ location\.hash/);
  assert.match(config, /__route/);
  assert.match(config, /searchParams\.has\('preview'\)/);
  assert.match(entry, /history\.replaceState/);
});

test("bootstraps CMS previews before styles and app scripts", async () => {
  const html = await read("index.html");
  const bootstrap = html.indexOf("searchParams.has('preview')");
  assert.ok(html.indexOf('<meta name="referrer" content="no-referrer"') > -1);
  assert.match(html, /html\[data-cms-preview\] #page-content \{ visibility: hidden; \}/);
  assert.match(html, /noindex,nofollow/);
  assert.ok(bootstrap > -1 && bootstrap < html.indexOf("<link"), "bootstrap precedes asset requests");
  assert.ok(bootstrap < html.indexOf('type="module"'), "bootstrap precedes the app script");
});

test("reads previews through the header with no caching or persistence", async () => {
  const [preview, app] = await Promise.all([read("src/preview.ts"), read("src/App.tsx")]);

  assert.match(preview, /"X-CMS-Preview": currentToken/);
  assert.match(preview, /cache: "no-store"/);
  assert.match(preview, /credentials: "omit"/);
  assert.match(preview, /status === 404 \|\| response\.status === 410/);
  assert.doesNotMatch(preview, /searchParams\.set\("(?:preview|token)"/);
  assert.doesNotMatch(preview + app, /localStorage|sessionStorage|indexedDB|caches\./);
  assert.match(app, /id="page-content"/);
});

test("resolves content routes and feeds from the CMS", async () => {
  const [cms, app] = await Promise.all([read("src/cms.ts"), read("src/App.tsx")]);

  assert.match(cms, /site\.homepage/);
  assert.match(cms, /page_translations/);
  assert.match(cms, /path = \{:path\}/);
  assert.match(cms, /block\.type === "content_feed"/);
  assert.match(app, /StageLoader/);
  assert.doesNotMatch(app, /case\s+["']\/(?:nyheter|turnedatum|johnny|bilder)/);
});
