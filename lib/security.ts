import {
  createHmac,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { connectDatabase, initializeDatabase } from "./db";

export const COOKIE_NAME = "cabalou_session";
export const SESSION_SECONDS = 8 * 60 * 60;
export const ROLES_CAN_EDIT = ["admin", "marketing_manager", "operator"];
const COOKIE_SECRET = process.env.CABALOU_SESSION_SECRET ?? "";
const loginFailures = new Map<string, number[]>();

export type Role = "admin" | "marketing_manager" | "operator" | "viewer";
export type User = {
  id: number;
  username: string;
  display_name: string;
  role: Role;
};
export type Session = { uid: number; csrf: string; exp: number };

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export function enforceLocalBinding(): void {
  const host = process.env.CABALOU_BIND ?? "127.0.0.1";
  if (!["127.0.0.1", "localhost"].includes(host)) {
    throw new Error("Accès local uniquement : utilisez 127.0.0.1/localhost.");
  }
}

function assertSessionConfigured(): void {
  if (COOKIE_SECRET.length < 32) {
    throw new Error("Définissez CABALOU_SESSION_SECRET (au moins 32 caractères) avant le démarrage.");
  }
}

export function enforceSessionConfiguration(): void {
  assertSessionConfigured();
}

function signature(payload: string): string {
  assertSessionConfigured();
  return createHmac("sha256", COOKIE_SECRET).update(payload).digest("base64url");
}

export function createSession(userId: number): { token: string; csrf: string } {
  const csrf = randomBytes(24).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    uid: userId, csrf, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  })).toString("base64url");
  return { token: `${payload}.${signature(payload)}`, csrf };
}

function parseSession(token: string): Session | null {
  const [payload, providedSignature, extra] = token.split(".");
  if (!payload || !providedSignature || extra) return null;
  let actualSignature: Buffer;
  let expectedSignature: Buffer;
  try {
    actualSignature = Buffer.from(providedSignature, "base64url");
    expectedSignature = Buffer.from(signature(payload), "base64url");
  } catch {
    return null;
  }
  if (
    actualSignature.length !== expectedSignature.length
    || !timingSafeEqual(actualSignature, expectedSignature)
  ) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    if (
      !Number.isSafeInteger(value.uid) || typeof value.csrf !== "string"
      || !Number.isSafeInteger(value.exp) || value.exp < Date.now() / 1000
    ) return null;
    return value;
  } catch {
    return null;
  }
}

export async function getSessionFromRequest(request: NextRequest): Promise<{ session: Session; user: User } | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value ?? "";
  const session = parseSession(token);
  if (!session) return null;
  await initializeDatabase();
  const db = connectDatabase();
  try {
    const user = await db.prepare(
      "SELECT id, username, display_name, role, active FROM users WHERE id=?",
    ).get(session.uid) as (User & { active: number }) | undefined;
    if (!user || !user.active) return null;
    const { active: _active, ...publicUser } = user;
    return { session, user: publicUser };
  } finally {
    await db.close();
  }
}

export async function getSessionFromCookies(): Promise<{ session: Session; user: User } | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value ?? "";
  const session = parseSession(token);
  if (!session) return null;
  await initializeDatabase();
  const db = connectDatabase();
  try {
    const user = await db.prepare(
      "SELECT id, username, display_name, role, active FROM users WHERE id=?",
    ).get(session.uid) as (User & { active: number }) | undefined;
    if (!user || !user.active) return null;
    const { active: _active, ...publicUser } = user;
    return { session, user: publicUser };
  } finally {
    await db.close();
  }
}

export async function requireSession(request: NextRequest, csrf = false) {
  const current = await getSessionFromRequest(request);
  if (!current) throw new HttpError(401, "Session expirée. Veuillez vous reconnecter.");
  if (csrf) {
    assertSameOrigin(request);
    const provided = request.headers.get("x-csrf-token") ?? "";
    const left = Buffer.from(provided);
    const right = Buffer.from(current.session.csrf);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new HttpError(403, "Jeton CSRF invalide.");
    }
  }
  return current;
}

export function assertSameOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  try {
    const host = request.headers.get("host");
    const expectedOrigin = host ? `${request.nextUrl.protocol}//${host}` : request.nextUrl.origin;
    if (new URL(origin).origin !== expectedOrigin) {
      throw new HttpError(403, "Origine de requête refusée.");
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(403, "Origine de requête invalide.");
  }
}

export function requireRole(user: User, roles: readonly string[]): void {
  if (!roles.includes(user.role)) throw new HttpError(403, "Action non autorisée pour ce rôle.");
}

export function passwordHash(password: string, salt?: Buffer): { salt: Buffer; hash: Buffer } {
  const actualSalt = salt ?? randomBytes(16);
  return {
    salt: actualSalt,
    hash: pbkdf2Sync(password, actualSalt, 310_000, 32, "sha256"),
  };
}

export async function authenticate(username: string, password: string): Promise<User | null> {
  await initializeDatabase();
  const db = connectDatabase();
  try {
    const row = await db.prepare(
      "SELECT id, username, display_name, role, salt, password_hash FROM users WHERE username=? AND active=1",
    ).get(username) as {
      id: number; username: string; display_name: string; role: Role;
      salt: Uint8Array; password_hash: Uint8Array;
    } | undefined;
    const salt = row ? Buffer.from(row.salt) : Buffer.from("cabalou-invalid-login");
    const expected = row ? Buffer.from(row.password_hash) : Buffer.alloc(32);
    const actual = passwordHash(password.slice(0, 256), salt).hash;
    if (
      !row || password.length > 256 || actual.length !== expected.length
      || !timingSafeEqual(actual, expected)
    ) return null;
    return { id: row.id, username: row.username, display_name: row.display_name, role: row.role };
  } finally {
    await db.close();
  }
}

export function checkLoginRateLimit(key: string): void {
  const now = Date.now();
  const recent = (loginFailures.get(key) ?? []).filter((time) => now - time < 5 * 60_000);
  loginFailures.set(key, recent);
  if (recent.length >= 5) throw new HttpError(429, "Trop de tentatives. Réessayez dans quelques minutes.");
}

export function recordLoginFailure(key: string): void {
  loginFailures.set(key, [...(loginFailures.get(key) ?? []), Date.now()]);
}

export function clearLoginFailures(key: string): void {
  loginFailures.delete(key);
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: 0,
  });
}

export async function addAudit(
  db: ReturnType<typeof connectDatabase>,
  actorId: number | null,
  action: string,
  resourceType: string,
  resourceId: number | string | null,
  details = "",
): Promise<void> {
  await db.prepare(
    `INSERT INTO audit_events (actor_id, action, resource_type, resource_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(actorId, action, resourceType, String(resourceId ?? ""), details.slice(0, 500), utcNow());
}

export function sendError(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof RangeError || error instanceof TypeError || error instanceof SyntaxError) {
    return Response.json({ error: "Requête invalide." }, { status: 400 });
  }
  console.error("Next.js API failure", error);
  return Response.json({ error: "Une erreur interne est survenue." }, { status: 500 });
}
