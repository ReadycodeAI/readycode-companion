import { createServer } from "node:http";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { join, dirname } from "node:path";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  statSync,
} from "node:fs";
import { writeFile, rm } from "node:fs/promises";
import { cloud } from "./network";
import { researchAgents } from "./research";

/** Only the local stdio adapter reads the random session secret. No provider or device keys are exported. */
export async function openBridge(
  file: string,
  root: string,
  owner: () => string,
  onProjectRead: () => void = () => {},
) {
  const account = owner(),
    key = randomBytes(32).toString("hex");
  const folder = join(
    dirname(file),
    "ide-goals",
    createHash("sha256")
      .update(JSON.stringify([account, root]))
      .digest("hex"),
  );
  mkdirSync(folder, { recursive: true });
  type Goal = {
    goal: string;
    roadmap?: string;
    handoffs: Record<string, { revision: string; summary: string }>;
    runs: Record<string, string>;
  };
  const uuid = (v: unknown): v is string =>
    typeof v === "string" &&
    /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
  function read(id: string): Goal {
    if (!uuid(id)) throw Error("Invalid goal ID");
    return JSON.parse(readFileSync(join(folder, id + ".json"), "utf8"));
  }
  function save(id: string, g: Goal) {
    const path = join(folder, id + ".json");
    writeFileSync(path + ".tmp", JSON.stringify(g), { mode: 0o600 });
    renameSync(path + ".tmp", path);
  }
  const server = createServer(async (req, res) => {
    const reply = (n: number, v: unknown) => {
      res.writeHead(n, { "content-type": "application/json" });
      res.end(JSON.stringify(v));
    };
    if (
      !account ||
      owner() !== account ||
      req.headers.origin ||
      req.headers.authorization !== "Bearer " + key ||
      req.method !== "POST" ||
      req.url !== "/tool"
    ) {
      reply(403, { error: "Connection unavailable" });
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const part of req) {
        size += part.length;
        if (size > 65536) throw Error("Request too large");
        chunks.push(part);
      }
      const { name, arguments: a = {} } = JSON.parse(
        Buffer.concat(chunks).toString("utf8"),
      );
      if (name === "project") {
        onProjectRead();
        const recent = readdirSync(folder)
          .filter((n) => uuid(n.slice(0, -5)) && n.endsWith(".json"))
          .map((n) => ({
            id: n.slice(0, -5),
            mtime: statSync(join(folder, n)).mtimeMs,
          }))
          .sort((a, b) => b.mtime - a.mtime)
          .slice(0, 8);
        reply(200, {
          root,
          recent_goals: recent.map(({ id }) => ({
            chat_id: id,
            goal: read(id).goal.slice(0, 160),
          })),
        });
        return;
      }
      if (name === "start_goal") {
        if (
          typeof a.goal !== "string" ||
          !a.goal.trim() ||
          a.goal.length > 4000
        )
          throw Error("Enter a goal");
        const id = randomUUID();
        save(id, { goal: a.goal, handoffs: {}, runs: {} });
        reply(200, { chat_id: id, root });
        return;
      }
      const state = read(a.chat_id);
      if (name === "roadmap") {
        if (a.plan !== undefined) {
          if (
            typeof a.plan !== "string" ||
            !a.plan.trim() ||
            a.plan.length > 3000
          )
            throw Error("Use a short roadmap of at most 3000 characters.");
          state.roadmap = a.plan;
          save(a.chat_id, state);
        }
        reply(200, {
          goal: state.goal,
          plan: state.roadmap ?? "",
          assignments: Object.keys(state.runs)
            .slice(-20)
            .map((id) => ({
              request_id: id,
              revision: state.handoffs[id]?.revision,
            })),
        });
        return;
      }
      if (name === "handoff") {
        if (
          !uuid(a.request_id) ||
          !state.runs[a.request_id] ||
          typeof a.summary !== "string" ||
          !a.summary.trim() ||
          a.summary.length > 2000 ||
          typeof a.revision !== "string" ||
          !/^[a-f0-9]{7,64}$/i.test(a.revision)
        )
          throw Error(
            "Supply a known job, revision and concise checked handoff",
          );
        state.handoffs[a.request_id] = {
          revision: a.revision,
          summary: a.summary,
        };
        save(a.chat_id, state);
        reply(200, { saved: true });
        return;
      }
      const post = async (
        route: "research_agents" | "research_run" | "messages",
        extra: object = {},
      ) =>
        (await cloud(route, account, { chat_id: a.chat_id, ...extra })).json();
      if (name === "agents") {
        reply(200, researchAgents(await post("research_agents")));
        return;
      }
      if (name === "assignment") {
        if (
          typeof a.task !== "string" ||
          !a.task.trim() ||
          a.task.length > 16000 ||
          typeof a.agent_id !== "string" ||
          !uuid(a.request_id)
        )
          throw Error("Invalid assignment");
        const deps = a.depends_on ?? [];
        if (
          !Array.isArray(deps) ||
          deps.length > 5 ||
          deps.some((id) => !uuid(id) || !state.handoffs[id])
        )
          throw Error("Unknown or excessive dependencies");
        const notes = deps.map((id) => state.handoffs[id]);
        const ack = await post("research_run", {
          agent_id: a.agent_id,
          request_id: a.request_id,
          prompt:
            `Coding goal: ${state.goal}\nAssignment: ${a.task}` +
            (notes.length
              ? "\nReviewed dependencies: " + JSON.stringify(notes)
              : ""),
        });
        if (!ack.run_id || ack.request_id !== a.request_id)
          throw Error("Invalid assignment acknowledgement");
        const latest = read(a.chat_id);
        latest.runs[a.request_id] = ack.run_id;
        save(a.chat_id, latest);
        reply(200, {
          room_id: ack.room_id,
          run_id: ack.run_id,
          status: ack.status,
        });
        return;
      }
      if (name === "results") {
        if (!uuid(a.request_id) || !state.runs[a.request_id])
          throw Error("Unknown assignment");
        const run = state.runs[a.request_id],
          data = await post("messages");
        const msg = data.messages?.find(
          (m: any) => m.role === "assistant" && m.run_id === run,
        );
        reply(200, {
          status: data.runs?.find((r: any) => r.run_id === run)?.status,
          reply: msg?.content,
          receipt: msg?.receipt,
          handoff: state.handoffs[a.request_id],
        });
        return;
      }
      throw Error("Unknown tool");
    } catch (e) {
      reply(400, { error: (e as Error).message });
    }
  });
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", ok);
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw Error("Bridge startup failed");
  try {
    await writeFile(file, JSON.stringify({ port: addr.port, key }), {
      mode: 0o600,
    });
  } catch (e) {
    server.close();
    throw e;
  }
  return async () => {
    server.closeAllConnections();
    server.close();
    await rm(file, { force: true });
  };
}
