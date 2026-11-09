import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { classifyCommentSentiment } from "../lib/comment-sentiment";

let directory = "";
let databasePath = "";
let supabaseDatabaseUrl: string | undefined;
let originalFetch: typeof fetch;
const originalAuthEnv: Record<string, string | undefined> = {};
const authUsers = new Map<string, { id: string; email: string; password: string }>();
let authUserSequence = 0;
let service: typeof import("../lib/service");
let security: typeof import("../lib/security");
let workflows: typeof import("../lib/workflows");
let database: typeof import("../lib/db");
let route: typeof import("../app/api/[...path]/route");
let adminId = 0;
let managerId = 0;
let viewerId = 0;

describe("analyse locale du sentiment des commentaires", () => {
  it("distingue les retours positifs, négatifs et neutres", () => {
    assert.equal(classifyCommentSentiment("Merci, équipe excellente et très gentille !"), "positive");
    assert.equal(classifyCommentSentiment("Service décevant, attente longue et problème de réservation."), "negative");
    assert.equal(classifyCommentSentiment("Bonjour, pouvez-vous préciser les horaires ?"), "neutral");
  });

  it("inverse le sens d’un terme après une négation proche", () => {
    assert.equal(classifyCommentSentiment("Je ne suis pas satisfait."), "negative");
    assert.equal(classifyCommentSentiment("Pas de problème, c’était parfait."), "positive");
  });
});

describe("édition des commentaires Meta", () => {
  it("envoie le nouveau texte au commentaire avec le jeton de Page", async () => {
    const originalPageId = process.env.META_PAGE_ID;
    const originalPageToken = process.env.META_PAGE_ACCESS_TOKEN;
    const originalFetchForTest = globalThis.fetch;
    const graphRequests: Array<{ url: string; init?: RequestInit }> = [];
    let commentAuthorId = "123456";
    process.env.META_PAGE_ID = "123456";
    process.env.META_PAGE_ACCESS_TOKEN = "test-page-token";
    globalThis.fetch = (async (input, init) => {
      const requestUrl = String(input);
      graphRequests.push({ url: requestUrl, init });
      if (requestUrl.includes("?fields=")) {
        return Response.json({ id: "123456_789", from: { id: commentAuthorId } });
      }
      return Response.json({ success: true });
    }) as typeof fetch;
    try {
      const { editMetaComment } = await import("../lib/integrations");
      assert.deepEqual(await editMetaComment("123456_789", "Texte corrigé"), { id: "123456_789" });
      assert.equal(graphRequests.length, 2);
      assert.equal(graphRequests[0].url, "https://graph.facebook.com/v27.0/123456_789?fields=id%2Cfrom%7Bid%7D");
      assert.equal(graphRequests[1].url, "https://graph.facebook.com/v27.0/123456_789");
      assert.equal(graphRequests[1].init?.method, "POST");
      assert.equal(new URLSearchParams(String(graphRequests[1].init?.body)).get("message"), "Texte corrigé");
      commentAuthorId = "987654";
      await assert.rejects(editMetaComment("123456_789", "Ne pas modifier"), /Seuls les commentaires publiés par la Page Cabalou/);
      assert.equal(graphRequests.length, 3);
    } finally {
      globalThis.fetch = originalFetchForTest;
      if (originalPageId === undefined) delete process.env.META_PAGE_ID;
      else process.env.META_PAGE_ID = originalPageId;
      if (originalPageToken === undefined) delete process.env.META_PAGE_ACCESS_TOKEN;
      else process.env.META_PAGE_ACCESS_TOKEN = originalPageToken;
    }
  });
});

function cookieHeader(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  return setCookie
    .split(/,\s*(?=[^;,]+=)/)
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

before(async () => {
  supabaseDatabaseUrl = process.env.CABALOU_SUPABASE_DATABASE_URL;
  delete process.env.CABALOU_SUPABASE_DATABASE_URL;
  for (const key of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    originalAuthEnv[key] = process.env[key];
  }
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    const body = init?.body
      ? JSON.parse(String(init.body)) as Record<string, unknown>
      : {};
    if (url.pathname === "/auth/v1/admin/users" && init?.method === "POST") {
      const email = String(body.email).toLowerCase();
      if (authUsers.has(email)) return Response.json({ msg: "already registered" }, { status: 422 });
      const id = `test-auth-${++authUserSequence}`;
      authUsers.set(email, { id, email, password: String(body.password) });
      return Response.json({ id, email });
    }
    if (url.pathname.startsWith("/auth/v1/admin/users/") && init?.method === "DELETE") {
      const id = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      for (const [email, user] of authUsers) if (user.id === id) authUsers.delete(email);
      return new Response(null, { status: 200 });
    }
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
      const user = authUsers.get(String(body.email).toLowerCase());
      if (!user || user.password !== body.password) return Response.json({}, { status: 400 });
      return Response.json({
        access_token: `access-${user.id}`, refresh_token: `refresh-${user.id}`,
        expires_in: 3600, user: { id: user.id, email: user.email },
      });
    }
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
      const id = String(body.refresh_token).replace(/^refresh-/, "");
      const user = [...authUsers.values()].find((item) => item.id === id);
      if (!user) return Response.json({}, { status: 400 });
      return Response.json({
        access_token: `access-${user.id}`, refresh_token: `refresh-${user.id}`,
        expires_in: 3600, user: { id: user.id, email: user.email },
      });
    }
    if (url.pathname === "/auth/v1/user") {
      const token = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "");
      const id = token?.replace(/^access-/, "");
      const user = [...authUsers.values()].find((item) => item.id === id);
      return user
        ? Response.json({ id: user.id, email: user.email })
        : Response.json({}, { status: 401 });
    }
    return Response.json({ message: "Unhandled test auth request" }, { status: 500 });
  }) as typeof fetch;
  directory = await mkdtemp(join(tmpdir(), "cabalou-next-"));
  databasePath = join(directory, "test.sqlite3");
  process.env.CABALOU_DB_PATH = databasePath;
  process.env.CABALOU_SESSION_SECRET = "test-session-secret-0123456789-abcdefgh";
  database = await import("../lib/db");
  service = await import("../lib/service");
  security = await import("../lib/security");
  workflows = await import("../lib/workflows");
  route = await import("../app/api/[...path]/route");
  await service.ensureDatabaseInitialized();
  adminId = await service.createUser(null, {
    username: "admin", email: "admin@example.test", display_name: "Administrateur",
    password: "Password admin local 123!", role: "admin",
  });
  managerId = await service.createUser(adminId, {
    username: "manager", email: "manager@example.test", display_name: "Responsable",
    password: "Password manager 123!", role: "marketing_manager",
  });
  viewerId = await service.createUser(adminId, {
    username: "viewer", email: "viewer@example.test", display_name: "Lecture seule",
    password: "Password viewer 123!", role: "viewer",
  });
});

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  delete process.env.CABALOU_DB_PATH;
  delete process.env.CABALOU_SESSION_SECRET;
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalAuthEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (supabaseDatabaseUrl === undefined) delete process.env.CABALOU_SUPABASE_DATABASE_URL;
  else process.env.CABALOU_SUPABASE_DATABASE_URL = supabaseDatabaseUrl;
});

describe("migration Next Cabalou", () => {
  it("convertit les identifiants PostgreSQL en nombres sûrs", () => {
    assert.equal(database.parsePostgresBigint("42"), 42);
    assert.throws(() => database.parsePostgresBigint("9007199254740992"), /dépasse la plage/);
  });

  it("authentifie le nom d’utilisateur Cabalou par Supabase Auth", async () => {
    assert.equal((await security.authenticate("admin", "Password admin local 123!"))?.user.id, adminId);
    assert.equal(await security.authenticate("admin", "incorrect"), null);
  });

  it("crée les comptes dans Supabase Auth et conserve le nom d’utilisateur", async () => {
    const operatorId = await service.createUser(adminId, {
      username: "short-password", email: "operator@example.test",
      display_name: "Opérateur", password: "Admin123!", role: "operator",
    });
    assert.equal((await security.authenticate("short-password", "Admin123!"))?.user.id, operatorId);
    await assert.rejects(service.createUser(adminId, {
      username: "invalid-email", email: "invalid", display_name: "E-mail invalide",
      password: "Admin123!", role: "operator",
    }), /e-mail est invalide/);
  });

  it("applique les transitions de validation et interdit l’auto-approbation", async () => {
    const post = await service.savePost(adminId, null, {
      title: "Test Cabalou", channel: "facebook", body: "Brouillon", destination_url: "https://cabalou.net/",
    }) as { id: number };
    await service.submitPost(adminId, post.id);
    await assert.rejects(service.reviewPost(adminId, "admin", post.id, true), /créateur ne peut pas approuver/);
    assert.equal((await service.reviewPost(managerId, "marketing_manager", post.id, true) as { status: string }).status, "approved");
    assert.equal((await service.recordManualPublication(managerId, post.id, "https://facebook.com/cabalou/post") as { status: string }).status, "published_manual");
  });

  it("bloque les parcours de réactivation sans base valide et après opposition", async () => {
    const contact = await workflows.createReactivation(adminId, {
      external_ref: "client-ref-001", last_booking_date: "2025-01-10", contact_basis: "pending",
    }) as { id: number };
    await assert.rejects(workflows.act(adminId, "reactivation", contact.id, "contacted", {}), /Aucun suivi n’est autorisé/);
    await workflows.act(adminId, "reactivation", contact.id, "set-basis", { contact_basis: "consent" });
    await workflows.act(adminId, "reactivation", contact.id, "contacted", { note: "Contact manuel" });
    await workflows.act(adminId, "reactivation", contact.id, "opt-out", { note: "Opposition reçue" });
    await assert.rejects(workflows.act(adminId, "reactivation", contact.id, "contacted", {}), /Aucun suivi n’est autorisé/);
  });

  it("exige un consentement pour le retargeting et valide strictement les dates", async () => {
    const prospect = await workflows.createRetargeting(adminId, {
      external_ref: "prospect-ref-01", interest_label: "Séjour urbain", source: "Formulaire",
      consent_confirmed: false,
    }) as { id: number };
    await assert.rejects(workflows.act(adminId, "retargeting", prospect.id, "contacted", {}), /Aucun suivi n’est autorisé/);
    await workflows.act(adminId, "retargeting", prospect.id, "set-basis", { source: "Consentement enregistré" });
    await workflows.act(adminId, "retargeting", prospect.id, "contacted", { note: "Contact autorisé" });
    await assert.rejects(workflows.createGroup(adminId, {
      source_group: "Groupe local", city: "Libreville", request_summary: "Recherche de logement",
      desired_date: "2025-02-31",
    }), /date souhaitée/);
  });

  it("sauvegarde uniquement des rapports et mesures SEO sourcés", async () => {
    const report = await service.saveMonthlyReport(adminId, {
      period: "2025-02", metrics: { social_publications: 4, google_average_position: 3.5 },
      source_note: "Statistiques mensuelles réelles",
    }) as { metrics: Record<string, number> };
    assert.equal(report.metrics.social_publications, 4);
    await assert.rejects(service.saveMonthlyReport(adminId, {
      period: "2025-02", metrics: { social_publications: 1.5 }, source_note: "Source",
    }), /entiers/);

    const metric = await service.saveSeoMetric(adminId, {
      metric_date: "2025-02-01", query_text: "location logement", page_path: "/logements",
      clicks: 10, impressions: 100, average_position: 4.2,
    }) as { source: string; ctr: number };
    assert.equal(metric.source, "manual");
    assert.equal(metric.ctr, 0.1);
    await assert.rejects(service.saveSeoMetric(adminId, {
      metric_date: "2025-02-01", query_text: "autre", page_path: "/",
      clicks: 11, impressions: 10, average_position: 4,
    }), /clics ne peuvent pas dépasser/);
  });

  it("réinitialise l’approbation lors du remplacement ou retrait d’une photo", async () => {
    const post = await service.savePost(adminId, null, {
      title: "Photo test", channel: "facebook", body: "Brouillon", destination_url: "https://cabalou.net/",
    }) as { id: number };
    await service.submitPost(adminId, post.id);
    await service.savePostImage(adminId, post.id, Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]), "image/jpeg");
    assert.equal((await service.getPost(post.id) as { status: string }).status, "draft");
    assert.equal((await service.getPostImage(post.id))?.mime, "image/jpeg");
    await service.deletePostImage(adminId, post.id);
    assert.equal(await service.getPostImage(post.id), null);
  });

  it("masque les coordonnées B2B aux comptes en lecture seule", async () => {
    await workflows.createB2B(adminId, {
      company: "Hôtel Démo", contact_name: "Contact Démo", email: "contact@example.test",
      source: "Demande reçue", legal_basis: "pending",
    });
    const result = (await workflows.listWorkflows(false)).b2b as Record<string, unknown>[];
    assert.equal(result[0].contact_name, "");
    assert.equal(result[0].email, "");
    assert.equal(viewerId > 0, true);
  });

  it("sert la session, refuse l’origine étrangère et protège les mutations par CSRF", async () => {
    const anonymous = await route.GET(new NextRequest("http://127.0.0.1:3000/api/session"));
    assert.deepEqual(await anonymous.json(), { authenticated: false });

    const login = await route.POST(new NextRequest("http://127.0.0.1:3000/api/login", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
      body: JSON.stringify({ username: "admin", password: "Password admin local 123!" }),
    }));
    assert.equal(login.status, 200);
    const authenticated = await login.json() as { csrf: string };
    const cookie = cookieHeader(login);
    assert.match(cookie, /cabalou_session=/);
    assert.match(cookie, /cabalou_access_token=/);
    assert.match(cookie, /cabalou_refresh_token=/);

    const refreshed = await route.GET(new NextRequest("http://127.0.0.1:3000/api/session", {
      headers: { cookie: cookie.replace(/cabalou_access_token=[^;]+/, "cabalou_access_token=expired") },
    }));
    assert.equal(refreshed.status, 200);
    assert.equal((await refreshed.json() as { authenticated: boolean }).authenticated, true);
    assert.match(cookieHeader(refreshed), /cabalou_access_token=access-test-auth-1/);
    assert.match(cookieHeader(refreshed), /cabalou_refresh_token=refresh-test-auth-1/);

    const deniedOrigin = await route.POST(new NextRequest("http://127.0.0.1:3000/api/posts", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3000", cookie, "x-csrf-token": authenticated.csrf, origin: "https://attacker.example" },
      body: JSON.stringify({ title: "Test", channel: "facebook", body: "", destination_url: "https://cabalou.net/" }),
    }));
    assert.equal(deniedOrigin.status, 403);

    const deniedCsrf = await route.POST(new NextRequest("http://127.0.0.1:3000/api/posts", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3000", cookie, origin: "http://127.0.0.1:3000" },
      body: JSON.stringify({ title: "Test", channel: "facebook", body: "", destination_url: "https://cabalou.net/" }),
    }));
    assert.equal(deniedCsrf.status, 403);

    const created = await route.POST(new NextRequest("http://127.0.0.1:3000/api/posts", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3000", cookie, "x-csrf-token": authenticated.csrf, origin: "http://127.0.0.1:3000" },
      body: JSON.stringify({ title: "API test", channel: "facebook", body: "", destination_url: "https://cabalou.net/" }),
    }));
    assert.equal(created.status, 200);
    assert.ok((await created.json() as { post: unknown }).post);

    const duplicateUser = await route.POST(new NextRequest("http://127.0.0.1:3000/api/users", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3000", cookie, "x-csrf-token": authenticated.csrf, origin: "http://127.0.0.1:3000" },
      body: JSON.stringify({ username: "manager", email: "manager@example.test", display_name: "Doublon", password: "Password duplicate 123!", role: "operator" }),
    }));
    assert.equal(duplicateUser.status, 409);

    const viewerLogin = await route.POST(new NextRequest("http://127.0.0.1:3000/api/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "viewer", password: "Password viewer 123!" }),
    }));
    assert.equal(viewerLogin.status, 200);
    const viewerSession = await viewerLogin.json() as { csrf: string };
    const viewerCookie = cookieHeader(viewerLogin);
    const forbidden = await route.POST(new NextRequest("http://127.0.0.1:3000/api/posts", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: viewerCookie, "x-csrf-token": viewerSession.csrf },
      body: JSON.stringify({ title: "Viewer test", channel: "facebook", body: "", destination_url: "https://cabalou.net/" }),
    }));
    assert.equal(forbidden.status, 403);
  });
});
