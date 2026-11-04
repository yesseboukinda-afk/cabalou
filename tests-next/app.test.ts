import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";

let directory = "";
let databasePath = "";
let service: typeof import("../lib/service");
let security: typeof import("../lib/security");
let workflows: typeof import("../lib/workflows");
let route: typeof import("../app/api/[...path]/route");
let adminId = 0;
let managerId = 0;
let viewerId = 0;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "cabalou-next-"));
  databasePath = join(directory, "test.sqlite3");
  process.env.CABALOU_DB_PATH = databasePath;
  process.env.CABALOU_SESSION_SECRET = "test-session-secret-0123456789-abcdefgh";
  service = await import("../lib/service");
  security = await import("../lib/security");
  workflows = await import("../lib/workflows");
  route = await import("../app/api/[...path]/route");
  service.ensureDatabaseInitialized();
  adminId = service.initAdmin("admin", "Administrateur", "Password admin local 123!");
  managerId = service.createUser(adminId, {
    username: "manager", display_name: "Responsable", password: "Password manager 123!", role: "marketing_manager",
  });
  viewerId = service.createUser(adminId, {
    username: "viewer", display_name: "Lecture seule", password: "Password viewer 123!", role: "viewer",
  });
});

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  delete process.env.CABALOU_DB_PATH;
  delete process.env.CABALOU_SESSION_SECRET;
});

describe("migration Next Cabalou", () => {
  it("authentifie les mots de passe PBKDF2 conservés dans SQLite", () => {
    assert.equal(security.authenticate("admin", "Password admin local 123!")?.id, adminId);
    assert.equal(security.authenticate("admin", "incorrect"), null);
  });

  it("accepte tout mot de passe non vide jusqu’à 256 caractères", () => {
    const shortPasswordUser = service.createUser(adminId, {
      username: "short-password", display_name: "Mot de passe court", password: "Admin123!", role: "operator",
    });
    assert.equal(security.authenticate("short-password", "Admin123!")?.id, shortPasswordUser);
    assert.throws(() => service.createUser(adminId, {
      username: "empty-password", display_name: "Mot de passe vide", password: "", role: "operator",
    }), /obligatoire/);
    assert.throws(() => service.createUser(adminId, {
      username: "long-password", display_name: "Mot de passe trop long", password: "a".repeat(257), role: "operator",
    }), /256 caractères/);
  });

  it("applique les transitions de validation et interdit l’auto-approbation", () => {
    const post = service.savePost(adminId, null, {
      title: "Test Cabalou", channel: "facebook", body: "Brouillon", destination_url: "https://cabalou.net/",
    }) as { id: number };
    service.submitPost(adminId, post.id);
    assert.throws(() => service.reviewPost(adminId, "admin", post.id, true), /créateur ne peut pas approuver/);
    assert.equal((service.reviewPost(managerId, "marketing_manager", post.id, true) as { status: string }).status, "approved");
    assert.equal((service.recordManualPublication(managerId, post.id, "https://facebook.com/cabalou/post") as { status: string }).status, "published_manual");
  });

  it("bloque les parcours de réactivation sans base valide et après opposition", () => {
    const contact = workflows.createReactivation(adminId, {
      external_ref: "client-ref-001", last_booking_date: "2025-01-10", contact_basis: "pending",
    }) as { id: number };
    assert.throws(() => workflows.act(adminId, "reactivation", contact.id, "contacted", {}), /Aucun suivi n’est autorisé/);
    workflows.act(adminId, "reactivation", contact.id, "set-basis", { contact_basis: "consent" });
    workflows.act(adminId, "reactivation", contact.id, "contacted", { note: "Contact manuel" });
    workflows.act(adminId, "reactivation", contact.id, "opt-out", { note: "Opposition reçue" });
    assert.throws(() => workflows.act(adminId, "reactivation", contact.id, "contacted", {}), /Aucun suivi n’est autorisé/);
  });

  it("exige un consentement pour le retargeting et valide strictement les dates", () => {
    const prospect = workflows.createRetargeting(adminId, {
      external_ref: "prospect-ref-01", interest_label: "Séjour urbain", source: "Formulaire",
      consent_confirmed: false,
    }) as { id: number };
    assert.throws(() => workflows.act(adminId, "retargeting", prospect.id, "contacted", {}), /Aucun suivi n’est autorisé/);
    workflows.act(adminId, "retargeting", prospect.id, "set-basis", { source: "Consentement enregistré" });
    workflows.act(adminId, "retargeting", prospect.id, "contacted", { note: "Contact autorisé" });
    assert.throws(() => workflows.createGroup(adminId, {
      source_group: "Groupe local", city: "Libreville", request_summary: "Recherche de logement",
      desired_date: "2025-02-31",
    }), /date souhaitée/);
  });

  it("sauvegarde uniquement des rapports et mesures SEO sourcés", () => {
    const report = service.saveMonthlyReport(adminId, {
      period: "2025-02", metrics: { social_publications: 4, google_average_position: 3.5 },
      source_note: "Statistiques mensuelles réelles",
    }) as { metrics: Record<string, number> };
    assert.equal(report.metrics.social_publications, 4);
    assert.throws(() => service.saveMonthlyReport(adminId, {
      period: "2025-02", metrics: { social_publications: 1.5 }, source_note: "Source",
    }), /entiers/);

    const metric = service.saveSeoMetric(adminId, {
      metric_date: "2025-02-01", query_text: "location logement", page_path: "/logements",
      clicks: 10, impressions: 100, average_position: 4.2,
    }) as { source: string; ctr: number };
    assert.equal(metric.source, "manual");
    assert.equal(metric.ctr, 0.1);
    assert.throws(() => service.saveSeoMetric(adminId, {
      metric_date: "2025-02-01", query_text: "autre", page_path: "/",
      clicks: 11, impressions: 10, average_position: 4,
    }), /clics ne peuvent pas dépasser/);
  });

  it("réinitialise l’approbation lors du remplacement ou retrait d’une photo", () => {
    const post = service.savePost(adminId, null, {
      title: "Photo test", channel: "facebook", body: "Brouillon", destination_url: "https://cabalou.net/",
    }) as { id: number };
    service.submitPost(adminId, post.id);
    service.savePostImage(adminId, post.id, Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]), "image/jpeg");
    assert.equal((service.getPost(post.id) as { status: string }).status, "draft");
    assert.equal(service.getPostImage(post.id)?.mime, "image/jpeg");
    service.deletePostImage(adminId, post.id);
    assert.equal(service.getPostImage(post.id), null);
  });

  it("masque les coordonnées B2B aux comptes en lecture seule", () => {
    workflows.createB2B(adminId, {
      company: "Hôtel Démo", contact_name: "Contact Démo", email: "contact@example.test",
      source: "Demande reçue", legal_basis: "pending",
    });
    const result = workflows.listWorkflows(false).b2b as Record<string, unknown>[];
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
    const cookie = login.headers.get("set-cookie");
    assert.ok(cookie);

    const deniedOrigin = await route.POST(new NextRequest("http://127.0.0.1:3000/api/posts", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3000", cookie: cookie!.split(";")[0], "x-csrf-token": authenticated.csrf, origin: "https://attacker.example" },
      body: JSON.stringify({ title: "Test", channel: "facebook", body: "", destination_url: "https://cabalou.net/" }),
    }));
    assert.equal(deniedOrigin.status, 403);

    const deniedCsrf = await route.POST(new NextRequest("http://127.0.0.1:3000/api/posts", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3000", cookie: cookie!.split(";")[0], origin: "http://127.0.0.1:3000" },
      body: JSON.stringify({ title: "Test", channel: "facebook", body: "", destination_url: "https://cabalou.net/" }),
    }));
    assert.equal(deniedCsrf.status, 403);

    const created = await route.POST(new NextRequest("http://127.0.0.1:3000/api/posts", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3000", cookie: cookie!.split(";")[0], "x-csrf-token": authenticated.csrf, origin: "http://127.0.0.1:3000" },
      body: JSON.stringify({ title: "API test", channel: "facebook", body: "", destination_url: "https://cabalou.net/" }),
    }));
    assert.equal(created.status, 200);
    assert.ok((await created.json() as { post: unknown }).post);

    const viewerLogin = await route.POST(new NextRequest("http://127.0.0.1:3000/api/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "viewer", password: "Password viewer 123!" }),
    }));
    assert.equal(viewerLogin.status, 200);
    const viewerSession = await viewerLogin.json() as { csrf: string };
    const viewerCookie = viewerLogin.headers.get("set-cookie")!;
    const forbidden = await route.POST(new NextRequest("http://127.0.0.1:3000/api/posts", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: viewerCookie.split(";")[0], "x-csrf-token": viewerSession.csrf },
      body: JSON.stringify({ title: "Viewer test", channel: "facebook", body: "", destination_url: "https://cabalou.net/" }),
    }));
    assert.equal(forbidden.status, 403);
  });
});
