import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, delimiter, isAbsolute } from "node:path";

function onPath(name: string) {
  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter(isAbsolute)
    .map((dir) => join(dir, name))
    .find(existsSync);
}
export async function codexPath() {
  const onSystem = onPath(process.platform === "win32" ? "codex.exe" : "codex");
  if (onSystem || process.platform !== "win32") return onSystem;
  const dir = join(process.env.LOCALAPPDATA ?? "", "OpenAI", "Codex", "bin");
  const builds = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return builds
    .filter((b) => b.isDirectory())
    .map((b) => join(dir, b.name, "codex.exe"))
    .find(existsSync);
}
export async function detectHosts() {
  const cursor =
    onPath(process.platform === "win32" ? "cursor.cmd" : "cursor") ||
    (process.platform === "win32" &&
      [
        process.env.LOCALAPPDATA &&
          join(process.env.LOCALAPPDATA, "Programs", "cursor", "Cursor.exe"),
        process.env.ProgramFiles &&
          join(process.env.ProgramFiles, "cursor", "Cursor.exe"),
      ].some((f) => f && existsSync(f)));
  return {
    Codex: !!(await codexPath()),
    Cursor: !!cursor,
    "Local model host": !!onPath(
      process.platform === "win32" ? "ollama.exe" : "ollama",
    ),
  };
}
