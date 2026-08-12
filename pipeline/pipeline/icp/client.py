"""Talks to the Node backend's own (already-implemented, not-stubbed) ICP scoring endpoint.
POST /api/icp/run sits behind requireAuth like every other route -- this client logs in as a
configured service user via the same POST /api/auth/login flow the frontend uses (no separate
auth mechanism invented) and caches the resulting JWT for reuse across calls within one process.
"""

from __future__ import annotations

from typing import Any

import httpx

from pipeline.config import Settings


class BackendAuthNotConfigured(Exception):
    """PIPELINE_SERVICE_EMAIL/PIPELINE_SERVICE_PASSWORD aren't set -- stage 9 can't call the
    backend at all. Caught by the caller and turned into a WARN + REVIEW_QUEUE, never a crash."""


class BackendClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._token: str | None = None

    async def _login(self) -> str:
        if not self._settings.backend_service_email or not self._settings.backend_service_password:
            raise BackendAuthNotConfigured(
                "PIPELINE_SERVICE_EMAIL/PIPELINE_SERVICE_PASSWORD not set -- cannot authenticate "
                "against the backend to call POST /icp/run."
            )
        async with httpx.AsyncClient(timeout=self._settings.backend_request_timeout_s) as client:
            resp = await client.post(
                f"{self._settings.backend_base_url}/auth/login",
                json={
                    "email": self._settings.backend_service_email,
                    "password": self._settings.backend_service_password,
                },
            )
            resp.raise_for_status()
            token: str = resp.json()["token"]
            self._token = token
            return token

    async def run_icp_scoring(self) -> dict[str, Any]:
        token = self._token or await self._login()
        async with httpx.AsyncClient(timeout=self._settings.backend_request_timeout_s) as client:
            resp = await client.post(
                f"{self._settings.backend_base_url}/icp/run",
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code == 401:
                # Session might have expired between calls in a long batch run -- one re-login retry.
                token = await self._login()
                resp = await client.post(
                    f"{self._settings.backend_base_url}/icp/run",
                    headers={"Authorization": f"Bearer {token}"},
                )
            resp.raise_for_status()
            result: dict[str, Any] = resp.json()
            return result
