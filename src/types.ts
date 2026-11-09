import type { DocumentReceipt } from "./document-receipt.ts";
export const presets = {
  OpenRouter: [
    "openai/gpt-4o",
    "openai/gpt-4o-mini",
    "anthropic/claude-sonnet-4.5",
    "google/gemini-2.5-flash",
    "anthropic/claude-3.5-sonnet",
    "deepseek/deepseek-chat",
    "google/gemini-flash-1.5",
  ],
  GroqCloud: ["openai/gpt-oss-20b", "openai/gpt-oss-120b"],
  Custom: ["", ""],
  OpenAI: ["gpt-4o", "gpt-4o-mini"],
  Anthropic: ["claude-sonnet-4-6", "claude-haiku-4-5"],
};
export type Provider = keyof typeof presets;
export type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};
export type Receipt = {
  original_tokens: number;
  compacted_tokens: number;
  saved_tokens: number;
  savings_percent: number;
  receipt_hash: string;
};
export type Estimate = Receipt & {
  historyRecall?: "fetch" | "sync";
  id: string;
  estimate: true;
  compacted: boolean;
  passthrough_reason: string | null;
};
export type Usage = Partial<
  Record<
    | "prompt_tokens"
    | "completion_tokens"
    | "cached_tokens"
    | "reasoning_tokens"
    | "cost_usd",
    number
  >
>;
export type Agent = {
  id: string;
  name: string;
  provider: string;
  model: string;
};
export type Source = { title: string; url: string };
export type Research = {
  documentReceipt?: DocumentReceipt;
  readerLink?: string;
  requestId: string;
  agentId: string;
  agentIds?: string[];
  participants?: {
    agent_id: string;
    label: string;
    status: "queued" | "running" | "completed" | "failed";
    error?: string;
  }[];
  retryIds?: Record<string, string>;
  prompt: string;
  status:
    | "submitting"
    | "unconfirmed"
    | "queued"
    | "running"
    | "completed"
    | "failed";
  runId?: string;
  userId?: string;
  error?: string;
};
export type Reply = {
  model: string;
  text: string;
  status: "waiting" | "streaming" | "complete" | "failed";
  error?: string;
  receipt?: Estimate;
  usage?: Usage;
  syncError?: string;
  remoteId?: string;
  fromCloud?: boolean;
  researchId?: string;
  sources?: Source[];
  sync?: "queued" | "synced";
};
export type Turn = {
  documentReceipt?: DocumentReceipt;
  readerLink?: string;
  sourceRole?: "system";
  id: string;
  prompt: string;
  receipt?: Receipt;
  replies: Reply[];
};
export type Chat = {
  id: string;
  title: string;
  turns: Turn[];
  roomId?: string;
  cloudUnavailable?: boolean;
  remoteLoaded?: boolean;
  research?: Research;
  rounds?: Research[];
};
export type Team = {
  roomId: string;
  url: string;
  keys: { provider: string; model: string | null }[];
  agents: { name: string; provider: string; model: string | null }[];
  note: string;
};
export type State = {
  publicKey: string;
  customBase: string;
  apiBase: string;
  fixedCloud: boolean;
  reconnect: boolean;
  paired: boolean;
  verified: boolean;
  keys: Provider[];
  chats: Chat[];
  busy: boolean;
  appVersion: string;
  updateMessage: string;
  updateReady: boolean;
  syncError: string;
  historyError: string;
  historyEnabled: boolean;
};
export type Send = {
  readerId?: string;
  id: string;
  prompt: string;
  provider: Provider;
  models: string[];
};
export type ReaderFile = { name: string; bytes: Uint8Array };
export type ReaderRequest = {
  chatId: string;
  requestId: string;
  question: string;
  files: ReaderFile[];
};
export interface Bridge {
  ideSetup:()=>Promise<{script:string;descriptor:string}>;
  registerCodex:()=>Promise<void>;
  registerCursor:()=>Promise<void>;
  detectHosts:()=>Promise<Record<string,boolean>>;
  ideProject:()=>Promise<string>;
  ideStatus:()=>Promise<string>;
  disconnectIDE:()=>Promise<void>;
  connectProject: () => Promise<string>;
  leadGoal: (goal:string,policy?:"auto"|"solo"|"two") => Promise<{report:string;diff:string;branch:string;room:string}>;
  saveLead: () => Promise<string>;
  leadProgress: (fn:(s:string)=>void) => () => void;
  checkUpdate(): Promise<void>;
  restart(): Promise<void>;
  installUpdate(): Promise<void>;
  readDocuments(input: ReaderRequest): Promise<string>;
  stopReader(id: string): Promise<void>;
  agents(id: string): Promise<Agent[]>;
  research(id: string, agent: string | string[], prompt: string, readerId?: string): Promise<void>;
  retryAgent(id: string, run: string, agent: string): Promise<void>;
  openSource(id: string, messageId: string, index: number): Promise<void>;
  state(): Promise<State>;
  listen(fn: (s: State) => void): () => void;
  pair(token: string): Promise<void>;
  unlink(): Promise<void>;
  key(provider: Provider, key: string): Promise<void>;
  open(
    page:
      | "pair"
      | "history"
      | "teams"
      | "groqKeys"
      | "groqLogin"
      | "aiSetup"
      | "savings",
  ): Promise<void>;
  send(input: Send): Promise<void>;
  stop(): Promise<void>;
  team(id: string): Promise<Team>;
  openTeam(id: string, model?: string): Promise<boolean>;
  customAddress(value: string): Promise<void>;
  apiAddress(value: string, publicKey: string): Promise<void>;
  testKey(
    provider: "OpenRouter" | "GroqCloud" | "Custom",
    value: string,
  ): Promise<void>;
  readChat(id: string): Promise<void>;
  deleteChat(id: string, scope: "device" | "cloud"): Promise<void>;
  refresh(): Promise<void>;
}
declare global {
  interface Window {
    companion: Bridge;
  }
}
