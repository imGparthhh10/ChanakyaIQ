"""Enriched Excel output.

If exactly one .xlsx/.xlsm was found in the input directory, it is
loaded with openpyxl and a new "Enriched Data" sheet is *added* to it --
every existing sheet's formulas, merged cells, autofilters, column
widths/styles, and hidden-sheet flags are left completely untouched
because we never touch them, only append a new sheet. The result is
saved to a new file in the output directory; the original input file is
never opened for writing and is never modified.

If the input was CSV-only (as with the RBI Non-Scheduled Urban
Co-operative Banks list shipped with this pipeline), there is no
original formatting to preserve, so a fresh workbook containing just the
"Enriched Data" sheet is created instead -- this is logged clearly so
it's never mistaken for a preserved original.
"""
from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any

import openpyxl
from openpyxl.styles import Font
from openpyxl.utils.exceptions import InvalidFileException

log = logging.getLogger("db_writer.excel_writer")

ENRICHED_SHEET_NAME = "Enriched Data"
HEADER = [
    "entity_id", "entity_name", "entity_type", "state", "sector", "financial_year", "report_name",
    "source_url", "page_number", "revenue_inr_cr", "revenue_scope", "it_spend_inr_cr",
    "data_centre_spend_inr_cr", "cybersecurity_spend_inr_cr", "cloud_spend_inr_cr",
    "digital_capex_inr_cr", "branch_count", "employee_count", "mentioned_vendors", "icp_score", "written_at",
]


class EnrichedExcelWriter:
    def __init__(self, input_dir: str, output_dir: str, run_id: str | None = None) -> None:
        self.input_dir = Path(input_dir)
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.run_id = run_id or time.strftime("%Y%m%d_%H%M%S")
        self.preserving_original = False
        self._row_count = 0
        self.wb, self.ws, self.output_path = self._init_workbook()

    def _find_single_original_workbook(self) -> Path | None:
        candidates = sorted(list(self.input_dir.glob("*.xlsx")) + list(self.input_dir.glob("*.xlsm")))
        if len(candidates) == 1:
            return candidates[0]
        if len(candidates) > 1:
            log.warning(
                "%d .xlsx/.xlsm files found in %s -- ambiguous which is 'the original', "
                "creating a fresh enriched workbook instead of preserving one of them",
                len(candidates), self.input_dir,
            )
        return None

    def _init_workbook(self):
        original = self._find_single_original_workbook()
        if original is not None:
            try:
                wb = openpyxl.load_workbook(original, keep_vba=(original.suffix.lower() == ".xlsm"))
                self.preserving_original = True
                base_name = original.stem
                log.info("preserving original workbook formatting from %s", original)
            except InvalidFileException as exc:
                log.warning("could not open %s as an Excel workbook (%s) -- creating a fresh one", original, exc)
                wb = openpyxl.Workbook()
                wb.remove(wb.active)
                base_name = "enriched_output"
        else:
            wb = openpyxl.Workbook()
            wb.remove(wb.active)  # start clean -- no original to preserve
            base_name = "enriched_output"
            log.info("no single original .xlsx found in input dir -- creating a fresh enriched workbook")

        if ENRICHED_SHEET_NAME in wb.sheetnames:
            ws = wb[ENRICHED_SHEET_NAME]
            self._row_count = ws.max_row
        else:
            ws = wb.create_sheet(title=ENRICHED_SHEET_NAME)
            ws.append(HEADER)
            for cell in ws[1]:
                cell.font = Font(bold=True)
            ws.freeze_panes = "A2"
            self._row_count = 1

        output_path = self.output_dir / f"{base_name}_enriched_{self.run_id}.xlsx"
        return wb, ws, output_path

    def append_record(self, record: dict[str, Any]) -> None:
        row = [
            record.get("entity_id"), record.get("entity_name"), record.get("entity_type"),
            record.get("state"), record.get("sector"), record.get("financial_year"),
            record.get("report_name"), record.get("source_url"), record.get("page_number"),
            record.get("revenue_inr_cr"), record.get("revenue_scope"), record.get("it_spend_inr_cr"),
            record.get("data_centre_spend_inr_cr"), record.get("cybersecurity_spend_inr_cr"),
            record.get("cloud_spend_inr_cr"), record.get("digital_capex_inr_cr"),
            record.get("branch_count"), record.get("employee_count"),
            ", ".join(record.get("mentioned_vendors") or []), record.get("icp_score"),
            time.strftime("%Y-%m-%d %H:%M:%S"),
        ]
        self.ws.append(row)
        self._row_count += 1

    def save(self) -> None:
        try:
            self.wb.save(self.output_path)
        except Exception:  # noqa: BLE001 - a failed save must not crash the writer/consumer loop
            log.exception("failed to save enriched workbook to %s", self.output_path)
