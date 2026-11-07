import { addDays, addMonths, addWeeks, addYears, isAfter } from "date-fns";
import { z } from "zod";

const buttonSchema = z.object({
  label: z.string().max(120),
  url: z.string().max(2048),
  style: z.enum(["primary", "secondary", "text"]).default("primary"),
});

const richTextSchema = z.object({
  type: z.literal("doc"),
  content: z.array(z.unknown()).default([]),
});

export const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(8).max(80),
    type: z.literal("hero"),
    data: z.object({
      eyebrow: z.string().max(160).default(""),
      heading: z.string().max(240),
      text: z.string().max(1200).default(""),
      mediaId: z.string().max(40).default(""),
      buttons: z.array(buttonSchema).max(3).default([]),
    }),
  }),
  z.object({
    id: z.string().min(8).max(80),
    type: z.literal("rich_text"),
    data: z.object({ content: richTextSchema }),
  }),
  z.object({
    id: z.string().min(8).max(80),
    type: z.literal("image"),
    data: z.object({ mediaId: z.string().min(1), caption: z.string().max(500).default("") }),
  }),
  z.object({
    id: z.string().min(8).max(80),
    type: z.literal("image_text"),
    data: z.object({
      mediaId: z.string().min(1),
      heading: z.string().max(240),
      text: richTextSchema,
      imagePosition: z.enum(["left", "right"]).default("left"),
    }),
  }),
  z.object({
    id: z.string().min(8).max(80),
    type: z.literal("call_to_action"),
    data: z.object({ heading: z.string().max(240), text: z.string().max(1000), button: buttonSchema }),
  }),
  z.object({
    id: z.string().min(8).max(80),
    type: z.literal("quote"),
    data: z.object({ quote: z.string().max(1600), attribution: z.string().max(240).default("") }),
  }),
  z.object({
    id: z.string().min(8).max(80),
    type: z.literal("content_feed"),
    data: z.object({
      collection: z.enum(["posts", "events"]),
      range: z.enum(["all", "upcoming", "past"]).default("all"),
      limit: z.number().int().min(1).max(500).default(50),
    }),
  }),
  z.object({
    id: z.string().min(8).max(80),
    type: z.literal("embed"),
    data: z.object({ url: z.string().url().refine((value) => value.startsWith("https://")), title: z.string().max(240) }),
  }),
]);

export type ContentBlock = z.infer<typeof contentBlockSchema>;
export type ContentFeedBlock = Extract<ContentBlock, { type: "content_feed" }>;
export type RichTextDocument = Extract<ContentBlock, { type: "rich_text" }>["data"]["content"];

export interface BlockDocument {
  version: 1;
  items: ContentBlock[];
}

export function parseBlockDocument(value: unknown): BlockDocument {
  if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== 1) {
    return { version: 1, items: [] };
  }
  const items = Array.isArray((value as { items?: unknown }).items) ? (value as { items: unknown[] }).items : [];
  return {
    version: 1,
    items: items.flatMap((item) => {
      const result = contentBlockSchema.safeParse(item);
      return result.success ? [result.data] : [];
    }),
  };
}

// Preview snapshots carry unfinished authoring values: media references and
// embed URLs may be empty. Mirrors `previewBlockSchema` in @oortis/cms-contracts.
const [heroSchema, richTextBlockSchema, imageSchema, imageTextSchema, ctaSchema, quoteSchema, feedSchema, embedSchema] = contentBlockSchema.options;
const previewBlockSchema = z.discriminatedUnion("type", [
  heroSchema.extend({ data: heroSchema.shape.data.extend({ mediaId: z.string().max(15).default("") }) }),
  richTextBlockSchema,
  imageSchema.extend({ data: imageSchema.shape.data.extend({ mediaId: z.string().max(15) }) }),
  imageTextSchema.extend({ data: imageTextSchema.shape.data.extend({ mediaId: z.string().max(15) }) }),
  ctaSchema,
  quoteSchema,
  feedSchema,
  embedSchema.extend({ data: embedSchema.shape.data.extend({ url: z.string().max(2048) }) }),
]);

export function parsePreviewBlockDocument(value: unknown): BlockDocument {
  if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== 1) {
    return { version: 1, items: [] };
  }
  const items = Array.isArray((value as { items?: unknown }).items) ? (value as { items: unknown[] }).items : [];
  return {
    version: 1,
    items: items.flatMap((item) => {
      const result = previewBlockSchema.safeParse(item);
      return result.success ? [result.data as ContentBlock] : [];
    }),
  };
}

export type CmsLocale = "en" | "sv";

/** `PagePreviewSnapshot` from @oortis/cms-contracts (schemaVersion 1). */
export interface PagePreviewSnapshot {
  schemaVersion: 1;
  siteId: string;
  pageId: string;
  locale: CmsLocale;
  targetPath: string;
  expiresAt: string;
  revision: number;
  page: { id: string; site: string; template: "default" | "landing"; parent: string; sort_order: number };
  translation: {
    page: string;
    site: string;
    locale: CmsLocale;
    path: string;
    title: string;
    slug: string;
    summary: string;
    blocks: unknown;
    seo_title: string;
    seo_description: string;
    canonical_url: string;
    social_image: string;
    no_index: boolean;
    status: "draft" | "published" | "archived";
    publish_at: string;
  };
}

const previewSnapshotShape = z.object({
  schemaVersion: z.literal(1),
  siteId: z.string(),
  pageId: z.string(),
  locale: z.enum(["en", "sv"]),
  targetPath: z.string(),
  expiresAt: z.string(),
  revision: z.number().int(),
  page: z.object({ id: z.string(), site: z.string() }).passthrough(),
  translation: z.object({
    page: z.string(),
    site: z.string(),
    locale: z.enum(["en", "sv"]),
    path: z.string(),
    title: z.string().default(""),
    summary: z.string().default(""),
    seo_title: z.string().default(""),
    seo_description: z.string().default(""),
    social_image: z.string().default(""),
  }).passthrough(),
}).passthrough();

/** Structural check of an untrusted preview API response. Identity checks happen separately. */
export function parsePreviewSnapshot(value: unknown): PagePreviewSnapshot | null {
  const result = previewSnapshotShape.safeParse(value);
  return result.success ? (result.data as unknown as PagePreviewSnapshot) : null;
}

export interface RecordBase {
  id: string;
  collectionId: string;
  collectionName: string;
  created: string;
  updated: string;
}

export interface SiteRecord extends RecordBase {
  key: string;
  name: string;
  primary_url: string;
  domains: string[];
  default_locale: "en" | "sv";
  timezone: string;
  active: boolean;
  homepage: string;
  logo: string;
  favicon: string;
  social_image: string;
}

export interface SiteTranslationRecord extends RecordBase {
  site: string;
  locale: "en" | "sv";
  title: string;
  description: string;
  organization: string;
  contact_email: string;
  contact_phone: string;
  address: string;
  seo_title: string;
  seo_description: string;
  social_links: Array<{ label?: string; url?: string }>;
}

export interface PageTranslationRecord extends RecordBase {
  site: string;
  page: string;
  locale: "en" | "sv";
  title: string;
  slug: string;
  path: string;
  summary: string;
  blocks: BlockDocument;
  seo_title: string;
  seo_description: string;
  canonical_url: string;
  social_image: string;
  no_index: boolean;
  status: "draft" | "published" | "archived";
  publish_at: string;
}

export interface PostTranslationRecord extends Omit<PageTranslationRecord, "page" | "path"> {
  post: string;
  byline: string;
  expand?: { post?: PostRecord };
}

export interface PostRecord extends RecordBase {
  site: string;
  cover: string;
  categories: string[];
  tags: string[];
  featured: boolean;
  expand?: { cover?: MediaRecord };
}

export type RecurrenceFrequency = "none" | "daily" | "weekly" | "monthly" | "yearly";

export interface EventRecord extends RecordBase {
  site: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  timezone: string;
  venue: string;
  address: string;
  external_url: string;
  recurrence: RecurrenceFrequency;
  recurrence_interval: number;
  recurrence_end: string;
}

export interface EventTranslationRecord extends Omit<PageTranslationRecord, "page" | "path"> {
  event: string;
  expand?: { event?: EventRecord };
}

export interface MediaRecord extends RecordBase {
  site: string;
  file: string;
  is_public: boolean;
  alt_en: string;
  alt_sv: string;
  title_en: string;
  title_sv: string;
  caption_en: string;
  caption_sv: string;
}

export interface EventOccurrence {
  eventId: string;
  start: Date;
  end: Date;
  sequence: number;
}

export function expandEventOccurrences(event: EventRecord, rangeEnd: Date, max = 500): EventOccurrence[] {
  const start = new Date(event.start_at);
  const end = new Date(event.end_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || event.recurrence === "none") {
    return [{ eventId: event.id, start, end, sequence: 0 }];
  }

  const until = event.recurrence_end ? new Date(event.recurrence_end) : rangeEnd;
  const hardEnd = isAfter(until, rangeEnd) ? rangeEnd : until;
  const duration = end.getTime() - start.getTime();
  const interval = Math.max(1, event.recurrence_interval || 1);
  const result: EventOccurrence[] = [];
  let cursor = start;

  for (let sequence = 0; sequence < max && !isAfter(cursor, hardEnd); sequence += 1) {
    result.push({ eventId: event.id, start: cursor, end: new Date(cursor.getTime() + duration), sequence });
    if (event.recurrence === "daily") cursor = addDays(cursor, interval);
    if (event.recurrence === "weekly") cursor = addWeeks(cursor, interval);
    if (event.recurrence === "monthly") cursor = addMonths(cursor, interval);
    if (event.recurrence === "yearly") cursor = addYears(cursor, interval);
  }
  return result;
}
