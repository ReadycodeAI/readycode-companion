import type { Agent, Chat, Research, Source } from "./types.ts";

export function researchAgents(data: any): Agent[] {
  if (!Array.isArray(data?.agents))
    throw Error("Invalid ReadyCode agent catalog.");
  return data.agents
    .filter(
      (a: any) =>
        Array.isArray(a?.capabilities) &&
        (a.capabilities.includes("chat") ||
          a.capabilities.includes("web_research")),
    )
    .map((a: any) => {
      if (
        ![a.id, a.name, a.provider, a.model].every(
          (v) => typeof v === "string" && v.length > 0,
        )
      )
        throw Error("Invalid research agent.");
      return { id: a.id, name: a.name, provider: a.provider, model: a.model };
    });
}
export function sourceList(value: unknown): Source[] {
  if (!Array.isArray(value)) return [];
  const sources = new Map<string, Source>();
  for (const item of value) {
    if (typeof item?.url !== "string") continue;
    try {
      const u = new URL(item.url);
      if (u.protocol !== "https:" || u.username || u.password) continue;
      sources.set(u.href, {
        title:
          typeof item.title === "string" && item.title.trim()
            ? item.title.trim()
            : u.hostname,
        url: u.href,
      });
    } catch {
      continue;
    }
  }
  return [...sources.values()];
}
export function updateResearch(chat: Chat, run: Research, row: any) {
  if (
    row?.request_id !== run.requestId ||
    typeof row.run_id !== "string" ||
    !row.run_id ||
    typeof row.room_id !== "string" ||
    !row.room_id ||
    typeof row.user_message_id !== "string" ||
    !row.user_message_id ||
    !["queued", "running", "completed", "failed"].includes(row.status) ||
    (run.runId && run.runId !== row.run_id) ||
    (chat.roomId && chat.roomId !== row.room_id)
  )
    throw Error("Invalid ReadyCode research acknowledgement.");
  if (run.agentIds) {
    if (
      !Array.isArray(row.participants) ||
      !row.participants.length ||
      row.participants.some(
        (p: any) =>
          !run.agentIds!.includes(p?.agent_id) ||
          typeof p.label !== "string" ||
          !["queued", "running", "completed", "failed"].includes(p.status),
      )
    )
      throw Error("Invalid ReadyCode room participants.");
    run.participants = row.participants.map((p: any) => ({
      agent_id: p.agent_id,
      label: p.label,
      status: p.status,
      error: typeof p.error === "string" ? p.error : undefined,
    }));
  }
  chat.roomId = row.room_id;
  run.runId = row.run_id;
  run.userId = row.user_message_id;
  const turn = chat.turns.find(t => t.id === run.userId);
  if (turn && run.documentReceipt) turn.documentReceipt = run.documentReceipt;
  if (
    !run.agentIds &&
    (run.status === "completed" || run.status === "failed") &&
    row.status !== run.status
  )
    return;
  if (run.status === "running" && row.status === "queued") return;
  run.status = row.status;
  run.error =
    row.status === "failed"
      ? typeof row.error === "string"
        ? row.error
        : "ReadyCode could not finish this research run."
      : undefined;
}
