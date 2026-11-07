import { readReceipt } from "./network.ts";
import { sourceList, updateResearch } from "./research.ts";
import type { Chat, Message } from "./types.ts";
export const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
export function context(chat: Chat): Message[] {
  return chat.turns.flatMap((t) => {
    if (t.sourceRole === "system")
      return [{ role: "system", content: t.prompt }] as Message[];
    const answer = t.replies.find((r) => r.status === "complete");
    return answer
      ? ([
          ...(t.prompt ? [{ role: "user", content: t.prompt }] : []),
          { role: "assistant", content: answer.text },
        ] as Message[])
      : t.replies.length === 0
        ? ([{ role: "user", content: t.prompt }] as Message[])
        : [];
  });
}
export function mergeHistory(local: Chat[], data: any) {
  if (!Array.isArray(data?.chats)) throw Error("Invalid ReadyCode chat list.");
  for (const c of data.chats) {
    if (
      typeof c.chat_id !== "string" ||
      !/^[\w.:-]{1,100}$/.test(c.chat_id) ||
      typeof c.title !== "string" ||
      typeof c.room_id !== "string"
    )
      throw Error("Invalid cloud chat.");
    const chat = local.find((v) => v.id === c.chat_id);
    if (chat) {
      chat.title = c.title;
      chat.roomId = c.room_id;
    } else
      local.push({
        id: c.chat_id,
        title: c.title,
        roomId: c.room_id,
        turns: [],
      });
  }
}
export function mergeMessages(chat: Chat, data: any) {
  if (!Array.isArray(data?.messages))
    throw Error("Invalid ReadyCode messages.");
  const turns: Chat["turns"] = [],
    used = new Set();
  let prompt: { id: string; content: string } | undefined;
  function include(t: Chat["turns"][number]) {
    if (!turns.includes(t)) turns.push(t);
  }
  function flush() {
    if (prompt) {
      include(
        chat.turns.find((t) => t.id === prompt!.id) ?? {
          id: prompt.id,
          prompt: prompt.content,
          replies: [],
        },
      );
      prompt = undefined;
    }
  }
  for (const m of data.messages) {
    if (
      typeof m.id !== "string" ||
      typeof m.content !== "string" ||
      typeof m.label !== "string"
    )
      throw Error("Invalid cloud message.");
    if (m.role === "user") {
      flush();
      prompt = m;
      continue;
    }
    if (m.role === "system") {
      flush();
      include({
        id: m.id,
        prompt: m.content,
        sourceRole: "system",
        replies: [],
      });
      continue;
    }
    if (m.role !== "assistant") throw Error("Unknown cloud message role.");
    const receipt = readReceipt(m.receipt);
    const local =
      chat.turns.find((t) => t.replies.some((r) => r.remoteId === m.id)) ??
      chat.turns.find(
        (t) =>
          t.prompt === prompt?.content &&
          t.replies.some(
            (r) =>
              !used.has(r) &&
              !r.remoteId &&
              r.text === m.content &&
              r.model === m.label,
          ),
      );
    if (local) {
      const r =
        local.replies.find((r) => r.remoteId === m.id) ??
        local.replies.find(
          (r) =>
            !used.has(r) &&
            !r.remoteId &&
            r.text === m.content &&
            r.model === m.label,
        )!;
      if (typeof m.run_id === "string") {
        r.fromCloud = true;
        r.researchId = m.run_id;
        r.text = m.content;
        r.sources = sourceList(m.sources);
      }
      if (receipt) r.receipt = receipt;
      used.add(r);
      r.remoteId = m.id;
      r.sync = "synced";
      include(local);
    } else {
      const t: Chat["turns"][number] = turns.find(
        (t) => t.id === prompt?.id,
      ) ?? {
        id: prompt?.id ?? m.id,
        prompt: prompt?.content ?? "",
        replies: [],
      };
      t.replies.push({
        model: m.label,
        text: m.content,
        status: "complete",
        sync: "synced",
        remoteId: m.id,
        receipt,
        fromCloud: true,
        ...(typeof m.run_id === "string"
          ? { researchId: m.run_id, sources: sourceList(m.sources) }
          : {}),
      });
      include(t);
    }
    prompt = undefined;
  }
  flush();
  const ids = new Set(turns.map((t) => t.id));
  chat.turns = [...turns, ...chat.turns.filter((t) => !ids.has(t.id))];
  chat.remoteLoaded = true;
  if (chat.research && Array.isArray(data.runs)) {
    const run = data.runs.find(
      (v: any) => v.request_id === chat.research!.requestId,
    );
    if (run) updateResearch(chat, chat.research, run);
  }
}
