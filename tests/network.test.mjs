import { sourceList, researchAgents, updateResearch } from "../src/research.ts";
import { readAttachments, attachmentPrompt } from "../src/attachments.ts";
import { formatEvidence, readerContext } from "../src/reader.ts";
import { roomURL, parseTeam } from "../src/team.ts";
import test from "node:test";
import assert from "node:assert/strict";
import {
  setBase,
  setCustom,
  setPublicKey,
  testProviderKey,
  compact,
  stream,
  cloud,
  pairCode,
  DeviceRevoked,
} from "../src/network.ts";
import { context, mergeHistory, mergeMessages } from "../src/history.ts";
setBase("https://cloud.example/desktop-companion");
setPublicKey("test-public");
const signal = new AbortController().signal;
const messages = [{ role: "user", content: "Hello" }];
const receipt = {
  id: "a0000000-0000-4000-8000-000000000001",
  estimate: true,
  compacted: true,
  original_tokens_est: 10,
  compacted_tokens_est: 4,
  saved_tokens_est: 6,
  savings_percent_est: 60,
  receipt_hash: "sample",
};
const response = (data) => new Response(JSON.stringify(data));
function fixture(t, fn) {
  t.mock.method(globalThis, "fetch", fn);
}
test("compaction sends only the cloud credential and rejects a malformed receipt", async (t) => {
  fixture(t, async (url, options) => {
    assert.ok(url.endsWith("/desktop-companion/compact"));
    assert.ok(options.headers.apikey === "test-public");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer device-test");
    assert.deepEqual(JSON.parse(options.body), {
      chat_id: "chat",
      model: "model",
      messages,
    });
    return response({
      compacted_messages: messages,
      receipt: { ...receipt, saved_tokens_est: "invalid" },
    });
  });
  await assert.rejects(
    compact("device-test", "chat", "model", messages, signal),
    /invalid compaction/,
  );
});
test("cloud access denial blocks compaction", async (t) => {
  fixture(t, async () => new Response(null, { status: 402 }));
  await assert.rejects(cloud("compact", "device-test", {}), /plan/);
});
test("every provider sends the exact messages returned by /compact", async (t) => {
  const returned = [
    { role: "system", content: "  first\n", name: "instructions" },
    { role: "user", content: "  repeated  " },
    { role: "user", content: "  repeated  " },
    { role: "assistant", content: "" },
    { role: "system", content: "\nsecond\r\n" },
    { role: "user", content: "last" },
  ];
  setCustom("https://custom.example/v1");
  t.after(() => setCustom(""));
  const sent = [];
  fixture(t, async (url, options) => {
    if (url.endsWith("/compact"))
      return response({ compacted_messages: returned, receipt });
    const body = JSON.parse(options.body);
    assert.deepEqual(body.messages, returned);
    assert.ok(!("system" in body));
    sent.push(url);
    return new Response('data: [DONE]\n\n');
  });
  const result = await compact("device-test", "chat", "model", messages, signal);
  for (const p of ["OpenRouter", "GroqCloud", "OpenAI", "Anthropic", "Custom"])
    await stream(p, "provider-test", "model", result.messages, signal, () => {});
  assert.deepEqual(sent, [
    "https://openrouter.ai/api/v1/chat/completions",
    "https://api.groq.com/openai/v1/chat/completions",
    "https://api.openai.com/v1/chat/completions",
    "https://api.anthropic.com/v1/chat/completions",
    "https://custom.example/v1/chat/completions",
  ]);
});
for (const p of ["OpenRouter", "GroqCloud", "OpenAI", "Anthropic"])
  test(p + " streams fragmented UTF-8 SSE to the end marker", async (t) => {
    const delta = { choices: [{ delta: { content: "Hi 🌱" } }] };
    const bytes = new TextEncoder().encode(
      ": keep-alive\r\n\r\ndata: " +
        JSON.stringify(delta) +
        "\r\n\r\ndata: [DONE]\r\n\r\n",
    );
    fixture(t, async (url, opts) => {
      assert.equal(
        new URL(url).hostname,
        {
          OpenAI: "api.openai.com",
          OpenRouter: "openrouter.ai",
          GroqCloud: "api.groq.com",
          Anthropic: "api.anthropic.com",
        }[p],
      );
      if (p === "Anthropic")
        assert.equal(url, "https://api.anthropic.com/v1/chat/completions");
      assert.equal(opts.headers.Authorization, "Bearer provider-test");
      assert.ok(!JSON.stringify(opts).includes("device-test"));
      return new Response(
        new ReadableStream({
          start(c) {
            for (const byte of bytes) c.enqueue(Uint8Array.of(byte));
            c.close();
          },
        }),
      );
    });
    let output = "";
    await stream(
      p,
      "provider-test",
      "model",
      messages,
      signal,
      (s) => (output += s),
    );
    assert.equal(output, "Hi 🌱");
  });
test("partial streams cannot become completed replies", async (t) => {
  fixture(
    t,
    async () =>
      new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
  );
  await assert.rejects(
    stream("OpenAI", "test", "model", messages, signal, () => {}),
    /before the reply finished/,
  );
});
test("cloud import is repeatable and follow-ups take the first successful comparison", () => {
  const local = [];
  const data = {
    chats: [
      {
        chat_id: "a0000000-0000-4000-8000-000000000001",
        title: "Test",
        room_id: "test-room",
      },
    ],
  };
  mergeHistory(local, data);
  mergeHistory(local, data);
  const messages = {
    messages: [
      { id: "q", label: "You", role: "user", content: "Question" },
      { id: "a", label: "First model", role: "assistant", content: "First" },
    ],
  };
  mergeMessages(local[0], messages);
  mergeMessages(local[0], messages);
  assert.equal(local.length, 1);
  assert.equal(local[0].turns.length, 1);
  assert.deepEqual(context(local[0]), [
    { role: "user", content: "Question" },
    { role: "assistant", content: "First" },
  ]);
});
test("pair codes match the backend alphabet and formatting", () => {
  assert.equal(pairCode("abcd efgh"), "ABCD-EFGH");
  for (const code of ["123456", "ABCD-EF0H", "sk-123"])
    assert.throws(() => pairCode(code));
});
test("revoked device is distinguishable from other authentication errors", async (t) => {
  fixture(
    t,
    async () =>
      new Response(JSON.stringify({ error: "invalid_device" }), {
        status: 401,
      }),
  );
  await assert.rejects(cloud("status", "rcd_fixture"), DeviceRevoked);
});
test("short chats retain an estimated zero", async (t) => {
  fixture(t, async () =>
    response({
      compacted_messages: messages,
      receipt: {
        ...receipt,
        compacted: false,
        passthrough_reason: "short_chat",
        compacted_tokens_est: 10,
        saved_tokens_est: 0,
        savings_percent_est: 0,
      },
    }),
  );
  const result = await compact(
    "rcd_fixture",
    "chat",
    "model",
    messages,
    signal,
  );
  assert.equal(result.receipt.estimate, true);
  assert.equal(result.receipt.savings_percent, 0);
});
test("GroqCloud key check uses model discovery without generating tokens", async (t) => {
  fixture(t, async (url, options) => {
    assert.equal(url, "https://api.groq.com/openai/v1/models");
    assert.equal(options.headers.Authorization, "Bearer groq-fixture");
    assert.equal(options.redirect, "error");
    return response({ data: [] });
  });
  await testProviderKey("GroqCloud", "groq-fixture");
});
test("GroqCloud reports the wait time on quota exhaustion", async (t) => {
  fixture(
    t,
    async () =>
      new Response(null, { status: 429, headers: { "retry-after": "12" } }),
  );
  await assert.rejects(
    stream(
      "GroqCloud",
      "key",
      "openai/gpt-oss-20b",
      messages,
      signal,
      () => {},
    ),
    /12 seconds/,
  );
});
test("pairing surfaces server errors", async (t) => {
  fixture(
    t,
    async () =>
      new Response(
        JSON.stringify({
          error: "invalid_or_expired_code",
          message: "Make a new code.",
        }),
        { status: 400 },
      ),
  );
  await assert.rejects(
    cloud("pair", "", { code: "ABCD-EFGH" }),
    /Make a new code/,
  );
});
test("external room links stay on the exact ReadyCode HTTPS origin", () => {
  for (const url of [
    "https://readycode.ai.attacker.example/x",
    "http://readycode.ai/",
    "https://readycode.ai@evil.example/",
    "javascript:alert(1)",
    "https://readycode.ai:444/x",
  ])
    assert.throws(() => roomURL(url));
  assert.equal(
    roomURL("https://readycode.ai/account/chat-room?chat=a"),
    "https://readycode.ai/account/chat-room?chat=a",
  );
});
test("team discovery copies names only and requires the synced room", () => {
  const data = {
    room_id: "room",
    open_url: "https://readycode.ai/account/chat-room?chat=room",
    cloud_keys: [{ provider: "Groq", model: null, secret: "not-displayed" }],
    room_ais: [],
  };
  assert.deepEqual(parseTeam(data, "room").keys, [
    { provider: "Groq", model: null },
  ]);
  assert.throws(() => parseTeam(data, "different"));
});
test("agent catalog accepts chat and legacy web capability, sources keep only distinct safe HTTPS URLs", () => {
  assert.equal(
    researchAgents({
      agents: [
        {
          id: "a",
          name: "A",
          provider: "p",
          model: "m",
          capabilities: ["web_research"],
        },
        { id: "b", capabilities: [] },
        {
          id: "c",
          name: "Chat",
          provider: "p",
          model: "m",
          capabilities: ["chat"],
        },
      ],
    }).length,
    2,
  );
  assert.deepEqual(
    sourceList([
      { url: "javascript:alert(1)" },
      { url: "file:///etc/passwd" },
      { url: "https://user:pass@foo.example/" },
      { url: "https://foo.example/news", title: "News" },
      { url: "https://foo.example/news", title: "News" },
    ]),
    [{ url: "https://foo.example/news", title: "News" }],
  );
});
test("research polling is idempotent, preserves citations and rejects mismatched room or request IDs", () => {
  const run = {
    requestId: "request",
    agentId: "a",
    prompt: "Q",
    status: "submitting",
  };
  const chat = { id: "c", title: "Q", turns: [], research: run };
  const row = {
    request_id: "request",
    run_id: "job",
    room_id: "room",
    user_message_id: "q",
    status: "running",
  };
  updateResearch(chat, run, row);
  const data = {
    runs: [{ ...row, status: "completed" }],
    messages: [
      { role: "user", id: "q", label: "You", content: "Q" },
      {
        role: "assistant",
        id: "answer",
        label: "Researcher",
        content: "A [1]",
        run_id: "job",
        sources: [{ title: "Source", url: "https://example.org/page" }],
      },
    ],
  };
  mergeMessages(chat, data);
  mergeMessages(chat, data);
  assert.equal(chat.turns.length, 1);
  assert.equal(chat.turns[0].replies.length, 1);
  assert.equal(chat.turns[0].replies[0].sources[0].title, "Source");
  assert.equal(run.status, "completed");
  updateResearch(chat, run, row);
  assert.equal(run.status, "completed");
  assert.throws(() =>
    updateResearch(chat, run, { ...row, room_id: "foreign" }),
  );
  assert.throws(() =>
    updateResearch(chat, run, { ...row, request_id: "other" }),
  );
});
test("text attachment preparation preserves originals and rejects binary or oversized input", async () => {
  const files = await readAttachments([new File(["one\ntwo"], "notes.md")], []);
  assert.equal(
    attachmentPrompt("Review", files),
    "Review\n\nAttached file: notes.md\none\ntwo",
  );
  await assert.rejects(
    readAttachments([new File(["binary"], "example.pdf")], []),
    /UTF-8/,
  );
  await assert.rejects(
    readAttachments([new File([Uint8Array.of(0, 1)], "bad.txt")], []),
    /binary/,
  );
  assert.throws(() => attachmentPrompt("x".repeat(60000), files), /60,000/);
});
test("Reader requires sourced evidence for every selected file and a matching request", () => {
  const input = {
    requestId: "req",
    files: [{ name: "file.pdf" }, { name: "table.xlsx" }],
  };
  const result = {
    request_id: "req",
    status: "ready",
    documents: [
      {
        name: "file.pdf",
        verdict: "supported",
        passages: [{ location: "page 4", text: "Release notes" }],
      },
      {
        name: "table.xlsx",
        verdict: "calculated",
        passages: [{ location: "Budget!C2:C9", text: "Total: 8" }],
      },
    ],
  };
  const measured = {method: "exact", tokenizer: "example-tokenizer", full_text_tokens: 840, excerpt_tokens: 30};
  result.documents[0].measurement = measured;
  result.documents[0].passages.push({location: "page 4", text: "More evidence"});
  const output = formatEvidence(result, input);
  assert.match(output.evidence, /Budget!C2:C9/);
  assert.deepEqual(output.documentReceipt.documents[0], {name:"file.pdf",locations:["page 4"],measurement:measured});
  assert.equal(output.documentReceipt.documents[1].measurement, undefined);
  for (const invalid of [{method:"estimate"}, {full_text_tokens:-1}, {excerpt_tokens:1.5}, {tokenizer:""}]) {
    result.documents[0].measurement = {...measured,...invalid};
    assert.equal(formatEvidence(result,input).documentReceipt.documents[0].measurement, undefined);
  }
  for (const verdict of ["unchecked", "no_matching_text", "not_in_document"]) {
    assert.throws(
      () =>
        formatEvidence(
          {
            ...result,
            documents: [
              result.documents[0],
              { ...result.documents[1], verdict },
            ],
          },
          input,
        ),
      /could not verify/,
    );
  }
  assert.throws(() =>
    formatEvidence({ ...result, request_id: "other" }, input),
  );
  assert.throws(() =>
    formatEvidence({ ...result, documents: [result.documents[0]] }, input),
  );
});
test("Reader rejects unpaired and oversized uploads without any network call", async (t) => {
  fixture(t, () => assert.fail("unexpected network request"));
  const input = {
    requestId: crypto.randomUUID(),
    chatId: crypto.randomUUID(),
    question: "test",
    files: [{ name: "file.pdf", bytes: new Uint8Array(8 * 1024 * 1024 + 1) }],
  };
  await assert.rejects(readerContext("", input, signal), /Pair ReadyCode/);
  await assert.rejects(readerContext("fixture", input, signal), /8 MiB/);
});

test("synced Reader metadata belongs to its user turn even when prompts repeat", () => {
  const chat = {id:"chat",title:"docs",turns:[]};
  const receipt = { request_id:"job", documents:[{name:"brief.pdf",locations:["PDF page 4","PDF page 4"],
    measurement:{method:"estimate",full_text_tokens:200,excerpt_tokens:5,tokenizer:"guess"}}]};
  const messages = [{role:"user",id:"one",label:"You",content:"Question"},
    {role:"user",id:"two",label:"You",content:"Question",document_receipt:receipt}];
  mergeMessages(chat,{messages});
  mergeMessages(chat,{messages});
  assert.equal(chat.turns.length,2);
  assert.equal(chat.turns[0].documentReceipt,undefined);
  assert.deepEqual(chat.turns[1].documentReceipt.documents[0],{name:"brief.pdf",locations:["PDF page 4"],measurement:undefined});
});
