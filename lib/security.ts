import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { connectDatabase, initializeDatabase } from "./db";
import {
  getSupabaseAuthUser, refreshSupabaseAuthSession, signInWithPassword,
  type SupabaseAuthSession, type SupabaseAuthTokens,
} from "./supabase-auth";

export const COOKIE_NAME = "cabalou_session";
export const ACCESS_COOKIE_NAME = "cabalou_access_token";
export const REFRESH_COOKIE_NAME = "cabalou_refresh_token";
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

export async function getSessionFromRequest(
  request: NextRequest,
  allowRefresh = false,
): Promise<{ session: Session; user: User; refreshedTokens?: SupabaseAuthTokens } | null> {
  const session = parseSession(request.cookies.get(COOKIE_NAME)?.value ?? "");
  if (!session) return null;
  const accessToken = request.cookies.get(ACCESS_COOKIE_NAME)?.value ?? "";
  const refreshToken = request.cookies.get(REFRESH_COOKIE_NAME)?.value ?? "";
  let authUser = accessToken ? await getSupabaseAuthUser(accessToken) : null;
  let refreshedTokens: SupabaseAuthTokens | undefined;
  if (!authUser && allowRefresh && refreshToken) {
    const refreshed = await refreshSupabaseAuthSession(refreshToken);
    if (refreshed) {
      authUser = refreshed.user;
      refreshedTokens = {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresIn: refreshed.expiresIn,
      };
    }
  }
  if (!authUser) return null;
  await initializeDatabase();
  const db = connectDatabase();
  try {
    const user = await db.prepare(
      "SELECT id, username, display_name, role, active, auth_user_id FROM users WHERE id=?",
    ).get(session.uid) as (User & { active: number; auth_user_id: string }) | undefined;
    if (!user || !user.active || user.auth_user_id !== authUser.id) return null;
    const { active: _active, auth_user_id: _authUserId, ...publicUser } = user;
    return { session, user: publicUser, refreshedTokens };
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

export async function authenticate(username: string, password: string): Promise<{
  user: User;
  auth: SupabaseAuthSession;
} | null> {
  await initializeDatabase();
  const db = connectDatabase();
  try {
    const row = await db.prepare(
      "SELECT id, username, email, display_name, role, auth_user_id FROM users WHERE username=? AND active=1",
    ).get(username) as (User & { email: string; auth_user_id: string }) | undefined;
    if (!row?.email || !row.auth_user_id) return null;
    const auth = await signInWithPassword(row.email, password);
    if (!auth || auth.user.id !== row.auth_user_id) return null;
    const { email: _email, auth_user_id: _authUserId, ...user } = row;
    return { user, auth };
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

export function setSessionCookie(
  response: NextResponse,
  token: string,
  auth: SupabaseAuthTokens,
): void {
  const cookieOptions = {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
  response.cookies.set(COOKIE_NAME, token, {
    maxAge: SESSION_SECONDS,
    ...cookieOptions,
  });
  response.cookies.set(ACCESS_COOKIE_NAME, auth.accessToken, {
    maxAge: Math.max(0, auth.expiresIn),
    ...cookieOptions,
  });
  response.cookies.set(REFRESH_COOKIE_NAME, auth.refreshToken, {
    maxAge: SESSION_SECONDS,
    ...cookieOptions,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  for (const name of [COOKIE_NAME, ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME]) {
    response.cookies.set(name, "", {
      httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production",
      path: "/", maxAge: 0,
    });
  }
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
