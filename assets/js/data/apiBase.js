/**
 * apiBase.js — the backend's base URL, in its own module.
 *
 * Split out from data.js so authClient.js can import it without a
 * circular dependency (data.js needs authFetch from authClient.js, and
 * authClient.js needs API_BASE — both can't import directly from each
 * other). data.js re-exports this for existing `from '../data/data.js'`
 * imports elsewhere, so nothing else needs to change.
 */
export const API_BASE = 'http://localhost:4000/api';
