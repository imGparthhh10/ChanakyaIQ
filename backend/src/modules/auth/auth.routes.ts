import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../config/env';
import { ApiError } from '../../middleware/errorHandler';
import { requireAuth } from '../../middleware/auth';
import { SecurityRepository } from '../security/security.repository';

export const authRoutes = Router();
const security = new SecurityRepository();

// Same first-letter-of-first-two-words convention already used on the
// frontend (company360.js's personRow()) — kept consistent, not reinvented.
function initialsOf(fullName: string) {
  return fullName
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function expiresInToDate(expiresIn: string): Date {
  const match = /^(\d+)([smhd])$/.exec(expiresIn);
  const ms = match
    ? Number(match[1]) * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 's' | 'm' | 'h' | 'd']
    : 24 * 3_600_000; // fallback: 24h, matches the default JWT_EXPIRES_IN
  return new Date(Date.now() + ms);
}

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRoutes.post('/login', async (req, res, next) => {
  try {
    const { email, password } = LoginSchema.parse(req.body);

    const user = await security.findUserByEmail(email);
    // One generic error for "no such user" and "wrong password" — never
    // reveal which, that's how you build a user-enumeration oracle.
    if (!user || !user.isActive) throw new ApiError(401, 'Invalid email or password');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new ApiError(401, 'Invalid email or password');

    const jti = randomUUID();
    const expiresAt = expiresInToDate(env.JWT_EXPIRES_IN);
    const token = jwt.sign({ sub: user.userId, jti }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as any });

    await security.createSession(user.userId, jti, expiresAt, req.ip ?? null);

    res.json({
      token,
      user: { id: user.userId, name: user.fullName, role: user.role.roleName, initials: initialsOf(user.fullName) },
    });
  } catch (err) {
    next(err);
  }
});

const RegisterSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  adminPassword: z.string().min(1),
});

// New accounts are gated behind the primary admin's (SEED_ADMIN_EMAIL)
// current password rather than being open self-signup — this app has no
// invite/approval flow, so the admin password stands in for one. Not
// user enumeration-safe like /login's error (this is an authorization
// gate the caller is expected to know, not a login guess), so it's fine
// to say specifically which check failed.
authRoutes.post('/register', async (req, res, next) => {
  try {
    const { fullName, email, password, adminPassword } = RegisterSchema.parse(req.body);

    if (!env.SEED_ADMIN_EMAIL) throw new ApiError(500, 'Admin account not configured on this server');
    const admin = await security.findUserByEmail(env.SEED_ADMIN_EMAIL);
    if (!admin) throw new ApiError(500, 'Admin account not configured on this server');

    const adminValid = await bcrypt.compare(adminPassword, admin.passwordHash);
    if (!adminValid) throw new ApiError(401, 'Incorrect admin password');

    const existing = await security.findUserByEmail(email);
    if (existing) throw new ApiError(409, 'An account with this email already exists');

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await security.createUser(fullName, email, passwordHash, admin.roleId);

    const jti = randomUUID();
    const expiresAt = expiresInToDate(env.JWT_EXPIRES_IN);
    const token = jwt.sign({ sub: user.userId, jti }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as any });
    await security.createSession(user.userId, jti, expiresAt, req.ip ?? null);

    res.status(201).json({
      token,
      user: { id: user.userId, name: user.fullName, role: admin.role.roleName, initials: initialsOf(user.fullName) },
    });
  } catch (err) {
    next(err);
  }
});

authRoutes.post('/logout', requireAuth, async (req, res, next) => {
  try {
    const header = req.headers.authorization!; // requireAuth already validated this exists
    const token = header.slice('Bearer '.length);
    const claims = jwt.decode(token) as { jti?: string } | null;
    if (claims?.jti) await security.revokeSession(claims.jti);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRoutes.get('/me', requireAuth, (req, res) => {
  const user = req.user!; // requireAuth guarantees this is set
  res.json({ id: user.userId, name: user.fullName, role: user.role, initials: initialsOf(user.fullName) });
});
