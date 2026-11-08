import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { DB } from "../db";
import {
  AppCtx, COOKIE_NAME, Env, HttpError, R, bad, cookieOptions, currentUser, hashPassword, hmacSha256, json,
  now, parse, requireAdmin, requireUser, signToken, toHex, verifyPassword,
} from "../lib";

export const auth = new Hono<{ Bindings: Env; Variables: { db: DB } }>();

const credRules = (min: number) => ({ email: R.email(), password: R.str({ min, max: 128 }) });

async function startSession(c: AppCtx, user: { _id: string; email: string; role?: string }) {
  const token = await signToken(c.env, user._id, user.email, user.role || "user");
  setCookie(c, COOKIE_NAME, token, cookieOptions(c.env));
}

auth.post("/api/auth/register", async (c) => {
  const d = parse(await json(c), credRules(6));
  const email = d.email.toLowerCase().trim();
  const db = c.get("db");
  if (await db.users.findOne({ email })) throw new HttpError(409, "Email already registered");
  const user = await db.users.insert({ email, password_hash: await hashPassword(d.password), role: "user", created_at: now() });
  await startSession(c, user as any);
  return c.json({ message: "Registered successfully" });
});

auth.post("/api/auth/login", async (c) => {
  const d = parse(await json(c), credRules(1));
  const email = d.email.toLowerCase().trim();
  const user = await c.get("db").users.findOne({ email });
  if (!user || !(await verifyPassword(d.password, user.password_hash || "")))
    throw new HttpError(401, "Invalid email or password");
  if (user.banned) {
    const reason = user.ban_reason || "";
    throw new HttpError(403, "This account has been suspended." + (reason ? ` Reason: ${reason}` : ""));
  }
  await startSession(c, user as any);
  return c.json({ message: "Logged in successfully", role: user.role || "user" });
});

auth.get("/api/auth/me", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ authenticated: false });
  return c.json({
    authenticated: true,
    email: user.email,
    role: user.role || "user",
    display_name: user.display_name || "",
    telegram_id: String(user.telegram_id || ""),
    telegram_username: user.telegram_username || "",
    prefs: { ...(user.prefs || {}) },
  });
});

auth.post("/api/auth/logout", (c) => {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
  return c.json({ message: "Logged out" });
});

// ---------- Telegram Mini App login ----------
auth.get("/api/telegram/config", (c) => c.json({ enabled: !!(c.env.TELEGRAM_BOT_TOKEN || "").trim() }));

async function verifyTelegram(env: Env, initData: string) {
  const token = (env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) throw new HttpError(503, "Telegram login is not configured");
  const params = new URLSearchParams(initData);
  const received = params.get("hash");
  if (!received) throw new HttpError(401, "Invalid Telegram data");
  params.delete("hash");
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = await hmacSha256("WebAppData", token);
  const calc = toHex(await hmacSha256(secret, check));
  if (calc !== received) throw new HttpError(401, "Telegram data check failed");
  const authDate = Number(params.get("auth_date") || 0);
  if (authDate && Date.now() / 1000 - authDate > 86400) throw new HttpError(401, "Telegram data expired — reopen the app");
  const raw = params.get("user");
  if (!raw) throw new HttpError(401, "No Telegram user");
  try { return JSON.parse(raw); } catch { throw new HttpError(401, "Bad Telegram user payload"); }
}

auth.post("/api/auth/telegram", async (c) => {
  const d = parse(await json(c), { initData: R.str({ min: 10, max: 4096 }) });
  const tg = await verifyTelegram(c.env, d.initData);
  const tgId = String(tg.id || "");
  if (!tgId) throw new HttpError(401, "Missing Telegram id");
  const username = String(tg.username || "").trim();
  const first = String(tg.first_name || "").trim();
  const last = String(tg.last_name || "").trim();
  const photo = String(tg.photo_url || "").trim();
  let display = (username ? `@${username}` : "") || (first + (last ? " " + last : "")).trim() || `User ${tgId}`;
  if (display.startsWith("@@")) display = display.slice(1);
  const email = `tg_${tgId}@telegram.local`;
  const db = c.get("db");

  let user = await db.users.findOne({ $or: [{ telegram_id: tgId }, { email }] });
  if (!user) {
    user = await db.users.insert({
      email, password_hash: await hashPassword(`tg:${tgId}:${crypto.randomUUID()}`), role: "user",
      telegram_id: tgId, telegram_username: username, display_name: display,
      prefs: photo.startsWith("https://") ? { avatar: photo } : {}, created_at: now(),
    });
  } else {
    const updates: Record<string, any> = { telegram_id: tgId, telegram_username: username, display_name: display };
    if (photo.startsWith("https://")) updates["prefs.avatar"] = photo;
    await db.users.updateOne({ _id: user._id }, { $set: updates });
    user = (await db.users.findOne({ _id: user._id }))!;
  }
  if (user.banned) throw new HttpError(403, "This account has been suspended.");
  await startSession(c, user as any);
  return c.json({
    message: "Logged in with Telegram", role: user.role || "user", email: user.email,
    display_name: user.display_name || display, telegram_id: tgId, telegram_username: username,
    avatar: user.prefs?.avatar || photo || "",
  });
});

// ---------- profile, prefs, background, avatar ----------
const BG_URL_RE = /^https:\/\/[^\s"'()<>\\]+$/;
const IMG_DATA_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
const MAX_BG = 1_200_000, MAX_AVATAR = 400_000;

function decodeDataUrl(raw: string) {
  const m = IMG_DATA_RE.exec(raw);
  if (!m) throw bad("Upload a JPG, PNG or WebP image.");
  try {
    const bin = atob(m[2]);
    return { type: m[1], bytes: Uint8Array.from(bin, (ch) => ch.charCodeAt(0)) };
  } catch { throw bad("That image could not be read."); }
}

function imageRoutes(kind: "background" | "avatar", prefKey: string, max: number, okMsg: string, clearMsg: string, respKey: string) {
  const r2key = (id: string) => `user-${kind}/${id}`;

  auth.put(`/api/users/me/${kind}`, async (c) => {
    const user = await requireUser(c);
    const d = parse(await json(c), { url: R.str({ max: 2000, def: "" }), data: R.str({ max, def: "" }) });
    const url = d.url.trim(), raw = d.data.trim();
    if (!!url === !!raw) throw bad("Send either an image URL or an uploaded image.");
    const updates: Record<string, any> = {};
    if (url) {
      if (!BG_URL_RE.test(url)) throw bad("Image URL must start with https:// and contain no spaces or quotes.");
      updates[`prefs.${prefKey}`] = url;
      await c.env.UPLOADS.delete(r2key(user._id));
    } else {
      const img = decodeDataUrl(raw);
      await c.env.UPLOADS.put(r2key(user._id), img.bytes, { httpMetadata: { contentType: img.type } });
      updates[`prefs.${prefKey}`] = `/api/users/me/${kind}?v=${Math.floor(Date.now() / 1000)}`;
    }
    const db = c.get("db");
    await db.users.updateOne({ _id: user._id }, { $set: updates });
    const fresh = (await db.users.findOne({ _id: user._id })) || {};
    return c.json({ message: okMsg, [respKey]: fresh.prefs?.[prefKey] || "" });
  });

  auth.get(`/api/users/me/${kind}`, async (c) => {
    const user = await requireUser(c);
    const obj = await c.env.UPLOADS.get(r2key(user._id));
    if (!obj) throw new HttpError(404, `No uploaded ${kind}`);
    return new Response(obj.body, { headers: {
      "Content-Type": obj.httpMetadata?.contentType || "image/jpeg",
      "Cache-Control": "private, max-age=31536000, immutable",
    } });
  });

  auth.delete(`/api/users/me/${kind}`, async (c) => {
    const user = await requireUser(c);
    await c.get("db").users.updateOne({ _id: user._id }, { $unset: { [`prefs.${prefKey}`]: "" } });
    await c.env.UPLOADS.delete(r2key(user._id));
    return c.json({ message: clearMsg });
  });
}
imageRoutes("background", "bg_image", MAX_BG, "Background saved", "Background reset", "bg_image");
imageRoutes("avatar", "avatar", MAX_AVATAR, "Profile picture saved", "Profile picture removed", "avatar");

auth.put("/api/users/me/profile", async (c) => {
  const user = await requireUser(c);
  const d = parse(await json(c), { display_name: R.str({ max: 30, def: "" }) });
  const name = d.display_name.replace(/\s+/g, " ").trim();
  const db = c.get("db");
  if (name) await db.users.updateOne({ _id: user._id }, { $set: { display_name: name } });
  else await db.users.updateOne({ _id: user._id }, { $unset: { display_name: "" } });
  return c.json({ message: "Profile saved", display_name: name });
});

auth.put("/api/users/me/prefs", async (c) => {
  const user = await requireUser(c);
  const b = await json(c);
  const updates: Record<string, any> = {};
  if (["en", "hi"].includes(b.language)) updates["prefs.language"] = b.language;
  if (["pink", "purple", "blue", "green", "orange"].includes(b.accent)) updates["prefs.accent"] = b.accent;
  if (["dark", "light"].includes(b.theme)) updates["prefs.theme"] = b.theme;
  if (b.notify_episodes !== undefined && b.notify_episodes !== null) updates["prefs.notify_episodes"] = !!b.notify_episodes;
  if (b.autoplay_next !== undefined && b.autoplay_next !== null) updates["prefs.autoplay_next"] = !!b.autoplay_next;
  const db = c.get("db");
  if (Object.keys(updates).length) await db.users.updateOne({ _id: user._id }, { $set: updates });
  const fresh = await db.users.findOne({ _id: user._id });
  return c.json({ message: "Preferences saved", prefs: fresh?.prefs || {} });
});

auth.get("/api/users/me/activity", async (c) => {
  const user = await requireUser(c);
  const db = c.get("db");
  const [ratings, progress, requests, wl] = await Promise.all([
    db.ratings.find({ user_id: user._id }, { sort: [["updated_at", -1]], limit: 20 }),
    db.progress.find({ user_id: user._id }, { sort: [["updated_at", -1]], limit: 20 }),
    db.requests.find({ user_id: user._id }, { sort: [["created_at", -1]], limit: 10 }),
    db.watchlist.count({ user_id: user._id }),
  ]);
  return c.json({
    email: user.email, role: user.role || "user", created_at: user.created_at, prefs: user.prefs || {},
    watchlist_count: wl, ratings, progress, requests,
  });
});

// ---------- uploader role management (admin only) ----------
auth.post("/api/admin/uploaders", async (c) => {
  await requireAdmin(c);
  const d = parse(await json(c), credRules(6));
  const email = d.email.toLowerCase().trim();
  const db = c.get("db");
  if (await db.users.findOne({ email }))
    throw new HttpError(409, 'That email already has an account. Use "Give access to existing user" instead.');
  await db.users.insert({ email, password_hash: await hashPassword(d.password), role: "uploader", created_at: now() });
  return c.json({ message: `Uploader account created for ${email}`, email, role: "uploader" });
});

auth.get("/api/admin/uploaders", async (c) => {
  await requireAdmin(c);
  const rows = await c.get("db").users.find({ role: "uploader" }, { sort: [["email", 1]], limit: 200 });
  return c.json(rows.map((r) => ({ email: r.email, display_name: r.display_name || "" })));
});

auth.put("/api/admin/users/role", async (c) => {
  await requireAdmin(c);
  const d = parse(await json(c), { email: R.str({ max: 254 }), role: R.oneOf(["uploader", "user"] as const) });
  const email = d.email.trim().toLowerCase();
  const db = c.get("db");
  const target = await db.users.findOne({ email });
  if (!target) throw new HttpError(404, "No account with that email. They need to sign up first.");
  if (target.role === "admin") throw bad("That account is an admin already.");
  await db.users.updateOne({ _id: target._id }, { $set: { role: d.role } });
  const verb = d.role === "uploader" ? "can now upload" : "is a regular user again";
  return c.json({ message: `${email} ${verb}`, email, role: d.role });
});
