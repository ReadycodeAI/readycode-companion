import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
const run = promisify(execFile);

// Consult Git's index locally. Only path hints leave this function.
export async function projectHints(root: string, goal: string) {
  const query = [...new Set(goal.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [])]
    .filter(
      (w) => ![
        "the",
        "and",
        "for",
        "with",
        "that",
        "this",
        "should",
        "from",
        "have",
      ].includes(w),
    )
    .slice(0, 40);

  async function paths(args: string[]) {
    const { stdout } = await run("git", ["-C", root, ...args], {
      cwd: tmpdir(),
      timeout: 10000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout.split("\0").filter(Boolean);
  }

  const [tracked, missing, untracked, staged, unstaged] = await Promise.all([
    paths(["ls-files", "-z"]),
    paths(["ls-files", "--deleted", "-z"]),
    paths(["ls-files", "--others", "--exclude-standard", "-z"]),
    paths(["diff", "--cached", "--name-only", "-z", "--"]),
    paths(["diff", "--name-only", "-z", "--"]),
  ]);
  const visible = new Set(tracked);
  for (const path of missing) visible.delete(path);
  for (const path of untracked) visible.add(path);

  const dirty = new Set([...staged, ...unstaged, ...untracked]);
  const ranked = [...visible]
    .map(path => ({
      path,
      changed: dirty.has(path),
      matches: query.filter(term => path.toLowerCase().includes(term)).length,
    }))
    .filter(item => item.changed || item.matches > 0)
    .sort((a, b) => b.matches - a.matches || Number(b.changed) - Number(a.changed) || a.path.localeCompare(b.path));
  return {
    tracked: tracked.length,
    candidates: ranked.slice(0, 8).map(item => item.path),
    changed: ranked.filter(item => item.changed).slice(0, 8).map(item => item.path),
  };
}
export function dispatch(goal: string, blocker: string, priorHandoffs: number) {
  if (blocker.trim())
    return {
      route: "one_specialist",
      reason:
        "A local blocker was reported. Send the failing check and the smallest relevant excerpt.",
    };
  if (/\b(independent review|second opinion|security audit)\b/i.test(goal))
    return {
      route: "one_specialist",
      reason: "The goal requests an independent assessment.",
    };
  return {
    route: "lead",
    reason: priorHandoffs
      ? "Consult the checked handoffs first; no unresolved blocker was supplied."
      : "Start with local inspection and verification. No specialist is required yet.",
  };
}
