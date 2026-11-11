-- Lookup index for the login rate limiter and any other query filtered by "key".
CREATE INDEX IF NOT EXISTS idx_docs_key ON docs (coll, json_extract(data, '$.key'));
