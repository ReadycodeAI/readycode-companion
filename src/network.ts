import { createParser } from "eventsource-parser";
import type { Message, Provider, Receipt, Estimate, Usage } from "./types.ts";
export const defaultPublicKey = process.env.READYCODE_PUBLIC_KEY || "";
export const defaultBase = process.env.READYCODE_API_BASE || "";
let publicKey = defaultPublicKey,
  base = defaultBase,
  customBase = "";
export function setPublicKey(value: string) {
  if (typeof value !== "string" || /[\r\n]/.test(value))
    throw Error("Invalid ReadyCode public key.");
  publicKey = value.trim();
  return publicKey;
}
export function customEndpoint(v: string) {
  if (!v) return "";
  const url = new URL(v);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    throw Error("Use HTTPS or a local HTTP provider.");
  return url.href.replace(/\/+$/, "");
}
export function setCustom(v: string) {
  return (customBase = customEndpoint(v));
}
export class CloudUnavailable extends Error {}
export class UnknownCloudChat extends Error {}
export class CloudRateLimited extends Error {}
export function setBase(value: string) {
  if (!value) return (base = "");
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash)
    throw Error("Enter the HTTPS API address from the ReadyCode pairing page.");
  base = u.href.replace(/\/+$/, "");
  return base;
}
export function pairCode(value: string) {
  const code = value.toUpperCase().replace(/[\s-]/g, "");
  if (!/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(code))
    throw Error("Enter the eight-character code from ReadyCode.");
  return code.slice(0, 4) + "-" + code.slice(4);
}
export class DeviceRevoked extends Error {}
export async function cloud(
  path:
    | "delete_chat"
    | "pair"
    | "status"
    | "compact"
    | "sync"
    | "chats"
    | "messages"
    | "cloud_team"
    | "research_agents"
    | "research_run"
    | "room_run"
    | "room_retry"
    | "reader_context"
    | "reader_result",
  token: string,
  body?: unknown,
  signal?: AbortSignal,
) {
  if (!base || !publicKey)
    throw Error(
      "Enter the ReadyCode address and public key from the pairing page in Settings.",
    );
  const result = await fetch(base + "/" + path, {
    method: body === undefined ? "GET" : "POST",
    redirect: "error",
    headers: {
      ...(body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      apikey: publicKey,
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body:
      body instanceof FormData
        ? body
        : body === undefined
          ? undefined
          : JSON.stringify(body),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
      : AbortSignal.timeout(60000),
  }).catch((e) => {
    if (signal?.aborted) throw e;
    throw new CloudUnavailable("ReadyCode is unreachable.");
  });
  if (!result.ok) {
    if (result.status >= 500)
      throw new CloudUnavailable(
        "ReadyCode returned HTTP " + result.status + ".",
      );
    const data = await result.json().catch(() => ({}));
    if (
      path === "delete_chat" &&
      result.status === 404 &&
      data.error === "not_found"
    )
      throw Error(
        "Cloud deletion is unavailable on this ReadyCode server. You can still remove the local copy.",
      );
    if (
      result.status === 404 &&
      data.error === "not_found" &&
      (path === "room_run" || path === "room_retry")
    )
      throw Error(
        "Ask the room is not available on this ReadyCode server yet.",
      );
    if (result.status === 404 && data.error === "unknown_chat")
      throw new UnknownCloudChat(
        "This chat is no longer available on ReadyCode.",
      );
    if (
      result.status === 404 &&
      data.error === "not_found" &&
      (path === "reader_context" || path === "reader_result")
    )
      throw Error(
        "ReadyCode Reader is not enabled on this backend yet. Your document was not sent to an agent.",
      );
    if (
      result.status === 404 &&
      data.error === "not_found" &&
      (path === "research_agents" || path === "research_run")
    )
      throw Error("ReadyCode Agents are not enabled on this backend yet.");
    if (result.status === 401 && data.error === "invalid_device")
      throw new DeviceRevoked(
        "This computer was disconnected. Reconnect to ReadyCode.",
      );
    if (result.status === 429)
      throw new CloudRateLimited(
        data.message || "ReadyCode rate limit reached.",
      );
    if (typeof data.message === "string") throw Error(data.message);
    if (result.status === 402 || result.status === 403)
      throw Error(
        "Your account needs access to ReadyCode Cloud. Check your plan on the ReadyCode website.",
      );
    throw Error(
      "ReadyCode returned HTTP " +
        result.status +
        (data.error ? " (" + data.error + ")" : "") +
        ".",
    );
  }
  return result;
}
export async function testProviderKey(
  provider: "OpenRouter" | "GroqCloud" | "Custom",
  key: string,
) {
  const endpoint =
    provider === "Custom"
      ? customBase + "/models"
      : provider === "GroqCloud"
        ? "https://api.groq.com/openai/v1/models"
        : "https://openrouter.ai/api/v1/key";
  if (!key || /[\r\n]/.test(key))
    throw Error("Enter a valid " + provider + " key.");
  const r = await fetch(endpoint, {
    redirect: "error",
    headers: { Authorization: "Bearer " + key },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok)
    throw Error(provider + " key test returned HTTP " + r.status + ".");
}
export function isReceipt(v: any): v is Receipt {
  return (
    !!v &&
    ["original_tokens", "compacted_tokens", "saved_tokens"].every(
      (k) => Number.isSafeInteger(v[k]) && v[k] >= 0,
    ) &&
    Number.isFinite(v.savings_percent) &&
    v.savings_percent >= 0 &&
    v.savings_percent <= 100 &&
    typeof v.receipt_hash === "string" &&
    !!v.receipt_hash
  );
}
export function readReceipt(raw: any): Estimate | undefined {
  if (
    raw?.estimate !== true ||
    typeof raw.compacted !== "boolean" ||
    typeof raw.id !== "string" ||
    !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(raw.id)
  )
    return;
  const receipt = {
    id: raw.id,
    estimate: true as const,
    compacted: raw.compacted,
    passthrough_reason: ["short_chat", "short chat"].includes(
      raw.passthrough_reason,
    )
      ? "short_chat"
      : null,
    receipt_hash: raw.receipt_hash,
    original_tokens: raw.original_tokens_est,
    compacted_tokens: raw.compacted_tokens_est,
    saved_tokens: raw.saved_tokens_est,
    savings_percent: raw.savings_percent_est,
  };
  if (isReceipt(receipt)) return receipt as Estimate;
}
export async function compact(
  token: string,
  id: string,
  model: string,
  messages: Message[],
  signal: AbortSignal,
) {
  const request = { chat_id: id, model, messages };
  if (
    messages.length > 500 ||
    Buffer.byteLength(JSON.stringify(request)) > 1_000_000
  )
    throw Error(
      "This conversation exceeds ReadyCode’s 500-message or 1 MB limit.",
    );
  const data = await (
    await cloud("compact", token, { chat_id: id, model, messages }, signal)
  ).json();
  const receipt = readReceipt(data.receipt);
  if (
    !Array.isArray(data.compacted_messages) ||
    !data.compacted_messages.length ||
    !data.compacted_messages.every(
      (m: any) =>
        m &&
        ["user", "assistant", "system"].includes(m.role) &&
        typeof m.content === "string",
    ) ||
    !receipt
  )
    throw Error("ReadyCode returned an invalid compaction result.");
  return {
    messages: data.compacted_messages as Message[],
    receipt,
  };
}
const destinations: Record<Provider, string> = {
  get Custom() {
    if (!customBase) throw Error("Configure the custom provider address.");
    return customBase + "/chat/completions";
  },
  OpenRouter: "https://openrouter.ai/api/v1/chat/completions",
  GroqCloud: "https://api.groq.com/openai/v1/chat/completions",
  OpenAI: "https://api.openai.com/v1/chat/completions",
  Anthropic: "https://api.anthropic.com/v1/chat/completions",
};
export async function stream(
  provider: Provider,
  key: string,
  model: string,
  messages: Message[],
  signal: AbortSignal,
  append: (text: string) => void,
) {
  const body = {
    model,
    messages,
    stream: true,
    ...(provider === "Anthropic" ? { max_tokens: 8192 } : {}),
    ...(provider === "OpenRouter" ? { usage: { include: true } } : {}),
  };
  const headers = { Authorization: "Bearer " + key };
  const result = await fetch(destinations[provider], {
    method: "POST",
    redirect: "error",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(600000)]),
  });
  if (provider === "GroqCloud" && result.status === 429) {
    const wait = result.headers.get("retry-after");
    throw Error(
      "GroqCloud rate limit reached. " +
        (wait && /^\d+$/.test(wait)
          ? "Try again in " + wait + " seconds."
          : "Try again when your GroqCloud quota resets."),
    );
  }
  if (!result.ok || !result.body)
    throw Error(
      provider +
        " returned HTTP " +
        result.status +
        ". Check your key and model.",
    );
  let done = false;
  let usage: Usage | undefined;
  const parser = createParser({
    onEvent: ({ data }) => {
      if (done) return;
      if (data === "[DONE]") {
        done = true;
        return;
      }
      const event = JSON.parse(data);
      if (
        event.error ||
        event.type === "error" ||
        event.choices?.[0]?.finish_reason === "error"
      )
        throw Error(provider + " interrupted the stream.");
      const u =
        provider === "GroqCloud"
          ? (event.x_groq?.usage ?? event.usage)
          : provider === "OpenRouter"
            ? event.usage
            : undefined;
      if (u) {
        const values = {
          prompt_tokens: u.prompt_tokens,
          completion_tokens: u.completion_tokens,
          cached_tokens: u.prompt_tokens_details?.cached_tokens,
          reasoning_tokens: u.completion_tokens_details?.reasoning_tokens,
          cost_usd: u.cost,
        };
        usage = Object.fromEntries(
          Object.entries(values).filter(
            ([, v]) => Number.isFinite(v) && v >= 0,
          ),
        );
      }
      const delta = event.choices?.[0]?.delta?.content;
      if (typeof delta === "string") append(delta);
    },
  });
  const reader = result.body.getReader(),
    decoder = new TextDecoder();
  try {
    while (!done) {
      const part = await reader.read();
      if (part.done) {
        parser.feed(decoder.decode());
        break;
      }
      parser.feed(decoder.decode(part.value, { stream: true }));
    }
    if (!done)
      throw Error(
        provider + " closed the connection before the reply finished.",
      );
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return usage;
}
