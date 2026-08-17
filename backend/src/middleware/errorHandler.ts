import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err instanceof ZodError) {
    // Without this, an unparsed ZodError falls through to the generic
    // 500 branch below, which surfaces its raw JSON issues array
    // (validation/code/path internals) straight to the client instead
    // of a readable message, and as a 500 rather than the 400 a bad
    // request body actually is.
    const message = err.issues.map((issue) => issue.message).join('; ');
    return res.status(400).json({ error: message });
  }
  console.error('[unhandled]', err);
  const message = err instanceof Error ? err.message : 'Internal server error';
  res.status(500).json({ error: message });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `No route: ${req.method} ${req.originalUrl}` });
}
