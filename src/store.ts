import { app, safeStorage } from "electron";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Chat, Provider } from "./types";
function file(name: string) {
  return join(app.getPath("userData"), name + ".json");
}
function read<T>(name: string, fallback: T): T {
  return existsSync(file(name))
    ? JSON.parse(readFileSync(file(name), "utf8"))
    : fallback;
}
function write(name: string, value: unknown) {
  const path = file(name);
  writeFileSync(path + ".tmp", JSON.stringify(value), {
    mode: 0o600,
    flush: true,
  });
  renameSync(path + ".tmp", path);
}
type Secret = Provider | "device";
export function saved(id: Secret) {
  return !!read<Record<string, string>>("secrets", {})[id];
}
function checkVault() {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === "linux" &&
      safeStorage.getSelectedStorageBackend() === "basic_text")
  )
    throw Error("Unlock your OS keychain to use secure storage.");
}
export function secret(id: Secret) {
  const value = read<Record<string, string>>("secrets", {})[id];
  if (!value) return "";
  checkVault();
  return safeStorage.decryptString(Buffer.from(value, "base64"));
}
export function saveSecret(id: Secret, value: string) {
  const values = read<Record<string, string>>("secrets", {});
  if (value) {
    checkVault();
    values[id] = safeStorage.encryptString(value).toString("base64");
  } else delete values[id];
  write("secrets", values);
}
function cache(token: string) {
  return "history-" + createHash("sha256").update(token).digest("hex");
}
export function loadChats(token: string): Chat[] {
  return token ? read<Chat[]>(cache(token), []) : [];
}
export function persist(token: string, chats: Chat[]) {
  if (token) write(cache(token), chats);
}
export const readAddress = (fallback: string) =>
  read<string>("api-address", fallback);
export const writeAddress = (value: string) => write("api-address", value);
export const readPublicKey = (v: string) => read<string>("public-key", v);
export const writePublicKey = (v: string) => write("public-key", v);
export const readCustom = () => read<string>("custom-provider", "");
export const writeCustom = (v: string) => write("custom-provider", v);
