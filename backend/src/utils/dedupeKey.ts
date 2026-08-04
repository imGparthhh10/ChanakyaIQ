// Re-exports the frontend's own normalizeForDedup/normalizeCategory rather
// than maintaining a second copy — this is the exact function 23 frontend
// files (most importantly workspace/store.js's localStorage keys) depend
// on, so importing it directly guarantees byte-identical behavior instead
// of merely aiming for it.
// @ts-ignore — plain ES module .js file, typed via the casts below
import { normalizeForDedup as _normalizeForDedup, normalizeCategory as _normalizeCategory } from '../../../assets/js/data/validator.js';

export const normalizeForDedup: (name: string) => string = _normalizeForDedup;
export const normalizeCategory: (raw: string) => string = _normalizeCategory;
