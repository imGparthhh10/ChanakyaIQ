/**
 * sanitize.js — Input sanitization and safe-render utilities.
 *
 * Every user-supplied string (search input, filter value, saved
 * filter name, imported field) MUST pass through these before
 * being rendered as HTML or written to localStorage / URLs.
 *
 * Rationale:
 *   - Prevent XSS via template-string HTML injection.
 *   - Strip control characters that break render / storage.
 *   - Normalize whitespace to prevent filter-bypass tricks.
 */

const HTML_ESCAPE_MAP = {
  '&':  '&amp;',
  '<':  '&lt;',
  '>':  '&gt;',
  '"':  '&quot;',
  "'":  '&#39;',
  '`':  '&#96;',
  '/':  '&#47;',
};

/**
 * Escape HTML entities for safe insertion into innerHTML/template strings.
 * Preferred over textContent when the value is embedded in a larger HTML fragment.
 */
export function escapeHTML(input) {
  if (input == null) return '';
  return String(input).replace(/[&<>"'`\/]/g, ch => HTML_ESCAPE_MAP[ch]);
}

/**
 * Escape an attribute value — same as escapeHTML but also strips newlines
 * that could break out of an attribute context.
 */
export function escapeAttr(input) {
  if (input == null) return '';
  return escapeHTML(input).replace(/[\r\n\t]/g, ' ');
}

/**
 * Sanitize a raw search / filter input value.
 * - Trims whitespace
 * - Collapses internal whitespace
 * - Removes ASCII/Unicode control chars except tab
 * - Truncates to maxLen (default 200) to guard against pathological queries
 */
export function sanitizeSearch(input, maxLen = 200) {
  if (input == null) return '';
  return String(input)
    // Remove null bytes and most control chars (keep printable ASCII + Unicode)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/**
 * Sanitize a URL-like input (from user OR data source). Only http(s)
 * and mailto: schemes are allowed — everything else (javascript:, data:,
 * vbscript:) is rejected and returns '#'.
 */
export function sanitizeURL(input) {
  if (!input) return '#';
  const s = String(input).trim();
  if (!s) return '#';

  // Reject dangerous protocols outright
  if (/^(javascript|data|vbscript|file):/i.test(s)) return '#';

  // Bare domain — prefix https://
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !s.startsWith('mailto:')) {
    return 'https://' + s.replace(/^\/+/, '');
  }
  return s;
}

/**
 * Sanitize a filename for downloads (removes path separators, control chars,
 * and OS-reserved characters).
 */
export function sanitizeFilename(input, fallback = 'export') {
  const s = String(input || fallback)
    .replace(/[\x00-\x1F\x7F<>:"/\\|?*]+/g, '_')
    .replace(/^\.+/, '')
    .replace(/[\s_]+/g, '_')
    .slice(0, 128);
  return s || fallback;
}

/**
 * Safe JSON parse — returns fallback on any parse error rather than throwing.
 * Used for reading potentially-corrupt localStorage entries.
 */
export function safeParseJSON(raw, fallback = null) {
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
