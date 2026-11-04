import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadEnvConfig } from "@next/env";

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
          reject(new Error("Initialisation annulée."));
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
  loadEnvConfig(process.cwd());
  if ((process.env.CABALOU_SESSION_SECRET ?? "").length < 32) {
    throw new Error("Définissez CABALOU_SESSION_SECRET (au moins 32 caractères) avant l’initialisation.");
  }
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    const username = (await terminal.question("Nom d’utilisateur administrateur : ")).trim();
    const displayName = (await terminal.question("Nom affiché : ")).trim();
    terminal.close();
    const password = await hiddenPrompt("Mot de passe (12 caractères minimum) : ");
    const confirmation = await hiddenPrompt("Confirmez le mot de passe : ");
    if (password.length < 12 || password !== confirmation) {
      throw new Error("Les mots de passe doivent correspondre et comporter au moins 12 caractères.");
    }
    const { initAdmin } = await import("../lib/service");
    const userId = initAdmin(username, displayName, password);
    console.log(`Compte administrateur créé (id ${userId}).`);
  } finally {
    terminal.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Initialisation impossible.");
  process.exitCode = 1;
});
