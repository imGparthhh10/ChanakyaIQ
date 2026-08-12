import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { ApiError } from './errorHandler';
import { SecurityRepository } from '../modules/security/security.repository';

const security = new SecurityRepository();

interface AccessTokenClaims {
  sub: string; // userId
  jti: string; // session id — checked against the sessions table so logout
               // actually revokes access, not just deletes a client token
}

/**
 * Protects a route behind a valid, non-revoked session. Verifies the JWT
 * signature/expiry first (cheap, no DB hit for obviously-bad tokens), then
 * checks the sessions table (revoked=false, expiresAt>now) so a logout
 * takes effect immediately even if the JWT itself hasn't expired yet.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new ApiError(401, 'Unauthorized');
    }
    const token = header.slice('Bearer '.length);

    let claims: AccessTokenClaims;
    try {
      claims = jwt.verify(token, env.JWT_SECRET) as AccessTokenClaims;
    } catch {
      throw new ApiError(401, 'Unauthorized');
    }

    const session = await security.findValidSession(claims.jti);
    if (!session || session.userId !== claims.sub) {
      throw new ApiError(401, 'Unauthorized');
    }

    req.user = {
      userId: session.user.userId,
      fullName: session.user.fullName,
      email: session.user.email,
      role: session.user.role.roleName,
    };
    next();
  } catch (err) {
    next(err);
  }
}
