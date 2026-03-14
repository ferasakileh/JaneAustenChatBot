import {
  austenKnowledgeBase,
  type AustenKnowledgeEntry,
  type CharacterId,
} from "@/lib/austen-data";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "with",
  "this",
  "from",
  "have",
  "what",
  "your",
  "about",
  "would",
  "could",
  "there",
  "they",
  "them",
  "their",
  "into",
  "when",
  "were",
  "been",
  "just",
  "like",
  "really",
  "tell",
  "does",
  "think",
  "how",
  "why",
]);

function tokenize(text: string) {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s']/g, " ")
        .split(/\s+/)
        .filter((token) => token.length > 2 && !STOPWORDS.has(token)),
    ),
  );
}

function scoreEntry(entry: AustenKnowledgeEntry, queryTerms: string[]) {
  const combined = tokenize(
    [entry.source, entry.summary, entry.excerpt, ...entry.keywords].join(" "),
  );
  const combinedSet = new Set(combined);

  return queryTerms.reduce((score, term) => {
    const keywordBoost = entry.keywords.includes(term) ? 3 : 0;
    const textBoost = combinedSet.has(term) ? 2 : 0;
    return score + keywordBoost + textBoost;
  }, 0);
}

export function retrieveAustenContext(
  query: string,
  characterId: CharacterId,
  limit = 4,
) {
  const queryTerms = tokenize(query);

  return austenKnowledgeBase
    .filter(
      (entry) => entry.character === characterId || entry.character === "all",
    )
    .map((entry) => ({
      ...entry,
      score:
        queryTerms.length > 0
          ? scoreEntry(entry, queryTerms)
          : entry.character === characterId
            ? 1
            : 0,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function formatRetrievedContext(
  entries: ReturnType<typeof retrieveAustenContext>,
) {
  return entries
    .map(
      (entry, index) =>
        `${index + 1}. [${entry.source}] ${entry.summary}\nQuote: ${entry.excerpt}`,
    )
    .join("\n\n");
}