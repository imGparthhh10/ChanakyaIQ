import { createApp } from './app';
import { env } from './config/env';
import { seedAdminUser } from './scripts/seedAdmin';

const app = createApp();

// Wrapped so a seed failure (e.g. DB not reachable yet on a fast restart)
// logs a warning instead of crashing the server — the app is still usable
// for everything except that one admin login until it's retried.
seedAdminUser().catch((err) => {
  console.warn('[seedAdmin] Failed to seed admin user:', err instanceof Error ? err.message : err);
});

app.listen(env.PORT, () => {
  console.log(`[eip-backend] listening on http://localhost:${env.PORT}`);
});
