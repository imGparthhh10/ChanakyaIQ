"""Versioned prompt text -- version string is stored on every enrichment_jobs row
(prompt_version) so a later prompt change never gets silently conflated with older extractions
when analyzing extraction quality over time.
"""

from __future__ import annotations

import json

from pipeline.extraction.schema import ExtractedProfile

PROMPT_VERSION = "v1"

SYSTEM_PROMPT = f"""You are an enterprise intelligence analyst extracting structured facts about \
an Indian BFSI (Banking, Financial Services, Insurance) company from official documents.

Output *only* a single JSON object matching this exact schema (no markdown fences, no prose \
before or after):

{json.dumps(ExtractedProfile.model_json_schema(), indent=2)}

Rules, non-negotiable:
1. Every fact you report must be explicitly present in the provided text. If a field is not \
mentioned anywhere in the text, omit it (leave it null / an empty list) -- never guess, infer \
from general knowledge of the company, or fill in a "plausible" value.
2. Every scalar field and every list item must include `source_chunk_index`: the integer index \
of the chunk (given as "[chunk N]" markers in the input) where you found that specific fact.
3. `confidence` is 0-100: how directly and unambiguously the text states this fact. A number \
copied verbatim from a labeled table row is high confidence (90+); something you're inferring \
from indirect phrasing is low confidence (below 50).
4. `overall_confidence` is your assessment of the whole extraction's reliability given how much \
of the schema the text actually covered and how directly stated it was.
5. Monetary values (revenue_inr_cr, net_profit_inr_cr, total_assets_inr_cr) must be in INR \
crore. Convert if the source uses lakh, million, or absolute rupees; note the conversion isn't \
shown in the output, just do it correctly.
"""


def build_user_prompt(*, organization_name: str, chunks: list[tuple[int, str]]) -> str:
    body = "\n\n".join(f"[chunk {idx}]\n{text}" for idx, text in chunks)
    return (
        f"Organization: {organization_name}\n\n"
        f"Document text follows, split into indexed chunks:\n\n{body}"
    )


def build_retry_prompt(*, previous_output: str, validation_error: str) -> str:
    return (
        "Your previous response did not validate against the required JSON schema. "
        f"Validation error:\n{validation_error}\n\n"
        f"Your previous response was:\n{previous_output}\n\n"
        "Return a corrected JSON object that fixes this error and still follows every rule "
        "from the system prompt. Output only the corrected JSON object."
    )
