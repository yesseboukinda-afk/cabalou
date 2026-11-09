import { HttpError } from "./security";

export type AiProviderId = "openai" | "groq";

export type AiProviderConfig = {
  id: AiProviderId;
  name: string;
  apiKey: string;
  model: string;
  apiUrl: string;
};

export function selectedAiProvider(): AiProviderId {
  const provider = process.env.AI_PROVIDER?.trim() || "openai";
  if (provider !== "openai" && provider !== "groq") {
    throw new HttpError(500, "AI_PROVIDER doit être « openai » ou « groq ».");
  }
  return provider;
}

export function aiProviderConfig(provider = selectedAiProvider()): AiProviderConfig {
  if (provider === "groq") {
    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) throw new HttpError(400, "La clé GROQ_API_KEY manque dans la configuration serveur.");
    return {
      id: "groq",
      name: "Groq",
      apiKey,
      model: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b",
      apiUrl: "https://api.groq.com/openai/v1",
    };
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();
  if (!apiKey || !model) throw new HttpError(400, "La configuration OpenAI est absente. Contactez un administrateur.");
  return {
    id: "openai",
    name: "OpenAI",
    apiKey,
    model,
    apiUrl: "https://api.openai.com/v1",
  };
}

export function aiProviderStatus() {
  const active = selectedAiProvider();
  return {
    provider: active,
    name: active === "groq" ? "Groq" : "OpenAI",
    missing_environment: active === "groq"
      ? ["GROQ_API_KEY"].filter((key) => !process.env[key]?.trim())
      : ["OPENAI_API_KEY", "OPENAI_MODEL"].filter((key) => !process.env[key]?.trim()),
  };
}

export async function aiProviderError(response: Response, provider: AiProviderId): Promise<HttpError> {
  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = await response.clone().json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
  } catch { /* Use the generic provider error below. */ }
  const providerError = payload.error && typeof payload.error === "object" && !Array.isArray(payload.error)
    ? payload.error as Record<string, unknown>
    : {};

  if (response.status === 429) {
    if (provider === "openai" && providerError.code === "insufficient_quota") {
      return new HttpError(402, "Le projet OpenAI n’a plus de crédits API. L’abonnement ChatGPT est distinct de la facturation API.");
    }
    return new HttpError(429, provider === "groq"
      ? "La limite gratuite Groq est atteinte ou temporairement saturée. Consultez les limites du compte Groq puis réessayez après réinitialisation."
      : "La limite de requêtes OpenAI est temporairement atteinte. Réessayez un peu plus tard.");
  }
  if (response.status === 401) {
    return new HttpError(400, `La clé API ${provider === "groq" ? "Groq" : "OpenAI"} a été rejetée. Vérifiez la configuration serveur.`);
  }
  if (response.status === 403 || response.status === 404) {
    return new HttpError(400, `Le projet ${provider === "groq" ? "Groq" : "OpenAI"} n’a pas accès au modèle configuré. Vérifiez le modèle et les droits du compte.`);
  }
  if (provider === "groq") {
    const code = typeof providerError.code === "string" && /^[a-zA-Z0-9_.-]{1,60}$/u.test(providerError.code)
      ? `, ${providerError.code}`
      : "";
    return new HttpError(400, `Groq a refusé la requête (HTTP ${response.status}${code}). Vérifiez le modèle et le format de la demande.`);
  }
  return new HttpError(400, "OpenAI a refusé la demande. Vérifiez l’accès au modèle configuré.");
}
