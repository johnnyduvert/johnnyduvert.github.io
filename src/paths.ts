// Deployment-base helpers. CMS paths (`/`, `/spelningar`) are relative to the
// deployment root, which is `/` on a custom domain and `/<repository>/` on a
// GitHub Pages project site. Vite's `base` setting decides which one applies.

const BASE = import.meta.env.BASE_URL.replace(/\/+$/, "");

/** URL for a file in `public/`, valid at any nested address (including 404.html). */
export function assetUrl(path: string) {
  return `${BASE}/${path.replace(/^\/+/, "")}`;
}

function normalize(path: string) {
  return path.replace(/\/+$/, "") || "/";
}

/** Browser pathname → CMS path. Only the deployment base is stripped. */
export function toSitePath(pathname: string) {
  if (BASE && (pathname === BASE || pathname.startsWith(`${BASE}/`))) return normalize(pathname.slice(BASE.length));
  return normalize(pathname);
}

/** Whether a browser pathname lies inside the deployment root. */
export function isWithinBase(pathname: string) {
  return !BASE || pathname === BASE || pathname.startsWith(`${BASE}/`);
}

/** CMS path (optionally with query/hash) → browser URL path. */
export function toBrowserPath(sitePath: string) {
  if (!sitePath.startsWith("/") || sitePath.startsWith("//")) return sitePath;
  if (!BASE) return sitePath;
  return sitePath === "/" ? `${BASE}/` : `${BASE}${sitePath}`;
}

/** Deployment root URL (what the CMS `primary_url` should point to). */
export function deploymentUrl() {
  const explicit = import.meta.env.VITE_SITE_URL;
  if (explicit) return new URL(explicit.endsWith("/") ? explicit : `${explicit}/`);
  return new URL(`${BASE}/`, window.location.origin);
}
