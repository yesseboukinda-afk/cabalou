import { HttpError } from "./security";
import { aiProviderConfig, aiProviderError, selectedAiProvider, type AiProviderConfig } from "./ai-provider";
const CHAT_VIEWS = ["dashboard", "content", "calendar", "comments", "workflows", "seo", "reports", "users", "audit", "integrations"] as const;
type ChatView = typeof CHAT_VIEWS[number];
type ChatRole = "user" | "assistant";
type AssistantOperation = {
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  summary: string;
  payload: Record<string, unknown>;
};

type AssistantAction = {
  type: "none" | "navigate" | "open_content_create" | "prepare_content" | "prepare_meta_post" | "execute";
  view: ChatView | null;
  content: {
    title: string;
    objective: string;
    tone: string;
    audience: string;
    brief: string;
    channel: "facebook" | "tiktok";
  } | null;
  meta_post: { message: string } | null;
  operation: AssistantOperation | null;
};

function isChatView(value: unknown): value is ChatView {
  return typeof value === "string" && CHAT_VIEWS.includes(value as ChatView);
}

function containsPersonalContact(text: string): boolean {
  const hasEmail = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u.test(text);
  const withoutDates = text.replace(/\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/gu, "");
  const hasPhone = [...withoutDates.matchAll(/(?<!\w)\+?\d[\d\s().-]{6,}\d(?!\w)/gu)]
    .some((match) => (match[0].match(/\d/gu) ?? []).length >= 8);
  const hasApiSecret = /\b(?:sk-[A-Za-z0-9_-]{20,}|Bearer\s+\S{20,})\b/iu.test(text);
  return hasEmail || hasPhone || hasApiSecret;
}

function roleCanEdit(role: string) {
  return ["admin", "marketing_manager", "operator"].includes(role);
}

function isAllowedAssistantOperation(method: string, path: string, role: string) {
  const canEdit = roleCanEdit(role);
  const canReview = role === "admin" || role === "marketing_manager";
  if (method === "POST") {
    if (path === "/api/users") return role === "admin";
    if (path === "/api/posts" || path === "/api/reports" || path === "/api/seo/manual"
      || path === "/api/meta/posts") return canEdit;
    if (/^\/api\/meta\/posts\/[\w.-]+\/replace-media$/u.test(path)) return canReview;
    if (/^\/api\/meta\/posts\/[\w.-]+\/comments$/u.test(path)
      || /^\/api\/meta\/comments\/[\w.-]+\/reply$/u.test(path)
      || /^\/api\/posts\/\d+\/submit$/u.test(path)
      || /^\/api\/posts\/\d+\/published-manual$/u.test(path)
      || /^\/api\/workflows\/(?:social|groups|b2b|reactivation|retargeting)$/u.test(path)
      || path === "/api/workflows/seo-targets"
      || /^\/api\/workflows\/(?:social|groups|b2b|reactivation|retargeting)\/\d+\/[a-z-]+$/u.test(path)
      || /^\/api\/workflows\/seo-targets\/\d+$/u.test(path)) return canEdit;
    if (/^\/api\/posts\/\d+\/(?:approve|reject)$/u.test(path)) return canReview;
    if (/^\/api\/integrations\/[a-z_]+\/check$/u.test(path)) return role === "admin";
    return false;
  }
  if (method === "PATCH") {
    return canEdit && (/^\/api\/posts\/\d+$/u.test(path)
      || /^\/api\/meta\/comments\/[\w.-]+$/u.test(path)
      || /^\/api\/meta\/posts\/[\w.-]+$/u.test(path))
      || role === "admin" && /^\/api\/users\/\d+$/u.test(path);
  }
  if (method === "DELETE") {
    return canEdit && /^\/api\/meta\/comments\/[\w.-]+$/u.test(path)
      || canReview && /^\/api\/meta\/posts\/[\w.-]+$/u.test(path)
      || canEdit && /^\/api\/posts\/\d+\/image$/u.test(path);
  }
  return false;
}

function validateOperation(value: unknown, role: string): AssistantOperation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(502, "L’assistant a proposé une action incomplète. Reformulez votre demande.");
  }
  const operation = value as Record<string, unknown>;
  if ((operation.method !== "POST" && operation.method !== "PATCH" && operation.method !== "DELETE")
    || typeof operation.path !== "string" || !isAllowedAssistantOperation(operation.method, operation.path, role)) {
    throw new HttpError(403, "Cette opération n’est pas disponible pour votre rôle ou n’est pas prise en charge.");
  }
  if (typeof operation.summary !== "string" || !operation.summary.trim() || operation.summary.length > 300
    || containsPersonalContact(operation.summary)) {
    throw new HttpError(502, "L’assistant n’a pas décrit clairement l’opération proposée.");
  }
  let payload: unknown;
  if (typeof operation.payload_json !== "string" || operation.payload_json.length > 6000) {
    throw new HttpError(502, "Les paramètres de l’opération sont invalides ou trop volumineux.");
  }
  try { payload = JSON.parse(operation.payload_json); }
  catch { throw new HttpError(502, "Les paramètres de l’opération ne sont pas un JSON valide."); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new HttpError(502, "Les paramètres de l’opération doivent être un objet valide.");
  }
  const payloadText = JSON.stringify(payload);
  if (containsPersonalContact(payloadText)
    || /"(?:password|passphrase|api[_-]?key|access[_-]?token|refresh[_-]?token|secret)"\s*:/iu.test(payloadText)) {
    throw new HttpError(400, "L’opération contient une coordonnée ou un secret interdit.");
  }
  if (operation.path === "/api/users" && Object.keys(payload).length > 0) {
    throw new HttpError(400, "Les informations du nouveau compte doivent être saisies dans le formulaire sécurisé de confirmation.");
  }
  return {
    method: operation.method,
    path: operation.path,
    summary: operation.summary.trim(),
    payload: payload as Record<string, unknown>,
  };
}

function validateAction(value: unknown, allowedViews: ChatView[], role: string): AssistantAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(502, "L’assistant a retourné une action invalide. Reformulez votre demande.");
  }
  const action = value as Record<string, unknown>;
  if (action.type === "open") action.type = "navigate";
  if (action.type === "none" && action.view === null && action.content === null
    && action.meta_post === null && action.operation === null) {
    return { type: "none", view: null, content: null, meta_post: null, operation: null };
  }
  if (action.type === "navigate" && isChatView(action.view) && allowedViews.includes(action.view)
    && action.content === null && action.meta_post === null && action.operation === null) {
    return { type: "navigate", view: action.view, content: null, meta_post: null, operation: null };
  }
  if ((action.type === "open_content_create" || action.type === "prepare_content")
    && action.view === "content" && allowedViews.includes("content") && action.operation === null && action.meta_post === null) {
    if (action.type === "open_content_create" && action.content === null) {
      return { type: "open_content_create", view: "content", content: null, meta_post: null, operation: null };
    }
    if (action.type === "prepare_content" && action.content && typeof action.content === "object" && !Array.isArray(action.content)) {
      const content = action.content as Record<string, unknown>;
      const fields = ["title", "objective", "tone", "audience", "brief"];
      if (fields.some((field) => typeof content[field] !== "string" || (content[field] as string).length > (field === "brief" ? 1200 : 240))) {
        throw new HttpError(502, "L’assistant a proposé un brouillon invalide. Reformulez votre demande.");
      }
      if (fields.some((field) => containsPersonalContact(content[field] as string))) {
        throw new HttpError(502, "Le brouillon proposé semble contenir une coordonnée ou un secret. Retirez-le avant de continuer.");
      }
      if (content.channel !== "facebook" && content.channel !== "tiktok") {
        throw new HttpError(502, "L’assistant a proposé un réseau invalide. Reformulez votre demande.");
      }
      return {
        type: "prepare_content",
        view: "content",
        content: {
          title: content.title as string,
          objective: content.objective as string,
          tone: content.tone as string,
          audience: content.audience as string,
          brief: content.brief as string,
          channel: content.channel,
        },
        meta_post: null,
        operation: null,
      };
    }
  }
  if (action.type === "prepare_meta_post" && action.view === "comments" && allowedViews.includes("comments")
    && action.content === null && action.operation === null && action.meta_post
    && typeof action.meta_post === "object" && !Array.isArray(action.meta_post)) {
    const metaPost = action.meta_post as Record<string, unknown>;
    if (typeof metaPost.message !== "string" || !metaPost.message.trim() || metaPost.message.length > 5000
      || containsPersonalContact(metaPost.message)) {
      throw new HttpError(502, "Le texte proposé pour la publication est invalide ou contient une coordonnée.");
    }
    return {
      type: "prepare_meta_post",
      view: "comments",
      content: null,
      meta_post: { message: metaPost.message.trim() },
      operation: null,
    };
  }
  if (action.type === "execute" && action.view === null && action.content === null && action.meta_post === null) {
    return {
      type: "execute",
      view: null,
      content: null,
      meta_post: null,
      operation: validateOperation(action.operation, role),
    };
  }
  const actionType = typeof action.type === "string" ? ` « ${action.type} »` : "";
  throw new HttpError(502, `L’action${actionType} proposée est incompatible avec les autorisations ou les paramètres attendus. Reformulez la demande.`);
}

function parseReply(payload: Record<string, unknown>, provider: AiProviderConfig): { reply: string; action: unknown } {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = choices[0] && typeof choices[0] === "object" ? choices[0] as Record<string, unknown> : {};
  const message = firstChoice.message && typeof firstChoice.message === "object" ? firstChoice.message as Record<string, unknown> : {};
  const content = typeof message.content === "string"
    ? message.content
    : Array.isArray(message.content)
      ? message.content.flatMap((part) => part && typeof part === "object"
        && typeof (part as Record<string, unknown>).text === "string"
        ? [(part as Record<string, unknown>).text as string]
        : []).join("\n")
      : "";
  if (!content) {
    throw new HttpError(502, `${provider.name} a répondu sans contenu exploitable.`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(content); }
  catch { throw new HttpError(502, `${provider.name} a répondu, mais le format JSON attendu est invalide.`); }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const result = parsed as Record<string, unknown>;
    if (typeof result.reply === "string" && result.action) return { reply: result.reply, action: result.action };
  }
  throw new HttpError(502, `${provider.name} a répondu, mais sans les champs « reply » et « action » attendus.`);
}

class AssistantProviderFailure extends Error {
  constructor(readonly publicError: HttpError, readonly canFallback: boolean) {
    super(publicError.message);
  }
}

async function requestAssistantReply(
  provider: AiProviderConfig,
  messages: Array<{ role: ChatRole | "system"; content: string }>,
  schema: Record<string, unknown>,
): Promise<{ reply: string; action: unknown }> {
  let response: Response;
  try {
    response = await fetch(`${provider.apiUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: provider.model,
        messages,
        response_format: provider.id === "groq"
          ? { type: "json_object" }
          : { type: "json_schema", json_schema: { name: "cabalou_site_assistant", strict: true, schema } },
        max_tokens: 700,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new AssistantProviderFailure(
      new HttpError(503, `${provider.name} est injoignable. Vérifiez la connexion puis réessayez.`),
      true,
    );
  }
  if (!response.ok) {
    const canFallback = response.status === 401 || response.status === 402 || response.status === 403
      || response.status === 404 || response.status === 408 || response.status === 429 || response.status >= 500;
    throw new AssistantProviderFailure(await aiProviderError(response, provider.id), canFallback);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await response.json() as Record<string, unknown>;
  } catch {
    throw new AssistantProviderFailure(
      new HttpError(502, `${provider.name} a retourné une réponse invalide.`),
      true,
    );
  }
  if (payload.error) {
    const providerError = payload.error && typeof payload.error === "object" && !Array.isArray(payload.error)
      ? payload.error as Record<string, unknown>
      : {};
    throw new AssistantProviderFailure(
      new HttpError(502, `${provider.name} a refusé la demande. Vérifiez l’accès au modèle configuré${typeof providerError.code === "string" ? ` (${providerError.code})` : ""}.`),
      true,
    );
  }
  try {
    return parseReply(payload, provider);
  } catch (error) {
    if (error instanceof HttpError) throw new AssistantProviderFailure(error, true);
    throw error;
  }
}

export async function chatWithSiteAssistant(data: Record<string, unknown>, role: string) {
  const selectedProvider = selectedAiProvider();
  const groqConfigured = Boolean(process.env.GROQ_API_KEY?.trim());
  const openAiConfigured = Boolean(process.env.OPENAI_API_KEY?.trim() && process.env.OPENAI_MODEL?.trim());
  let provider = selectedProvider === "openai" && !openAiConfigured && groqConfigured
    ? aiProviderConfig("groq")
    : aiProviderConfig(selectedProvider);
  const fallbackProvider = provider.id === "openai" && groqConfigured ? aiProviderConfig("groq") : null;
  let fallbackUsed = provider.id === "groq" && selectedProvider === "openai";
  if (typeof data.message !== "string" || !data.message.trim() || data.message.length > 2000) {
    throw new HttpError(400, "Le message doit contenir au maximum 2 000 caractères.");
  }
  if (containsPersonalContact(data.message)) {
    throw new HttpError(400, "Ne transmettez pas de coordonnées personnelles ou de secret à l’assistant.");
  }
  const conversation = Array.isArray(data.conversation) ? data.conversation.slice(-10) : [];
  const history = conversation.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const entry = item as Record<string, unknown>;
    if ((entry.role !== "user" && entry.role !== "assistant") || typeof entry.content !== "string") return [];
    const content = entry.content.slice(0, 1800);
    if (containsPersonalContact(content)) throw new HttpError(400, "La conversation contient une coordonnée ou un secret. Effacez-la avant de continuer.");
    return [{ role: entry.role as ChatRole, content }];
  });
  const allowedViews = CHAT_VIEWS.filter((view) => (
    (view !== "users" || role === "admin")
    && (view !== "audit" || role === "admin" || role === "marketing_manager")
  ));
  const currentView = isChatView(data.current_view) && allowedViews.includes(data.current_view)
    ? data.current_view
    : "dashboard";
  const viewLabels: Record<ChatView, string> = {
    dashboard: "Vue d’ensemble",
    content: "Contenus",
    calendar: "Calendrier",
    comments: "Veille Meta",
    workflows: "Parcours métier",
    seo: "SEO & Google",
    reports: "Rapports mensuels",
    users: "Utilisateurs",
    audit: "Journal d’activité",
    integrations: "Intégrations",
  };
  const instructions = [
    "Tu es l’assistant de navigation et d’aide de Cabalou, un outil interne de marketing.",
    "Réponds en français, de façon concise, et base tes indications uniquement sur la description des écrans ci-dessous.",
    "Ta réponse finale doit être uniquement un objet JSON valide contenant exactement les champs « reply » (texte) et « action » (objet). L’objet action contient toujours « type », « view », « content », « meta_post » et « operation »; les propriétés non utilisées valent null. N’ajoute aucun texte avant ou après le JSON.",
    "Pour ouvrir un écran, utilise toujours action.type=navigate avec view égal à l’identifiant exact d’une page autorisée; n’utilise jamais action.type=open.",
    "Tu ne vois aucune donnée du site et ne dois jamais prétendre avoir consulté, modifié ou exécuté une opération.",
    "Tu peux proposer une navigation, préparer un brouillon local ou une seule opération de l’application à la fois. Toute écriture ou opération réelle attend une confirmation explicite dans l’interface.",
    "Ne prétends jamais qu’une opération a été effectuée avant la confirmation. Ne planifie pas plusieurs opérations dans une action et ne demande jamais de mot de passe, clé API, jeton, coordonnées client ou autre secret.",
    "N’invente jamais d’identifiant, de données de formulaire, de contenu ou de faits. Si un identifiant ou un champ requis manque, pose une question au lieu de produire une opération incomplète.",
    "Pour une opération, remplis action.type=execute et action.operation avec method, path, summary et payload_json (objet JSON encodé en chaîne). La summary doit décrire précisément l’effet et la cible; payload_json contient exactement les données nécessaires. Utilise uniquement les routes autorisées ci-dessous.",
    "Pour action.type=execute, action.view et action.content doivent être null; action.operation doit contenir l’opération. Pour les autres types d’action, action.operation doit être null. Exemple: execute avec view=null, content=null, method=POST, path=/api/posts et payload_json qui encode un objet JSON.",
    "Opérations disponibles: POST /api/posts (créer un brouillon), PATCH /api/posts/{id} (modifier un brouillon), POST /api/posts/{id}/submit, /approve, /reject (soumettre ou décider; reject attend reason), POST /api/posts/{id}/published-manual (published_url); POST /api/meta/posts (publier un texte sur Meta, message requis), PATCH /api/meta/posts/{id} (modifier le texte), DELETE /api/meta/posts/{id} (supprimer), POST /api/meta/posts/{id}/replace-media (remplacer les photos d’une publication, removed_attachment_ids requis), POST /api/meta/posts/{id}/comments (commenter, message requis), POST /api/meta/comments/{id}/reply (répondre, message requis), PATCH ou DELETE /api/meta/comments/{id} (modifier/supprimer).",
    "Autres opérations: POST /api/reports (enregistrer un rapport), POST /api/seo/manual (enregistrer une mesure), POST /api/workflows/{social|groups|b2b|reactivation|retargeting} (créer une fiche), POST /api/workflows/{module}/{id}/{action} (mettre à jour une fiche), POST /api/workflows/seo-targets (ajouter une cible), POST /api/workflows/seo-targets/{id} (mesure), POST /api/integrations/{id}/check (tester une intégration), PATCH /api/users/{id} (modifier un compte). Pour créer un compte, POST /api/users avec payload_json \"{}\" : l’utilisateur saisira les informations et le mot de passe dans le formulaire local de confirmation, jamais transmis au modèle. Pour la génération IA, utilise l’action prepare_content afin que l’utilisateur vérifie le texte dans l’éditeur.",
    "N’utilise pas d’opération pour le média fichier, l’authentification, les sessions ou les routes de lecture. Les opérations publier, répondre, modifier, rejeter ou supprimer doivent être décrites sans ambiguïté pour l’écran de confirmation.",
    "Si l’utilisateur demande d’ouvrir Veille Meta et de préparer une publication, propose prepare_meta_post avec view=comments et le texte rédigé dans meta_post.message; cela ouvre l’onglet demandé et préremplit la zone « Créer une publication ». Ne publie pas à ce stade : la publication ne part que lorsque l’utilisateur appuie ensuite sur Publier dans Veille Meta. Si le message manque, demande le contenu à rédiger; n’invente aucun fait sur les logements ou disponibilités.",
    "Si l’utilisateur demande explicitement de publier maintenant, de répondre à un commentaire, de modifier ou de supprimer un élément Meta, propose une seule action execute avec la route correspondante; le bouton de confirmation Cabalou est obligatoire avant tout appel. Ne remplace pas une demande de publication immédiate par une simple préparation du compositeur. Les actions /api/meta ont un effet externe; les actions workflows et published-manual ne font qu’enregistrer une étape ou un envoi déjà fait manuellement, elles n’envoient aucun message.",
    "Si l’utilisateur demande seulement de l’aide à la rédaction ou des idées, propose prepare_content. Si l’utilisateur demande explicitement de créer ou enregistrer un brouillon dans la bibliothèque et donne un titre, un canal et un texte, tu DOIS proposer execute avec POST /api/posts et placer ces valeurs telles quelles dans {title, channel, body}; destination_url peut être omis (Cabalou utilise https://cabalou.net/ par défaut). Exemple: « Enregistre ce brouillon Facebook, titre X, texte Y » => POST /api/posts avec payload_json {\"title\":\"X\",\"channel\":\"facebook\",\"body\":\"Y\"}. Ne demande pas d’objectif, de ton, d’audience ou de brief quand le texte du brouillon est déjà fourni; ne réécris pas le texte et ne choisis pas prepare_content dans ce cas. Si le titre, le canal ou le texte manque, demande uniquement le champ manquant.",
    "Si l’utilisateur demande d’ouvrir le formulaire de création sans demander de texte, propose open_content_create.",
    `Pages autorisées : ${allowedViews.map((view) => `${view} (${viewLabels[view]})`).join(", ")}.`,
    `Écran actuel : ${viewLabels[currentView]}.`,
    "Écrans : Vue d’ensemble (indicateurs), Contenus (brouillons et validations), Calendrier (dates souhaitées), Veille Meta (publications et commentaires de la Page), Parcours métier (suivis manuels), SEO & Google (cibles et mesures), Rapports mensuels (indicateurs d’équipe), Utilisateurs (comptes, administrateur seulement), Journal d’activité (actions tracées), Intégrations (états et tests de connexion).",
  ].join("\n");
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["reply", "action"],
    properties: {
      reply: { type: "string" },
      action: {
        type: "object",
        additionalProperties: false,
        required: ["type", "view", "content", "meta_post", "operation"],
        properties: {
          type: { type: "string", enum: ["none", "navigate", "open_content_create", "prepare_content", "prepare_meta_post", "execute"] },
          view: { type: ["string", "null"], enum: [...CHAT_VIEWS, null] },
          content: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["title", "objective", "tone", "audience", "brief", "channel"],
            properties: {
              title: { type: "string" },
              objective: { type: "string" },
              tone: { type: "string" },
              audience: { type: "string" },
              brief: { type: "string" },
              channel: { type: "string", enum: ["facebook", "tiktok"] },
            },
            meta_post: {
              type: ["object", "null"],
              additionalProperties: false,
              required: ["message"],
              properties: { message: { type: "string" } },
            },
          },
          operation: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["method", "path", "summary", "payload_json"],
            properties: {
              method: { type: "string", enum: ["POST", "PATCH", "DELETE"] },
              path: { type: "string" },
              summary: { type: "string" },
              payload_json: { type: "string" },
            },
          },
        },
      },
    },
  };

  const messages = [{ role: "system" as const, content: instructions }, ...history, { role: "user" as const, content: data.message.trim() }];
  let parsed: { reply: string; action: unknown };
  try {
    parsed = await requestAssistantReply(provider, messages, schema);
  } catch (error) {
    if (!(error instanceof AssistantProviderFailure)) throw error;
    if (!fallbackProvider || !error.canFallback) throw error.publicError;
    try {
      parsed = await requestAssistantReply(fallbackProvider, messages, schema);
      provider = fallbackProvider;
      fallbackUsed = true;
    } catch (fallbackError) {
      if (fallbackError instanceof AssistantProviderFailure) {
        throw new HttpError(
          fallbackError.publicError.status,
          `OpenAI est indisponible et Groq n’a pas pu répondre. ${fallbackError.publicError.message}`,
        );
      }
      throw fallbackError;
    }
  }
  const reply = parsed.reply.trim();
  if (!reply || reply.length > 2500) throw new HttpError(502, "L’assistant a retourné une réponse trop longue ou vide.");
  if (containsPersonalContact(reply)) throw new HttpError(502, "La réponse contient une coordonnée ou un secret. Reformulez votre demande.");
  const action = validateAction(parsed.action, allowedViews, role);
  return { reply, action, provider: provider.id, fallback_used: fallbackUsed };
}
