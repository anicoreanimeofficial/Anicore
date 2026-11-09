-- Image storage in D1 (replaces R2). Data is base64 text; keep each image under ~1.3MB (D1 row limit is 2MB).
CREATE TABLE IF NOT EXISTS blobs (
  key  TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data TEXT NOT NULL
);
