import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const FALLBACK_MARKER = "<!--github-pages-fallback-->";

/**
 * GitHub Pages serves 404.html for addresses missing from the build. It is the
 * built index.html, so a CMS preview of a new or unpublished page renders in
 * place (keeping its path and query). Without a preview token it keeps the
 * usual behaviour: hand the path to the app root, which resolves it via the CMS.
 */
function githubPagesFallback(): Plugin {
  let base = "/";
  return {
    name: "github-pages-fallback",
    enforce: "post",
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: "post",
      handler: (html) => html.replace(FALLBACK_MARKER, ""),
    },
    generateBundle(_, bundle) {
      const index = bundle["index.html"];
      if (index?.type !== "asset") throw new Error("index.html missing from bundle");
      // transformIndexHtml already removed the marker; re-insert after the bootstrap.
      const redirect = `<script>
      if (!new URL(location.href).searchParams.has('preview')) {
        document.documentElement.dataset.cmsFallbackRedirect = '';
        location.replace(${JSON.stringify(base)} + '?__route=' + encodeURIComponent(location.pathname + location.search + location.hash));
      }
    </script>`;
      const html = String(index.source);
      const anchor = "</script>";
      const at = html.indexOf(anchor);
      if (at < 0) throw new Error("preview bootstrap missing from index.html");
      const fallback = `${html.slice(0, at + anchor.length)}\n    ${redirect}${html.slice(at + anchor.length)}`;
      this.emitFile({ type: "asset", fileName: "404.html", source: fallback });
    },
  };
}

export default defineConfig({
  // `/` for the custom domain; set VITE_BASE_PATH=/<repository>/ for a project site.
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react(), githubPagesFallback()],
  build: { target: "es2022" },
});
