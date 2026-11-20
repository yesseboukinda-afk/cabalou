import nodemailer from "nodemailer";
import { HttpError } from "./security";
import { listListings, type SeoSearchConsoleMetric } from "./service";
import { connectDatabase } from "./db";
import { aiProviderCascade, aiProviderConfig, aiProviderStatus } from "./ai-provider";

const TIMEOUT_MS = 12_000;
const GOOGLE_SEARCH_CONSOLE_PAGE_SIZE = 1_000;
const GOOGLE_SEARCH_CONSOLE_MAX_ROWS = 10_000;
const GOOGLE_SEARCH_CONSOLE_MAX_RESPONSE_BYTES = 5_000_000;
const GOOGLE_SEARCH_CONSOLE_MAX_RANGE_DAYS = 90;
const META_SCHEDULE_MIN_LEAD_TIME_MS = 10 * 60_000;
const META_SCHEDULE_MAX_LEAD_TIME_MS = 30 * 24 * 60 * 60_000;
export const META_PAGE_IMAGE_MAX_BYTES = 10_000_000;
export const META_PAGE_VIDEO_MAX_BYTES = 100_000_000;
export const META_PAGE_ALBUM_MAX_PHOTOS = 10;
export const META_PAGE_MEDIA_REQUEST_MAX_BYTES = META_PAGE_VIDEO_MAX_BYTES + 1_000_000;
const OPENAI_API = "https://api.openai.com/v1";
const GROQ_API = "https://api.groq.com/openai/v1";
const GOOGLE_SEARCH_CONSOLE = "https://www.googleapis.com/webmasters/v3";
const META_VERSION = "v27.0";

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
    id: "openai", name: "OpenAI — chatbot et génération IA",
    description: "Fournit une aide à la rédaction et à la création de contenu.",
    required_environment: ["OPENAI_API_KEY", "OPENAI_MODEL"],
    setup_url: "https://platform.openai.com/api-keys", scopes: "API key limitée au projet de production Cabalou.",
    purpose: "Aucune requête de génération n’est lancée par le test.",
  },
  {
    id: "groq", name: "Groq — chatbot et génération IA",
    description: "Fournit une aide à la rédaction et à la création de contenu.",
    required_environment: ["GROQ_API_KEY"],
    setup_url: "https://console.groq.com/keys",
    scopes: "Clé API Groq côté serveur; modèle par défaut openai/gpt-oss-20b.",
    purpose: "Le test vérifie l’accès au modèle sans transmettre de contenu Cabalou.",
  },
  {
    id: "google_search_console", name: "Google Search Console",
    description: "Affiche les performances du site dans les résultats de recherche Google.",
    required_environment: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GOOGLE_SEARCH_CONSOLE_SITE_URL"],
    setup_url: "https://console.cloud.google.com/apis/credentials",
    scopes: "https://www.googleapis.com/auth/webmasters.readonly",
    purpose: "Interroge la liste des sites autorisés; aucune donnée de recherche n’est importée.",
  },
  {
    id: "meta_page", name: "Meta — Page Facebook", description: "Relie la Page Facebook de Cabalou pour gérer les publications et les commentaires.",
    required_environment: ["META_PAGE_ID", "META_PAGE_ACCESS_TOKEN"], setup_url: "https://developers.facebook.com/apps/",
    scopes: "Jeton de Page et permissions minimales approuvées par Meta.", purpose: "Aucune publication ni lecture de commentaires n’est effectuée.",
  },
  {
    id: "facebook_groups_manual", name: "Groupes Facebook — traitement manuel",
    description: "Les demandes de groupes Facebook sont traitées manuellement.",
    required_environment: [], setup_url: "", scopes: "Respect des règles et autorisations de chaque groupe.",
    purpose: "Aucun scraping, collecte automatisée ou publication dans un groupe.",
  },
  {
    id: "smtp", name: "E-mail — serveur SMTP", description: "Permet l’envoi des e-mails de Cabalou.",
    required_environment: ["CABALOU_SMTP_HOST", "CABALOU_SMTP_PORT", "CABALOU_SMTP_USERNAME", "CABALOU_SMTP_PASSWORD", "CABALOU_SMTP_FROM"],
    setup_url: "", scopes: "Compte d’envoi dédié, SPF/DKIM/DMARC vérifiés et désabonnement géré.",
    purpose: "Aucun e-mail de test n’est envoyé.",
  },
  {
    id: "cabalou_listings", name: "Cabalou — logements (lecture seule)",
    description: "Récupère les informations des logements pour les publications.",
    required_environment: ["CABALOU_LISTINGS_API_URL", "CABALOU_API_TOKEN"], setup_url: "",
    scopes: "Jeton de service en lecture seule limité aux faits publiables sur les logements.",
    purpose: "Lit au maximum une page et ne stocke aucune donnée pendant le test.",
  },
];

export function integrationStatus() {
  const aiStatus = aiProviderStatus();
  return INTEGRATIONS.map((integration) => {
    const missing = integration.required_environment.filter((key) => !process.env[key]?.trim());
    return {
      ...integration,
      missing_environment: missing,
      active: integration.id === aiStatus.provider,
      status: integration.id === "facebook_groups_manual" ? "manual" : missing.length ? "not_configured" : "ready_to_test",
    };
  });
}

function configured(id: string) {
  const integration = INTEGRATIONS.find((item) => item.id === id);
  if (!integration) throw new HttpError(400, "Intégration inconnue.");
  const missing = integration.required_environment.filter((key) => !process.env[key]?.trim());
  if (missing.length) throw new HttpError(400, "Cette intégration n’est pas encore configurée. Contactez un administrateur.");
  return integration;
}

type MetaRequestContext = "page-read" | "comment-read" | "comment-write" | "page-write" | "media-write" | "reaction-read" | "insights";

function metaFailureMessage(code: number | undefined, url: string, method?: string, context?: MetaRequestContext): string {
  if (code === 190) return "La connexion Facebook n’est plus valide. Contactez un administrateur pour la rétablir.";
  if ((context === "insights" || new URL(url).pathname.includes("/insights")) && (code === 10 || code === 200)) {
    return "Les statistiques de vues ne sont pas disponibles pour le moment.";
  }
  if ((context === "comment-write" || (/\/comments(?:\/|$)/.test(new URL(url).pathname) && method === "POST")) && (code === 10 || code === 200)) {
    return "Facebook n’a pas pu publier votre réponse. Réessayez ou contactez un administrateur.";
  }
  if (context === "comment-read" && (code === 10 || code === 200)) {
    return "Impossible de charger les commentaires Facebook. Réessayez ou contactez un administrateur.";
  }
  if (context === "reaction-read" && (code === 10 || code === 200)) {
    return "Les réactions de cette publication ne sont pas disponibles pour le moment.";
  }
  if (context === "media-write" && (code === 10 || code === 200)) {
    return "Meta n’a pas pu téléverser ce média. Vérifiez le format MP4 ou JPEG/PNG, sa taille et les autorisations de la Page.";
  }
  if ((context === "page-write" || method !== "GET") && (code === 10 || code === 200)) {
    return "Facebook n’a pas pu modifier cette publication. Réessayez ou contactez un administrateur.";
  }
  if (code === 10 || code === 200) {
    return "Facebook n’a pas pu fournir ces données. Contactez un administrateur.";
  }
  return "Facebook n’a pas pu traiter la demande. Réessayez ou contactez un administrateur.";
}

async function requestJson(
  url: string,
  init?: RequestInit,
  provider?: "Meta" | "Groq" | "OpenAI" | "DeepSeek",
  metaContext?: MetaRequestContext,
  timeoutMs = TIMEOUT_MS,
  maxResponseBytes = 1_000_000,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), headers: {
      Accept: "application/json", ...init?.headers,
    } });
  } catch {
    throw new HttpError(400, "Le service n’est pas joignable pour le moment. Réessayez plus tard.");
  }
  let text: string;
  try { text = await boundedResponseText(response, maxResponseBytes); }
  catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Le service n’a pas répondu correctement. Réessayez plus tard.");
  }
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { throw new HttpError(400, "Le service n’a pas répondu correctement. Réessayez plus tard."); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new HttpError(400, "Le service n’a pas répondu correctement. Réessayez plus tard.");
  }
  if (!response.ok) {
    if (provider === "Meta") {
      const error = (payload as Record<string, unknown>).error;
      const code = Number(object(error).code);
      throw new HttpError(400, metaFailureMessage(Number.isFinite(code) ? code : undefined, url, init?.method, metaContext));
    }
    if (provider === "Groq" && response.status === 429) {
      throw new HttpError(429, "Le service de rédaction est momentanément saturé. Réessayez plus tard.");
    }
    if (provider === "OpenAI" && response.status === 429) {
      const error = (payload as Record<string, unknown>).error;
      if (object(error).code === "insufficient_quota") {
        throw new HttpError(402, "Le service de rédaction est indisponible pour le moment. Contactez un administrateur.");
      }
    }
    if (provider === "DeepSeek" && response.status === 429) {
      throw new HttpError(429, "Le service de rédaction est momentanément saturé. Réessayez plus tard.");
    }
    throw new HttpError(400, "La connexion au service a échoué. Vérifiez l’intégration ou contactez un administrateur.");
  }
  return payload as Record<string, unknown>;
}

async function boundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new HttpError(400, "Les données reçues sont trop volumineuses. Réessayez avec une période plus courte.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function apiSuccess(payload: Record<string, unknown>, provider: string, url?: string, method?: string, metaContext?: MetaRequestContext) {
  if (payload.error) {
    if (provider === "Meta" && url) {
      const code = Number(object(payload.error).code);
      throw new HttpError(400, metaFailureMessage(Number.isFinite(code) ? code : undefined, url, method, metaContext));
    }
    throw new HttpError(400, "La connexion au service a échoué. Vérifiez l’intégration ou contactez un administrateur.");
  }
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function metaImageUrl(value: unknown): string {
  const candidate = string(value);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.port || url.username || url.password
      || !(host === "fbcdn.net" || host.endsWith(".fbcdn.net")
        || host === "fbsbx.com" || host.endsWith(".fbsbx.com"))) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function metaVideoUrl(value: unknown): string {
  const candidate = string(value);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.port || url.username || url.password
      || !(host === "fbcdn.net" || host.endsWith(".fbcdn.net")
        || host === "fbsbx.com" || host.endsWith(".fbsbx.com"))) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function metaPostImageUrls(post: Record<string, unknown>): string[] {
  const attachment = object(post.attachments);
  const attachments = Array.isArray(attachment.data) ? attachment.data.map(object) : [];
  const urls = [
    metaImageUrl(post.full_picture),
    ...attachments.flatMap((item) => {
      const media = object(item.media);
      const direct = metaImageUrl(object(media.image).src);
      const subattachments = object(item.subattachments);
      const nested = Array.isArray(subattachments.data) ? subattachments.data.map(object) : [];
      return [direct, ...nested.map((subitem) => metaImageUrl(object(object(subitem.media).image).src))];
    }),
  ];
  return [...new Set(urls.filter(Boolean))];
}

type MetaPostPhotoAsset = { id: string; imageUrl: string };

function metaPostPhotoAssets(post: Record<string, unknown>): MetaPostPhotoAsset[] {
  const attachment = object(post.attachments);
  const attachments = Array.isArray(attachment.data) ? attachment.data.map(object) : [];
  const assets = attachments.flatMap((item) => {
    const subattachments = object(item.subattachments);
    const children = Array.isArray(subattachments.data) ? subattachments.data.map(object) : [];
    const candidates = children.length ? children : [item];
    return candidates.flatMap((candidate) => {
      const id = string(candidate.id) || string(object(candidate.target).id);
      const imageUrl = metaImageUrl(object(object(candidate.media).image).src);
      return id && imageUrl ? [{ id, imageUrl }] : [];
    });
  });
  return assets.filter((asset, index, all) => all.findIndex((item) => item.id === asset.id) === index);
}

async function getMetaPostAttachments(postId: string): Promise<Record<string, unknown>> {
  if (!/^[\d_]{1,100}$/.test(postId)) throw new HttpError(400, "Référence de publication Meta invalide.");
  const fields = "attachments{media_type,type,target{id},media{image{src}},subattachments{data{id,media_type,type,target{id},media{image{src}}}}}";
  const url = `https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(postId)}?${new URLSearchParams({ fields })}`;
  const post = await requestJson(url, {
    headers: { Authorization: ["Bearer", metaPageToken()].join(" ") },
  }, "Meta", "page-read");
  apiSuccess(post, "Meta", url, undefined, "page-read");
  return post;
}

async function fetchMetaPhoto(imageUrl: string) {
  const response = await fetch(imageUrl, {
    headers: { Accept: "image/jpeg,image/png" },
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new HttpError(502, "Meta n’a pas permis de récupérer une photo de l’album.");
  const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (mime !== "image/jpeg" && mime !== "image/png") {
    throw new HttpError(400, "Une photo de cet album utilise un format que Cabalou ne peut pas republier.");
  }
  const bytes = await boundedImageBytes(response);
  const validJpeg = mime === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const validPng = mime === "image/png" && bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  if (!validJpeg && !validPng) throw new HttpError(502, "Meta a retourné une image invalide.");
  return { bytes, type: mime, name: mime === "image/png" ? "photo.png" : "photo.jpg" };
}

async function boundedImageBytes(response: Response): Promise<Uint8Array> {
  const maxBytes = 12_000_000;
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new HttpError(502, "L’image Meta dépasse la taille maximale autorisée.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new HttpError(502, "Meta n’a pas retourné de contenu image.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new HttpError(502, "L’image Meta dépasse la taille maximale autorisée.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function getMetaPostImage(postId: string) {
  if (!/^[\d_]{1,100}$/.test(postId)) throw new HttpError(400, "Référence de publication Meta invalide.");
  const token = metaPageToken();
  const fields = "full_picture,attachments{media{image{src}},subattachments{data{media{image{src}}}}}";
  const url = `https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(postId)}?${new URLSearchParams({ fields })}`;
  const post = await requestJson(url, {
    headers: { Authorization: `Bearer ${token}` },
  }, "Meta", "page-read");
  apiSuccess(post, "Meta", url, undefined, "page-read");

  const imageUrls = metaPostImageUrls(post);
  for (const imageUrl of imageUrls) {
    try {
      const response = await fetch(imageUrl, {
        headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" },
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"].includes(mime)) continue;
      return { data: await boundedImageBytes(response), mime };
    } catch (error) {
      if (error instanceof HttpError) throw error;
    }
  }
  if (imageUrls.length) throw new HttpError(502, "Meta a retourné une image, mais son téléchargement a échoué.");
  throw new HttpError(404, "Aucune image accessible pour cette publication Meta.");
}

export async function listMetaPostPhotoAttachments(postId: string) {
  const post = await getMetaPostAttachments(postId);
  const assets = metaPostPhotoAssets(post);
  if (assets.length < 2) throw new HttpError(400, "La modification des médias est réservée aux albums photo.");
  return {
    attachments: assets.map(({ id }) => ({
      id,
      image_url: `/api/meta/posts/${encodeURIComponent(postId)}/attachments/${encodeURIComponent(id)}`,
    })),
  };
}

export async function getMetaPostPhotoAttachment(postId: string, attachmentId: string) {
  if (!/^[\d_]{1,100}$/.test(attachmentId)) throw new HttpError(400, "Référence de photo Meta invalide.");
  const post = await getMetaPostAttachments(postId);
  const asset = metaPostPhotoAssets(post).find((item) => item.id === attachmentId);
  if (!asset) throw new HttpError(404, "Cette photo n’appartient pas à l’album Meta.");
  return await fetchMetaPhoto(asset.imageUrl);
}

export async function getMetaPostVideo(videoId: string, range?: string) {
  if (!/^[\d_]{1,100}$/.test(videoId)) throw new HttpError(400, "Référence de vidéo Meta invalide.");
  if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) {
    throw new HttpError(400, "Plage de lecture vidéo invalide.");
  }

  const token = metaPageToken();
  const graphUrl = `https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(videoId)}?${new URLSearchParams({ fields: "source" })}`;
  const video = await requestJson(graphUrl, {
    headers: { Authorization: ["Bearer", token].join(" ") },
  }, "Meta", "page-read");
  apiSuccess(video, "Meta", graphUrl, undefined, "page-read");
  let sourceUrl = metaVideoUrl(video.source);
  if (!sourceUrl) throw new HttpError(404, "Meta ne fournit pas de flux vidéo accessible pour cette publication.");

  let response: Response | null = null;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    response = await fetch(sourceUrl, {
      headers: {
        Accept: "video/mp4,application/octet-stream",
        ...(range ? { Range: range } : {}),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    if (!location || redirects === 3) throw new HttpError(502, "Meta a retourné une redirection vidéo invalide.");
    sourceUrl = metaVideoUrl(new URL(location, sourceUrl).toString());
    if (!sourceUrl) throw new HttpError(502, "Meta a redirigé vers une source vidéo non autorisée.");
  }

  if (!response || (response.status !== 200 && response.status !== 206)) {
    throw new HttpError(502, "Meta n’a pas retourné le flux vidéo.");
  }
  const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (mime !== "video/mp4" && mime !== "application/octet-stream") {
    throw new HttpError(502, "Meta a retourné un format vidéo non pris en charge.");
  }
  return {
    body: response.body,
    status: response.status,
    mime,
    contentLength: response.headers.get("content-length"),
    contentRange: response.headers.get("content-range"),
    acceptRanges: response.headers.get("accept-ranges"),
  };
}

export function validateGoogleSearchConsoleDateRange(start: unknown, end: unknown) {
  const parseDate = (value: unknown) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new HttpError(400, "Les dates Search Console doivent être au format AAAA-MM-JJ.");
    }
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
      throw new HttpError(400, "Une date Search Console est invalide.");
    }
    return timestamp;
  };
  const startTimestamp = parseDate(start);
  const endTimestamp = parseDate(end);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (startTimestamp > endTimestamp) throw new HttpError(400, "La date de début doit précéder la date de fin.");
  if (endTimestamp > today.getTime()) throw new HttpError(400, "La date de fin ne peut pas être future.");
  if ((endTimestamp - startTimestamp) / 86_400_000 + 1 > GOOGLE_SEARCH_CONSOLE_MAX_RANGE_DAYS) {
    throw new HttpError(400, "Choisissez une période de 90 jours maximum pour limiter le volume de données.");
  }
  return { startDate: String(start), endDate: String(end) };
}

async function googleAccessToken() {
  configured("google_search_console");
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
    throw new HttpError(400, "La connexion à Google Search Console a échoué. Vérifiez l’intégration ou contactez un administrateur.");
  }
  return token.access_token;
}

async function checkGoogle() {
  const accessToken = await googleAccessToken();
  const sites = await requestJson(`${GOOGLE_SEARCH_CONSOLE}/sites`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  apiSuccess(sites, "Google Search Console");
  const entries = sites.siteEntry;
  if (!Array.isArray(entries)) throw new HttpError(400, "Google Search Console a retourné une liste de sites invalide.");
  if (!entries.some((entry) => entry && typeof entry === "object" && (entry as Record<string, unknown>).siteUrl === process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL)) {
    throw new HttpError(400, "La propriété Search Console configurée n’est pas accessible à ce compte.");
  }
  return "Google Search Console est connecté.";
}

function googleSearchConsoleRow(value: unknown, dimensions: string[]): SeoSearchConsoleMetric {
  const row = object(value);
  const keys = row.keys;
  if (!Array.isArray(keys) || keys.length !== dimensions.length) {
    throw new HttpError(400, "Google Search Console a retourné des dimensions invalides.");
  }
  const values = Object.fromEntries(dimensions.map((dimension, index) => [dimension, keys[index]]));
  const metricDate = string(values.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(metricDate)) {
    throw new HttpError(400, "Google Search Console a retourné une date invalide.");
  }
  const clicks = row.clicks;
  const impressions = row.impressions;
  const ctr = row.ctr;
  const averagePosition = row.position;
  if (typeof clicks !== "number" || !Number.isSafeInteger(clicks) || clicks < 0
    || typeof impressions !== "number" || !Number.isSafeInteger(impressions) || impressions < 0
    || typeof ctr !== "number" || !Number.isFinite(ctr) || ctr < 0 || ctr > 1
    || typeof averagePosition !== "number" || !Number.isFinite(averagePosition) || averagePosition < 0) {
    throw new HttpError(400, "Google Search Console a retourné des métriques invalides.");
  }
  const dimension = (key: string, max: number) => {
    const result = values[key];
    if (result === undefined) return "";
    if (typeof result !== "string" || result.length > max) {
      throw new HttpError(400, "Google Search Console a retourné une dimension invalide.");
    }
    return result;
  };
  return {
    metric_date: metricDate,
    query_text: dimension("query", 1_000),
    page_url: dimension("page", 2_000),
    country: dimension("country", 3),
    device: dimension("device", 16),
    clicks,
    impressions,
    ctr,
    average_position: averagePosition,
  };
}

async function searchConsoleAnalyticsRows(
  accessToken: string,
  startDate: string,
  endDate: string,
  dimensions: string[],
): Promise<SeoSearchConsoleMetric[]> {
  const siteUrl = process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL!.trim();
  const url = `${GOOGLE_SEARCH_CONSOLE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const results: SeoSearchConsoleMetric[] = [];
  let startRow = 0;
  while (true) {
    const rowLimit = Math.min(GOOGLE_SEARCH_CONSOLE_PAGE_SIZE, GOOGLE_SEARCH_CONSOLE_MAX_ROWS - startRow + 1);
    const payload = await requestJson(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ startDate, endDate, dimensions, searchType: "web", rowLimit, startRow }),
    }, undefined, undefined, TIMEOUT_MS, GOOGLE_SEARCH_CONSOLE_MAX_RESPONSE_BYTES);
    apiSuccess(payload, "Google Search Console");
    const rows = payload.rows ?? [];
    if (!Array.isArray(rows)) throw new HttpError(400, "Google Search Console a retourné une liste de résultats invalide.");
    if (rows.length > GOOGLE_SEARCH_CONSOLE_MAX_ROWS - startRow) {
      throw new HttpError(400, "Cette période contient trop de résultats. Réduis la période puis relance la synchronisation.");
    }
    results.push(...rows.map((row) => googleSearchConsoleRow(row, dimensions)));
    if (rows.length < rowLimit) break;
    startRow += rows.length;
  }
  return results;
}

export async function fetchGoogleSearchConsoleMetrics(startDate: string, endDate: string) {
  const range = validateGoogleSearchConsoleDateRange(startDate, endDate);
  const accessToken = await googleAccessToken();
  const [metrics, dailyMetrics] = await Promise.all([
    searchConsoleAnalyticsRows(accessToken, range.startDate, range.endDate, ["date", "query", "page", "country", "device"]),
    searchConsoleAnalyticsRows(accessToken, range.startDate, range.endDate, ["date"]),
  ]);
  return { metrics, dailyMetrics };
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
  if (id === "groq") {
    const config = aiProviderConfig("groq");
    const models = await requestJson(`${GROQ_API}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    }, "Groq");
    apiSuccess(models, "Groq");
    const items = models.data;
    if (!Array.isArray(items) || !items.some((item) => item && typeof item === "object" && (item as Record<string, unknown>).id === config.model)) {
      throw new HttpError(400, `Le modèle Groq « ${config.model} » n’est pas disponible pour ce compte.`);
    }
    return `Groq accessible; le modèle « ${config.model} » est disponible.`;
  }
  if (id === "google_search_console") return checkGoogle();
  if (id === "meta_page") {
    const accountId = process.env.META_PAGE_ID!;
    const token = process.env.META_PAGE_ACCESS_TOKEN!;
    const fields = "id,name";
    const url = `https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(accountId)}?${new URLSearchParams({ fields })}`;
    const result = await requestJson(url, {
      headers: { Authorization: `Bearer ${token}` },
      }, "Meta", "page-read");
      apiSuccess(result, "Meta", url, undefined, "page-read");
    if (string(result.id) !== accountId) throw new HttpError(400, "Meta a retourné un compte différent de celui configuré.");
    return "Jeton Meta valide; Page accessible en lecture.";
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
    return "Le service e-mail est connecté.";
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
    const db = connectDatabase();
    try {
      for (const listing of listings) {
        const item = listing as Record<string, unknown>;
        const externalId = string(item.external_id);
        const name = string(item.name);
        const city = string(item.city);
        const neighborhood = string(item.neighborhood);
        const listingType = string(item.listing_type);
        const features = Array.isArray(item.features) ? item.features.map((feature) => string(feature)).filter(Boolean).join("; ") : "";
        const publicUrl = string(item.public_url);
        const factsCheckedAt = string(item.facts_checked_at);
        if (!externalId || !name || !city || !neighborhood || !listingType || !publicUrl || !factsCheckedAt) {
          throw new HttpError(400, "Un logement retourné par l’API Cabalou est incomplet.");
        }
        let parsedUrl: URL;
        try { parsedUrl = new URL(publicUrl); } catch { throw new HttpError(400, "L’URL publique d’un logement doit utiliser HTTPS."); }
        if (parsedUrl.protocol !== "https:") throw new HttpError(400, "L’URL publique d’un logement doit utiliser HTTPS.");
        const current = await db.prepare("SELECT id FROM listings WHERE external_id=?").get(externalId) as { id: number } | undefined;
        if (current) {
          await db.prepare(`UPDATE listings SET name=?, city=?, neighborhood=?, listing_type=?, features=?,
            public_url=?, facts_checked_at=?, is_demo=0 WHERE id=?`)
            .run(name, city, neighborhood, listingType, features, publicUrl, factsCheckedAt, current.id);
        } else {
          await db.prepare(`INSERT INTO listings
            (external_id, name, city, neighborhood, listing_type, features, public_url, facts_checked_at, is_demo)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`)
            .run(externalId, name, city, neighborhood, listingType, features, publicUrl, factsCheckedAt);
        }
      }
    } finally {
      await db.close();
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

function metaPageToken(): string {
  configured("meta_page");
  return process.env.META_PAGE_ACCESS_TOKEN!;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function graphComments(value: unknown): Record<string, unknown>[] {
  const data = object(value).data;
  return Array.isArray(data) ? data.map(object) : [];
}

function metaComment(comment: Record<string, unknown>) {
  const authorId = string(object(comment.from).id);
  const author = string(object(comment.from).name) || (authorId === process.env.META_PAGE_ID ? "Cabalou Gabon" : "Auteur Facebook");
  return {
    id: string(comment.id),
    message: string(comment.message),
    created_time: string(comment.created_time),
    author,
    is_page_comment: Boolean(authorId && authorId === process.env.META_PAGE_ID),
    replies: graphComments(comment.comments).map((reply) => {
      const replyAuthorId = string(object(reply.from).id);
      return {
        id: string(reply.id),
        message: string(reply.message),
        created_time: string(reply.created_time),
        author: string(object(reply.from).name) || (replyAuthorId === process.env.META_PAGE_ID ? "Cabalou Gabon" : "Auteur Facebook"),
        is_page_comment: Boolean(replyAuthorId && replyAuthorId === process.env.META_PAGE_ID),
      };
    }).sort((a, b) => Date.parse(b.created_time) - Date.parse(a.created_time)),
  };
}

function graphCursor(value: unknown): string {
  const paging = object(object(value).paging);
  const cursors = object(paging.cursors);
  return typeof cursors.after === "string" ? cursors.after : "";
}

function summaryCount(value: unknown): number {
  const count = object(object(value).summary).total_count;
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}

function validMetaCursor(cursor: string): string {
  if (!cursor || cursor.length > 500 || !/^[\w\-+/=]+$/.test(cursor)) {
    throw new HttpError(400, "Curseur Meta invalide.");
  }
  return cursor;
}

async function fetchMetaPostComments(postId: string, after?: string) {
  const query = new URLSearchParams({
    fields: "id,message,created_time,from{id,name},comment_count,comments.limit(10){id,message,created_time,from{id,name}}",
    limit: "20",
    order: "reverse_chronological",
  });
  if (after) query.set("after", validMetaCursor(after));
  const url = `https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(postId)}/comments?${query}`;
  const result = await requestJson(url, {
    headers: { Authorization: `Bearer ${metaPageToken()}` },
  }, "Meta", "comment-read");
  apiSuccess(result, "Meta", url, undefined, "comment-read");
  return {
    comments: graphComments(result).map(metaComment).filter((comment) => comment.id)
      .sort((a, b) => Date.parse(b.created_time) - Date.parse(a.created_time)),
    comments_after: graphCursor(result),
    comments_has_more: Boolean(object(result.paging).next),
  };
}

async function fetchMetaPostViews(postId: string) {
  const query = new URLSearchParams({ metric: "post_media_view" });
  const url = `https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(postId)}/insights?${query}`;
  try {
    const result = await requestJson(url, {
      headers: { Authorization: `Bearer ${metaPageToken()}` },
    }, "Meta", "insights");
    apiSuccess(result, "Meta", url, undefined, "insights");
    const metrics = Array.isArray(result.data) ? result.data.map(object) : [];
    const values = metrics.flatMap((metric) => Array.isArray(metric.values) ? metric.values.map(object) : []);
    const value = values.find((entry) => typeof entry.value === "number")?.value;
    return {
      views: typeof value === "number" ? value : null,
      views_note: typeof value === "number" ? "" : "Aucune donnée de vues pour ce contenu.",
    };
  } catch (error) {
    if (error instanceof HttpError) return { views: null, views_note: error.message };
    throw error;
  }
}

export async function listMetaPageComments(after?: string, refreshOnly = false) {
  const token = metaPageToken();
  const pageId = process.env.META_PAGE_ID!;
  const commentsField = refreshOnly
    ? "comments.limit(20).summary(true){id,message,created_time,from{id,name},comment_count,comments.limit(10){id,message,created_time,from{id,name}}}"
    : "comments.limit(0).summary(true)";
  const fields = `id,message,created_time,permalink_url,full_picture,attachments{id,media_type,type,target{id},media{image{src}},subattachments{data{id,media_type,type,target{id},media{image{src}}}}},reactions.limit(0).summary(true),${commentsField},shares`;
  const query = new URLSearchParams({ fields, limit: "15" });
  if (after) query.set("after", validMetaCursor(after));
  const url = `https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(pageId)}/posts?${query}`;
  const result = await requestJson(
    url,
    { headers: { Authorization: `Bearer ${token}` } },
    "Meta",
    "page-read",
  );
  apiSuccess(result, "Meta", url, undefined, "page-read");
  const posts = Array.isArray(result.data)
    ? (await Promise.all(result.data.map(async (value) => {
      const post = object(value);
      const id = string(post.id);
      if (!id) return null;
      let commentPage: Awaited<ReturnType<typeof fetchMetaPostComments>>;
      let insights: Awaited<ReturnType<typeof fetchMetaPostViews>> | null = null;
      if (refreshOnly) {
        const commentData = object(post.comments);
        commentPage = {
          comments: graphComments(commentData).map(metaComment).filter((comment) => comment.id)
            .sort((a, b) => Date.parse(b.created_time) - Date.parse(a.created_time)),
          comments_after: graphCursor(commentData),
          comments_has_more: Boolean(object(commentData.paging).next),
        };
      } else {
        [commentPage, insights] = await Promise.all([
          fetchMetaPostComments(id),
          fetchMetaPostViews(id),
        ]);
      }
      const attachment = (Array.isArray(object(post.attachments).data)
        ? object(post.attachments).data as unknown[]
        : []).map(object)[0] ?? {};
      const mediaType = string(attachment.media_type) || string(attachment.type);
      const videoId = /video/i.test(mediaType) ? string(object(attachment.target).id) : "";
      const photoAssets = metaPostPhotoAssets(post);
      return {
        id,
        message: string(post.message),
        created_time: string(post.created_time),
        permalink_url: string(post.permalink_url),
        picture: metaPostImageUrls(post)[0] ?? "",
        media_type: mediaType,
        video_id: videoId,
        media_items_count: photoAssets.length,
        reactions_count: summaryCount(post.reactions),
        comments_count: summaryCount(post.comments),
        shares_count: Number(object(post.shares).count) || 0,
        ...(insights ?? {}),
        ...commentPage,
      };
    }))).filter((post): post is NonNullable<typeof post> => post !== null)
      .sort((a, b) => Date.parse(b.created_time) - Date.parse(a.created_time))
    : [];
  return {
    posts,
    posts_after: graphCursor(result),
    posts_has_more: Boolean(object(result.paging).next),
    fetched_at: new Date().toISOString(),
  };
}

function scheduledPublishTimeIso(value: unknown): string | null {
  const timestamp = typeof value === "number"
    ? new Date(value * 1000)
    : typeof value === "string" && /^\d+$/u.test(value)
      ? new Date(Number(value) * 1000)
      : typeof value === "string"
        ? new Date(value)
        : null;
  return timestamp && Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
}

export async function listMetaScheduledPagePosts() {
  const token = metaPageToken();
  const pageId = process.env.META_PAGE_ID!;
  const fields = "id,message,is_published,scheduled_publish_time,permalink_url,full_picture";
  const posts: {
    id: string;
    message: string;
    scheduled_publish_time: string;
    permalink_url: string;
    picture: string;
  }[] = [];
  const seenCursors = new Set<string>();
  let after = "";
  while (true) {
    const query = new URLSearchParams({ fields, limit: "100" });
    if (after) query.set("after", after);
    const url = `https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(pageId)}/scheduled_posts?${query}`;
    const result = await requestJson(
      url,
      { headers: { Authorization: `Bearer ${token}` } },
      "Meta",
      "page-read",
    );
    apiSuccess(result, "Meta", url, undefined, "page-read");
    if (Array.isArray(result.data)) {
      posts.push(...result.data.map(object).flatMap((post) => {
      const scheduledTime = scheduledPublishTimeIso(post.scheduled_publish_time);
      if (post.is_published === true || !scheduledTime || !string(post.id)) return [];
      return [{
        id: string(post.id),
        message: string(post.message),
        scheduled_publish_time: scheduledTime,
        permalink_url: string(post.permalink_url),
        picture: string(post.full_picture),
      }];
    }));
    }
    const nextCursor = graphCursor(result);
    if (!nextCursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    after = nextCursor;
  }
  posts.sort((a, b) => Date.parse(a.scheduled_publish_time) - Date.parse(b.scheduled_publish_time));
  return { posts, fetched_at: new Date().toISOString() };
}

export async function listMetaPostComments(postId: string, after?: string) {
  if (!/^[\d_]{1,100}$/.test(postId)) throw new HttpError(400, "Référence de publication Meta invalide.");
  return fetchMetaPostComments(postId, after);
}

export async function listMetaPostReactions(postId: string, after?: string) {
  if (!/^[\d_]{1,100}$/.test(postId)) throw new HttpError(400, "Référence de publication Meta invalide.");
  const query = new URLSearchParams({ fields: "id,name,type", limit: "100", summary: "total_count" });
  if (after) query.set("after", validMetaCursor(after));
  const url = `https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(postId)}/reactions?${query}`;
  const result = await requestJson(url, {
    headers: { Authorization: ["Bearer", metaPageToken()].join(" ") },
  }, "Meta", "reaction-read");
  apiSuccess(result, "Meta", url, undefined, "reaction-read");
  const reactions = Array.isArray(result.data) ? result.data.map(object) : [];
  return {
    reactions: reactions.map((reaction) => ({
      id: string(reaction.id),
      name: string(reaction.name) || "Nom non fourni par Meta",
      type: string(reaction.type),
    })).filter((reaction) => reaction.id),
    reactions_after: graphCursor(result),
    reactions_has_more: Boolean(object(result.paging).next),
    reactions_count: summaryCount(result),
  };
}

export async function addMetaPostComment(postId: string, value: unknown) {
  if (!/^[\d_]{1,100}$/.test(postId)) throw new HttpError(400, "Référence de publication Meta invalide.");
  const message = cleanText(value, "commentaire", 2000);
  const url = `https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(postId)}/comments`;
  const result = await requestJson(url, {
    method: "POST",
    headers: {
      Authorization: ["Bearer", metaPageToken()].join(" "),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ message }),
  }, "Meta", "comment-write");
  apiSuccess(result, "Meta", url, "POST", "comment-write");
  if (!string(result.id)) throw new HttpError(400, "Meta n’a pas confirmé la publication du commentaire.");
  return { id: string(result.id) };
}

export async function listOlderMetaPostComments(postId: string, after: string) {
  if (!/^[\d_]{1,100}$/.test(postId)) throw new HttpError(400, "Référence de publication Meta invalide.");
  return fetchMetaPostComments(postId, after);
}

function validateMetaScheduledPublishTime(scheduledAt?: unknown): number | null {
  if (scheduledAt !== undefined && scheduledAt !== null && scheduledAt !== "") {
    if (typeof scheduledAt !== "string") throw new HttpError(400, "La date de programmation est invalide.");
    const scheduledAtMs = Date.parse(scheduledAt);
    const leadTimeMs = scheduledAtMs - Date.now();
    if (!Number.isFinite(scheduledAtMs) || leadTimeMs < META_SCHEDULE_MIN_LEAD_TIME_MS
      || leadTimeMs > META_SCHEDULE_MAX_LEAD_TIME_MS) {
      throw new HttpError(400, "Choisis un horaire compris entre 10 minutes et 30 jours à partir de maintenant.");
    }
    return Math.floor(scheduledAtMs / 1000);
  }
  return null;
}

export async function publishMetaPagePost(value: unknown, scheduledAt?: unknown) {
  const message = cleanText(value, "publication", 5000);
  const scheduledPublishTime = validateMetaScheduledPublishTime(scheduledAt);
  const pageId = process.env.META_PAGE_ID!;
  const url = `https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(pageId)}/feed`;
  const form = new URLSearchParams({ message });
  if (scheduledPublishTime !== null) {
    form.set("published", "false");
    form.set("scheduled_publish_time", String(scheduledPublishTime));
  }
  const result = await requestJson(url, {
    method: "POST",
    headers: {
      Authorization: ["Bearer", metaPageToken()].join(" "),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  }, "Meta", "page-write");
  apiSuccess(result, "Meta", url, "POST", "page-write");
  if (!string(result.id)) throw new HttpError(400, "Meta n’a pas confirmé la publication.");
  return scheduledPublishTime === null
    ? { id: string(result.id) }
    : { id: string(result.id), scheduled_publish_time: new Date(scheduledPublishTime * 1000).toISOString() };
}

type MetaPageMedia = { name: string; type: string; bytes: Uint8Array };

async function uploadUnpublishedMetaPhoto(
  pageId: string,
  media: MetaPageMedia,
  token: string,
  scheduledPublishTime: number | null,
): Promise<string> {
  const url = `https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(pageId)}/photos`;
  const form = new FormData();
  const blobBuffer = new ArrayBuffer(media.bytes.byteLength);
  new Uint8Array(blobBuffer).set(media.bytes);
  form.append("source", new Blob([blobBuffer], { type: media.type }), media.name);
  form.append("published", "false");
  if (scheduledPublishTime !== null) form.append("temporary", "true");
  const result = await requestJson(url, {
    method: "POST",
    headers: { Authorization: ["Bearer", token].join(" ") },
    body: form,
  }, "Meta", "media-write", 5 * 60_000);
  apiSuccess(result, "Meta", url, "POST", "media-write");
  const id = string(result.id);
  if (!id) throw new HttpError(400, "Meta n’a pas confirmé le téléversement d’une photo.");
  return id;
}

async function publishMetaPhotoAlbum(
  message: string,
  media: MetaPageMedia[],
  pageId: string,
  token: string,
  scheduledPublishTime: number | null = null,
) {
  if (media.length > META_PAGE_ALBUM_MAX_PHOTOS) {
    throw new HttpError(400, `Une publication peut contenir jusqu’à ${META_PAGE_ALBUM_MAX_PHOTOS} photos.`);
  }
  const photoIds: string[] = [];
  for (const photo of media) photoIds.push(await uploadUnpublishedMetaPhoto(pageId, photo, token, scheduledPublishTime));

  const url = `https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(pageId)}/feed`;
  const form = new FormData();
  if (message) form.append("message", message);
  photoIds.forEach((id, index) => form.append(`attached_media[${index}]`, JSON.stringify({ media_fbid: id })));
  if (scheduledPublishTime !== null) {
    form.append("published", "false");
    form.append("scheduled_publish_time", String(scheduledPublishTime));
    form.append("unpublished_content_type", "SCHEDULED");
  }
  const result = await requestJson(url, {
    method: "POST",
    headers: { Authorization: ["Bearer", token].join(" ") },
    body: form,
  }, "Meta", "media-write", 5 * 60_000);
  apiSuccess(result, "Meta", url, "POST", "media-write");
  const id = string(result.id);
  if (!id) throw new HttpError(400, "Meta n’a pas confirmé la publication de l’album.");
  return scheduledPublishTime === null
    ? { id }
    : { id, scheduled_publish_time: new Date(scheduledPublishTime * 1000).toISOString() };
}

export async function replaceMetaPagePostPhotos(postId: string, value: unknown, removedIds: unknown) {
  if (!/^[\d_]{1,100}$/.test(postId)) throw new HttpError(400, "Référence de publication Meta invalide.");
  const message = cleanText(value ?? "", "publication", 5000, false);
  if (!Array.isArray(removedIds) || !removedIds.length
    || removedIds.length > META_PAGE_ALBUM_MAX_PHOTOS
    || !removedIds.every((id) => typeof id === "string" && /^[\d_]{1,100}$/.test(id))
    || new Set(removedIds).size !== removedIds.length) {
    throw new HttpError(400, "Sélectionnez au moins une photo valide à retirer.");
  }

  const post = await getMetaPostAttachments(postId);
  const assets = metaPostPhotoAssets(post);
  if (assets.length < 2) throw new HttpError(400, "La modification des médias est réservée aux albums photo.");
  if (!removedIds.every((id) => assets.some((asset) => asset.id === id))) {
    throw new HttpError(400, "Une photo sélectionnée ne fait plus partie de cet album. Actualisez la veille.");
  }
  const remaining = assets.filter((asset) => !removedIds.includes(asset.id));
  if (!remaining.length && !message) {
    throw new HttpError(400, "Ajoutez un texte si vous souhaitez retirer toutes les photos.");
  }

  const media: MetaPageMedia[] = [];
  for (const asset of remaining) {
    const photo = await fetchMetaPhoto(asset.imageUrl);
    media.push({ ...photo, name: `${asset.id}.${photo.type === "image/png" ? "png" : "jpg"}` });
  }

  const pageId = process.env.META_PAGE_ID!;
  const token = metaPageToken();
  const replacement = media.length
    ? await publishMetaPhotoAlbum(message, media, pageId, token)
    : await publishMetaPagePost(message);

  try {
    await deleteMetaPagePost(postId);
  } catch {
    throw new HttpError(502, `La nouvelle publication ${replacement.id} a été créée, mais l’ancienne n’a pas pu être supprimée. Les deux peuvent être visibles; vérifiez Facebook avant de réessayer.`);
  }
  return { id: replacement.id, replaced_id: postId };
}

export async function publishMetaPageMedia(
  value: unknown,
  selectedMedia: MetaPageMedia | MetaPageMedia[],
  scheduledAt?: unknown,
) {
  const message = cleanText(value ?? "", "publication", 5000, false);
  const media = Array.isArray(selectedMedia) ? selectedMedia : [selectedMedia];
  const scheduledPublishTime = validateMetaScheduledPublishTime(scheduledAt);
  if (!media.length) throw new HttpError(400, "Ajoutez des photos ou une vidéo à la publication.");
  if (media.length > META_PAGE_ALBUM_MAX_PHOTOS) {
    throw new HttpError(400, `Une publication peut contenir jusqu’à ${META_PAGE_ALBUM_MAX_PHOTOS} photos.`);
  }
  if (media.some((item) => !item.bytes.byteLength)) throw new HttpError(400, "Un fichier média est vide.");
  const allImages = media.every((item) => item.type === "image/jpeg" || item.type === "image/png");
  const isVideo = media.length === 1 && media[0].type === "video/mp4";
  if ((!allImages && !isVideo) || media.some((item) => !["image/jpeg", "image/png", "video/mp4"].includes(item.type))) {
    throw new HttpError(400, "Utilisez plusieurs images JPEG/PNG ou une seule vidéo MP4, sans mélanger les formats.");
  }
  for (const item of media) {
    const itemIsVideo = item.type === "video/mp4";
    const sizeLimit = itemIsVideo ? META_PAGE_VIDEO_MAX_BYTES : META_PAGE_IMAGE_MAX_BYTES;
    if (item.bytes.byteLength > sizeLimit) {
      throw new HttpError(400, itemIsVideo ? "La vidéo MP4 ne doit pas dépasser 100 Mo." : "Chaque photo ne doit pas dépasser 10 Mo.");
    }
  }
  if (!message && !allImages) throw new HttpError(400, "Ajoutez un texte ou une légende à la vidéo.");

  const pageId = process.env.META_PAGE_ID!;
  const token = metaPageToken();
  if (allImages && (media.length > 1 || scheduledPublishTime !== null)) {
    return publishMetaPhotoAlbum(message, media, pageId, token, scheduledPublishTime);
  }

  const file = media[0];
  const fileIsImage = file.type === "image/jpeg" || file.type === "image/png";
  const endpoint = fileIsImage ? "photos" : "videos";
  const baseUrl = fileIsImage ? "https://graph.facebook.com" : "https://graph-video.facebook.com";
  const url = `${baseUrl}/${META_VERSION}/${encodeURIComponent(pageId)}/${endpoint}`;
  const form = new FormData();
  const blobBuffer = new ArrayBuffer(file.bytes.byteLength);
  new Uint8Array(blobBuffer).set(file.bytes);
  form.append("source", new Blob([blobBuffer], { type: file.type }), file.name);
  form.append(fileIsImage ? "caption" : "description", message);
  form.append("published", scheduledPublishTime === null ? "true" : "false");
  if (scheduledPublishTime !== null) {
    form.append("scheduled_publish_time", String(scheduledPublishTime));
  }
  const result = await requestJson(url, {
    method: "POST",
    headers: { Authorization: ["Bearer", token].join(" ") },
    body: form,
  }, "Meta", "page-write", 5 * 60_000);
  apiSuccess(result, "Meta", url, "POST", "page-write");
  const id = string(result.post_id) || string(result.id);
  if (!id) throw new HttpError(400, "Meta n’a pas confirmé la publication du média.");
  return scheduledPublishTime === null
    ? { id }
    : { id, scheduled_publish_time: new Date(scheduledPublishTime * 1000).toISOString() };
}

export async function editMetaPagePost(postId: string, value: unknown) {
  if (!/^[\d_]{1,100}$/.test(postId)) throw new HttpError(400, "Référence de publication Meta invalide.");
  const message = cleanText(value, "publication", 5000);
  const url = `https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(postId)}`;
  const result = await requestJson(url, {
    method: "POST",
    headers: {
      Authorization: ["Bearer", metaPageToken()].join(" "),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ message }),
  }, "Meta", "page-write");
  apiSuccess(result, "Meta", url, "POST", "page-write");
  if (result.success !== true) throw new HttpError(400, "Meta n’a pas confirmé la modification.");
  return { id: postId };
}

export async function deleteMetaPagePost(postId: string) {
  if (!/^[\d_]{1,100}$/.test(postId)) throw new HttpError(400, "Référence de publication Meta invalide.");
  const url = `https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(postId)}`;
  const result = await requestJson(url, {
    method: "DELETE",
    headers: { Authorization: ["Bearer", metaPageToken()].join(" ") },
  }, "Meta", "page-write");
  apiSuccess(result, "Meta", url, "DELETE", "page-write");
  if (result.success !== true) throw new HttpError(400, "Meta n’a pas confirmé la suppression.");
  return { id: postId };
}

export async function deleteMetaComment(commentId: string, allowOtherAuthors = false) {
  if (!/^[\d_]{1,100}$/.test(commentId)) throw new HttpError(400, "Référence de commentaire Meta invalide.");
  if (!allowOtherAuthors) await requireMetaPageComment(commentId);
  const url = `https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(commentId)}`;
  const result = await requestJson(url, {
    method: "DELETE",
    headers: { Authorization: ["Bearer", metaPageToken()].join(" ") },
  }, "Meta", "comment-write");
  apiSuccess(result, "Meta", url, "DELETE", "comment-write");
  if (result.success !== true) throw new HttpError(400, "Meta n’a pas confirmé la suppression du commentaire.");
  return { id: commentId };
}

export async function editMetaComment(commentId: string, value: unknown) {
  if (!/^[\d_]{1,100}$/.test(commentId)) throw new HttpError(400, "Référence de commentaire Meta invalide.");
  const message = cleanText(value, "commentaire", 2000);
  await requireMetaPageComment(commentId);
  const url = `https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(commentId)}`;
  const result = await requestJson(url, {
    method: "POST",
    headers: {
      Authorization: ["Bearer", metaPageToken()].join(" "),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ message }),
  }, "Meta", "comment-write");
  apiSuccess(result, "Meta", url, "POST", "comment-write");
  if (result.success !== true && !string(result.id)) {
    throw new HttpError(400, "Meta n’a pas confirmé la modification du commentaire.");
  }
  return { id: commentId };
}

async function requireMetaPageComment(commentId: string) {
  const query = new URLSearchParams({ fields: "id,from{id}" });
  const url = `https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(commentId)}?${query}`;
  const result = await requestJson(url, {
    headers: { Authorization: ["Bearer", metaPageToken()].join(" ") },
  }, "Meta", "comment-read");
  apiSuccess(result, "Meta", url, undefined, "comment-read");
  if (string(result.id) !== commentId) {
    throw new HttpError(404, "Commentaire introuvable sur la Page Meta configurée.");
  }
  if (string(object(result.from).id) !== process.env.META_PAGE_ID) {
    throw new HttpError(403, "Seuls les commentaires publiés par la Page Cabalou peuvent être modifiés ou supprimés par leur auteur.");
  }
}

export async function replyToMetaComment(commentId: string, value: unknown) {
  if (!/^[\d_]{1,100}$/.test(commentId)) throw new HttpError(400, "Référence de commentaire Meta invalide.");
  const message = cleanText(value, "réponse", 2000);
  const url = `https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(commentId)}/comments`;
  const result = await requestJson(
    url,
    {
      method: "POST",
      headers: {
        Authorization: ["Bearer", metaPageToken()].join(" "),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ message }),
    },
    "Meta",
    "comment-write",
  );
  apiSuccess(result, "Meta", url, "POST", "comment-write");
  if (!string(result.id)) throw new HttpError(400, "Meta n’a pas confirmé la publication de la réponse.");
  return { id: string(result.id) };
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
  const providers = aiProviderCascade();
  const primaryProvider = providers[0];
  if (primaryProvider.id !== "deepseek") configured(primaryProvider.id);
  const channel = cleanText(data.channel, "réseau", 20);
  if (channel !== "facebook") throw new HttpError(400, "Le réseau doit être Facebook.");
  const objective = cleanText(data.objective, "objectif", 240);
  const tone = cleanText(data.tone, "ton", 120);
  const audience = cleanText(data.audience ?? "", "public visé", 160, false);
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
  const instructions = "Tu es l’assistant de rédaction marketing de Cabalou. Rédige uniquement un brouillon en français pour le canal indiqué. Utilise seulement les faits explicitement fournis, y compris les lieux, quartiers et équipements mentionnés dans le brief ou les faits vérifiés. N’invente jamais prix, disponibilité, remise, équipement, adresse précise, capacité ou caractéristique. Si des informations doivent être vérifiées, ne les place pas dans la légende : termine la légende sans note interne, puis ajoute une liste séparée commençant exactement par «À vérifier:» suivie des éléments à confirmer. Ajoute 3 à 5 hashtags pertinents à la fin de la légende, en cohérence avec le Gabon et Cabalou. Ne prétends pas avoir vérifié les faits. N’inclus aucune donnée personnelle. Pas de garantie de réservation ni de promesse de résultat. La sortie sera revue par une personne.";
  const input = [
    `Canal : ${channel}`, `Objectif : ${objective}`, `Ton : ${tone}`,
    `Public visé : ${audience || "Non précisé."}`,
    `Brief de l’opérateur : ${brief || "Aucun brief complémentaire."}`,
    "Faits publiables vérifiés :", ...(facts.length ? facts.map((fact) => `- ${fact}`) : ["- Aucun fait fourni."]),
  ].join("\n");
  for (const [index, provider] of providers.entries()) {
    try {
      const response = await requestJson(`${provider.apiUrl}/chat/completions`, {
        method: "POST", headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: provider.model,
          messages: [{ role: "system", content: instructions }, { role: "user", content: input }],
          ...(provider.id === "deepseek" ? { thinking: { type: "disabled" } } : {}),
          max_tokens: 700,
        }),
      }, provider.id === "deepseek" ? "DeepSeek" : provider.id === "groq" ? "Groq" : "OpenAI");
      apiSuccess(response, provider.name);
      const choices = Array.isArray(response.choices) ? response.choices : [];
      const firstChoice = choices[0] && typeof choices[0] === "object" ? choices[0] as Record<string, unknown> : {};
      const message = firstChoice.message && typeof firstChoice.message === "object" ? firstChoice.message as Record<string, unknown> : {};
      const output = string(message.content);
      if (!output.trim() || output.length > 5000) throw new HttpError(400, `${provider.name} n’a pas retourné de brouillon exploitable.`);
      const lines = output.trim().split(/\r?\n/u);
      const noteIndex = lines.findIndex((line) => /^À\s*vérifier\s*:/iu.test(line.trim()));
      const body = (noteIndex >= 0 ? lines.slice(0, noteIndex) : lines).join("\n").trim();
      const notes = noteIndex >= 0
        ? lines.slice(noteIndex).join("\n").replace(/^À\s*vérifier\s*:\s*/iu, "").trim()
        : "";
      return { body, notes, model: provider.model, listingId };
    } catch (error) {
      if (!(error instanceof HttpError) || index === providers.length - 1) throw error;
    }
  }
  throw new HttpError(503, "Aucun fournisseur IA n’a pu générer le brouillon.");
}
