import nextEnv from "@next/env";

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const databaseUrl = process.env.CABALOU_SUPABASE_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Définissez CABALOU_SUPABASE_DATABASE_URL avec la chaîne PostgreSQL Supabase avant l’initialisation.");
  }
  let protocol: string;
  try {
    protocol = new URL(databaseUrl).protocol;
  } catch {
    throw new Error("CABALOU_SUPABASE_DATABASE_URL n’est pas une URL PostgreSQL valide.");
  }
  if (!["postgres:", "postgresql:"].includes(protocol)) {
    throw new Error("CABALOU_SUPABASE_DATABASE_URL doit être la chaîne PostgreSQL (postgresql://...), pas l’URL HTTPS du projet.");
  }

  const { initializeDatabase } = await import("../lib/db");
  await initializeDatabase();
  console.log("Schéma Cabalou créé ou déjà à jour dans Supabase.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Initialisation impossible.";
  console.error(message.replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1[identifiants masqués]@"));
  process.exitCode = 1;
});
