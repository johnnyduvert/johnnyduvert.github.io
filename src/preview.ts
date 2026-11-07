// Browser-only page preview, per headless-cms/docs/preview-requirements.md.
// The token and snapshots live in memory only: never in storage, logs, the CMS
// query string or generated HTML.
import { ClientResponseError } from "pocketbase";
import { parsePreviewSnapshot, type PagePreviewSnapshot, type SiteRecord } from "../lib/contracts";
import { cmsBaseUrl, resolveSite } from "./cms";
import { deploymentUrl, isWithinBase, toSitePath } from "./paths";

export type PreviewEndReason = "expired" | "unavailable" | "mismatch" | "site-unavailable";

export type PreviewStatus =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "disconnected" }
  | { kind: "ended"; reason: PreviewEndReason };

export interface PreviewCallbacks {
  /** A validated snapshot with a new revision. Render it with the usual layout. */
  onSnapshot(snapshot: PagePreviewSnapshot, site: SiteRecord): void;
  /** Remove all override content immediately (expiry, invalidation, shutdown). */
  onClear(): void;
  onStatus(status: PreviewStatus): void;
}

const POLL_INTERVAL = 1000;

/** Reads the token from the address bar. Returns null when this is not a preview. */
export function readPreviewToken() {
  return new URL(window.location.href).searchParams.get("preview");
}

function normalize(path: string) {
  return path.replace(/\/+$/, "") || "/";
}

/** Whether the current address is still the route this preview was opened for. */
export function isPreviewTarget(targetSitePath: string) {
  return toSitePath(window.location.pathname) === targetSitePath;
}

function matchesWebsite(snapshot: PagePreviewSnapshot, siteId: string, sitePath: string) {
  return snapshot.schemaVersion === 1
    && snapshot.siteId === siteId
    && normalize(snapshot.targetPath) === sitePath
    && snapshot.page.site === siteId
    && snapshot.page.id === snapshot.pageId
    && snapshot.translation.site === siteId
    && snapshot.translation.page === snapshot.pageId
    && snapshot.translation.locale === snapshot.locale
    && snapshot.translation.path === snapshot.targetPath
    && Number.isFinite(Date.parse(snapshot.expiresAt));
}

/**
 * Starts the preview session. Returns a disposer that stops polling, aborts the
 * in-flight request and discards the token and snapshot.
 */
export function startPreview(token: string, callbacks: PreviewCallbacks): () => void {
  const deployment = deploymentUrl();
  const withinSite = window.location.origin === deployment.origin && isWithinBase(window.location.pathname);
  const sitePath = toSitePath(window.location.pathname);

  let currentToken: string | null = token;
  let site: SiteRecord | null = null;
  let snapshot: PagePreviewSnapshot | null = null;
  let stopped = false;
  let poll: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | null = null;
  let siteFailures = 0;

  const shutdown = () => {
    stopped = true;
    clearTimeout(poll);
    clearTimeout(deadline);
    request?.abort();
    request = null;
    currentToken = null;
    snapshot = null;
    window.removeEventListener("focus", checkDeadline);
    window.removeEventListener("pageshow", checkDeadline);
    document.removeEventListener("visibilitychange", checkDeadline);
  };

  const end = (reason: PreviewEndReason) => {
    if (stopped) return;
    shutdown();
    callbacks.onClear();
    callbacks.onStatus({ kind: "ended", reason });
  };

  function checkDeadline() {
    if (snapshot && Date.now() >= Date.parse(snapshot.expiresAt)) end("expired");
  }

  const schedule = (delay = POLL_INTERVAL) => {
    if (!stopped) poll = setTimeout(tick, delay);
  };

  async function ensureSite() {
    if (site) return site;
    try {
      site = await resolveSite();
      return site;
    } catch (error) {
      // An inactive/unknown site is final; anything else is transient. Never
      // fall through to published content while preview mode is active.
      if (error instanceof ClientResponseError && error.status === 404) {
        end("site-unavailable");
        return null;
      }
      siteFailures += 1;
      throw error;
    }
  }

  async function tick() {
    checkDeadline();
    if (stopped || !currentToken) return;
    try {
      const resolved = await ensureSite();
      if (stopped || !resolved) return;
      if (!withinSite) {
        end("mismatch");
        return;
      }
      request = new AbortController();
      const url = new URL("/api/cms/preview", `${cmsBaseUrl()}/`);
      url.searchParams.set("site", resolved.id);
      if (snapshot) url.searchParams.set("revision", String(snapshot.revision));
      const response = await fetch(url, {
        headers: { "X-CMS-Preview": currentToken },
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: request.signal,
      });
      if (stopped) return;
      if (response.status === 404 || response.status === 410) {
        end(response.status === 410 ? "expired" : "unavailable");
        return;
      }
      if (response.status !== 204) {
        if (!response.ok) throw new Error("Preview connection failed");
        const next = parsePreviewSnapshot(await response.json());
        if (stopped) return;
        if (!next || !matchesWebsite(next, resolved.id, sitePath)) {
          end("mismatch");
          return;
        }
        snapshot = next;
        checkDeadline();
        if (stopped) return;
        clearTimeout(deadline);
        // setTimeout clamps delays above ~24.8 days; sessions last one hour.
        deadline = setTimeout(checkDeadline, Math.max(0, Date.parse(next.expiresAt) - Date.now()));
        callbacks.onSnapshot(next, resolved);
      }
      checkDeadline();
      if (!stopped) callbacks.onStatus({ kind: "connected" });
      schedule();
    } catch {
      checkDeadline();
      if (stopped) return;
      callbacks.onStatus(site ? { kind: "disconnected" } : { kind: "connecting" });
      // Back off a little while the site lookup itself keeps failing.
      schedule(site ? POLL_INTERVAL : Math.min(5000, POLL_INTERVAL * 2 ** Math.min(siteFailures, 3)));
    } finally {
      request = null;
    }
  }

  window.addEventListener("focus", checkDeadline);
  window.addEventListener("pageshow", checkDeadline);
  document.addEventListener("visibilitychange", checkDeadline);
  callbacks.onStatus({ kind: "connecting" });
  void tick();
  return shutdown;
}
