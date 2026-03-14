"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  characterList,
  getCharacterById,
  type CharacterId,
} from "@/lib/austen-data";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  status?: "delivered" | "read";
};

const spring = {
  type: "spring",
  stiffness: 260,
  damping: 24,
} as const;

function formatTime(value: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

const SESSION_KEY = "austen-modern-session-v1";

const POSITIVE_PATTERNS: Array<[RegExp, number]> = [
  [/\b(please|thank you|thanks|kindly|pardon|forgive me|if you please)\b/gi, 2.6],
  [/\b(i appreciate|grateful|that means a lot|very kind)\b/gi, 2.2],
  [/\b(perhaps|might|may|would you|could you)\b/gi, 1.1],
  [/\b(sorry|apologies|my mistake|i was wrong)\b/gi, 2.4],
  [/\b(dear|lovely|delightful|splendid)\b/gi, 1.4],
];

const NEGATIVE_PATTERNS: Array<[RegExp, number]> = [
  [/\b(shut up|idiot|stupid|moron)\b/gi, -8.5],
  [/\b(damn|hell|wtf)\b/gi, -3.6],
  [/\b(lol|lmao|bruh|omg)\b/gi, -1.5],
  [/[!?]{3,}/g, -2.8],
  [/\b[A-Z]{5,}\b/g, -2.4],
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function countMatches(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0;
}

function scoreSingleMessage(
  message: ChatMessage,
  idx: number,
  total: number,
) {
  const text = message.content;
  const len = Math.max(1, text.length);

  let delta = 0;

  for (const [pattern, weight] of POSITIVE_PATTERNS) {
    delta += countMatches(text, pattern) * weight;
  }

  for (const [pattern, weight] of NEGATIVE_PATTERNS) {
    delta += countMatches(text, pattern) * weight;
  }

  const emojiCount =
    text.match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu)?.length ?? 0;
  if (emojiCount > 4) delta -= (emojiCount - 4) * 0.8;

  const upperChars = (text.match(/[A-Z]/g)?.length ?? 0);
  const alphaChars = (text.match(/[A-Za-z]/g)?.length ?? 1);
  const upperRatio = upperChars / alphaChars;
  if (upperRatio > 0.45 && alphaChars > 10) delta -= 3.2;

  // Slight recency weighting: newer messages affect score more.
  const recencyWeight = total <= 1 ? 1 : 0.65 + (idx / (total - 1)) * 0.35;

  // User tone should count a bit more than assistant tone.
  const roleWeight = message.role === "user" ? 1.1 : 0.9;

  // Tiny normalization by length to avoid huge swings from long messages.
  const lengthFactor = clamp(220 / (len + 60), 0.55, 1.15);

  return delta * recencyWeight * roleWeight * lengthFactor;
}

function calculateProprietyScore(messages: ChatMessage[]) {
  if (messages.length === 0) return 88;

  const recent = messages.slice(-30);
  let score = 82;

  for (let i = 0; i < recent.length; i++) {
    score += scoreSingleMessage(recent[i], i, recent.length);
  }

  // Balance bonus: polite back-and-forth usually reads more proper.
  const userCount = recent.filter((m) => m.role === "user").length;
  const assistantCount = recent.length - userCount;
  const balance = 1 - Math.abs(userCount - assistantCount) / Math.max(1, recent.length);
  score += balance * 3.5;

  return Math.round(clamp(score, 30, 99));
}

function getProprietyLabel(score: number) {
  if (score >= 94) return "Impeccable";
  if (score >= 87) return "Well-Composed";
  if (score >= 76) return "Mostly Proper";
  if (score >= 64) return "A Touch Bold";
  return "Scandalously Casual";
}

function getConversationNotes(messages: ChatMessage[]) {
  const joined = messages.map((message) => message.content).join(" ");
  const notes: string[] = [];

  if (/\b(please|thank you|perhaps|forgive|dear)\b/i.test(joined)) {
    notes.push("Excellent manners detected.");
  }

  if (/\b(omg|lol|bruh|wtf)\b/i.test(joined)) {
    notes.push("Modern slang is lowering the drawing-room tone.");
  }

  if (/[!?]{3,}/.test(joined) || /\b[A-Z]{4,}\b/.test(joined)) {
    notes.push("Intensity is outpacing decorum.");
  }

  if (notes.length === 0) {
    notes.push("The thread remains pleasantly civil.");
  }

  return notes.slice(0, 3);
}

export default function Home() {
  const [selectedCharacterId, setSelectedCharacterId] =
    useState<CharacterId | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [responseMode, setResponseMode] = useState<"ai" | "fallback">("ai");
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const activeCharacter = selectedCharacterId
    ? getCharacterById(selectedCharacterId)
    : null;

  const proprietyScore = useMemo(
    () => calculateProprietyScore(messages),
    [messages],
  );

  const conversationNotes = useMemo(
    () => getConversationNotes(messages),
    [messages],
  );

  const lastReadUserId = useMemo(
    () =>
      [...messages].reverse().find(
        (message) => message.role === "user" && message.status === "read",
      )?.id,
    [messages],
  );

  useEffect(() => {
    const node = scrollRef.current;

    if (!node) {
      return;
    }

    node.scrollTo({
      top: node.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isTyping]);

  useEffect(() => {
    // smoother and more reliable bottom anchoring while streaming
    endRef.current?.scrollIntoView({
      behavior: isTyping || isSending ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, isTyping, isSending]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as {
        characterId: CharacterId | null;
        messages: ChatMessage[];
      };

      if (parsed.characterId) {
        setSelectedCharacterId(parsed.characterId);
        setIsDrawerOpen(false);
      }

      if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
        setMessages(parsed.messages);
      }
    } catch {
      // ignore malformed storage
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        characterId: selectedCharacterId,
        messages,
      }),
    );
  }, [selectedCharacterId, messages]);

  function chooseCharacter(id: CharacterId) {
    const character = getCharacterById(id);

    if (!character) {
      return;
    }

    setSelectedCharacterId(id);
    setMessages([
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: character.opener,
        timestamp: Date.now(),
      },
    ]);
    setResponseMode("ai");
    setIsDrawerOpen(false);
  }

  async function sendMessage(rawText: string) {
    const text = rawText.trim();

    if (!activeCharacter || !text || isSending) {
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: Date.now(),
      status: "delivered",
    };

    const nextMessages = [...messages, userMessage];

    setMessages(nextMessages);
    setInput("");
    setIsSending(true);
    setIsTyping(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          characterId: activeCharacter.id,
          messages: nextMessages.map(({ role, content }) => ({
            role,
            content,
          })),
        }),
      });

      const nextMode = response.headers.get("x-austen-mode");

      if (nextMode === "ai" || nextMode === "fallback") {
        setResponseMode(nextMode);
      }

      if (!response.ok || !response.body) {
        throw new Error("Request failed.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const assistantId = crypto.randomUUID();

      let assistantText = "";
      let started = false;

      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });

        if (!chunk) {
          continue;
        }

        assistantText += chunk;

        if (!started) {
          started = true;
          setIsTyping(false);
          setMessages((current) => [
            ...current,
            {
              id: assistantId,
              role: "assistant",
              content: assistantText,
              timestamp: Date.now(),
            },
          ]);
          continue;
        }

        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: assistantText,
                }
              : message,
          ),
        );
      }

      if (!started) {
        setMessages((current) => [
          ...current,
          {
            id: assistantId,
            role: "assistant",
            content: "…",
            timestamp: Date.now(),
          },
        ]);
      }

      window.setTimeout(() => {
        setMessages((current) =>
          current.map((message) =>
            message.id === userMessage.id
              ? {
                  ...message,
                  status: "read",
                }
              : message,
          ),
        );
      }, 420);
    } catch {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "The thread has gone quiet for a moment. Try again and I shall recover my composure.",
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsTyping(false);
      setIsSending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  const dayLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
  }).format(new Date());

  return (
    <div className="h-full px-2 py-2 sm:px-3 sm:py-3 lg:px-4">
      <div className="mx-auto flex min-h-[calc(100dvh-86px)] w-full max-w-5xl flex-col gap-3">
        <section className="glass-panel order-1 flex min-h-[72dvh] flex-1 flex-col overflow-hidden rounded-[1.6rem] border border-white/70 shadow-[0_22px_60px_rgba(84,106,132,0.14)]">
          <header className="border-b border-[var(--line)] px-3 py-3 sm:px-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                {activeCharacter ? (
                  <div
                    className="rounded-full p-[2px]"
                    style={{ backgroundColor: activeCharacter.accent }}
                  >
                    <Image
                      src={activeCharacter.avatar}
                      alt={activeCharacter.name}
                      width={48}
                      height={48}
                      className="rounded-full bg-white"
                    />
                  </div>
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-600">
                    AM
                  </div>
                )}
                <div className="min-w-0">
                  <p className="serif-display truncate text-xl text-slate-900">
                    {activeCharacter?.name ?? "Austen-Modern"}
                  </p>
                  <p className="truncate text-sm text-slate-500">
                    {activeCharacter?.bio ??
                      "Choose a correspondent to begin the thread."}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {responseMode === "fallback" ? (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium tracking-[0.14em] text-amber-700 uppercase">
                    Local mode
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setIsDrawerOpen(true)}
                  className="rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-white"
                >
                  Characters
                </button>
              </div>
            </div>
          </header>

          {/* integrated insights (no detached sidebar) */}
          <div className="border-b border-[var(--line)] px-3 py-3 sm:px-5">
            <div className="grid gap-2 sm:grid-cols-2">
              <div
                className="rounded-2xl border border-white/80 p-3"
                style={{ backgroundColor: activeCharacter?.surfaceTint ?? "#f0f5f8" }}
              >
                <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">
                  Current Propriety Score
                </p>
                <div className="mt-1 flex items-end justify-between gap-2">
                  <span className="serif-display text-3xl text-slate-900">
                    {proprietyScore}
                  </span>
                  <span className="text-xs text-slate-500">
                    {getProprietyLabel(proprietyScore)}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/70">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#c8d9e9] via-[#9db8d0] to-[#6f8da7]"
                    style={{ width: `${proprietyScore}%` }}
                  />
                </div>
              </div>

            </div>
          </div>

          <div
            ref={scrollRef}
            className="soft-scroll flex-1 space-y-4 overflow-y-auto px-3 py-4 sm:px-5"
          >
            <div className="flex justify-center">
              <div className="rounded-full bg-white/70 px-3 py-1 text-xs tracking-[0.24em] text-slate-500 uppercase">
                {dayLabel}
              </div>
            </div>

            <AnimatePresence initial={false}>
              {messages.map((message) => {
                const isUser = message.role === "user";

                return (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 18, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    transition={spring}
                    className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    <div className="max-w-[84%]">
                      <div
                        className={`rounded-[28px] px-4 py-3 shadow-[0_12px_30px_rgba(102,126,148,0.10)] sm:px-5 ${
                          isUser
                            ? "rounded-br-md bg-[#dcecff] text-slate-900"
                            : "rounded-bl-md border border-white/80 bg-white/92 text-slate-800"
                        }`}
                      >
                        <p className="whitespace-pre-wrap text-[15px] leading-7">
                          {message.content}
                        </p>
                      </div>

                      <div
                        className={`mt-1 flex items-center gap-2 px-2 text-[11px] text-slate-400 ${
                          isUser ? "justify-end" : "justify-start"
                        }`}
                      >
                        <span>{formatTime(message.timestamp)}</span>
                        {message.id === lastReadUserId ? <span>Read</span> : null}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            <AnimatePresence>
              {isTyping ? (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={spring}
                  className="flex justify-start"
                >
                  <div className="rounded-[26px] rounded-bl-md border border-white/80 bg-white/92 px-4 py-3 shadow-[0_12px_30px_rgba(102,126,148,0.10)]">
                    <div className="flex items-center gap-2">
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                    </div>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <div ref={endRef} />
          </div>

          <div className="sticky bottom-0 border-t border-[var(--line)] bg-white/70 px-3 py-3 backdrop-blur-sm sm:px-5">
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {activeCharacter?.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={isSending}
                  onClick={() => void sendMessage(suggestion)}
                  className="shrink-0 rounded-full border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {suggestion}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="flex items-end gap-2">
              <label htmlFor="message" className="sr-only">
                Message
              </label>
              <textarea
                id="message"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                rows={1}
                placeholder={
                  activeCharacter
                    ? `Text ${activeCharacter.shortName}…`
                    : "Choose a character to begin…"
                }
                disabled={!activeCharacter || isSending}
                className="min-h-[48px] flex-1 resize-none rounded-[1.3rem] border border-slate-200 bg-white/85 px-4 py-3 text-[14px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-300"
              />
              <button
                type="submit"
                disabled={!activeCharacter || !input.trim() || isSending}
                className="rounded-full bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                Send
              </button>
            </form>
          </div>
        </section>
      </div>

      <AnimatePresence>
        {isDrawerOpen ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/25 backdrop-blur-sm"
          >
            <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-4xl px-2 pb-2 sm:px-3 sm:pb-3">
              <motion.div
                initial={{ y: 80, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 60, opacity: 0 }}
                transition={spring}
                className="glass-panel max-h-[82dvh] overflow-y-auto rounded-[1.6rem] border border-white/70 p-4 shadow-[0_40px_100px_rgba(74,93,117,0.18)] sm:p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.28em] text-slate-500">
                      Austen-Modern
                    </p>
                    <h1 className="serif-display mt-2 text-3xl text-slate-900">
                      Choose a correspondent
                    </h1>
                  </div>

                  {activeCharacter ? (
                    <button
                      type="button"
                      onClick={() => setIsDrawerOpen(false)}
                      className="rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-sm font-medium text-slate-700"
                    >
                      Continue thread
                    </button>
                  ) : null}
                </div>

                <div className="profile-chooser mt-6" role="list" aria-label="Choose character profile">
                  {characterList.map((character) => (
                    <button
                      key={character.id}
                      type="button"
                      onClick={() => chooseCharacter(character.id)}
                      className="profile-tile group"
                      role="listitem"
                    >
                      <div
                        className="profile-avatar-ring"
                        style={{ backgroundColor: character.accent }}
                      >
                        <Image
                          src={character.avatar}
                          alt={character.name}
                          width={112}
                          height={112}
                          className="profile-avatar"
                        />
                      </div>

                      <h2 className="serif-display mt-3 text-2xl text-slate-900">
                        {character.shortName}
                      </h2>

                      {/* no truncation: let title wrap naturally */}
                      <p className="profile-novel mt-1 text-[12px] text-slate-500">
                        {character.novel}
                      </p>

                      <p className="mt-3 text-sm leading-6 text-slate-600">
                        {character.bio}
                      </p>
                    </button>
                  ))}
                </div>
              </motion.div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
