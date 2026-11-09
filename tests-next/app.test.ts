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
    assert.equal(classifyCommentSentiment("Je ne recommande pas ce service."), "negative");
    assert.equal(classifyCommentSentiment("Pas mal du tout !"), "positive");
    assert.equal(classifyCommentSentiment("No problem, great service."), "positive");
    assert.equal(classifyCommentSentiment("Les chambres sont excellentes et les équipes accueillantes."), "positive");
    assert.equal(classifyCommentSentiment("Aucun problème et service parfait."), "positive");
    assert.equal(classifyCommentSentiment("Not only excellent but also helpful."), "positive");
  });

  it("ne laisse pas une négation déborder sur une phrase suivante et neutralise les avis mitigés", () => {
    assert.equal(classifyCommentSentiment("Pas satisfait. Le personnel est très gentil."), "neutral");
    assert.equal(classifyCommentSentiment("Accueil excellent, mais service lent."), "neutral");
    assert.equal(classifyCommentSentiment("Merci de confirmer les horaires."), "neutral");
    assert.equal(classifyCommentSentiment("La réservation est compliquée et le personnel est désagréable."), "negative");
    assert.equal(classifyCommentSentiment("Nous sommes en attente de votre réponse."), "neutral");
    assert.equal(classifyCommentSentiment("Une attente interminable et un service pénible."), "negative");
    assert.equal(classifyCommentSentiment("Chers clients, merci de confirmer les horaires."), "neutral");
    assert.equal(classifyCommentSentiment("Le tarif est trop cher."), "negative");
  });
});

describe("génération de contenu IA", () => {
  it("utilise le fournisseur Groq sélectionné pour créer un brouillon", async () => {
    const originalProvider = process.env.AI_PROVIDER;
    const originalGroqKey = process.env.GROQ_API_KEY;
    const originalGroqModel = process.env.GROQ_MODEL;
    const originalFetchForTest = globalThis.fetch;
    let requestUrl = "";
    let requestBody: Record<string, unknown> | undefined;
    let authorization = "";
    process.env.AI_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "test-groq-key";
    process.env.GROQ_MODEL = "openai/gpt-oss-20b";
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ choices: [{ message: { content: "Un séjour accueillant vous attend." } }] });
    }) as typeof fetch;
    try {
      const { generateContent } = await import("../lib/integrations");
      const generated = await generateContent({
        channel: "facebook",
        objective: "Présenter un logement",
        tone: "Chaleureux",
        audience: "Familles",
        brief: "",
        facts: ["Logement à Libreville"],
      });
      assert.equal(requestUrl, "https://api.groq.com/openai/v1/chat/completions");
      assert.equal(authorization, "Bearer test-groq-key");
      assert.equal(requestBody?.model, "openai/gpt-oss-20b");
      assert.equal(generated.model, "openai/gpt-oss-20b");
      assert.equal(generated.body, "Un séjour accueillant vous attend.");
      assert.equal(JSON.stringify(requestBody).includes("test-groq-key"), false);
    } finally {
      globalThis.fetch = originalFetchForTest;
      if (originalProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = originalProvider;
      if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
      else process.env.GROQ_API_KEY = originalGroqKey;
      if (originalGroqModel === undefined) delete process.env.GROQ_MODEL;
      else process.env.GROQ_MODEL = originalGroqModel;
    }
  });

  it("transmet le public visé sans inclure de données personnelles", async () => {
    const originalProvider = process.env.AI_PROVIDER;
    const originalApiKey = process.env.OPENAI_API_KEY;
    const originalModel = process.env.OPENAI_MODEL;
    const originalFetchForTest = globalThis.fetch;
    let requestBody: Record<string, unknown> | undefined;
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_MODEL = "gpt-test-model";
    process.env.AI_PROVIDER = "openai";
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ choices: [{ message: { content: "Un séjour accueillant vous attend." } }] });
    }) as typeof fetch;
    try {
      const { generateContent } = await import("../lib/integrations");
      const generated = await generateContent({
        channel: "facebook",
        objective: "Présenter un logement",
        tone: "Chaleureux et professionnel",
        audience: "Familles",
        brief: "Mettre en avant les équipements vérifiés.",
        facts: ["Logement à Libreville"],
      });
      assert.equal(generated.body, "Un séjour accueillant vous attend.");
      assert.equal(generated.model, "gpt-test-model");
      const requestMessages = requestBody?.messages as Array<{ content: string }>;
      assert.match(requestMessages.map((message) => message.content).join("\n"), /Public visé : Familles/u);
      assert.match(requestMessages.map((message) => message.content).join("\n"), /Logement à Libreville/u);
      assert.equal(JSON.stringify(requestBody).includes("test-openai-key"), false);
      await assert.rejects(generateContent({
        channel: "facebook",
        objective: "Présenter un logement",
        tone: "Chaleureux",
        audience: "contact@example.com",
        brief: "",
        facts: [],
      }), /semble contenir une coordonnée personnelle/u);
    } finally {
      globalThis.fetch = originalFetchForTest;
      if (originalProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = originalProvider;
      if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalApiKey;
      if (originalModel === undefined) delete process.env.OPENAI_MODEL;
      else process.env.OPENAI_MODEL = originalModel;
    }
  });
});

describe("assistant de navigation Cabalou", () => {
  it("bascule automatiquement vers Groq si OpenAI est limité ou non configuré", async () => {
    const originalProvider = process.env.AI_PROVIDER;
    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    const originalOpenAiModel = process.env.OPENAI_MODEL;
    const originalGroqKey = process.env.GROQ_API_KEY;
    const originalGroqModel = process.env.GROQ_MODEL;
    const originalFetchForTest = globalThis.fetch;
    const requestUrls: string[] = [];
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_MODEL = "gpt-test-model";
    process.env.GROQ_API_KEY = "test-groq-key";
    process.env.GROQ_MODEL = "openai/gpt-oss-20b";
    globalThis.fetch = (async (input) => {
      requestUrls.push(String(input));
      if (String(input).startsWith("https://api.openai.com/")) {
        return Response.json({ error: { code: "rate_limit_exceeded" } }, { status: 429 });
      }
      return Response.json({
        choices: [{ message: { content: JSON.stringify({
          reply: "Je vous accompagne avec Groq.",
          action: { type: "none", view: null, content: null, meta_post: null, operation: null },
        }) } }],
      });
    }) as typeof fetch;
    try {
      const { chatWithSiteAssistant } = await import("../lib/site-assistant");
      const result = await chatWithSiteAssistant({ message: "Aide-moi" }, "admin");
      assert.deepEqual(requestUrls, [
        "https://api.openai.com/v1/chat/completions",
        "https://api.groq.com/openai/v1/chat/completions",
      ]);
      assert.equal(result.provider, "groq");
      assert.equal(result.fallback_used, true);
      assert.equal(result.reply, "Je vous accompagne avec Groq.");

      requestUrls.length = 0;
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_MODEL;
      const unconfiguredResult = await chatWithSiteAssistant({ message: "Encore de l’aide" }, "admin");
      assert.deepEqual(requestUrls, ["https://api.groq.com/openai/v1/chat/completions"]);
      assert.equal(unconfiguredResult.fallback_used, true);
    } finally {
      globalThis.fetch = originalFetchForTest;
      if (originalProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = originalProvider;
      if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalOpenAiKey;
      if (originalOpenAiModel === undefined) delete process.env.OPENAI_MODEL;
      else process.env.OPENAI_MODEL = originalOpenAiModel;
      if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
      else process.env.GROQ_API_KEY = originalGroqKey;
      if (originalGroqModel === undefined) delete process.env.GROQ_MODEL;
      else process.env.GROQ_MODEL = originalGroqModel;
    }
  });

  it("utilise Groq avec le modèle gratuit sélectionné et explique ses limites", async () => {
    const originalProvider = process.env.AI_PROVIDER;
    const originalGroqKey = process.env.GROQ_API_KEY;
    const originalGroqModel = process.env.GROQ_MODEL;
    const originalFetchForTest = globalThis.fetch;
    let requestUrl = "";
    let requestBody: Record<string, unknown> | undefined;
    process.env.AI_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "test-groq-key";
    process.env.GROQ_MODEL = "openai/gpt-oss-20b";
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        choices: [{ message: { content: JSON.stringify({
          reply: "J’ouvre les contenus après votre confirmation.",
          action: { type: "navigate", view: "content", content: null, meta_post: null, operation: null },
        }) } }],
      });
    }) as typeof fetch;
    try {
      const { chatWithSiteAssistant } = await import("../lib/site-assistant");
      const result = await chatWithSiteAssistant({ message: "Ouvre les contenus" }, "admin");
      assert.equal(requestUrl, "https://api.groq.com/openai/v1/chat/completions");
      assert.equal(result.action.view, "content");
      assert.equal(requestBody?.model, "openai/gpt-oss-20b");
      assert.equal((requestBody?.response_format as Record<string, unknown>)?.type, "json_object");
      assert.equal(JSON.stringify(requestBody).includes("test-groq-key"), false);
      globalThis.fetch = (async () => Response.json({
        error: { code: "rate_limit_exceeded" },
      }, { status: 429 })) as typeof fetch;
      await assert.rejects(chatWithSiteAssistant({ message: "Aide-moi" }, "admin"), /limite gratuite Groq/u);
    } finally {
      globalThis.fetch = originalFetchForTest;
      if (originalProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = originalProvider;
      if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
      else process.env.GROQ_API_KEY = originalGroqKey;
      if (originalGroqModel === undefined) delete process.env.GROQ_MODEL;
      else process.env.GROQ_MODEL = originalGroqModel;
    }
  });

  it("prépare une publication Meta dans la veille sans la publier avant confirmation", async () => {
    const originalProvider = process.env.AI_PROVIDER;
    const originalApiKey = process.env.OPENAI_API_KEY;
    const originalModel = process.env.OPENAI_MODEL;
    const originalFetchForTest = globalThis.fetch;
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_MODEL = "gpt-test-model";
    globalThis.fetch = (async () => Response.json({
      choices: [{ message: { content: JSON.stringify({
        reply: "J’ai préparé le texte dans Veille Meta. Relisez-le avant de publier.",
        action: {
          type: "prepare_meta_post",
          view: "comments",
          content: null,
          meta_post: { message: "Bienvenue chez Cabalou pour votre prochain séjour." },
          operation: null,
        },
      }) } }],
    })) as typeof fetch;
    try {
      const { chatWithSiteAssistant } = await import("../lib/site-assistant");
      const result = await chatWithSiteAssistant({
        message: "Ouvre la veille Meta et prépare une publication pour Cabalou.",
      }, "admin");
      assert.equal(result.action.type, "prepare_meta_post");
      assert.equal(result.action.view, "comments");
      assert.equal(result.action.meta_post?.message, "Bienvenue chez Cabalou pour votre prochain séjour.");
      assert.equal(result.action.operation, null);
    } finally {
      globalThis.fetch = originalFetchForTest;
      if (originalProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = originalProvider;
      if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalApiKey;
      if (originalModel === undefined) delete process.env.OPENAI_MODEL;
      else process.env.OPENAI_MODEL = originalModel;
    }
  });

  it("propose uniquement une navigation autorisée et refuse les données personnelles", async () => {
    const originalProvider = process.env.AI_PROVIDER;
    const originalApiKey = process.env.OPENAI_API_KEY;
    const originalModel = process.env.OPENAI_MODEL;
    const originalFetchForTest = globalThis.fetch;
    let requestBody: Record<string, unknown> | undefined;
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_MODEL = "gpt-test-model";
    process.env.AI_PROVIDER = "openai";
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        choices: [{ message: { content: JSON.stringify({
          reply: "Je vous propose d’ouvrir la bibliothèque de contenus.",
          action: { type: "navigate", view: "content", content: null, meta_post: null, operation: null },
        }) } }],
      });
    }) as typeof fetch;
    try {
      const { chatWithSiteAssistant } = await import("../lib/site-assistant");
      const result = await chatWithSiteAssistant({
        message: "Ouvre les contenus",
        current_view: "dashboard",
        conversation: [],
      }, "operator");
      assert.equal(result.action.type, "navigate");
      assert.equal(result.action.view, "content");
      const messages = requestBody?.messages as Array<{ role: string; content: string }>;
      assert.match(messages[0].content, /ne dois jamais prétendre avoir consulté, modifié ou exécuté/u);
      assert.deepEqual(requestBody?.response_format && (requestBody.response_format as Record<string, unknown>).type, "json_schema");
      await assert.rejects(chatWithSiteAssistant({
        message: "Prépare une réponse pour client@example.com",
        conversation: [],
      }, "operator"), /Ne transmettez pas de coordonnées/u);
    } finally {
      globalThis.fetch = originalFetchForTest;
      if (originalProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = originalProvider;
      if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalApiKey;
      if (originalModel === undefined) delete process.env.OPENAI_MODEL;
      else process.env.OPENAI_MODEL = originalModel;
    }
  });

  it("convertit une proposition open en navigation vers la page autorisée", async () => {
    const originalProvider = process.env.AI_PROVIDER;
    const originalApiKey = process.env.OPENAI_API_KEY;
    const originalModel = process.env.OPENAI_MODEL;
    const originalFetchForTest = globalThis.fetch;
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_MODEL = "gpt-test-model";
    process.env.AI_PROVIDER = "openai";
    globalThis.fetch = (async () => Response.json({
      choices: [{ message: { content: JSON.stringify({
        reply: "J’ouvre Veille Meta.",
        action: { type: "open", view: "comments", content: null, meta_post: null, operation: null },
      }) } }],
    })) as typeof fetch;
    try {
      const { chatWithSiteAssistant } = await import("../lib/site-assistant");
      const result = await chatWithSiteAssistant({ message: "Ouvre la veille Meta" }, "admin");
      assert.equal(result.action.type, "navigate");
      assert.equal(result.action.view, "comments");
    } finally {
      globalThis.fetch = originalFetchForTest;
      if (originalProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = originalProvider;
      if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalApiKey;
      if (originalModel === undefined) delete process.env.OPENAI_MODEL;
      else process.env.OPENAI_MODEL = originalModel;
    }
  });

  it("refuse une navigation vers les pages réservées à un administrateur", async () => {
    const originalProvider = process.env.AI_PROVIDER;
    const originalApiKey = process.env.OPENAI_API_KEY;
    const originalModel = process.env.OPENAI_MODEL;
    const originalFetchForTest = globalThis.fetch;
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_MODEL = "gpt-test-model";
    process.env.AI_PROVIDER = "openai";
    globalThis.fetch = (async () => Response.json({
      choices: [{ message: { content: JSON.stringify({
        reply: "Ouvrons la gestion des utilisateurs.",
        action: { type: "navigate", view: "users", content: null, meta_post: null, operation: null },
      }) } }],
    })) as typeof fetch;
    try {
      const { chatWithSiteAssistant } = await import("../lib/site-assistant");
      await assert.rejects(chatWithSiteAssistant({ message: "Ouvre les utilisateurs" }, "operator"), /action.*incompatible/u);
    } finally {
      globalThis.fetch = originalFetchForTest;
      if (originalProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = originalProvider;
      if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalApiKey;
      if (originalModel === undefined) delete process.env.OPENAI_MODEL;
      else process.env.OPENAI_MODEL = originalModel;
    }
  });

  it("propose une opération précise et la refuse si le rôle ne l’autorise pas", async () => {
    const originalProvider = process.env.AI_PROVIDER;
    const originalApiKey = process.env.OPENAI_API_KEY;
    const originalModel = process.env.OPENAI_MODEL;
    const originalFetchForTest = globalThis.fetch;
    let responseCount = 0;
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_MODEL = "gpt-test-model";
    process.env.AI_PROVIDER = "openai";
    globalThis.fetch = (async () => {
      responseCount += 1;
      const operation = responseCount === 1 ? {
        method: "POST",
        path: "/api/posts",
        summary: "Créer un brouillon Facebook",
        payload_json: JSON.stringify({
          title: "Séjour à Libreville",
          channel: "facebook",
          body: "Découvrez notre logement.",
          destination_url: "https://cabalou.net/",
        }),
      } : responseCount === 2 ? {
        method: "PATCH",
        path: "/api/users/1",
        summary: "Modifier un compte",
        payload_json: JSON.stringify({ display_name: "Administrateur" }),
      } : responseCount === 3 ? {
        method: "POST",
        path: "/api/users",
        summary: "Créer un compte utilisateur",
        payload_json: "{}",
      } : {
        method: "POST",
        path: "/api/meta/comments/123456_789/reply",
        summary: "Répondre au commentaire Meta",
        payload_json: JSON.stringify({ message: "Merci pour votre retour." }),
      };
      return Response.json({
      choices: [{ message: { content: JSON.stringify({
        reply: "Je propose de créer ce brouillon. Confirmez pour l’enregistrer.",
        action: { type: "execute", view: null, content: null, meta_post: null, operation },
      }) } }],
      });
    }) as typeof fetch;
    try {
      const { chatWithSiteAssistant } = await import("../lib/site-assistant");
      const result = await chatWithSiteAssistant({ message: "Enregistre un brouillon Facebook : Séjour à Libreville" }, "admin");
      assert.equal(result.action.type, "execute");
      assert.equal(result.action.operation?.path, "/api/posts");
      assert.equal(result.action.operation?.method, "POST");
      assert.equal(result.action.operation?.summary, "Créer un brouillon Facebook");
      await assert.rejects(
        chatWithSiteAssistant({ message: "Modifie un utilisateur" }, "operator"),
        /pas disponible pour votre rôle/u,
      );
      const createUser = await chatWithSiteAssistant({ message: "Ouvre la création d’un compte" }, "admin");
      assert.equal(createUser.action.type, "execute");
      assert.equal(createUser.action.operation?.path, "/api/users");
      assert.deepEqual(createUser.action.operation?.payload, {});
      const metaReply = await chatWithSiteAssistant({ message: "Réponds au commentaire 123456_789" }, "admin");
      assert.equal(metaReply.action.operation?.path, "/api/meta/comments/123456_789/reply");
    } finally {
      globalThis.fetch = originalFetchForTest;
      if (originalProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = originalProvider;
      if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalApiKey;
      if (originalModel === undefined) delete process.env.OPENAI_MODEL;
      else process.env.OPENAI_MODEL = originalModel;
    }
  });

  it("explique quand le projet OpenAI a épuisé ses crédits API", async () => {
    const originalProvider = process.env.AI_PROVIDER;
    const originalApiKey = process.env.OPENAI_API_KEY;
    const originalModel = process.env.OPENAI_MODEL;
    const originalGroqKey = process.env.GROQ_API_KEY;
    const originalFetchForTest = globalThis.fetch;
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_MODEL = "gpt-test-model";
    process.env.AI_PROVIDER = "openai";
    delete process.env.GROQ_API_KEY;
    globalThis.fetch = (async () => Response.json({
      error: { code: "insufficient_quota", message: "provider detail" },
    }, { status: 429 })) as typeof fetch;
    try {
      const { chatWithSiteAssistant } = await import("../lib/site-assistant");
      await assert.rejects(
        chatWithSiteAssistant({ message: "Aide-moi" }, "admin"),
        /plus de crédits API.*abonnement ChatGPT est distinct/iu,
      );
    } finally {
      globalThis.fetch = originalFetchForTest;
      if (originalProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = originalProvider;
      if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalApiKey;
      if (originalModel === undefined) delete process.env.OPENAI_MODEL;
      else process.env.OPENAI_MODEL = originalModel;
      if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
      else process.env.GROQ_API_KEY = originalGroqKey;
    }
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

describe("publication de médias Meta", () => {
  it("publie plusieurs photos comme un album avec une seule légende", async () => {
    const originalPageId = process.env.META_PAGE_ID;
    const originalPageToken = process.env.META_PAGE_ACCESS_TOKEN;
    const originalFetchForTest = globalThis.fetch;
    const graphRequests: Array<{ url: string; init?: RequestInit }> = [];
    process.env.META_PAGE_ID = "123456";
    process.env.META_PAGE_ACCESS_TOKEN = "test-page-token";
    globalThis.fetch = (async (input, init) => {
      const requestUrl = String(input);
      graphRequests.push({ url: requestUrl, init });
      if (requestUrl.endsWith("/photos")) {
        return Response.json({ id: `photo-${graphRequests.length}` });
      }
      return Response.json({ id: "album-post-123" });
    }) as typeof fetch;
    try {
      const { publishMetaPageMedia } = await import("../lib/integrations");
      assert.deepEqual(await publishMetaPageMedia("Album de photos", [
        { name: "un.jpg", type: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8, 0xff]) },
        { name: "deux.png", type: "image/png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
      ]), { id: "album-post-123" });
      assert.equal(graphRequests.length, 3);
      assert.equal(graphRequests[0].url, "https://graph.facebook.com/v27.0/123456/photos");
      assert.equal(graphRequests[1].url, "https://graph.facebook.com/v27.0/123456/photos");
      assert.equal(graphRequests[2].url, "https://graph.facebook.com/v27.0/123456/feed");
      for (const upload of graphRequests.slice(0, 2)) {
        assert.equal((upload.init?.body as FormData).get("published"), "false");
      }
      const album = graphRequests[2].init?.body as FormData;
      assert.equal(album.get("message"), "Album de photos");
      assert.deepEqual(JSON.parse(String(album.get("attached_media[0]"))), { media_fbid: "photo-1" });
      assert.deepEqual(JSON.parse(String(album.get("attached_media[1]"))), { media_fbid: "photo-2" });
    } finally {
      globalThis.fetch = originalFetchForTest;
      if (originalPageId === undefined) delete process.env.META_PAGE_ID;
      else process.env.META_PAGE_ID = originalPageId;
      if (originalPageToken === undefined) delete process.env.META_PAGE_ACCESS_TOKEN;
      else process.env.META_PAGE_ACCESS_TOKEN = originalPageToken;
    }
  });

  it("refuse de mélanger photos et vidéo dans une publication", async () => {
    const originalPageId = process.env.META_PAGE_ID;
    const originalPageToken = process.env.META_PAGE_ACCESS_TOKEN;
    process.env.META_PAGE_ID = "123456";
    process.env.META_PAGE_ACCESS_TOKEN = "test-page-token";
    try {
      const { publishMetaPageMedia } = await import("../lib/integrations");
      await assert.rejects(publishMetaPageMedia("Médias mélangés", [
        { name: "photo.jpg", type: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8, 0xff]) },
        { name: "video.mp4", type: "video/mp4", bytes: new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]) },
      ]), /sans mélanger les formats/);
    } finally {
      if (originalPageId === undefined) delete process.env.META_PAGE_ID;
      else process.env.META_PAGE_ID = originalPageId;
      if (originalPageToken === undefined) delete process.env.META_PAGE_ACCESS_TOKEN;
      else process.env.META_PAGE_ACCESS_TOKEN = originalPageToken;
    }
  });

  it("publie une photo avec sa légende via l’endpoint Page photos", async () => {
    const originalPageId = process.env.META_PAGE_ID;
    const originalPageToken = process.env.META_PAGE_ACCESS_TOKEN;
    const originalFetchForTest = globalThis.fetch;
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    process.env.META_PAGE_ID = "123456";
    process.env.META_PAGE_ACCESS_TOKEN = "test-page-token";
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return Response.json({ id: "photo-123", post_id: "post-123" });
    }) as typeof fetch;
    try {
      const { publishMetaPageMedia } = await import("../lib/integrations");
      assert.deepEqual(await publishMetaPageMedia("Une photo", {
        name: "photo.jpg", type: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      }), { id: "post-123" });
      assert.equal(requestUrl, "https://graph.facebook.com/v27.0/123456/photos");
      const form = requestInit?.body as FormData;
      assert.equal(form.get("caption"), "Une photo");
      assert.equal(form.get("published"), "true");
      assert.equal((form.get("source") as File).name, "photo.jpg");
    } finally {
      globalThis.fetch = originalFetchForTest;
      if (originalPageId === undefined) delete process.env.META_PAGE_ID;
      else process.env.META_PAGE_ID = originalPageId;
      if (originalPageToken === undefined) delete process.env.META_PAGE_ACCESS_TOKEN;
      else process.env.META_PAGE_ACCESS_TOKEN = originalPageToken;
    }
  });

  it("publie une vidéo MP4 avec sa légende via l’API vidéo Meta", async () => {
    const originalPageId = process.env.META_PAGE_ID;
    const originalPageToken = process.env.META_PAGE_ACCESS_TOKEN;
    const originalFetchForTest = globalThis.fetch;
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    process.env.META_PAGE_ID = "123456";
    process.env.META_PAGE_ACCESS_TOKEN = "test-page-token";
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return Response.json({ id: "video-123" });
    }) as typeof fetch;
    try {
      const { publishMetaPageMedia } = await import("../lib/integrations");
      assert.deepEqual(await publishMetaPageMedia("Une vidéo", {
        name: "video.mp4", type: "video/mp4", bytes: new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]),
      }), { id: "video-123" });
      assert.equal(requestUrl, "https://graph-video.facebook.com/v27.0/123456/videos");
      const form = requestInit?.body as FormData;
      assert.equal(form.get("description"), "Une vidéo");
      assert.equal(form.get("published"), "true");
      assert.equal((form.get("source") as File).name, "video.mp4");
    } finally {
      globalThis.fetch = originalFetchForTest;
      if (originalPageId === undefined) delete process.env.META_PAGE_ID;
      else process.env.META_PAGE_ID = originalPageId;
      if (originalPageToken === undefined) delete process.env.META_PAGE_ACCESS_TOKEN;
      else process.env.META_PAGE_ACCESS_TOKEN = originalPageToken;
    }
  });
});

describe("modification des photos d’un album Meta", () => {
  it("recrée l’album avec les photos conservées puis supprime l’ancien post", async () => {
    const originalPageId = process.env.META_PAGE_ID;
    const originalPageToken = process.env.META_PAGE_ACCESS_TOKEN;
    const originalFetchForTest = globalThis.fetch;
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let uploadedPhotoCount = 0;
    process.env.META_PAGE_ID = "123456";
    process.env.META_PAGE_ACCESS_TOKEN = "test-page-token";
    globalThis.fetch = (async (input, init) => {
      const requestUrl = String(input);
      requests.push({ url: requestUrl, init });
      if (requestUrl.includes("graph.facebook.com/v27.0/123456_789?fields=attachments")) {
        return Response.json({
          attachments: { data: [{ subattachments: { data: [
            { id: "111", media: { image: { src: "https://scontent.xx.fbcdn.net/one.jpg" } } },
            { id: "222", media: { image: { src: "https://scontent.xx.fbcdn.net/two.jpg" } } },
            { id: "333", media: { image: { src: "https://scontent.xx.fbcdn.net/three.jpg" } } },
          ] } }] },
        });
      }
      if (requestUrl.includes("fbcdn.net")) {
        return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "Content-Type": "image/jpeg" } });
      }
      if (requestUrl.endsWith("/photos")) {
        uploadedPhotoCount += 1;
        return Response.json({ id: `replacement-photo-${uploadedPhotoCount}` });
      }
      if (requestUrl.endsWith("/feed")) return Response.json({ id: "replacement-post" });
      if (requestUrl.endsWith("/123456_789") && init?.method === "DELETE") return Response.json({ success: true });
      throw new Error(`Unexpected Meta request: ${requestUrl}`);
    }) as typeof fetch;
    try {
      const { replaceMetaPagePostPhotos } = await import("../lib/integrations");
      assert.deepEqual(await replaceMetaPagePostPhotos("123456_789", "Album réduit", ["222"]), {
        id: "replacement-post",
        replaced_id: "123456_789",
      });
      assert.equal(requests.length, 7);
      assert.equal(requests[1].url, "https://scontent.xx.fbcdn.net/one.jpg");
      assert.equal(requests[2].url, "https://scontent.xx.fbcdn.net/three.jpg");
      assert.equal(requests[5].url, "https://graph.facebook.com/v27.0/123456/feed");
      assert.equal(requests[6].url, "https://graph.facebook.com/v27.0/123456_789");
      const album = requests[5].init?.body as FormData;
      assert.equal(album.get("message"), "Album réduit");
      assert.deepEqual(JSON.parse(String(album.get("attached_media[0]"))), { media_fbid: "replacement-photo-1" });
      assert.deepEqual(JSON.parse(String(album.get("attached_media[1]"))), { media_fbid: "replacement-photo-2" });
    } finally {
      globalThis.fetch = originalFetchForTest;
      if (originalPageId === undefined) delete process.env.META_PAGE_ID;
      else process.env.META_PAGE_ID = originalPageId;
      if (originalPageToken === undefined) delete process.env.META_PAGE_ACCESS_TOKEN;
      else process.env.META_PAGE_ACCESS_TOKEN = originalPageToken;
    }
  });

  it("refuse les identifiants de photos qui n’appartiennent pas à l’album", async () => {
    const originalPageId = process.env.META_PAGE_ID;
    const originalPageToken = process.env.META_PAGE_ACCESS_TOKEN;
    const originalFetchForTest = globalThis.fetch;
    let requestCount = 0;
    process.env.META_PAGE_ID = "123456";
    process.env.META_PAGE_ACCESS_TOKEN = "test-page-token";
    globalThis.fetch = (async () => {
      requestCount += 1;
      return Response.json({
        attachments: { data: [{ subattachments: { data: [
          { id: "111", media: { image: { src: "https://scontent.xx.fbcdn.net/one.jpg" } } },
          { id: "222", media: { image: { src: "https://scontent.xx.fbcdn.net/two.jpg" } } },
        ] } }] },
      });
    }) as typeof fetch;
    try {
      const { replaceMetaPagePostPhotos } = await import("../lib/integrations");
      await assert.rejects(replaceMetaPagePostPhotos("123456_789", "Album", ["999"]), /ne fait plus partie de cet album/);
      assert.equal(requestCount, 1);
    } finally {
      globalThis.fetch = originalFetchForTest;
      if (originalPageId === undefined) delete process.env.META_PAGE_ID;
      else process.env.META_PAGE_ID = originalPageId;
      if (originalPageToken === undefined) delete process.env.META_PAGE_ACCESS_TOKEN;
      else process.env.META_PAGE_ACCESS_TOKEN = originalPageToken;
    }
  });
});

describe("lecture des vidéos Meta", () => {
  it("transmet la plage demandée au flux Meta sans exposer la source CDN", async () => {
    const originalPageId = process.env.META_PAGE_ID;
    const originalPageToken = process.env.META_PAGE_ACCESS_TOKEN;
    const originalFetchForTest = globalThis.fetch;
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    process.env.META_PAGE_ID = "123456";
    process.env.META_PAGE_ACCESS_TOKEN = "test-page-token";
    globalThis.fetch = (async (input, init) => {
      const requestUrl = String(input);
      requests.push({ url: requestUrl, init });
      if (requestUrl.includes("graph.facebook.com")) {
        return Response.json({ source: "https://video.xx.fbcdn.net/sample.mp4" });
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": "bytes 0-2/100",
          "Content-Length": "3",
          "Accept-Ranges": "bytes",
        },
      });
    }) as typeof fetch;
    try {
      const { getMetaPostVideo } = await import("../lib/integrations");
      const result = await getMetaPostVideo("987654", "bytes=0-2");
      assert.equal(result.status, 206);
      assert.equal(result.mime, "video/mp4");
      assert.equal(result.contentRange, "bytes 0-2/100");
      assert.equal(requests.length, 2);
      assert.match(requests[0].url, /987654\?fields=source$/);
      assert.equal(requests[1].url, "https://video.xx.fbcdn.net/sample.mp4");
      assert.equal(new Headers(requests[1].init?.headers).get("range"), "bytes=0-2");
      assert.equal(new Headers(requests[0].init?.headers).get("authorization"), "Bearer test-page-token");
      assert.equal(new Headers(requests[1].init?.headers).has("authorization"), false);
    } finally {
      globalThis.fetch = originalFetchForTest;
      if (originalPageId === undefined) delete process.env.META_PAGE_ID;
      else process.env.META_PAGE_ID = originalPageId;
      if (originalPageToken === undefined) delete process.env.META_PAGE_ACCESS_TOKEN;
      else process.env.META_PAGE_ACCESS_TOKEN = originalPageToken;
    }
  });

  it("refuse les URL vidéo hors des domaines CDN Meta autorisés", async () => {
    const originalPageId = process.env.META_PAGE_ID;
    const originalPageToken = process.env.META_PAGE_ACCESS_TOKEN;
    const originalFetchForTest = globalThis.fetch;
    let requestCount = 0;
    process.env.META_PAGE_ID = "123456";
    process.env.META_PAGE_ACCESS_TOKEN = "test-page-token";
    globalThis.fetch = (async () => {
      requestCount += 1;
      return Response.json({ source: "https://example.com/unsafe.mp4" });
    }) as typeof fetch;
    try {
      const { getMetaPostVideo } = await import("../lib/integrations");
      await assert.rejects(getMetaPostVideo("987654"), /Meta ne fournit pas de flux vidéo accessible/);
      assert.equal(requestCount, 1);
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
