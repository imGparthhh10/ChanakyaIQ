"""Typed settings, loaded from env / .env — mirrors backend/.env's DATABASE_URL so both the
Node backend and this pipeline point at the same Postgres database without duplicating config.

Every threshold, timeout, retry count, model name, and path the pipeline uses lives here.
Nothing downstream hardcodes a number — see the individual stage modules, which all take a
Settings instance rather than reading os.environ directly.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / "pipeline" / ".env", REPO_ROOT / "backend" / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Database (same Postgres instance the Node backend uses) ---
    database_url: str = Field(alias="DATABASE_URL")
    db_pool_min_size: int = 1
    db_pool_max_size: int = 10

    # --- Node backend (for the ICP handoff stage) ---
    backend_base_url: str = Field(default="http://localhost:4000/api", alias="BACKEND_BASE_URL")
    backend_request_timeout_s: float = 30.0
    # Stage 9 calls POST /api/icp/run, which sits behind requireAuth (JWT + session) exactly
    # like every other protected route -- there is no API-key path wired into the backend's
    # auth middleware, so this pipeline authenticates as a real (service) user via the same
    # POST /api/auth/login flow the frontend uses. See judgment call in pipeline/README.md.
    backend_service_email: str | None = Field(default=None, alias="PIPELINE_SERVICE_EMAIL")
    backend_service_password: str | None = Field(default=None, alias="PIPELINE_SERVICE_PASSWORD")

    # --- Storage ---
    document_storage_root: Path = Field(
        default=REPO_ROOT / "pipeline" / "data" / "documents", alias="PIPELINE_STORAGE_ROOT"
    )

    # --- Crawling / politeness ---
    user_agent: str = Field(
        default="ESDS-EIP-Pipeline/0.1 (+https://esds.co.in; enterprise-intelligence-research; "
        "contact: tanmayee.patil@esds.co.in)",
        alias="PIPELINE_USER_AGENT",
    )
    per_domain_min_interval_s: float = Field(default=2.0, alias="PIPELINE_DOMAIN_INTERVAL_S")
    per_domain_jitter_s: float = Field(default=1.0, alias="PIPELINE_DOMAIN_JITTER_S")
    request_timeout_s: float = Field(default=20.0, alias="PIPELINE_REQUEST_TIMEOUT_S")
    max_fetch_retries: int = Field(default=3, alias="PIPELINE_MAX_FETCH_RETRIES")
    backoff_base_s: float = Field(default=2.0, alias="PIPELINE_BACKOFF_BASE_S")
    max_concurrent_organizations: int = Field(default=3, alias="PIPELINE_MAX_CONCURRENT_ORGS")
    max_concurrent_fetches_per_org: int = Field(default=4, alias="PIPELINE_MAX_CONCURRENT_FETCHES")

    # --- Discovery ---
    discovery_max_sources_per_org: int = Field(default=25, alias="PIPELINE_DISCOVERY_MAX_SOURCES")
    discovery_min_confidence: float = Field(default=0.35, alias="PIPELINE_DISCOVERY_MIN_CONFIDENCE")

    # --- Classification ---
    classification_min_confidence: float = Field(default=0.55, alias="PIPELINE_CLASSIFY_MIN_CONFIDENCE")

    # --- Processing ---
    min_extractable_chars: int = Field(
        default=200, alias="PIPELINE_MIN_EXTRACTABLE_CHARS",
        description="Below this many cleaned characters, a document is routed to manual review "
        "instead of chunked/extracted from — not enough usable text to trust.",
    )
    chunk_target_tokens: int = Field(default=800, alias="PIPELINE_CHUNK_TARGET_TOKENS")
    chunk_overlap_tokens: int = Field(default=80, alias="PIPELINE_CHUNK_OVERLAP_TOKENS")

    # --- LLM extraction ---
    anthropic_api_key: str | None = Field(default=None, alias="ANTHROPIC_API_KEY")
    llm_model: str = Field(default="claude-sonnet-5", alias="PIPELINE_LLM_MODEL")
    llm_max_retries: int = Field(default=2, alias="PIPELINE_LLM_MAX_RETRIES")
    llm_prompt_version: str = Field(default="v1", alias="PIPELINE_PROMPT_VERSION")
    llm_max_chunks_per_document: int = Field(default=12, alias="PIPELINE_LLM_MAX_CHUNKS")

    # --- Entity resolution ---
    resolution_fuzzy_similarity_threshold: float = Field(
        default=0.35, alias="PIPELINE_RESOLUTION_TRGM_THRESHOLD"
    )

    # --- Timeline materiality thresholds (documented, see pipeline/timeline/thresholds.py) ---
    timeline_revenue_change_pct: float = Field(default=10.0, alias="PIPELINE_TL_REVENUE_PCT")
    timeline_hiring_spike_count: int = Field(default=5, alias="PIPELINE_TL_HIRING_COUNT")

    # --- Profile merge ---
    profile_review_confidence_threshold: float = Field(
        default=60.0, alias="PIPELINE_PROFILE_REVIEW_THRESHOLD"
    )

    def storage_root(self) -> Path:
        self.document_storage_root.mkdir(parents=True, exist_ok=True)
        return self.document_storage_root


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()  # type: ignore[call-arg]
    return _settings
