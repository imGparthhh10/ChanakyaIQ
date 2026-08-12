from __future__ import annotations

from pipeline.extraction.schema import ExtractedProfile, SourcedListItem, SourcedValue
from pipeline.resolution.extract_candidates import extract_candidates
from pipeline.resolution.normalize import detect_cloud_providers, normalize_company_name


def test_normalize_company_name_strips_suffixes() -> None:
    assert normalize_company_name("Test Bank Private Limited") == "test bank"
    assert normalize_company_name("Acme Corp.") == "acme"
    assert normalize_company_name("Foo & Co") == "foo"


def test_detect_cloud_providers_finds_known_keywords() -> None:
    assert detect_cloud_providers("Migrated core banking to AWS and uses Azure for DR.") == ["AWS", "Microsoft Azure"]
    assert detect_cloud_providers("No cloud mentioned here.") == []


def test_extract_candidates_covers_person_and_vendor_types() -> None:
    profile = ExtractedProfile(
        ceo_name=SourcedValue(value="Jane Doe", confidence=90, source_chunk_index=1),
        partnerships=[SourcedListItem(value="Acme Partners Ltd", confidence=80, source_chunk_index=2)],
        technology_stack=[SourcedListItem(value="Runs on AWS", confidence=70, source_chunk_index=3)],
        overall_confidence=85,
    )
    candidates = extract_candidates(profile)
    types = {c.entity_type for c in candidates}
    assert "PERSON" in types
    assert "VENDOR" in types
    assert "TECHNOLOGY" in types
    assert "CLOUD_PROVIDER" in types  # detected inside the technology_stack item's text


def test_extract_candidates_empty_profile_yields_nothing() -> None:
    profile = ExtractedProfile(overall_confidence=0)
    assert extract_candidates(profile) == []
