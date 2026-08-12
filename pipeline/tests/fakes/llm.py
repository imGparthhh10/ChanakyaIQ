"""A fake ExtractionEngine -- no Anthropic API call. Returns a fixed, valid ExtractedProfile so
tests can exercise resolution/timeline/profile-merge without a real LLM."""

from __future__ import annotations

from pipeline.extraction.engine import ExtractionResult
from pipeline.extraction.schema import ExtractedProfile, SourcedListItem, SourcedValue


def make_fake_profile(*, revenue: float = 500.0, ceo_name: str = "Jane Doe", fiscal_year: int = 2024) -> ExtractedProfile:
    return ExtractedProfile(
        company_summary=SourcedValue(value="A test BFSI company.", confidence=90, source_chunk_index=0),
        fiscal_year=SourcedValue(value=fiscal_year, confidence=95, source_chunk_index=0),
        revenue_inr_cr=SourcedValue(value=revenue, confidence=92, source_chunk_index=0),
        ceo_name=SourcedValue(value=ceo_name, confidence=88, source_chunk_index=1),
        branch_count=SourcedValue(value=120, confidence=85, source_chunk_index=0),
        technology_stack=[SourcedListItem(value="Core Banking Platform X", confidence=80, source_chunk_index=1)],
        partnerships=[SourcedListItem(value="Acme Fintech Partners", confidence=75, source_chunk_index=2)],
        awards=[SourcedListItem(value="Best Digital Bank 2024", confidence=70, source_chunk_index=2)],
        overall_confidence=87.0,
    )


class FakeExtractionEngine:
    def __init__(self, profile: ExtractedProfile | None = None) -> None:
        self._profile = profile or make_fake_profile()
        self.extract_calls: list[str] = []

    async def extract(self, *, organization_name: str, chunks: list[tuple[int, str]]) -> ExtractionResult:
        self.extract_calls.append(organization_name)
        return ExtractionResult(profile=self._profile, raw_response={"fake": True}, model_name="fake-model")
