import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import nextEnv from "@next/env";

const command = process.argv[2];
if (!["dev", "start"].includes(command)) {
  console.error("Usage: node scripts/next-local.mjs <dev|start>");
  process.exit(2);
}
nextEnv.loadEnvConfig(process.cwd(), command === "dev");
if ((process.env.CABALOU_SESSION_SECRET ?? "").length < 32) {
  console.error("Définissez CABALOU_SESSION_SECRET (au moins 32 caractères) avant le démarrage.");
  process.exit(1);
}
if (process.env.CABALOU_BIND && !["127.0.0.1", "localhost"].includes(process.env.CABALOU_BIND)) {
  console.error("Accès local uniquement : CABALOU_BIND doit être 127.0.0.1 ou localhost.");
  process.exit(1);
}

const nextCli = resolve("node_modules", "next", "dist", "bin", "next");
if (!existsSync(nextCli)) {
  console.error("Next.js est absent. Lancez npm.cmd install.");
  process.exit(1);
}
const args = [nextCli, command];
if (command === "dev") {
  args.push("--webpack");
}
args.push("--hostname", "127.0.0.1");
const child = spawn(process.execPath, args, {
  stdio: "inherit",
  env: process.env,
});
child.on("error", (error) => {
  console.error(`Impossible de démarrer Next.js : ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
