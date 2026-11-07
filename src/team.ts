import type { Team } from "./types";
export function roomURL(value: unknown) {
  if (typeof value !== "string") throw Error("Invalid ReadyCode room link.");
  const u = new URL(value);
  if (u.origin !== "https://readycode.ai" || u.username || u.password)
    throw Error("Unexpected ReadyCode room link.");
  return u.href;
}
export function parseTeam(v: any, roomId: string): Team {
  if (
    !v ||
    v.room_id !== roomId ||
    !Array.isArray(v.cloud_keys) ||
    !Array.isArray(v.room_ais)
  )
    throw Error("Invalid Cloud Team response.");
  const descriptor = (row: any) => {
    if (
      !row ||
      typeof row.provider !== "string" ||
      (row.model != null && typeof row.model !== "string")
    )
      throw Error("Invalid cloud provider.");
    return { provider: row.provider, model: row.model ?? null };
  };
  return {
    roomId,
    url: roomURL(v.open_url),
    keys: v.cloud_keys.map(descriptor),
    agents: v.room_ais.map((a: any) => {
      if (typeof a?.name !== "string") throw Error("Invalid agent name.");
      return { ...descriptor(a), name: a.name };
    }),
    note: typeof v.note === "string" ? v.note : "",
  };
}
