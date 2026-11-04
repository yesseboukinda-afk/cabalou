import { connectDatabase } from "./db";
import { addAudit, HttpError, utcNow } from "./security";

type Data = Record<string, unknown>;

function value(data: Data, key: string, label: string, limit: number, required = true): string {
  const raw = data[key] ?? "";
  if (typeof raw !== "string") throw new HttpError(400, `Le champ « ${label} » est invalide.`);
  const cleaned = raw.trim();
  if (required && !cleaned) throw new HttpError(400, `Le champ « ${label} » est obligatoire.`);
  if (cleaned.length > limit) throw new HttpError(400, `Le champ « ${label} » est limité à ${limit} caractères.`);
  return cleaned;
}

function date(value: string, label: string, optional = false): string {
  if (optional && !value) return "";
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `Le champ « ${label} » doit être au format AAAA-MM-JJ.`);
  }
  return value;
}

function recordId(id: number) {
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, "Identifiant invalide.");
  return id;
}

function record<T extends Record<string, unknown>>(table: string, id: number): T {
  const allowed = ["reactivation_contacts", "retargeting_prospects", "social_interactions", "group_requests", "b2b_prospects"];
  if (!allowed.includes(table)) throw new HttpError(400, "Parcours métier inconnu.");
  const db = connectDatabase();
  try {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(recordId(id)) as T | undefined;
    if (!row) throw new HttpError(404, "Fiche introuvable.");
    return row;
  } finally { db.close(); }
}

export function listWorkflows(canViewContactDetails: boolean) {
  const db = connectDatabase();
  try {
    const list = (table: string) => db.prepare(
      `SELECT * FROM ${table} ORDER BY updated_at DESC, id DESC LIMIT 100`,
    ).all() as Record<string, unknown>[];
    const b2b = list("b2b_prospects");
    if (!canViewContactDetails) {
      for (const prospect of b2b) {
        prospect.contact_name = "";
        prospect.email = "";
      }
    }
    return {
      social: list("social_interactions"),
      groups: list("group_requests"),
      b2b,
      reactivation: list("reactivation_contacts"),
      retargeting: list("retargeting_prospects"),
      seo_targets: db.prepare(
        `SELECT t.*, m.period, m.average_position, m.clicks, m.impressions
         FROM seo_targets t LEFT JOIN seo_target_metrics m ON m.target_id=t.id
         AND m.period=(SELECT MAX(period) FROM seo_target_metrics WHERE target_id=t.id)
         ORDER BY t.query_text`,
      ).all(),
    };
  } finally { db.close(); }
}

export function createSocial(actor: number, data: Data) {
  const channel = value(data, "channel", "réseau", 20);
  if (!["facebook", "tiktok"].includes(channel)) throw new HttpError(400, "Le réseau doit être Facebook ou TikTok.");
  const ref = value(data, "post_reference", "référence du contenu", 160, false);
  const summary = value(data, "comment_summary", "résumé du commentaire", 1500);
  return createRow(actor, "social_interactions", {
    channel, post_reference: ref, comment_summary: summary,
  }, "social_interaction.created", channel);
}

export function createGroup(actor: number, data: Data) {
  const source = value(data, "source_group", "groupe source", 160);
  const city = value(data, "city", "ville", 100);
  const type = value(data, "listing_type", "type de logement", 80, false);
  const desiredDate = date(value(data, "desired_date", "date souhaitée", 10, false), "date souhaitée", true);
  const summary = value(data, "request_summary", "résumé anonymisé", 1200);
  let guests: number | null = null;
  if (data.guests !== null && data.guests !== undefined && data.guests !== "") {
    if (typeof data.guests !== "number" || !Number.isInteger(data.guests) || data.guests < 1 || data.guests > 100) {
      throw new HttpError(400, "Le nombre de voyageurs doit être compris entre 1 et 100.");
    }
    guests = data.guests;
  }
  return createRow(actor, "group_requests", {
    source_group: source, city, listing_type: type, desired_date: desiredDate,
    guests, request_summary: summary,
  }, "group_request.created", city);
}

export function createB2B(actor: number, data: Data) {
  const company = value(data, "company", "organisation", 160);
  const contact = value(data, "contact_name", "contact", 120, false);
  const email = value(data, "email", "adresse e-mail", 254, false);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "L’adresse e-mail est invalide.");
  const source = value(data, "source", "source autorisée", 240);
  const basis = value(data, "legal_basis", "base de contact", 30);
  if (!["pending", "consent", "legitimate_interest"].includes(basis)) throw new HttpError(400, "Base de contact invalide.");
  return createRow(actor, "b2b_prospects", {
    company, contact_name: contact, email, source, legal_basis: basis,
  }, "b2b_prospect.created", `basis=${basis}`);
}

export function createReactivation(actor: number, data: Data) {
  const ref = value(data, "external_ref", "référence pseudonymisée", 120);
  if (ref.includes("@") || ref.includes("://")) throw new HttpError(400, "Utilisez une référence pseudonymisée, pas une adresse e-mail ou une URL.");
  const last = date(value(data, "last_booking_date", "date du dernier séjour", 10), "date du dernier séjour");
  const basis = value(data, "contact_basis", "base de contact", 30);
  if (!["pending", "consent", "existing_customer"].includes(basis)) throw new HttpError(400, "Base de contact invalide.");
  return createRow(actor, "reactivation_contacts", {
    external_ref: ref, last_booking_date: last, contact_basis: basis,
  }, "reactivation_contact.created", `basis=${basis}`);
}

export function createRetargeting(actor: number, data: Data) {
  const ref = value(data, "external_ref", "référence pseudonymisée", 120);
  if (ref.includes("@") || ref.includes("://")) throw new HttpError(400, "Utilisez une référence pseudonymisée, pas une adresse e-mail ou une URL.");
  const interest = value(data, "interest_label", "intérêt", 120);
  const source = value(data, "source", "source", 240);
  if (typeof data.consent_confirmed !== "boolean") throw new HttpError(400, "Confirmez si un consentement publicitaire vérifiable existe.");
  return createRow(actor, "retargeting_prospects", {
    external_ref: ref, interest_label: interest, source,
    consent_confirmed: Number(data.consent_confirmed),
  }, "retargeting_prospect.created", `consent=${Number(data.consent_confirmed)}`);
}

function createRow(actor: number, table: string, fields: Record<string, unknown>, action: string, detail = "") {
  const db = connectDatabase();
  try {
    const now = utcNow();
    const columns = Object.keys(fields);
    const values = Object.values(fields);
    const createdUpdated = ["social_interactions", "group_requests", "b2b_prospects", "reactivation_contacts", "retargeting_prospects"].includes(table);
    if (createdUpdated) {
      columns.push("created_by", "updated_by", "created_at", "updated_at");
      values.push(actor, actor, now, now);
    } else {
      columns.push("created_by", "created_at");
      values.push(actor, now);
    }
    const result = db.prepare(
      `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
    ).run(...values as (string | number | null)[]);
    const id = Number(result.lastInsertRowid);
    addAudit(db, actor, action, table, id, detail);
    return db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  } finally { db.close(); }
}

export function createSeoTarget(actor: number, data: Data) {
  const query = value(data, "query_text", "requête cible", 200);
  const page = value(data, "target_page", "page cible", 500, false);
  if (page && (!page.startsWith("/") || page.startsWith("//"))) {
    throw new HttpError(400, "La page cible doit être un chemin interne (par exemple /logements).");
  }
  return createRow(actor, "seo_targets", { query_text: query, target_page: page }, "seo_target.created", query);
}

export function recordSeoTarget(actor: number, id: number, data: Data) {
  recordId(id);
  const period = value(data, "period", "mois", 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new HttpError(400, "Le mois doit être au format AAAA-MM.");
  const position = data.average_position;
  const clicks = data.clicks;
  const impressions = data.impressions;
  if (typeof position !== "number" || !Number.isFinite(position) || position < 1 || position > 1000) {
    throw new HttpError(400, "La position doit être comprise entre 1 et 1 000.");
  }
  for (const [label, value] of [["clics", clicks], ["impressions", impressions]] as const) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1_000_000_000) {
      throw new HttpError(400, `Le nombre de ${label} doit être un entier positif.`);
    }
  }
  const db = connectDatabase();
  try {
    if (!db.prepare("SELECT 1 FROM seo_targets WHERE id=?").get(id)) throw new HttpError(404, "Requête SEO introuvable.");
    db.prepare(`INSERT INTO seo_target_metrics (target_id, period, average_position, clicks, impressions, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(target_id, period) DO UPDATE SET
      average_position=excluded.average_position, clicks=excluded.clicks, impressions=excluded.impressions,
      updated_by=excluded.updated_by, updated_at=excluded.updated_at`).run(
      id, period, position, clicks as number, impressions as number, actor, utcNow(),
    );
    addAudit(db, actor, "seo_target.measured", "seo_target", id, period);
    return db.prepare(`SELECT t.*, m.period, m.average_position, m.clicks, m.impressions
      FROM seo_targets t JOIN seo_target_metrics m ON m.target_id=t.id
      WHERE t.id=? AND m.period=?`).get(id, period);
  } finally { db.close(); }
}

export function groupMatches(id: number) {
  recordId(id);
  const request = record<{ city: string; listing_type: string }>("group_requests", id);
  const db = connectDatabase();
  try {
    const sql = `SELECT id, name, city, neighborhood, listing_type, features, public_url, facts_checked_at
      FROM listings WHERE is_demo=0 AND city=? COLLATE NOCASE ${request.listing_type ? "AND listing_type=?" : ""}
      ORDER BY facts_checked_at DESC, name LIMIT 20`;
    const rows = (request.listing_type
      ? db.prepare(sql).all(request.city, request.listing_type)
      : db.prepare(sql).all(request.city)) as Record<string, unknown>[];
    return rows.map((row) => ({ ...row, features: String(row.features || "").split("; ").filter(Boolean) }));
  } finally { db.close(); }
}

function addEvent(actor: number, table: string, eventTable: string, id: number, eventType: string, note: string) {
  recordId(id);
  const cleanedNote = value({ note }, "note", "note", 500, false);
  const row = record<Record<string, unknown>>(table, id);
  const db = connectDatabase();
  try {
    if (["contacted", "reached"].includes(eventType)) {
      const allowed = table === "reactivation_contacts"
        ? ["consent", "existing_customer"].includes(String(row.contact_basis))
        : Boolean(row.consent_confirmed);
      if (!allowed || row.opted_out) throw new HttpError(400, "Aucun suivi n’est autorisé sans base valide et absence d’opposition.");
    }
    if (["responded", "repeat_booking", "booked"].includes(eventType)) {
      const eventKey = table === "reactivation_contacts" ? "contact_id" : "prospect_id";
      const prior = db.prepare(`SELECT 1 FROM ${eventTable} WHERE ${eventKey}=? AND event_type=? LIMIT 1`)
        .get(id, table === "reactivation_contacts" ? "contacted" : "reached");
      if (!prior || row.opted_out) throw new HttpError(400, "Consignez d’abord un contact autorisé, sans opposition.");
    }
    const key = table === "reactivation_contacts" ? "contact_id" : "prospect_id";
    db.prepare(`INSERT INTO ${eventTable} (${key}, event_type, note, created_by, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(id, eventType, cleanedNote, actor, utcNow());
    if (eventType === "opted_out") {
      db.prepare(`UPDATE ${table} SET opted_out=1, updated_by=?, updated_at=? WHERE id=?`)
        .run(actor, utcNow(), id);
    }
    addAudit(db, actor, `${table}.event`, table, id, eventType);
  } finally { db.close(); }
  return record(table, id);
}

export function act(actor: number, module: string, id: number, action: string, data: Data) {
  recordId(id);
  const now = utcNow();
  if (module === "reactivation" && action === "set-basis") {
    const basis = value(data, "contact_basis", "base de contact", 30);
    if (!["consent", "existing_customer"].includes(basis)) throw new HttpError(400, "Une base de contact vérifiée est requise.");
    const row = record<Record<string, unknown>>("reactivation_contacts", id);
    if (row.opted_out) throw new HttpError(400, "La base ne peut pas être modifiée après opposition.");
    return updateWorkflowRecord(actor, "reactivation_contacts", id, { contact_basis: basis }, "reactivation.basis_confirmed", basis);
  }
  if (module === "retargeting" && action === "set-basis") {
    const source = value(data, "source", "source du consentement", 240);
    const row = record<Record<string, unknown>>("retargeting_prospects", id);
    if (row.opted_out) throw new HttpError(400, "Le consentement ne peut pas être modifié après opposition.");
    return updateWorkflowRecord(actor, "retargeting_prospects", id, { consent_confirmed: 1, source }, "retargeting.consent_confirmed");
  }
  if (module === "reactivation" || module === "retargeting") {
    const map = module === "reactivation"
      ? { contacted: ["reactivation_contacts", "reactivation_events", "contacted"], responded: ["reactivation_contacts", "reactivation_events", "responded"], booked: ["reactivation_contacts", "reactivation_events", "repeat_booking"], "opt-out": ["reactivation_contacts", "reactivation_events", "opted_out"] }
      : { contacted: ["retargeting_prospects", "retargeting_events", "reached"], booked: ["retargeting_prospects", "retargeting_events", "booked"], "opt-out": ["retargeting_prospects", "retargeting_events", "opted_out"] };
    const mapping = map[action as keyof typeof map] as [string, string, string] | undefined;
    if (!mapping) throw new HttpError(400, "Action invalide.");
    return addEvent(actor, mapping[0], mapping[1], id, mapping[2], value(data, "note", "note", 500, false));
  }
  if (module === "social" || module === "groups") {
    const table = module === "social" ? "social_interactions" : "group_requests";
    const allowed = module === "social" ? ["save-draft", "replied", "ignore"] : ["save-draft", "replied", "close"];
    if (!allowed.includes(action)) throw new HttpError(400, "Action invalide.");
    const required = action === "save-draft" || action === "replied";
    const draft = value(data, "draft", "réponse", 2000, required);
    const row = record<Record<string, unknown>>(table, id);
    const priorStates = module === "social" ? ["open", "draft"] : ["new", "draft"];
    if (!priorStates.includes(String(row.status))) throw new HttpError(400, "Cette fiche est déjà clôturée.");
    const field = module === "social" ? "reply_draft" : "response_draft";
    return updateWorkflowRecord(actor, table, id, {
      [field]: (action === "ignore" || action === "close") && !draft ? row[field] : draft,
      status: ({ "save-draft": "draft", replied: "replied", ignore: "ignored", close: "closed" } as Record<string, string>)[action],
    }, `${module}.${action}`);
  }
  if (module === "b2b") return actB2B(actor, id, action, data, now);
  throw new HttpError(400, "Parcours métier inconnu.");
}

function updateWorkflowRecord(actor: number, table: string, id: number, fields: Record<string, unknown>, action: string, detail = "") {
  const db = connectDatabase();
  try {
    const pairs = Object.entries(fields);
    const assignments = pairs.map(([key]) => `${key}=?`);
    const values = pairs.map(([, value]) => value);
    if (["social_interactions", "group_requests", "b2b_prospects", "reactivation_contacts", "retargeting_prospects"].includes(table)) {
      assignments.push("updated_by=?", "updated_at=?");
      values.push(actor, utcNow());
    }
    db.prepare(`UPDATE ${table} SET ${assignments.join(",")} WHERE id=?`).run(...values as (string | number | null)[], id);
    addAudit(db, actor, action, table, id, detail);
  } finally { db.close(); }
  return record(table, id);
}

function actB2B(actor: number, id: number, action: string, data: Data, now: string) {
  const row = record<Record<string, unknown>>("b2b_prospects", id);
  if (action === "set-basis") {
    const basis = value(data, "legal_basis", "base de contact", 30);
    const source = value(data, "source", "source autorisée", 240);
    if (!["consent", "legitimate_interest"].includes(basis)) throw new HttpError(400, "Une base de contact vérifiée est requise.");
    if (row.opted_out || !["new", "draft"].includes(String(row.status))) throw new HttpError(400, "La base de contact ne peut pas être modifiée pour ce prospect.");
    return updateWorkflowRecord(actor, "b2b_prospects", id, { legal_basis: basis, source }, "b2b.basis_confirmed", basis);
  }
  if (action === "save-draft") {
    const subject = value(data, "subject", "objet", 200);
    const emailDraft = value(data, "email_draft", "brouillon d’e-mail", 5000);
    const followup = date(value(data, "follow_up_date", "date de relance", 10, false), "date de relance", true);
    if (row.opted_out || !["new", "draft"].includes(String(row.status))) throw new HttpError(400, "Ce prospect ne peut plus être modifié.");
    return updateWorkflowRecord(actor, "b2b_prospects", id, {
      subject, email_draft: emailDraft, follow_up_date: followup, status: "draft",
    }, "b2b.draft_saved");
  }
  const transitions: Record<string, [string, string[]]> = {
    sent: ["sent", ["draft", "new"]], responded: ["replied", ["sent"]],
    qualified: ["qualified", ["sent", "replied"]],
    close: ["closed", ["new", "draft", "sent", "replied", "qualified"]],
    "opt-out": ["opted_out", ["new", "draft", "sent", "replied", "qualified"]],
  };
  const transition = transitions[action];
  if (!transition) throw new HttpError(400, "Action invalide.");
  if (!transition[1].includes(String(row.status))) throw new HttpError(400, "Cette transition n’est pas autorisée depuis le statut actuel.");
  if (action === "sent" && (row.legal_basis === "pending" || !row.email || !row.subject || !row.email_draft)) {
    throw new HttpError(400, "Avant de consigner un envoi manuel, vérifiez la base de contact, l’e-mail et le brouillon.");
  }
  return updateWorkflowRecord(actor, "b2b_prospects", id, {
    status: transition[0], opted_out: Number(action === "opt-out" || Boolean(row.opted_out)),
  }, `b2b.${action}`);
}

export function listWorkflowEvents(module: string, id: number, includeNotes: boolean) {
  recordId(id);
  const mapping = module === "reactivation"
    ? ["reactivation_events", "contact_id"]
    : module === "retargeting" ? ["retargeting_events", "prospect_id"] : null;
  if (!mapping) throw new HttpError(400, "Parcours métier inconnu.");
  const [table, key] = mapping;
  const db = connectDatabase();
  try {
    const rows = db.prepare(
      `SELECT event_type, note, created_at FROM ${table} WHERE ${key}=? ORDER BY created_at DESC LIMIT 50`,
    ).all(id) as Record<string, unknown>[];
    if (!includeNotes) for (const row of rows) row.note = "";
    return rows;
  } finally { db.close(); }
}
