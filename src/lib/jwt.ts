import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import firebaseConfig from '../../firebase-applet-config.json';

const rawSecret =
  process.env.JWT_SECRET ||
  createHmac('sha256', firebaseConfig.projectId)
    .update(firebaseConfig.apiKey)
    .digest('hex');

const secretKey = new TextEncoder().encode(rawSecret);

export interface AppJwtPayload {
  sub: string;
  userId: number;
  email: string;
  role: 'admin' | 'member';
}

export async function signSessionJwt(payload: AppJwtPayload): Promise<string> {
  return new SignJWT({
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setIssuer('verity-vault')
    .setExpirationTime('7d')
    .sign(secretKey);
}

export async function verifySessionJwt(token: string): Promise<AppJwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      issuer: 'verity-vault',
    });
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.userId !== 'number' ||
      typeof payload.email !== 'string' ||
      (payload.role !== 'admin' && payload.role !== 'member')
    ) {
      return null;
    }
    return {
      sub: payload.sub,
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
    };
  } catch {
    return null;
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return timingSafeEqual(keyBuf, derivedBuf);
}
