export type CommentSentiment = "positive" | "neutral" | "negative";

const positiveTerms = new Set([
  "aime", "adorable", "adore", "beau", "belle", "bien", "bon", "bonne", "bravo",
  "chaleureux", "chaleureuse", "content", "contente", "excellent", "excellente", "facile",
  "formidable", "genial", "gentil", "gentille", "magnifique", "parfait", "parfaite",
  "plaisir", "recommande", "rapide", "satisfait", "satisfaite",
  "super", "top", "merci", "great", "love", "perfect", "recommend",
]);

const negativeTerms = new Set([
  "arnaque", "attente", "catastrophe", "decu", "decue", "decevant", "decevante",
  "dommage", "erreur", "horrible", "inacceptable", "insatisfait", "insatisfaite",
  "lent", "lente", "manque", "mauvais", "mauvaise", "nul", "nulle", "plainte",
  "probleme", "problemes", "retard", "cher", "chere", "insupportable", "terrible",
  "bad", "broken", "hate", "worst",
]);

const negations = new Set(["aucun", "aucune", "jamais", "pas", "plus", "sans"]);

function normalize(text: string): string[] {
  return text.toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .match(/[\p{Letter}\p{Number}']+/gu) ?? [];
}

export function classifyCommentSentiment(message: string): CommentSentiment {
  const words = normalize(message);
  let score = 0;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const polarity = positiveTerms.has(word) ? 1 : negativeTerms.has(word) ? -1 : 0;
    if (!polarity) continue;

    const context = words.slice(Math.max(0, index - 3), Math.min(words.length, index + 4));
    const negated = context.some((item, contextIndex) => (
      negations.has(item) && Math.abs(contextIndex + Math.max(0, index - 3) - index) <= 3
    ));
    score += negated ? -polarity : polarity;
  }
  return score > 0 ? "positive" : score < 0 ? "negative" : "neutral";
}
