-- One generic document table: every "collection" from the old MongoDB lives here as JSON.
CREATE TABLE IF NOT EXISTS docs (
  coll TEXT NOT NULL,
  id   TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (coll, id)
);
CREATE INDEX IF NOT EXISTS idx_docs_user    ON docs (coll, json_extract(data, '$.user_id'));
CREATE INDEX IF NOT EXISTS idx_docs_content ON docs (coll, json_extract(data, '$.content_id'));
CREATE INDEX IF NOT EXISTS idx_docs_tg      ON docs (coll, json_extract(data, '$.telegram_id'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email
  ON docs (json_extract(data, '$.email')) WHERE coll = 'users';
