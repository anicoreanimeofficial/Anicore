// Tiny MongoDB-style layer on top of Cloudflare D1 (one JSON "docs" table).
// Supports exactly the operators the Anicore API uses.

export type Doc = Record<string, any>;
export type Filter = Record<string, any>;
export type Sort = [string, 1 | -1][];

const SQL_FIELDS = new Set(["user_id", "content_id", "email", "telegram_id"]);

export function newId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{24}$/.test(v);
export const nowIso = () => new Date().toISOString();

function getPath(doc: Doc, path: string): any {
  let cur: any = doc;
  for (const p of path.split(".")) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}
function setPath(doc: Doc, path: string, value: any) {
  const parts = path.split(".");
  let cur = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== "object" || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}
function unsetPath(doc: Doc, path: string) {
  const parts = path.split(".");
  let cur: any = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur?.[parts[i]];
    if (cur == null) return;
  }
  delete cur[parts[parts.length - 1]];
}

function eq(a: any, b: any): boolean {
  if (Array.isArray(a)) return a.some((x) => eq(x, b)) || JSON.stringify(a) === JSON.stringify(b);
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  return a === b;
}
function cmpVal(a: any, b: any): number {
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return a < b ? -1 : 1;
}

function matchField(value: any, cond: any): boolean {
  const isOps = cond && typeof cond === "object" && !Array.isArray(cond) &&
    Object.keys(cond).some((k) => k.startsWith("$"));
  if (!isOps) return eq(value, cond);
  const vals: any[] = Array.isArray(value) ? value : [value];
  for (const [op, arg] of Object.entries(cond)) {
    if (op === "$options") continue;
    switch (op) {
      case "$eq": if (!eq(value, arg)) return false; break;
      case "$ne": if (eq(value, arg)) return false; break;
      case "$in": if (!(arg as any[]).some((a) => eq(value, a))) return false; break;
      case "$nin": if ((arg as any[]).some((a) => eq(value, a))) return false; break;
      case "$gt": if (!vals.some((v) => v != null && v > (arg as any))) return false; break;
      case "$gte": if (!vals.some((v) => v != null && v >= (arg as any))) return false; break;
      case "$lt": if (!vals.some((v) => v != null && v < (arg as any))) return false; break;
      case "$lte": if (!vals.some((v) => v != null && v <= (arg as any))) return false; break;
      case "$exists": if ((value !== undefined) !== !!arg) return false; break;
      case "$regex": {
        const re = new RegExp(String(arg), String(cond.$options || "").replace(/[^imsu]/g, ""));
        if (!vals.some((v) => typeof v === "string" && re.test(v))) return false;
        break;
      }
      default: throw new Error(`Unsupported operator ${op}`);
    }
  }
  return true;
}

export function matches(doc: Doc, filter: Filter): boolean {
  for (const [key, cond] of Object.entries(filter || {})) {
    if (key === "$or") { if (!(cond as Filter[]).some((f) => matches(doc, f))) return false; }
    else if (key === "$and") { if (!(cond as Filter[]).every((f) => matches(doc, f))) return false; }
    else if (!matchField(getPath(doc, key), cond)) return false;
  }
  return true;
}

function sqlPrefilter(filter: Filter): { where: string; args: any[] } {
  let where = "";
  const args: any[] = [];
  for (const [k, v] of Object.entries(filter || {})) {
    if (k === "_id" && typeof v === "string") { where += " AND id = ?"; args.push(v); }
    else if (SQL_FIELDS.has(k) && typeof v === "string") {
      where += ` AND json_extract(data, '$.${k}') = ?`; args.push(v);
    }
  }
  return { where, args };
}

function applyUpdate(doc: Doc, update: Doc) {
  for (const [op, spec] of Object.entries(update)) {
    for (const [path, val] of Object.entries(spec as Doc)) {
      if (op === "$set") setPath(doc, path, val);
      else if (op === "$setOnInsert") { /* handled by upsert */ }
      else if (op === "$unset") unsetPath(doc, path);
      else if (op === "$inc") setPath(doc, path, (Number(getPath(doc, path)) || 0) + (val as number));
      else if (op === "$push") {
        const arr = getPath(doc, path) ?? [];
        arr.push(val); setPath(doc, path, arr);
      } else if (op === "$pull") {
        const arr: any[] = getPath(doc, path) ?? [];
        setPath(doc, path, arr.filter((x) => !(typeof val === "object" && val !== null
          ? matches(x, val as Filter) : x === val)));
      } else throw new Error(`Unsupported update operator ${op}`);
    }
  }
}

export class Collection {
  constructor(private d1: D1Database, private name: string) {}

  private async load(filter: Filter): Promise<Doc[]> {
    const { where, args } = sqlPrefilter(filter);
    const rows = await this.d1
      .prepare(`SELECT id, data FROM docs WHERE coll = ?${where}`)
      .bind(this.name, ...args).all<{ id: string; data: string }>();
    const docs = rows.results.map((r) => ({ ...JSON.parse(r.data), _id: r.id }));
    return docs.filter((d) => matches(d, filter));
  }

  async find(filter: Filter = {}, o: { sort?: Sort; skip?: number; limit?: number } = {}): Promise<Doc[]> {
    let docs = await this.load(filter);
    if (o.sort?.length) {
      docs.sort((a, b) => {
        for (const [f, dir] of o.sort!) {
          const c = cmpVal(getPath(a, f), getPath(b, f));
          if (c) return c * dir;
        }
        return 0;
      });
    }
    if (o.skip) docs = docs.slice(o.skip);
    if (o.limit != null) docs = docs.slice(0, o.limit);
    return docs;
  }
  async findOne(filter: Filter = {}): Promise<Doc | null> {
    return (await this.find(filter, { limit: 1 }))[0] ?? null;
  }
  async count(filter: Filter = {}): Promise<number> {
    if (!Object.keys(filter).length) {
      const r = await this.d1.prepare("SELECT COUNT(*) c FROM docs WHERE coll = ?").bind(this.name).first<{ c: number }>();
      return r?.c ?? 0;
    }
    return (await this.load(filter)).length;
  }
  async distinct(field: string, filter: Filter = {}): Promise<any[]> {
    const set = new Set<any>();
    for (const d of await this.load(filter)) {
      const v = getPath(d, field);
      (Array.isArray(v) ? v : [v]).forEach((x) => x != null && set.add(x));
    }
    return [...set];
  }

  private insertStmt(doc: Doc) {
    const id = doc._id && isId(doc._id) ? doc._id : newId();
    const { _id, ...rest } = doc;
    doc._id = id;
    return this.d1.prepare("INSERT INTO docs (coll, id, data) VALUES (?, ?, ?)")
      .bind(this.name, id, JSON.stringify(rest));
  }
  async insert(doc: Doc): Promise<Doc> {
    await this.insertStmt(doc).run();
    return doc;
  }
  async insertMany(docs: Doc[]) {
    for (let i = 0; i < docs.length; i += 50) {
      await this.d1.batch(docs.slice(i, i + 50).map((d) => this.insertStmt(d)));
    }
  }

  private async save(doc: Doc) {
    const { _id, ...rest } = doc;
    await this.d1.prepare("UPDATE docs SET data = ? WHERE coll = ? AND id = ?")
      .bind(JSON.stringify(rest), this.name, _id).run();
  }
  async update(filter: Filter, update: Doc, o: { upsert?: boolean; many?: boolean } = {}): Promise<number> {
    const docs = o.many ? await this.load(filter) : [await this.findOne(filter)].filter(Boolean) as Doc[];
    if (!docs.length) {
      if (o.upsert) {
        const base: Doc = {};
        for (const [k, v] of Object.entries(filter)) if (!k.startsWith("$") && typeof v !== "object") base[k] = v;
        Object.assign(base, update.$setOnInsert ?? {});
        applyUpdate(base, update);
        await this.insert(base);
        return 1;
      }
      return 0;
    }
    for (const d of docs) { applyUpdate(d, update); await this.save(d); }
    return docs.length;
  }
  updateOne(f: Filter, u: Doc, o: { upsert?: boolean } = {}) { return this.update(f, u, o); }
  updateMany(f: Filter, u: Doc) { return this.update(f, u, { many: true }); }
  async replaceOne(filter: Filter, doc: Doc) {
    const cur = await this.findOne(filter);
    if (cur) await this.save({ ...doc, _id: cur._id });
  }
  async deleteMany(filter: Filter = {}): Promise<number> {
    const docs = await this.load(filter);
    for (let i = 0; i < docs.length; i += 50) {
      await this.d1.batch(docs.slice(i, i + 50).map((d) =>
        this.d1.prepare("DELETE FROM docs WHERE coll = ? AND id = ?").bind(this.name, d._id)));
    }
    return docs.length;
  }
  async deleteOne(filter: Filter): Promise<number> {
    const d = await this.findOne(filter);
    if (!d) return 0;
    await this.d1.prepare("DELETE FROM docs WHERE coll = ? AND id = ?").bind(this.name, d._id).run();
    return 1;
  }
  async findOneAndDelete(filter: Filter): Promise<Doc | null> {
    const d = await this.findOne(filter);
    if (d) await this.deleteOne({ _id: d._id });
    return d;
  }
  async findOneAndUpdate(filter: Filter, update: Doc): Promise<Doc | null> {
    const d = await this.findOne(filter);
    if (!d) return null;
    await this.update({ _id: d._id }, update);
    return d;
  }
  /** Delete documents older than `days` (replaces Mongo's TTL index). */
  async purgeOlderThan(field: string, days: number) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    await this.d1.prepare(`DELETE FROM docs WHERE coll = ? AND json_extract(data, '$.${field}') < ?`)
      .bind(this.name, cutoff).run();
  }
}

export class DB {
  constructor(public d1: D1Database) {}
  private cache: Record<string, Collection> = {};
  c(name: string): Collection { return (this.cache[name] ??= new Collection(this.d1, name)); }
  get users() { return this.c("users"); }
  get watchlist() { return this.c("watchlist"); }
  get comments() { return this.c("comments"); }
  get requests() { return this.c("requests"); }
  get progress() { return this.c("progress"); }
  get ratings() { return this.c("ratings"); }
  get notifications() { return this.c("notifications"); }
  get mod_log() { return this.c("mod_log"); }
  content(type: string): Collection | null {
    const m: Record<string, string> = { anime: "anime", tv_show: "tv_shows", movie: "movies" };
    return m[type] ? this.c(m[type]) : null;
  }
}
