import nodemailer from "nodemailer";
import { HttpError } from "./security";
import { listListings } from "./service";

const TIMEOUT_MS = 12_000;
const OPENAI_API = "https://api.openai.com/v1";
const GOOGLE_SEARCH_CONSOLE = "https://www.googleapis.com/webmasters/v3";
const META_VERSION = process.env.META_GRAPH_API_VERSION ?? "v26.0";

type Integration = {
  id: string;
  name: string;
  description: string;
  required_environment: string[];
  setup_url: string;
  scopes: string;
  purpose: string;
};

const INTEGRATIONS: Integration[] = [
  {
    id: "openai", name: "OpenAI — génération IA",
    description: "Vérifie le modèle configuré. Aucun texte Cabalou n’est transmis lors du test.",
    required_environment: ["OPENAI_API_KEY", "OPENAI_MODEL"],
    setup_url: "https://platform.openai.com/api-keys", scopes: "API key limitée au projet de production Cabalou.",
    purpose: "Aucune requête de génération n’est lancée par le test.",
  },
  {
    id: "google_search_console", name: "Google Search Console",
    description: "Vérifie l’accès OAuth en lecture et la propriété Search Console configurée.",
    required_environment: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GOOGLE_SEARCH_CONSOLE_SITE_URL"],
    setup_url: "https://console.cloud.google.com/apis/credentials",
    scopes: "https://www.googleapis.com/auth/webmasters.readonly",
    purpose: "Interroge la liste des sites autorisés; aucune donnée de recherche n’est importée.",
  },
  {
    id: "meta_page", name: "Meta — Page Facebook", description: "Vérifie le jeton et l’accès en lecture à la Page.",
    required_environment: ["META_PAGE_ID", "META_PAGE_ACCESS_TOKEN"], setup_url: "https://developers.facebook.com/apps/",
    scopes: "Jeton de Page et permissions minimales approuvées par Meta.", purpose: "Aucune publication ni lecture de commentaires n’est effectuée.",
  },
  {
    id: "meta_ads", name: "Meta Ads — retargeting", description: "Vérifie le jeton et l’accès en lecture au compte publicitaire.",
    required_environment: ["META_AD_ACCOUNT_ID", "META_ADS_ACCESS_TOKEN"], setup_url: "https://developers.facebook.com/docs/marketing-api/",
    scopes: "Accès de lecture au compte publicitaire. Les audiences ne sont pas modifiées.",
    purpose: "Aucune audience, campagne ou donnée de contact n’est envoyée.",
  },
  {
    id: "facebook_groups_manual", name: "Groupes Facebook — traitement manuel",
    description: "Les demandes sont saisies et traitées par un opérateur; aucune API de groupe n’est configurée.",
    required_environment: [], setup_url: "", scopes: "Respect des règles et autorisations de chaque groupe.",
    purpose: "Aucun scraping, collecte automatisée ou publication dans un groupe.",
  },
  {
    id: "tiktok_account", name: "TikTok — compte", description: "Vérifie le jeton d’accès au profil TikTok associé.",
    required_environment: ["TIKTOK_ACCESS_TOKEN", "TIKTOK_OPEN_ID"], setup_url: "https://developers.tiktok.com/",
    scopes: "Login Kit et scopes approuvés pour le compte Cabalou.", purpose: "Aucun contenu n’est publié.",
  },
  {
    id: "tiktok_ads", name: "TikTok Ads — retargeting", description: "Vérifie l’accès à l’annonceur TikTok for Business configuré.",
    required_environment: ["TIKTOK_ADVERTISER_ID", "TIKTOK_ADS_ACCESS_TOKEN"],
    setup_url: "https://business-api.tiktok.com/portal/",
    scopes: "API for Business approuvée avec accès de lecture à l’annonceur.",
    purpose: "Aucune audience, campagne ou donnée de contact n’est envoyée.",
  },
  {
    id: "smtp", name: "E-mail — serveur SMTP", description: "Vérifie la connexion TLS et l’authentification, sans envoyer de message.",
    required_environment: ["CABALOU_SMTP_HOST", "CABALOU_SMTP_PORT", "CABALOU_SMTP_USERNAME", "CABALOU_SMTP_PASSWORD", "CABALOU_SMTP_FROM"],
    setup_url: "", scopes: "Compte d’envoi dédié, SPF/DKIM/DMARC vérifiés et désabonnement géré.",
    purpose: "Aucun e-mail de test n’est envoyé.",
  },
  {
    id: "cabalou_listings", name: "Cabalou — logements (lecture seule)",
    description: "Vérifie l’API logements Cabalou et son schéma minimal.",
    required_environment: ["CABALOU_LISTINGS_API_URL", "CABALOU_API_TOKEN"], setup_url: "",
    scopes: "Jeton de service en lecture seule limité aux faits publiables sur les logements.",
    purpose: "Lit au maximum une page et ne stocke aucune donnée pendant le test.",
  },
];

export function integrationStatus() {
  return INTEGRATIONS.map((integration) => {
    const missing = integration.required_environment.filter((key) => !process.env[key]?.trim());
    return {
      ...integration,
      missing_environment: missing,
      status: integration.id === "facebook_groups_manual" ? "manual" : missing.length ? "not_configured" : "ready_to_test",
    };
  });
}

function configured(id: string) {
  const integration = INTEGRATIONS.find((item) => item.id === id);
  if (!integration) throw new HttpError(400, "Intégration inconnue.");
  const missing = integration.required_environment.filter((key) => !process.env[key]?.trim());
  if (missing.length) throw new HttpError(400, `Paramètres manquants : ${missing.join(", ")}`);
  return integration;
}

async function requestJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), headers: {
      Accept: "application/json", ...init?.headers,
    } });
  } catch {
    throw new HttpError(400, "Le fournisseur est injoignable. Vérifiez le réseau et sa disponibilité.");
  }
  let text: string;
  try { text = await boundedResponseText(response); }
  catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Le fournisseur a retourné une réponse incomplète.");
  }
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { throw new HttpError(400, "Le fournisseur a retourné une réponse invalide."); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new HttpError(400, "Le fournisseur a retourné une réponse invalide.");
  }
  if (!response.ok) {
    throw new HttpError(400, `Le fournisseur a refusé la vérification (HTTP ${response.status}). Vérifiez les droits et identifiants.`);
  }
  return payload as Record<string, unknown>;
}

async function boundedResponseText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 1_000_000) {
        await reader.cancel();
        throw new HttpError(400, "La réponse du fournisseur est trop volumineuse.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function apiSuccess(payload: Record<string, unknown>, provider: string) {
  if (payload.error) throw new HttpError(400, `${provider} a refusé l’accès. Vérifiez les permissions et la configuration.`);
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function checkGoogle() {
  const token = await requestJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  if (!token.access_token || typeof token.access_token !== "string") {
    throw new HttpError(400, "Google OAuth n’a pas délivré de jeton d’accès.");
  }
  const sites = await requestJson(`${GOOGLE_SEARCH_CONSOLE}/sites`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  apiSuccess(sites, "Google Search Console");
  const entries = sites.siteEntry;
  if (!Array.isArray(entries)) throw new HttpError(400, "Google Search Console a retourné une liste de sites invalide.");
  if (!entries.some((entry) => entry && typeof entry === "object" && (entry as Record<string, unknown>).siteUrl === process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL)) {
    throw new HttpError(400, "La propriété Search Console configurée n’est pas accessible à ce compte.");
  }
  return "Connexion Google OAuth valide; propriété Search Console accessible en lecture.";
}

async function checkProvider(id: string): Promise<string> {
  if (id === "openai") {
    const models = await requestJson(`${OPENAI_API}/models`, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    });
    apiSuccess(models, "OpenAI");
    const items = models.data;
    if (!Array.isArray(items) || !items.some((item) => item && typeof item === "object" && (item as Record<string, unknown>).id === process.env.OPENAI_MODEL)) {
      throw new HttpError(400, "Le modèle OpenAI configuré n’est pas disponible pour ce projet.");
    }
    return `OpenAI accessible; le modèle « ${process.env.OPENAI_MODEL} » est disponible.`;
  }
  if (id === "google_search_console") return checkGoogle();
  if (id === "meta_page" || id === "meta_ads") {
    if (!/^v\d+\.\d+$/.test(META_VERSION)) throw new HttpError(400, "META_GRAPH_API_VERSION doit ressembler à v26.0.");
    const isPage = id === "meta_page";
    const accountId = isPage ? process.env.META_PAGE_ID! : `act_${process.env.META_AD_ACCOUNT_ID!.replace(/^act_/, "")}`;
    if (!isPage && !/^act_\d+$/.test(accountId)) throw new HttpError(400, "META_AD_ACCOUNT_ID doit être un identifiant numérique.");
    const token = isPage ? process.env.META_PAGE_ACCESS_TOKEN! : process.env.META_ADS_ACCESS_TOKEN!;
    const fields = isPage ? "id,name" : "id,name,account_status";
    const result = await requestJson(`https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(accountId)}?${new URLSearchParams({ fields, access_token: token })}`);
    apiSuccess(result, "Meta");
    if (string(result.id) !== accountId) throw new HttpError(400, "Meta a retourné un compte différent de celui configuré.");
    return isPage ? "Jeton Meta valide; Page accessible en lecture." : "Jeton Meta Ads valide; compte publicitaire accessible en lecture.";
  }
  if (id === "tiktok_account") {
    const profile = await requestJson("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", {
      headers: { Authorization: `Bearer ${process.env.TIKTOK_ACCESS_TOKEN}` },
    });
    apiSuccess(profile, "TikTok");
    const data = profile.data as Record<string, unknown> | undefined;
    const user = data?.user as Record<string, unknown> | undefined;
    if (user?.open_id !== process.env.TIKTOK_OPEN_ID) throw new HttpError(400, "Le jeton TikTok ne correspond pas au compte configuré.");
    return "Jeton TikTok valide; compte associé accessible.";
  }
  if (id === "tiktok_ads") {
    const advertiserId = process.env.TIKTOK_ADVERTISER_ID!;
    const query = new URLSearchParams({
      advertiser_ids: JSON.stringify([advertiserId]),
      fields: JSON.stringify(["advertiser_id", "name", "currency", "status"]),
    });
    const response = await requestJson(`https://business-api.tiktok.com/open_api/v1.3/advertiser/info/?${query}`, {
      headers: { "Access-Token": process.env.TIKTOK_ADS_ACCESS_TOKEN! },
    });
    if (response.code !== 0) throw new HttpError(400, "TikTok Ads a refusé l’accès. Vérifiez l’annonceur et les autorisations API for Business.");
    const data = response.data as Record<string, unknown> | undefined;
    const advertisers = data?.list;
    if (!Array.isArray(advertisers) || !advertisers.some((entry) => entry && typeof entry === "object" && String((entry as Record<string, unknown>).advertiser_id) === advertiserId)) {
      throw new HttpError(400, "TikTok Ads n’a pas retourné l’annonceur configuré.");
    }
    return "Jeton TikTok Ads valide; annonceur accessible en lecture.";
  }
  if (id === "smtp") {
    const port = Number(process.env.CABALOU_SMTP_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(400, "CABALOU_SMTP_PORT doit être compris entre 1 et 65535.");
    const transport = nodemailer.createTransport({
      host: process.env.CABALOU_SMTP_HOST, port, secure: false, requireTLS: true,
      auth: { user: process.env.CABALOU_SMTP_USERNAME, pass: process.env.CABALOU_SMTP_PASSWORD },
      connectionTimeout: TIMEOUT_MS, greetingTimeout: TIMEOUT_MS, socketTimeout: TIMEOUT_MS,
    });
    try { await transport.verify(); }
    catch { throw new HttpError(400, "La connexion SMTP sécurisée a échoué. Vérifiez l’hôte, le port et TLS."); }
    finally { transport.close(); }
    return "Connexion SMTP/TLS et authentification valides; aucun message envoyé.";
  }
  if (id === "cabalou_listings") {
    const endpoint = process.env.CABALOU_LISTINGS_API_URL!;
    let url: URL;
    try { url = new URL(endpoint); } catch { throw new HttpError(400, "CABALOU_LISTINGS_API_URL doit être une URL HTTPS valide."); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new HttpError(400, "CABALOU_LISTINGS_API_URL doit être une URL HTTPS sans identifiants ni paramètres.");
    }
    const response = await requestJson(endpoint, { headers: { Authorization: `Bearer ${process.env.CABALOU_API_TOKEN}` } });
    apiSuccess(response, "API Cabalou");
    if (!Array.isArray(response.listings)) throw new HttpError(400, "L’API Cabalou doit retourner un tableau JSON « listings ».");
    const listings = response.listings;
    if (listings.length) {
      const first = listings[0] as Record<string, unknown>;
      const fields = ["external_id", "name", "city", "neighborhood", "listing_type", "features", "public_url", "facts_checked_at"];
      if (!first || typeof first !== "object" || fields.some((field) => !(field in first))) {
        throw new HttpError(400, "Le premier logement ne respecte pas le schéma minimal documenté.");
      }
      if (fields.filter((field) => field !== "features").some((field) => typeof first[field] !== "string" || !(first[field] as string).trim())
        || !Array.isArray(first.features)) {
        throw new HttpError(400, "Les champs du premier logement n’ont pas les types attendus.");
      }
      let publicUrl: URL;
      try { publicUrl = new URL(first.public_url as string); } catch { throw new HttpError(400, "L’URL publique du premier logement doit utiliser HTTPS."); }
      if (publicUrl.protocol !== "https:") throw new HttpError(400, "L’URL publique du premier logement doit utiliser HTTPS.");
    }
    return `API Cabalou accessible en lecture; ${listings.length} logement(s) dans la première page.`;
  }
  throw new HttpError(400, "Cette intégration ne nécessite aucune vérification automatique.");
}

export async function testIntegration(id: string) {
  const integration = configured(id);
  if (id === "facebook_groups_manual") throw new HttpError(400, "Cette intégration est traitée manuellement.");
  return { id, name: integration.name, message: await checkProvider(id) };
}

function cleanText(value: unknown, label: string, limit: number, required = true): string {
  if (typeof value !== "string") throw new HttpError(400, `Le champ « ${label} » est invalide.`);
  const cleaned = value.trim();
  if (required && !cleaned) throw new HttpError(400, `Le champ « ${label} » est obligatoire.`);
  if (cleaned.length > limit) throw new HttpError(400, `Le champ « ${label} » dépasse la limite autorisée.`);
  const hasEmail = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(cleaned);
  const hasPhone = [...cleaned.matchAll(/(?<!\w)\+?\d[\d\s().-]{6,}\d(?!\w)/g)]
    .some((match) => (match[0].match(/\d/g) ?? []).length >= 8);
  if (hasEmail || hasPhone) throw new HttpError(400, `Le champ « ${label} » semble contenir une coordonnée personnelle. Retirez-la avant la génération.`);
  return cleaned;
}

export async function generateContent(data: Record<string, unknown>) {
  configured("openai");
  const channel = cleanText(data.channel, "réseau", 20);
  if (!["facebook", "tiktok"].includes(channel)) throw new HttpError(400, "Le réseau doit être Facebook ou TikTok.");
  const objective = cleanText(data.objective, "objectif", 240);
  const tone = cleanText(data.tone, "ton", 120);
  const brief = cleanText(data.brief ?? "", "brief", 1200, false);
  if (!Array.isArray(data.facts) || data.facts.length > 20) throw new HttpError(400, "Les faits fournis sont invalides.");
  const facts = data.facts.map((fact) => cleanText(fact, "fait vérifié", 300));
  let listingId: number | null = null;
  if (data.listing_id !== undefined && data.listing_id !== null && data.listing_id !== "") {
    if (typeof data.listing_id !== "number" && typeof data.listing_id !== "string") throw new HttpError(400, "Logement invalide.");
    listingId = Number(data.listing_id);
    if (!Number.isSafeInteger(listingId) || listingId < 1) throw new HttpError(400, "Logement invalide.");
    const listing = (await listListings()).find((item) => item.id === listingId);
    if (!listing) throw new HttpError(400, "Le logement sélectionné est introuvable ou non vérifié.");
    facts.unshift(
      `Nom : ${listing.name}`, `Ville : ${listing.city}`, `Quartier : ${listing.neighborhood}`,
      `Type : ${listing.listing_type}`, `Faits du logement vérifiés le : ${listing.facts_checked_at}`,
      ...listing.features.map((feature) => `Équipement : ${feature}`),
    );
    if (facts.length > 20) throw new HttpError(400, "Les faits fournis sont invalides.");
  }
  const instructions = "Tu es l’assistant de rédaction marketing de Cabalou. Rédige uniquement un brouillon en français pour le canal indiqué. Utilise seulement les faits explicitement fournis. N’invente jamais prix, disponibilité, remise, équipement, adresse précise, capacité ou caractéristique. Si les faits sont insuffisants, formule un texte prudent sans compléter et ajoute à la fin une courte ligne « À vérifier : ... ». Ne prétends pas avoir vérifié les faits. N’inclus aucune donnée personnelle. Pas de hashtags trompeurs, de garantie de réservation ni de promesse de résultat. La sortie sera revue par une personne et ne sera pas publiée automatiquement.";
  const input = [
    `Canal : ${channel}`, `Objectif : ${objective}`, `Ton : ${tone}`,
    `Brief de l’opérateur : ${brief || "Aucun brief complémentaire."}`,
    "Faits publiables vérifiés :", ...(facts.length ? facts.map((fact) => `- ${fact}`) : ["- Aucun fait fourni."]),
  ].join("\n");
  const response = await requestJson(`${OPENAI_API}/responses`, {
    method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL, instructions, input, max_output_tokens: 700 }),
  });
  apiSuccess(response, "OpenAI");
  let output = string(response.output_text);
  if (!output && Array.isArray(response.output)) {
    output = response.output.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const content = (item as Record<string, unknown>).content;
      return Array.isArray(content) ? content.filter((part) => part && typeof part === "object"
        && (part as Record<string, unknown>).type === "output_text")
        .map((part) => string((part as Record<string, unknown>).text)) : [];
    }).join("\n");
  }
  if (!output.trim() || output.length > 5000) throw new HttpError(400, "OpenAI n’a pas retourné de brouillon exploitable.");
  return { body: output.trim(), model: process.env.OPENAI_MODEL!, listingId };
}
