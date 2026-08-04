import { Router } from 'express';
import multer from 'multer';
import { runExcelImport } from './importJob.service';

const upload = multer({ dest: 'uploads/' });
export const importRoutes = Router();

// Accepts an uploaded file for parity with the spec, but the first (and
// current) run mode reads the local data/ folder directly — there is no
// uploaded-file variant of parser.js's EXCEL_FILES list yet, so an uploaded
// file is accepted but not yet wired into a distinct code path.
importRoutes.post('/excel', upload.single('file'), async (_req, res, next) => {
  try {
    const summary = await runExcelImport();
    res.json(summary);
  } catch (err) {
    next(err);
  }
});
