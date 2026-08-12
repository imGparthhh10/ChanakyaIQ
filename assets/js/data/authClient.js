/**
 * authClient.js — Session token storage + auth-aware fetch wrapper.
 *
 * Token lives in localStorage (not an httpOnly cookie — matches the
 * backend's "returns a session token" design and this app's existing
 * localStorage-heavy architecture) and is attached to every API request
 * via authFetch(). A 401 from any request means the session is gone
 * (expired, logged out elsewhere, or revoked server-side) — authFetch
 * clears the token and redirects to /login automatically, so callers
 * never have to special-case 401 themselves.
 */

import { bus } from '../utils/eventBus.js';
import { API_BASE } from './apiBase.js';

const TOKEN_KEY = 'chanakyaiq_token';
let _cachedUser = null; // set by login()/me(), read by sidebar.js

// sidebar.js's user block is mounted (via layout.init()) before the auth
// check in dashboard.js's boot() resolves, so it can't just read
// _cachedUser once at render time — it listens for this event instead,
// same pattern as the app's existing identity:change/data:ready events.
function setCachedUser(user) {
  _cachedUser = user;
  bus.emit('auth:change', { user });
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  setCachedUser(null);
}

export function currentUser() {
  return _cachedUser;
}

function redirectToLogin() {
  clearToken();
  if (location.hash !== '#/login') location.hash = '#/login';
}

/**
 * fetch() throws a bare "Failed to fetch" TypeError when a request stalls
 * out at the network level — which happens on this dev machine whenever
 * the enrichment-pipeline crawler (a separate, unrelated project sharing
 * the same host) bursts to 200%+ CPU. That's a transient stall, not a real
 * connectivity problem, so it's worth a couple of quick retries before
 * surfacing it as a hard failure. Deliberately NOT retried: any response
 * that actually reached the server (401, 400, 500, ...) — those are real
 * answers, not network failures, and get returned as-is on the first try.
 */
async function fetchWithRetry(url, opts, retries = 2, delayMs = 700) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, opts);
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
}

/**
 * Auth-aware fetch — attaches the Bearer token if present, and on a 401
 * clears the (now-invalid) token and redirects to /login. Every API call
 * in the app should go through this instead of raw fetch(), so a session
 * expiring/being revoked mid-use always sends the user back to login
 * rather than silently failing.
 */
export async function authFetch(url, opts = {}) {
  const token = getToken();
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const resp = await fetchWithRetry(url, { ...opts, headers });
  if (resp.status === 401) {
    redirectToLogin();
  }
  return resp;
}

/** @returns {Promise<{name:string, role:string, initials:string}>} */
export async function login(email, password) {
  const resp = await fetchWithRetry(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(body.error || `Login failed (HTTP ${resp.status})`);
  }
  setToken(body.token);
  setCachedUser(body.user);
  return body.user;
}

export async function logout() {
  try {
    await authFetch(`${API_BASE}/auth/logout`, { method: 'POST' });
  } catch { /* best-effort — clear the local token regardless */ }
  redirectToLogin();
}

/** Validates the stored token against the server and caches the result. */
export async function me() {
  const token = getToken();
  if (!token) return null;
  try {
    const resp = await authFetch(`${API_BASE}/auth/me`);
    if (!resp.ok) return null;
    const user = await resp.json();
    setCachedUser(user);
    return user;
  } catch {
    return null;
  }
}
