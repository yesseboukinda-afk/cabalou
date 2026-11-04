export type SupabaseAuthUser = {
  id: string;
  email: string;
};

export type SupabaseAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export type SupabaseAuthSession = SupabaseAuthTokens & {
  user: SupabaseAuthUser;
};

export class SupabaseAuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type AuthResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  user?: unknown;
};

function config(admin = false) {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || (admin && !serviceKey)) {
    throw new SupabaseAuthError(
      503,
      admin
        ? "Configurez SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY."
        : "Configurez SUPABASE_URL et SUPABASE_ANON_KEY.",
    );
  }
  return { url, key: admin ? serviceKey! : anonKey };
}

function parseUser(value: unknown): SupabaseAuthUser | null {
  if (!value || typeof value !== "object") return null;
  const user = value as { id?: unknown; email?: unknown };
  return typeof user.id === "string" && typeof user.email === "string"
    ? { id: user.id, email: user.email }
    : null;
}

async function request<T>(
  path: string,
  options: { key: string; method?: string; bearer?: string; body?: Record<string, unknown> },
): Promise<{ status: number; data: T | null }> {
  let response: Response;
  try {
    response = await fetch(`${configUrl()}${path}`, {
      method: options.method ?? "GET",
      headers: {
        apikey: options.key,
        ...(options.bearer ? { Authorization: "Bearer " + options.bearer } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      cache: "no-store",
    });
  } catch {
    throw new SupabaseAuthError(503, "Impossible de joindre Supabase Auth.");
  }
  const data = await response.json().catch(() => null) as T | null;
  return { status: response.status, data };
}

function configUrl(): string {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  if (!url) throw new SupabaseAuthError(503, "Configurez SUPABASE_URL.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SupabaseAuthError(503, "SUPABASE_URL n’est pas une URL valide.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new SupabaseAuthError(503, "SUPABASE_URL doit être une URL HTTPS valide.");
  }
  return url;
}

function parseSession(data: AuthResponse | null): SupabaseAuthSession | null {
  if (
    !data || typeof data.access_token !== "string"
    || typeof data.refresh_token !== "string" || typeof data.expires_in !== "number"
  ) return null;
  const user = parseUser(data.user);
  return user ? {
    user,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  } : null;
}

export async function signInWithPassword(email: string, password: string): Promise<SupabaseAuthSession | null> {
  const { key } = config();
  const result = await request<AuthResponse>("/auth/v1/token?grant_type=password", {
    key, method: "POST", body: { email, password },
  });
  if (result.status === 400 || result.status === 401) return null;
  if (result.status < 200 || result.status >= 300) {
    throw new SupabaseAuthError(503, "La connexion à Supabase Auth a échoué.");
  }
  const session = parseSession(result.data);
  if (!session) throw new SupabaseAuthError(503, "Réponse de session Supabase Auth invalide.");
  return session;
}

export async function getSupabaseAuthUser(accessToken: string): Promise<SupabaseAuthUser | null> {
  const { key } = config();
  const result = await request<unknown>("/auth/v1/user", { key, bearer: accessToken });
  if (result.status === 401 || result.status === 403) return null;
  if (result.status < 200 || result.status >= 300) {
    throw new SupabaseAuthError(503, "La vérification de session Supabase Auth a échoué.");
  }
  const user = parseUser(result.data);
  return user;
}

export async function refreshSupabaseAuthSession(refreshToken: string): Promise<SupabaseAuthSession | null> {
  const { key } = config();
  const result = await request<AuthResponse>("/auth/v1/token?grant_type=refresh_token", {
    key, method: "POST", body: { refresh_token: refreshToken },
  });
  if (result.status === 400 || result.status === 401) return null;
  if (result.status < 200 || result.status >= 300) {
    throw new SupabaseAuthError(503, "La session Supabase Auth n’a pas pu être renouvelée.");
  }
  return parseSession(result.data);
}

export async function createSupabaseAuthUser(
  email: string,
  password: string,
  displayName: string,
): Promise<SupabaseAuthUser> {
  const { key } = config(true);
  const result = await request<{ id?: unknown; email?: unknown }>("/auth/v1/admin/users", {
    key, bearer: key, method: "POST",
    body: {
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    },
  });
  if (result.status === 422 || result.status === 409) {
    throw new SupabaseAuthError(409, "Cette adresse e-mail est déjà utilisée dans Supabase Auth.");
  }
  if (result.status < 200 || result.status >= 300) {
    throw new SupabaseAuthError(503, "La création du compte Supabase Auth a échoué.");
  }
  const user = parseUser(result.data);
  if (!user) throw new SupabaseAuthError(503, "Réponse de création Supabase Auth invalide.");
  return user;
}

export async function deleteSupabaseAuthUser(id: string): Promise<void> {
  const { key } = config(true);
  const result = await request<unknown>(`/auth/v1/admin/users/${encodeURIComponent(id)}`, {
    key, bearer: key, method: "DELETE",
  });
  if (result.status < 200 || result.status >= 300) {
    throw new SupabaseAuthError(503, "Le compte Supabase Auth créé sans profil Cabalou n’a pas pu être supprimé.");
  }
}
