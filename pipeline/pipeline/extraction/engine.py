"""ExtractionEngine: the swappable LLM backend, mirroring backend/src/modules/enrichment/
enrichment.service.ts's own EnrichmentEngine interface + StubEnrichmentEngine convention exactly
-- an unavailable dependency (here: no ANTHROPIC_API_KEY / no `anthropic` package) is isolated
behind this interface, degrades to a stub, and is logged loudly, never silently faked.
"""

from __future__ import annotations

import json
from typing import Any, Protocol

from pydantic import ValidationError

from pipeline.config import Settings
from pipeline.extraction.prompts import (
    PROMPT_VERSION,
    SYSTEM_PROMPT,
    build_retry_prompt,
    build_user_prompt,
)
from pipeline.extraction.schema import ExtractedProfile


class ExtractionValidationFailed(Exception):
    """Raised after the retry budget is exhausted and the model still hasn't produced valid
    JSON -- the caller catches this and routes the enrichment_job to MANUAL_REVIEW."""


class ExtractionResult:
    def __init__(self, profile: ExtractedProfile, raw_response: dict[str, Any], model_name: str) -> None:
        self.profile = profile
        self.raw_response = raw_response
        self.model_name = model_name


class ExtractionEngine(Protocol):
    async def extract(
        self, *, organization_name: str, chunks: list[tuple[int, str]]
    ) -> ExtractionResult: ...


class StubExtractionEngine:
    """No ANTHROPIC_API_KEY / no `anthropic` package -- returns an empty, zero-confidence
    profile rather than crashing or fabricating one. The caller marks the job MANUAL_REVIEW,
    same convention as StubEnrichmentEngine on the Node side."""

    async def extract(self, *, organization_name: str, chunks: list[tuple[int, str]]) -> ExtractionResult:
        return ExtractionResult(
            profile=ExtractedProfile(overall_confidence=0.0),
            raw_response={"stub": True},
            model_name="stub",
        )


class AnthropicExtractionEngine:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def extract(self, *, organization_name: str, chunks: list[tuple[int, str]]) -> ExtractionResult:
        try:
            from anthropic import AsyncAnthropic
        except ImportError as exc:
            raise RuntimeError(
                "anthropic package not installed -- install with `pip install eip-pipeline[llm]`"
            ) from exc

        client = AsyncAnthropic(api_key=self._settings.anthropic_api_key)
        user_prompt = build_user_prompt(organization_name=organization_name, chunks=chunks)

        messages: list[dict[str, Any]] = [{"role": "user", "content": user_prompt}]
        last_raw_text = ""
        last_error = ""

        for attempt in range(self._settings.llm_max_retries + 1):
            response = await client.messages.create(
                model=self._settings.llm_model,
                max_tokens=8192,
                system=[
                    {
                        "type": "text",
                        "text": SYSTEM_PROMPT,
                        "cache_control": {"type": "ephemeral"},  # long, stable -> cache it
                    }
                ],
                messages=messages,
            )
            raw_text = "".join(block.text for block in response.content if block.type == "text")
            last_raw_text = raw_text

            try:
                parsed = _parse_json_object(raw_text)
                profile = ExtractedProfile.model_validate(parsed)
                return ExtractionResult(
                    profile=profile,
                    raw_response={"text": raw_text, "usage": _usage_dict(response)},
                    model_name=self._settings.llm_model,
                )
            except (ValidationError, ValueError) as exc:
                last_error = str(exc)
                if attempt < self._settings.llm_max_retries:
                    messages.append({"role": "assistant", "content": raw_text})
                    messages.append(
                        {"role": "user", "content": build_retry_prompt(previous_output=raw_text, validation_error=last_error)}
                    )

        raise ExtractionValidationFailed(
            f"Extraction did not validate after {self._settings.llm_max_retries + 1} attempts. "
            f"Last error: {last_error}. Last output: {last_raw_text[:2000]}"
        )


def _parse_json_object(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    return json.loads(text.strip())  # type: ignore[no-any-return]


def _usage_dict(response: object) -> dict[str, Any]:
    usage = getattr(response, "usage", None)
    if usage is None:
        return {}
    return {
        "input_tokens": getattr(usage, "input_tokens", None),
        "output_tokens": getattr(usage, "output_tokens", None),
        "cache_read_input_tokens": getattr(usage, "cache_read_input_tokens", None),
    }


def get_extraction_engine(settings: Settings) -> ExtractionEngine:
    if settings.anthropic_api_key:
        return AnthropicExtractionEngine(settings)
    return StubExtractionEngine()


__all__ = [
    "PROMPT_VERSION",
    "AnthropicExtractionEngine",
    "ExtractionEngine",
    "ExtractionResult",
    "ExtractionValidationFailed",
    "StubExtractionEngine",
    "get_extraction_engine",
]
