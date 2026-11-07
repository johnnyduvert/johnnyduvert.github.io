import PocketBase, { ClientResponseError, type RecordModel } from "pocketbase";
import {
  expandEventOccurrences,
  parseBlockDocument,
  type ContentFeedBlock,
  type EventRecord,
  type EventTranslationRecord,
  parsePreviewBlockDocument,
  type CmsLocale,
  type MediaRecord,
  type PagePreviewSnapshot,
  type PageTranslationRecord,
  type PostTranslationRecord,
  type SiteRecord,
  type SiteTranslationRecord,
} from "../lib/contracts";

const SITE_KEY = "johnnyduvert-se";
const SITE_LOCALE: CmsLocale = "sv";
const CMS_URL = (import.meta.env.VITE_CMS_URL || "http://127.0.0.1:8090").replace(/\/$/, "");

const freshFetch: typeof fetch = (input, init) => fetch(input, {
  ...init,
  cache: "no-store",
  headers: { ...init?.headers, "Cache-Control": "no-cache" },
});

function client() {
  const pb = new PocketBase(CMS_URL);
  pb.autoCancellation(false);
  pb.beforeSend = (url, options) => ({ url, options: { ...options, fetch: freshFetch } });
  return pb;
}

interface NavigationMenuRecord extends RecordModel {
  site: string;
  active: boolean;
}

interface NavigationItemRecord extends RecordModel {
  site: string;
  menu: string;
  target_type: "page" | "post" | "event" | "external";
  page: string;
  post: string;
  event: string;
  sort_order: number;
  open_in_new_tab: boolean;
  active: boolean;
}

interface NavigationTranslationRecord extends RecordModel {
  site: string;
  locale: "en" | "sv";
  navigation_item: string;
  label: string;
  external_url: string;
}

interface RedirectRecord extends RecordModel {
  destination: string;
  status_code: "301" | "302";
}

export interface NavigationLink {
  id: string;
  label: string;
  href: string;
  newTab: boolean;
}

export interface FeedEvent {
  translation: EventTranslationRecord;
  event: EventRecord;
  start: Date;
  end: Date;
}

export type FeedData =
  | { kind: "posts"; posts: PostTranslationRecord[] }
  | { kind: "events"; upcoming: FeedEvent[]; past: FeedEvent[] };

export interface LoadedSite {
  site: SiteRecord;
  translation: SiteTranslationRecord;
  page: PageTranslationRecord;
  navigation: NavigationLink[];
  media: Map<string, MediaRecord>;
  feeds: Map<string, FeedData>;
}

export class PageNotFoundError extends Error {}

function isNotFound(error: unknown) {
  return error instanceof ClientResponseError && error.status === 404;
}

function normalizePath(pathname: string) {
  if (!pathname || pathname === "/") return "/";
  return `/${pathname.split("/").filter(Boolean).map(decodeURIComponent).join("/")}`;
}

async function loadFeed(pb: PocketBase, site: SiteRecord, locale: CmsLocale, block: ContentFeedBlock): Promise<FeedData> {
  if (block.data.collection === "posts") {
    const result = await pb.collection<PostTranslationRecord>("post_translations").getList(1, block.data.limit, {
      filter: pb.filter("site = {:site} && locale = {:locale} && status = 'published'", { site: site.id, locale }),
      sort: "-publish_at",
      expand: "post,post.cover",
      fetch: freshFetch,
    });
    return {
      kind: "posts",
      posts: result.items.map((post) => ({ ...post, blocks: parseBlockDocument(post.blocks) })),
    };
  }

  const translations = await pb.collection<EventTranslationRecord>("event_translations").getFullList({
    filter: pb.filter("site = {:site} && locale = {:locale} && status = 'published'", { site: site.id, locale }),
    expand: "event",
    fetch: freshFetch,
  });
  const now = new Date();
  const horizon = new Date(now);
  horizon.setFullYear(horizon.getFullYear() + 2);
  const occurrences = translations.flatMap<FeedEvent>((translation) => {
    const event = translation.expand?.event;
    if (!event) return [];
    return expandEventOccurrences(event, horizon, 500).map((occurrence) => ({
      translation: { ...translation, blocks: parseBlockDocument(translation.blocks) },
      event,
      start: occurrence.start,
      end: occurrence.end,
    }));
  });
  const upcoming = occurrences.filter((item) => item.end >= now).sort((a, b) => a.start.getTime() - b.start.getTime());
  const past = occurrences.filter((item) => item.end < now).sort((a, b) => b.start.getTime() - a.start.getTime());
  const selected = block.data.range === "upcoming" ? upcoming : block.data.range === "past" ? past : [...upcoming, ...past];
  const limited = selected.slice(0, block.data.limit);
  return {
    kind: "events",
    upcoming: limited.filter((item) => item.end >= now),
    past: limited.filter((item) => item.end < now),
  };
}

/** Resolves the active site from the public site key. Never depends on a page existing. */
export async function resolveSite(pb = client()) {
  return pb.collection<SiteRecord>("sites").getFirstListItem(
    pb.filter("key = {:key} && active = true", { key: SITE_KEY }),
    { fetch: freshFetch },
  );
}

async function loadMedia(pb: PocketBase, site: SiteRecord) {
  const media = await pb.collection<MediaRecord>("media").getFullList({
    filter: pb.filter("site = {:site} && is_public = true", { site: site.id }),
    fetch: freshFetch,
  });
  return new Map(media.map((record) => [record.id, record]));
}

interface SiteChrome {
  translation: SiteTranslationRecord;
  navigation: NavigationLink[];
}

async function loadChrome(pb: PocketBase, site: SiteRecord, locale: CmsLocale): Promise<SiteChrome> {
  const [translation, menus, pages] = await Promise.all([
    pb.collection<SiteTranslationRecord>("site_translations").getFirstListItem(
      pb.filter("site = {:site} && locale = {:locale}", { site: site.id, locale }),
      { fetch: freshFetch },
    ),
    pb.collection<NavigationMenuRecord>("navigation_menus").getFullList({
      filter: pb.filter("site = {:site} && active = true", { site: site.id }),
      sort: "created",
      fetch: freshFetch,
    }),
    pb.collection<PageTranslationRecord>("page_translations").getFullList({
      filter: pb.filter("site = {:site} && locale = {:locale} && status = 'published'", { site: site.id, locale }),
      fetch: freshFetch,
    }),
  ]);

  const menu = menus[0];
  let navigation: NavigationLink[] = [];
  if (menu) {
    const [items, labels] = await Promise.all([
      pb.collection<NavigationItemRecord>("navigation_items").getFullList({
        filter: pb.filter("site = {:site} && menu = {:menu} && active = true", { site: site.id, menu: menu.id }),
        sort: "sort_order",
        fetch: freshFetch,
      }),
      pb.collection<NavigationTranslationRecord>("navigation_item_translations").getFullList({
        filter: pb.filter("site = {:site} && locale = {:locale}", { site: site.id, locale }),
        fetch: freshFetch,
      }),
    ]);
    const labelsByItem = new Map(labels.map((label) => [label.navigation_item, label]));
    const pagesByOwner = new Map(pages.map((record) => [record.page, record]));
    navigation = items.flatMap<NavigationLink>((item) => {
      const label = labelsByItem.get(item.id);
      const href = item.target_type === "page" ? pagesByOwner.get(item.page)?.path : item.target_type === "external" ? label?.external_url : "";
      return label?.label && href ? [{ id: item.id, label: label.label, href, newTab: item.open_in_new_tab }] : [];
    });
  }
  return { translation, navigation };
}

function feedBlocksOf(page: PageTranslationRecord) {
  return page.blocks.items.filter((block): block is ContentFeedBlock => block.type === "content_feed");
}

export async function loadSite(pathname: string): Promise<LoadedSite | { redirect: string }> {
  const pb = client();
  const path = normalizePath(pathname);
  const site = await resolveSite(pb);

  try {
    const redirect = await pb.collection<RedirectRecord>("redirects").getFirstListItem(
      pb.filter("site = {:site} && locale = {:locale} && source_path = {:path} && enabled = true", {
        site: site.id,
        locale: SITE_LOCALE,
        path: pathname,
      }),
      { fetch: freshFetch },
    );
    if (redirect.destination && redirect.destination !== pathname) return { redirect: redirect.destination };
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  const pageFilter = path === "/"
    ? pb.filter("site = {:site} && locale = {:locale} && page = {:page} && status = 'published'", { site: site.id, locale: SITE_LOCALE, page: site.homepage })
    : pb.filter("site = {:site} && locale = {:locale} && path = {:path} && status = 'published'", { site: site.id, locale: SITE_LOCALE, path });

  const [chrome, media, page] = await Promise.all([
    loadChrome(pb, site, SITE_LOCALE),
    loadMedia(pb, site),
    pb.collection<PageTranslationRecord>("page_translations").getFirstListItem(pageFilter, { fetch: freshFetch }).catch((error) => {
      if (isNotFound(error)) throw new PageNotFoundError(path);
      throw error;
    }),
  ]);

  const parsedPage = { ...page, blocks: parseBlockDocument(page.blocks) };
  const feedEntries = await Promise.all(feedBlocksOf(parsedPage).map(async (block) => [block.id, await loadFeed(pb, site, SITE_LOCALE, block)] as const));

  return { site, ...chrome, page: parsedPage, media, feeds: new Map(feedEntries) };
}

/**
 * Preview rendering context for one session. Site chrome loads once through the
 * public API in the session language; media and feeds refresh as the draft
 * references new ones. Snapshot data is kept in memory only.
 */
export interface PreviewContext {
  build(snapshot: PagePreviewSnapshot): Promise<LoadedSite>;
}

export function createPreviewContext(site: SiteRecord, locale: CmsLocale): PreviewContext {
  const pb = client();
  let chrome: Promise<SiteChrome> | null = null;
  let media: Promise<Map<string, MediaRecord>> | null = null;
  const feeds = new Map<string, Promise<FeedData>>();
  const retryOnFailure = <T>(promise: Promise<T>, reset: () => void) => promise.catch((error: unknown) => {
    reset();
    throw error;
  });

  return {
    async build(snapshot) {
      chrome ??= retryOnFailure(loadChrome(pb, site, locale), () => { chrome = null; });
      media ??= retryOnFailure(loadMedia(pb, site), () => { media = null; });
      const page = previewPageRecord(snapshot);
      const referenced = previewMediaIds(page);
      let mediaMap = await media;
      if (referenced.some((id) => !mediaMap.has(id))) {
        // Newly uploaded media may have appeared since the session started.
        media = retryOnFailure(loadMedia(pb, site), () => { media = null; });
        mediaMap = await media;
      }
      const feedEntries = await Promise.all(feedBlocksOf(page).map(async (block) => {
        const key = JSON.stringify(block.data);
        let feed = feeds.get(key);
        if (!feed) {
          feed = retryOnFailure(loadFeed(pb, site, locale, block), () => feeds.delete(key));
          feeds.set(key, feed);
        }
        return [block.id, await feed] as const;
      }));
      return { site, ...(await chrome), page, media: mediaMap, feeds: new Map(feedEntries) };
    },
  };
}

function previewPageRecord(snapshot: PagePreviewSnapshot): PageTranslationRecord {
  const { translation } = snapshot;
  return {
    id: `preview-${snapshot.pageId}`,
    collectionId: "",
    collectionName: "page_translations",
    created: "",
    updated: "",
    site: translation.site,
    page: translation.page,
    locale: translation.locale,
    title: translation.title,
    slug: translation.slug ?? "",
    path: translation.path,
    summary: translation.summary,
    blocks: parsePreviewBlockDocument(translation.blocks),
    seo_title: translation.seo_title,
    seo_description: translation.seo_description,
    canonical_url: translation.canonical_url ?? "",
    social_image: translation.social_image,
    no_index: true,
    status: translation.status ?? "draft",
    publish_at: translation.publish_at ?? "",
  };
}

function previewMediaIds(page: PageTranslationRecord) {
  const ids = page.blocks.items.flatMap((block) => ("mediaId" in block.data && block.data.mediaId ? [block.data.mediaId] : []));
  return page.social_image ? [...ids, page.social_image] : ids;
}

export function mediaUrl(media: MediaRecord, thumb = "1600x0") {
  return client().files.getURL(media, media.file, thumb ? { thumb } : undefined);
}

export function cmsBaseUrl() {
  return CMS_URL;
}
