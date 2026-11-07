import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPreviewContext, loadSite, mediaUrl, PageNotFoundError, type FeedData, type FeedEvent, type LoadedSite, type PreviewContext } from "./cms";
import type { ContentBlock, MediaRecord, RichTextDocument } from "../lib/contracts";
import { assetUrl, toBrowserPath, toSitePath } from "./paths";
import { isPreviewTarget, startPreview, type PreviewStatus } from "./preview";

type Navigate = (href: string, replace?: boolean) => void;

/** True while rendering a CMS preview snapshot: unfinished content gets placeholders. */
const PreviewMode = createContext(false);

function PreviewPlaceholder({ children }: { children: ReactNode }) {
  return <p className="preview-placeholder">{children}</p>;
}

function isExternal(href: string) {
  return /^(https?:|mailto:|tel:)/i.test(href);
}

function SiteLink({ href, navigate, children, className, newTab = false, ariaLabel }: {
  href: string;
  navigate: Navigate;
  children: ReactNode;
  className?: string;
  newTab?: boolean;
  ariaLabel?: string;
}) {
  const external = isExternal(href);
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (external || newTab || href.startsWith("#") || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  };
  return (
    <a aria-label={ariaLabel} className={className} href={external ? href : toBrowserPath(href)} onClick={handleClick} target={newTab ? "_blank" : undefined} rel={newTab ? "noopener noreferrer" : undefined}>
      {children}
    </a>
  );
}

function StageLoader({ overlay = false }: { overlay?: boolean }) {
  return (
    <div className={overlay ? "stage-loader stage-loader--overlay" : "stage-loader"} role="status" aria-live="polite">
      <div className="stage-loader__lights" aria-hidden="true">
        <span /><span /><span />
      </div>
      <span className="stage-loader__guitar-wrap" aria-hidden="true">
        <img className="stage-loader__guitar" src={assetUrl("favicon.png")} alt="" />
      </span>
      <div className="stage-loader__mark" aria-hidden="true">
        {Array.from({ length: 7 }, (_, index) => <i key={index} />)}
      </div>
      <p>Laddar föreställningen</p>
      <span className="sr-only">Hämtar den senaste sidan från innehållssystemet.</span>
    </div>
  );
}

type CopyStatus = "idle" | "copied" | "failed";

function ContactFallback({ email, copyStatus, onCopy, onClose }: {
  email: string;
  copyStatus: CopyStatus;
  onCopy: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (email && !node.open) node.showModal();
    if (!email && node.open) node.close();
  }, [email]);

  return (
    <dialog ref={dialog} className="contact-dialog" aria-labelledby="contact-dialog-title" onClose={onClose}>
      <button className="contact-dialog__close" type="button" onClick={onClose} aria-label="Stäng kontaktfönstret">×</button>
      <div className="contact-dialog__content">
        <p className="eyebrow">Kontakt</p>
        <h2 id="contact-dialog-title">Boka Johnny</h2>
        <p>Om din webbläsare inte kan öppna e-postlänkar kan du kopiera adressen och klistra in den i valfri e-posttjänst.</p>
        <div className="contact-dialog__address">
          <span>E-postadress</span>
          <strong>{email}</strong>
        </div>
        <button className="button button--primary" type="button" onClick={onCopy} disabled={!email}>
          {copyStatus === "copied" ? "Adressen är kopierad" : "Kopiera e-postadress"}
        </button>
        <p className="contact-dialog__status" role="status" aria-live="polite">
          {copyStatus === "copied" && "Nu kan du klistra in adressen i ett nytt meddelande."}
          {copyStatus === "failed" && "Kopieringen misslyckades. Markera adressen ovan och kopiera den manuellt."}
        </p>
      </div>
    </dialog>
  );
}

function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        node.classList.add("is-visible");
        observer.disconnect();
      }
    }, { threshold: 0.08 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className="reveal" style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}>{children}</div>;
}

function Header({ data, route, navigate }: { data: LoadedSite; route: string; navigate: Navigate }) {
  const [open, setOpen] = useState(false);
  const follow = (href: string) => {
    setOpen(false);
    navigate(href);
  };
  return (
    <header className="site-header">
      <SiteLink href="/" navigate={follow} className="brand" ariaLabel="Johnny Duvert, startsida">
        <span className="brand__icon-wrap" aria-hidden="true">
          <img className="brand__icon" src={assetUrl("favicon.png")} alt="" />
        </span>
        <span className="brand__first">Johnny</span>
        <span className="brand__last">Duvert</span>
      </SiteLink>
      <button className="menu-toggle" type="button" aria-expanded={open} aria-controls="primary-navigation" onClick={() => setOpen((value) => !value)}>
        <span /> <span />
        <span className="sr-only">{open ? "Stäng meny" : "Öppna meny"}</span>
      </button>
      <nav id="primary-navigation" className={open ? "primary-nav is-open" : "primary-nav"} aria-label="Huvudmeny">
        {data.navigation.map((item) => (
          <SiteLink
            key={item.id}
            href={item.href}
            navigate={follow}
            newTab={item.newTab}
            className={route === item.href ? "is-current" : undefined}
          >
            {item.label}
          </SiteLink>
        ))}
        {data.translation.contact_email && (
          <a className="nav-booking" href={`mailto:${data.translation.contact_email}`}>Boka Johnny</a>
        )}
      </nav>
    </header>
  );
}

interface HeroSlide {
  id: string;
  eyebrow: string;
  heading: string;
  text: string;
  image?: string;
  alt: string;
  buttons: Array<{ label: string; url: string; style: "primary" | "secondary" | "text" }>;
}

function HeroCarousel({ slides, navigate }: { slides: HeroSlide[]; navigate: Navigate }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (slides.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setActive((value) => (value + 1) % slides.length), 6800);
    return () => window.clearInterval(timer);
  }, [slides.length]);

  if (!slides.length) return null;
  return (
    <section className="hero" aria-roledescription="carousel" aria-label="Johnny Duvert live">
      {slides.map((slide, index) => (
        <article key={slide.id} className={index === active ? "hero__slide is-active" : "hero__slide"} aria-hidden={index !== active}>
          {slide.image && <img src={slide.image} alt={slide.alt} className="hero__image" fetchPriority={index === 0 ? "high" : "auto"} />}
          <div className="hero__shade" />
          <div className="hero__content">
            {slide.eyebrow && <p className="eyebrow">{slide.eyebrow}</p>}
            <p className="hero__kicker">Johnny Duvert presenterar</p>
            <h1>{slide.heading}</h1>
            {slide.text && <p className="hero__text">{slide.text}</p>}
            {!!slide.buttons.length && (
              <div className="button-row">
                {slide.buttons.map((button) => <SiteLink key={`${button.label}-${button.url}`} href={button.url} navigate={navigate} className={`button button--${button.style}`}>{button.label}</SiteLink>)}
              </div>
            )}
          </div>
        </article>
      ))}
      {slides.length > 1 && (
        <div className="hero__controls" aria-label="Välj bild">
          {slides.map((slide, index) => (
            <button key={slide.id} type="button" aria-label={`Visa ${slide.heading}`} aria-current={index === active} onClick={() => setActive(index)}><span /></button>
          ))}
        </div>
      )}
      <div className="hero__scroll" aria-hidden="true"><span /> Scrolla</div>
    </section>
  );
}

function LightboxImage({ media, caption }: { media: MediaRecord; caption: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const alt = media.alt_sv || caption || media.title_sv || "";
  return (
    <>
      <button className="image-card" type="button" onClick={() => dialog.current?.showModal()} aria-label={`Öppna bild: ${alt || "scenbild"}`}>
        <figure>
          <img src={mediaUrl(media, "1400x0")} alt={alt} loading="lazy" />
          {caption && <figcaption>{caption}<span aria-hidden="true">↗</span></figcaption>}
        </figure>
      </button>
      <dialog ref={dialog} className="lightbox">
        <button type="button" className="lightbox__close" onClick={() => dialog.current?.close()} aria-label="Stäng bild">×</button>
        <img src={mediaUrl(media, "")} alt={alt} />
        {caption && <p>{caption}</p>}
      </dialog>
    </>
  );
}

interface TipTapNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
  content?: TipTapNode[];
}

function safeHref(value: unknown) {
  const href = typeof value === "string" ? value.trim() : "";
  return /^(https?:\/\/|mailto:|tel:|\/|#)/i.test(href) ? href : "#";
}

function RichText({ document, navigate }: { document: RichTextDocument; navigate: Navigate }) {
  const renderNode = (node: TipTapNode, key: string): ReactNode => {
    if (node.type === "text") {
      let child: ReactNode = node.text || "";
      for (const [index, mark] of (node.marks || []).entries()) {
        if (mark.type === "bold") child = <strong key={`${key}-b-${index}`}>{child}</strong>;
        if (mark.type === "italic") child = <em key={`${key}-i-${index}`}>{child}</em>;
        if (mark.type === "strike") child = <s key={`${key}-s-${index}`}>{child}</s>;
        if (mark.type === "code") child = <code key={`${key}-c-${index}`}>{child}</code>;
        if (mark.type === "link") child = <SiteLink key={`${key}-a-${index}`} href={safeHref(mark.attrs?.href)} navigate={navigate} newTab={mark.attrs?.target === "_blank"}>{child}</SiteLink>;
      }
      return <Fragment key={key}>{child}</Fragment>;
    }
    const children = (node.content || []).map((child, index) => renderNode(child, `${key}-${index}`));
    if (node.type === "paragraph") return <p key={key}>{children}</p>;
    if (node.type === "heading") {
      const level = Math.min(4, Math.max(2, Number(node.attrs?.level) || 2));
      const Tag = `h${level}` as "h2" | "h3" | "h4";
      return <Tag key={key}>{children}</Tag>;
    }
    if (node.type === "bulletList") return <ul key={key}>{children}</ul>;
    if (node.type === "orderedList") return <ol key={key}>{children}</ol>;
    if (node.type === "listItem") return <li key={key}>{children}</li>;
    if (node.type === "blockquote") return <blockquote key={key}>{children}</blockquote>;
    if (node.type === "hardBreak") return <br key={key} />;
    if (node.type === "horizontalRule") return <hr key={key} />;
    return <Fragment key={key}>{children}</Fragment>;
  };
  return <div className="rich-text">{(document.content as TipTapNode[]).map((node, index) => renderNode(node, `rt-${index}`))}</div>;
}

function embedUrl(source: string) {
  try {
    const url = new URL(source);
    if (url.hostname === "youtu.be") return `https://www.youtube-nocookie.com/embed/${url.pathname.slice(1)}`;
    if (url.hostname.endsWith("youtube.com")) {
      const id = url.searchParams.get("v");
      if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
    }
    if (url.hostname.endsWith("vimeo.com")) return `https://player.vimeo.com/video/${url.pathname.split("/").filter(Boolean).at(-1)}`;
  } catch { /* Use a safe link fallback. */ }
  return null;
}

function formatEventDate(event: FeedEvent) {
  const day = new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "long", year: "numeric", timeZone: event.event.timezone || "Europe/Stockholm" });
  const start = day.format(event.start);
  const end = day.format(event.end);
  if (start === end) return start;
  return `${start} – ${end}`;
}

function formatEventTime(item: FeedEvent) {
  if (item.event.all_day) return "Heldag";
  const format = new Intl.DateTimeFormat("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: item.event.timezone || "Europe/Stockholm",
  });
  return `${format.format(item.start)}–${format.format(item.end)}`;
}

function recurrenceText(item: FeedEvent) {
  if (item.event.recurrence === "none") return "";
  const unit = {
    daily: "dag",
    weekly: "vecka",
    monthly: "månad",
    yearly: "år",
  }[item.event.recurrence];
  const interval = Math.max(1, item.event.recurrence_interval || 1);
  const cadence = interval === 1 ? `Varje ${unit}` : `Var ${interval}:e ${unit}`;
  if (!item.event.recurrence_end) return cadence;
  const end = new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: item.event.timezone || "Europe/Stockholm",
  }).format(new Date(item.event.recurrence_end));
  return `${cadence} till ${end}`;
}

function EventDetails({ item, media, navigate }: { item: FeedEvent; media: Map<string, MediaRecord>; navigate: Navigate }) {
  const description = item.translation.summary.trim().toLocaleLowerCase("sv-SE") === item.translation.title.trim().toLocaleLowerCase("sv-SE")
    ? ""
    : item.translation.summary.trim();
  const recurrence = recurrenceText(item);
  return (
    <div className="event-card__body">
      {description && <p className="event-card__description">{description}</p>}
      <dl className="event-facts">
        <div><dt>Tid</dt><dd>{formatEventTime(item)}</dd></div>
        {item.event.venue && <div><dt>Plats</dt><dd>{item.event.venue}</dd></div>}
        {item.event.address && <div><dt>Adress</dt><dd>{item.event.address}</dd></div>}
        {recurrence && <div><dt>Återkommande</dt><dd>{recurrence}</dd></div>}
      </dl>
      <div className="event-card__links">
        {item.event.address && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.event.address)}`} target="_blank" rel="noopener noreferrer">Visa karta ↗</a>}
        {item.event.external_url && <a href={item.event.external_url} target="_blank" rel="noopener noreferrer">Biljetter och information ↗</a>}
      </div>
      {!!item.translation.blocks.items.length && (
        <div className="event-card__content">
          <Blocks blocks={item.translation.blocks.items.filter((block) => block.type !== "content_feed")} media={media} feeds={new Map()} navigate={navigate} />
        </div>
      )}
    </div>
  );
}

function EventList({ events, media, navigate }: { events: FeedEvent[]; media: Map<string, MediaRecord>; navigate: Navigate }) {
  return <div className="event-list">{events.map((item, index) => {
    const description = item.translation.summary.trim().toLocaleLowerCase("sv-SE") !== item.translation.title.trim().toLocaleLowerCase("sv-SE");
    const hasDetails = description || !!item.event.venue || !!item.event.address || !!item.event.external_url || !item.event.all_day || item.event.recurrence !== "none" || !!item.translation.blocks.items.length;
    const heading = (
      <>
        <time dateTime={item.start.toISOString()}><span>{formatEventDate(item)}</span><small>{formatEventTime(item)}</small></time>
        <div className="event-card__title">
          <h3>{item.translation.title}</h3>
          {(item.event.venue || item.event.address) && <p>{[item.event.venue, item.event.address].filter(Boolean).join(" · ")}</p>}
        </div>
      </>
    );
    const key = `${item.event.id}-${item.start.toISOString()}-${index}`;
    if (!hasDetails) return <article className="event-card event-card--simple" id={item.translation.slug} key={key}>{heading}</article>;
    return (
      <details className="event-card" id={item.translation.slug} key={key}>
        <summary>{heading}<i aria-hidden="true">+</i><span className="sr-only">Visa mer om {item.translation.title}</span></summary>
        <EventDetails item={item} media={media} navigate={navigate} />
      </details>
    );
  })}</div>;
}

function Feed({ feed, media, navigate }: { feed?: FeedData; media: Map<string, MediaRecord>; navigate: Navigate }) {
  if (!feed) return null;
  if (feed.kind === "posts") {
    if (!feed.posts.length) return <p className="empty-message">Inga publicerade nyheter just nu.</p>;
    return (
      <section className="post-feed" aria-label="Nyheter">
        {feed.posts.map((post) => {
          const coverId = post.expand?.post?.cover;
          const cover = coverId ? media.get(coverId) : undefined;
          return (
            <details className="post-card" id={post.slug} key={post.id}>
              <summary>
                {cover && <img src={mediaUrl(cover, "720x480")} alt={cover.alt_sv || cover.title_sv || ""} loading="lazy" />}
                <span>
                  <time dateTime={post.publish_at}>{new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "long", year: "numeric" }).format(new Date(post.publish_at))}</time>
                  <strong>{post.title}</strong>
                  <small>{post.summary}</small>
                </span>
                <i aria-hidden="true">+</i>
              </summary>
              <div className="post-card__body"><Blocks blocks={post.blocks.items.filter((block) => block.type !== "content_feed")} media={media} feeds={new Map()} navigate={navigate} /></div>
            </details>
          );
        })}
      </section>
    );
  }

  const years = new Map<number, FeedEvent[]>();
  for (const event of feed.past) {
    const year = Number(new Intl.DateTimeFormat("sv-SE", { year: "numeric", timeZone: event.event.timezone || "Europe/Stockholm" }).format(event.start));
    years.set(year, [...(years.get(year) || []), event]);
  }
  return (
    <section className="events-feed" aria-label="Spelningar">
      <div className="feed-heading"><span>På scen</span><h2>Kommande spelningar</h2></div>
      {feed.upcoming.length ? <EventList events={feed.upcoming} media={media} navigate={navigate} /> : <p className="empty-message">Nya datum är på väg. Välkommen tillbaka snart.</p>}
      {!!feed.past.length && (
        <div className="archive">
          <div className="feed-heading"><span>Arkiv</span><h2>Tidigare spelningar</h2></div>
          {[...years.entries()].map(([year, events], index) => (
            <details key={year} className="archive-year" open={index === 0}>
              <summary><span>{year}</span><small>{events.length} spelningar</small><i aria-hidden="true">+</i></summary>
              <EventList events={events} media={media} navigate={navigate} />
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

function BlockView({ block, media, feeds, navigate }: {
  block: ContentBlock;
  media: Map<string, MediaRecord>;
  feeds: Map<string, FeedData>;
  navigate: Navigate;
}) {
  const preview = useContext(PreviewMode);
  if (block.type === "rich_text") return <section className="content-panel"><RichText document={block.data.content} navigate={navigate} /></section>;
  if (block.type === "image") {
    const image = media.get(block.data.mediaId);
    if (image) return <div className="image-block"><LightboxImage media={image} caption={block.data.caption} /></div>;
    return preview ? <PreviewPlaceholder>{block.data.mediaId ? "Bilden är inte publik eller finns inte" : "Ingen bild vald"}</PreviewPlaceholder> : null;
  }
  if (block.type === "image_text") {
    const image = media.get(block.data.mediaId);
    return (
      <section className={`image-text image-text--${block.data.imagePosition}`}>
        {image ? <LightboxImage media={image} caption={image.caption_sv || image.title_sv || ""} /> : preview && <PreviewPlaceholder>Ingen bild vald</PreviewPlaceholder>}
        <div><p className="eyebrow">Johnny Duvert</p><h2>{block.data.heading}</h2><RichText document={block.data.text} navigate={navigate} /></div>
      </section>
    );
  }
  if (block.type === "call_to_action") return <section className="cta"><p className="eyebrow">Live & personligt</p><h2>{block.data.heading}</h2><p>{block.data.text}</p><SiteLink href={block.data.button.url} navigate={navigate} className={`button button--${block.data.button.style}`}>{block.data.button.label}</SiteLink></section>;
  if (block.type === "quote") return <figure className="quote"><blockquote>“{block.data.quote}”</blockquote>{block.data.attribution && <figcaption>— {block.data.attribution}</figcaption>}</figure>;
  if (block.type === "content_feed") return <Feed feed={feeds.get(block.id)} media={media} navigate={navigate} />;
  if (block.type === "embed") {
    const embed = embedUrl(block.data.url);
    if (!embed && !/^https:\/\//i.test(block.data.url)) return preview ? <PreviewPlaceholder>Inbäddning saknar giltig adress</PreviewPlaceholder> : null;
    return embed ? <div className="embed"><iframe src={embed} title={block.data.title} loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /></div> : <p className="embed-fallback"><a href={block.data.url} target="_blank" rel="noopener noreferrer">{block.data.title} ↗</a></p>;
  }
  return null;
}

function Blocks({ blocks, media, feeds, navigate }: {
  blocks: ContentBlock[];
  media: Map<string, MediaRecord>;
  feeds: Map<string, FeedData>;
  navigate: Navigate;
}) {
  const output: ReactNode[] = [];
  let index = 0;
  while (index < blocks.length) {
    const block = blocks[index];
    if (block.type === "hero") {
      const heroes: Extract<ContentBlock, { type: "hero" }>[] = [];
      while (index < blocks.length && blocks[index].type === "hero") heroes.push(blocks[index++] as Extract<ContentBlock, { type: "hero" }>);
      const slides = heroes.map<HeroSlide>((hero) => {
        const image = media.get(hero.data.mediaId);
        return {
          id: hero.id,
          eyebrow: hero.data.eyebrow,
          heading: hero.data.heading,
          text: hero.data.text,
          image: image ? mediaUrl(image, "1800x0") : undefined,
          alt: image?.alt_sv || hero.data.heading,
          buttons: hero.data.buttons,
        };
      });
      output.push(<HeroCarousel key={heroes[0].id} slides={slides} navigate={navigate} />);
      continue;
    }
    output.push(<Reveal key={block.id} delay={(index % 4) * 70}><BlockView block={block} media={media} feeds={feeds} navigate={navigate} /></Reveal>);
    index += 1;
  }
  return <>{output}</>;
}

function Footer({ data }: { data: LoadedSite }) {
  return (
    <footer className="site-footer">
      <div><span className="footer-mark" aria-hidden="true"><img src={assetUrl("favicon.png")} alt="" /></span><p>Musik, nostalgi och full energi<br />— direkt från scenen.</p></div>
      <div><p className="footer-label">Kontakt</p>{data.translation.contact_email && <a href={`mailto:${data.translation.contact_email}`}>{data.translation.contact_email}</a>}</div>
      <small>© {new Date().getFullYear()} {data.translation.organization || data.translation.title}</small>
    </footer>
  );
}

function updateMeta(data: LoadedSite) {
  document.title = data.page.seo_title ? `${data.page.seo_title} — ${data.translation.title}` : data.translation.seo_title || data.translation.title;
  const description = data.page.seo_description || data.page.summary || data.translation.seo_description;
  const set = (selector: string, attribute: string, value: string) => {
    const element = document.querySelector<HTMLMetaElement>(selector);
    if (element) element.setAttribute(attribute, value);
  };
  set('meta[name="description"]', "content", description);
  const social = data.page.social_image ? data.media.get(data.page.social_image) : data.site.social_image ? data.media.get(data.site.social_image) : undefined;
  const fallbackImage = new URL(assetUrl("og.png"), window.location.origin).href;
  set('meta[property="og:image"]', "content", social ? mediaUrl(social, "1600x0") : fallbackImage);
  set('meta[name="twitter:image"]', "content", social ? mediaUrl(social, "1600x0") : fallbackImage);
}

function forcePreviewRobots() {
  let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (!robots) {
    robots = document.createElement("meta");
    robots.name = "robots";
    document.head.append(robots);
  }
  robots.content = "noindex,nofollow";
}

function useContactFallback() {
  const [contactEmail, setContactEmail] = useState("");
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");

  const closeContact = useCallback(() => {
    setContactEmail("");
  }, []);

  const copyContactEmail = useCallback(async () => {
    if (!contactEmail) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(contactEmail);
      setCopyStatus("copied");
      return;
    } catch {
      const input = document.createElement("textarea");
      input.value = contactEmail;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.append(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      setCopyStatus(copied ? "copied" : "failed");
    }
  }, [contactEmail]);

  const handleMailto = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest<HTMLAnchorElement>('a[href^="mailto:"]');
    if (!anchor) return;
    event.preventDefault();
    try {
      const email = decodeURIComponent(anchor.href.slice("mailto:".length).split("?")[0]).trim();
      if (!email) return;
      setCopyStatus("idle");
      setContactEmail(email);
    } catch {
      setCopyStatus("failed");
    }
  }, []);

  return { contactEmail, copyStatus, closeContact, copyContactEmail, handleMailto };
}

function SiteView({ data, route, navigate, loading = false }: { data: LoadedSite; route: string; navigate: Navigate; loading?: boolean }) {
  const preview = useContext(PreviewMode);
  const { contactEmail, copyStatus, closeContact, copyContactEmail, handleMailto } = useContactFallback();
  const isHeroPage = data.page.blocks.items[0]?.type === "hero";
  return (
    <div className="site-shell" onClickCapture={handleMailto}>
      <a href="#main" className="skip-link">Hoppa till innehållet</a>
      <Header data={data} route={route} navigate={navigate} />
      <main id="main">
        {!isHeroPage && (
          <header className="page-intro">
            <p className="eyebrow">Johnny Duvert</p>
            <h1>{data.page.title || (preview ? "Namnlös sida" : "")}</h1>
            {data.page.summary && <p>{data.page.summary}</p>}
          </header>
        )}
        <Blocks blocks={data.page.blocks.items} media={data.media} feeds={data.feeds} navigate={navigate} />
      </main>
      <Footer data={data} />
      <ContactFallback email={contactEmail} copyStatus={copyStatus} onCopy={copyContactEmail} onClose={closeContact} />
      {loading && <StageLoader overlay />}
    </div>
  );
}

function PublicApp() {
  const [route, setRoute] = useState(() => toSitePath(window.location.pathname));
  const [data, setData] = useState<LoadedSite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"not-found" | "unavailable" | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const navigate = useCallback<Navigate>((href, replace = false) => {
    if (isExternal(href)) {
      window.location.assign(href);
      return;
    }
    const target = new URL(href, window.location.origin);
    const current = toSitePath(window.location.pathname);
    if (target.hash && target.pathname === current) {
      document.querySelector(target.hash)?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (target.pathname === current && target.search === window.location.search) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setLoading(true);
    setError(null);
    window.history[replace ? "replaceState" : "pushState"]({}, "", `${toBrowserPath(target.pathname)}${target.search}${target.hash}`);
    setRoute(toSitePath(target.pathname));
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setLoading(true);
      setError(null);
      setRoute(toSitePath(window.location.pathname));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    let active = true;
    loadSite(route).then((result) => {
      if (!active) return;
      if ("redirect" in result) {
        if (isExternal(result.redirect)) window.location.replace(result.redirect);
        else navigate(result.redirect, true);
        return;
      }
      setData(result);
      updateMeta(result);
      setLoading(false);
      window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }).catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof PageNotFoundError ? "not-found" : "unavailable");
      setLoading(false);
    });
    return () => { active = false; };
  }, [navigate, route, reloadToken]);

  if (!data && loading) return <StageLoader />;
  if (error) return (
    <main className="error-page">
      <p className="eyebrow">Johnny Duvert</p>
      <h1>{error === "not-found" ? "Sidan finns inte" : "Ridån är nere en liten stund"}</h1>
      <p>{error === "not-found" ? "Sökvägen leder inte till någon publicerad sida." : "Innehållet kunde inte hämtas just nu. Försök gärna igen."}</p>
      {error === "not-found" ? <button className="button button--primary" onClick={() => navigate("/")}>Till startsidan</button> : <button className="button button--primary" onClick={() => { setLoading(true); setError(null); setReloadToken((value) => value + 1); }}>Försök igen</button>}
    </main>
  );
  if (!data) return null;
  return <SiteView data={data} route={route} navigate={navigate} loading={loading} />;
}

const endMessages: Record<Extract<PreviewStatus, { kind: "ended" }>["reason"], { title: string; text: string }> = {
  expired: { title: "Förhandsvisningen har gått ut", text: "Länken var giltig i en timme. Öppna en ny förhandsvisning från CMS:et." },
  unavailable: { title: "Länken fungerar inte längre", text: "Förhandsvisningen är avslutad, ogiltig eller saknar behörighet. Öppna en ny från CMS:et." },
  mismatch: { title: "Fel adress för förhandsvisningen", text: "Länken hör inte till den här webbplatsen eller adressen. Öppna förhandsvisningen igen från CMS:et." },
  "site-unavailable": { title: "Webbplatsen är inte aktiv", text: "Förhandsvisningen kan inte visas eftersom webbplatsen inte hittades i CMS:et." },
};

function PreviewBar({ status, expiresAt }: { status: PreviewStatus; expiresAt: string | null }) {
  const label = status.kind === "connected" ? "Ansluten"
    : status.kind === "disconnected" ? "Frånkopplad — försöker igen"
    : status.kind === "connecting" ? "Ansluter…"
    : "Avslutad";
  const expiry = expiresAt
    ? new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit" }).format(new Date(expiresAt))
    : null;
  return (
    <aside className={`preview-bar preview-bar--${status.kind}`} aria-label="Förhandsvisning">
      <strong>Förhandsvisning</strong>
      {expiry && <span>Giltig till {expiry}</span>}
      <span className="preview-bar__status" role="status" aria-live="polite"><i aria-hidden="true" />{label}</span>
    </aside>
  );
}

function PreviewApp({ token }: { token: string }) {
  const [targetRoute] = useState(() => toSitePath(window.location.pathname));
  const [data, setData] = useState<LoadedSite | null>(null);
  const [status, setStatus] = useState<PreviewStatus>({ kind: "connecting" });
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let generation = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let context: { locale: string; value: PreviewContext } | null = null;

    const clear = () => {
      generation += 1;
      clearTimeout(retry);
      context = null;
      setData(null);
      setExpiresAt(null);
    };

    const stop = startPreview(token, {
      onSnapshot(snapshot, site) {
        const current = ++generation;
        clearTimeout(retry);
        setExpiresAt(snapshot.expiresAt);
        if (context?.locale !== snapshot.locale) context = { locale: snapshot.locale, value: createPreviewContext(site, snapshot.locale) };
        const build = (ctx: PreviewContext) => ctx.build(snapshot).then((result) => {
          // Never paint a superseded or expired snapshot.
          if (current !== generation || Date.now() >= Date.parse(snapshot.expiresAt)) return;
          document.documentElement.lang = snapshot.locale;
          setData(result);
          updateMeta(result);
          forcePreviewRobots();
        }).catch(() => {
          if (current !== generation) return;
          setStatus({ kind: "disconnected" });
          retry = setTimeout(() => { if (current === generation && context) void build(context.value); }, 1000);
        });
        void build(context.value);
      },
      onClear: clear,
      onStatus: setStatus,
    });
    stopRef.current = () => { stop(); clear(); };

    // Stop polling and drop the token if the address leaves the target route.
    const onPopState = () => { if (!isPreviewTarget(targetRoute)) stopRef.current?.(); };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      stop();
      generation += 1;
      clearTimeout(retry);
    };
  }, [token, targetRoute]);

  // Following any link that leaves the preview target discards the session and
  // loads the normal published page (without the token in the URL).
  const navigate = useCallback<Navigate>((href) => {
    if (isExternal(href)) {
      window.location.assign(href);
      return;
    }
    const target = new URL(href, window.location.origin);
    if (target.hash && target.pathname === targetRoute && !target.search) {
      document.querySelector(target.hash)?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    stopRef.current?.();
    window.location.assign(`${toBrowserPath(target.pathname)}${target.search}${target.hash}`);
  }, [targetRoute]);

  const ended = status.kind === "ended" ? endMessages[status.reason] : null;
  return (
    <PreviewMode.Provider value={true}>
      <PreviewBar status={status} expiresAt={expiresAt} />
      <div id="page-content" style={data ? { visibility: "visible" } : undefined}>
        {data && <SiteView data={data} route={targetRoute} navigate={navigate} />}
      </div>
      {ended && (
        <main className="error-page">
          <p className="eyebrow">Förhandsvisning</p>
          <h1>{ended.title}</h1>
          <p>{ended.text}</p>
        </main>
      )}
      {!data && !ended && <StageLoader />}
    </PreviewMode.Provider>
  );
}

export default function App({ previewToken }: { previewToken: string | null }) {
  return previewToken !== null ? <PreviewApp token={previewToken} /> : <PublicApp />;
}
