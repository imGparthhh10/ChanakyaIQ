"""A fake BackendClient -- no HTTP call to the Node backend. Stage 9's own repository read-back
(get_icp_outcome) still hits the real (test) database directly, so the test setup must seed
organizations.icp_score / qualification_results itself to make that read-back meaningful --
this fake only replaces the network call to POST /icp/run."""

from __future__ import annotations

from typing import Any


class FakeBackendClient:
    def __init__(self, summary: dict[str, Any] | None = None) -> None:
        self._summary = summary or {"organizationsScored": 1, "qualified": 1, "tagsAssigned": 0, "tierBreakdown": {}}
        self.run_calls = 0

    async def run_icp_scoring(self) -> dict[str, Any]:
        self.run_calls += 1
        return self._summary
