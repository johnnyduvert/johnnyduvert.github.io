import PocketBase, { ClientResponseError, type RecordModel } from "pocketbase";
import {
  expandEventOccurrences,
  parseBlockDocument,
  type ContentFeedBlock,
  type EventRecord,
  type EventTranslationRecord,
  type MediaRecord,
  type PageTranslationRecord,
  type PostTranslationRecord,
  type SiteRecord,
  type SiteTranslationRecord,
} from "../lib/contracts";

const SITE_KEY = "johnnyduvert-se";
const SITE_LOCALE = "sv";
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

async function loadFeed(pb: PocketBase, site: SiteRecord, block: ContentFeedBlock): Promise<FeedData> {
  if (block.data.collection === "posts") {
    const result = await pb.collection<PostTranslationRecord>("post_translations").getList(1, block.data.limit, {
      filter: pb.filter("site = {:site} && locale = {:locale} && status = 'published'", { site: site.id, locale: SITE_LOCALE }),
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
    filter: pb.filter("site = {:site} && locale = {:locale} && status = 'published'", { site: site.id, locale: SITE_LOCALE }),
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

export async function loadSite(pathname: string): Promise<LoadedSite | { redirect: string }> {
  const pb = client();
  const path = normalizePath(pathname);
  const site = await pb.collection<SiteRecord>("sites").getFirstListItem(
    pb.filter("key = {:key} && active = true", { key: SITE_KEY }),
    { fetch: freshFetch },
  );

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

  const [translation, menus, pages, media, page] = await Promise.all([
    pb.collection<SiteTranslationRecord>("site_translations").getFirstListItem(
      pb.filter("site = {:site} && locale = {:locale}", { site: site.id, locale: SITE_LOCALE }),
      { fetch: freshFetch },
    ),
    pb.collection<NavigationMenuRecord>("navigation_menus").getFullList({
      filter: pb.filter("site = {:site} && active = true", { site: site.id }),
      sort: "created",
      fetch: freshFetch,
    }),
    pb.collection<PageTranslationRecord>("page_translations").getFullList({
      filter: pb.filter("site = {:site} && locale = {:locale} && status = 'published'", { site: site.id, locale: SITE_LOCALE }),
      fetch: freshFetch,
    }),
    pb.collection<MediaRecord>("media").getFullList({
      filter: pb.filter("site = {:site} && is_public = true", { site: site.id }),
      fetch: freshFetch,
    }),
    pb.collection<PageTranslationRecord>("page_translations").getFirstListItem(pageFilter, { fetch: freshFetch }).catch((error) => {
      if (isNotFound(error)) throw new PageNotFoundError(path);
      throw error;
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
        filter: pb.filter("site = {:site} && locale = {:locale}", { site: site.id, locale: SITE_LOCALE }),
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

  const parsedPage = { ...page, blocks: parseBlockDocument(page.blocks) };
  const feedBlocks = parsedPage.blocks.items.filter((block): block is ContentFeedBlock => block.type === "content_feed");
  const feedEntries = await Promise.all(feedBlocks.map(async (block) => [block.id, await loadFeed(pb, site, block)] as const));

  return {
    site,
    translation,
    page: parsedPage,
    navigation,
    media: new Map(media.map((record) => [record.id, record])),
    feeds: new Map(feedEntries),
  };
}

export function mediaUrl(media: MediaRecord, thumb = "1600x0") {
  return client().files.getURL(media, media.file, thumb ? { thumb } : undefined);
}

export function cmsBaseUrl() {
  return CMS_URL;
}
