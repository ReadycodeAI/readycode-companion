import { readerContext } from "./reader";
import {connectLead,runLead,saveLead,type Candidate} from "./local-lead";
import {dialog} from "electron";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {tmpdir} from "node:os";
import {openBridge} from "./ide-bridge";
import {codexPath, detectHosts} from "./detect-hosts";
import { startUpdates, checkUpdates, installUpdate, updateMessage, updateReady } from "./updates";
import type { ReaderRequest } from "./types";
import { researchAgents, sourceList, updateResearch } from "./research";
import { parseTeam } from "./team";
import {
  clipboard,
  app,
  BrowserWindow,
  ipcMain,
  shell,
  session,
} from "electron";
import { join, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
  cloud,
  compact,
  stream,
  pairCode,
  testProviderKey,
  setBase,
  defaultBase,
  defaultPublicKey,
  setPublicKey,
  setCustom,
  customEndpoint,
  CloudUnavailable,
  CloudRateLimited,
  UnknownCloudChat,
  DeviceRevoked,
} from "./network";
import {
  loadChats,
  persist,
  saved,
  saveSecret,
  secret,
  readAddress,
  readPublicKey,
  writePublicKey,
  readCustom,
  writeCustom,
  writeAddress,
} from "./store";
import { context, mergeHistory, mergeMessages } from "./history";
import {
  presets,
  type Chat,
  type Research,
  type Provider,
  type Send,
  type State,
  type Turn,
} from "./types";

let window: BrowserWindow | null = null,
  token = "",
  chats: Chat[] = [];
let active: AbortController | null = null,
  syncing = false,
  reading = false,
  pairing = false,
  verified = false;
let preparedReader: (Awaited<ReturnType<typeof readerContext>> & {chatId: string}) | undefined;
function readerFields(readerId: string | undefined, id: string, prompt: string) {
  if (!readerId) return {};
  const item = preparedReader;
  if (!item || item.chatId !== id || item.documentReceipt.request_id !== readerId ||
      !prompt.endsWith(item.evidence.trimEnd())) throw Error("Reattach the document to refresh its Reader evidence.");
  return { documentReceipt: item.documentReceipt, readerLink: item.readerLink };
}
const submitting = new Set<string>();
const deleting = new Set<string>();
let removedIds = new Set<string>();
let syncError = "",
  historyError = "";
const page = join(__dirname, "index.html");
let publicKey = defaultPublicKey,
  customBase = "",
  apiBase = defaultBase,
  reconnect = false;
function cloudFailure(e: unknown, owner: string) {
  if (e instanceof DeviceRevoked && owner && owner === token) {
    active?.abort();
    saveSecret("device", "");
    restore("");
    reconnect = true;
    update();
  }
}
const providerNames = Object.keys(presets) as Provider[];
function state(): State {
  return {
    appVersion: app.getVersion(),
    updateMessage,
    updateReady,
    publicKey,
    customBase,
    apiBase,
    fixedCloud: !!defaultBase,
    reconnect,
    paired: !!token,
    verified,
    keys: providerNames.filter(saved),
    chats,
    busy: !!active,
    syncError,
    historyError,
    historyEnabled: true,
  };
}
function update() {
  if (window && !window.isDestroyed())
    window.webContents.send("update", state());
}
function save() {
  persist(token, chats, removedIds);
  update();
}
function message(e: unknown) {
  return e instanceof Error ? e.message : "Request failed.";
}
function idle() {
  if (
    active ||
    syncing ||
    reading ||
    pairing ||
    submitting.size ||
    deleting.size
  )
    throw Error("Wait for the current request to finish.");
}
function restore(value: string, snapshot = loadChats(value)) {
  preparedReader = undefined;
  const next = snapshot.chats;
  removedIds = new Set(snapshot.removedIds);
  for (const chat of next)
    for (const turn of chat.turns)
      for (const reply of turn.replies) {
        if (reply.status === "waiting" || reply.status === "streaming") {
          reply.status = "failed";
          reply.error = "The desktop session ended before this reply finished.";
        }
      }
  for (const c of next)
    if (c.research?.status === "submitting") c.research.status = "unconfirmed";
  token = value;
  chats = next;
  verified = false;
  syncError = "";
  historyError = "";
  save();
}
async function refresh() {
  if (!token || reading) return;
  const owner = token;
  reading = true;
  try {
    const status = await (await cloud("status", owner)).json();
    if (status.ok !== true)
      throw Error("ReadyCode could not verify this device.");
    const data = await (await cloud("chats", owner, {})).json();
    if (owner !== token) return;
    mergeHistory(chats, data, removedIds);
    verified = true;
    historyError = "";
    save();
  } catch (e) {
    verified = false;
    cloudFailure(e, owner);
    historyError = message(e);
    update();
  } finally {
    reading = false;
  }
}
async function readChat(id: string) {
  const chat = chats.find((c) => c.id === id),
    owner = token;
  if (!owner || !chat?.roomId || chat.cloudUnavailable) return;
  try {
    const data = await (await cloud("messages", owner, { chat_id: id })).json();
    if (owner !== token) return;
    mergeMessages(chat, data);
    save();
  } catch (e) {
    if (e instanceof UnknownCloudChat && owner === token) {
      chat.cloudUnavailable = true;
      save();
      return;
    }
    cloudFailure(e, owner);
    if (e instanceof CloudRateLimited) throw Error("429: " + e.message);
    throw e;
  }
}
async function sync() {
  if (syncing || !token) return;
  syncing = true;
  const owner = token;
  try {
    for (const chat of chats)
      for (const turn of chat.turns)
        for (const r of turn.replies) {
          if (
            deleting.has(chat.id) ||
            removedIds.has(chat.id) ||
            chat.cloudUnavailable ||
            r.sync !== "queued"
          )
            continue;
          if (
            !r.receipt?.id ||
            turn.prompt.length > 60000 ||
            r.text.length > 60000
          ) {
            r.syncError = !r.receipt?.id
              ? "The original turn has no ReadyCode receipt ID."
              : "ReadyCode accepts up to 60,000 characters per message. The full turn is kept locally.";
            save();
            continue;
          }
          try {
            const ack = await (
              await cloud("sync", owner, {
                chat_id: chat.id,
                title: chat.title,
                receipt_id: r.receipt.id,
                ...(turn.readerLink && {reader_request_id: turn.readerLink}),
                user_message: turn.prompt,
                assistant_reply: r.text,
                model: r.model,
                provider_usage: r.usage,
              })
            ).json();
            if (owner !== token) return;
            if (ack.ok !== true || typeof ack.room_id !== "string")
              throw Error("ReadyCode did not acknowledge this turn.");
            chat.roomId = ack.room_id;
            r.remoteId = ack.reply_message_id;
            r.syncError = undefined;
          } catch (e) {
            r.syncError = message(e);
            throw e;
          }
          r.sync = "synced";
          verified = true;
          syncError = "";
          save();
        }
  } catch (e) {
    cloudFailure(e, owner);
    syncError = message(e);
    update();
  } finally {
    syncing = false;
  }
}
function requireAvailableChat(id: string) {
  if (deleting.has(id) || removedIds.has(id))
    throw Error("This chat has been removed or is being deleted.");
  if (chats.find((chat) => chat.id === id)?.cloudUnavailable)
    throw Error(
      "This chat is no longer available on ReadyCode. Start a new chat.",
    );
}
async function send(input: Send) {
  if (!token) throw Error("Connect your ReadyCode account to start chatting.");
  if (active) throw Error("Finish the current turn first.");
  if (
    !input ||
    typeof input.id !== "string" ||
    !/^[\w.:-]{1,100}$/.test(input.id) ||
    !providerNames.includes(input.provider) ||
    typeof input.prompt !== "string" ||
    !input.prompt.trim() ||
    !Array.isArray(input.models) ||
    input.models.length < 1 ||
    input.models.length > 2 ||
    new Set(input.models).size !== input.models.length ||
    input.models.some(
      (m) => typeof m !== "string" || !/^[\w./:-]{1,120}$/.test(m),
    )
  )
    throw Error("Choose valid, distinct models and enter a message.");
  if (input.prompt.length > 60000)
    throw Error(
      "ReadyCode accepts up to 60,000 characters per message. Shorten the prompt to send it.",
    );
  const owner = token;
  requireAvailableChat(input.id);
  const key = secret(input.provider);
  if (!key) throw Error("Add your provider key in Settings.");
  const controller = new AbortController();
  let chat = chats.find((c) => c.id === input.id);
  if (!chat) {
    chat = {
      id: input.id,
      title: Array.from(input.prompt.trim()).slice(0, 40).join(""),
      turns: [],
    };
    chats.unshift(chat);
  }
  const messages = context(chat);
  const turn: Turn = {
    ...readerFields(input.readerId, input.id, input.prompt),
    id: randomUUID(),
    prompt: input.prompt,
    replies: input.models.map((model) => ({
      model,
      text: "",
      status: "waiting",
    })),
  };
  chat.activityAt = Date.now();
  chat.turns.push(turn);
  active = controller;
  let timer: NodeJS.Timeout | undefined;
  const notify = () => {
    if (!timer)
      timer = setTimeout(() => {
        timer = undefined;
        update();
      }, 40);
  };
  try {
    save();
    if (chat.roomId && !chat.remoteLoaded) {
      await readChat(chat.id);
      requireAvailableChat(chat.id);
      messages.splice(0, messages.length, ...context(chat));
    }
    const full = [
      ...messages,
      { role: "user" as const, content: input.prompt },
    ];
    const results = await Promise.all(
      input.models.map((model) =>
        compact(owner, chat.id, model, full, controller.signal),
      ),
    );
    if (owner !== token || controller.signal.aborted)
      throw Error("Turn interrupted before provider dispatch.");
    const providerMessages = results[0].messages;
    if (
      results.some(
        (r) => JSON.stringify(r.messages) !== JSON.stringify(providerMessages),
      )
    )
      throw Error("ReadyCode returned different contexts for the comparison.");
    turn.receipt = results[0].receipt;
    turn.replies.forEach((r, i) => {
      r.receipt = results[i].receipt;
    });
    verified = true;
    save();
    await Promise.all(
      turn.replies.map(async (reply) => {
        try {
          reply.status = "streaming";
          update();
          reply.usage = await stream(
            input.provider,
            key,
            reply.model,
            providerMessages,
            controller.signal,
            (s) => {
              reply.text += s;
              notify();
            },
          );
          if (!reply.text) throw Error("The provider returned no text.");
          reply.status = "complete";
          if (reply.receipt) reply.sync = "queued";
        } catch (e) {
          reply.status = "failed";
          reply.error = controller.signal.aborted
            ? "Stopped by you."
            : message(e);
        }
        save();
        void sync();
      }),
    );
  } catch (e) {
    if (!turn.receipt && !controller.signal.aborted) verified = false;
    cloudFailure(e, owner);
    for (const r of turn.replies)
      if (r.status !== "complete") {
        r.status = "failed";
        r.error = controller.signal.aborted ? "Stopped by you." : message(e);
      }
  } finally {
    clearTimeout(timer);
    active = null;
    save();
  }
}
function bind(name: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(name, (event, ...args) => {
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== pathToFileURL(page).href
    )
      throw Error("Untrusted frame.");
    return fn(...args);
  });
}
function handlers() {
  let project: Awaited<ReturnType<typeof connectLead>> | undefined;
  let candidate: Candidate | undefined;
  let leadBusy=false, leadOwner="";
  let closeBridge:(()=>Promise<void>)|undefined;
  let checkedAt="";
  bind("ideStatus",()=>closeBridge && token===leadOwner ? checkedAt || "waiting" : "disabled");
  let generation=0;
  const disconnectBridge=async()=>{generation++;await closeBridge?.();closeBridge=undefined};
  bind("detectHosts",detectHosts);
  bind("ideProject",()=>project&&token===leadOwner?project.root+" · "+project.base.slice(0,8):"");
  const bridgePaths=()=>({script:app.isPackaged?join(process.resourcesPath,"ide-mcp.cjs"):join(app.getAppPath(),"scripts","ide-mcp.cjs"),
    descriptor:join(app.getPath("userData"),"ide-session.json")});
  bind("ideSetup",async()=>{
    if(!token||leadBusy)throw Error("Pair your account and wait for the local lead to finish.");
    await disconnectBridge();
    if(leadOwner!==token){project=undefined;candidate=undefined;}
    leadOwner=token;
    const session=generation, account=token;
    const {descriptor,script}=bridgePaths();
    checkedAt="";
    closeBridge=await openBridge(descriptor,project?.root??"",()=>token,()=>{checkedAt=new Date().toISOString()},async(path)=>{
      if(!window||!isAbsolute(path)||/^(\\\\|\/\/)/.test(path)||path.length>4000)throw Error("Supply an absolute local Git workspace path.");
      const p=await connectLead(path);
      const choice=await dialog.showMessageBox(window,{type:"question",title:"Connect this project?",message:"Use this Git project for ReadyCode coding goals?",detail:p.root+" · "+p.base.slice(0,8),buttons:["Connect project","Cancel"],defaultId:1,cancelId:1});
      if(choice.response!==0||account!==token||generation!==session)throw Error("Project was not connected.");
      project=p;candidate=undefined;
      return p.root;
    });
    return {script,descriptor};
  });
  bind("registerCodex",async()=>{
    if(!closeBridge||!token||leadOwner!==token)throw Error("Enable the project connection first.");
    const {script,descriptor}=bridgePaths();
    const run=promisify(execFile);
    await run("node",["--version"],{cwd:tmpdir(),windowsHide:true,timeout:10000});
    const cli=await codexPath();
    if(!cli)throw Error("Install the Codex CLI, then retry.");
    await run(cli,["mcp","add","readycode-companion","--","node",script,descriptor],{cwd:tmpdir(),windowsHide:true,timeout:20000});
  });
  bind("registerCursor",async()=>{
    if(!closeBridge||!token||leadOwner!==token)throw Error("Enable the IDE connection first.");
    const {script,descriptor}=bridgePaths();
    const config=Buffer.from(JSON.stringify({command:"node",args:[script,descriptor]})).toString("base64");
    await shell.openExternal("cursor://anysphere.cursor-deeplink/mcp/install?name=readycode-companion&config="+encodeURIComponent(config));
  });
  bind("disconnectIDE",disconnectBridge);
  bind("connectProject",async()=>{
    if(!window||!token||leadBusy) throw Error("Pair your account and wait for any active goal.");
    const choice=await dialog.showOpenDialog(window,{title:"Choose a trusted Git project for Codex",properties:["openDirectory"]});
    if(choice.canceled) return "";
    await disconnectBridge();
    project=await connectLead(choice.filePaths[0]);
    leadOwner=token;
    candidate=undefined;
    return project.root+" · "+project.base.slice(0,8);
  });
  bind("leadGoal",async(goal:string,policy:"auto"|"solo"|"two"="auto")=>{
    if(!project||!token||token!==leadOwner||leadBusy||typeof goal!=="string"||!goal.trim()||goal.length>4000||!["auto","solo","two"].includes(policy)) throw Error("Connect a project and enter one goal.");
    leadBusy=true;candidate=undefined;
    try {
      candidate=await runLead(project,goal.trim(),join(app.getPath("userData"),"goal-worktrees"),()=>token,s=>window?.webContents.send("leadProgress",s),policy);
      const {report,diff,branch,room}=candidate;
      return {report,diff,branch,room};
    } finally {leadBusy=false}
  });
  bind("saveLead",async()=>{
    if(leadBusy||!candidate||!token||token!==leadOwner) throw Error("No reviewed candidate available.");
    leadBusy=true;
    try {const sha=await saveLead(candidate);candidate=undefined;return sha} finally {leadBusy=false}
  });
  const jobs = new Map<string, AbortController>();
  bind("checkUpdate", checkUpdates);
  function requireRestartable() {
    idle();
    if (jobs.size || leadBusy) throw Error("Wait for the current Reader or coding job to finish before restarting.");
  }
  bind("restart", () => {
    requireRestartable();
    app.relaunch();
    app.quit();
  });
  bind("installUpdate", () => {
    requireRestartable();
    installUpdate();
  });
  bind("deleteChat", async (id: string, scope: "device" | "cloud") => {
    const owner = token;
    const chat = chats.find((c) => c.id === id);
    if (!owner || !chat || !["device", "cloud"].includes(scope))
      throw Error("Choose a chat on this device.");
    idle();
    if (jobs.size)
      throw Error("Wait for Reader to finish before removing a chat.");
    deleting.add(id);
    try {
      if (scope === "cloud") {
        if (!chat.roomId)
          throw Error("Only a saved ReadyCode chat can be deleted online.");
        const response = await cloud("delete_chat", owner, {
            chat_id: id,
            room_id: chat.roomId,
          }).catch((error) => {
            if (error instanceof UnknownCloudChat) return null;
            throw error;
          });
        if (response) {
          const ack = await response.json();
          if (ack?.ok !== true || ack.deleted !== true ||
              ack.chat_id !== id || ack.room_id !== chat.roomId)
            throw Error("ReadyCode did not confirm deletion. The local copy was kept.");
        }
      }
      if (owner !== token) throw Error("The connected account changed.");
      const remaining = chats.filter((c) => c.id !== id);
      const hidden = new Set(removedIds).add(id);
      persist(owner, remaining, hidden);
      chats = remaining;
      removedIds = hidden;
      update();
    } catch (e) {
      cloudFailure(e, owner);
      throw e;
    } finally {
      deleting.delete(id);
    }
  });
  bind("stopReader", (id: string) => jobs.get(id)?.abort());
  bind("readDocuments", async (input: ReaderRequest) => {
    const owner = token;
    if (!owner) throw Error("Pair ReadyCode to use document attachments.");
    requireAvailableChat(input.chatId);
    if (jobs.size) throw Error("A Reader request is already in progress.");
    const controller = new AbortController();
    jobs.set(input.requestId, controller);
    const deadline = AbortSignal.timeout(180000);
    try {
      const evidence = await readerContext(
        owner,
        input,
        AbortSignal.any([controller.signal, deadline]),
      );
      if (token !== owner) throw Error("Device changed. Please retry.");
      preparedReader = {...evidence, chatId: input.chatId};
      return evidence.evidence;
    } catch (e) {
      cloudFailure(e, owner);
      if (controller.signal.aborted) throw Error("Document reading stopped.");
      if (deadline.aborted)
        throw Error(
          "Reader is taking longer than expected. Retry this request.",
        );
      throw e;
    } finally {
      jobs.delete(input.requestId);
    }
  });
  bind("state", state);
  async function team(id: string) {
    requireAvailableChat(id);
    const owner = token,
      chat = chats.find((c) => c.id === id);
    if (!owner || !chat?.roomId)
      throw Error("Save a turn to ReadyCode before asking the Cloud Team.");
    try {
      const data = await (
        await cloud("cloud_team", owner, { chat_id: id })
      ).json();
      if (owner !== token) throw Error("The connected device changed.");
      return parseTeam(data, chat.roomId);
    } catch (e) {
      cloudFailure(e, owner);
      throw e;
    }
  }
  bind("agents", async (id: string) => {
    const owner = token;
    if (!owner) throw Error("Pair ReadyCode to use cloud agents.");
    try {
      const data = await (
        await cloud("research_agents", owner, { chat_id: id })
      ).json();
      if (owner !== token) throw Error("Device changed.");
      return researchAgents(data);
    } catch (e) {
      cloudFailure(e, owner);
      throw e;
    }
  });
  bind(
    "research",
    async (id: string, selection: string | string[], prompt: string, readerId?: string) => {
      requireAvailableChat(id);
      const owner = token;
      if (!owner) throw Error("Pair ReadyCode to use cloud agents.");
      const agents = Array.isArray(selection) ? selection : [selection];
      const agentId = agents[0];
      if (
        typeof id !== "string" ||
        !/^[\w.:-]{1,100}$/.test(id) ||
        !agents.length ||
        agents.length > 8 ||
        new Set(agents).size !== agents.length ||
        agents.some(
          (a) => typeof a !== "string" || !a.trim() || a.length > 160,
        ) ||
        typeof prompt !== "string" ||
        !prompt.trim() ||
        prompt.length > 60000
      )
        throw Error(
          "Select an agent and enter a question of up to 60,000 characters.",
        );
      if (submitting.has(id) || active)
        throw Error("Wait for the current request to finish.");
      let chat = chats.find((c) => c.id === id);
      if (!chat) {
        chat = {
          id,
          title: Array.from(prompt.trim()).slice(0, 40).join(""),
          turns: [],
        };
        chats.unshift(chat);
      }
      const previous = chat.research;
      if (previous && ["queued", "running"].includes(previous.status))
        throw Error("This chat already has a research run in progress.");
      if (
        previous?.status === "unconfirmed" &&
        (previous.agentId !== agentId ||
          JSON.stringify(previous.agentIds) !==
            JSON.stringify(Array.isArray(selection) ? agents : undefined) ||
          previous.prompt !== prompt)
      )
        throw Error(
          "Retry the unconfirmed submission before starting another run.",
        );
      const run: Research =
        previous?.status === "unconfirmed"
          ? previous
          : {
              requestId: randomUUID(),
              ...readerFields(readerId, id, prompt),
              agentId,
              agentIds: Array.isArray(selection) ? agents : undefined,
              prompt,
              status: "submitting",
            };
      if (previous?.agentIds && previous.runId && previous !== run) {
        const rounds = (chat.rounds ??= []);
        if (!rounds.some((r) => r.requestId === previous.requestId))
          rounds.push(previous);
      }
      chat.activityAt = Date.now();
      submitting.add(id);
      chat.research = run;
      run.status = "submitting";
      run.error = undefined;
      try {
        save();
        const response = await cloud(
          run.agentIds ? "room_run" : "research_run",
          owner,
          {
            chat_id: id,
            request_id: run.requestId,
            ...(run.readerLink && {reader_request_id: run.readerLink}),
            ...(run.agentIds
              ? { agent_ids: run.agentIds }
              : { agent_id: agentId }),
            prompt,
          },
        );
        if (owner !== token) return;
        try {
          updateResearch(chat, run, await response.json());
        } catch {
          throw new CloudUnavailable(
            "Could not confirm the research run. Retry with the same request.",
          );
        }
        save();
      } catch (e) {
        if (owner === token) {
          run.status = e instanceof CloudUnavailable ? "unconfirmed" : "failed";
          run.error = message(e);
          save();
          cloudFailure(e, owner);
        }
        throw e;
      } finally {
        submitting.delete(id);
      }
    },
  );
  bind("retryAgent", async (id: string, runId: string, agent: string) => {
    requireAvailableChat(id);
    const owner = token;
    const chat = chats.find((c) => c.id === id);
    const round = [chat?.research, ...(chat?.rounds ?? [])].find(
      (r) => r?.runId === runId,
    );
    if (
      !owner ||
      !chat ||
      !round ||
      !round.participants?.some(
        (p) => p.agent_id === agent && p.status === "failed",
      )
    )
      throw Error("Choose a failed reply in this room.");
    if (submitting.has(id))
      throw Error("Wait for the current request to finish.");
    submitting.add(id);
    const attempts = (round.retryIds ??= {});
    const requestId = (attempts[agent] ??= randomUUID());
    try {
      save();
      const ack = await (
        await cloud("room_retry", owner, {
          chat_id: id,
          run_id: runId,
          agent_id: agent,
          request_id: requestId,
        })
      ).json();
      if (owner !== token) return;
      updateResearch(chat, round, ack);
      delete attempts[agent];
      save();
    } catch (e) {
      cloudFailure(e, owner);
      throw e;
    } finally {
      submitting.delete(id);
    }
  });
  bind("openSource", async (id: string, messageId: string, index: number) => {
    const reply = chats
      .find((c) => c.id === id)
      ?.turns.flatMap((t) => t.replies)
      .find((r) => r.remoteId === messageId && r.fromCloud && r.researchId);
    const source = sourceList(reply?.sources)[index];
    if (!Number.isInteger(index) || !source)
      throw Error("Unknown research source.");
    await shell.openExternal(source.url);
  });
  bind("team", team);
  bind("openTeam", async (id: string, model?: string) => {
    const info = await team(id);
    if (!info.keys.length) return false;
    if (model) {
      if (
        !chats
          .find((c) => c.id === id)
          ?.turns.some((t) =>
            t.replies.some((r) => r.model === model && r.status === "complete"),
          )
      )
        throw Error("Select a completed answer.");
      clipboard.writeText(
        "Review the last answer from " +
          model +
          "; list mistakes or improvements.",
      );
    }
    await shell.openExternal(info.url);
    return true;
  });
  bind("customAddress", (v: string) => {
    idle();
    const next = customEndpoint(v);
    if (next !== customBase) {
      saveSecret("Custom", "");
      customBase = setCustom(next);
      writeCustom(customBase);
    }
    update();
  });
  bind("readChat", readChat);
  bind("testKey", (provider: Provider, value: string) => {
    if (
      provider !== "GroqCloud" &&
      provider !== "OpenRouter" &&
      provider !== "Custom"
    )
      throw Error("Unsupported key test.");
    if (provider === "Custom" && !customBase)
      throw Error("Set the custom provider address first.");
    return testProviderKey(provider, value || secret(provider));
  });
  bind("apiAddress", (value: string, k: string) => {
    if (defaultBase)
      throw Error(
        "This build connects only to its configured ReadyCode service.",
      );
    idle();
    if (token)
      throw Error("Disconnect before changing the ReadyCode API address.");
    publicKey = setPublicKey(k);
    writePublicKey(publicKey);
    apiBase = setBase(value);
    writeAddress(apiBase);
    update();
  });
  bind("send", send);
  bind("stop", () => active?.abort());
  bind("refresh", async () => {
    await Promise.all([sync(), refresh()]);
    update();
  });
  bind("key", (p: Provider, k: string) => {
    if (
      !providerNames.includes(p) ||
      typeof k !== "string" ||
      k.length > 8192 ||
      /[\r\n]/.test(k)
    )
      throw Error("Invalid provider key.");
    if (p === "Custom" && k && !customBase)
      throw Error("Set the custom provider address first.");
    saveSecret(p, k.trim());
    update();
  });
  bind("pair", async (value: string) => {
    idle();
    if (token) throw Error("Disconnect the current account first.");
    if (typeof value !== "string" || value.length > 8192)
      throw Error("Enter a valid pairing code.");
    pairing = true;
    try {
      const pair = await (
        await cloud("pair", "", {
          code: pairCode(value),
          device_label: hostname().slice(0, 60),
        })
      ).json();
      value = pair.device_token;
      if (typeof value !== "string" || !/^rcd_[A-Za-z0-9_-]+$/.test(value))
        throw Error("ReadyCode did not return a valid device token.");
      const status = await (await cloud("status", value)).json();
      if (status.ok !== true) throw Error("Device verification failed.");
      reconnect = false;
      const cache = loadChats(value);
      saveSecret("device", value);
      restore(value, cache);
      verified = true;
      update();
      void refresh();
      void sync();
    } finally {
      pairing = false;
    }
  });
  bind("unlink", () => {
    idle();
    void disconnectBridge();
    saveSecret("device", "");
    restore("");
  });
  bind("open", (p: string) => {
    if (p === "savings")
      return shell.openExternal("https://readycode.ai/savings");
    if (p === "aiSetup")
      return shell.openExternal("https://readycode.ai/account/ai-setup");
    if (p === "groqLogin")
      return shell.openExternal("https://console.groq.com/login");
    if (p === "groqKeys")
      return shell.openExternal("https://console.groq.com/keys");
    if (p !== "pair" && p !== "history" && p !== "teams")
      throw Error("Unknown page.");
    return shell.openExternal(
      "https://readycode.ai/account/" +
        (p === "pair" ? "device/pair" : p === "teams" ? "teams" : "chat-room"),
    );
  });
}
function show() {
  window = new BrowserWindow({
    width: 1160,
    height: 800,
    icon: join(__dirname, "readycode.png"),
    minWidth: 760,
    minHeight: 580,
    backgroundColor: "#101516",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (e) => e.preventDefault());
  window.on("closed", () => {
    window = null;
    active?.abort();
  });
  void window.loadFile(page);
}
if (process.platform === "win32")
  app.setAppUserModelId("ai.readycode.companion");
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    window?.restore();
    window?.focus();
  });
  app
    .whenReady()
    .then(() => {
      session.defaultSession.setPermissionRequestHandler((_w, _p, respond) =>
        respond(false),
      );
      const previousBase = readAddress(defaultBase);
      apiBase = setBase(defaultBase || previousBase);
      publicKey = setPublicKey(
        defaultBase ? defaultPublicKey : readPublicKey(defaultPublicKey),
      );
      if (defaultBase && previousBase.replace(/\/+$/, "") !== apiBase) {
        reconnect = saved("device");
        saveSecret("device", "");
        writeAddress(apiBase);
      }
      customBase = setCustom(readCustom());
      handlers();
      restore(secret("device"));
      show();
      startUpdates(update);
      void refresh();
      void sync();
      setInterval(() => void sync(), 30000).unref();
      app.on("activate", () => {
        if (!window) show();
      });
    })
    .catch((e) => {
      require("electron").dialog.showErrorBox(
        "ReadyCode could not start",
        message(e),
      );
      app.quit();
    });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
