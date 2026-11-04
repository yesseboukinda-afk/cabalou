import { NextRequest, NextResponse } from "next/server";
import {
  assertSameOrigin, authenticate, checkLoginRateLimit, clearLoginFailures, createSession,
  getSessionFromRequest, HttpError, requireRole, requireSession, setSessionCookie,
  clearSessionCookie, recordLoginFailure, ROLES_CAN_EDIT, type User,
} from "../../../lib/security";
import {
  auditEvents, dashboard, deletePostImage, getPostImage, KPI_DEFINITIONS, latestIntegrationChecks,
  listListings, listPosts, listUsers, monthlyReport, recordAiGeneration, recordIntegrationCheck,
  recordManualPublication, reviewPost, saveMonthlyReport, savePost, savePostImage, saveSeoMetric, seoMetrics,
  submitPost, updateUser,
} from "../../../lib/service";
import { createUser } from "../../../lib/service";
import {
  act, createB2B, createGroup, createReactivation, createRetargeting, createSeoTarget,
  createSocial, groupMatches, listWorkflowEvents, listWorkflows, recordSeoTarget,
} from "../../../lib/workflows";
import { initializeDatabase } from "../../../lib/db";
import { integrationStatus, testIntegration, generateContent } from "../../../lib/integrations";

const JSON_LIMIT = 1_000_000;
const IMAGE_LIMIT = 2_500_000;
const corsSafeHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'none'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "Cache-Control": "no-store",
};

function json(data: unknown, status = 200, headers?: HeadersInit) {
  const merged = new Headers(corsSafeHeaders);
  new Headers(headers).forEach((value, key) => merged.set(key, value));
  return NextResponse.json(data, { status, headers: merged });
}

function pathInfo(request: NextRequest) {
  return new URL(request.url).pathname.split("/").filter(Boolean);
}

function asId(raw: string | undefined) {
  if (!raw || !/^[1-9]\d*$/.test(raw)) throw new HttpError(400, "Identifiant invalide.");
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) throw new HttpError(400, "Identifiant invalide.");
  return id;
}

async function body(request: NextRequest): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isSafeInteger(length) || length < 0 || length > JSON_LIMIT) {
    throw new HttpError(400, "Requête trop volumineuse.");
  }
  if (!length && !request.body) return {};
  const raw = await readBoundedBody(request, JSON_LIMIT);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
  catch { throw new HttpError(400, "Corps JSON invalide."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Le corps JSON doit être un objet.");
  }
  return value as Record<string, unknown>;
}

async function readBoundedBody(request: NextRequest, limit: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new HttpError(400, "Requête trop volumineuse.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

function role(user: User, roles: readonly string[]) {
  requireRole(user, roles);
}

function responseKey(key: string, value: unknown) {
  return { [key]: value };
}

function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function statusError(error: unknown, request: NextRequest) {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  const code = databaseErrorCode(error);
  if (
    code === "23505"
    || (error instanceof Error && /UNIQUE constraint failed/.test(error.message))
  ) {
    const message = new URL(request.url).pathname.startsWith("/api/users")
      ? "Ce nom d’utilisateur existe déjà."
      : "Cette référence existe déjà.";
    return json({ error: message }, 409);
  }
  if (
    ["23502", "23503", "23514"].includes(code ?? "")
    || (error instanceof Error && /SQLITE_CONSTRAINT/.test(error.message))
  ) {
    return json({ error: "Cette opération ne respecte pas les contraintes de données." }, 400);
  }
  console.error("API request failed:", error instanceof Error ? error.name : "UnknownError");
  return json({ error: "Une erreur interne est survenue." }, 500);
}

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();
    const parts = pathInfo(request);
    const path = `/${parts.join("/")}`;
    if (path === "/api/session") {
      const current = await getSessionFromRequest(request);
      return json(current
        ? { authenticated: true, user: current.user, csrf: current.session.csrf }
        : { authenticated: false });
    }

    const { user } = await requireSession(request);
    if (path === "/api/dashboard") return json(await dashboard());
    if (path === "/api/posts") return json({ posts: await listPosts() });
    if (path === "/api/listings") return json({ listings: await listListings() });
    if (path === "/api/seo") return json({ metrics: await seoMetrics(), connected: false });
    if (path === "/api/reports") {
      const month = new URL(request.url).searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
      return json({ definitions: KPI_DEFINITIONS, report: await monthlyReport(month) });
    }
    if (path === "/api/seo/manual") throw new HttpError(405, "Méthode non autorisée.");
    if (path === "/api/users") {
      role(user, ["admin"]);
      return json({ users: await listUsers() });
    }
    if (path === "/api/workflows") return json(await listWorkflows(user.role !== "viewer"));
    if (parts[1] === "workflows" && parts[4] === "events" && parts.length === 5) {
      return json({ events: await listWorkflowEvents(parts[2], asId(parts[3]), user.role !== "viewer") });
    }
    if (path === "/api/integrations") {
      const checks = await latestIntegrationChecks();
      return json({ integrations: integrationStatus().map((item) => ({
        ...item, last_check: checks[item.id] ?? null,
      })) });
    }
    if (path === "/api/audit") {
      role(user, ["admin", "marketing_manager"]);
      return json({ events: await auditEvents() });
    }
    if (parts[1] === "posts" && parts.length === 4 && parts[3] === "image") {
      const image = await getPostImage(asId(parts[2]));
      if (!image) throw new HttpError(404, "Photo introuvable.");
      return new NextResponse(new Uint8Array(image.data), {
        status: 200,
        headers: new Headers({ ...corsSafeHeaders, "Content-Type": image.mime, "Cache-Control": "private, no-store" }),
      });
    }
    if (parts[1] === "workflows" && parts[2] === "groups" && parts[4] === "matches") {
      return json({ listings: await groupMatches(asId(parts[3])) });
    }
    throw new HttpError(404, "Ressource API introuvable.");
  } catch (error) { return statusError(error, request); }
}

export async function POST(request: NextRequest) {
  try {
    await initializeDatabase();
    const parts = pathInfo(request);
    const path = `/${parts.join("/")}`;
    if (path === "/api/login") {
      assertSameOrigin(request);
      checkLoginRateLimit("local");
      const data = await body(request);
      const username = typeof data.username === "string" ? data.username.slice(0, 80) : "";
      const password = typeof data.password === "string" ? data.password : "";
      const user = await authenticate(username, password);
      if (!user) {
        recordLoginFailure("local");
        throw new HttpError(401, "Identifiants invalides.");
      }
      clearLoginFailures("local");
      const session = createSession(user.id);
      const response = json({ authenticated: true, user, csrf: session.csrf });
      setSessionCookie(response, session.token);
      return response;
    }
    const { user } = await requireSession(request, true);
    if (path === "/api/logout") {
      const response = json({ ok: true });
      clearSessionCookie(response);
      return response;
    }
    const data = await body(request);
    if (path === "/api/users") {
      role(user, ["admin"]);
      const id = await createUser(user.id, data);
      const created = (await listUsers()).find((item) => item.id === id);
      return json(responseKey("user", created));
    }
    if (path === "/api/posts") {
      role(user, ROLES_CAN_EDIT);
      return json(responseKey("post", await savePost(user.id, null, data)));
    }
    if (path === "/api/reports") {
      role(user, ROLES_CAN_EDIT);
      return json(responseKey("report", await saveMonthlyReport(user.id, data)));
    }
    if (path === "/api/seo/manual") {
      role(user, ROLES_CAN_EDIT);
      return json(responseKey("metric", await saveSeoMetric(user.id, data)));
    }
    if (path === "/api/ai/generate-content") {
      role(user, ROLES_CAN_EDIT);
      const generated = await generateContent(data);
      await recordAiGeneration(user.id, generated.model, String(data.channel ?? ""), generated.listingId);
      return json(responseKey("generation", generated));
    }
    if (parts[1] === "workflows") {
      role(user, ROLES_CAN_EDIT);
      let result: unknown;
      let key = "workflow";
      if (parts[2] === "seo-targets" && parts.length === 3) {
        result = await createSeoTarget(user.id, data); key = "seo_target";
      } else if (parts[2] === "seo-targets" && parts.length === 4) {
        result = await recordSeoTarget(user.id, asId(parts[3]), data); key = "seo_target";
      } else if (parts.length === 3) {
        const creators: Record<string, (actor: number, input: Record<string, unknown>) => unknown> = {
          social: async (actor, input) => await createSocial(actor, input),
          groups: async (actor, input) => await createGroup(actor, input),
          b2b: async (actor, input) => await createB2B(actor, input),
          reactivation: async (actor, input) => await createReactivation(actor, input),
          retargeting: async (actor, input) => await createRetargeting(actor, input),
        };
        const creator = creators[parts[2]];
        if (!creator) throw new HttpError(400, "Parcours métier inconnu.");
        result = await creator(user.id, data); key = parts[2];
      } else if (parts.length === 5) {
        result = await act(user.id, parts[2], asId(parts[3]), parts[4], data);
      } else throw new HttpError(404, "Ressource API introuvable.");
      return json(responseKey(key, result));
    }
    if (parts[1] === "integrations" && parts[3] === "check" && parts.length === 4) {
      role(user, ["admin"]);
      try {
        const result = await testIntegration(parts[2]);
        await recordIntegrationCheck(user.id, parts[2], true, result.message);
        return json(responseKey("integration", result));
      } catch (error) {
        await recordIntegrationCheck(user.id, parts[2], false, error instanceof Error ? error.message : "Vérification échouée.");
        throw error;
      }
    }
    if (parts[1] === "posts" && parts[3] === "submit" && parts.length === 4) {
      role(user, ROLES_CAN_EDIT);
      return json(responseKey("post", await submitPost(user.id, asId(parts[2]))));
    }
    if (parts[1] === "posts" && parts[3] === "approve" && parts.length === 4) {
      return json(responseKey("post", await reviewPost(user.id, user.role, asId(parts[2]), true)));
    }
    if (parts[1] === "posts" && parts[3] === "reject" && parts.length === 4) {
      const reason = typeof data.reason === "string" ? data.reason : "";
      return json(responseKey("post", await reviewPost(user.id, user.role, asId(parts[2]), false, reason)));
    }
    if (parts[1] === "posts" && parts[3] === "published-manual" && parts.length === 4) {
      role(user, ROLES_CAN_EDIT);
      return json(responseKey("post", await recordManualPublication(user.id, asId(parts[2]), data.published_url)));
    }
    throw new HttpError(404, "Ressource API introuvable.");
  } catch (error) { return statusError(error, request); }
}

export async function PATCH(request: NextRequest) {
  try {
    await initializeDatabase();
    const { user } = await requireSession(request, true);
    const parts = pathInfo(request);
    const data = await body(request);
    if (parts[1] === "users" && parts.length === 3) {
      role(user, ["admin"]);
      return json(responseKey("user", await updateUser(user.id, asId(parts[2]), data)));
    }
    if (parts[1] === "posts" && parts.length === 3) {
      role(user, ROLES_CAN_EDIT);
      return json(responseKey("post", await savePost(user.id, asId(parts[2]), data)));
    }
    throw new HttpError(404, "Ressource API introuvable.");
  } catch (error) { return statusError(error, request); }
}

export async function PUT(request: NextRequest) {
  try {
    await initializeDatabase();
    const { user } = await requireSession(request, true);
    role(user, ROLES_CAN_EDIT);
    const parts = pathInfo(request);
    if (parts[1] !== "posts" || parts.length !== 4 || parts[3] !== "image") {
      throw new HttpError(404, "Ressource API introuvable.");
    }
    const mime = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (mime !== "image/jpeg") throw new HttpError(400, "Envoyez une photo recadrée au format JPEG.");
    const rawLength = request.headers.get("content-length");
    const declaredLength = rawLength === null ? null : Number(rawLength);
    if (declaredLength !== null && (!Number.isSafeInteger(declaredLength) || declaredLength < 4 || declaredLength > IMAGE_LIMIT)) {
      throw new HttpError(400, "La photo doit peser au maximum 2,5 Mo.");
    }
    const bytes = Buffer.from(await readBoundedBody(request, IMAGE_LIMIT));
    if (declaredLength !== null && bytes.length !== declaredLength) throw new HttpError(400, "La photo reçue est incomplète.");
    await savePostImage(user.id, asId(parts[2]), bytes, mime);
    return json({ ok: true });
  } catch (error) { return statusError(error, request); }
}

export async function DELETE(request: NextRequest) {
  try {
    await initializeDatabase();
    const { user } = await requireSession(request, true);
    role(user, ROLES_CAN_EDIT);
    const parts = pathInfo(request);
    if (parts[1] !== "posts" || parts.length !== 4 || parts[3] !== "image") {
      throw new HttpError(404, "Ressource API introuvable.");
    }
    await deletePostImage(user.id, asId(parts[2]));
    return json({ ok: true });
  } catch (error) { return statusError(error, request); }
}
