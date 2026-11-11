import { Hono } from "hono";
import { DB, Doc } from "../db";
import { Env, isReleased, slugify, visibleQuery } from "../lib";

// Real, crawlable pages: /anime/<name>, /tvshow/<name>, /movie/<name> (+ /s1e3 for the player),
// plus a live /sitemap.xml. The page is the normal app shell with this title's details filled in,
// so Google and WhatsApp/Telegram previews see the right title, poster and description.
export const seo = new Hono<{ Bindings: Env; Variables: { db: DB } }>();

const SEG_TYPE: Record<string, string> = { anime: "anime", tvshow: "tv_show", movie: "movie" };
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const siteOrigin = (env: Env, reqUrl: string) => (env.SITE_URL || new URL(reqUrl).origin).replace(/\/+$/, "");
const absUrl = (origin: string, u: string) => (u.startsWith("https://") ? u : u.startsWith("/") ? origin + u : "");

async function shell(c: any): Promise<string> {
  const res = await c.env.ASSETS.fetch(new Request(new URL("/", c.req.url).toString()));
  return await res.text();
}

async function findTitle(db: DB, type: string, ref: string): Promise<Doc | null> {
  const coll = db.content(type)!;
  if (/^[0-9a-f]{24}$/.test(ref)) {
    const d = await coll.findOne({ $and: [{ _id: ref }, visibleQuery()] });
    return d;
  }
  const want = ref.toLowerCase();
  const docs = await coll.find(visibleQuery(), { sort: [["views", -1]] });
  return docs.find((d) => slugify(d.title) === want) || null;
}

function trim(text: string, n: number) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

function swap(html: string, re: RegExp, replacement: string) {
  return re.test(html) ? html.replace(re, () => replacement) : html;
}

function render(html: string, origin: string, seg: string, type: string, d: Doc, se: string | null) {
  const slug = slugify(d.title) || d._id;
  const canonical = `${origin}/${seg}/${slug}`;
  const kind = type === "movie" ? "Movie" : type === "anime" ? "Anime" : "TV Show";
  const genres: string[] = (d.genres || []).filter((g: any) => typeof g === "string").slice(0, 6);
  const baseTitle = `${d.title} – Watch ${kind} Online | ANICORE`;
  let title = baseTitle, url = canonical;
  const m = se ? /^s(\d+)e(\d+)$/.exec(se) : null;
  if (m) { title = `${d.title} S${m[1]} E${m[2]} – Watch Online | ANICORE`; url = `${canonical}/${se}`; }
  const description = trim(d.description || `Watch ${d.title} online on ANICORE – ${kind}${genres.length ? " · " + genres.join(", ") : ""}.`, 160);
  const image = absUrl(origin, d.poster || "") || absUrl(origin, d.banner || "") || `${origin}/assets/og-image.png`;

  let out = html;
  out = swap(out, /<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  out = swap(out, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(description)}">`);
  out = swap(out, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${esc(canonical)}">`);
  out = swap(out, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${esc(url)}">`);
  out = swap(out, /<meta property="og:type" content="[^"]*">/, `<meta property="og:type" content="${type === "movie" ? "video.movie" : "video.tv_show"}">`);
  out = swap(out, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`);
  out = swap(out, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(description)}">`);
  out = swap(out, /<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${esc(image)}">`);
  out = swap(out, /<meta name="twitter:card" content="[^"]*">/, `<meta name="twitter:card" content="summary_large_image">`);
  out = swap(out, /<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${esc(title)}">`);
  out = swap(out, /<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${esc(description)}">`);
  // The home page's WebSite markup doesn't belong on a title page.
  out = out.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, "");

  const ld: Record<string, any> = {
    "@context": "https://schema.org", "@type": type === "movie" ? "Movie" : "TVSeries",
    name: d.title, description, image, url: canonical, genre: genres,
  };
  if (d.year) ld.datePublished = String(d.year);
  if (d.rating_count > 0 && d.avg_rating > 0)
    ld.aggregateRating = { "@type": "AggregateRating", ratingValue: d.avg_rating, bestRating: 10, worstRating: 1, ratingCount: d.rating_count };
  if (type !== "movie" && Array.isArray(d.episodes)) ld.numberOfEpisodes = d.episodes.length;
  const ldJson = JSON.stringify(ld).replace(/</g, "\\u003c");
  out = out.replace("</head>", () => `  <script type="application/ld+json">${ldJson}</script>\n</head>`);

  const eps: Doc[] = (d.episodes || []).slice(0, 60);
  const epList = eps.length
    ? `<h2>Episodes</h2><ul>${eps.map((e) => `<li>S${esc(e.season ?? 1)} E${esc(e.episode)}${e.title ? " – " + esc(e.title) : ""}</li>`).join("")}</ul>` : "";
  const body = `<noscript><h1>${esc(d.title)}</h1><p>${esc(trim(d.description || "", 600))}</p>` +
    (genres.length ? `<p>Genres: ${genres.map(esc).join(", ")}</p>` : "") + epList +
    `<p><a href="${esc(origin)}/">ANICORE – Watch Anime Online</a></p></noscript>`;
  // replace the generic noscript block from index.html with this title's content
  if (/<noscript>[\s\S]*?<\/noscript>/.test(out)) out = out.replace(/<noscript>[\s\S]*?<\/noscript>/, () => body);
  else out = out.replace(/<body[^>]*>/, (b) => `${b}\n  ${body}`);
  return out;
}

const HTML_HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" };

for (const seg of Object.keys(SEG_TYPE)) {
  seo.get(`/${seg}/:slug`, (c) => titlePage(c, seg, null));
  seo.get(`/${seg}/:slug/:se`, (c) => titlePage(c, seg, c.req.param("se")));
}

async function titlePage(c: any, seg: string, se: string | null) {
  const type = SEG_TYPE[seg];
  const origin = siteOrigin(c.env, c.req.url);
  const html = await shell(c);
  const d = await findTitle(c.get("db"), type, String(c.req.param("slug") || ""));
  if (!d || !isReleased(d)) {
    // Unknown title: still serve the app (it shows "not found"), but keep it out of search results.
    const page = html.replace(/<meta name="robots" content="[^"]*">/, '<meta name="robots" content="noindex">');
    return new Response(page, { status: 404, headers: { ...HTML_HEADERS, "Cache-Control": "no-store" } });
  }
  const ref = String(c.req.param("slug") || "");
  const slug = slugify(d.title);
  const okSe = se && /^s\d+e\d+$/.test(se) ? se : null;
  if (/^[0-9a-f]{24}$/.test(ref) && slug) {
    // Old id-style link: send people (and Google) to the readable address when it points to the same title.
    const same = await findTitle(c.get("db"), type, slug);
    if (same && same._id === d._id) return c.redirect(`/${seg}/${slug}${okSe ? "/" + okSe : ""}`, 301);
  }
  const page = render(html, origin, seg, type, d, okSe);
  return new Response(page, { headers: HTML_HEADERS });
}

// Real addresses for the main pages, each with its own title and description.
const PAGES: Record<string, { title: string; desc: string; index: boolean }> = {
  "/series": { title: "Anime & TV Series – Watch Online | ANICORE", desc: "Browse every anime and TV series on ANICORE. Filter by genre, year, studio and season and start watching.", index: true },
  "/movies": { title: "Movies – Watch Online | ANICORE", desc: "Watch anime and animated movies online on ANICORE. Browse by genre, year and rating.", index: true },
  "/schedule": { title: "Anime Release Schedule – New Episodes This Week | ANICORE", desc: "See which anime and TV episodes release on which day, plus upcoming titles coming soon to ANICORE.", index: true },
  "/search": { title: "Search | ANICORE", desc: "Search anime, TV shows and movies on ANICORE.", index: false },
  "/profile": { title: "Your Profile | ANICORE", desc: "Your ANICORE profile.", index: false },
  "/admin": { title: "Studio | ANICORE", desc: "ANICORE studio.", index: false },
};
for (const [path, meta] of Object.entries(PAGES)) {
  seo.get(path, async (c) => {
    const origin = siteOrigin(c.env, c.req.url);
    let out = await shell(c);
    const url = origin + path;
    out = swap(out, /<title>[^<]*<\/title>/, `<title>${esc(meta.title)}</title>`);
    out = swap(out, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(meta.desc)}">`);
    out = swap(out, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${esc(url)}">`);
    out = swap(out, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${esc(url)}">`);
    out = swap(out, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(meta.title)}">`);
    out = swap(out, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(meta.desc)}">`);
    out = swap(out, /<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${esc(meta.title)}">`);
    out = swap(out, /<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${esc(meta.desc)}">`);
    if (!meta.index) out = swap(out, /<meta name="robots" content="[^"]*">/, '<meta name="robots" content="noindex, nofollow">');
    out = out.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, "");
    out = out.replace(/<noscript>[\s\S]*?<\/noscript>/, () => `<noscript><h1>${esc(meta.title)}</h1><p>${esc(meta.desc)}</p><p><a href="${esc(origin)}/">ANICORE – Watch Anime Online</a></p></noscript>`);
    return new Response(out, { headers: HTML_HEADERS });
  });
}

seo.get("/sitemap.xml", async (c) => {
  const origin = siteOrigin(c.env, c.req.url);
  const db = c.get("db");
  const urls: string[] = [`  <url><loc>${origin}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`];
  for (const path of ["/series", "/movies", "/schedule"])
    urls.push(`  <url><loc>${origin}${path}</loc><changefreq>daily</changefreq><priority>0.9</priority></url>`);
  for (const [seg, type] of Object.entries(SEG_TYPE)) {
    const docs = await db.content(type)!.find(visibleQuery(), { sort: [["views", -1]], limit: 2000 });
    const seen = new Set<string>();
    for (const d of docs) {
      const slug = slugify(d.title);
      if (!slug || seen.has(slug)) continue; // duplicate names share one address; skip repeats
      seen.add(slug);
      const last = String(d.updated_at || d.created_at || "").slice(0, 10);
      urls.push(`  <url><loc>${esc(`${origin}/${seg}/${slug}`)}</loc>${last ? `<lastmod>${last}</lastmod>` : ""}<changefreq>weekly</changefreq><priority>0.8</priority></url>`);
    }
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
});
