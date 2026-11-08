import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron } from "playwright-core";

const profile = await mkdtemp(join(tmpdir(), "companion-goal-test-"));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let app;
async function launch() {
  app = await _electron.launch({ args: ["--user-data-dir=" + profile, "."], env });
  const page = await app.firstWindow();
  await app.evaluate(() => {
    globalThis.catalog = ["first", "second"];
    globalThis.fetch = async (url, opts) => {
      const route = url.split("/").pop();
      if (route === "research_run") {
        const body = JSON.parse(opts.body);
        globalThis.job = body;
        return Response.json({ ...body, run_id: "fixture-run", room_id: "room",
          user_message_id: "user", status: "queued" });
      }
      const fixtures = {status: {ok:true}, pair: {device_token:"rcd_fixture"},
        chats:{chats:[]}, messages:{messages:[],runs:[]},
        research_agents:{agents:globalThis.catalog.map(id => ({
          id, name:id, model:id, provider:"Fixture", capabilities:["chat"]
        }))}};
      return Response.json(fixtures[route] ?? {}, {status: route in fixtures ? 200 : 404});
    };
  });
  return page;
}
async function selected(page, id) {
  await page.waitForFunction(value =>
    document.querySelector('[aria-label="Cloud agent"]')?.value === value, id);
}
try {
  let page = await launch();
  await page.evaluate(async () => {
    await window.companion.apiAddress("https://cloud.example/desktop-companion","test-public");
    await window.companion.pair("ABCD-EFGH");
  });
  await page.getByLabel("Chat provider").selectOption("ReadyCode Agents");
  await page.getByLabel("Cloud agent").selectOption("second");
  await page.getByRole("button",{name:/New chat/}).click();
  await selected(page,"second");
  await app.close();
  app = undefined;
  page = await launch();
  await selected(page,"second");
  await app.evaluate(() => { globalThis.catalog = ["first"]; });
  await page.getByRole("button",{name:"Refresh agents"}).click();
  await selected(page,"first");
  await app.evaluate(() => { globalThis.catalog.push("second"); });
  await page.getByRole("button",{name:"Refresh agents"}).click();
  await selected(page,"second");
  await page.getByRole("checkbox",{name:"Coding goal"}).check();
  await page.getByLabel("Coding goal description").fill("Remember my default AI");
  await page.getByLabel("Message",{exact:true}).fill("Design a restart test");
  await page.getByRole("button",{name:"Send assignment"}).click();
  const job = await app.evaluate(() => globalThis.job);
  assert.equal(job.agent_id,"second");
  assert.equal(job.prompt,"Coding goal: Remember my default AI\nAssignment: Design a restart test");
  console.log("PASS: new chat, full restart, catalog fallback and recovery, addressed coding assignment");
} finally {
  await app?.close();
  await rm(profile,{recursive:true,force:true});
}
