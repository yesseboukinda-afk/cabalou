import { randomBytes } from "node:crypto";
import { connectDatabase, initializeDatabase } from "./db";
import { addAudit, HttpError, utcNow, ROLES_CAN_EDIT, type Role, type User } from "./security";
import { createSupabaseAuthUser, deleteSupabaseAuthUser } from "./supabase-auth";

export const KPI_DEFINITIONS = [
  { id: "social", label: "Animer nos réseaux", metrics: [
    { key: "social_publications", label: "Publications réalisées", kind: "count" },
    { key: "social_views", label: "Vues", kind: "count" },
    { key: "social_followers", label: "Abonnés", kind: "count" },
    { key: "social_whatsapp_messages", label: "Messages WhatsApp générés", kind: "count" },
  ] },
  { id: "groups", label: "Groupes Facebook", metrics: [
    { key: "groups_requests", label: "Demandes repérées", kind: "count" },
    { key: "groups_responses", label: "Réponses publiées", kind: "count" },
    { key: "groups_contacts", label: "Contacts obtenus", kind: "count" },
  ] },
  { id: "b2b", label: "Prospection des décideurs", metrics: [
    { key: "b2b_emails_sent", label: "E-mails envoyés", kind: "count" },
    { key: "b2b_responses", label: "Réponses reçues", kind: "count" },
    { key: "b2b_qualified_leads", label: "Prospects qualifiés", kind: "count" },
  ] },
  { id: "reactivation", label: "Anciens clients", metrics: [
    { key: "reactivation_clients_contacted", label: "Clients recontactés", kind: "count" },
    { key: "reactivation_responses", label: "Réponses reçues", kind: "count" },
    { key: "reactivation_repeat_bookings", label: "Clients ayant réservé à nouveau", kind: "count" },
  ] },
  { id: "retargeting", label: "Rebound marketing", metrics: [
    { key: "retargeting_prospects_reached", label: "Prospects relancés", kind: "count" },
    { key: "retargeting_bookings", label: "Réservations après relance", kind: "count" },
  ] },
  { id: "google", label: "Positionnement Google", metrics: [
    { key: "google_average_position", label: "Position moyenne sur les recherches suivies", kind: "decimal" },
    { key: "google_organic_visits", label: "Visites venues de Google", kind: "count" },
  ] },
] as const;
export const KPI_METRICS = Object.fromEntries(
  KPI_DEFINITIONS.flatMap((objective) => objective.metrics.map((metric) => [metric.key, metric])),
) as Record<string, { key: string; label: string; kind: string }>;

type JsonObject = Record<string, unknown>;

function text(data: JsonObject, key: string, label: string, max: number, required = true): string {
  const value = data[key] ?? "";
  if (typeof value !== "string") throw new HttpError(400, `Le champ « ${label} » est invalide.`);
  const cleaned = value.trim();
  if (required && !cleaned) throw new HttpError(400, `Le champ « ${label} » est obligatoire.`);
  if (cleaned.length > max) throw new HttpError(400, `Le champ « ${label} » est limité à ${max} caractères.`);
  return cleaned;
}

function publicUser(row: Record<string, unknown>) {
  return { id: row.id, username: row.username, display_name: row.display_name, role: row.role };
}

export async function createUser(actorId: number | null, data: JsonObject): Promise<number> {
  const username = text(data, "username", "nom d’utilisateur", 80);
  const email = text(data, "email", "adresse e-mail", 254).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new HttpError(400, "L’adresse e-mail est invalide.");
  }
  const displayName = text(data, "display_name", "nom affiché", 80);
  const role = text(data, "role", "rôle", 30);
  const password = data.password;
  if (typeof password !== "string" || password.length === 0) {
    throw new HttpError(400, "Le mot de passe est obligatoire.");
  }
  if (password.length > 256) throw new HttpError(400, "Le mot de passe est limité à 256 caractères.");
  if (!["admin", "marketing_manager", "operator", "viewer"].includes(role)) {
    throw new HttpError(400, "Rôle inconnu.");
  }
  const authUser = await createSupabaseAuthUser(email, password, displayName);
  const db = connectDatabase();
  try {
    await db.exec("BEGIN IMMEDIATE");
    const result = await db.prepare(
      `INSERT INTO users (username, email, display_name, role, salt, password_hash, auth_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(username, email, displayName, role, randomBytes(16), randomBytes(32), authUser.id, utcNow());
    const id = Number(result.lastInsertRowid);
    await addAudit(db, actorId, "user.created", "user", id, `username=${username}; role=${role}`);
    await db.exec("COMMIT");
    return id;
  } catch (error) {
    try { await db.exec("ROLLBACK"); } catch { /* transaction may not have started */ }
    await deleteSupabaseAuthUser(authUser.id);
    throw error;
  } finally { await db.close(); }
}

export async function listUsers() {
  const db = connectDatabase();
  try {
    return await db.prepare(
      "SELECT id, username, display_name, role, active, created_at FROM users ORDER BY username COLLATE NOCASE",
    ).all();
  } finally { await db.close(); }
}

export async function updateUser(actorId: number, userId: number, data: JsonObject) {
  const role = text(data, "role", "rôle", 30);
  const active = data.active;
  if (!["admin", "marketing_manager", "operator", "viewer"].includes(role)) {
    throw new HttpError(400, "Rôle inconnu.");
  }
  if (typeof active !== "boolean") throw new HttpError(400, "L’état du compte est invalide.");
  if (actorId === userId && (role !== "admin" || !active)) {
    throw new HttpError(400, "Vous ne pouvez pas retirer vos propres droits d’administration.");
  }
  const db = connectDatabase();
  try {
    await db.exec("BEGIN IMMEDIATE");
    const row = await db.prepare(
      "SELECT id, username, display_name, role, active FROM users WHERE id=?",
    ).get(userId) as { id: number; username: string; display_name: string; role: string; active: number } | undefined;
    if (!row) throw new HttpError(404, "Utilisateur introuvable.");
    if (row.role === "admin" && row.active && (role !== "admin" || !active)) {
      const count = (await db.prepare(
        "SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1",
      ).get() as { count: number }).count;
      if (count <= 1) throw new HttpError(400, "Le dernier administrateur actif ne peut pas être désactivé.");
    }
    await db.prepare("UPDATE users SET role=?, active=? WHERE id=?").run(role, Number(active), userId);
    await addAudit(db, actorId, "user.updated", "user", userId, `role=${role}; active=${Number(active)}`);
    await db.exec("COMMIT");
    return { ...row, role, active: Number(active) };
  } catch (error) {
    try { await db.exec("ROLLBACK"); } catch { /* transaction may already have ended */ }
    throw error;
  } finally { await db.close(); }
}

export async function listListings() {
  const db = connectDatabase();
  try {
    return (await db.prepare(
      "SELECT * FROM listings WHERE is_demo=0 ORDER BY city, name",
    ).all() as Record<string, unknown>[]).map((row) => ({
      id: row.id, external_id: row.external_id, name: row.name, city: row.city,
      neighborhood: row.neighborhood, listing_type: row.listing_type,
      features: String(row.features).split("; "),
      public_url: row.public_url, facts_checked_at: row.facts_checked_at,
    }));
  } finally { await db.close(); }
}

const POST_SELECT = `
  SELECT p.id, p.title, p.channel, p.body, p.destination_url, p.listing_id,
         p.scheduled_date, p.status, p.created_by, p.updated_by, p.approved_by,
         p.approved_at, p.rejection_reason, p.published_by, p.published_at,
         p.published_url, p.version, p.created_at, p.updated_at, p.is_demo,
         p.image_mime, (p.image_data IS NOT NULL) AS has_image,
         l.name AS listing_name, u.display_name AS creator_name
  FROM posts p LEFT JOIN listings l ON l.id=p.listing_id
  LEFT JOIN users u ON u.id=p.created_by`;

export async function listPosts() {
  const db = connectDatabase();
  try {
    return await db.prepare(`${POST_SELECT} WHERE p.is_demo=0 ORDER BY
      CASE p.status WHEN 'pending' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
      COALESCE(p.scheduled_date, '9999-12-31'), p.updated_at DESC`).all();
  } finally { await db.close(); }
}

export async function getPost(id: number) {
  const db = connectDatabase();
  try {
    return await db.prepare(`${POST_SELECT} WHERE p.id=? AND p.is_demo=0`).get(id) ?? null;
  } finally { await db.close(); }
}

function validateHttpsUrl(value: unknown, label: string, max = 2048): string {
  if (typeof value !== "string" || value.length > max) throw new HttpError(400, `${label} invalide.`);
  let url: URL;
  try { url = new URL(value); } catch { throw new HttpError(400, `${label} doit être une URL HTTPS valide.`); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    throw new HttpError(400, `${label} doit être une URL HTTPS valide.`);
  }
  return value;
}

export async function savePost(actorId: number, id: number | null, data: JsonObject) {
  const title = text(data, "title", "titre", 160);
  const channel = text(data, "channel", "canal", 20).toLowerCase();
  const body = text(data, "body", "texte", 5000, false);
  const destination = validateHttpsUrl(data.destination_url ?? "https://cabalou.net/", "Le lien de destination");
  const scheduledDate = text(data, "scheduled_date", "date souhaitée", 10, false) || null;
  if (!["facebook", "tiktok"].includes(channel)) throw new HttpError(400, "Le canal doit être Facebook ou TikTok.");
  if (scheduledDate) {
    const parsedDate = new Date(`${scheduledDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)
      || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== scheduledDate) {
      throw new HttpError(400, "La date souhaitée doit être au format AAAA-MM-JJ.");
    }
  }
  let listingId: number | null = null;
  if (data.listing_id !== undefined && data.listing_id !== null && data.listing_id !== "") {
    listingId = Number(data.listing_id);
    if (!Number.isSafeInteger(listingId) || listingId < 1) throw new HttpError(400, "Logement invalide.");
    const db = connectDatabase();
    try {
      if (!await db.prepare("SELECT 1 FROM listings WHERE id=? AND is_demo=0").get(listingId)) {
        throw new HttpError(400, "Logement introuvable.");
      }
    } finally { await db.close(); }
  }
  const db = connectDatabase();
  try {
    const now = utcNow();
    if (id === null) {
      const result = await db.prepare(
        `INSERT INTO posts (title, channel, body, destination_url, listing_id, scheduled_date,
         status, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      ).run(title, channel, body, destination, listingId, scheduledDate, actorId, actorId, now, now);
      const postId = Number(result.lastInsertRowid);
      await addAudit(db, actorId, "post.created", "post", postId);
      return await getPost(postId);
    }
    const current = await db.prepare(
      "SELECT status FROM posts WHERE id=? AND is_demo=0",
    ).get(id) as { status: string } | undefined;
    if (!current) throw new HttpError(404, "Contenu introuvable.");
    if (current.status === "published_manual") throw new HttpError(400, "Une publication consignée ne peut plus être modifiée.");
    const newStatus = ["pending", "approved"].includes(current.status) ? "draft" : current.status;
    await db.prepare(
      `UPDATE posts SET title=?, channel=?, body=?, destination_url=?, listing_id=?,
       scheduled_date=?, status=?, updated_by=?, approved_by=NULL, approved_at=NULL,
       rejection_reason=NULL, version=version+1, updated_at=? WHERE id=?`,
    ).run(title, channel, body, destination, listingId, scheduledDate, newStatus, actorId, now, id);
    await addAudit(db, actorId, "post.updated", "post", id);
    return await getPost(id);
  } finally { await db.close(); }
}

export async function submitPost(actorId: number, id: number) {
  const db = connectDatabase();
  try {
    const row = await db.prepare("SELECT status FROM posts WHERE id=? AND is_demo=0").get(id) as { status: string } | undefined;
    if (!row) throw new HttpError(404, "Contenu introuvable.");
    if (!["draft", "rejected"].includes(row.status)) throw new HttpError(400, "Seul un brouillon ou un contenu rejeté peut être soumis.");
    await db.prepare("UPDATE posts SET status='pending', rejection_reason=NULL, updated_by=?, updated_at=? WHERE id=?").run(actorId, utcNow(), id);
    await addAudit(db, actorId, "post.submitted", "post", id);
    return await getPost(id);
  } finally { await db.close(); }
}

export async function reviewPost(actorId: number, role: Role, id: number, approve: boolean, reason = "") {
  if (!["admin", "marketing_manager"].includes(role)) throw new HttpError(403, "Seuls les administrateurs et responsables marketing valident.");
  if (!approve && !reason.trim()) throw new HttpError(400, "Un motif est obligatoire pour rejeter un contenu.");
  const db = connectDatabase();
  try {
    const row = await db.prepare("SELECT status, created_by FROM posts WHERE id=? AND is_demo=0").get(id) as { status: string; created_by: number } | undefined;
    if (!row) throw new HttpError(404, "Contenu introuvable.");
    if (row.status !== "pending") throw new HttpError(400, "Le contenu n’est pas en attente de validation.");
    if (row.created_by === actorId) throw new HttpError(403, "Le créateur ne peut pas approuver son propre contenu.");
    const now = utcNow();
    if (approve) {
      await db.prepare(`UPDATE posts SET status='approved', approved_by=?, approved_at=?,
        rejection_reason=NULL, updated_by=?, updated_at=? WHERE id=?`).run(actorId, now, actorId, now, id);
      await addAudit(db, actorId, "post.approved", "post", id);
    } else {
      const cleanedReason = reason.trim().slice(0, 500);
      await db.prepare(`UPDATE posts SET status='rejected', approved_by=NULL, approved_at=NULL,
        rejection_reason=?, updated_by=?, updated_at=? WHERE id=?`).run(cleanedReason, actorId, now, id);
      await addAudit(db, actorId, "post.rejected", "post", id, cleanedReason);
    }
    return await getPost(id);
  } finally { await db.close(); }
}

export async function recordManualPublication(actorId: number, id: number, value: unknown) {
  const url = validateHttpsUrl(value, "L’URL de publication");
  const db = connectDatabase();
  try {
    const row = await db.prepare("SELECT status FROM posts WHERE id=? AND is_demo=0").get(id) as { status: string } | undefined;
    if (!row) throw new HttpError(404, "Contenu introuvable.");
    if (row.status !== "approved") throw new HttpError(400, "Seul un contenu approuvé peut être consigné comme publié.");
    const now = utcNow();
    await db.prepare(`UPDATE posts SET status='published_manual', published_by=?, published_at=?,
      published_url=?, updated_by=?, updated_at=? WHERE id=?`).run(actorId, now, url, actorId, now, id);
    await addAudit(db, actorId, "post.published_manual", "post", id);
    return await getPost(id);
  } finally { await db.close(); }
}

export async function getPostImage(id: number) {
  const db = connectDatabase();
  try {
    const row = await db.prepare("SELECT image_data, image_mime FROM posts WHERE id=? AND is_demo=0").get(id) as { image_data: Uint8Array; image_mime: string } | undefined;
    return row?.image_data && row.image_mime === "image/jpeg"
      ? { data: Buffer.from(row.image_data), mime: row.image_mime } : null;
  } finally { await db.close(); }
}

export async function savePostImage(actorId: number, id: number, bytes: Buffer, mime: string) {
  if (mime !== "image/jpeg" || bytes.length < 4 || bytes.length > 2_500_000
    || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
    throw new HttpError(400, "La photo recadrée doit être un JPEG valide de 2,5 Mo maximum.");
  }
  const db = connectDatabase();
  try {
    const row = await db.prepare("SELECT status FROM posts WHERE id=? AND is_demo=0").get(id) as { status: string } | undefined;
    if (!row) throw new HttpError(404, "Contenu introuvable.");
    if (row.status === "published_manual") throw new HttpError(400, "Une publication consignée ne peut plus être modifiée.");
    await db.prepare(`UPDATE posts SET image_data=?, image_mime=?,
      status=CASE WHEN status IN ('pending','approved') THEN 'draft' ELSE status END,
      approved_by=NULL, approved_at=NULL, rejection_reason=NULL, updated_by=?,
      version=version+1, updated_at=? WHERE id=?`).run(bytes, mime, actorId, utcNow(), id);
    await addAudit(db, actorId, "post.image_added", "post", id, `format=jpeg; size=${bytes.length}`);
  } finally { await db.close(); }
}

export async function deletePostImage(actorId: number, id: number) {
  const db = connectDatabase();
  try {
    const row = await db.prepare("SELECT status, image_data FROM posts WHERE id=? AND is_demo=0").get(id) as { status: string; image_data: Uint8Array | null } | undefined;
    if (!row) throw new HttpError(404, "Contenu introuvable.");
    if (row.status === "published_manual") throw new HttpError(400, "Une publication consignée ne peut plus être modifiée.");
    if (!row.image_data) return;
    await db.prepare(`UPDATE posts SET image_data=NULL, image_mime=NULL,
      status=CASE WHEN status IN ('pending','approved') THEN 'draft' ELSE status END,
      approved_by=NULL, approved_at=NULL, rejection_reason=NULL, updated_by=?,
      version=version+1, updated_at=? WHERE id=?`).run(actorId, utcNow(), id);
    await addAudit(db, actorId, "post.image_removed", "post", id);
  } finally { await db.close(); }
}

export async function dashboard() {
  const db = connectDatabase();
  try {
    const counts = Object.fromEntries((await db.prepare(
      "SELECT status, COUNT(*) AS count FROM posts WHERE is_demo=0 GROUP BY status",
    ).all() as { status: string; count: number }[]).map((row) => [row.status, row.count]));
    const seo = await db.prepare(
      `SELECT SUM(clicks) AS clicks, SUM(impressions) AS impressions,
       CASE WHEN SUM(impressions)>0 THEN SUM(clicks)*1.0/SUM(impressions) ELSE NULL END AS ctr,
       CASE WHEN SUM(impressions)>0 THEN SUM(average_position*impressions)/SUM(impressions) ELSE NULL END AS average_position,
       MAX(metric_date) AS latest_date FROM seo_metrics WHERE source!='demo'`,
    ).get();
    return {
      posts: counts,
      pending_approvals: counts.pending ?? 0,
      seo: seo ?? { clicks: null, impressions: null, ctr: null, average_position: null, latest_date: null },
    };
  } finally { await db.close(); }
}

export async function seoMetrics() {
  const db = connectDatabase();
  try {
    return await db.prepare(
      "SELECT metric_date, query_text, page_path, clicks, impressions, ctr, average_position, source FROM seo_metrics WHERE source!='demo' ORDER BY metric_date DESC, clicks DESC",
    ).all();
  } finally { await db.close(); }
}

export async function saveSeoMetric(actorId: number, data: JsonObject) {
  const metricDate = text(data, "metric_date", "date de mesure", 10);
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(metricDate)) {
    throw new HttpError(400, "La date de mesure doit correspondre au premier jour du mois.");
  }
  const query = text(data, "query_text", "requête", 200);
  const page = text(data, "page_path", "page", 500);
  if (!page.startsWith("/") || page.startsWith("//")) throw new HttpError(400, "La page doit être un chemin interne.");
  const clicks = data.clicks;
  const impressions = data.impressions;
  const position = data.average_position;
  for (const [label, value] of [["clics", clicks], ["impressions", impressions]] as const) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) {
      throw new HttpError(400, `Le nombre de ${label} doit être un entier positif.`);
    }
  }
  if (typeof position !== "number" || !Number.isFinite(position) || position < 1 || position > 1000) {
    throw new HttpError(400, "La position moyenne doit être comprise entre 1 et 1 000.");
  }
  if (clicks! > impressions!) throw new HttpError(400, "Les clics ne peuvent pas dépasser les impressions.");
  const ctr = impressions === 0 ? 0 : (clicks as number) / (impressions as number);
  const db = connectDatabase();
  try {
    await db.prepare(`INSERT INTO seo_metrics (metric_date, query_text, page_path, clicks, impressions, ctr, average_position, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'manual') ON CONFLICT(metric_date, query_text, page_path) DO UPDATE SET
      clicks=excluded.clicks, impressions=excluded.impressions, ctr=excluded.ctr,
      average_position=excluded.average_position, source='manual'`).run(
      metricDate, query, page, clicks as number, impressions as number, ctr, position,
    );
    await addAudit(db, actorId, "seo.metric_created", "seo_metric", `${metricDate}:${query}:${page}`, "source=manual");
    return await db.prepare("SELECT * FROM seo_metrics WHERE metric_date=? AND query_text=? AND page_path=?")
      .get(metricDate, query, page);
  } finally { await db.close(); }
}

function validatePeriod(period: unknown): asserts period is string {
  if (typeof period !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new HttpError(400, "Le mois du rapport doit être au format AAAA-MM.");
  }
}

export async function monthlyReport(period: unknown) {
  validatePeriod(period);
  const db = connectDatabase();
  try {
    const rows = await db.prepare(
      "SELECT metric_key, value, source_note, updated_at FROM monthly_kpis WHERE period=? ORDER BY metric_key",
    ).all(period) as { metric_key: string; value: number; source_note: string; updated_at: string }[];
    const latest = rows.reduce<{ source_note: string; updated_at: string } | null>(
      (prev, row) => !prev || row.updated_at > prev.updated_at ? row : prev, null,
    );
    return {
      period,
      metrics: Object.fromEntries(rows.map((row) => [row.metric_key, row.value])),
      source_note: latest?.source_note ?? "",
      updated_at: latest?.updated_at ?? null,
    };
  } finally { await db.close(); }
}

export async function saveMonthlyReport(actorId: number, data: JsonObject) {
  const period = data.period;
  validatePeriod(period);
  const metrics = data.metrics;
  const sourceNote = data.source_note;
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) throw new HttpError(400, "Les indicateurs du rapport sont invalides.");
  const metricValues = metrics as Record<string, unknown>;
  if (Object.keys(metricValues).some((key) => !(key in KPI_METRICS))) throw new HttpError(400, "Le rapport contient un indicateur inconnu.");
  if (typeof sourceNote !== "string" || sourceNote.trim().length > 250) throw new HttpError(400, "La source doit contenir au maximum 250 caractères.");
  const normalized: Record<string, number | null> = {};
  for (const [key, definition] of Object.entries(KPI_METRICS)) {
    const value = metricValues[key];
    if (value === undefined || value === null || value === "") { normalized[key] = null; continue; }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000_000) {
      throw new HttpError(400, "Les indicateurs doivent être compris entre 0 et 1 000 000 000.");
    }
    if (definition.kind === "count" && !Number.isInteger(value)) throw new HttpError(400, "Les indicateurs de volume doivent être des nombres entiers.");
    if (key === "google_average_position" && (value < 1 || value > 1000)) throw new HttpError(400, "La position moyenne Google doit être comprise entre 1 et 1 000.");
    normalized[key] = value;
  }
  const cleanedSource = sourceNote.trim();
  if (Object.values(normalized).some((value) => value !== null) && !cleanedSource) throw new HttpError(400, "Indiquez la source des données saisies.");
  const db = connectDatabase();
  try {
    for (const [key, value] of Object.entries(normalized)) {
      if (value === null) await db.prepare("DELETE FROM monthly_kpis WHERE period=? AND metric_key=?").run(period, key);
      else await db.prepare(`INSERT INTO monthly_kpis (period, metric_key, value, source_note, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(period, metric_key) DO UPDATE SET
        value=excluded.value, source_note=excluded.source_note, updated_by=excluded.updated_by,
        updated_at=excluded.updated_at`).run(period, key, value, cleanedSource, actorId, utcNow());
    }
    await addAudit(db, actorId, "report.monthly_updated", "monthly_report", period, `metrics=${Object.values(normalized).filter((value) => value !== null).length}`);
    return await monthlyReport(period);
  } finally { await db.close(); }
}

export async function auditEvents(limit = 100) {
  const db = connectDatabase();
  try {
    return await db.prepare(
      `SELECT a.id, a.action, a.resource_type, a.resource_id, a.details, a.created_at,
       u.display_name AS actor FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id
       ORDER BY a.id DESC LIMIT ?`,
    ).all(Math.min(Math.max(limit, 1), 200));
  } finally { await db.close(); }
}

export async function recordAiGeneration(actorId: number, model: string, channel: string, listingId: number | null) {
  const db = connectDatabase();
  try {
    await addAudit(db, actorId, "ai.content_generated", "ai_generation", listingId,
      `model=${model}; channel=${channel}; listing_id=${listingId ?? ""}; instructions=v1`);
  } finally { await db.close(); }
}

export async function recordIntegrationCheck(actorId: number, integrationId: string, succeeded: boolean, message: string) {
  const db = connectDatabase();
  try {
    await addAudit(db, actorId, succeeded ? "integration.check_succeeded" : "integration.check_failed", "integration", integrationId, message);
  } finally { await db.close(); }
}

export async function latestIntegrationChecks() {
  const db = connectDatabase();
  try {
    const rows = await db.prepare(
      "SELECT action, resource_id, details, created_at FROM audit_events WHERE resource_type='integration' ORDER BY id DESC LIMIT 100",
    ).all() as { action: string; resource_id: string; details: string; created_at: string }[];
    const latest: Record<string, { succeeded: boolean; message: string; checked_at: string }> = {};
    for (const row of rows) {
      if (latest[row.resource_id]) continue;
      latest[row.resource_id] = {
        succeeded: row.action === "integration.check_succeeded",
        message: row.details, checked_at: row.created_at,
      };
    }
    return latest;
  } finally { await db.close(); }
}

export async function initAdmin(username: string, email: string, displayName: string, password: string) {
  await initializeDatabase();
  const db = connectDatabase();
  try {
    const count = (await db.prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1").get() as { count: number }).count;
    if (count) throw new HttpError(400, "Un administrateur actif existe déjà.");
  } finally { await db.close(); }
  return await createUser(null, { username, email, display_name: displayName, password, role: "admin" });
}

export async function ensureDatabaseInitialized() {
  await initializeDatabase();
}

export function isEditRole(user: User) {
  return ROLES_CAN_EDIT.includes(user.role);
}
