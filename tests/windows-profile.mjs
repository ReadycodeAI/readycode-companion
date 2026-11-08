import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron } from "playwright-core";

const [oldExecutable, newExecutable] = process.argv.slice(2);
if (process.platform !== "win32" || !oldExecutable || !newExecutable)
  throw Error("Supply the previous Windows executable and the new Windows executable.");
const profile = await mkdtemp(join(tmpdir(), "readycode-update-profile-"));
const device = "rcd_" + randomUUID();
const providerKey = "test-key-" + randomUUID();
const chat = { id: randomUUID(), title: "Profile upgrade fixture", turns: [] };
const history = "history-" + createHash("sha256").update(device).digest("hex") + ".json";
const env = {...process.env, NODE_USE_ENV_PROXY: "1", HTTPS_PROXY: "http://127.0.0.1:1", NO_PROXY: ""};
delete env.ELECTRON_RUN_AS_NODE;
const launch = executablePath => _electron.launch({
  executablePath, args: ["--user-data-dir=" + profile], env,
});
let instance;
try {
  instance = await launch(oldExecutable);
  const old = await instance.firstWindow();
  await old.evaluate(key => window.companion.key("GroqCloud", key), providerKey);
  const identity = await instance.evaluate(({ app }) => app.getName());
  const service = await old.evaluate(async () => (await window.companion.state()).apiBase);
  const encrypted = await instance.evaluate(({ safeStorage }, token) =>
    safeStorage.encryptString(token).toString("base64"), device);
  await instance.close();
  instance = undefined;
  const vaultPath = join(profile, "secrets.json");
  const vault = JSON.parse(await readFile(vaultPath, "utf8"));
  await writeFile(vaultPath, JSON.stringify({...vault, device: encrypted}));
  await writeFile(join(profile, history), JSON.stringify([chat]));
  await writeFile(join(profile, "api-address.json"), JSON.stringify(service));
  instance = await launch(newExecutable);
  const next = await instance.firstWindow();
  const state = await next.evaluate(() => window.companion.state());
  assert.equal(await instance.evaluate(({ app }) => app.getName()), identity);
  assert.equal(state.apiBase, service);
  assert.equal(state.paired, true);
  assert.ok(state.keys.includes("GroqCloud"));
  assert.equal(state.chats.find(item => item.id === chat.id)?.title, chat.title);
  const savedVault = JSON.parse(await readFile(vaultPath, "utf8"));
  const decoded = await instance.evaluate(({ safeStorage }, values) =>
    values.map(value => safeStorage.decryptString(Buffer.from(value, "base64"))),
    [savedVault.device, savedVault.GroqCloud]);
  assert.deepEqual(decoded, [device, providerKey]);
  console.log("Previous profile reopened: chat, pairing, provider key and app identity survived.");
} finally {
  if (instance) await instance.close();
  await rm(profile, {recursive: true, force: true, maxRetries: 5});
}
