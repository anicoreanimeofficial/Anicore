import { Hono } from "hono";
import { DB, Doc } from "../db";
import {
  AppCtx, Env, HttpError, R, bad, currentUser, fmtUtc, getContentColl, json, loadTitles, logMod, muteRemaining, notifyUserIds, now,
  objectId, pageParams, parse, requireAdmin, requireUser, escapeRe,
} from "../lib";

export const social = new Hono<{ Bindings: Env; Variables: { db: DB } }>();

// ---------- watchlist ----------
social.post("/api/watchlist/:type/:id", async (c) => {
  const user = await requireUser(c);
  const type = c.req.param("type"), id = c.req.param("id");
  getContentColl(c, type); objectId(id);
  const q = { user_id: user._id, content_type: type, content_id: id };
  const wl = c.get("db").watchlist;
  if (await wl.findOne(q)) { await wl.deleteOne(q); return c.json({ saved: false }); }
  await wl.insert({ ...q, created_at: now() });
  return c.json({ saved: true });
});

social.get("/api/watchlist", async (c) => {
  const user = await requireUser(c);
  const db = c.get("db");
  const rows = await db.watchlist.find({ user_id: user._id }, { sort: [["created_at", -1]] });
  const titles = await loadTitles(db, rows);
  const out: any[] = [];
  for (const row of rows) {
    const doc = titles.get(`${row.content_type}:${row.content_id}`);
    if (!doc) continue;
    out.push({ content_type: row.content_type, content_id: row.content_id, title: doc.title || "", poster: doc.poster || "", avg_rating: doc.avg_rating || 0, created_at: row.created_at });
  }
  return c.json(out);
});

// ---------- comments ----------
social.post("/api/comments", async (c) => {
  const user = await requireUser(c);
  const d = parse(await json(c), { content_type: R.str(), content_id: R.str(), text: R.str({ min: 1, max: 1000 }) });
  const until = muteRemaining(user);
  if (until) throw new HttpError(403, `You are muted until ${fmtUtc(until)} UTC and can't post right now.`);
  getContentColl(c, d.content_type); objectId(d.content_id);
  await c.get("db").comments.insert({
    content_type: d.content_type, content_id: d.content_id, user_id: user._id,
    username: String(user.email).split("@")[0], text: d.text, created_at: now(),
  });
  return c.json({ message: "Comment posted" });
});

social.get("/api/comments/:type/:id", async (c) => {
  getContentColl(c, c.req.param("type"));
  const rows = await c.get("db").comments.find({ content_type: c.req.param("type"), content_id: c.req.param("id") }, { sort: [["created_at", -1]], limit: 100 });
  return c.json(rows.map((r) => ({ _id: r._id, username: r.username || "user", text: r.text || "", created_at: r.created_at })));
});

social.post("/api/comments/:id/report", async (c) => {
  const user = await requireUser(c);
  const d = parse(await json(c), { reason: R.str({ max: 300, def: "" }) });
  const id = objectId(c.req.param("id"));
  const comments = c.get("db").comments;
  const comment = await comments.findOne({ _id: id });
  if (!comment) throw new HttpError(404, "Comment not found");
  if (comment.user_id === user._id) throw bad("You can't report your own comment.");
  if ((comment.reports || []).some((r: Doc) => r.user_id === user._id)) throw new HttpError(409, "You already reported this comment.");
  await comments.updateOne({ _id: id }, { $push: { reports: { user_id: user._id, reason: d.reason.trim(), at: now() } }, $inc: { report_count: 1 } });
  return c.json({ message: "Thanks, a moderator will take a look." });
});

// ---------- watch progress (resume position inside the player) ----------
social.post("/api/progress", async (c) => {
  const user = await requireUser(c);
  const d = parse(await json(c), {
    content_type: R.str(), content_id: R.str(), season: R.int({ def: 1 }), episode: R.int({ def: 1 }),
    progress_percent: R.num({ min: 0, max: 100, def: 0 }),
  });
  getContentColl(c, d.content_type); objectId(d.content_id);
  await c.get("db").progress.updateOne(
    { user_id: user._id, content_type: d.content_type, content_id: d.content_id },
    { $set: { season: d.season, episode: d.episode, progress_percent: d.progress_percent, updated_at: now() } }, { upsert: true });
  return c.json({ message: "Progress saved" });
});

// ---------- ratings ----------
social.post("/api/ratings", async (c) => {
  const user = await requireUser(c);
  const d = parse(await json(c), { content_type: R.str(), content_id: R.str(), rating: R.num({ min: 1, max: 10 }), review: R.str({ max: 2000, def: "" }) });
  const coll = getContentColl(c, d.content_type);
  const id = objectId(d.content_id);
  const db = c.get("db");
  await db.ratings.updateOne(
    { user_id: user._id, content_type: d.content_type, content_id: d.content_id },
    { $set: { rating: d.rating, review: d.review.trim(), username: String(user.email).split("@")[0], updated_at: now() }, $setOnInsert: { created_at: now() } },
    { upsert: true });
  const all = await db.ratings.find({ content_type: d.content_type, content_id: d.content_id });
  const count = all.length;
  const avg = count ? Math.round((all.reduce((s, r) => s + Number(r.rating), 0) / count) * 10) / 10 : 0;
  await coll.updateOne({ _id: id }, { $set: { avg_rating: avg, rating_count: count } });
  return c.json({ message: "Rating saved", avg_rating: avg, rating_count: count });
});

social.get("/api/ratings/:type/:id", async (c) => {
  getContentColl(c, c.req.param("type"));
  const { page, limit } = pageParams(c, 20);
  const f = { content_type: c.req.param("type"), content_id: c.req.param("id") };
  const db = c.get("db");
  const total = await db.ratings.count(f);
  const rows = await db.ratings.find(f, { sort: [["updated_at", -1]], skip: (page - 1) * limit, limit });
  return c.json({
    items: rows.map((r) => ({ username: r.username || "user", rating: r.rating, review: r.review || "", created_at: r.created_at, updated_at: r.updated_at })),
    total,
  });
});

// ---------- requests ----------
social.post("/api/requests", async (c) => {
  const user = await requireUser(c);
  const d = parse(await json(c), { title: R.str({ min: 1, max: 180 }), language: R.str({ max: 60, def: "Hindi Dub" }), notes: R.str({ max: 500, def: "" }) });
  await c.get("db").requests.insert({ user_id: user._id, email: user.email, ...d, status: "Pending", created_at: now() });
  return c.json({ message: "Request submitted" });
});

social.get("/api/admin/requests", async (c) => {
  await requireAdmin(c);
  return c.json(await c.get("db").requests.find({}, { sort: [["created_at", -1]], limit: 200 }));
});

social.patch("/api/admin/requests/:id", async (c) => {
  const admin = await requireAdmin(c);
  const d = parse(await json(c), { status: R.oneOf(["Pending", "Approved", "Rejected", "Completed"] as const) });
  const db = c.get("db");
  const row = await db.requests.findOneAndUpdate({ _id: objectId(c.req.param("id")) }, { $set: { status: d.status } });
  if (!row) throw new HttpError(404, "Request not found");
  if (row.status !== d.status && row.user_id)
    await notifyUserIds(db, [row.user_id], "request", `Your request was ${d.status.toLowerCase()}`, `"${row.title || ""}" is now marked ${d.status}.`);
  await logMod(db, admin, "request_status", row.title || "", d.status);
  return c.json({ message: "Request updated" });
});

// ---------- notifications ----------
social.get("/api/notifications", async (c) => {
  const user = await requireUser(c);
  const db = c.get("db");
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "30") || 30, 1), 100);
  const rows = await db.notifications.find({ user_id: user._id }, { sort: [["created_at", -1]], limit });
  return c.json({
    items: rows.map(({ user_id, ...rest }) => rest),
    unread: await db.notifications.count({ user_id: user._id, read: false }),
  });
});

social.get("/api/notifications/unread-count", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ unread: 0 });
  return c.json({ unread: await c.get("db").notifications.count({ user_id: user._id, read: false }) });
});

social.post("/api/notifications/read", async (c) => {
  const user = await requireUser(c);
  let body: any = null;
  try { body = await c.req.json(); } catch { /* empty body = mark all */ }
  const q: Record<string, any> = { user_id: user._id, read: false };
  if (body && Array.isArray(body.ids) && body.ids.length) q._id = { $in: body.ids.slice(0, 200).map(objectId) };
  const db = c.get("db");
  await db.notifications.updateMany(q, { $set: { read: true } });
  return c.json({ unread: await db.notifications.count({ user_id: user._id, read: false }) });
});

social.delete("/api/notifications/:id", async (c) => {
  const user = await requireUser(c);
  await c.get("db").notifications.deleteOne({ _id: objectId(c.req.param("id")), user_id: user._id });
  return c.json({ message: "Deleted" });
});

social.delete("/api/notifications", async (c) => {
  const user = await requireUser(c);
  await c.get("db").notifications.deleteMany({ user_id: user._id });
  return c.json({ message: "Cleared" });
});

// ---------- moderation & admin tools ----------
social.get("/api/admin/reports", async (c) => {
  await requireAdmin(c);
  const db = c.get("db");
  const rows = await db.comments.find({ report_count: { $gt: 0 } }, { sort: [["report_count", -1]], limit: 100 });
  const out: any[] = [];
  for (const cm of rows) {
    const coll = db.content(cm.content_type || "");
    const doc = coll && (await coll.findOne({ _id: cm.content_id || "" }));
    out.push({
      _id: cm._id, username: cm.username || "user", author_id: String(cm.user_id || ""), text: cm.text || "",
      content_title: doc?.title || "", report_count: cm.report_count || 0,
      reasons: (cm.reports || []).map((r: Doc) => r.reason).filter(Boolean).slice(0, 5), created_at: cm.created_at,
    });
  }
  return c.json(out);
});

social.post("/api/admin/comments/:id/moderate", async (c) => {
  const admin = await requireAdmin(c);
  const d = parse(await json(c), { action: R.oneOf(["delete", "dismiss"] as const) });
  const db = c.get("db");
  const id = objectId(c.req.param("id"));
  const cm = await db.comments.findOne({ _id: id });
  if (!cm) throw new HttpError(404, "Comment not found");
  if (d.action === "delete") {
    await db.comments.deleteOne({ _id: id });
    if (cm.user_id) await notifyUserIds(db, [cm.user_id], "moderation", "A comment of yours was removed", "It was reported and removed by a moderator for breaking the community rules.");
    await logMod(db, admin, "comment_deleted", cm.username || "", (cm.text || "").slice(0, 120));
    return c.json({ message: "Comment deleted" });
  }
  await db.comments.updateOne({ _id: id }, { $set: { reports: [], report_count: 0 } });
  await logMod(db, admin, "report_dismissed", cm.username || "", (cm.text || "").slice(0, 120));
  return c.json({ message: "Reports dismissed" });
});

social.delete("/api/admin/comments/:id", async (c) => {
  const admin = await requireAdmin(c);
  const db = c.get("db");
  const cm = await db.comments.findOneAndDelete({ _id: objectId(c.req.param("id")) });
  if (!cm) throw new HttpError(404, "Comment not found");
  await logMod(db, admin, "comment_deleted", cm.username || "", (cm.text || "").slice(0, 120));
  return c.json({ message: "Comment deleted" });
});

const userRow = (u: Doc) => ({
  _id: u._id, email: u.email || "", display_name: u.display_name || "", role: u.role || "user", banned: !!u.banned,
  ban_reason: u.ban_reason || "", muted_until: muteRemaining(u), created_at: u.created_at,
});

social.get("/api/admin/users", async (c) => {
  await requireAdmin(c);
  const { page, limit } = pageParams(c, 20);
  const q = (c.req.query("q") || "").trim();
  const filter = c.req.query("filter") || "";
  const query: Record<string, any> = {};
  if (q) query.$or = [{ email: { $regex: escapeRe(q), $options: "i" } }, { display_name: { $regex: escapeRe(q), $options: "i" } }];
  if (filter === "banned") query.banned = true;
  else if (filter === "muted") query.muted_until = { $gt: now() };
  const db = c.get("db");
  const total = await db.users.count(query);
  const rows = await db.users.find(query, { sort: [["created_at", -1]], skip: (page - 1) * limit, limit });
  return c.json({ items: rows.map(userRow), total });
});

async function moderationTarget(c: AppCtx, admin: Doc) {
  const target = await c.get("db").users.findOne({ _id: objectId(c.req.param("id")) });
  if (!target) throw new HttpError(404, "User not found");
  if (target._id === admin._id) throw bad("You can't do that to your own account.");
  if (target.role === "admin") throw bad("Admin accounts can't be banned or muted.");
  return target;
}

social.put("/api/admin/users/:id/ban", async (c) => {
  const admin = await requireAdmin(c);
  const d = parse(await json(c), { banned: R.bool(), reason: R.str({ max: 300, def: "" }) });
  const target = await moderationTarget(c, admin);
  const db = c.get("db");
  if (d.banned) await db.users.updateOne({ _id: target._id }, { $set: { banned: true, ban_reason: d.reason.trim() } });
  else await db.users.updateOne({ _id: target._id }, { $unset: { banned: "", ban_reason: "" } });
  await logMod(db, admin, d.banned ? "ban" : "unban", target.email, d.reason);
  return c.json({ message: `${target.email} ${d.banned ? "banned" : "unbanned"}` });
});

social.put("/api/admin/users/:id/mute", async (c) => {
  const admin = await requireAdmin(c);
  const d = parse(await json(c), { hours: R.int({ min: 0, max: 24 * 365 }), reason: R.str({ max: 300, def: "" }) });
  const target = await moderationTarget(c, admin);
  const db = c.get("db");
  if (d.hours) {
    const until = new Date(Date.now() + d.hours * 3600000).toISOString();
    await db.users.updateOne({ _id: target._id }, { $set: { muted_until: until } });
    await notifyUserIds(db, [target._id], "moderation", "You have been muted",
      `You can't post comments until ${fmtUtc(until)} UTC.` + (d.reason.trim() ? ` Reason: ${d.reason.trim()}` : ""));
    await logMod(db, admin, "mute", target.email, `${d.hours}h. ${d.reason}`);
    return c.json({ message: `${target.email} muted for ${d.hours}h` });
  }
  await db.users.updateOne({ _id: target._id }, { $unset: { muted_until: "" } });
  await logMod(db, admin, "unmute", target.email);
  return c.json({ message: `${target.email} unmuted` });
});

social.get("/api/admin/mod-log", async (c) => {
  await requireAdmin(c);
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "50") || 50, 1), 200);
  const rows = await c.get("db").mod_log.find({}, { sort: [["created_at", -1]], limit });
  return c.json(rows.map((r) => ({ admin: r.admin_email || "", action: r.action || "", target: r.target || "", detail: r.detail || "", created_at: r.created_at })));
});

social.post("/api/admin/announce", async (c) => {
  const admin = await requireAdmin(c);
  const d = parse(await json(c), { title: R.str({ min: 1, max: 120 }), body: R.str({ max: 500, def: "" }) });
  const db = c.get("db");
  const ids = (await db.users.find({ banned: { $ne: true } })).map((u) => u._id);
  await notifyUserIds(db, ids, "announcement", d.title.trim(), d.body.trim());
  await logMod(db, admin, "announcement", `${ids.length} users`, d.title.trim());
  return c.json({ message: `Announcement sent to ${ids.length} users` });
});
