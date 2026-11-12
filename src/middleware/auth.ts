import type { NextFunction, Request, Response } from 'express';
import { adminAuth } from '../lib/firebase-admin.ts';
import { verifySessionJwt } from '../lib/jwt.ts';
import { getUserById, upsertGoogleUser, type SafeUser } from '../db/queries.ts';

export interface AuthRequest extends Request {
  user?: SafeUser;
}

export async function verifyAccessToken(token: string): Promise<SafeUser | null> {
  if (!token) return null;

  const jwtPayload = await verifySessionJwt(token);
  if (jwtPayload) {
    return getUserById(jwtPayload.userId);
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    if (!decoded.email) return null;

    const { user } = await upsertGoogleUser({
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name || decoded.email.split('@')[0],
      avatarUrl: decoded.picture ?? null,
    });
    return user;
  } catch {
    return null;
  }
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing bearer token' });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  try {
    const user = await verifyAccessToken(token);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or expired session' });
    }
    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication middleware error:', error);
    return res.status(401).json({ error: 'Unauthorized: Token verification failed' });
  }
};

export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Administrator access required' });
  }
  next();
};
