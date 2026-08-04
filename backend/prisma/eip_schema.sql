-- =====================================================================
-- EXECUTIVE INTELLIGENCE PLATFORM (EIP) — PostgreSQL 18 Schema
-- =====================================================================
-- Implements the pipeline in "Document_Processing" flow:
--   1 Input -> 2 Source Discovery -> 3 Document Collection ->
--   4 Document Classification -> 5 Document Processing ->
--   6 LLM Extraction -> 7 Entity Resolution -> 8 Timeline Engine ->
--   9 Organization Profile Update
--
-- Design philosophy (per project spec):
--   - NEVER hardcode financial/technology metrics as columns.
--     Use dynamic metric tables (financial_metrics, technology_metrics)
--     keyed by a metric_definitions catalog, so new metrics (AI Spend,
--     Data Center Spend, etc.) need zero schema changes.
--   - Every org carries a pipeline `status` enum mirroring the flowchart
--     swimlanes (NEW -> ... -> ACTIVE / REVIEW QUEUE).
--   - Full audit trail: job_history, processing_logs, change_history,
--     errors — every worker writes here.
--   - Sector-agnostic: BFSI now, any industry later, without redesign.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =====================================================================
-- 0. ENUM TYPES
-- =====================================================================

-- Organization lifecycle status (flowchart node "PostgreSQL Organizations
-- Status = PENDING" through final "Status = COMPLETE")
CREATE TYPE org_status AS ENUM (
    'NEW',
    'PENDING',              -- queued after input validation, awaiting discovery
    'IMPORTING',
    'DISCOVERING_SOURCES',
    'CRAWLING',
    'DOCUMENTS_COLLECTED',
    'OCR_COMPLETE',
    'TRANSLATED',
    'EXTRACTING',           -- LLM extraction in progress
    'ENTITY_RESOLUTION',
    'ENRICHED',
    'ICP_RUNNING',
    'QUALIFIED',
    'ACTIVE',
    'REVIEW_QUEUE',         -- confidence below threshold / low quality text
    'REJECTED',             -- failed input validation (duplicate/invalid domain)
    'FAILED'                -- failed after retries
);

CREATE TYPE ownership_type AS ENUM ('Government', 'Private', 'Cooperative', 'Public Listed', 'Foreign', 'Other');

CREATE TYPE document_type AS ENUM (
    'Official Website', 'Investor Page', 'Annual Report', 'AGM Report',
    'Financial Statement', 'News', 'Government Website', 'RBI Publication',
    'Press Release', 'Social Media', 'Sustainability/CSR', 'Career', 'Other'
);

CREATE TYPE document_status AS ENUM ('DOWNLOADED', 'FAILED', 'RETRYING', 'OCR_PENDING', 'OCR_DONE', 'PROCESSED');

CREATE TYPE crawl_job_status AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'RETRY');

CREATE TYPE extraction_status AS ENUM ('PENDING', 'RUNNING', 'PASSED', 'FAILED', 'MANUAL_REVIEW');

CREATE TYPE metric_category AS ENUM (
    'Financial', 'Technology', 'Workforce', 'Digital', 'Security', 'Other'
);

CREATE TYPE opportunity_tier AS ENUM ('Strategic', 'Tier 1', 'Tier 2', 'Tier 3', 'Watchlist');

CREATE TYPE contact_channel AS ENUM ('Email', 'Phone', 'LinkedIn', 'Twitter/X', 'Other');

CREATE TYPE sentiment_label AS ENUM ('Positive', 'Neutral', 'Negative');

-- =====================================================================
-- 1. SECURITY DOMAIN (users / roles / permissions / sessions / api_keys)
-- =====================================================================

CREATE TABLE roles (
    role_id         SMALLSERIAL PRIMARY KEY,
    role_name       TEXT UNIQUE NOT NULL,             -- Admin, Analyst, Sales, Viewer
    description     TEXT
);

CREATE TABLE permissions (
    permission_id   SMALLSERIAL PRIMARY KEY,
    permission_key  TEXT UNIQUE NOT NULL,              -- 'org.read', 'org.write', 'icp.run'
    description     TEXT
);

CREATE TABLE role_permissions (
    role_id         SMALLINT REFERENCES roles(role_id) ON DELETE CASCADE,
    permission_id   SMALLINT REFERENCES permissions(permission_id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
    user_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name       TEXT NOT NULL,
    email           TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    role_id         SMALLINT NOT NULL REFERENCES roles(role_id),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    session_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    jwt_id          TEXT UNIQUE NOT NULL,
    issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked         BOOLEAN NOT NULL DEFAULT FALSE,
    ip_address      INET
);

CREATE TABLE api_keys (
    api_key_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    key_hash        TEXT UNIQUE NOT NULL,
    label           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at    TIMESTAMPTZ,
    revoked         BOOLEAN NOT NULL DEFAULT FALSE
);

-- =====================================================================
-- 2. MASTER DOMAIN (sectors / organizations / branches / addresses /
--    contacts / leadership / aliases / ownership types)
-- =====================================================================

CREATE TABLE sectors (
    sector_id       SMALLSERIAL PRIMARY KEY,
    sector_name     TEXT UNIQUE NOT NULL,              -- BFSI, Manufacturing, Government...
    description     TEXT
);

CREATE TABLE subsectors (
    subsector_id    SMALLSERIAL PRIMARY KEY,
    sector_id       SMALLINT NOT NULL REFERENCES sectors(sector_id),
    subsector_name  TEXT NOT NULL,                     -- Private Bank, Karnataka Cooperative Bank...
    UNIQUE (sector_id, subsector_name)
);

CREATE TABLE states (
    state_id        SMALLSERIAL PRIMARY KEY,
    state_name      TEXT UNIQUE NOT NULL,
    is_union_territory BOOLEAN NOT NULL DEFAULT FALSE,
    region          TEXT,                              -- North/South/East/West/Northeast/Central
    latitude        NUMERIC(9,6),
    longitude       NUMERIC(9,6)
);

CREATE TABLE cities (
    city_id         SERIAL PRIMARY KEY,
    city_name       TEXT NOT NULL,
    state_id        SMALLINT NOT NULL REFERENCES states(state_id),
    latitude        NUMERIC(9,6),
    longitude       NUMERIC(9,6),
    UNIQUE (city_name, state_id)
);

-- Core organization master record
CREATE TABLE organizations (
    organization_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    legal_name           TEXT NOT NULL,
    display_name          TEXT,
    domain                 TEXT UNIQUE,                -- primary website domain, dedup key
    sector_id              SMALLINT REFERENCES sectors(sector_id),
    subsector_id            SMALLINT REFERENCES subsectors(subsector_id),
    ownership_type            ownership_type,
    incorporation_year       SMALLINT,
    cin_number                TEXT,                     -- Corporate Identification Number
    status                     org_status NOT NULL DEFAULT 'NEW',
    source_of_entry            TEXT,                    -- 'Excel Import', 'API', 'Manual Entry'
    is_duplicate_of            UUID REFERENCES organizations(organization_id),
    icp_score                  NUMERIC(5,2),
    opportunity_tier            opportunity_tier,
    confidence_score             NUMERIC(5,2),           -- last extraction confidence (0-100)
    created_by                    UUID REFERENCES users(user_id),
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_org_status   ON organizations(status);
CREATE INDEX idx_org_sector   ON organizations(sector_id, subsector_id);
CREATE INDEX idx_org_score    ON organizations(icp_score DESC);
CREATE INDEX idx_org_name_trgm ON organizations USING gin (legal_name gin_trgm_ops);

-- Alternate/former names, merged duplicates, abbreviations
CREATE TABLE organization_aliases (
    alias_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    alias_name      TEXT NOT NULL,
    alias_type      TEXT                                -- 'former_name','abbreviation','local_language'
);

CREATE TABLE addresses (
    address_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id  UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    address_line     TEXT,
    city_id          INTEGER REFERENCES cities(city_id),
    state_id         SMALLINT REFERENCES states(state_id),
    pincode          TEXT,
    is_headquarters  BOOLEAN NOT NULL DEFAULT FALSE,
    latitude         NUMERIC(9,6),
    longitude        NUMERIC(9,6)
);

-- Branch / franchise network (multi-branch tag support)
CREATE TABLE branches (
    branch_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id  UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    branch_name      TEXT,
    city_id          INTEGER REFERENCES cities(city_id),
    state_id         SMALLINT REFERENCES states(state_id),
    branch_type      TEXT,                              -- 'Branch','Regional Office','HQ'
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_branches_org ON branches(organization_id);

CREATE TABLE contacts (
    contact_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id  UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    full_name        TEXT,
    designation      TEXT,
    channel          contact_channel NOT NULL,
    value            TEXT NOT NULL,                     -- email address / phone / handle
    is_primary       BOOLEAN NOT NULL DEFAULT FALSE,
    source_document_id UUID,                            -- FK added after documents table
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Leadership (CEO, CTO, CIO, Chairman, VP, Manager...)
CREATE TABLE leadership (
    leadership_id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id  UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    person_name      TEXT NOT NULL,
    designation      TEXT NOT NULL,                     -- 'CEO','CTO','CIO','Chairman','VP','Manager'
    linkedin_url     TEXT,
    is_current       BOOLEAN NOT NULL DEFAULT TRUE,
    start_date       DATE,
    end_date         DATE,
    source_document_id UUID,
    confidence       NUMERIC(5,2),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_leadership_org ON leadership(organization_id) WHERE is_current;

-- =====================================================================
-- 3. FINANCIAL & TECHNOLOGY DOMAIN — dynamic metric model
--    (per spec: "Do NOT hardcode Revenue/Cloud Spend/Cyber Spend.
--     Instead use metric tables. No schema changes for future metrics.")
-- =====================================================================

CREATE TABLE metric_definitions (
    metric_id        SMALLSERIAL PRIMARY KEY,
    metric_key       TEXT UNIQUE NOT NULL,              -- 'revenue','net_profit','it_spend','cloud_spend'
    display_name     TEXT NOT NULL,
    category         metric_category NOT NULL,
    unit             TEXT NOT NULL DEFAULT 'INR_CR',     -- 'INR_CR','%','COUNT','SCORE'
    description      TEXT,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE
);

-- Seed the metrics named explicitly in the spec — new ones can be added
-- anytime via INSERT, with zero DDL changes.
INSERT INTO metric_definitions (metric_key, display_name, category, unit) VALUES
('revenue',              'Revenue',                 'Financial', 'INR_CR'),
('net_profit',           'Net Profit',               'Financial', 'INR_CR'),
('assets',               'Assets',                   'Financial', 'INR_CR'),
('loans',                'Loans',                    'Financial', 'INR_CR'),
('deposits',             'Deposits',                 'Financial', 'INR_CR'),
('market_cap',           'Market Capitalization',    'Financial', 'INR_CR'),
('it_spend',             'IT Spend',                 'Technology','INR_CR'),
('cloud_spend',          'Cloud Spend',               'Technology','INR_CR'),
('cybersecurity_spend',  'Cybersecurity Spend',       'Technology','INR_CR'),
('ai_spend',              'AI Spend',                  'Technology','INR_CR'),
('digital_transformation_spend', 'Digital Transformation Spend', 'Technology','INR_CR'),
('data_center_spend',      'Data Center Spend',        'Technology','INR_CR'),
('employee_count',          'Employee Count',           'Workforce', 'COUNT'),
('branch_count',              'Branch Count',            'Workforce', 'COUNT');

-- Financial metric facts (time-series capable: one row per org/metric/period)
CREATE TABLE financial_metrics (
    financial_metric_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id      UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    metric_id             SMALLINT NOT NULL REFERENCES metric_definitions(metric_id),
    fiscal_year             SMALLINT,                    -- e.g. 2025 for FY2024-25
    value                     NUMERIC(18,4) NOT NULL,
    source_document_id        UUID,
    confidence                 NUMERIC(5,2),
    extracted_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, metric_id, fiscal_year)
);
CREATE INDEX idx_fin_metrics_org ON financial_metrics(organization_id, metric_id);

-- Technology metric facts
CREATE TABLE technology_metrics (
    technology_metric_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id       UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    metric_id              SMALLINT NOT NULL REFERENCES metric_definitions(metric_id),
    fiscal_year               SMALLINT,
    value                       NUMERIC(18,4) NOT NULL,
    source_document_id          UUID,
    confidence                   NUMERIC(5,2),
    extracted_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, metric_id, fiscal_year)
);
CREATE INDEX idx_tech_metrics_org ON technology_metrics(organization_id, metric_id);

-- Categorical technology profile (ERP, CRM, Cloud Provider, Automation...)
-- kept separate from numeric metrics since these are qualitative facts
CREATE TABLE technology_profiles (
    tech_profile_id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    category             TEXT NOT NULL,                  -- 'Cloud Provider','ERP','CRM','Automation','Data Center'
    value_text            TEXT NOT NULL,                 -- 'AWS', 'SAP', 'Salesforce'...
    source_document_id     UUID,
    confidence               NUMERIC(5,2),
    extracted_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tech_profile_org ON technology_profiles(organization_id);

-- =====================================================================
-- 4. COLLECTION DOMAIN (crawl_jobs, crawl_sources, documents,
--    document_versions, document_chunks, translations)
-- =====================================================================

-- 1. Input / Source Discovery — flowchart nodes "Discover Available Sources"
CREATE TABLE crawl_sources (
    crawl_source_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id    UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    source_type          document_type NOT NULL,          -- Official Site / Investor Page / Annual Report...
    url                    TEXT NOT NULL,
    discovered_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active                  BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX idx_crawl_sources_org ON crawl_sources(organization_id);

-- 3. Document Collection — flowchart "Camoufox Browser -> Download HTML/PDF"
CREATE TABLE crawl_jobs (
    crawl_job_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    crawl_source_id       UUID REFERENCES crawl_sources(crawl_source_id),
    status                  crawl_job_status NOT NULL DEFAULT 'QUEUED',
    retry_count               SMALLINT NOT NULL DEFAULT 0,   -- "Retry 3 Times" node
    max_retries                 SMALLINT NOT NULL DEFAULT 3,
    started_at                    TIMESTAMPTZ,
    finished_at                     TIMESTAMPTZ,
    error_message                     TEXT,
    created_at                          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_crawl_jobs_org_status ON crawl_jobs(organization_id, status);

-- "Document Repository" node — raw downloaded artifacts + metadata
CREATE TABLE documents (
    document_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id      UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    crawl_job_id            UUID REFERENCES crawl_jobs(crawl_job_id),
    document_type              document_type NOT NULL,
    url                           TEXT,
    file_format                     TEXT,                    -- 'HTML','PDF','IMAGE'
    storage_path                       TEXT NOT NULL,          -- object storage key/path
    checksum                              TEXT,                -- dedup / integrity check
    is_scanned                              BOOLEAN NOT NULL DEFAULT FALSE,
    detected_language                          TEXT,
    status                                        document_status NOT NULL DEFAULT 'DOWNLOADED',
    downloaded_at                                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, checksum)
);
CREATE INDEX idx_documents_org_type ON documents(organization_id, document_type);

ALTER TABLE contacts   ADD CONSTRAINT fk_contacts_doc   FOREIGN KEY (source_document_id) REFERENCES documents(document_id);
ALTER TABLE leadership ADD CONSTRAINT fk_leadership_doc FOREIGN KEY (source_document_id) REFERENCES documents(document_id);
ALTER TABLE financial_metrics  ADD CONSTRAINT fk_finmet_doc  FOREIGN KEY (source_document_id) REFERENCES documents(document_id);
ALTER TABLE technology_metrics ADD CONSTRAINT fk_techmet_doc FOREIGN KEY (source_document_id) REFERENCES documents(document_id);
ALTER TABLE technology_profiles ADD CONSTRAINT fk_techprof_doc FOREIGN KEY (source_document_id) REFERENCES documents(document_id);

-- Version history if a document is re-crawled (e.g. annual report reissued)
CREATE TABLE document_versions (
    document_version_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id            UUID NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    version_number             INTEGER NOT NULL DEFAULT 1,
    storage_path                  TEXT NOT NULL,
    checksum                         TEXT,
    created_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (document_id, version_number)
);

-- 5. Document Processing — translation output (IndicTrans2)
CREATE TABLE translations (
    translation_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id           UUID NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    source_language          TEXT NOT NULL,
    target_language             TEXT NOT NULL DEFAULT 'en',
    translated_text                TEXT,
    translated_storage_path           TEXT,
    engine                                TEXT NOT NULL DEFAULT 'IndicTrans2',
    created_at                              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cleaned/chunked text ready for LLM ("Chunk Documents" node)
CREATE TABLE document_chunks (
    chunk_id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id           UUID NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    chunk_index              INTEGER NOT NULL,
    chunk_text                  TEXT NOT NULL,
    token_count                    INTEGER,
    -- embedding                    VECTOR(1536),         -- uncomment + `CREATE EXTENSION vector;` above if using pgvector for semantic search
    created_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (document_id, chunk_index)
);

-- =====================================================================
-- 5. AI ENRICHMENT DOMAIN (enrichment_jobs, *_profiles, llm_profiles)
-- =====================================================================

CREATE TABLE enrichment_jobs (
    enrichment_job_id  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id       UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    document_id              UUID REFERENCES documents(document_id),
    status                      extraction_status NOT NULL DEFAULT 'PENDING',
    llm_model                     TEXT,                     -- 'gpt-4.1', 'local-llama-70b'...
    prompt_version                   TEXT,
    raw_response_json                    JSONB,             -- "Structured JSON" node output
    confidence_score                        NUMERIC(5,2),   -- "Confidence Score" node
    started_at                                 TIMESTAMPTZ,
    finished_at                                   TIMESTAMPTZ,
    error_message                                    TEXT,
    created_at                                          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_enrichment_org ON enrichment_jobs(organization_id, status);

-- Consolidated "current best known" profile snapshots per subject area
-- (denormalized/materialized for fast dashboard reads — refreshed by
-- enrichment jobs / entity-resolution "Update Master Organization" step)
CREATE TABLE organization_profiles (
    organization_id     UUID PRIMARY KEY REFERENCES organizations(organization_id) ON DELETE CASCADE,
    summary                 TEXT,
    products                    TEXT[],
    services                       TEXT[],
    awards                            TEXT[],
    partnerships                         TEXT[],
    digital_initiatives                     TEXT[],
    last_enriched_at                            TIMESTAMPTZ
);

CREATE TABLE financial_profiles (
    organization_id     UUID PRIMARY KEY REFERENCES organizations(organization_id) ON DELETE CASCADE,
    latest_fiscal_year     SMALLINT,
    summary                    TEXT,
    last_updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE technology_profile_summary (
    organization_id     UUID PRIMARY KEY REFERENCES organizations(organization_id) ON DELETE CASCADE,
    summary                 TEXT,
    last_updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE leadership_profiles (
    organization_id     UUID PRIMARY KEY REFERENCES organizations(organization_id) ON DELETE CASCADE,
    ceo_name                TEXT,
    cto_name                    TEXT,
    cio_name                        TEXT,
    chairman_name                       TEXT,
    last_updated_at                        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contact_profiles (
    organization_id     UUID PRIMARY KEY REFERENCES organizations(organization_id) ON DELETE CASCADE,
    primary_email           TEXT,
    primary_phone               TEXT,
    linkedin_url                    TEXT,
    last_updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Raw LLM output archive, one row per extraction, for auditability/debug
CREATE TABLE llm_profiles (
    llm_profile_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enrichment_job_id      UUID NOT NULL REFERENCES enrichment_jobs(enrichment_job_id) ON DELETE CASCADE,
    organization_id           UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    profile_json                 JSONB NOT NULL,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- 6. ENTITY RESOLUTION DOMAIN
-- =====================================================================

-- Candidate entities extracted per chunk before being merged/normalized
CREATE TABLE extracted_entities (
    entity_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enrichment_job_id     UUID NOT NULL REFERENCES enrichment_jobs(enrichment_job_id) ON DELETE CASCADE,
    entity_type              TEXT NOT NULL,               -- 'Company Name','Person','Location','Technology','Vendor'
    entity_value                TEXT NOT NULL,
    normalized_value                TEXT,
    confidence                         NUMERIC(5,2),
    created_at                            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_entities_job ON extracted_entities(enrichment_job_id);
CREATE INDEX idx_entities_type ON extracted_entities(entity_type);

-- Links a resolved/normalized entity back to a master record
-- (e.g. normalized "SBI" -> organizations.organization_id of State Bank of India)
CREATE TABLE entity_resolutions (
    resolution_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_id              UUID NOT NULL REFERENCES extracted_entities(entity_id) ON DELETE CASCADE,
    resolved_organization_id UUID REFERENCES organizations(organization_id),
    resolution_method          TEXT,                       -- 'exact_match','fuzzy_match','llm_disambiguation'
    resolved_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- 7. TIMELINE ENGINE DOMAIN — "Create Timeline Events" node
-- =====================================================================

CREATE TABLE timeline_events (
    event_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id         UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    event_type                 TEXT NOT NULL,             -- 'Revenue Change','CEO Change','Expansion','Hiring Spike','AI Initiative'
    event_summary                  TEXT NOT NULL,
    event_date                        DATE,
    old_value                            JSONB,
    new_value                                JSONB,
    source_document_id                          UUID REFERENCES documents(document_id),
    confidence                                     NUMERIC(5,2),
    created_at                                        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_timeline_org_date ON timeline_events(organization_id, event_date DESC);

-- =====================================================================
-- 8. NEWS DOMAIN
-- =====================================================================

CREATE TABLE news_sources (
    news_source_id      SERIAL PRIMARY KEY,
    source_name             TEXT NOT NULL,
    base_url                   TEXT,
    is_active                     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE news_articles (
    article_id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    news_source_id           INTEGER REFERENCES news_sources(news_source_id),
    organization_id              UUID REFERENCES organizations(organization_id) ON DELETE CASCADE,
    title                            TEXT NOT NULL,
    url                                  TEXT,
    published_at                            TIMESTAMPTZ,
    body_text                                  TEXT,
    document_id                                   UUID REFERENCES documents(document_id),
    created_at                                       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_news_org ON news_articles(organization_id, published_at DESC);

CREATE TABLE news_entities (
    news_entity_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    article_id               UUID NOT NULL REFERENCES news_articles(article_id) ON DELETE CASCADE,
    entity_type                  TEXT NOT NULL,
    entity_value                     TEXT NOT NULL
);

CREATE TABLE sentiment_scores (
    sentiment_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    article_id                UUID NOT NULL REFERENCES news_articles(article_id) ON DELETE CASCADE,
    label                          sentiment_label NOT NULL,
    score                              NUMERIC(4,3),        -- -1.000 to 1.000
    model_used                            TEXT,
    created_at                                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- 9. ICP ENGINE DOMAIN (rules, weights, models, results, tags, history)
-- =====================================================================

CREATE TABLE score_models (
    score_model_id       SMALLSERIAL PRIMARY KEY,
    model_name               TEXT NOT NULL,
    sector_id                    SMALLINT REFERENCES sectors(sector_id),  -- NULL = applies to all sectors
    is_active                        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Weighted scoring components: Revenue 25%, IT Spend 20%, Cloud 15%,
-- Cyber 15%, Net Profit 10%, Org Scale 10%, Leadership 5%
CREATE TABLE score_weights (
    score_weight_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    score_model_id            SMALLINT NOT NULL REFERENCES score_models(score_model_id) ON DELETE CASCADE,
    metric_id                     SMALLINT REFERENCES metric_definitions(metric_id),
    component_name                    TEXT NOT NULL,        -- 'Revenue','IT Spend','Leadership',...
    weight_pct                            NUMERIC(5,2) NOT NULL CHECK (weight_pct BETWEEN 0 AND 100),
    UNIQUE (score_model_id, component_name)
);

-- Grouped qualification rules (ANY-ONE-of logic per spec)
CREATE TABLE rule_groups (
    rule_group_id         SMALLSERIAL PRIMARY KEY,
    group_name                TEXT NOT NULL,               -- 'BFSI Default Qualification'
    match_logic                   TEXT NOT NULL DEFAULT 'ANY', -- 'ANY' or 'ALL'
    is_active                        BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE qualification_rules (
    rule_id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rule_group_id               INTEGER NOT NULL REFERENCES rule_groups(rule_group_id) ON DELETE CASCADE,
    metric_id                       SMALLINT NOT NULL REFERENCES metric_definitions(metric_id),
    operator                            TEXT NOT NULL,      -- '>=','<=','>','<','='
    threshold_value                         NUMERIC(18,4) NOT NULL,
    is_active                                   BOOLEAN NOT NULL DEFAULT TRUE
);

-- Seed: default BFSI qualification rules exactly per spec
INSERT INTO rule_groups (group_name, match_logic) VALUES ('BFSI Default Qualification', 'ANY');
INSERT INTO qualification_rules (rule_group_id, metric_id, operator, threshold_value)
SELECT 1, metric_id, '>=', v.threshold
FROM metric_definitions md
JOIN (VALUES
    ('revenue', 1000),
    ('net_profit', 1),
    ('it_spend', 0.40),
    ('cloud_spend', 0.40),
    ('cybersecurity_spend', 0.40)
) AS v(metric_key, threshold) ON md.metric_key = v.metric_key;

INSERT INTO score_models (model_name) VALUES ('BFSI Default ICP Model');
INSERT INTO score_weights (score_model_id, component_name, weight_pct) VALUES
(1, 'Revenue', 25),
(1, 'IT Spend', 20),
(1, 'Cloud Spend', 15),
(1, 'Cybersecurity', 15),
(1, 'Net Profit', 10),
(1, 'Organization Scale', 10),
(1, 'Leadership', 5);

CREATE TABLE qualification_results (
    qualification_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id             UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    rule_group_id                    INTEGER REFERENCES rule_groups(rule_group_id),
    is_qualified                         BOOLEAN NOT NULL,
    matched_rules                            JSONB,          -- which rules fired, for explainability
    evaluated_at                                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_qual_results_org ON qualification_results(organization_id, evaluated_at DESC);

CREATE TABLE opportunity_tags (
    tag_id                  SMALLSERIAL PRIMARY KEY,
    tag_name                    TEXT UNIQUE NOT NULL         -- 'High Revenue','Cloud Adopter','AI Opportunity'...
);

INSERT INTO opportunity_tags (tag_name) VALUES
('High Revenue'), ('High IT Spend'), ('Cloud Adopter'), ('Cybersecurity Focus'),
('Government'), ('Private'), ('Listed'), ('Cooperative Bank'), ('Manufacturing'),
('AI Opportunity'), ('Digital Transformation'), ('Large Workforce'), ('Multi Branch');

CREATE TABLE organization_tags (
    organization_id     UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    tag_id                  SMALLINT NOT NULL REFERENCES opportunity_tags(tag_id) ON DELETE CASCADE,
    assigned_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, tag_id)
);

CREATE TABLE score_history (
    score_history_id      BIGSERIAL PRIMARY KEY,
    organization_id            UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    score_model_id                  SMALLINT REFERENCES score_models(score_model_id),
    icp_score                            NUMERIC(5,2) NOT NULL,
    recorded_at                              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_score_history_org_time ON score_history(organization_id, recorded_at DESC);

CREATE TABLE tier_history (
    tier_history_id        BIGSERIAL PRIMARY KEY,
    organization_id             UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    opportunity_tier                 opportunity_tier NOT NULL,
    recorded_at                          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tier_history_org_time ON tier_history(organization_id, recorded_at DESC);

-- =====================================================================
-- 10. DASHBOARD DOMAIN
-- =====================================================================

CREATE TABLE dashboard_views (
    view_id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    view_name                       TEXT NOT NULL,
    view_config_json                    JSONB NOT NULL,       -- layout, widgets, columns shown
    is_default                              BOOLEAN NOT NULL DEFAULT FALSE,
    created_at                                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE saved_filters (
    filter_id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    filter_name                     TEXT NOT NULL,
    filter_json                         JSONB NOT NULL,
    created_at                              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, filter_name)
);

CREATE TABLE reports (
    report_id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    report_name                      TEXT NOT NULL,
    report_type                          TEXT,               -- 'PDF','CSV','XLSX'
    filter_json                              JSONB,
    generated_file_path                          TEXT,
    generated_at                                     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE dashboard_cache (
    cache_key                TEXT PRIMARY KEY,
    cache_value                   JSONB NOT NULL,
    expires_at                        TIMESTAMPTZ NOT NULL
);

-- =====================================================================
-- 11. AUDIT DOMAIN (audit_logs, processing_logs, job_history,
--     change_history, errors)
-- =====================================================================

CREATE TABLE audit_logs (
    audit_id                  BIGSERIAL PRIMARY KEY,
    user_id                       UUID REFERENCES users(user_id),
    action                            TEXT NOT NULL,          -- 'ORG_CREATE','ORG_UPDATE','ICP_RUN'...
    entity_type                          TEXT,
    entity_id                                UUID,
    metadata_json                                JSONB,
    created_at                                       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);

-- Every worker (Import/Crawler/PDF/OCR/Translation/LLM/ICP/Database) writes
-- a row here for observability of the pipeline
CREATE TABLE job_history (
    job_history_id             BIGSERIAL PRIMARY KEY,
    worker_name                     TEXT NOT NULL,           -- 'ImportWorker','CrawlerWorker','LLMWorker'...
    organization_id                     UUID REFERENCES organizations(organization_id),
    reference_id                            UUID,             -- crawl_job_id / enrichment_job_id / etc.
    status                                      TEXT NOT NULL, -- 'STARTED','SUCCESS','FAILED'
    started_at                                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at                                         TIMESTAMPTZ,
    details_json                                            JSONB
);
CREATE INDEX idx_job_history_org ON job_history(organization_id, started_at DESC);

CREATE TABLE processing_logs (
    log_id                     BIGSERIAL PRIMARY KEY,
    organization_id                 UUID REFERENCES organizations(organization_id),
    stage                                TEXT NOT NULL,        -- flowchart stage name, e.g. 'DOCUMENT_CLASSIFICATION'
    message                                  TEXT NOT NULL,
    level                                        TEXT NOT NULL DEFAULT 'INFO', -- INFO/WARN/ERROR
    created_at                                       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_processing_logs_org ON processing_logs(organization_id, created_at DESC);

CREATE TABLE change_history (
    change_id                  BIGSERIAL PRIMARY KEY,
    organization_id                 UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    field_name                          TEXT NOT NULL,
    old_value                               TEXT,
    new_value                                   TEXT,
    changed_by                                      TEXT,      -- worker name or user_id
    changed_at                                          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_change_history_org ON change_history(organization_id, changed_at DESC);

CREATE TABLE errors (
    error_id                   BIGSERIAL PRIMARY KEY,
    organization_id                 UUID REFERENCES organizations(organization_id),
    worker_name                          TEXT,
    error_type                               TEXT,
    error_message                                TEXT NOT NULL,
    stack_trace                                      TEXT,
    occurred_at                                          TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved                                                 BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_errors_org ON errors(organization_id, occurred_at DESC);

-- =====================================================================
-- 12. TRIGGERS — updated_at maintenance + change_history capture
-- =====================================================================

CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_organizations_updated_at
BEFORE UPDATE ON organizations
FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TRIGGER set_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- Capture status transitions into change_history automatically
CREATE OR REPLACE FUNCTION trg_org_status_change() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO change_history (organization_id, field_name, old_value, new_value, changed_by)
        VALUES (NEW.organization_id, 'status', OLD.status::TEXT, NEW.status::TEXT, 'system_trigger');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER capture_org_status_change
AFTER UPDATE ON organizations
FOR EACH ROW EXECUTE FUNCTION trg_org_status_change();

-- =====================================================================
-- 13. VIEWS — Executive Dashboard support
-- =====================================================================

-- One-row-per-org flattened view for dashboard grids (KPIs, search)
CREATE OR REPLACE VIEW v_organization_dashboard AS
SELECT
    o.organization_id,
    o.legal_name,
    o.status,
    o.icp_score,
    o.opportunity_tier,
    s.sector_name,
    ss.subsector_name,
    a.city_id,
    c.city_name,
    st.state_name,
    lp.ceo_name, lp.cto_name, lp.cio_name,
    (SELECT value FROM financial_metrics fm
       JOIN metric_definitions md ON md.metric_id = fm.metric_id
       WHERE fm.organization_id = o.organization_id AND md.metric_key = 'revenue'
       ORDER BY fm.fiscal_year DESC LIMIT 1) AS latest_revenue_cr,
    (SELECT value FROM technology_metrics tm
       JOIN metric_definitions md ON md.metric_id = tm.metric_id
       WHERE tm.organization_id = o.organization_id AND md.metric_key = 'it_spend'
       ORDER BY tm.fiscal_year DESC LIMIT 1) AS latest_it_spend_cr,
    o.updated_at
FROM organizations o
LEFT JOIN sectors s ON s.sector_id = o.sector_id
LEFT JOIN subsectors ss ON ss.subsector_id = o.subsector_id
LEFT JOIN addresses a ON a.organization_id = o.organization_id AND a.is_headquarters
LEFT JOIN cities c ON c.city_id = a.city_id
LEFT JOIN states st ON st.state_id = a.state_id
LEFT JOIN leadership_profiles lp ON lp.organization_id = o.organization_id;

-- Opportunity ranking / ICP leaderboard
CREATE OR REPLACE VIEW v_icp_leaderboard AS
SELECT organization_id, legal_name, icp_score, opportunity_tier, status
FROM organizations
WHERE status IN ('QUALIFIED', 'ACTIVE')
ORDER BY icp_score DESC NULLS LAST;

-- Pipeline funnel counts by status (for ops monitoring)
CREATE OR REPLACE VIEW v_pipeline_funnel AS
SELECT status, COUNT(*) AS org_count
FROM organizations
GROUP BY status;

-- Score movers (latest vs previous snapshot)
CREATE OR REPLACE VIEW v_score_movers AS
SELECT DISTINCT ON (organization_id)
       organization_id,
       icp_score AS latest_score,
       LAG(icp_score) OVER (PARTITION BY organization_id ORDER BY recorded_at) AS prev_score,
       recorded_at
FROM score_history
ORDER BY organization_id, recorded_at DESC;

-- =====================================================================
-- 14. SEED REFERENCE DATA
-- =====================================================================

INSERT INTO roles (role_name, description) VALUES
('Admin', 'Full platform access'),
('Analyst', 'Data review & enrichment oversight'),
('Sales', 'Territory, pipeline, and ICP consumption'),
('Viewer', 'Read-only dashboard access');

INSERT INTO permissions (permission_key, description) VALUES
('org.read', 'View organizations'),
('org.write', 'Edit organizations'),
('icp.run', 'Trigger ICP scoring'),
('crawl.trigger', 'Trigger crawl jobs'),
('reports.generate', 'Generate reports');

INSERT INTO sectors (sector_name) VALUES ('BFSI'), ('Manufacturing'), ('Government'), ('Healthcare'), ('Education'), ('Telecom'), ('Retail'), ('Energy');

INSERT INTO subsectors (sector_id, subsector_name) VALUES
(1, 'Private Bank'), (1, 'Public Sector Bank'), (1, 'Foreign Bank'), (1, 'Small Finance Bank'),
(1, 'NBFC'), (1, 'Life Insurance'), (1, 'General Insurance'), (1, 'Health Insurance'),
(1, 'AMC'), (1, 'Karnataka Cooperative Bank'), (1, 'Gujarat Cooperative Bank');

-- =====================================================================
-- End of schema
-- =====================================================================
