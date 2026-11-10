import { Hono } from "hono";
import { DB } from "./db";
import { Env, HttpError, hashPassword, now } from "./lib";
import { auth } from "./routes/auth";
import { content, purgeExpiredTrash } from "./routes/content";
import { social } from "./routes/social";

const app = new Hono<{ Bindings: Env; Variables: { db: DB } }>();

// Create the first admin from ADMIN_EMAIL / ADMIN_PASSWORD (once per Worker instance).
let seeded = false;
async function seedAdmin(env: Env, db: DB) {
  if (seeded) return;
  seeded = true;
  const email = (env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!email || !env.ADMIN_PASSWORD) return;
  const existing = await db.users.findOne({ email });
  if (existing) {
    // Imported admin (old MongoDB hash): set the password from ADMIN_PASSWORD so you can log in.
    if (!String(existing.password_hash || "").startsWith("pbkdf2$")) {
      await db.users.updateOne({ _id: existing._id }, { $set: { password_hash: await hashPassword(env.ADMIN_PASSWORD), role: "admin" } });
      console.log(`Reset imported admin password: ${email}`);
    }
    return;
  }
  try {
    await db.users.insert({ email, password_hash: await hashPassword(env.ADMIN_PASSWORD), role: "admin", created_at: now() });
    console.log(`Created initial admin account: ${email}`);
  } catch (e) { console.log("Admin seed skipped", e); }
}

app.use("*", async (c, next) => {
  if ((c.env.ENVIRONMENT || "").toLowerCase() === "production" && (!c.env.SECRET_KEY || c.env.SECRET_KEY.length < 32))
    return c.json({ detail: "Server is missing a SECRET_KEY of at least 32 characters." }, 500);
  const db = new DB(c.env.DB);
  c.set("db", db);
  await seedAdmin(c.env, db);
  await next();
});

app.onError((err, c) => {
  if (err instanceof HttpError) {
    // Match FastAPI's shape for validation errors so the frontend shows the message.
    return c.json(err.status === 422 ? { detail: [{ msg: err.detail }] } : { detail: err.detail }, err.status as any);
  }
  console.log("Unhandled error:", err);
  return c.json({ detail: "Internal server error. Please try again." }, 500);
});

app.get("/health", (c) => c.json({ ok: true }));
app.route("/", auth);
app.route("/", content);
app.route("/", social);

export default {
  fetch: app.fetch,
  // Daily cron: delete notifications older than 90 days (replaces Mongo's TTL index).
  async scheduled(_e: ScheduledController, env: Env, ctx: ExecutionContext) {
    const db = new DB(env.DB);
    ctx.waitUntil(db.notifications.purgeOlderThan("created_at", 90));
    ctx.waitUntil(purgeExpiredTrash(db));
  },
};
