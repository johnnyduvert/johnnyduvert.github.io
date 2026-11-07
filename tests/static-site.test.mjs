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
  const [fallback, entry] = await Promise.all([
    read("public/404.html"),
    read("src/main.tsx"),
  ]);

  assert.match(fallback, /location\.pathname \+ location\.search \+ location\.hash/);
  assert.match(fallback, /__route/);
  assert.match(entry, /history\.replaceState/);
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
