BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'marketing_manager', 'operator', 'viewer')),
  salt BYTEA NOT NULL,
  password_hash BYTEA NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listings (
  id BIGSERIAL PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  neighborhood TEXT NOT NULL,
  listing_type TEXT NOT NULL,
  features TEXT NOT NULL,
  public_url TEXT NOT NULL,
  facts_checked_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS posts (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('facebook', 'tiktok')),
  body TEXT NOT NULL DEFAULT '',
  destination_url TEXT NOT NULL DEFAULT 'https://cabalou.net/',
  listing_id BIGINT REFERENCES listings(id) ON DELETE SET NULL,
  scheduled_date TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'published_manual')),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  rejection_reason TEXT,
  published_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  published_at TEXT,
  published_url TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  image_data BYTEA,
  image_mime TEXT
);

CREATE TABLE IF NOT EXISTS seo_metrics (
  id BIGSERIAL PRIMARY KEY,
  metric_date TEXT NOT NULL,
  query_text TEXT NOT NULL,
  page_path TEXT NOT NULL,
  clicks INTEGER NOT NULL,
  impressions INTEGER NOT NULL,
  ctr REAL NOT NULL,
  average_position REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  UNIQUE (metric_date, query_text, page_path)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS monthly_kpis (
  period TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  value REAL NOT NULL CHECK (value >= 0),
  source_note TEXT NOT NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (period, metric_key)
);

CREATE TABLE IF NOT EXISTS social_interactions (
  id BIGSERIAL PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('facebook', 'tiktok')),
  post_reference TEXT NOT NULL DEFAULT '',
  comment_summary TEXT NOT NULL,
  reply_draft TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'draft', 'replied', 'ignored')),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_requests (
  id BIGSERIAL PRIMARY KEY,
  source_group TEXT NOT NULL,
  city TEXT NOT NULL,
  listing_type TEXT NOT NULL DEFAULT '',
  desired_date TEXT NOT NULL DEFAULT '',
  guests INTEGER,
  request_summary TEXT NOT NULL,
  response_draft TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'draft', 'replied', 'closed')),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS b2b_prospects (
  id BIGSERIAL PRIMARY KEY,
  company TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  legal_basis TEXT NOT NULL CHECK (legal_basis IN ('pending', 'consent', 'legitimate_interest')),
  opted_out INTEGER NOT NULL DEFAULT 0 CHECK (opted_out IN (0, 1)),
  subject TEXT NOT NULL DEFAULT '',
  email_draft TEXT NOT NULL DEFAULT '',
  follow_up_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'draft', 'sent', 'replied', 'qualified', 'closed', 'opted_out')),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reactivation_contacts (
  id BIGSERIAL PRIMARY KEY,
  external_ref TEXT NOT NULL UNIQUE,
  last_booking_date TEXT NOT NULL,
  contact_basis TEXT NOT NULL CHECK (contact_basis IN ('pending', 'consent', 'existing_customer')),
  opted_out INTEGER NOT NULL DEFAULT 0 CHECK (opted_out IN (0, 1)),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reactivation_events (
  id BIGSERIAL PRIMARY KEY,
  contact_id BIGINT NOT NULL REFERENCES reactivation_contacts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('contacted', 'responded', 'repeat_booking', 'opted_out')),
  note TEXT NOT NULL DEFAULT '',
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retargeting_prospects (
  id BIGSERIAL PRIMARY KEY,
  external_ref TEXT NOT NULL UNIQUE,
  interest_label TEXT NOT NULL,
  source TEXT NOT NULL,
  consent_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (consent_confirmed IN (0, 1)),
  opted_out INTEGER NOT NULL DEFAULT 0 CHECK (opted_out IN (0, 1)),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retargeting_events (
  id BIGSERIAL PRIMARY KEY,
  prospect_id BIGINT NOT NULL REFERENCES retargeting_prospects(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('reached', 'booked', 'opted_out')),
  note TEXT NOT NULL DEFAULT '',
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seo_targets (
  id BIGSERIAL PRIMARY KEY,
  query_text TEXT NOT NULL UNIQUE,
  target_page TEXT NOT NULL DEFAULT '',
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seo_target_metrics (
  target_id BIGINT NOT NULL REFERENCES seo_targets(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  average_position REAL NOT NULL CHECK (average_position BETWEEN 1 AND 1000),
  clicks INTEGER NOT NULL CHECK (clicks >= 0),
  impressions INTEGER NOT NULL CHECK (impressions >= 0),
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (target_id, period)
);

ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_data BYTEA;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_mime TEXT;

CREATE INDEX IF NOT EXISTS posts_status_updated ON posts(status, updated_at);
CREATE INDEX IF NOT EXISTS posts_schedule ON posts(scheduled_date);
CREATE INDEX IF NOT EXISTS audit_created ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS monthly_kpis_period ON monthly_kpis(period);
CREATE INDEX IF NOT EXISTS social_interactions_status ON social_interactions(status, updated_at);
CREATE INDEX IF NOT EXISTS group_requests_status ON group_requests(status, updated_at);
CREATE INDEX IF NOT EXISTS reactivation_events_contact ON reactivation_events(contact_id, created_at);
CREATE INDEX IF NOT EXISTS retargeting_events_prospect ON retargeting_events(prospect_id, created_at);

UPDATE posts
SET is_demo = 1
WHERE created_by IS NULL
  AND title IN ('Un séjour pratique à Libreville', 'Votre prochain séjour à Cotonou');

COMMIT;
