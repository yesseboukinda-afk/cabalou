import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import nextEnv from "@next/env";

function hiddenPrompt(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdin.setRawMode) {
    throw new Error("Cette commande doit être lancée dans un terminal interactif.");
  }
  return new Promise((resolve, reject) => {
    let value = "";
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          cleanup();
          stdout.write("\n");
          reject(new Error("Opération annulée."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else if (character >= " ") value += character;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const projectUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!projectUrl || !serviceKey) {
    throw new Error("Définissez SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans .env.");
  }

  let url: URL;
  try {
    url = new URL(projectUrl);
  } catch {
    throw new Error("SUPABASE_URL n’est pas une URL valide.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("SUPABASE_URL doit être une URL HTTPS valide.");
  }

  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    const email = (await terminal.question("Adresse e-mail du compte Auth : ")).trim();
    terminal.close();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new Error("L’adresse e-mail est invalide.");
    }

    const password = await hiddenPrompt("Nouveau mot de passe : ");
    const confirmation = await hiddenPrompt("Confirmez le mot de passe : ");
    if (!password || password.length > 256 || password !== confirmation) {
      throw new Error("Les mots de passe doivent être identiques, non vides et ne pas dépasser 256 caractères.");
    }

    const headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    };
    let userId: string | null = null;
    for (let page = 1; ; page += 1) {
      const response = await fetch(
        `${url.origin}/auth/v1/admin/users?page=${page}&per_page=1000`,
        { headers, cache: "no-store" },
      );
      if (!response.ok) throw new Error("Impossible de rechercher le compte dans Supabase Auth.");
      const data = await response.json() as { users?: { id?: unknown; email?: unknown }[] };
      const users = Array.isArray(data.users) ? data.users : [];
      const match = users.find((user) =>
        typeof user.id === "string"
        && typeof user.email === "string"
        && user.email.toLowerCase() === email.toLowerCase());
      if (match && typeof match.id === "string") {
        userId = match.id;
        break;
      }
      if (users.length < 1000) break;
    }
    if (!userId) throw new Error("Aucun utilisateur Auth ne correspond à cette adresse.");

    const response = await fetch(
      `${url.origin}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
      {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        cache: "no-store",
      },
    );
    if (!response.ok) throw new Error("Supabase Auth a refusé la mise à jour du mot de passe.");
    console.log("Mot de passe Supabase Auth mis à jour. Connectez-vous avec le nom d’utilisateur Cabalou associé.");
  } finally {
    terminal.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Réinitialisation impossible.");
  process.exitCode = 1;
});
