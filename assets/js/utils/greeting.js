/**
 * greeting.js — Time-of-day greeting, shared by every "Good morning/
 * afternoon/evening, {name}." surface (Homepage, Digest) so the logic
 * lives in exactly one place instead of being copy-pasted per page.
 *
 * Uses the viewer's local browser clock (new Date().getHours()), not
 * server time, so it's correct for whoever's actually looking at the
 * screen regardless of where the backend is hosted.
 */
export function getTimeBasedGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';   // 00:00–11:59
  if (hour < 17) return 'Good afternoon'; // 12:00–16:59
  return 'Good evening';                  // 17:00–23:59
}
