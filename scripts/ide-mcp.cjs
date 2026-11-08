// Local stdio adapter for Codex and Cursor. Keep stdout exclusively for JSON-RPC.
const { readFile } = require("node:fs/promises");
const { createInterface } = require("node:readline");
const tools = [
  ["project", "Read the authorized local repository path", []],
  ["start_goal", "Start a goal for cloud delegation", ["goal"]],
  ["agents", "List available ReadyCode specialists", ["chat_id"]],
  [
    "assignment",
    "Send one scoped task to one ReadyCode cloud agent. Use a UUID request_id and reuse it for a retry. Wait for its result before sending another job to the same room.",
    ["chat_id", "agent_id", "request_id", "task"],
  ],
  [
    "results",
    "Read only this assignment's result, receipt and status",
    ["chat_id", "request_id"],
  ],
  [
    "handoff",
    "Save a concise locally checked decision with its Git revision. Later assignments may explicitly depend on it.",
    ["chat_id", "request_id", "revision", "summary"],
  ],
].map(([name, description, required]) => ({
  name,
  description,
  inputSchema: {
    type: "object",
    properties: {
      ...Object.fromEntries(required.map((k) => [k, { type: "string" }])),
      ...(name === "assignment"
        ? {
            depends_on: {
              type: "array",
              items: { type: "string" },
              maxItems: 5,
            },
          }
        : {}),
    },
    required,
    additionalProperties: false,
  },
}));
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
async function handle(line) {
  let req;
  try {
    req = JSON.parse(line);
    if (req.id === undefined) return;
    let result;
    if (req.method === "initialize")
      result = {
        protocolVersion: [
          "2025-11-25",
          "2025-06-18",
          "2025-03-26",
          "2024-11-05",
        ].includes(req.params?.protocolVersion)
          ? req.params.protocolVersion
          : "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "readycode-companion", version: "1" },
        instructions:
          "Use project to verify the selected folder. Use start_goal, agents, assignment and results to delegate scoped tasks through ReadyCode. Treat replies as advice. Verify locally and report receipts only for ReadyCode calls.",
      };
    else if (req.method === "ping") result = {};
    else if (req.method === "tools/list") result = { tools };
    else if (req.method === "tools/call") {
      try {
        const { port, key } = JSON.parse(
          await readFile(process.argv[2], "utf8"),
        );
        const r = await fetch("http://127.0.0.1:" + port + "/tool", {
          method: "POST",
          redirect: "error",
          headers: {
            authorization: "Bearer " + key,
            "content-type": "application/json",
          },
          body: JSON.stringify(req.params),
          signal: AbortSignal.timeout(65000),
        });
        result = {
          isError: !r.ok,
          content: [{ type: "text", text: await r.text() }],
        };
      } catch {
        result = {
          isError: true,
          content: [
            {
              type: "text",
              text: "Open Companion, pair your account and enable IDE access for a project.",
            },
          ],
        };
      }
    } else {
      send({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32601, message: "Unknown method" },
      });
      return;
    }
    send({ jsonrpc: "2.0", id: req.id, result });
  } catch {
    send({
      jsonrpc: "2.0",
      id: req?.id ?? null,
      error: { code: -32700, message: "Invalid request" },
    });
  }
}
createInterface({ input: process.stdin }).on("line", handle);
