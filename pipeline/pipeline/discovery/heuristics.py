"""Deterministic, network-free candidate generation. Every function here takes an
OrganizationRef and returns SourceCandidates with a heuristic confidence — no I/O, so this
whole module is unit-testable without a network connection (spec: "Tests must run without
network"). engine.py optionally verifies a subset of these live afterward.
"""

from __future__ import annotations

from urllib.parse import quote_plus

from pipeline.discovery.schema import SourceCandidate
from pipeline.enums import DocumentType
from pipeline.models import OrganizationRef

# Common path segments per document type, tried against the org's own official domain.
# Order matters only for readability; confidence encodes how likely each path is to exist.
_PATH_CANDIDATES: dict[DocumentType, list[tuple[str, float]]] = {
    DocumentType.INVESTOR_PAGE: [
        ("/investors", 0.55),
        ("/investor-relations", 0.5),
        ("/ir", 0.35),
        ("/investors/overview", 0.3),
    ],
    DocumentType.ANNUAL_REPORT: [
        ("/investors/annual-report", 0.5),
        ("/annual-report", 0.45),
        ("/annual-reports", 0.45),
        ("/investors/reports", 0.35),
        ("/reports", 0.3),
    ],
    DocumentType.AGM_REPORT: [
        ("/investors/agm", 0.4),
        ("/agm", 0.35),
        ("/agm-notice", 0.3),
    ],
    DocumentType.SUSTAINABILITY_CSR: [
        ("/csr", 0.45),
        ("/sustainability", 0.45),
        ("/csr-report", 0.35),
        ("/corporate-social-responsibility", 0.3),
    ],
    DocumentType.PRESS_RELEASE: [
        ("/media", 0.45),
        ("/press", 0.45),
        ("/press-releases", 0.4),
        ("/news", 0.35),
        ("/newsroom", 0.35),
    ],
    DocumentType.CAREER: [
        ("/careers", 0.55),
        ("/career", 0.45),
        ("/join-us", 0.25),
    ],
    DocumentType.FINANCIAL_STATEMENT: [
        ("/investors/financial-results", 0.4),
        ("/investors/financials", 0.35),
        ("/financial-results", 0.3),
    ],
}


def _base_url(domain: str) -> str:
    domain = domain.strip().lower()
    if domain.startswith(("http://", "https://")):
        return domain.rstrip("/")
    return f"https://{domain}"


def official_website(org: OrganizationRef) -> SourceCandidate | None:
    if not org.domain:
        return None
    return SourceCandidate(
        organization_id=org.organization_id,
        url=_base_url(org.domain),
        source_type=DocumentType.OFFICIAL_WEBSITE,
        confidence=0.95,
        discovery_method="organizations.domain (direct)",
    )


def domain_path_candidates(org: OrganizationRef) -> list[SourceCandidate]:
    if not org.domain:
        return []
    base = _base_url(org.domain)
    out: list[SourceCandidate] = []
    for doc_type, paths in _PATH_CANDIDATES.items():
        for path, confidence in paths:
            out.append(
                SourceCandidate(
                    organization_id=org.organization_id,
                    url=base + path,
                    source_type=doc_type,
                    confidence=confidence,
                    discovery_method=f"common-path-heuristic:{path}",
                )
            )
    return out


def news_search(org: OrganizationRef) -> SourceCandidate:
    """Not a scrapeable "article" itself — a search results entry point the collection stage
    can expand later. Low confidence: it always resolves, but relevance is unverified."""
    name = org.display_name or org.legal_name
    return SourceCandidate(
        organization_id=org.organization_id,
        url=f"https://news.google.com/search?q={quote_plus(name)}&hl=en-IN&gl=IN",
        source_type=DocumentType.NEWS,
        confidence=0.25,
        discovery_method="news-search-query",
    )


def regulator_sources(org: OrganizationRef) -> list[SourceCandidate]:
    """RBI / SEBI / MCA — regulator portals rarely expose a stable per-company deep link
    without an authenticated session or a form POST, so these are entry points into public
    search/master-data tools, not guaranteed-exact filings. Confidence reflects that: the URL
    itself always resolves, but it's a portal, not a confirmed per-org document."""
    out: list[SourceCandidate] = []
    name = org.display_name or org.legal_name

    # RBI publications/notifications search (banks, NBFCs, payment system operators)
    out.append(
        SourceCandidate(
            organization_id=org.organization_id,
            url=f"https://www.rbi.org.in/Scripts/BS_ViewPubResultView.aspx?q={quote_plus(name)}",
            source_type=DocumentType.RBI_PUBLICATION,
            confidence=0.3,
            discovery_method="rbi-publication-search",
        )
    )

    # MCA company master data — only meaningful with a CIN
    if org.cin_number:
        out.append(
            SourceCandidate(
                organization_id=org.organization_id,
                url="https://www.mca.gov.in/mcafoportal/companyLLPMasterData.do"
                f"?cin={quote_plus(org.cin_number)}",
                source_type=DocumentType.GOVERNMENT_WEBSITE,
                confidence=0.4,
                discovery_method="mca-master-data:cin",
            )
        )

    # SEBI has no dedicated enum value — filed under Government Website like MCA.
    out.append(
        SourceCandidate(
            organization_id=org.organization_id,
            url=f"https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&intmId=&companyName={quote_plus(name)}",
            source_type=DocumentType.GOVERNMENT_WEBSITE,
            confidence=0.2,
            discovery_method="sebi-search",
        )
    )
    return out


def all_candidates(org: OrganizationRef) -> list[SourceCandidate]:
    out: list[SourceCandidate] = []
    website = official_website(org)
    if website:
        out.append(website)
    out.extend(domain_path_candidates(org))
    out.append(news_search(org))
    out.extend(regulator_sources(org))
    return out
