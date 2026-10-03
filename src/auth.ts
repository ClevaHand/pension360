import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { findUserById, publicUser, User } from "./db";

const JWT_SECRET = process.env.JWT_SECRET || "pension360-dev-secret-change-me";

export interface AuthPayload {
  sub: string;
  email: string;
  role: string;
}

export function signToken(user: User): string {
  const payload: AuthPayload = {
    sub: user.id,
    email: user.email,
    role: user.role
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, JWT_SECRET) as AuthPayload;
}

export interface AuthedRequest extends Request {
  user?: ReturnType<typeof publicUser>;
  userId?: string;
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  try {
    const payload = verifyToken(header.slice(7));
    const user = await findUserById(payload.sub);
    if (!user) {
      res.status(401).json({ error: "Account not found." });
      return;
    }
    req.userId = user.id;
    req.user = publicUser(user);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token." });
  }
}

export async function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    next();
    return;
  }
  try {
    const payload = verifyToken(header.slice(7));
    const user = await findUserById(payload.sub);
    if (user) {
      req.userId = user.id;
      req.user = publicUser(user);
    }
  } catch {
    /* ignore bad token for optional routes */
  }
  next();
}
