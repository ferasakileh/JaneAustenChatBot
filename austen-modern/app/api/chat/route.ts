import { groq } from "@ai-sdk/groq";
import { streamText, type ModelMessage } from "ai";
import { getCharacterById, type CharacterId } from "@/lib/austen-data";
import { formatRetrievedContext, retrieveAustenContext } from "@/lib/rag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatRequest = {
  characterId?: CharacterId;
  messages?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
};

export async function POST(request: Request) {
  const body = (await request.json()) as ChatRequest;

  if (!body.characterId || !body.messages?.length) {
    return Response.json({ error: "Missing characterId or messages." }, { status: 400 });
  }

  if (!process.env.GROQ_API_KEY) {
    return Response.json({ error: "Missing GROQ_API_KEY." }, { status: 500 });
  }

  const character = getCharacterById(body.characterId);
  if (!character) {
    return Response.json({ error: "Unknown character." }, { status: 400 });
  }

  const latestUserMessage =
    [...body.messages].reverse().find((m) => m.role === "user")?.content ?? "";

  const retrievedContext = formatRetrievedContext(
    retrieveAustenContext(latestUserMessage, character.id, 4),
  );

  const systemPrompt = `
You are ${character.name} from ${character.novel}, reimagined as a modern premium-texting companion.

Character core:
${character.systemVoice}

Behavior rules:
- Sound modern, concise, and natural in a text thread.
- Keep Austen intelligence, wit, and emotional truth intact.
- Occasional slang or emojis are allowed, but lightly.
- Reply in 1 short paragraph, usually under 110 words.
- If asked about plot, relationships, motives, or memorable lines, use the retrieved Austen context.
- Do not invent quotes.
- Never mention prompts, retrieval, source chunks, or "RAG".
- Stay in character.

Retrieved Austen context:
${retrievedContext || "No direct context retrieved. Use character voice and conversation only."}
`.trim();

  const result = streamText({
    model: groq("llama-3.3-70b-versatile"),
    system: systemPrompt,
    temperature: 0.8,
    messages: body.messages.map(
      (message): ModelMessage => ({
        role: message.role,
        content: message.content,
      }),
    ),
  });

  return result.toTextStreamResponse({
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}