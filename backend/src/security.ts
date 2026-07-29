import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Response } from 'express';
import { config } from './config.js';
import type { AuthenticatedRequest, SessionUser } from './types.js';

const COOKIE_NAME = 'ecolume_session';

export function hashDeviceToken(token: string): string {
  return crypto.createHmac('sha256', config.JWT_SECRET).update(token).digest('hex');
}

export function safeTokenEqual(expectedHash: string, token: string): boolean {
  const actualHash = hashDeviceToken(token);
  const expected = Buffer.from(expectedHash, 'hex');
  const actual = Buffer.from(actualHash, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signSession(user: SessionUser): string {
  return jwt.sign(user, config.JWT_SECRET, {
    algorithm: 'HS256',
    audience: 'ecolume-admin',
    issuer: 'plxy-ecolume',
    expiresIn: '8h'
  });
}

export function verifySession(token: string): SessionUser {
  return jwt.verify(token, config.JWT_SECRET, {
    algorithms: ['HS256'],
    audience: 'ecolume-admin',
    issuer: 'plxy-ecolume'
  }) as SessionUser;
}

export function setSessionCookie(response: Response, token: string): void {
  response.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.COOKIE_SECURE,
    maxAge: 8 * 60 * 60 * 1000,
    path: '/'
  });
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie(COOKIE_NAME, { path: '/' });
}

export function sessionMiddleware(
  request: AuthenticatedRequest,
  _response: Response,
  next: NextFunction
): void {
  const token = request.cookies?.[COOKIE_NAME] as string | undefined;
  if (token) {
    try {
      request.user = verifySession(token);
    } catch {
      request.user = undefined;
    }
  }
  next();
}

export function requireAuth(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction
): void {
  if (!request.user) {
    if (request.path.startsWith('/api/')) {
      response.status(401).json({ error: 'Authentication required' });
    } else {
      response.redirect('/login');
    }
    return;
  }
  next();
}

export function requireRoles(...roles: SessionUser['role'][]) {
  return (request: AuthenticatedRequest, response: Response, next: NextFunction): void => {
    if (!request.user || !roles.includes(request.user.role)) {
      response.status(403).json({ error: 'Insufficient permission' });
      return;
    }
    next();
  };
}

