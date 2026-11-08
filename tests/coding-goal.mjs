import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron } from "playwright-core";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

const profile = await mkdtemp(join(tmpdir(), "companion-goal-test-"));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let app;
async function launch() {
  app = await _electron.launch({
    args: ["--user-data-dir=" + profile, "."],
    env,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await app.evaluate(() => {
    globalThis.catalog = ["first", "second"];
    globalThis.fetch = async (url, opts) => {
      const route = url.split("/").pop();
      if (route === "research_run") {
        const body = JSON.parse(opts.body);
        globalThis.job = body;
        return Response.json({
          ...body,
          run_id: "fixture-run",
          room_id: "room",
          user_message_id: "user",
          status: "queued",
        });
      }
      const fixtures = {
        status: { ok: true },
        pair: { device_token: "rcd_fixture" },
        chats: { chats: [] },
        messages: { messages: [], runs: [] },
        research_agents: {
          agents: globalThis.catalog.map((id) => ({
            id,
            name: id,
            model: id,
            provider: "Fixture",
            capabilities: ["chat"],
          })),
        },
      };
      return Response.json(fixtures[route] ?? {}, {
        status: route in fixtures ? 200 : 404,
      });
    };
  });
  return page;
}
async function selected(page, id) {
  await page.waitForFunction(
    (value) =>
      document.querySelector('[aria-label="Cloud agent"]')?.value === value,
    id,
  );
}
try {
  let page = await launch();
  await page.evaluate(async () => {
    await window.companion.apiAddress(
      "https://cloud.example/desktop-companion",
      "test-public",
    );
    await window.companion.pair("ABCD-EFGH");
  });
  await page.getByLabel("Chat provider").selectOption("ReadyCode Agents");
  await page.getByLabel("Cloud agent").selectOption("second");
  await page.getByRole("button", { name: /New chat/ }).click();
  await selected(page, "second");
  await app.close();
  app = undefined;
  page = await launch();
  await selected(page, "second");
  await app.evaluate(() => {
    globalThis.catalog = ["first"];
  });
  await page.getByRole("button", { name: "Refresh agents" }).click();
  await selected(page, "first");
  await app.evaluate(() => {
    globalThis.catalog.push("second");
  });
  await page.getByRole("button", { name: "Refresh agents" }).click();
  await selected(page, "second");
  await page.getByRole("checkbox", { name: "Coding goal" }).check();
  await page
    .getByLabel("Coding goal description")
    .fill("Remember my default AI");
  await page
    .getByLabel("Message", { exact: true })
    .fill("Design a restart test");
  await page.getByRole("button", { name: "Send assignment" }).click();
  const job = await app.evaluate(() => globalThis.job);
  assert.equal(job.agent_id, "second");
  assert.equal(
    job.prompt,
    "Coding goal: Remember my default AI\nAssignment: Design a restart test",
  );
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => {
      throw Error("Connecting an IDE must not open a folder picker.");
    };
    globalThis.approvals = 0;
    dialog.showMessageBox = async () => ({
      response: ++globalThis.approvals === 1 ? 1 : 0,
    });
  });
  await page.getByRole("button", { name: "IDE & MCP setup" }).click();
  await page.getByLabel("IDE setup", { exact: true }).waitFor();
  await page.getByLabel("IDE setup").selectOption("Local model host");
  await page.getByRole("button", { name: "Connect Local model host" }).click();
  await page.getByLabel("IDE setup").selectOption("Codex");
  await page.getByRole("button", { name: "Register in Codex" }).waitFor();
  await page.getByLabel("IDE setup", { exact: true }).selectOption("Cursor");
  await page.getByText(/Open Cursor Settings/).waitFor();
  await page
    .getByLabel("IDE setup", { exact: true })
    .selectOption("Local model host");
  await page.getByText(/local model that supports tools/).waitFor();
  const serverJSON = await page
    .locator("pre")
    .filter({ hasText: '"mcpServers"' })
    .innerText();
  const [script, descriptor] =
    JSON.parse(serverJSON).mcpServers["readycode-companion"].args;
  await page.getByRole("button", { name: "Check IDE connection" }).click();
  await page.getByText(/Waiting for the IDE to call/).waitFor();
  const cli = spawn(process.execPath, [script, descriptor], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const lines = createInterface({ input: cli.stdout })[Symbol.asyncIterator]();
  let seq = 0;
  async function rpc(method, params = {}) {
    const id = ++seq;
    cli.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
    );
    const r = JSON.parse((await lines.next()).value);
    assert.equal(r.id, id);
    return r.result;
  }
  async function tool(name, args) {
    const r = await rpc("tools/call", { name, arguments: args });
    assert.equal(r.isError, false, r.content[0].text);
    return JSON.parse(r.content[0].text);
  }
  try {
    assert.ok(
      (await rpc("initialize", { protocolVersion: "2025-06-18" })).capabilities
        .tools,
    );
    assert.equal((await tool("project", {})).root, null);
    assert.ok(
      (
        await rpc("tools/call", {
          name: "project",
          arguments: { workspace: process.cwd() },
        })
      ).isError,
    );
    assert.ok(
      (
        await rpc("tools/call", {
          name: "start_goal",
          arguments: { goal: "Unapproved" },
        })
      ).isError,
    );
    assert.equal(
      (await tool("project", { workspace: process.cwd() })).root.replaceAll(
        "\\",
        "/",
      ),
      process.cwd().replaceAll("\\", "/"),
    );
    await page.getByRole("button", { name: "Check IDE connection" }).click();
    await page.getByText(/Project tool reached Companion/).waitFor();
    const { chat_id } = await tool("start_goal", { goal: "Remember default" });
    const route = await tool("dispatch", { chat_id });
    assert.equal(route.route, "lead");
    assert.ok(route.paths.tracked > 0);
    assert.equal(
      (
        await tool("dispatch", {
          chat_id,
          blocker: "restart regression test failed",
        })
      ).route,
      "one_specialist",
    );
    await tool("roadmap", {
      chat_id,
      plan: "Verify the second selection after restart",
    });
    assert.equal(
      (await tool("roadmap", { chat_id })).plan,
      "Verify the second selection after restart",
    );
    assert.ok(
      (await tool("project", {})).recent_goals.some(
        (g) => g.chat_id === chat_id,
      ),
    );
    const agents = await tool("agents", { chat_id });
    const id = randomUUID();
    await tool("assignment", {
      chat_id,
      request_id: id,
      agent_id: agents[1].id,
      task: "Review fallback",
    });
    assert.equal((await app.evaluate(() => globalThis.job)).agent_id, "second");
    await tool("handoff", {
      chat_id,
      request_id: id,
      revision: "abcdef1",
      summary: "Second default survived restart",
    });
    const { handoff } = await tool("results", { chat_id, request_id: id });
    assert.equal(handoff.revision, "abcdef1");
    await tool("assignment", {
      chat_id,
      request_id: randomUUID(),
      agent_id: agents[0].id,
      task: "Check regression",
      depends_on: [id],
    });
    assert.match(
      (await app.evaluate(() => globalThis.job)).prompt,
      /Second default survived restart/,
    );
    await page.evaluate(() => window.companion.disconnectIDE());
    assert.ok(
      (await rpc("tools/call", { name: "project", arguments: {} })).isError,
    );
  } finally {
    cli.stdin.end();
    cli.kill();
  }
  console.log(
    "PASS: new chat, full restart, catalog fallback and recovery, addressed coding assignment",
  );
} finally {
  await app?.close();
  await rm(profile, { recursive: true, force: true });
}
