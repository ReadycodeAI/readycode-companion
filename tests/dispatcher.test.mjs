import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectHints } from "../src/dispatcher.ts";

test("an edited tracked file remains a hint when the goal shares no filename terms", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "companion-hints-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-C", root, ...args]);
  git("init", "-q");
  await mkdir(join(root, "src"));
  const file = join(root, "src", "settings.ts");
  await writeFile(file, "export const enabled = false;\n");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@invalid", "commit", "-qm", "fixture");
  await writeFile(file, "export const enabled = true;\n");
  const hints = await projectHints(root, "investigate stability");
  assert.deepEqual(hints, { tracked: 1, candidates: ["src/settings.ts"], changed: ["src/settings.ts"] });
});

test("new files in a repository without HEAD outrank unrelated changes, and ignored files stay out", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "companion-unborn-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["-C", root, "init", "-q"]);
  await writeFile(join(root, ".gitignore"), "*.private\n");
  execFileSync("git", ["-C", root, "add", ".gitignore"]);
  for (let i = 0; i < 10; i++) await writeFile(join(root, `a${i}.ts`), "");
  await writeFile(join(root, "z controller.ts"), "");
  await writeFile(join(root, "controller.private"), "");
  const hints = await projectHints(root, "controller");
  assert.equal(hints.tracked, 1);
  for (const list of [hints.candidates, hints.changed]) {
    assert.equal(list[0], "z controller.ts");
    assert.equal(list.length, 8);
    assert.ok(!list.includes("controller.private"));
  }
});
