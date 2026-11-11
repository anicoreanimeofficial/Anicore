import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { DB, Doc, isId } from "./db";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SECRET_KEY: string;
  ENVIRONMENT?: string;
  APP_NAME?: string;
  SITE_URL?: string;
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD?: string;
  TELEGRAM_BOT_TOKEN?: string;
  WEBHOOK_URL?: string;
  ENABLE_AI_RECAPS?: string;
  GOOGLE_API_KEY?: string;
  GEMINI_MODEL?: string;
}
export type AppCtx = Context<{ Bindings: Env; Variables: { db: DB } }>;

// ---------- image storage (D1 "blobs" table, base64) ----------
export async function blobPut(env: Env, key: string, type: string, bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  await env.DB.prepare("INSERT OR REPLACE INTO blobs (key, type, data) VALUES (?, ?, ?)").bind(key, type, btoa(bin)).run();
}
export async function blobGet(env: Env, key: string): Promise<{ type: string; bytes: Uint8Array } | null> {
  const row = await env.DB.prepare("SELECT type, data FROM blobs WHERE key = ?").bind(key).first<{ type: string; data: string }>();
  if (!row) return null;
  return { type: row.type, bytes: Uint8Array.from(atob(row.data), (ch) => ch.charCodeAt(0)) };
}
export async function blobDelete(env: Env, key: string) {
  await env.DB.prepare("DELETE FROM blobs WHERE key = ?").bind(key).run();
}

export const COOKIE_NAME = "anicore_session";
export const TOKEN_TTL = 60 * 60 * 24 * 7;
export const CONTENT_TYPES = ["anime", "tv_show", "movie"];

// ---------- errors & validation ----------
export class HttpError extends Error {
  constructor(public status: number, public detail: string) { super(detail); }
}
export const bad = (msg: string) => new HttpError(400, msg);
const invalid = (msg: string) => new HttpError(422, msg);

export type Rules = Record<string, (v: any, key: string) => any>;
export const R = {
  str: (o: { min?: number; max?: number; def?: string; pattern?: RegExp } = {}) => (v: any, k: string) => {
    if (v === undefined || v === null) { if (o.def !== undefined) return o.def; throw invalid(`${k} is required`); }
    if (typeof v !== "string") throw invalid(`${k} must be text`);
    if (o.min !== undefined && v.length < o.min) throw invalid(`${k} is too short`);
    if (o.max !== undefined && v.length > o.max) throw invalid(`${k} is too long (max ${o.max})`);
    if (o.pattern && !o.pattern.test(v)) throw invalid(`${k} is not in the right format`);
    return v;
  },
  int: (o: { min?: number; max?: number; def?: number | null } = {}) => (v: any, k: string) => {
    if (v === undefined || v === null || v === "") { if (o.def !== undefined) return o.def; throw invalid(`${k} is required`); }
    const n = Number(v);
    if (!Number.isInteger(n)) throw invalid(`${k} must be a whole number`);
    if (o.min !== undefined && n < o.min) throw invalid(`${k} must be at least ${o.min}`);
    if (o.max !== undefined && n > o.max) throw invalid(`${k} must be at most ${o.max}`);
    return n;
  },
  num: (o: { min?: number; max?: number; def?: number } = {}) => (v: any, k: string) => {
    if (v === undefined || v === null) { if (o.def !== undefined) return o.def; throw invalid(`${k} is required`); }
    const n = Number(v);
    if (!Number.isFinite(n)) throw invalid(`${k} must be a number`);
    if (o.min !== undefined && n < o.min) throw invalid(`${k} must be at least ${o.min}`);
    if (o.max !== undefined && n > o.max) throw invalid(`${k} must be at most ${o.max}`);
    return n;
  },
  bool: (def?: boolean) => (v: any, k: string) => {
    if (v === undefined || v === null) { if (def !== undefined) return def; throw invalid(`${k} is required`); }
    return Boolean(v);
  },
  strList: (def: string[] = []) => (v: any, k: string) => {
    if (v === undefined || v === null) return def;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw invalid(`${k} must be a list of text`);
    return v as string[];
  },
  obj: (def: Record<string, any> = {}) => (v: any, k: string) => {
    if (v === undefined || v === null) return def;
    if (typeof v !== "object" || Array.isArray(v)) throw invalid(`${k} must be an object`);
    return v;
  },
  optStr: (max = 2000) => (v: any, k: string) => {
    if (v === undefined || v === null) return null;
    if (typeof v !== "string" || v.length > max) throw invalid(`${k} is not valid`);
    return v;
  },
  oneOf: <T extends string>(vals: readonly T[], def?: T) => (v: any, k: string): T => {
    if (v === undefined || v === null) { if (def !== undefined) return def; throw invalid(`${k} is required`); }
    if (!vals.includes(v)) throw invalid(`${k} must be one of: ${vals.join(", ")}`);
    return v;
  },
  email: () => (v: any, k: string) => {
    if (typeof v !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) || v.length > 254)
      throw invalid("Enter a valid email address");
    return v.trim();
  },
  any: () => (v: any) => v,
};

/** Validate a JSON body. `partial` = only keep/validate keys that were sent (Pydantic exclude_unset). */
export function parse(body: any, rules: Rules, partial = false): Record<string, any> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw invalid("Invalid request body");
  const out: Record<string, any> = {};
  for (const [k, rule] of Object.entries(rules)) {
    if (partial && !(k in body)) continue;
    out[k] = rule(body[k], k);
  }
  return out;
}
export async function json(c: AppCtx): Promise<any> {
  try { return await c.req.json(); } catch { throw invalid("Invalid JSON body"); }
}

export function objectId(v: unknown): string {
  if (!isId(v)) throw bad("Invalid ID.");
  return v;
}

// ---------- crypto: password hashing + JWT ----------
const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ""; bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
};
const b64url = (buf: ArrayBuffer | Uint8Array) => b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const PBKDF2_ITER = 100_000; // Workers' WebCrypto maximum
async function pbkdf2(password: string, salt: Uint8Array, iter: number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: iter }, key, 256));
}
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITER}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, PBKDF2_ITER))}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, iter, salt, hash] = stored.split("$");
    if (scheme !== "pbkdf2") return false;
    const actual = await pbkdf2(password, unb64(salt), Number(iter));
    const expected = unb64(hash);
    if (actual.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
    return diff === 0;
  } catch { return false; }
}

async function hmacKey(secret: string, usage: KeyUsage[]) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usage);
}
export async function signToken(env: Env, sub: string, email: string, role: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify({ sub, email, role, iat: now, exp: now + TOKEN_TTL })));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env.SECRET_KEY, ["sign"]), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}
export async function verifyToken(env: Env, token: string): Promise<{ sub: string } | null> {
  try {
    const [h, p, s] = token.split(".");
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(env.SECRET_KEY, ["verify"]), unb64(s), enc.encode(`${h}.${p}`));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(unb64(p)));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}
export async function hmacSha256(key: ArrayBuffer | Uint8Array | string, msg: string): Promise<Uint8Array> {
  const raw = (typeof key === "string" ? enc.encode(key) : key) as BufferSource;
  const k = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
export const toHex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, "0")).join("");

export function cookieOptions(env: Env) {
  return { httpOnly: true, secure: (env.ENVIRONMENT || "development").toLowerCase() === "production",
    sameSite: "Lax" as const, maxAge: TOKEN_TTL, path: "/" };
}

// ---------- current user & permission helpers ----------
export async function currentUser(c: AppCtx): Promise<Doc | null> {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return null;
  const payload = await verifyToken(c.env, token);
  if (!payload || !isId(payload.sub)) return null;
  const user = await c.get("db").users.findOne({ _id: payload.sub });
  if (!user || user.banned) return null; // banned accounts count as signed out
  return user;
}
export async function requireUser(c: AppCtx): Promise<Doc> {
  const u = await currentUser(c);
  if (!u) throw new HttpError(401, "Sign in required");
  return u;
}
export async function requireAdmin(c: AppCtx): Promise<Doc> {
  const u = await requireUser(c);
  if (u.role !== "admin") throw new HttpError(403, "Admin only");
  return u;
}
export async function requireUploader(c: AppCtx): Promise<Doc> {
  const u = await requireUser(c);
  if (u.role !== "admin" && u.role !== "uploader") throw new HttpError(403, "Uploader access required");
  return u;
}

// ---------- content helpers ----------
export const now = () => new Date().toISOString();

export function validUrl(url: string): string {
  url = (url || "").trim();
  if (!url) return "";
  if (url.startsWith("https://") || url.startsWith("/assets/")) return url;
  throw bad("URL must start with https:// or /assets/");
}
export function validVideoUrl(url: string): string {
  url = (url || "").trim();
  if (!url) return "";
  if (!url.startsWith("https://")) throw bad("Video URL must start with https://");
  return url;
}
export function cleanQualityLinks(links: Record<string, any> | null | undefined) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(links || {})) {
    const url = validVideoUrl(String(v));
    if (url) out[String(k).slice(0, 40)] = url;
  }
  return out;
}
/** D1 rows are limited to 2 MB; episodes live inside the title's row, so refuse growth past ~1.8 MB with a clear message. */
export function assertRowSize(doc: Doc) {
  if (JSON.stringify(doc).length > 1_800_000)
    throw bad("This title has too much episode data for one record (limit ~1.8 MB). Remove some episodes, subtitles or links.");
}
export function cleanSubtitles(tracks: any[] | null | undefined) {
  const out: any[] = [];
  for (const t of tracks || []) {
    const url = validVideoUrl(t?.url || "");
    if (!url) continue;
    out.push({ label: String(t.label || t.lang || "Subtitles").slice(0, 40), lang: String(t.lang || "en").slice(0, 10), url });
  }
  return out.slice(0, 12);
}
export const slugify = (t: string) =>
  String(t || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ").replace(/['\u2019]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const exactRegex = (s: string) => ({ $regex: `^${escapeRe(s)}$`, $options: "i" });

export const visibleQuery = () => ({ $or: [{ published: { $ne: false } }, { scheduled_at: { $lte: now() } }] });
export const withVisibility = (query: Record<string, any>, includeHidden = false) =>
  includeHidden ? query : Object.keys(query).length ? { $and: [query, visibleQuery()] } : visibleQuery();
export const isReleased = (d: Doc) =>
  d.published !== false || (d.scheduled_at != null && d.scheduled_at <= now());

export function parseScheduleTime(value: string | null | undefined): string | null {
  value = (value || "").trim();
  if (!value) return null;
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  const t = new Date(hasZone ? value : value + "Z");
  if (isNaN(t.getTime())) throw bad("Invalid release time (use ISO format)");
  return t.toISOString();
}
export function applyScheduleFields(fields: Doc) {
  if (!("scheduled_at" in fields)) return;
  const when = parseScheduleTime(fields.scheduled_at);
  fields.scheduled_at = when;
  fields.published = !(when && when > now());
}

export async function logMod(db: DB, admin: Doc, action: string, target = "", detail = "") {
  await db.mod_log.insert({ admin_id: admin._id, admin_email: admin.email, action, target, detail: detail.slice(0, 300), created_at: now() });
}
export async function notifyUserIds(db: DB, ids: string[], kind: string, title: string, body = "",
  content_type = "", content_id = "", season: number | null = null, episode: number | null = null) {
  await db.notifications.insertMany(ids.map((user_id) => ({
    user_id, type: kind, title, body, content_type, content_id, season, episode, read: false, created_at: now(),
  })));
}
export async function notifyNewEpisodes(db: DB, type: string, id: string, title: string, season: number, episode: number, count = 1) {
  try {
    const ids = await db.watchlist.distinct("user_id", { content_type: type, content_id: id });
    if (!ids.length) return;
    const users = await db.users.find({ _id: { $in: ids }, banned: { $ne: true }, "prefs.notify_episodes": { $ne: false } });
    const body = count === 1 ? (Number(season) === 0 ? `Special ${episode} is now available.` : episode >= 1000 ? `Season ${season} ${episode >= 2000 ? "Special" : "OVA"} ${episode % 1000} is now available.` : `Season ${season}, Episode ${episode} is now available.`) : `${count} new episodes were added.`;
    await notifyUserIds(db, users.map((u) => u._id), "episode", `New episode: ${title}`, body, type, id, season, episode);
  } catch (e) { console.log("notifyNewEpisodes failed", e); }
}
export function muteRemaining(u: Doc): string | null {
  return u.muted_until && u.muted_until > now() ? u.muted_until : null;
}
export function fmtUtc(iso: string) {
  const d = new Date(iso);
  const mon = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  return `${String(d.getUTCDate()).padStart(2, "0")} ${mon} ${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
export function pageParams(c: AppCtx, defLimit = 20, maxLimit = 50) {
  const page = Math.max(parseInt(c.req.query("page") || "1") || 1, 1);
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || String(defLimit)) || defLimit, 1), maxLimit);
  return { page, limit };
}
// Season 0 = Specials / OVA: always listed after the normal seasons.
export function seasonOf(e: any): number {
  if (e == null || e.season == null || e.season === "") return 1;
  const n = Math.trunc(Number(e.season));
  return Number.isFinite(n) ? n : 1;
}
export function epKey(e: any): number[] {
  const s = seasonOf(e);
  return [s === 0 ? 1e6 : s, Number(e.episode ?? 0)];
}
export function cmpTuple(a: any[], b: any[]) {
  for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; }
  return 0;
}
export function getContentColl(c: AppCtx, type: string) {
  const coll = c.get("db").content(type);
  if (!coll) throw bad("Invalid content type.");
  return coll;
}

// Content model (ContentBase)
export const contentRules = (movie: boolean): Rules => ({
  title: R.str({ min: 1, max: 180 }),
  description: R.str({ max: 5000, def: "" }),
  genres: R.strList(),
  year: R.int({ def: null }),
  rating: R.str({ def: "" }),
  poster: R.str({ def: "" }),
  banner: R.str({ def: "" }),
  status: R.str({ def: "Ongoing" }),
  poster_tag: R.str({ def: "AUTO" }),
  duration: R.str({ def: "", max: 40 }),
  dubbed_on: R.strList(),
  air_weekday: R.int({ min: 0, max: 6, def: null }),
  air_time: R.str({ def: "", pattern: /^(\d{2}:\d{2})?$/ }),
  scheduled_at: R.optStr(40),
  season: R.str({ max: 10, def: "" }),
  studio: R.str({ max: 80, def: "" }),
  hero: R.bool(false),
  hero_order: R.int({ min: 0, max: 999, def: 0 }),
  top_airing: R.bool(false),
  top_rank: R.int({ min: 0, max: 999, def: 0 }),
  ...(movie ? { quality_links: R.obj() } : {}),
});
