export type CommentSentiment = "positive" | "neutral" | "negative";

const positiveTerms = new Set([
  "abordable", "accueillant", "accueillante", "admirable", "adorable", "adore", "aime",
  "apprecie", "approuve", "beau", "belle", "bien", "bon", "bonne", "bravo", "chaleureux",
  "chaleureuse", "confortable", "content", "contente", "convaincu", "convaincue",
  "courtois", "courtoise", "delicieux", "delicieuse", "disponible", "efficace",
  "excellent", "excellente", "exceptionnel", "exceptionnelle", "facile", "fiable",
  "formidable", "genial", "geniale", "gentil", "gentille", "impeccable", "incroyable",
  "merveilleux", "merveilleuse", "magnifique", "parfait", "parfaite", "plaisir", "positif",
  "positive", "propre", "professionnel", "professionnelle", "qualite", "rapide",
  "recommande", "recommander", "satisfait", "satisfaite", "satisfaisant", "satisfaisante",
  "souriant", "souriante", "super", "superbe", "top", "utile", "respectueux",
  "respectueuse", "merci", "love", "great", "excellent", "perfect", "recommend", "amazing",
  "helpful", "friendly",
]);

const negativeTerms = new Set([
  "abusif", "abusifs", "arnaque", "attente", "bruyant", "bruyante", "catastrophe",
  "complique", "compliquee", "couteux", "couteuse", "decu", "decue", "decevant",
  "decevante", "defaut", "defauts", "degoutant", "degoutante", "desagreable",
  "desagreables", "desorganise", "desorganisee", "deteste", "difficile", "dommage",
  "dangereux", "dangereuse", "echec", "erreur", "fache", "fachee", "frustre", "frustree",
  "honteux", "honteuse", "horrible", "inacceptable", "incompetent", "incompetente",
  "indisponible", "inefficace", "insatisfait", "insatisfaite", "lent", "lente", "long",
  "longue", "manque", "mauvais", "mauvaise", "mediocre", "mensonge", "nul", "nulle",
  "penible", "plainte", "probleme", "problemes", "sale", "scandaleux", "scandaleuse",
  "cher", "chere", "chers", "cheres", "insupportable", "terrible", "retard", "retards",
  "souci", "soucis", "mal", "deconseille", "deconseillee", "deplorable", "impoli",
  "impolie", "irrespectueux", "irrespectueuse", "bad", "broken", "disappointed",
  "disappointing", "hate", "poor", "terrible", "worst",
]);

const negations = new Set(["aucun", "aucune", "jamais", "ne", "non", "n", "no", "not", "pas", "sans", "never", "without"]);
const contrastWords = new Set(["cependant", "mais", "pourtant", "toutefois"]);
const negationScopeBreakers = new Set(["et", "ou"]);
const intensifiers = new Set(["absolument", "vraiment", "extremement", "tellement", "tres", "super"]);
const diminishers = new Set(["assez", "legerement", "relativement", "plutot", "presque"]);
const politeRequestVerbs = new Set(["confirmer", "indiquer", "preciser", "rappeler", "repondre", "envoyer", "transmettre"]);
const courtesyTitles = new Set(["ami", "amis", "client", "clients", "madame", "monsieur", "partenaire", "partenaires"]);

function normalize(text: string): string {
  return text.toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/n['’](?=\p{Letter})/gu, "n ")
    .replace(/[’']/gu, " ")
    .replace(/[,.!?;:\r\n]+/gu, " | ")
    .replace(/[^\p{Letter}\p{Number}|]+/gu, " ")
    .trim();
}

function polarityOf(words: string[], index: number): -1 | 0 | 1 {
  const word = words[index];
  if (word === "merci" && words[index + 1] === "de" && politeRequestVerbs.has(words[index + 2] ?? "")) return 0;
  if (word === "attente") {
    const context = words.slice(Math.max(0, index - 2), Math.min(words.length, index + 3));
    if (!context.some((item) => ["excessive", "interminable", "long", "longue", "trop"].includes(item))) return 0;
  }
  if (word === "manque" && words[index + 1] === "a"
    && ["votre", "ta"].includes(words[index + 2] ?? "")
    && ["liste", "selection"].includes(words[index + 3] ?? "")) return 1;
  if (["cher", "chere", "chers", "cheres"].includes(word)
    && courtesyTitles.has(words[index + 1] ?? "")) return 0;
  if (word === "bien" && ["cordialement", "compris", "note", "recu"].includes(words[index + 1] ?? "")) return 0;
  if (["ne", "n", "non", "not"].includes(word) && ["only", "seulement"].includes(words[index + 1] ?? "")) return 0;
  const variants = [word, word.endsWith("s") ? word.slice(0, -1) : "", word.endsWith("e") ? word.slice(0, -1) : ""];
  if (variants.some((variant) => positiveTerms.has(variant))) return 1;
  if (variants.some((variant) => negativeTerms.has(variant))) return -1;
  return 0;
}

function hasNearbyNegation(words: string[], index: number): boolean {
  for (let cursor = Math.max(0, index - 4); cursor < Math.min(words.length, index + 3); cursor += 1) {
    if (["not", "non", "ne", "n"].includes(words[cursor])
      && ["only", "seulement"].includes(words[cursor + 1] ?? "")) continue;
    if (negations.has(words[cursor])
      && !words.slice(Math.min(cursor, index) + 1, Math.max(cursor, index)).some((word) => negationScopeBreakers.has(word))) return true;
  }
  return false;
}

function termWeight(words: string[], index: number): number {
  const context = words.slice(Math.max(0, index - 2), index);
  if (context.some((word) => intensifiers.has(word))) return 1.5;
  if (context.some((word) => diminishers.has(word))) return 0.6;
  return 1;
}

function sentimentScores(text: string): { positive: number; negative: number } {
  const words = normalize(text).split(/\s+/u).filter(Boolean);
  let positive = 0;
  let negative = 0;
  let clause: string[] = [];

  const scoreClause = () => {
    for (let index = 0; index < clause.length; index += 1) {
      const polarity = polarityOf(clause, index);
      if (!polarity) continue;
      const adjusted = hasNearbyNegation(clause, index) ? -polarity : polarity;
      const weight = termWeight(clause, index);
      if (adjusted > 0) positive += weight;
      else negative += weight;
    }
    clause = [];
  };

  for (const word of words) {
    if (word === "|" || contrastWords.has(word)) scoreClause();
    else clause.push(word);
  }
  scoreClause();
  return { positive, negative };
}

export function classifyCommentSentiment(message: string): CommentSentiment {
  const { positive, negative } = sentimentScores(message);
  if (positive > 0 && negative > 0) return "neutral";
  if (positive > 0 && negative === 0) return "positive";
  if (negative > 0 && positive === 0) return "negative";
  if (positive > negative) return "positive";
  if (negative > positive) return "negative";
  return "neutral";
}
