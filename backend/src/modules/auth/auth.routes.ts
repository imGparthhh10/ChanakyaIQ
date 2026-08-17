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
