import { _electron } from "playwright-core";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const dir = await mkdtemp(join(tmpdir(), "readycode-test-"));
await writeFile(
  join(dir, "api-address.json"),
  JSON.stringify("https://cloud.example/desktop-companion"),
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.READYCODE_HISTORY_FUNCTION;
delete env.READYCODE_PAIR_FUNCTION;
const desktop = await _electron.launch({
  executablePath: process.env.READYCODE_TEST_EXECUTABLE,
  args: [
    "--user-data-dir=" + dir,
    ...(process.env.READYCODE_TEST_EXECUTABLE ? [] : ["."]),
  ],
  env,
});
try {
  const win = await desktop.firstWindow();
  win.setDefaultTimeout(25000);
  await win.getByRole("heading", { name: "Connect to ReadyCode" }).waitFor();
  await desktop.evaluate(({ shell }) => {
    shell.openExternal = async (url) => {
      globalThis.opened = url;
    };
  });
  await win
    .getByRole("button", { name: /See savings from ReadyCode tests/ })
    .click();
  assert.equal(
    await desktop.evaluate(() => globalThis.opened),
    "https://readycode.ai/savings",
  );
  await desktop.evaluate(() => {
    globalThis.opened = undefined;
  });
  await win.evaluate(() => localStorage.setItem("local-chat", "true"));
  await win.reload();
  assert.ok(await win.getByLabel("Message", { exact: true }).isDisabled());
  assert.ok(await win.getByRole("button", { name: "Send ↑" }).isDisabled());
  const config = await win.evaluate(() => window.companion.state());
  const changeAddress = () =>
    win.evaluate(() =>
      window.companion.apiAddress(
        "https://cloud.example/desktop-companion",
        "test-public",
      ),
    );
  if (config.fixedCloud) {
    assert.ok(!config.apiBase.includes("cloud.example"));
    await assert.rejects(changeAddress(), /configured ReadyCode service/);
  } else await changeAddress();
  const { apiBase, publicKey } = await win.evaluate(() =>
    window.companion.state(),
  );
  await desktop.evaluate(() => {
    globalThis.unpairedRequests = [];
    globalThis.fetch = async (url) => {
      globalThis.unpairedRequests.push(url);
      throw Error("Unexpected request");
    };
  });
  await win.evaluate(() =>
    window.companion.key("OpenRouter", "fixture-provider-key"),
  );
  await assert.rejects(
    win.evaluate(() =>
      window.companion.send({
        id: crypto.randomUUID(),
        provider: "OpenRouter",
        models: ["m"],
        prompt: "unpaired",
      }),
    ),
    /Connect your ReadyCode account/,
  );
  await assert.rejects(
    win.evaluate(() =>
      window.companion.research(crypto.randomUUID(), "agent", "unpaired"),
    ),
    /Pair ReadyCode/,
  );
  await assert.rejects(
    win.evaluate(() => window.companion.pair("rcd_fixture")),
    /eight-character/,
  );
  assert.deepEqual(
    await desktop.evaluate(() => globalThis.unpairedRequests),
    [],
  );
  await win.evaluate(() => window.companion.key("OpenRouter", ""));
  await desktop.evaluate(() => {
    globalThis.calls = [];
    globalThis.fetch = async (url, opts) => {
      if (url.endsWith("/reader_context")) {
        const form = opts.body;
        const parts = form.getAll("files");
        const names = parts.map((f) => f.name);
        if (
          opts.headers.Authorization !== "Bearer rcd_fixture" ||
          opts.headers["Content-Type"]
        )
          throw Error("Invalid Reader request headers");
        for (const file of parts)
          if (!(await file.text()).includes("original-binary-marker"))
            throw Error("Missing file bytes");
        globalThis.readerReply = {
          request_id: form.get("request_id"),
          status: "ready",
          supports_reader_link: true,
          documents: names.map((name) => ({
            name,
            measurement: name.endsWith(".pdf") ? {method:"exact", tokenizer:"fixture", full_text_tokens:300, excerpt_tokens:40} : undefined,
            verdict: globalThis.noEvidence
              ? "not_in_document"
              : name.endsWith(".xlsx")
                ? "calculated"
                : "supported",
            passages: [
              {
                location: name.endsWith(".xlsx")
                  ? "Budget!B2:B7"
                  : name.endsWith(".docx")
                    ? "Launch · paragraph 3"
                    : "page 2",
                text: "reader-cited-evidence",
              },
            ],
          })),
        };
        globalThis.calls.push({
          url,
          headers: opts.headers,
          body: {
            names,
            request_id: form.get("request_id"),
            question: form.get("question"),
          },
        });
        return Response.json(
          { request_id: form.get("request_id"), status: "processing" },
          { status: 202 },
        );
      }
      const body = opts.body ? JSON.parse(opts.body) : null;
      globalThis.calls.push({ url, headers: opts.headers, body });
      if (url.endsWith("/reader_result"))
        return Response.json(globalThis.readerReply);
      if (url.endsWith("/pair"))
        return Response.json({ device_token: "rcd_fixture" });
      if (url.endsWith("/status"))
        return globalThis.revoked
          ? new Response(JSON.stringify({ error: "invalid_device" }), {
              status: 401,
            })
          : Response.json({ ok: true });
      if (url.endsWith("/chats"))
        return Response.json({ chats: globalThis.cleanupChats ?? [] });
      if (url.endsWith("/delete_chat") && body.chat_id === "old-cloud")
        return Response.json({ error: "unknown_chat" }, { status: 404 });
      if (url.endsWith("/delete_chat"))
        return globalThis.allowDelete
          ? Response.json({ ok: true, deleted: true, ...body })
          : Response.json({ message: "Deletion refused" }, { status: 403 });
      if (url.endsWith("/messages") && globalThis.removedChat === body.chat_id)
        return Response.json({ error: "unknown_chat" }, { status: 404 });
      if (url.endsWith("/messages"))
        return Response.json({
          messages: globalThis.remote || [],
          runs: globalThis.runs || [],
        });
      if (url.endsWith("/research_agents"))
        return globalThis.catalog === undefined
          ? new Response(JSON.stringify({ error: "not_found" }), {
              status: 404,
            })
          : Response.json({ agents: globalThis.catalog });
      if (url.endsWith("/research_run")) {
        const row = {
          request_id: body.request_id,
          run_id: "job",
          room_id: "room-test",
          user_message_id: "research-user",
          status: "queued",
        };
        if (!globalThis.firstRequest) {
          globalThis.firstRequest = body;
          throw Error("Lost acknowledgement");
        }
        if (globalThis.firstRequest.request_id !== body.request_id)
          throw Error("Duplicate request");
        globalThis.runs = [{ ...row, status: "completed" }];
        globalThis.remote = [
          {
            id: "research-user",
            role: "user",
            label: "You",
            content: body.prompt,
          },
          {
            id: "research-answer",
            role: "assistant",
            label: "News researcher",
            receipt: {
              id: "f0000000-0000-4000-8000-000000000001",
              estimate: true,
              compacted: true,
              original_tokens_est: 100,
              compacted_tokens_est: 38,
              saved_tokens_est: 62,
              savings_percent_est: 62,
              receipt_hash: "server-receipt-fixture",
              detail: {
                covers: "research answer",
                model_requests: [{ kind: "research", count: 1 }],
                retrieved_pages: 3,
              },
            },
            content: "A verified update [1].",
            run_id: "job",
            sources: [
              {
                title: "Official release",
                url: "https://example.org/releases/1",
              },
            ],
          },
          {
            id: "empty-answer",
            role: "assistant",
            label: "Researcher",
            content: "Got it — your chat is working.",
            run_id: "other-job",
            sources: [],
            receipt: {
              id: "f0000000-0000-4000-8000-000000000002",
              receipt_hash: "chat-receipt-fixture",
              passthrough_reason: "short_chat",
              compacted: false,
              estimate: true,
              original_tokens_est: 8,
              compacted_tokens_est: 8,
              saved_tokens_est: 0,
              savings_percent_est: 0,
            },
          },
        ];
        return Response.json(row, { status: 202 });
      }
      if (url.endsWith("/cloud_team"))
        return Response.json({
          room_id: "room-test",
          open_url: "https://readycode.ai/account/chat-room?chat=room-test",
          cloud_keys: globalThis.cloudKeys || [],
          room_ais: [
            { name: "Claude", provider: "Anthropic", model: "fixture" },
          ],
          note: "Continue on the website.",
        });
      if (url.endsWith("/models"))
        return Response.json({ data: [{ id: "openai/gpt-oss-20b" }] });
      if (url.startsWith("https://api.groq.com/"))
        return new Response(
          'data: {"choices":[{"delta":{"content":"Groq answer"}}],"x_groq":{"usage":{"prompt_tokens":7,"completion_tokens":2}}}\n\ndata: [DONE]\n\n',
        );
      if (url.endsWith("/key")) return Response.json({ data: {} });
      if (url.endsWith("compact")) {
        if (body.messages.at(-1).content === "Offline")
          throw new TypeError("Network unavailable");
        if (body.messages.at(-1).content === "Denied")
          return new Response(null, { status: 402 });
        return Response.json({
          compacted_messages: [{ role: "user", content: "compact fixture" }],
          receipt: {
            id: crypto.randomUUID(),
            estimate: true,
            compacted: body.messages.at(-1).content !== "Try GroqCloud",
            passthrough_reason:
              body.messages.at(-1).content === "Try GroqCloud"
                ? "short_chat"
                : null,
            original_tokens_est: 10,
            compacted_tokens_est:
              body.messages.at(-1).content === "Try GroqCloud" ? 10 : 4,
            saved_tokens_est:
              body.messages.at(-1).content === "Try GroqCloud" ? 0 : 6,
            savings_percent_est:
              body.messages.at(-1).content === "Try GroqCloud" ? 0 : 60,
            receipt_hash: "fixture",
          },
        });
      }
      if (url.endsWith("/sync"))
        return globalThis.allowSync
          ? Response.json({ ok: true, room_id: "room-test" })
          : new Response(null, { status: 503 });
      return new Response(
        'data: {"choices":[{"delta":{"content":"Test response"}}]}\n\ndata: {"usage":{"prompt_tokens":4,"completion_tokens":2,"cost":0.001}}\n\ndata: [DONE]\n\n',
      );
    };
  });
  await win
    .getByLabel("Enter the pairing code from your ReadyCode account")
    .fill("abcd efgh");
  await win.getByRole("button", { name: "Pair device" }).click();
  assert.equal(
    await win.getByLabel("Provider", { exact: true }).inputValue(),
    "GroqCloud",
  );
  await win.getByLabel("Provider", { exact: true }).selectOption("OpenRouter");
  await win.getByLabel("API key", { exact: true }).fill("fixture-provider-key");
  await win.getByRole("button", { name: "Test key" }).click();
  await win.getByText("OpenRouter accepted this key.").waitFor();
  await win.getByRole("button", { name: "Save key" }).click();
  await win.getByText("Key saved on this device.").waitFor();
  const stored = JSON.parse(await readFile(join(dir, "secrets.json"), "utf8"));
  assert.ok(stored.OpenRouter && stored.device);
  for (const [id, value] of Object.entries(stored))
    assert.notEqual(
      Buffer.from(value, "base64").toString("utf8"),
      id === "device" ? "rcd_fixture" : "fixture-provider-key",
    );
  await win.getByRole("button", { name: "Close settings" }).click();
  await win.getByLabel("Compare", { exact: true }).check();
  await win.getByLabel("Attachments").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("attachment-only-marker"),
  });
  await win.getByRole("button", { name: "Remove notes.txt" }).waitFor();
  await win.getByLabel("Attachments").setInputFiles([
    {
      name: "brief.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("original-binary-marker"),
    },
    {
      name: "notes.docx",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("original-binary-marker"),
    },
  ]);
  await win.getByRole("button", { name: "Remove notes.docx" }).waitFor();
  await win.getByLabel("Message", { exact: true }).fill("Test comparison");
  await desktop.evaluate(() => {
    globalThis.noEvidence = true;
  });
  await win.getByRole("button", { name: "Send ↑" }).click();
  await win
    .getByText(/Reader could not verify evidence in brief.pdf/)
    .waitFor();
  assert.equal(
    await desktop.evaluate(
      () =>
        globalThis.calls.filter(
          (c) =>
            c.url.endsWith("/compact") || c.url.endsWith("/chat/completions"),
        ).length,
    ),
    0,
  );
  await desktop.evaluate(() => {
    globalThis.noEvidence = false;
  });
  await win
    .getByLabel("Message", { exact: true })
    .fill("Compare the release decisions");
  await win.getByRole("button", { name: "Send ↑" }).click();
  await win
    .getByText(/ReadyCode returned HTTP 503/)
    .first()
    .waitFor();
  await desktop.evaluate(() => {
    globalThis.allowSync = true;
  });
  await win.getByRole("button", { name: "Retry save" }).first().click();
  await win.getByText("Saved to ReadyCode", { exact: true }).nth(1).waitFor();
  if (process.env.READYCODE_SCREENSHOT) {
    await mkdir("docs", { recursive: true });
    await win.screenshot({ path: "docs/demo.png" });
  }
  await win.getByLabel("Message", { exact: true }).fill("Denied");
  await win.getByRole("button", { name: "Send ↑" }).click();
  await win
    .getByText(/Your account needs access/)
    .first()
    .waitFor();
  await win.getByLabel("Message", { exact: true }).fill("Offline");
  await win.getByRole("button", { name: "Send ↑" }).click();
  await win
    .getByText(/ReadyCode is unreachable/)
    .first()
    .waitFor();
  assert.equal(
    await win
      .getByText("Saved 60% input tokens via ReadyCode", { exact: true })
      .count(),
    2,
  );
  const calls = await desktop.evaluate(() => globalThis.calls);
  const providers = calls.filter((c) => c.url.endsWith("/chat/completions")),
    ready = calls.filter((c) => c.url.startsWith(apiBase + "/"));
  assert.equal(providers.length, 2);
  assert.ok(
    ready
      .find((c) => c.url.endsWith("/compact"))
      .body.messages.at(-1)
      .content.includes("[brief.pdf · page 2]"),
  );
  assert.ok(
    ready
      .find((c) => c.url.endsWith("/sync"))
      .body.user_message.includes("[notes.docx · Launch · paragraph 3]"),
  );
  assert.ok(
    calls.every(
      (c) => !JSON.stringify(c.body).includes("original-binary-marker"),
    ),
  );
  const readerAttempts = ready.filter((c) => c.url.endsWith("/reader_context"));
  assert.equal(ready.find(c => c.url.endsWith("/sync")).body.reader_request_id, readerAttempts.at(-1).body.request_id);
  const readerReceipt = win.getByRole("region",{name:"Reader document receipt"}).first();
  await readerReceipt.getByText("brief.pdf · page 2",{exact:true}).waitFor();
  await readerReceipt.getByText("260 document input tokens saved · fixture").waitFor();
  await readerReceipt.getByText("Document token savings weren’t measured for this file.").first().waitFor();
  assert.equal(readerAttempts.length, 2);
  assert.notEqual(
    readerAttempts[0].body.request_id,
    readerAttempts[1].body.request_id,
  );
  assert.ok(
    ready
      .find((c) => c.url.endsWith("/compact"))
      .body.messages.at(-1)
      .content.includes("attachment-only-marker"),
  );
  assert.ok(
    providers.every(
      (c) =>
        !JSON.stringify(c.body.messages).includes("attachment-only-marker"),
    ),
  );
  assert.ok(
    ready
      .find((c) => c.url.endsWith("/sync"))
      .body.user_message.includes("notes.txt"),
  );
  const saves = ready.filter((c) => c.url.endsWith("/sync"));
  assert.ok(saves.length >= 3);
  assert.equal(new Set(saves.map((c) => c.body.receipt_id)).size, 2);
  assert.ok(saves.every((c) => c.body.provider_usage.cost_usd === 0.001));
  assert.ok(providers.every((c) => c.body.usage.include === true));
  assert.equal(
    ready.find((c) => c.url.endsWith("/pair")).body.code,
    "ABCD-EFGH",
  );
  assert.ok(
    calls.findIndex((c) => c.url.endsWith("/compact")) <
      calls.indexOf(providers[0]),
  );
  assert.ok(calls.indexOf(providers[0]) < calls.indexOf(saves[0]));
  assert.deepEqual(providers[0].body.messages, providers[1].body.messages);
  assert.equal(providers[0].body.messages[0].content, "compact fixture");
  assert.ok(
    ready.every(
      (c) =>
        (c.url.endsWith("/pair")
          ? !c.headers.Authorization
          : c.headers.Authorization === "Bearer rcd_fixture") &&
        c.headers.apikey === publicKey &&
        !JSON.stringify(c).includes("fixture-provider-key"),
    ),
  );
  assert.ok(
    providers.every(
      (c) =>
        c.headers.Authorization === "Bearer fixture-provider-key" &&
        !JSON.stringify(c).includes("rcd_fixture"),
    ),
  );
  assert.ok(
    !JSON.stringify(
      await win.evaluate(() => window.companion.state()),
    ).includes("fixture-provider-key"),
  );
  await win.getByRole("button", { name: /Settings/ }).click();
  await win.getByLabel("Provider", { exact: true }).selectOption("GroqCloud");
  await win.getByLabel("API key", { exact: true }).fill("groq-only-fixture");
  await win.getByRole("button", { name: "Test key" }).click();
  await win.getByText("GroqCloud accepted this key.").waitFor();
  await win.getByRole("button", { name: "Save key" }).click();
  await win.getByText("Key saved on this device.").waitFor();
  await win.getByRole("button", { name: "Close settings" }).click();
  await win.getByLabel("Compare", { exact: true }).uncheck();
  await win.getByLabel("Message", { exact: true }).fill("Try GroqCloud");
  await win.getByRole("button", { name: "Send ↑" }).click();
  await win.getByText("Saved to ReadyCode", { exact: true }).nth(2).waitFor();
  await win
    .getByText("Optimal context · 0% compaction needed", { exact: true })
    .waitFor();

  const after = await desktop.evaluate(() => globalThis.calls);
  const groq = after.filter((c) => c.url.startsWith("https://api.groq.com/"));
  assert.equal(groq.length, 2);
  assert.ok(
    groq.every((c) => c.headers.Authorization === "Bearer groq-only-fixture"),
  );
  assert.ok(
    after
      .filter((c) => !groq.includes(c))
      .every((c) => !JSON.stringify(c).includes("groq-only-fixture")),
  );
  assert.equal(groq[1].body.model, "openai/gpt-oss-20b");
  assert.equal(groq[1].body.usage, undefined);
  assert.equal(after.at(-1).body.provider_usage.prompt_tokens, 7);
  await win.getByRole("button", { name: "Ask the Cloud Team" }).click();
  await win
    .getByText("Add AI keys on readycode.ai to use several AIs together.")
    .waitFor();
  await win.getByRole("button", { name: "Close Cloud Team" }).click();
  await desktop.evaluate(() => {
    globalThis.cloudKeys = [{ provider: "Anthropic", model: "fixture" }];
    globalThis.remote = [
      {
        id: "cloud-human",
        role: "user",
        label: "You",
        content: "Review my answer",
      },
      {
        id: "cloud-ai",
        role: "assistant",
        label: "Claude",
        content: "Cloud review fixture",
      },
    ];
  });
  await win.getByRole("button", { name: "Ask the Cloud Team" }).click();
  await win.getByText("Claude · Anthropic · fixture").waitFor();
  await win.getByRole("button", { name: "Close Cloud Team" }).click();
  await desktop.evaluate(({ shell, clipboard }) => {
    shell.openExternal = async (url) => {
      globalThis.opened = url;
    };
    clipboard.writeText = (text) => {
      globalThis.copied = text;
    };
  });
  await win
    .getByRole("button", { name: "Get second opinions" })
    .first()
    .click();

  for (
    let i = 0;
    i < 30 && !(await desktop.evaluate(() => globalThis.opened));
    i++
  )
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    await desktop.evaluate(() => globalThis.opened),
    "https://readycode.ai/account/chat-room?chat=room-test",
  );
  assert.match(
    await desktop.evaluate(() => globalThis.copied),
    /Review the last answer from/,
  );
  await win.bringToFront();
  await win.evaluate(async () => {
    const s = await window.companion.state();
    const id = s.chats.find((c) => c.roomId).id;
    await window.companion.readChat(id);
    await window.companion.readChat(id);
  });
  await win.getByText("Cloud review fixture", { exact: true }).waitFor();
  assert.equal(
    await win.getByText("Cloud review fixture", { exact: true }).count(),
    1,
  );
  await win.getByText("via readycode.ai", { exact: false }).first().waitFor();
  await win.getByLabel("Chat provider").selectOption("ReadyCode Agents");
  await win.getByText(/Agents are not enabled on this backend yet/).waitFor();
  assert.ok(await win.getByRole("button", { name: "Send ↑" }).isDisabled());
  await desktop.evaluate(() => {
    globalThis.catalog = [];
  });
  await win.getByRole("button", { name: "Refresh agents" }).click();
  await win.getByText(/No ReadyCode agents are available/).waitFor();
  await desktop.evaluate(() => {
    globalThis.catalog = [
      {
        id: "news",
        name: "News researcher",
        provider: "Fixture",
        model: "web",
        capabilities: ["web_research"],
      },
    ];
  });
  await win.getByRole("button", { name: "Refresh agents" }).click();
  await win.getByLabel("Cloud agent").selectOption("news");
  await desktop.evaluate(() => {
    globalThis.noEvidence = true;
  });
  await win.getByLabel("Attachments").setInputFiles({
    name: "only.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("original-binary-marker"),
  });
  await win.getByRole("button", { name: "Remove only.pdf" }).waitFor();
  await win.getByRole("button", { name: "Send ↑" }).click();
  await win.getByText(/Reader could not verify evidence in only.pdf/).waitFor();
  const question = await desktop.evaluate(
    () =>
      globalThis.calls.find((c) => c.body?.names?.includes("only.pdf")).body
        .question,
  );
  assert.equal(
    question,
    "Summarize this document and cite the relevant passages.",
  );
  await win.getByRole("button", { name: "Remove only.pdf" }).click();
  await desktop.evaluate(() => {
    globalThis.noEvidence = false;
  });
  await win
    .getByLabel("Message", { exact: true })
    .fill("Research this release");
  await win.getByLabel("Attachments").setInputFiles({
    name: "question.md",
    mimeType: "text/plain",
    buffer: Buffer.from("research-file-marker"),
  });
  await win.getByRole("button", { name: "Remove question.md" }).waitFor();
  await win.getByLabel("Attachments").setInputFiles({
    name: "budget.xlsx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("original-binary-marker"),
  });
  await win.getByRole("button", { name: "Remove budget.xlsx" }).waitFor();
  await win.getByRole("button", { name: "Send ↑" }).click();
  await win.getByRole("button", { name: "Retry this submission" }).click();
  await win.evaluate(async () => {
    const state = await window.companion.state();
    const chat = state.chats.find((item) => item.research);
    await window.companion.readChat(chat.id);
  });
  await win
    .getByText("A verified update [1].", { exact: true })
    .waitFor({ timeout: 25000 });
  const chatAnswer = win
    .locator(".answer")
    .filter({ hasText: "Got it — your chat is working." });
  await chatAnswer.getByText(/Optimal context/).waitFor();
  assert.equal(await chatAnswer.locator(".research-sources").count(), 0);
  await win
    .getByText("Saved 62% input tokens via ReadyCode", { exact: true })
    .waitFor();
  const researchAnswer = win
    .locator(".answer")
    .filter({ hasText: "A verified update [1]." });
  await researchAnswer
    .locator("summary")
    .filter({ hasText: "Receipt details" })
    .click();
  await researchAnswer
    .locator(".receipt-value")
    .filter({ hasText: "server-receipt-fixture" })
    .waitFor();
  assert.equal(
    await researchAnswer.getByText(/model_requests|retrieved_pages/).count(),
    0,
  );
  await win.getByRole("button", { name: "Official release" }).click();
  assert.equal(
    await desktop.evaluate(() => globalThis.opened),
    "https://example.org/releases/1",
  );
  const requests = await desktop.evaluate(() =>
    globalThis.calls.filter((c) => c.url.endsWith("/research_run")),
  );
  assert.equal(requests.length, 2, JSON.stringify(requests.map((r) => r.body)));
  assert.deepEqual(requests[0].body, requests[1].body);
  assert.ok(requests[0].body.reader_request_id);
  await win.getByRole("region",{name:"Reader document receipt"}).getByText("budget.xlsx · Budget!B2:B7",{exact:true}).waitFor();
  assert.ok(requests[0].body.prompt.includes("research-file-marker"));
  assert.ok(requests[0].body.prompt.includes("[budget.xlsx · Budget!B2:B7]"));
  assert.ok(!requests[0].body.prompt.includes("original-binary-marker"));
  assert.equal(requests[0].headers.Authorization, "Bearer rcd_fixture");
  assert.ok(!JSON.stringify(requests).includes("groq-only-fixture"));
  const removedId = requests[0].body.chat_id;
  await desktop.evaluate(() => {
    globalThis.catalog.push({
      id: "second",
      name: "Second agent",
      provider: "Fixture",
      model: "other",
      capabilities: ["chat"],
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (!url.endsWith("/room_run") && !url.endsWith("/room_retry"))
        return originalFetch(url, opts);
      const body = JSON.parse(opts.body);
      globalThis.calls.push({ url, body, headers: opts.headers });
      if (url.endsWith("/room_run")) {
        globalThis.round = {
          request_id: body.request_id,
          run_id: "round1",
          room_id: "room-test",
          user_message_id: "human-round",
          status: "completed",
          participants: [
            { agent_id: "news", label: "First", status: "completed" },
            {
              agent_id: "second",
              label: "Second",
              status: "failed",
              error: "Temporary failure",
            },
          ],
        };
        globalThis.runs.push(globalThis.round);
        globalThis.remote.push({
          id: "human-round",
          label: "You",
          role: "user",
          content: body.prompt,
        });
      } else globalThis.round.participants[1].status = "completed";
      const suffix = url.endsWith("/room_run") ? "1" : "2";
      globalThis.remote.push({
        id: "room-answer-" + suffix,
        role: "assistant",
        label: "Agent " + suffix,
        content: "Room answer " + suffix,
        run_id: "round1",
        user_message_id: "human-round",
        receipt: {
          ...globalThis.remote.find((m) => m.receipt).receipt,
          id: "a0000000-0000-4000-8000-00000000000" + suffix,
        },
      });
      return Response.json(globalThis.round);
    };
  });
  await win.getByRole("button", { name: "Refresh agents" }).click();
  await win.getByLabel("Ask the room").check();
  await win.getByRole("button", { name: "Send to 1 agent" }).waitFor();
  await win.getByLabel("Second agent", { exact: true }).check();
  await win
    .getByLabel("Message", { exact: true })
    .fill("Which models are here?");
  await win.getByRole("button", { name: "Send to 2 agents" }).click();
  await win.getByRole("button", { name: "Retry Second" }).waitFor();
  await win.evaluate((id) => window.companion.readChat(id), removedId);
  await win.getByText("Room answer 1", { exact: true }).waitFor();
  await win.getByRole("button", { name: "Retry Second" }).click();
  await win.getByText("Second · completed", { exact: false }).waitFor();
  await win.evaluate((id) => window.companion.readChat(id), removedId);
  await win.getByText("Room answer 2", { exact: true }).waitFor();
  const snapshot = await win.evaluate(() => window.companion.state());
  const roomTurns = snapshot.chats
    .find((c) => c.id === removedId)
    .turns.filter((t) => t.id === "human-round");
  assert.equal(roomTurns.length, 1);
  assert.equal(roomTurns[0].replies.length, 2);
  assert.equal(new Set(roomTurns[0].replies.map((r) => r.receipt.id)).size, 2);
  const roomCalls = await desktop.evaluate(() =>
    globalThis.calls.filter(
      (c) => c.url.endsWith("/room_run") || c.url.endsWith("/room_retry"),
    ),
  );
  assert.equal(roomCalls.length, 2);
  assert.deepEqual(roomCalls[0].body.agent_ids, ["news", "second"]);
  assert.equal(roomCalls[0].body.history_recall, "auto");
  await win.getByText("Find an earlier message", { exact: true }).click();
  await win.getByLabel("Search your messages loaded in this chat").fill("Which models");
  await win.getByRole("button", { name: "Quote in draft" }).first().click();
  assert.match(await win.getByLabel("Message", {exact:true}).inputValue(), /Which models/);
  assert.equal(roomCalls[1].body.agent_id, "second");
  await desktop.evaluate((_, id) => {
    globalThis.removedChat = id;
  }, removedId);
  await win.evaluate((id) => window.companion.readChat(id), removedId);
  await win.getByText(/You can still read the copy on this computer/).waitFor();
  await researchAnswer.waitFor();
  const countReads = () =>
    desktop.evaluate(
      () => globalThis.calls.filter((c) => c.url.endsWith("/messages")).length,
    );
  const reads = await countReads();
  await win.evaluate((id) => window.companion.readChat(id), removedId);
  assert.equal(await countReads(), reads);
  await win.getByRole("button", { name: "Start a new chat" }).click();
  await win.getByRole("heading", { name: "Start a conversation" }).waitFor();
  await desktop.evaluate(() => {
    globalThis.cleanupChats = [
      { chat_id: "keep-cloud", room_id: "room-1", title: "Keep cloud copy" },
      { chat_id: "old-cloud", room_id: "old-room", title: "Old cloud chat" },
      {
        chat_id: "delete-cloud",
        room_id: "room-2",
        title: "Delete both copies",
      },
    ];
  });
  await win.evaluate(() => window.companion.refresh());
  const removeLocal = win.getByRole("button", {
    name: "Remove chat: Keep cloud copy",
  });
  await removeLocal.click();
  await win.getByRole("button", { name: "Cancel", exact: true }).click();
  await removeLocal.click();
  await win
    .getByRole("button", { name: "Remove from this device", exact: true })
    .click();
  await removeLocal.waitFor({ state: "detached" });
  await win.evaluate(() => window.companion.refresh());
  assert.equal(await removeLocal.count(), 0);
  assert.equal(
    await desktop.evaluate(
      () =>
        globalThis.calls.filter((c) => c.url.endsWith("/delete_chat")).length,
    ),
    0,
  );
  const removeBoth = win.getByRole("button", {
    name: "Remove chat: Delete both copies",
  });
  await removeBoth.click();
  await win
    .getByRole("radio", { name: "Delete here and on ReadyCode" })
    .check();
  await win
    .getByRole("button", { name: "Delete here and on ReadyCode" })
    .click();
  await win.getByText("Deletion refused", { exact: true }).waitFor();
  assert.equal(await removeBoth.count(), 1);
  await desktop.evaluate(() => {
    globalThis.allowDelete = true;
  });
  await win
    .getByRole("button", { name: "Delete here and on ReadyCode" })
    .click();
  await removeBoth.waitFor({ state: "detached" });
  const deleted = await desktop.evaluate(() =>
    globalThis.calls.filter((c) => c.url.endsWith("/delete_chat")),
  );
  assert.ok(
    deleted.every(
      (c) =>
        c.body.chat_id === "delete-cloud" &&
        c.body.room_id === "room-2" &&
        c.headers.Authorization === "Bearer rcd_fixture",
    ),
  );
  const oldChat = win.getByRole("button", { name: "Remove chat: Old cloud chat" });
  await oldChat.click();
  await win.getByRole("radio", { name: "Delete here and on ReadyCode" }).check();
  await win.getByRole("button", { name: "Delete here and on ReadyCode" }).click();
  await oldChat.waitFor({ state: "detached" });
  await win.evaluate(() => window.companion.refresh());
  assert.equal(await oldChat.count(), 0);
  await desktop.evaluate(() => {
    globalThis.revoked = true;
  });
  await win.evaluate(() => window.companion.refresh());
  await win.getByRole("button", { name: "Reconnect to ReadyCode" }).waitFor();
  assert.equal(
    JSON.parse(await readFile(join(dir, "secrets.json"), "utf8")).device,
    undefined,
  );
  console.log(
    "Electron passed pairing lock, fail-closed compaction, savings receipts, Agents research and Cloud Team handoff.",
  );
} finally {
  await desktop.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 3 });
}
