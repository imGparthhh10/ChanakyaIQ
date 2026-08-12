"""CLI entry point (`eip-pipeline` after install, or `python -m pipeline.cli`). See
pipeline/README.md for full usage examples.
"""

from __future__ import annotations

import asyncio
from uuid import UUID

import typer
from rich.console import Console
from rich.table import Table

from pipeline.config import get_settings
from pipeline.db.organizations import list_organization_ids_by_status
from pipeline.enums import OrgStatus
from pipeline.orchestrator import status as status_mod
from pipeline.orchestrator.batch import run_batch
from pipeline.orchestrator.pipeline_runner import (
    run_classification_only,
    run_collection_only,
    run_discovery_only,
    run_extraction_only,
    run_for_organization,
    run_icp_only,
    run_processing_only,
)
from pipeline.orchestrator.queue import replay_failed

app = typer.Typer(help="ESDS EIP scraping/enrichment pipeline.")
console = Console()

_STAGE_RUNNERS = {
    "discovery": run_discovery_only,
    "collection": run_collection_only,
    "classification": run_classification_only,
    "processing": run_processing_only,
    "extraction": run_extraction_only,
    "icp": run_icp_only,
}


@app.command()
def run(org: str = typer.Option(..., help="organization_id (UUID)")) -> None:
    """Run the full pipeline (stages 1-9) for one organization."""
    settings = get_settings()
    result = asyncio.run(run_for_organization(UUID(org), settings))
    console.print(result)


@app.command("run-batch")
def run_batch_cmd(
    orgs: str = typer.Option(None, help="comma-separated organization_ids"),
    all_new: bool = typer.Option(False, "--all-new", help="run every organization currently in status=NEW"),
    limit: int = typer.Option(50, help="max organizations when --all-new is used"),
) -> None:
    """Run the full pipeline for several organizations concurrently (bounded by
    PIPELINE_MAX_CONCURRENT_ORGS)."""
    settings = get_settings()
    if all_new:
        from pipeline.db.connection import get_connection

        with get_connection(settings) as conn:
            org_ids = list_organization_ids_by_status(conn, OrgStatus.NEW, limit=limit)
    elif orgs:
        org_ids = [UUID(o.strip()) for o in orgs.split(",") if o.strip()]
    else:
        console.print("[red]Provide --orgs or --all-new.[/red]")
        raise typer.Exit(1)

    if not org_ids:
        console.print("Nothing to run.")
        return

    results = asyncio.run(run_batch(org_ids, settings))
    for r in results:
        console.print(r)


@app.command("run-stage")
def run_stage_cmd(
    org: str = typer.Option(..., help="organization_id (UUID)"),
    stage: str = typer.Option(..., help=f"one of: {', '.join(_STAGE_RUNNERS)}"),
) -> None:
    """Run a single named stage in isolation (for debugging / manual re-runs)."""
    settings = get_settings()
    runner = _STAGE_RUNNERS.get(stage)
    if runner is None:
        console.print(f"[red]Unknown stage '{stage}'. Choose one of: {', '.join(_STAGE_RUNNERS)}[/red]")
        raise typer.Exit(1)

    result = runner(UUID(org), settings)
    if asyncio.iscoroutine(result):
        result = asyncio.run(result)
    console.print(result)


@app.command("replay-failed")
def replay_failed_cmd(org: str = typer.Option(None, help="limit replay to one organization_id")) -> None:
    """Re-attempt every crawl_job still under its retry budget (the 'failed queue')."""
    settings = get_settings()
    org_id = UUID(org) if org else None
    outcomes = asyncio.run(replay_failed(org_id, settings))
    console.print(f"Replayed {len(outcomes)} job(s); {sum(1 for o in outcomes if o.succeeded)} succeeded.")


@app.command()
def status(org: str = typer.Option(None, help="show detail for one organization_id instead of the summary")) -> None:
    """Show pipeline status: org counts by status, or one organization's detail + recent logs."""
    settings = get_settings()
    if org:
        detail = status_mod.organization_detail(UUID(org), settings)
        if detail is None:
            console.print(f"[red]No organization found: {org}[/red]")
            raise typer.Exit(1)
        console.print(detail)
        return

    counts = status_mod.org_status_counts(settings)
    table = Table(title="Organizations by status")
    table.add_column("status")
    table.add_column("count", justify="right")
    for s, c in counts.items():
        table.add_row(s, str(c))
    console.print(table)

    errors = status_mod.recent_errors(settings, limit=10)
    if errors:
        console.print("\n[bold]Recent errors:[/bold]")
        for e in errors:
            console.print(f"  {e['occurred_at']}  {e['worker_name']}  {e['error_type']}: {e['error_message']}")


if __name__ == "__main__":
    app()
