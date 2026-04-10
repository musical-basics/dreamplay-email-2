-- =============================================================================
-- dreamplay-email-2: Consolidated Canonical Schema
-- Represents the full current database state after all migrations.
-- Run this in Supabase SQL editor on a fresh project to initialize.
-- =============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- WORKSPACE TYPE ENUM
-- All valid workspace slugs. Adding a new workspace requires:
--   ALTER TYPE workspace_type ADD VALUE IF NOT EXISTS 'new_slug';
-- (DDL -- cannot be run inside a transaction block)
-- =============================================================================

DO $$ BEGIN
    CREATE TYPE workspace_type AS ENUM (
        'dreamplay_marketing',
        'dreamplay_support',
        'musicalbasics',
        'crossover',
        'concert_marketing'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;  -- already exists, skip
END $$;

-- ⚠️  LIVE DATABASE — add concert_marketing if not already present:
-- ALTER TYPE workspace_type ADD VALUE IF NOT EXISTS 'concert_marketing';


-- =============================================================================
-- 1. TAG DEFINITIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS tag_definitions (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    color       TEXT NOT NULL DEFAULT '#6b7280',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tag_definitions_name ON tag_definitions(name);

ALTER TABLE tag_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read tag_definitions"
    ON tag_definitions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert tag_definitions"
    ON tag_definitions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update tag_definitions"
    ON tag_definitions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated delete tag_definitions"
    ON tag_definitions FOR DELETE TO authenticated USING (true);


-- =============================================================================
-- 2. SUBSCRIBERS
-- =============================================================================

CREATE TABLE IF NOT EXISTS subscribers (
    id                  UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    email               TEXT NOT NULL,
    first_name          TEXT DEFAULT '',
    last_name           TEXT DEFAULT '',

    -- Status: active, unsubscribed, bounced, deleted
    status              TEXT DEFAULT 'active'
                            CHECK (status IN ('active', 'unsubscribed', 'bounced', 'deleted')),

    -- Tags (array of tag names, references tag_definitions.name)
    tags                TEXT[] DEFAULT '{}',

    -- Smart merge tags (AI-enriched or manually set)
    smart_tags          JSONB DEFAULT '{}',

    -- Geographic / contact info
    country             TEXT DEFAULT '',
    country_code        TEXT DEFAULT '',
    phone_code          TEXT DEFAULT '',
    phone_number        TEXT DEFAULT '',

    -- Shipping address
    shipping_address1   TEXT DEFAULT '',
    shipping_address2   TEXT DEFAULT '',
    shipping_city       TEXT DEFAULT '',
    shipping_zip        TEXT DEFAULT '',
    shipping_province   TEXT DEFAULT '',

    -- Workspace isolation
    workspace           TEXT DEFAULT 'dreamplay_marketing',

    -- Shopify / Klaviyo linkage
    shopify_customer_id TEXT,
    klaviyo_profile_id  TEXT,

    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subscribers_email_idx       ON subscribers(email);
CREATE INDEX IF NOT EXISTS subscribers_workspace_idx   ON subscribers(workspace);
CREATE INDEX IF NOT EXISTS subscribers_status_idx      ON subscribers(status);

-- Composite unique: same email can exist in multiple workspaces independently
-- (supports multi-workspace audience membership — see docs/audience-architecture-path-progression.md)
ALTER TABLE subscribers ADD CONSTRAINT subscribers_email_workspace_unique
    UNIQUE (email, workspace);

-- ⚠️  LIVE DATABASE MIGRATION (run once in Supabase SQL Editor if upgrading):
-- ALTER TABLE subscribers DROP CONSTRAINT IF EXISTS subscribers_email_key;
-- ALTER TABLE subscribers ADD CONSTRAINT subscribers_email_workspace_unique UNIQUE (email, workspace);


-- =============================================================================
-- 3. SUBSCRIBER EVENTS
-- (Open, click, bounce, complaint tracking)
-- =============================================================================

CREATE TABLE IF NOT EXISTS subscriber_events (
    id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    subscriber_id   UUID REFERENCES subscribers(id) ON DELETE CASCADE,
    campaign_id     UUID,  -- forward reference; FK added after campaigns table
    event_type      TEXT NOT NULL,  -- 'open', 'click', 'bounce', 'complaint', 'unsubscribe'
    metadata        JSONB DEFAULT '{}',
    occurred_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subscriber_events_subscriber_idx ON subscriber_events(subscriber_id);
CREATE INDEX IF NOT EXISTS subscriber_events_campaign_idx   ON subscriber_events(campaign_id);
CREATE INDEX IF NOT EXISTS subscriber_events_type_idx       ON subscriber_events(event_type);


-- =============================================================================
-- 4. APP SETTINGS
-- (Per-workspace key-value store)
-- =============================================================================

CREATE TABLE IF NOT EXISTS app_settings (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace   TEXT NOT NULL DEFAULT 'dreamplay_marketing',
    key         TEXT NOT NULL,
    value       JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (workspace, key)
);

CREATE INDEX IF NOT EXISTS app_settings_workspace_key_idx ON app_settings(workspace, key);


-- =============================================================================
-- 5. TEMPLATE FOLDERS
-- =============================================================================

CREATE TABLE IF NOT EXISTS template_folders (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name        TEXT NOT NULL,
    sort_order  INT DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);


-- =============================================================================
-- 6. ROTATIONS
-- (Round-robin split testing between campaigns)
-- =============================================================================

CREATE TABLE IF NOT EXISTS rotations (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name            TEXT NOT NULL,
    campaign_ids    UUID[] NOT NULL,
    cursor_position INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);


-- =============================================================================
-- 7. CAMPAIGNS
-- =============================================================================

CREATE TABLE IF NOT EXISTS campaigns (
    id                  UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name                TEXT NOT NULL,
    subject_line        TEXT,
    preview_text        TEXT,
    html_content        TEXT,
    variable_values     JSONB DEFAULT '{}',

    -- Status lifecycle
    status              TEXT CHECK (status IN ('draft', 'scheduled', 'sending', 'completed', 'deleted'))
                            DEFAULT 'draft',

    -- Template flags
    is_template         BOOLEAN DEFAULT FALSE,
    is_ready            BOOLEAN DEFAULT FALSE,
    is_starred_template BOOLEAN DEFAULT FALSE,

    -- Organization
    category            TEXT DEFAULT NULL,
    template_folder_id  UUID REFERENCES template_folders(id) ON DELETE SET NULL,

    -- Rotation linkage
    rotation_id         UUID REFERENCES rotations(id) DEFAULT NULL,
    chain_rotation_id   UUID REFERENCES chain_rotations(id) DEFAULT NULL,  -- added after chain_rotations table; see note below

    -- Parent tracking (for child campaigns cloned from templates)
    parent_template_id  UUID DEFAULT NULL,

    -- Analytics aggregates
    total_recipients    INTEGER DEFAULT 0,
    total_opens         INTEGER DEFAULT 0,
    total_clicks        INTEGER DEFAULT 0,
    total_conversions   INTEGER DEFAULT 0,
    average_read_time   NUMERIC DEFAULT 0,
    revenue_attributed  NUMERIC DEFAULT 0,

    -- Attribution / conversion tracking
    attribution_window_days  INTEGER DEFAULT 7,
    conversion_event         TEXT DEFAULT NULL,

    -- Sender info
    from_name           TEXT,
    from_email          TEXT,
    sent_from_email     TEXT,
    sent_to_emails      TEXT[] DEFAULT '{}',
    resend_email_id     TEXT,

    -- Scheduling
    scheduled_at        TIMESTAMPTZ DEFAULT NULL,
    scheduled_status    TEXT DEFAULT NULL,
    sent_at             TIMESTAMPTZ DEFAULT NULL,

    -- Workspace isolation
    workspace           TEXT DEFAULT 'dreamplay_marketing',

    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS campaigns_sent_at_idx        ON campaigns(sent_at DESC);
CREATE INDEX IF NOT EXISTS campaigns_workspace_idx      ON campaigns(workspace);
CREATE INDEX IF NOT EXISTS campaigns_status_idx         ON campaigns(status);
CREATE INDEX IF NOT EXISTS campaigns_is_template_idx    ON campaigns(is_template) WHERE is_template = TRUE;


-- =============================================================================
-- 8. CAMPAIGN VERSIONS
-- (Snapshot history of campaign HTML at send time)
-- =============================================================================

CREATE TABLE IF NOT EXISTS campaign_versions (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    html_content TEXT,
    version_num  INTEGER DEFAULT 1,
    snapshot_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS campaign_versions_campaign_idx ON campaign_versions(campaign_id);


-- =============================================================================
-- 9. MEDIA ASSETS
-- (Content-addressable storage: moves/deletes update table only, never bucket)
-- =============================================================================

CREATE TABLE IF NOT EXISTS media_assets (
    id           UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    filename     TEXT NOT NULL,
    folder_path  TEXT DEFAULT '',
    storage_hash TEXT NOT NULL,
    public_url   TEXT NOT NULL,
    size         INTEGER,
    is_deleted   BOOLEAN DEFAULT FALSE,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Fast UI listing (active assets in a folder)
CREATE INDEX IF NOT EXISTS idx_media_assets_folder ON media_assets(folder_path) WHERE is_deleted = FALSE;
-- Fast dedup on upload
CREATE INDEX IF NOT EXISTS idx_media_assets_hash   ON media_assets(storage_hash);

ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated select media_assets"
    ON media_assets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert media_assets"
    ON media_assets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update media_assets"
    ON media_assets FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Allow authenticated delete media_assets"
    ON media_assets FOR DELETE TO authenticated USING (true);


-- =============================================================================
-- 10. DISCOUNT PRESETS
-- =============================================================================

CREATE TABLE IF NOT EXISTS discount_presets (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL DEFAULT 'percentage',
    value           NUMERIC NOT NULL DEFAULT 5,
    duration_days   INT NOT NULL DEFAULT 2,
    code_prefix     TEXT NOT NULL DEFAULT 'VIP',
    target_url_key  TEXT NOT NULL DEFAULT 'main_cta_url',
    usage_limit     INT NOT NULL DEFAULT 1,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,

    -- 'all_users' = single shared code; 'per_user' = unique code per recipient
    code_mode       TEXT NOT NULL DEFAULT 'all_users',

    -- 'duration' = rolling N days; 'fixed_date' = specific calendar date
    expiry_mode     TEXT NOT NULL DEFAULT 'duration',
    expires_on      DATE,

    created_at      TIMESTAMPTZ DEFAULT NOW()
);


-- =============================================================================
-- 11. EMAIL CHAINS
-- (Automated journey/sequence definitions)
-- =============================================================================

CREATE TABLE IF NOT EXISTS email_chains (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name            TEXT NOT NULL,
    workspace       TEXT DEFAULT 'dreamplay_marketing',
    steps           JSONB DEFAULT '[]',
    branches        JSONB DEFAULT '[]',

    -- Null = master (reusable template); set = draft tied to a specific subscriber
    subscriber_id   UUID REFERENCES subscribers(id) ON DELETE SET NULL,

    -- True = frozen snapshot created when a master chain was run
    is_snapshot     BOOLEAN DEFAULT FALSE,

    status          TEXT DEFAULT 'draft',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_chains_workspace_idx     ON email_chains(workspace);
CREATE INDEX IF NOT EXISTS email_chains_subscriber_idx    ON email_chains(subscriber_id) WHERE subscriber_id IS NOT NULL;


-- =============================================================================
-- 12. CHAIN PROCESSES
-- (Per-subscriber journey state machine)
-- =============================================================================

CREATE TABLE IF NOT EXISTS chain_processes (
    id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    chain_id            UUID REFERENCES email_chains(id) ON DELETE CASCADE,
    subscriber_id       UUID REFERENCES subscribers(id) ON DELETE CASCADE,
    status              TEXT DEFAULT 'active'
                            CHECK (status IN ('active', 'paused', 'cancelled', 'completed')),
    current_step_index  INTEGER DEFAULT 0,
    next_step_at        TIMESTAMPTZ,
    history             JSONB DEFAULT '[]',
    inngest_event_id    TEXT,

    -- Chain rotation attribution
    chain_rotation_id   UUID,  -- FK added after chain_rotations table
    original_chain_id   UUID REFERENCES email_chains(id) ON DELETE SET NULL,

    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chain_processes_chain_idx       ON chain_processes(chain_id);
CREATE INDEX IF NOT EXISTS chain_processes_subscriber_idx  ON chain_processes(subscriber_id);
CREATE INDEX IF NOT EXISTS chain_processes_status_idx      ON chain_processes(status);


-- =============================================================================
-- 13. CHAIN ROTATIONS
-- (A/B testing between entire email chains / journeys)
-- =============================================================================

CREATE TABLE IF NOT EXISTS chain_rotations (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name            TEXT NOT NULL,
    chain_ids       UUID[] NOT NULL,
    cursor_position INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Now that chain_rotations exists, add the FK constraints that reference it
ALTER TABLE campaigns
    ADD CONSTRAINT campaigns_chain_rotation_id_fkey
    FOREIGN KEY (chain_rotation_id) REFERENCES chain_rotations(id);

ALTER TABLE chain_processes
    ADD CONSTRAINT chain_processes_chain_rotation_id_fkey
    FOREIGN KEY (chain_rotation_id) REFERENCES chain_rotations(id);


-- =============================================================================
-- 14. TRIGGER LOGS
-- (Automation trigger event log)
-- =============================================================================

CREATE TABLE IF NOT EXISTS trigger_logs (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    trigger_type    TEXT NOT NULL,
    subscriber_id   UUID REFERENCES subscribers(id) ON DELETE SET NULL,
    chain_id        UUID REFERENCES email_chains(id) ON DELETE SET NULL,
    payload         JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS trigger_logs_subscriber_idx ON trigger_logs(subscriber_id);
CREATE INDEX IF NOT EXISTS trigger_logs_type_idx       ON trigger_logs(trigger_type);


-- =============================================================================
-- 15. LATE FK: subscriber_events → campaigns
-- =============================================================================

ALTER TABLE subscriber_events
    ADD CONSTRAINT subscriber_events_campaign_id_fkey
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;


-- =============================================================================
-- STORAGE BUCKETS (must be created via Supabase Dashboard or CLI)
-- - email-assets  (public)
-- - sent-emails   (private)
-- =============================================================================
