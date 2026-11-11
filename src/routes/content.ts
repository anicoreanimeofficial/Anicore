import { Hono } from "hono";
import { DB, Doc, Sort } from "../db";
import {
  AppCtx, CONTENT_TYPES, Env, HttpError, R, Rules, applyScheduleFields, bad, cmpTuple, contentRules, epKey, seasonOf, currentUser,
  escapeRe, exactRegex, getContentColl, logMod, isReleased, json, notifyNewEpisodes, now, objectId, pageParams, parse,
  requireAdmin, requireUploader, validUrl, validVideoUrl, visibleQuery, withVisibility, cleanSubtitles,
  blobPut, blobGet,
} from "../lib";

export const content = new Hono<{ Bindings: Env; Variables: { db: DB } }>();

const MEDIA = ["anime", "tv_show", "movie"] as const;
const COLL_NAME: Record<string, string> = { anime: "anime", tv_show: "tv_shows", movie: "movies" };

async function isStaffRequest(c: AppCtx, flag: boolean) {
  if (!flag) return false;
  const u = await currentUser(c);
  return !!u && (u.role === "admin" || u.role === "uploader");
}

function buildFilterQuery(c: AppCtx, includeHidden: boolean) {
  const q = (c.req.query("q") || "").trim();
  const genre = c.req.query("genre") || "";
  const status = c.req.query("status") || "";
  const season = c.req.query("season") || "";
  const studio = c.req.query("studio") || "";
  const wanted = (c.req.query("genres") || "").split(",").map((g) => g.trim()).filter(Boolean).slice(0, 8);
  const num = (k: string) => { const v = c.req.query(k); return v === undefined || v === "" || isNaN(Number(v)) ? undefined : Number(v); };
  const yearMin = num("year_min"), yearMax = num("year_max"), minRating = num("min_rating");

  const query: Record<string, any> = {};
  if (q) query.title = { $regex: escapeRe(q), $options: "i" };
  if (genre) query.genres = exactRegex(genre);
  if (wanted.length) {
    const clauses: any[] = wanted.map((g) => ({ genres: exactRegex(g) }));
    if (genre) { clauses.push({ genres: exactRegex(genre) }); delete query.genres; }
    query.$and = clauses;
  }
  if (season) query.season = exactRegex(season.trim());
  if (studio) query.studio = exactRegex(studio.trim());
  if (status) query.status = exactRegex(status);
  if (yearMin !== undefined || yearMax !== undefined) {
    query.year = {};
    if (yearMin !== undefined) query.year.$gte = yearMin;
    if (yearMax !== undefined) query.year.$lte = yearMax;
  }
  if (minRating !== undefined) query.avg_rating = { $gte: minRating };
  return withVisibility(query, includeHidden);
}

const SORTS: Record<string, Sort> = {
  newest: [["created_at", -1]], oldest: [["created_at", 1]], title: [["title", 1]],
  rating: [["avg_rating", -1], ["created_at", -1]], views: [["views", -1]], year: [["year", -1]],
};

async function paginated(c: AppCtx, type: string, opts: { limit?: number; extra?: Record<string, string> } = {}) {
  const { page, limit } = pageParams(c, 20);
  const coll = getContentColl(c, type);
  const hidden = await isStaffRequest(c, ["true", "1"].includes((c.req.query("include_hidden") || "").toLowerCase()));
  const query = buildFilterQuery(c, hidden);
  const sort = SORTS[c.req.query("sort") || "newest"] || SORTS.newest;
  const total = await coll.count(query);
  const items = await coll.find(query, { sort, skip: (page - 1) * limit, limit });
  return { items, total };
}

content.get("/api/anime", async (c) => c.json(await paginated(c, "anime")));
content.get("/api/tvshows", async (c) => c.json(await paginated(c, "tv_show")));
content.get("/api/movies", async (c) => c.json(await paginated(c, "movie")));

content.get("/api/genres", async (c) => {
  const db = c.get("db");
  const genres = new Set<string>();
  for (const t of MEDIA) for (const d of await db.content(t)!.find(visibleQuery()))
    for (const g of d.genres || []) if (g && typeof g === "string") genres.add(g.trim());
  return c.json([...genres].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
});

content.get("/api/filters/options", async (c) => {
  const type = c.req.query("type") || "";
  const names: Record<string, string[]> = { anime: ["anime"], tv_show: ["tv_show"], movie: ["movie"], series: ["anime", "tv_show"] };
  const types = names[type] || [...MEDIA];
  const db = c.get("db");
  const genres = new Set<string>(), studios = new Set<string>(), seasons = new Set<string>(), years: number[] = [];
  for (const t of types) for (const d of await db.content(t)!.find(visibleQuery())) {
    for (const g of d.genres || []) if (g && typeof g === "string") genres.add(g.trim());
    if (d.studio) studios.add(String(d.studio).trim());
    if (d.season) { const s = String(d.season).trim(); seasons.add(s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()); }
    if (Number.isInteger(d.year)) years.push(d.year);
  }
  const sortCI = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase());
  const order = ["Winter", "Spring", "Summer", "Fall"];
  return c.json({
    genres: [...genres].sort(sortCI), studios: [...studios].sort(sortCI),
    seasons: [...order.filter((x) => seasons.has(x)), ...[...seasons].filter((x) => !order.includes(x)).sort()],
    year_min: years.length ? Math.min(...years) : null, year_max: years.length ? Math.max(...years) : null,
  });
});

function localRecap(env: Env, description: string) {
  if (String(env.ENABLE_AI_RECAPS).toLowerCase() !== "true") return "";
  const text = (description || "").trim();
  if (!text) return "";
  const sentences = text.replace(/\n/g, " ").split(".").map((s) => s.trim()).filter(Boolean);
  let summary = sentences.slice(0, 2).join(". ");
  if (summary.length > 280) summary = summary.slice(0, 277) + "...";
  return `AI Recap: ${summary}`;
}

content.get("/api/content/:type/:id/similar", async (c) => {
  const coll = getContentColl(c, c.req.param("type"));
  const doc = await coll.findOne({ _id: objectId(c.req.param("id")) });
  if (!doc) throw new HttpError(404, "Not found");
  const genres = doc.genres || [];
  const query: Record<string, any> = { _id: { $ne: doc._id } };
  if (genres.length) query.genres = { $in: genres };
  const limit = Math.min(parseInt(c.req.query("limit") || "8") || 8, 16);
  return c.json(await coll.find(withVisibility(query), { sort: [["avg_rating", -1], ["views", -1]], limit }));
});

// Pretty links: #/detail/anime/<title-slug> -> real id
const slugify = (t: string) =>
  String(t || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ").replace(/['\u2019]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

content.get("/api/resolve/:type/:slug", async (c) => {
  const coll = getContentColl(c, c.req.param("type"));
  const want = c.req.param("slug").toLowerCase();
  const docs = await coll.find(visibleQuery(), { sort: [["views", -1]] });
  const hit = docs.find((d) => slugify(d.title) === want);
  if (!hit) throw new HttpError(404, "Not found");
  return c.json({ _id: hit._id });
});

content.get("/api/content/:type/:id", async (c) => {
  const type = c.req.param("type"), id = c.req.param("id");
  const coll = getContentColl(c, type);
  const db = c.get("db");
  const item = await coll.findOne({ _id: objectId(id) });
  if (!item) throw new HttpError(404, "Not found");
  const user = await currentUser(c);
  const isAdmin = !!user && user.role === "admin";
  if (!isReleased(item) && !isAdmin) throw new HttpError(404, "Not found");

  await coll.updateOne({ _id: item._id }, { $inc: { views: 1 } });
  item.views = (item.views || 0) + 1;

  if (type !== "movie" && !item.ai_recap) {
    const recap = localRecap(c.env, item.description || "");
    if (recap) { await coll.updateOne({ _id: item._id }, { $set: { ai_recap: recap } }); item.ai_recap = recap; }
  }
  item.in_watchlist = !!(user && (await db.watchlist.findOne({ user_id: user._id, content_type: type, content_id: id })));
  if (user) {
    const key = { user_id: user._id, content_type: type, content_id: id };
    item.my_rating = (await db.ratings.findOne(key)) || null;
    item.my_progress = (await db.progress.findOne(key)) || null;
  }
  return c.json(item);
});

// ---------- admin: create / edit / delete ----------
async function insertContent(c: AppCtx, type: string, body: any, withEpisodes: boolean) {
  // Duplicate detector: warn when a title with the same name is already in this library.
  const force = !!body && body.force === true;
  const wanted = String(body?.title || "").trim();
  if (wanted && !force) {
    const dup = await getContentColl(c, type).findOne({ title: exactRegex(wanted) });
    if (dup) throw new HttpError(409, `DUPLICATE: "${dup.title}" is already in the library.`);
  }
  const item = parse(body, contentRules(type === "movie"));
  item.poster = validUrl(item.poster);
  item.banner = validUrl(item.banner);
  item.published = true;
  applyScheduleFields(item);
  item.created_at = now();
  item.views = 0; item.avg_rating = 0; item.rating_count = 0;
  if (withEpisodes) item.episodes = [];
  await getContentColl(c, type).insert(item);
  return item;
}

async function sendWebhook(env: Env, message: string) {
  if (!env.WEBHOOK_URL) return;
  try { await fetch(env.WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: message }) }); } catch { /* ignore */ }
}

content.post("/api/admin/anime", async (c) => {
  await requireUploader(c);
  const item = await insertContent(c, "anime", await json(c), true);
  c.executionCtx.waitUntil(sendWebhook(c.env, `New Anime Added: ${item.title}`));
  return c.json({ message: "Anime added", id: item._id });
});
content.post("/api/admin/tvshows", async (c) => {
  await requireUploader(c);
  const item = await insertContent(c, "tv_show", await json(c), true);
  return c.json({ message: "TV show added", id: item._id });
});
content.post("/api/admin/movies", async (c) => {
  await requireUploader(c);
  const item = await insertContent(c, "movie", await json(c), false);
  return c.json({ message: "Movie added", id: item._id });
});

const episodeRules = (): Rules => ({
  season: R.int({ def: 1 }),
  episode: R.int(),
  title: R.str({ def: "" }),
  description: R.str({ def: "" }),
  thumbnail: R.str({ def: "" }),
  duration: R.str({ def: "" }),
  video_url: R.str({ def: "" }),
  quality_links: R.obj(),
  intro_start: R.int({ min: 0, def: null }),
  intro_end: R.int({ min: 0, def: null }),
  outro_start: R.int({ min: 0, def: null }),
  subtitles: (v: any) => (Array.isArray(v) ? v : []),
});

function cleanQualityLinks(links: Record<string, any>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(links || {})) out[k] = validVideoUrl(String(v));
  return out;
}

async function inheritSeasonThumb(coll: any, id: string, ep: Doc) {
  if ((ep.thumbnail || "").trim()) return;
  const doc = (await coll.findOne({ _id: id })) || {};
  const map = doc.season_thumbnails || {};
  const thumb = map[String(seasonOf(ep))] || map.all;
  if (thumb) ep.thumbnail = thumb;
}

async function addEpisode(c: AppCtx, type: "anime" | "tv_show") {
  await requireUploader(c);
  const id = objectId(c.req.param("id"));
  const ep = parse(await json(c), episodeRules());
  ep.video_url = validVideoUrl(ep.video_url);
  if (ep.thumbnail) ep.thumbnail = validUrl(ep.thumbnail) || ep.thumbnail;
  ep.subtitles = cleanSubtitles(ep.subtitles);
  ep.quality_links = cleanQualityLinks(ep.quality_links);
  const coll = getContentColl(c, type);
  await inheritSeasonThumb(coll, id, ep);
  const matched = await coll.updateOne({ _id: id }, { $push: { episodes: ep } });
  if (!matched) throw new HttpError(404, type === "anime" ? "Anime not found" : "TV show not found");
  const parent = (await coll.findOne({ _id: id })) || {};
  if (isReleased(parent) && ep.video_url)
    c.executionCtx.waitUntil(notifyNewEpisodes(c.get("db"), type, id, parent.title || (type === "anime" ? "Anime" : "TV show"), ep.season, ep.episode));
  return c.json({ message: "Episode added" });
}
content.post("/api/admin/anime/:id/episodes", (c) => addEpisode(c, "anime"));
content.post("/api/admin/tvshows/:id/episodes", (c) => addEpisode(c, "tv_show"));

content.put("/api/admin/:type/:id/episodes/:season/:episode", async (c) => {
  await requireUploader(c);
  const type = c.req.param("type");
  if (!["anime", "tv_show"].includes(type)) throw bad("Only anime and tv_show have episodes");
  const coll = getContentColl(c, type);
  const id = objectId(c.req.param("id"));
  const season = Number(c.req.param("season")), episode = Number(c.req.param("episode"));
  const doc = await coll.findOne({ _id: id });
  if (!doc) throw new HttpError(404, "Not found");
  const rules = episodeRules();
  const updates = parse(await json(c), rules, true);
  const episodes: Doc[] = doc.episodes || [];
  const ep = episodes.find((e) => e.season === season && e.episode === episode);
  if (!ep) throw new HttpError(404, "Episode not found");
  if ("video_url" in updates) updates.video_url = validVideoUrl(updates.video_url);
  if (updates.thumbnail) updates.thumbnail = validUrl(updates.thumbnail) || updates.thumbnail;
  if ("subtitles" in updates) updates.subtitles = cleanSubtitles(updates.subtitles);
  if (updates.quality_links && Object.keys(updates.quality_links).length) updates.quality_links = cleanQualityLinks(updates.quality_links);
  Object.assign(ep, updates);
  await coll.updateOne({ _id: id }, { $set: { episodes } });
  return c.json({ message: "Episode updated" });
});

content.delete("/api/admin/:type/:id/episodes/:season/:episode", async (c) => {
  await requireAdmin(c);
  const type = c.req.param("type");
  if (!["anime", "tv_show"].includes(type)) throw bad("Only anime and tv_show have episodes");
  const coll = getContentColl(c, type);
  const matched = await coll.updateOne({ _id: objectId(c.req.param("id")) },
    { $pull: { episodes: { season: Number(c.req.param("season")), episode: Number(c.req.param("episode")) } } });
  if (!matched) throw new HttpError(404, "Not found");
  return c.json({ message: "Episode deleted" });
});

content.put("/api/admin/content/:type/:id", async (c) => {
  await requireUploader(c);
  const type = c.req.param("type");
  const coll = getContentColl(c, type);
  const fields = parse(await json(c), contentRules(true), true);
  for (const k of ["poster", "banner"]) if (k in fields) fields[k] = validUrl(fields[k]);
  if (type !== "movie") delete fields.quality_links;
  applyScheduleFields(fields);
  fields.updated_at = now();
  const matched = await coll.updateOne({ _id: objectId(c.req.param("id")) }, { $set: fields });
  if (!matched) throw new HttpError(404, "Not found");
  return c.json({ message: "Updated" });
});

// Trash bin: deleting moves a title to the trash for 30 days instead of erasing it.
const TRASH_DAYS = 30;

content.delete("/api/admin/content/:type/:id", async (c) => {
  const admin = await requireAdmin(c);
  const type = c.req.param("type");
  const coll = getContentColl(c, type);
  const id = objectId(c.req.param("id"));
  const item = await coll.findOne({ _id: id });
  if (!item) throw new HttpError(404, "Not found");
  const db = c.get("db");
  await db.c("trash").insert({ content_type: type, item_id: id, title: item.title || "", item, deleted_at: now(), deleted_by: admin.email || "" });
  await coll.deleteOne({ _id: id });
  await logMod(db, admin, "content_trashed", item.title || id, type);
  return c.json({ message: "Moved to trash" });
});

content.get("/api/admin/trash", async (c) => {
  await requireAdmin(c);
  const rows = await c.get("db").c("trash").find({}, { sort: [["deleted_at", -1]], limit: 200 });
  return c.json({
    items: rows.map((r) => ({
      _id: r._id, content_type: r.content_type, title: r.title, poster: r.item?.poster || "",
      deleted_at: r.deleted_at, deleted_by: r.deleted_by,
      expires_at: new Date(new Date(r.deleted_at).getTime() + TRASH_DAYS * 86400000).toISOString(),
    })),
    total: rows.length,
  });
});

content.post("/api/admin/trash/:id/restore", async (c) => {
  const admin = await requireAdmin(c);
  const db = c.get("db");
  const row = await db.c("trash").findOne({ _id: objectId(c.req.param("id")) });
  if (!row) throw new HttpError(404, "Not found in trash");
  const coll = getContentColl(c, row.content_type);
  if (await coll.findOne({ _id: row.item_id })) throw bad("A title with this id already exists");
  await coll.insert({ ...row.item, _id: row.item_id });
  await db.c("trash").deleteOne({ _id: row._id });
  await logMod(db, admin, "content_restored", row.title || "", row.content_type);
  return c.json({ message: "Restored" });
});

content.delete("/api/admin/trash/:id", async (c) => {
  const admin = await requireAdmin(c);
  const db = c.get("db");
  const row = await db.c("trash").findOne({ _id: objectId(c.req.param("id")) });
  if (!row) throw new HttpError(404, "Not found in trash");
  await purgeTrashed(db, row);
  await logMod(db, admin, "content_deleted_forever", row.title || "", row.content_type);
  return c.json({ message: "Deleted permanently" });
});

export async function purgeTrashed(db: DB, row: Doc) {
  const f = { content_type: row.content_type, content_id: row.item_id };
  await Promise.all([db.watchlist.deleteMany(f), db.comments.deleteMany(f), db.progress.deleteMany(f), db.ratings.deleteMany(f)]);
  await db.c("trash").deleteOne({ _id: row._id });
}

export async function purgeExpiredTrash(db: DB) {
  const cutoff = new Date(Date.now() - TRASH_DAYS * 86400000).toISOString();
  for (const row of await db.c("trash").find({ deleted_at: { $lt: cutoff } })) await purgeTrashed(db, row);
}

content.post("/api/admin/bulk-import", async (c) => {
  await requireUploader(c);
  const items = await json(c);
  if (!Array.isArray(items)) throw bad("Expected a list of items");
  let added = 0;
  for (const raw of items.slice(0, 100)) {
    const type = R.oneOf(MEDIA)(raw?.content_type, "content_type");
    const base = parse(raw, {
      title: R.str({ min: 1 }), description: R.str({ def: "" }), genres: R.strList(), year: R.int({ def: null }),
      poster: R.str({ def: "" }), banner: R.str({ def: "" }), status: R.str({ def: "Ongoing" }),
    });
    if (type === "movie") base.quality_links = R.obj()(raw.quality_links, "quality_links");
    await insertContent(c, type, base, type !== "movie");
    added++;
  }
  return c.json({ message: `Imported ${added} items` });
});

content.post("/api/admin/bulk-episodes", async (c) => {
  await requireUploader(c);
  const d = parse(await json(c), {
    content_type: R.oneOf(["anime", "tv_show"] as const), content_id: R.str(),
    episodes: (v: any) => { if (!Array.isArray(v)) throw bad("episodes must be a list"); return v; },
  });
  const coll = getContentColl(c, d.content_type);
  const doc = await coll.findOne({ _id: objectId(d.content_id) });
  if (!doc) throw new HttpError(404, "Content not found");
  const existing: Doc[] = [...(doc.episodes || [])];
  let added = 0;
  let newest: [number, number] | null = null;
  for (const raw of d.episodes) {
    const ep = parse(raw, { season: R.int({ def: 1 }), episode: R.int(), title: R.str({ def: "" }), video_url: R.str({ def: "" }), duration: R.str({ def: "" }), description: R.str({ def: "" }) });
    if (existing.some((e) => e.season === ep.season && e.episode === ep.episode)) continue;
    existing.push({
      season: ep.season, episode: ep.episode, title: ep.title || `Episode ${ep.episode}`, description: ep.description,
      duration: ep.duration, video_url: ep.video_url ? validVideoUrl(ep.video_url) : "", quality_links: {}, thumbnail: "",
    });
    added++;
    if (ep.video_url && ep.season !== 0 && ep.episode < 1000 && (!newest || cmpTuple([ep.season, ep.episode], newest) > 0)) newest = [ep.season, ep.episode];
  }
  existing.sort((a, b) => cmpTuple(epKey(a), epKey(b)));
  await coll.updateOne({ _id: doc._id }, { $set: { episodes: existing } });
  if (added && newest && isReleased(doc))
    c.executionCtx.waitUntil(notifyNewEpisodes(c.get("db"), d.content_type, d.content_id, doc.title || "", newest[0], newest[1], added));
  return c.json({ message: `Added ${added} episodes`, total: existing.length });
});

// Fill episode names + descriptions with Google's Gemini API (key = GOOGLE_API_KEY secret).
content.post("/api/admin/ai-episodes", async (c) => {
  await requireUploader(c);
  const key = c.env.GOOGLE_API_KEY;
  if (!key) throw bad("GOOGLE_API_KEY is not set. Run: npx wrangler secret put GOOGLE_API_KEY");
  const d = parse(await json(c), {
    content_type: R.oneOf(["anime", "tv_show"] as const), content_id: R.str(), title: R.str({ def: "" }),
    season: R.int({ def: 1 }),
    episodes: (v: any) => {
      if (!Array.isArray(v) || !v.length || v.length > 50) throw bad("episodes must be a list of 1-50 numbers");
      return v.map((n) => { const x = Math.trunc(Number(n)); if (!x || x < 1) throw bad("invalid episode number"); return x; });
    },
  });
  const doc = await getContentColl(c, d.content_type).findOne({ _id: objectId(d.content_id) });
  if (!doc) throw new HttpError(404, "Content not found");
  const title = String(doc.title || d.title);
  const prompt =
    `You are filling in episode metadata for the ${d.content_type === "anime" ? "anime" : "TV show"} "${title}" (season ${d.season}).\n` +
    (doc.description ? `Series synopsis: ${String(doc.description).slice(0, 800)}\n` : "") +
    `For each of these episode numbers: ${d.episodes.join(", ")}\n` +
    `Return the official episode title and a 1-2 sentence spoiler-light description (max 220 chars). ` +
    `If you do not know the real title, use "Episode N" and leave the description empty. Never invent plot details.`;
  const model = c.env.GEMINI_MODEL || "gemini-2.5-flash";
  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3, responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { episode: { type: "INTEGER" }, title: { type: "STRING" }, description: { type: "STRING" } },
              required: ["episode", "title", "description"],
            },
          },
        },
      }),
    });
  } catch (e) { throw new HttpError(502, `Google API unreachable: ${e}`); }
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `Google API error: ${body?.error?.message || res.status}`);
  let rows: any[] = [];
  try { rows = JSON.parse(body?.candidates?.[0]?.content?.parts?.[0]?.text || "[]"); } catch { throw new HttpError(502, "Google API returned unreadable output"); }
  const wanted = new Set(d.episodes);
  const episodes = (Array.isArray(rows) ? rows : [])
    .filter((r) => wanted.has(Number(r?.episode)))
    .map((r) => ({ episode: Number(r.episode), title: String(r.title || "").slice(0, 200), description: String(r.description || "").slice(0, 1000) }));
  return c.json({ episodes });
});

content.patch("/api/admin/content/:type/:id/schedule", async (c) => {
  await requireAdmin(c);
  const d = parse(await json(c), { scheduled_at: R.optStr(40), published: R.bool(true) });
  const coll = getContentColl(c, c.req.param("type"));
  const updates: Record<string, any> = { published: d.published };
  if (d.scheduled_at) {
    const t = new Date(/([zZ]|[+-]\d{2}:?\d{2})$/.test(d.scheduled_at) ? d.scheduled_at : d.scheduled_at + "Z");
    if (isNaN(t.getTime())) throw bad("Invalid scheduled_at (use ISO format)");
    updates.scheduled_at = t.toISOString();
    updates.published = false;
  } else updates.scheduled_at = null;
  const matched = await coll.updateOne({ _id: objectId(c.req.param("id")) }, { $set: updates });
  if (!matched) throw new HttpError(404, "Not found");
  return c.json({ message: "Schedule updated" });
});

content.post("/api/admin/:type/:id/season-thumbnail", async (c) => {
  await requireUploader(c);
  const type = c.req.param("type");
  if (!["anime", "tv_show"].includes(type)) throw bad("Only series support seasons");
  const data = await json(c);
  const applyAll = String(data.season).trim().toLowerCase() === "all";
  const season = applyAll ? 1 : (data.season == null || data.season === "" || !Number.isFinite(Number(data.season)) ? 1 : Math.trunc(Number(data.season)));
  const thumb = validUrl(data.thumbnail || "");
  if (!thumb) throw bad("Valid thumbnail URL required");
  const coll = getContentColl(c, type);
  const id = objectId(c.req.param("id"));
  const doc = await coll.findOne({ _id: id });
  if (!doc) throw new HttpError(404, "Not found");
  const map: Record<string, string> = { ...(doc.season_thumbnails || {}) };
  const overwrite = data.overwrite !== false;
  const episodes: Doc[] = doc.episodes || [];
  if (applyAll) { map.all = thumb; for (const e of episodes) map[String(seasonOf(e))] = thumb; }
  else map[String(season)] = thumb;
  let count = 0;
  for (const e of episodes) {
    if (!applyAll && seasonOf(e) !== season) continue;
    if (overwrite || !(e.thumbnail || "").trim()) { e.thumbnail = thumb; count++; }
  }
  await coll.updateOne({ _id: id }, { $set: { season_thumbnails: map, episodes, updated_at: now() } });
  return c.json({ message: `Thumbnail applied to ${count} episode(s)`, season_thumbnails: map });
});

// ---------- stats & analytics ----------
content.get("/api/admin/stats", async (c) => {
  await requireAdmin(c);
  const db = c.get("db");
  let totalViews = 0;
  for (const t of MEDIA) for (const d of await db.content(t)!.find({})) totalViews += Number(d.views) || 0;
  return c.json({
    anime: await db.content("anime")!.count(), tv_shows: await db.content("tv_show")!.count(), movies: await db.content("movie")!.count(),
    users: await db.users.count(), requests_pending: await db.requests.count({ status: "Pending" }),
    reports_open: await db.comments.count({ report_count: { $gt: 0 } }), banned_users: await db.users.count({ banned: true }),
    total_views: totalViews,
  });
});

content.get("/api/admin/analytics", async (c) => {
  await requireAdmin(c);
  const db = c.get("db");
  const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
  const since = (coll: any, d: string) => coll.count({ created_at: { $gte: d } });
  const week = ago(7), month = ago(30);
  return c.json({
    totals: {
      anime: await db.content("anime")!.count(), tv_shows: await db.content("tv_show")!.count(), movies: await db.content("movie")!.count(),
      users: await db.users.count(), comments: await db.comments.count(), requests_pending: await db.requests.count({ status: "Pending" }),
    },
    growth: { users_7d: await since(db.users, week), users_30d: await since(db.users, month), comments_7d: await since(db.comments, week), requests_7d: await since(db.requests, week) },
    top_viewed: {
      anime: await db.content("anime")!.find({}, { sort: [["views", -1]], limit: 5 }),
      movies: await db.content("movie")!.find({}, { sort: [["views", -1]], limit: 5 }),
    },
    recent_requests: await db.requests.find({}, { sort: [["created_at", -1]], limit: 8 }),
  });
});

// ---------- release schedule + home curation ----------
function scheduleCard(doc: Doc, type: string) {
  const eps: Doc[] = doc.episodes || [];
  return {
    content_type: type, content_id: doc._id, title: doc.title || "", poster: doc.poster || "", status: doc.status || "",
    genres: (doc.genres || []).slice(0, 3), air_weekday: doc.air_weekday ?? null, air_time: doc.air_time || "",
    latest_episode: eps.reduce((m, e) => ((e.episode || 0) < 1000 ? Math.max(m, e.episode || 0) : m), 0),
    scheduled_at: doc.scheduled_at ?? null, published: doc.published !== false,
  };
}

content.get("/api/schedule", async (c) => {
  const db = c.get("db");
  const weekly: any[] = [];
  for (const t of ["anime", "tv_show"]) {
    const q = withVisibility({ air_weekday: { $in: [0, 1, 2, 3, 4, 5, 6] }, status: { $ne: "Completed" } });
    for (const d of await db.content(t)!.find(q)) weekly.push(scheduleCard(d, t));
  }
  weekly.sort((a, b) => a.air_weekday - b.air_weekday ||
    (a.air_time || "99:99").localeCompare(b.air_time || "99:99") || a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  const upcoming: any[] = [];
  const nowIso = now();
  for (const t of MEDIA) for (const d of await db.content(t)!.find({ published: false, scheduled_at: { $gt: nowIso } }))
    upcoming.push(scheduleCard(d, t));
  upcoming.sort((a, b) => String(a.scheduled_at || "").localeCompare(String(b.scheduled_at || "")));
  return c.json({ weekly, upcoming: upcoming.slice(0, 30), now: nowIso });
});

content.get("/api/home-featured", async (c) => {
  const db = c.get("db");
  const result: Record<string, any[]> = { hero: [], top_airing: [] };
  for (const [flag, orderKey, cap] of [["hero", "hero_order", 8], ["top_airing", "top_rank", 10]] as const) {
    const rows: Doc[] = [];
    for (const t of MEDIA) for (const d of (await db.content(t)!.find(withVisibility({ [flag]: true }), { limit: 50 }))) {
      rows.push({ ...d, _type: t, episodes: (d.episodes || []).map((e: Doc) => ({ season: e.season, episode: e.episode, duration: e.duration || "" })) });
    }
    rows.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    rows.sort((a, b) => (a[orderKey] || 999) - (b[orderKey] || 999));
    result[flag] = rows.slice(0, cap);
  }
  return c.json(result);
});

// ---------- search & recommendations ----------
content.get("/api/search", async (c) => {
  const q = (c.req.query("q") || "").trim();
  if (!q) throw new HttpError(422, "Enter something to search for");
  const type = c.req.query("type") || "";
  const sortKey = c.req.query("sort") || "newest";
  const { page, limit } = pageParams(c, 24);
  const types = (CONTENT_TYPES as string[]).includes(type) ? [type] : CONTENT_TYPES;
  const results: Doc[] = [];
  for (const t of types) {
    const query = buildFilterQuery(c, false);
    const items = await c.get("db").content(t)!.find(query, { sort: SORTS[sortKey] || SORTS.newest, skip: (page - 1) * limit, limit });
    for (const it of items) results.push({ ...it, content_type: t });
  }
  if (!type) results.sort((a, b) => (String(a.created_at || "") < String(b.created_at || "") ? 1 : -1) * (sortKey === "oldest" ? -1 : 1));
  return c.json({ items: results.slice(0, limit), q });
});

content.get("/api/recommendations", async (c) => {
  const user = await currentUser(c);
  const db = c.get("db");
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "12") || 12, 1), 24);
  const preferred = new Set<string>();
  if (user) {
    const rows = [...(await db.ratings.find({ user_id: user._id }, { limit: 40 })), ...(await db.watchlist.find({ user_id: user._id }, { limit: 30 }))];
    for (const r of rows) {
      const coll = db.content(r.content_type);
      const doc = coll && (await coll.findOne({ _id: r.content_id }));
      (doc?.genres || []).forEach((g: string) => preferred.add(g));
    }
  }
  const query: Record<string, any> = {};
  if (preferred.size) query.genres = { $in: [...preferred].slice(0, 10) };
  const results: Doc[] = [];
  for (const t of CONTENT_TYPES)
    for (const d of await db.content(t)!.find(withVisibility(query), { sort: [["avg_rating", -1], ["views", -1]], limit }))
      results.push({ ...d, content_type: t });
  results.sort((a, b) => (b.avg_rating || 0) - (a.avg_rating || 0) || (b.views || 0) - (a.views || 0));
  return c.json(results.slice(0, limit));
});

// ---------- Anilist / Jikan metadata ----------
const ANILIST_FIELDS = `id title { romaji english native } description(asHtml: false) genres averageScore startDate { year }
  season seasonYear studios(isMain: true) { nodes { name } } coverImage { large extraLarge } bannerImage status`;

content.post("/api/admin/import/anilist", async (c) => {
  await requireUploader(c);
  const d = parse(await json(c), { anilist_id: R.int({ def: null }), search: R.optStr(200), content_type: R.oneOf(["anime", "tv_show"] as const, "anime") });
  let gql: string, variables: Record<string, any>;
  if (d.anilist_id) { gql = `query ($id: Int) { Media(id: $id, type: ANIME) { ${ANILIST_FIELDS} } }`; variables = { id: d.anilist_id }; }
  else if (d.search) { gql = `query ($search: String) { Media(search: $search, type: ANIME, sort: POPULARITY_DESC) { ${ANILIST_FIELDS} } }`; variables = { search: d.search }; }
  else throw bad("Provide anilist_id or search text");

  let payload: any;
  try {
    const resp = await fetch("https://graphql.anilist.co", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: gql, variables }) });
    if (!resp.ok) throw new HttpError(502, "Anilist returned an error");
    payload = await resp.json();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, `Could not reach Anilist: ${e}`);
  }
  const media = payload?.data?.Media;
  if (!media) throw new HttpError(404, "Nothing found on Anilist");
  const title = media.title?.english || media.title?.romaji || media.title?.native || "Untitled";
  const desc = (media.description || "").replace(/<br>/g, "\n").replace(/<[^>]+>/g, "");
  const statusMap: Record<string, string> = { FINISHED: "Completed", RELEASING: "Ongoing", NOT_YET_RELEASED: "Upcoming", CANCELLED: "Completed", HIATUS: "Ongoing" };
  const season = String(media.season || "");
  const item: Doc = {
    title: title.slice(0, 180), description: desc.slice(0, 5000), genres: media.genres || [], year: media.startDate?.year ?? null,
    rating: media.averageScore ? String(Math.round(media.averageScore) / 10) : "",
    poster: media.coverImage?.extraLarge || media.coverImage?.large || "", banner: media.bannerImage || "",
    season: season.charAt(0).toUpperCase() + season.slice(1).toLowerCase(), studio: media.studios?.nodes?.[0]?.name || "",
    status: statusMap[media.status] || "Ongoing", poster_tag: "NEW", dubbed_on: [], anilist_id: media.id, created_at: now(),
    views: 0, avg_rating: 0, rating_count: 0, episodes: [], published: true, scheduled_at: null,
  };
  const coll = getContentColl(c, d.content_type);
  const existing = await coll.findOne({ title: exactRegex(title) });
  if (existing) return c.json({ message: "Title already exists", id: existing._id, item: existing });
  await coll.insert(item);
  return c.json({ message: "Imported from Anilist", id: item._id, item });
});

async function jikan(path: string) {
  const r = await fetch(`https://api.jikan.moe/v4${path}`, { headers: { "User-Agent": "Anicore/1.0", Accept: "application/json" } });
  if (!r.ok) throw new HttpError(502, `MyAnimeList API error (${r.status})`);
  return (await r.json()) as any;
}

content.get("/api/meta/anime", async (c) => {
  const q = (c.req.query("q") || "").trim();
  if (q.length < 2) throw bad("Enter at least 2 characters of the title");
  let payload: any;
  try { payload = await jikan(`/anime?q=${encodeURIComponent(q)}&limit=5`); }
  catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(502, `Fetch failed: ${e}`); }
  const rows: any[] = payload.data || [];
  if (!rows.length) throw new HttpError(404, "No anime found for that title");
  let data = rows[0];
  const ql = q.toLowerCase();
  for (const row of rows) {
    const titles = [row.title, row.title_english, row.title_japanese].filter(Boolean) as string[];
    if (titles.some((t) => t.toLowerCase().includes(ql))) { data = row; if ((row.type || "").toUpperCase() === "TV") break; }
  }
  const jpg = data.images?.jpg || {}, webp = data.images?.webp || {};
  const poster = jpg.large_image_url || webp.large_image_url || jpg.image_url || webp.image_url || "";
  const trailer = data.trailer?.images?.maximum_image_url || "";
  const year = data.year || data.aired?.prop?.from?.year || "";
  return c.json({
    mal_id: data.mal_id, title: data.title_english || data.title || q, description: (data.synopsis || "").trim().slice(0, 5000),
    poster, banner: trailer || poster, year, genres: (data.genres || []).map((g: any) => g.name).filter(Boolean).join(", "),
    rating: data.score != null ? String(data.score) : "", duration: data.duration || "", episodes: data.episodes, status: data.status || "", type: data.type || "",
  });
});

content.get("/api/meta/episode", async (c) => {
  const title = c.req.query("title") || "";
  const episode = parseInt(c.req.query("episode") || "1") || 1;
  const season = parseInt(c.req.query("season") || "1") || 1;
  let mid = parseInt(c.req.query("mal_id") || "0") || 0;
  let ep: any = {}, anime: any = {};
  try {
    if (!mid && title.trim()) {
      const rows: any[] = (await jikan(`/anime?q=${encodeURIComponent(title.trim())}&limit=5`)).data || [];
      if (rows.length) { mid = Number(rows[0].mal_id) || 0; const tv = rows.find((r) => (r.type || "").toUpperCase() === "TV"); if (tv) mid = Number(tv.mal_id) || 0; }
    }
    if (!mid) throw new HttpError(404, "Anime not found — type the series title or set episode after auto-fetch on the title");
    try { anime = (await jikan(`/anime/${mid}/full`)).data || {}; } catch { try { anime = (await jikan(`/anime/${mid}`)).data || {}; } catch { anime = {}; } }
    for (let page = 1; page <= 8 && !ep.mal_id; page++) {
      let body: any;
      try { body = await jikan(`/anime/${mid}/episodes?page=${page}`); } catch { break; }
      const items: any[] = body.data || [];
      if (!items.length) break;
      ep = items.find((r) => Number(r.mal_id) === episode || Number(r.episode) === episode) || {};
      if (!body.pagination?.has_next_page) break;
    }
    if (!ep.mal_id) { try { ep = (await jikan(`/anime/${mid}/episodes/${episode}`)).data || {}; } catch { ep = {}; } }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, `Fetch failed: ${e}`);
  }
  let duration: string = anime.duration || "";
  const m = /(\d+)\s*min/.exec(duration.toLowerCase());
  if (m) duration = `${m[1]}m`;
  const jpg = anime.images?.jpg || {};
  return c.json({
    mal_id: mid, title: (ep.title || ep.title_romanji || ep.title_japanese || "").trim() || `Episode ${episode}`,
    description: (ep.synopsis || "").trim().slice(0, 5000), duration, thumbnail: jpg.large_image_url || jpg.image_url || "",
    season, episode, found: Object.keys(ep).length > 0,
  });
});

// ---------- image upload (stored in D1) ----------
const MAX_UPLOAD = 1_300_000;
const ALLOWED_IMAGE: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };

content.post("/api/upload/image", async (c) => {
  const user = await currentUser(c);
  if (!user || !["admin", "uploader"].includes(user.role)) throw new HttpError(403, "Uploaders only");
  const form = await c.req.formData();
  const file = form.get("file") as unknown as File | null;
  if (!file || typeof file === "string") throw new HttpError(422, "file is required");
  const type = (file.type || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_IMAGE[type]) throw bad("Only JPEG, PNG, WebP or GIF allowed");
  const buf = await file.arrayBuffer();
  if (buf.byteLength > MAX_UPLOAD) throw bad("Image must be under 1.3MB");
  const name = `${crypto.randomUUID().replace(/-/g, "")}${ALLOWED_IMAGE[type]}`;
  await blobPut(c.env, `uploads/${name}`, type, new Uint8Array(buf));
  return c.json({ url: `/assets/uploads/${name}`, message: "Uploaded" });
});

content.get("/assets/uploads/:name", async (c) => {
  const obj = await blobGet(c.env, `uploads/${c.req.param("name")}`);
  if (!obj) return c.text("Not found", 404);
  return new Response(obj.bytes, { headers: {
    "Content-Type": obj.type || "application/octet-stream",
    "Cache-Control": "public, max-age=31536000, immutable",
  } });
});
