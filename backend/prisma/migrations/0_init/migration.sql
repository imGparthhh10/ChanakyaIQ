-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "contact_channel" AS ENUM ('Email', 'Phone', 'LinkedIn', 'Twitter/X', 'Other');

-- CreateEnum
CREATE TYPE "crawl_job_status" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'RETRY');

-- CreateEnum
CREATE TYPE "document_status" AS ENUM ('DOWNLOADED', 'FAILED', 'RETRYING', 'OCR_PENDING', 'OCR_DONE', 'PROCESSED');

-- CreateEnum
CREATE TYPE "document_type" AS ENUM ('Official Website', 'Investor Page', 'Annual Report', 'AGM Report', 'Financial Statement', 'News', 'Government Website', 'RBI Publication', 'Press Release', 'Social Media', 'Sustainability/CSR', 'Career', 'Other');

-- CreateEnum
CREATE TYPE "extraction_status" AS ENUM ('PENDING', 'RUNNING', 'PASSED', 'FAILED', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "metric_category" AS ENUM ('Financial', 'Technology', 'Workforce', 'Digital', 'Security', 'Other');

-- CreateEnum
CREATE TYPE "opportunity_tier" AS ENUM ('Strategic', 'Tier 1', 'Tier 2', 'Tier 3', 'Watchlist');

-- CreateEnum
CREATE TYPE "org_status" AS ENUM ('NEW', 'PENDING', 'IMPORTING', 'DISCOVERING_SOURCES', 'CRAWLING', 'DOCUMENTS_COLLECTED', 'OCR_COMPLETE', 'TRANSLATED', 'EXTRACTING', 'ENTITY_RESOLUTION', 'ENRICHED', 'ICP_RUNNING', 'QUALIFIED', 'ACTIVE', 'REVIEW_QUEUE', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ownership_type" AS ENUM ('Government', 'Private', 'Cooperative', 'Public Listed', 'Foreign', 'Other');

-- CreateEnum
CREATE TYPE "sentiment_label" AS ENUM ('Positive', 'Neutral', 'Negative');

-- CreateTable
CREATE TABLE "addresses" (
    "address_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "organization_id" UUID NOT NULL,
    "address_line" TEXT,
    "city_id" INTEGER,
    "state_id" SMALLINT,
    "pincode" TEXT,
    "is_headquarters" BOOLEAN NOT NULL DEFAULT false,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("address_id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "api_key_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "key_hash" TEXT NOT NULL,
    "label" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),
    "revoked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("api_key_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "audit_id" BIGSERIAL NOT NULL,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "metadata_json" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("audit_id")
);

-- CreateTable
CREATE TABLE "branches" (
    "branch_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "organization_id" UUID NOT NULL,
    "branch_name" TEXT,
    "city_id" INTEGER,
    "state_id" SMALLINT,
    "branch_type" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("branch_id")
);

-- CreateTable
CREATE TABLE "change_history" (
    "change_id" BIGSERIAL NOT NULL,
    "organization_id" UUID NOT NULL,
    "field_name" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "changed_by" TEXT,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_history_pkey" PRIMARY KEY ("change_id")
);

-- CreateTable
CREATE TABLE "cities" (
    "city_id" SERIAL NOT NULL,
    "city_name" TEXT NOT NULL,
    "state_id" SMALLINT NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),

    CONSTRAINT "cities_pkey" PRIMARY KEY ("city_id")
);

-- CreateTable
CREATE TABLE "contact_profiles" (
    "organization_id" UUID NOT NULL,
    "primary_email" TEXT,
    "primary_phone" TEXT,
    "linkedin_url" TEXT,
    "last_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_profiles_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "contact_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "organization_id" UUID NOT NULL,
    "full_name" TEXT,
    "designation" TEXT,
    "channel" "contact_channel" NOT NULL,
    "value" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "source_document_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("contact_id")
);

-- CreateTable
CREATE TABLE "crawl_jobs" (
    "crawl_job_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "organization_id" UUID NOT NULL,
    "crawl_source_id" UUID,
    "status" "crawl_job_status" NOT NULL DEFAULT 'QUEUED',
    "retry_count" SMALLINT NOT NULL DEFAULT 0,
    "max_retries" SMALLINT NOT NULL DEFAULT 3,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crawl_jobs_pkey" PRIMARY KEY ("crawl_job_id")
);

-- CreateTable
CREATE TABLE "crawl_sources" (
    "crawl_source_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "organization_id" UUID NOT NULL,
    "source_type" "document_type" NOT NULL,
    "url" TEXT NOT NULL,
    "discovered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "crawl_sources_pkey" PRIMARY KEY ("crawl_source_id")
);

-- CreateTable
CREATE TABLE "dashboard_cache" (
    "cache_key" TEXT NOT NULL,
    "cache_value" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "dashboard_cache_pkey" PRIMARY KEY ("cache_key")
);

-- CreateTable
CREATE TABLE "dashboard_views" (
    "view_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "view_name" TEXT NOT NULL,
    "view_config_json" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_views_pkey" PRIMARY KEY ("view_id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "chunk_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "document_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "chunk_text" TEXT NOT NULL,
    "token_count" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("chunk_id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "document_version_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "document_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL DEFAULT 1,
    "storage_path" TEXT NOT NULL,
    "checksum" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("document_version_id")
);

-- CreateTable
CREATE TABLE "documents" (
    "document_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "organization_id" UUID NOT NULL,
    "crawl_job_id" UUID,
    "document_type" "document_type" NOT NULL,
    "url" TEXT,
    "file_format" TEXT,
    "storage_path" TEXT NOT NULL,
    "checksum" TEXT,
    "is_scanned" BOOLEAN NOT NULL DEFAULT false,
    "detected_language" TEXT,
    "status" "document_status" NOT NULL DEFAULT 'DOWNLOADED',
    "downloaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "enrichment_jobs" (
    "enrichment_job_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "organization_id" UUID NOT NULL,
    "document_id" UUID,
    "status" "extraction_status" NOT NULL DEFAULT 'PENDING',
    "llm_model" TEXT,
    "prompt_version" TEXT,
    "raw_response_json" JSONB,
    "confidence_score" DECIMAL(5,2),
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrichment_jobs_pkey" PRIMARY KEY ("enrichment_job_id")
);

-- CreateTable
CREATE TABLE "entity_resolutions" (
    "resolution_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "entity_id" UUID NOT NULL,
    "resolved_organization_id" UUID,
    "resolution_method" TEXT,
    "resolved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_resolutions_pkey" PRIMARY KEY ("resolution_id")
);

-- CreateTable
CREATE TABLE "errors" (
    "error_id" BIGSERIAL NOT NULL,
    "organization_id" UUID,
    "worker_name" TEXT,
    "error_type" TEXT,
    "error_message" TEXT NOT NULL,
    "stack_trace" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "errors_pkey" PRIMARY KEY ("error_id")
);

-- CreateTable
CREATE TABLE "extracted_entities" (
    "entity_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "enrichment_job_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_value" TEXT NOT NULL,
    "normalized_value" TEXT,
    "confidence" DECIMAL(5,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extracted_entities_pkey" PRIMARY KEY ("entity_id")
);

-- CreateTable
CREATE TABLE "financial_metrics" (
    "financial_metric_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "organization_id" UUID NOT NULL,
    "metric_id" SMALLINT NOT NULL,
    "fiscal_year" SMALLINT,
    "value" DECIMAL(18,4) NOT NULL,
    "source_document_id" UUID,
    "confidence" DECIMAL(5,2),
    "extracted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_metrics_pkey" PRIMARY KEY ("financial_metric_id")
);

-- CreateTable
CREATE TABLE "financial_profiles" (
    "organization_id" UUID NOT NULL,
    "latest_fiscal_year" SMALLINT,
    "summary" TEXT,
    "last_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_profiles_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "job_history" (
    "job_history_id" BIGSERIAL NOT NULL,
    "worker_name" TEXT NOT NULL,
    "organization_id" UUID,
    "reference_id" UUID,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "details_json" JSONB,

    CONSTRAINT "job_history_pkey" PRIMARY KEY ("job_history_id")
);

-- CreateTable
CREATE TABLE "leadership" (
    "leadership_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "organization_id" UUID NOT NULL,
    "person_name" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "linkedin_url" TEXT,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "start_date" DATE,
    "end_date" DATE,
    "source_document_id" UUID,
    "confidence" DECIMAL(5,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leadership_pkey" PRIMARY KEY ("leadership_id")
);

-- CreateTable
CREATE TABLE "leadership_profiles" (
    "organization_id" UUID NOT NULL,
    "ceo_name" TEXT,
    "cto_name" TEXT,
    "cio_name" TEXT,
    "chairman_name" TEXT,
    "last_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leadership_profiles_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "llm_profiles" (
    "llm_profile_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "enrichment_job_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "profile_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_profiles_pkey" PRIMARY KEY ("llm_profile_id")
);

-- CreateTable
CREATE TABLE "metric_definitions" (
    "metric_id" SMALLSERIAL NOT NULL,
    "metric_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "category" "metric_category" NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'INR_CR',
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "metric_definitions_pkey" PRIMARY KEY ("metric_id")
);

-- CreateTable
CREATE TABLE "news_articles" (
    "article_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "news_source_id" INTEGER,
    "organization_id" UUID,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "published_at" TIMESTAMPTZ(6),
    "body_text" TEXT,
    "document_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_articles_pkey" PRIMARY KEY ("article_id")
);

-- CreateTable
CREATE TABLE "news_entities" (
    "news_entity_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "article_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_value" TEXT NOT NULL,

    CONSTRAINT "news_entities_pkey" PRIMARY KEY ("news_entity_id")
);

-- CreateTable
CREATE TABLE "news_sources" (
    "news_source_id" SERIAL NOT NULL,
    "source_name" TEXT NOT NULL,
    "base_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "news_sources_pkey" PRIMARY KEY ("news_source_id")
);

-- CreateTable
CREATE TABLE "opportunity_tags" (
    "tag_id" SMALLSERIAL NOT NULL,
    "tag_name" TEXT NOT NULL,

    CONSTRAINT "opportunity_tags_pkey" PRIMARY KEY ("tag_id")
);

-- CreateTable
CREATE TABLE "organization_aliases" (
    "alias_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "organization_id" UUID NOT NULL,
    "alias_name" TEXT NOT NULL,
    "alias_type" TEXT,

    CONSTRAINT "organization_aliases_pkey" PRIMARY KEY ("alias_id")
);

-- CreateTable
CREATE TABLE "organization_profiles" (
    "organization_id" UUID NOT NULL,
    "summary" TEXT,
    "products" TEXT[],
    "services" TEXT[],
    "awards" TEXT[],
    "partnerships" TEXT[],
    "digital_initiatives" TEXT[],
    "last_enriched_at" TIMESTAMPTZ(6),

    CONSTRAINT "organization_profiles_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "organization_tags" (
    "organization_id" UUID NOT NULL,
    "tag_id" SMALLINT NOT NULL,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_tags_pkey" PRIMARY KEY ("organization_id","tag_id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "organization_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "legal_name" TEXT NOT NULL,
    "display_name" TEXT,
    "domain" TEXT,
    "sector_id" SMALLINT,
    "subsector_id" SMALLINT,
    "ownership_type" "ownership_type",
    "incorporation_year" SMALLINT,
    "cin_number" TEXT,
    "status" "org_status" NOT NULL DEFAULT 'NEW',
    "source_of_entry" TEXT,
    "is_duplicate_of" UUID,
    "icp_score" DECIMAL(5,2),
    "opportunity_tier" "opportunity_tier",
    "confidence_score" DECIMAL(5,2),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "permission_id" SMALLSERIAL NOT NULL,
    "permission_key" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("permission_id")
);

-- CreateTable
CREATE TABLE "processing_logs" (
    "log_id" BIGSERIAL NOT NULL,
    "organization_id" UUID,
    "stage" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processing_logs_pkey" PRIMARY KEY ("log_id")
);

-- CreateTable
CREATE TABLE "qualification_results" (
    "qualification_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "organization_id" UUID NOT NULL,
    "rule_group_id" INTEGER,
    "is_qualified" BOOLEAN NOT NULL,
    "matched_rules" JSONB,
    "evaluated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qualification_results_pkey" PRIMARY KEY ("qualification_id")
);

-- CreateTable
CREATE TABLE "qualification_rules" (
    "rule_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "rule_group_id" INTEGER NOT NULL,
    "metric_id" SMALLINT NOT NULL,
    "operator" TEXT NOT NULL,
    "threshold_value" DECIMAL(18,4) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "qualification_rules_pkey" PRIMARY KEY ("rule_id")
);

-- CreateTable
CREATE TABLE "reports" (
    "report_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "report_name" TEXT NOT NULL,
    "report_type" TEXT,
    "filter_json" JSONB,
    "generated_file_path" TEXT,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("report_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" SMALLINT NOT NULL,
    "permission_id" SMALLINT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "roles" (
    "role_id" SMALLSERIAL NOT NULL,
    "role_name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("role_id")
);

-- CreateTable
CREATE TABLE "rule_groups" (
    "rule_group_id" SMALLSERIAL NOT NULL,
    "group_name" TEXT NOT NULL,
    "match_logic" TEXT NOT NULL DEFAULT 'ANY',
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "rule_groups_pkey" PRIMARY KEY ("rule_group_id")
);

-- CreateTable
CREATE TABLE "saved_filters" (
    "filter_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "filter_name" TEXT NOT NULL,
    "filter_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_filters_pkey" PRIMARY KEY ("filter_id")
);

-- CreateTable
CREATE TABLE "score_history" (
    "score_history_id" BIGSERIAL NOT NULL,
    "organization_id" UUID NOT NULL,
    "score_model_id" SMALLINT,
    "icp_score" DECIMAL(5,2) NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_history_pkey" PRIMARY KEY ("score_history_id")
);

-- CreateTable
CREATE TABLE "score_models" (
    "score_model_id" SMALLSERIAL NOT NULL,
    "model_name" TEXT NOT NULL,
    "sector_id" SMALLINT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_models_pkey" PRIMARY KEY ("score_model_id")
);

-- CreateTable
CREATE TABLE "score_weights" (
    "score_weight_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "score_model_id" SMALLINT NOT NULL,
    "metric_id" SMALLINT,
    "component_name" TEXT NOT NULL,
    "weight_pct" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "score_weights_pkey" PRIMARY KEY ("score_weight_id")
);

-- CreateTable
CREATE TABLE "sectors" (
    "sector_id" SMALLSERIAL NOT NULL,
    "sector_name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "sectors_pkey" PRIMARY KEY ("sector_id")
);

-- CreateTable
CREATE TABLE "sentiment_scores" (
    "sentiment_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "article_id" UUID NOT NULL,
    "label" "sentiment_label" NOT NULL,
    "score" DECIMAL(4,3),
    "model_used" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sentiment_scores_pkey" PRIMARY KEY ("sentiment_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "session_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "jwt_id" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "ip_address" INET,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "states" (
    "state_id" SMALLSERIAL NOT NULL,
    "state_name" TEXT NOT NULL,
    "is_union_territory" BOOLEAN NOT NULL DEFAULT false,
    "region" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),

    CONSTRAINT "states_pkey" PRIMARY KEY ("state_id")
);

-- CreateTable
CREATE TABLE "subsectors" (
    "subsector_id" SMALLSERIAL NOT NULL,
    "sector_id" SMALLINT NOT NULL,
    "subsector_name" TEXT NOT NULL,

    CONSTRAINT "subsectors_pkey" PRIMARY KEY ("subsector_id")
);

-- CreateTable
CREATE TABLE "technology_metrics" (
    "technology_metric_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "organization_id" UUID NOT NULL,
    "metric_id" SMALLINT NOT NULL,
    "fiscal_year" SMALLINT,
    "value" DECIMAL(18,4) NOT NULL,
    "source_document_id" UUID,
    "confidence" DECIMAL(5,2),
    "extracted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "technology_metrics_pkey" PRIMARY KEY ("technology_metric_id")
);

-- CreateTable
CREATE TABLE "technology_profile_summary" (
    "organization_id" UUID NOT NULL,
    "summary" TEXT,
    "last_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "technology_profile_summary_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "technology_profiles" (
    "tech_profile_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "organization_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "value_text" TEXT NOT NULL,
    "source_document_id" UUID,
    "confidence" DECIMAL(5,2),
    "extracted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "technology_profiles_pkey" PRIMARY KEY ("tech_profile_id")
);

-- CreateTable
CREATE TABLE "tier_history" (
    "tier_history_id" BIGSERIAL NOT NULL,
    "organization_id" UUID NOT NULL,
    "opportunity_tier" "opportunity_tier" NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tier_history_pkey" PRIMARY KEY ("tier_history_id")
);

-- CreateTable
CREATE TABLE "timeline_events" (
    "event_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "organization_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_summary" TEXT NOT NULL,
    "event_date" DATE,
    "old_value" JSONB,
    "new_value" JSONB,
    "source_document_id" UUID,
    "confidence" DECIMAL(5,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timeline_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "translations" (
    "translation_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "document_id" UUID NOT NULL,
    "source_language" TEXT NOT NULL,
    "target_language" TEXT NOT NULL DEFAULT 'en',
    "translated_text" TEXT,
    "translated_storage_path" TEXT,
    "engine" TEXT NOT NULL DEFAULT 'IndicTrans2',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "translations_pkey" PRIMARY KEY ("translation_id")
);

-- CreateTable
CREATE TABLE "users" (
    "user_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role_id" SMALLINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "idx_audit_entity" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_branches_org" ON "branches"("organization_id");

-- CreateIndex
CREATE INDEX "idx_change_history_org" ON "change_history"("organization_id", "changed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "cities_city_name_state_id_key" ON "cities"("city_name", "state_id");

-- CreateIndex
CREATE INDEX "idx_crawl_jobs_org_status" ON "crawl_jobs"("organization_id", "status");

-- CreateIndex
CREATE INDEX "idx_crawl_sources_org" ON "crawl_sources"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_document_id_chunk_index_key" ON "document_chunks"("document_id", "chunk_index");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_number_key" ON "document_versions"("document_id", "version_number");

-- CreateIndex
CREATE INDEX "idx_documents_org_type" ON "documents"("organization_id", "document_type");

-- CreateIndex
CREATE UNIQUE INDEX "documents_organization_id_checksum_key" ON "documents"("organization_id", "checksum");

-- CreateIndex
CREATE INDEX "idx_enrichment_org" ON "enrichment_jobs"("organization_id", "status");

-- CreateIndex
CREATE INDEX "idx_errors_org" ON "errors"("organization_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "idx_entities_job" ON "extracted_entities"("enrichment_job_id");

-- CreateIndex
CREATE INDEX "idx_entities_type" ON "extracted_entities"("entity_type");

-- CreateIndex
CREATE INDEX "idx_fin_metrics_org" ON "financial_metrics"("organization_id", "metric_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_metrics_organization_id_metric_id_fiscal_year_key" ON "financial_metrics"("organization_id", "metric_id", "fiscal_year");

-- CreateIndex
CREATE INDEX "idx_job_history_org" ON "job_history"("organization_id", "started_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "metric_definitions_metric_key_key" ON "metric_definitions"("metric_key");

-- CreateIndex
CREATE INDEX "idx_news_org" ON "news_articles"("organization_id", "published_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_tags_tag_name_key" ON "opportunity_tags"("tag_name");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_domain_key" ON "organizations"("domain");

-- CreateIndex
CREATE INDEX "idx_org_name_trgm" ON "organizations" USING GIN ("legal_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "idx_org_score" ON "organizations"("icp_score" DESC);

-- CreateIndex
CREATE INDEX "idx_org_sector" ON "organizations"("sector_id", "subsector_id");

-- CreateIndex
CREATE INDEX "idx_org_status" ON "organizations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_permission_key_key" ON "permissions"("permission_key");

-- CreateIndex
CREATE INDEX "idx_processing_logs_org" ON "processing_logs"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_qual_results_org" ON "qualification_results"("organization_id", "evaluated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "roles_role_name_key" ON "roles"("role_name");

-- CreateIndex
CREATE UNIQUE INDEX "saved_filters_user_id_filter_name_key" ON "saved_filters"("user_id", "filter_name");

-- CreateIndex
CREATE INDEX "idx_score_history_org_time" ON "score_history"("organization_id", "recorded_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "score_weights_score_model_id_component_name_key" ON "score_weights"("score_model_id", "component_name");

-- CreateIndex
CREATE UNIQUE INDEX "sectors_sector_name_key" ON "sectors"("sector_name");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_jwt_id_key" ON "sessions"("jwt_id");

-- CreateIndex
CREATE UNIQUE INDEX "states_state_name_key" ON "states"("state_name");

-- CreateIndex
CREATE UNIQUE INDEX "subsectors_sector_id_subsector_name_key" ON "subsectors"("sector_id", "subsector_name");

-- CreateIndex
CREATE INDEX "idx_tech_metrics_org" ON "technology_metrics"("organization_id", "metric_id");

-- CreateIndex
CREATE UNIQUE INDEX "technology_metrics_organization_id_metric_id_fiscal_year_key" ON "technology_metrics"("organization_id", "metric_id", "fiscal_year");

-- CreateIndex
CREATE INDEX "idx_tech_profile_org" ON "technology_profiles"("organization_id");

-- CreateIndex
CREATE INDEX "idx_tier_history_org_time" ON "tier_history"("organization_id", "recorded_at" DESC);

-- CreateIndex
CREATE INDEX "idx_timeline_org_date" ON "timeline_events"("organization_id", "event_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("city_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "states"("state_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("city_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "states"("state_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "change_history" ADD CONSTRAINT "change_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cities" ADD CONSTRAINT "cities_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "states"("state_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contact_profiles" ADD CONSTRAINT "contact_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "fk_contacts_doc" FOREIGN KEY ("source_document_id") REFERENCES "documents"("document_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "crawl_jobs" ADD CONSTRAINT "crawl_jobs_crawl_source_id_fkey" FOREIGN KEY ("crawl_source_id") REFERENCES "crawl_sources"("crawl_source_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "crawl_jobs" ADD CONSTRAINT "crawl_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "crawl_sources" ADD CONSTRAINT "crawl_sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dashboard_views" ADD CONSTRAINT "dashboard_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("document_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("document_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_crawl_job_id_fkey" FOREIGN KEY ("crawl_job_id") REFERENCES "crawl_jobs"("crawl_job_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "enrichment_jobs" ADD CONSTRAINT "enrichment_jobs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("document_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "enrichment_jobs" ADD CONSTRAINT "enrichment_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "entity_resolutions" ADD CONSTRAINT "entity_resolutions_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "extracted_entities"("entity_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "entity_resolutions" ADD CONSTRAINT "entity_resolutions_resolved_organization_id_fkey" FOREIGN KEY ("resolved_organization_id") REFERENCES "organizations"("organization_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "errors" ADD CONSTRAINT "errors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "extracted_entities" ADD CONSTRAINT "extracted_entities_enrichment_job_id_fkey" FOREIGN KEY ("enrichment_job_id") REFERENCES "enrichment_jobs"("enrichment_job_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "financial_metrics" ADD CONSTRAINT "financial_metrics_metric_id_fkey" FOREIGN KEY ("metric_id") REFERENCES "metric_definitions"("metric_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "financial_metrics" ADD CONSTRAINT "financial_metrics_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "financial_metrics" ADD CONSTRAINT "fk_finmet_doc" FOREIGN KEY ("source_document_id") REFERENCES "documents"("document_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "financial_profiles" ADD CONSTRAINT "financial_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "job_history" ADD CONSTRAINT "job_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "leadership" ADD CONSTRAINT "fk_leadership_doc" FOREIGN KEY ("source_document_id") REFERENCES "documents"("document_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "leadership" ADD CONSTRAINT "leadership_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "leadership_profiles" ADD CONSTRAINT "leadership_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "llm_profiles" ADD CONSTRAINT "llm_profiles_enrichment_job_id_fkey" FOREIGN KEY ("enrichment_job_id") REFERENCES "enrichment_jobs"("enrichment_job_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "llm_profiles" ADD CONSTRAINT "llm_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "news_articles" ADD CONSTRAINT "news_articles_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("document_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "news_articles" ADD CONSTRAINT "news_articles_news_source_id_fkey" FOREIGN KEY ("news_source_id") REFERENCES "news_sources"("news_source_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "news_articles" ADD CONSTRAINT "news_articles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "news_entities" ADD CONSTRAINT "news_entities_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "news_articles"("article_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "organization_aliases" ADD CONSTRAINT "organization_aliases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "organization_profiles" ADD CONSTRAINT "organization_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "organization_tags" ADD CONSTRAINT "organization_tags_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "organization_tags" ADD CONSTRAINT "organization_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "opportunity_tags"("tag_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_is_duplicate_of_fkey" FOREIGN KEY ("is_duplicate_of") REFERENCES "organizations"("organization_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("sector_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_subsector_id_fkey" FOREIGN KEY ("subsector_id") REFERENCES "subsectors"("subsector_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "processing_logs" ADD CONSTRAINT "processing_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "qualification_results" ADD CONSTRAINT "qualification_results_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "qualification_results" ADD CONSTRAINT "qualification_results_rule_group_id_fkey" FOREIGN KEY ("rule_group_id") REFERENCES "rule_groups"("rule_group_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "qualification_rules" ADD CONSTRAINT "qualification_rules_metric_id_fkey" FOREIGN KEY ("metric_id") REFERENCES "metric_definitions"("metric_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "qualification_rules" ADD CONSTRAINT "qualification_rules_rule_group_id_fkey" FOREIGN KEY ("rule_group_id") REFERENCES "rule_groups"("rule_group_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("permission_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("role_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "score_history" ADD CONSTRAINT "score_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "score_history" ADD CONSTRAINT "score_history_score_model_id_fkey" FOREIGN KEY ("score_model_id") REFERENCES "score_models"("score_model_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "score_models" ADD CONSTRAINT "score_models_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("sector_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "score_weights" ADD CONSTRAINT "score_weights_metric_id_fkey" FOREIGN KEY ("metric_id") REFERENCES "metric_definitions"("metric_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "score_weights" ADD CONSTRAINT "score_weights_score_model_id_fkey" FOREIGN KEY ("score_model_id") REFERENCES "score_models"("score_model_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sentiment_scores" ADD CONSTRAINT "sentiment_scores_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "news_articles"("article_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "subsectors" ADD CONSTRAINT "subsectors_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("sector_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "technology_metrics" ADD CONSTRAINT "fk_techmet_doc" FOREIGN KEY ("source_document_id") REFERENCES "documents"("document_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "technology_metrics" ADD CONSTRAINT "technology_metrics_metric_id_fkey" FOREIGN KEY ("metric_id") REFERENCES "metric_definitions"("metric_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "technology_metrics" ADD CONSTRAINT "technology_metrics_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "technology_profile_summary" ADD CONSTRAINT "technology_profile_summary_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "technology_profiles" ADD CONSTRAINT "fk_techprof_doc" FOREIGN KEY ("source_document_id") REFERENCES "documents"("document_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "technology_profiles" ADD CONSTRAINT "technology_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tier_history" ADD CONSTRAINT "tier_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "documents"("document_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "translations" ADD CONSTRAINT "translations_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("document_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("role_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

