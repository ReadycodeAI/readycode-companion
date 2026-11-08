import React, { useEffect, useRef, useState } from "react";
import { CloudTeam, useRoomMessages } from "./cloud-team";
import {
  attachmentPrompt,
  isReaderFile,
  readerLimit,
  readAttachments,
  fileTypes,
  type Attachment,
} from "./attachments";
import { createRoot } from "react-dom/client";
import {
  presets,
  type State,
  type Provider,
  type Agent,
  type Turn,
  type Receipt,
} from "./types";
const api = window.companion;
const fmt = (n: number) => n.toLocaleString("en-US");
function SavingsExample({ open }: { open: () => void }) {
  return (
    <div className="savings-example">
      <p>
        In a synthetic 60-turn chat, the final Gemini 3 Flash request used{" "}
        <strong>86.7% fewer input tokens</strong> with ReadyCode (10,614 →
        1,411).
      </p>
      <button className="savings-link" onClick={open}>
        See savings from ReadyCode tests ↗
      </button>
    </div>
  );
}
function Mark() {
  return (
    <svg
      className="mark"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m18 8 4 4-4 4M6 8l-4 4 4 4m8.5-12-5 16" />
    </svg>
  );
}
function RemoveChatDialog({
  title,
  online,
  close,
  remove,
}: {
  title: string;
  online: boolean;
  close: () => void;
  remove: (scope: "device" | "cloud") => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [scope, setScope] = useState<"device" | "cloud">("device");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="team-dialog"
      aria-labelledby="remove-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) close();
      }}
    >
      <h2 id="remove-title">Remove “{title}”?</h2>
      <label>
        <input
          type="radio"
          checked={scope === "device"}
          disabled={pending}
          onChange={() => setScope("device")}
        />{" "}
        Remove from this device
      </label>
      <p>
        The cached messages are removed from this device. Any turns already
        saved to ReadyCode stay in your online account. Unsynced turns will be
        lost.
      </p>
      {online && (
        <>
          <label>
            <input
              type="radio"
              checked={scope === "cloud"}
              disabled={pending}
              onChange={() => setScope("cloud")}
            />{" "}
            Delete here and on ReadyCode
          </label>
          <p>
            This also deletes the online conversation and its replies from your
            ReadyCode history.
          </p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="buttons">
        <button autoFocus disabled={pending} onClick={close}>
          Cancel
        </button>
        <button
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError("");
            try {
              await remove(scope);
            } catch (e) {
              setError(
                String((e as Error).message).replace(
                  /^Error invoking remote method '[^']+': Error: /,
                  "",
                ),
              );
              setPending(false);
            }
          }}
        >
          {pending
            ? "Removing…"
            : scope === "cloud"
              ? "Delete here and on ReadyCode"
              : "Remove from this device"}
        </button>
      </div>
    </dialog>
  );
}
function Ticket({ r }: { r: Receipt }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details onToggle={(e) => setExpanded(e.currentTarget.open)}>
      <summary>
        Receipt details ·{" "}
        {"compacted" in r && !r.compacted
          ? "Sent whole"
          : "Estimated " +
            fmt(r.original_tokens) +
            " → " +
            fmt(r.compacted_tokens) +
            " tokens sent"}
      </summary>
      {expanded && (
        <dl>
          {Object.entries(r)
            .filter(([k]) =>
              [
                "id",
                "original_tokens",
                "compacted_tokens",
                "saved_tokens",
                "savings_percent",
                "receipt_hash",
              ].includes(k),
            )
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k.replaceAll("_", " ")}</dt>
                <dd className="receipt-value">
                  {v == null
                    ? "—"
                    : typeof v === "number"
                      ? fmt(v)
                      : typeof v === "object"
                        ? JSON.stringify(v, null, 2)
                        : String(v)}
                </dd>
              </div>
            ))}
        </dl>
      )}
    </details>
  );
}
function Savings({ receipt: r }: { receipt?: Receipt }) {
  if (!r)
    return <p className="hint">Savings receipt unavailable for this reply.</p>;
  const short =
    "passthrough_reason" in r &&
    "compacted" in r &&
    r.compacted === false &&
    r.savings_percent === 0 &&
    ["short_chat", "short chat"].includes(
      String(r.passthrough_reason).toLowerCase(),
    );
  return (
    <div className="savings-receipt">
      <div className="badge">
        {short
          ? "Optimal context · 0% compaction needed"
          : `Saved ${fmt(r.savings_percent)}% input tokens via ReadyCode`}
      </div>
      <p className="hint">
        Estimated input: {fmt(r.original_tokens)} → {fmt(r.compacted_tokens)}{" "}
        tokens
      </p>
      <Ticket r={r} />
    </div>
  );
}
function ReaderSavings({receipt}: {receipt: NonNullable<Turn["documentReceipt"]>}) {
  return <section className="savings-receipt" aria-label="Reader document receipt">
    <strong>ReadyCode Reader · document input</strong>
    {receipt.documents.map((doc, index) => {
      const count = doc.measurement;
      return <div key={index}>
        <p>{doc.name} · {doc.locations.join(", ")}</p>
        {count ? <>
          <p>{count.full_text_tokens.toLocaleString()} tokens in extracted text → {count.excerpt_tokens.toLocaleString()} in cited excerpts</p>
          <p>{Math.max(0, count.full_text_tokens - count.excerpt_tokens).toLocaleString()} document input tokens saved · {count.tokenizer}</p>
        </> : <p>Document token savings weren’t measured for this file.</p>}
      </div>;
    })}
  </section>;
}
function Messages({
  turn,
  secondOpinion,
  chatId,
  onError,
}: {
  turn: Turn;
  chatId: string;
  onError: (v: string) => void;
  secondOpinion?: (model: string) => void;
}) {
  return (
    <article>
      {turn.prompt && (
        <>
          <div className="speaker">
            {turn.sourceRole === "system" ? "System" : "You"}
          </div>
          <p className="prompt">{turn.prompt}</p>
        </>
      )}
      {turn.documentReceipt && <ReaderSavings receipt={turn.documentReceipt}/>}
      <div className={"answers " + (turn.replies.length === 2 ? "pair" : "")}>
        {turn.replies.map((r) => (
          <section className="answer" key={r.remoteId || r.model}>
            <div className="speaker">
              <span className="spark">✳</span> {r.model}
              {r.fromCloud && <small> · via readycode.ai</small>}
            </div>
            <p>
              {r.text ||
                (r.status === "waiting"
                  ? "Preparing conversation…"
                  : r.status === "streaming"
                    ? "Waiting for provider…"
                    : "")}
            </p>
            {r.researchId && !!r.sources?.length && (
              <div className="research-sources">
                <h3>Sources</h3>
                <ol>
                  {r.sources.map((source, i) => (
                    <li key={source.url}>
                      <button
                        title={source.url}
                        onClick={() =>
                          void api
                            .openSource(chatId, r.remoteId!, i)
                            .catch((e) => onError(String(e.message)))
                        }
                      >
                        {source.title} ↗
                      </button>
                      <small>{new URL(source.url).hostname}</small>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {r.error && (
              <p className="error" role="alert">
                {r.error}
              </p>
            )}
            {(r.status === "complete" || !!r.text) && (
              <>{turn.documentReceipt && <strong>Chat compaction</strong>}<Savings
                receipt={
                  r.receipt ||
                  (turn.replies.length === 1 ? turn.receipt : undefined)
                }
              /></>
            )}
            {r.usage && (
              <details>
                <summary>Provider-reported usage</summary>
                <dl>
                  {Object.entries(r.usage).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k.replaceAll("_", " ")}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
            {r.sync && (
              <small>
                {r.sync === "synced"
                  ? "Saved to ReadyCode"
                  : "Not saved to ReadyCode"}
                {r.sync === "queued" && (
                  <button onClick={() => void api.refresh().catch(() => {})}>
                    Retry save
                  </button>
                )}
              </small>
            )}
            {secondOpinion &&
              r.sync === "synced" &&
              r.status === "complete" && (
                <button onClick={() => secondOpinion(r.model)}>
                  Get second opinions
                </button>
              )}
            {r.syncError && <p className="error">{r.syncError}</p>}
          </section>
        ))}
      </div>
    </article>
  );
}
class ReplyBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <article role="alert">
        <p>This reply could not be displayed.</p>
        <button onClick={() => this.setState({ failed: false })}>
          Retry display
        </button>
      </article>
    ) : (
      this.props.children
    );
  }
}
function App() {
  const [s, setState] = useState<State | null>(null),
    [error, setError] = useState(""),
    [settings, setSettings] = useState(false);
  const [id, newId] = useState<string>(() => crypto.randomUUID()),
    [draft, setDraft] = useState(""),
    [token, setToken] = useState(""),
    [key, setKey] = useState(""),
    [notice, setNotice] = useState(""),
    [working, setWorking] = useState(false);
  const [team, setTeam] = useState<{ id: string; model?: string } | null>(null),
    [pub, setPub] = useState(""),
    [custom, setCustom] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]),
    [reading, setReading] = useState(false);
  const [removeId, setRemoveId] = useState("");
  const [documents, setDocuments] = useState<File[]>([]),
    [readerStatus, setReaderStatus] = useState(false);
  const readerRequest = useRef<{
    id: string;
    chat: string;
    question: string;
    files: File[];
  } | null>(null);
  const activeReader = useRef<string | null>(null),
    preparedResearch = useRef<{
      prompt: string;
      draft: string;
      files: Attachment[];
      documents: File[];
    } | null>(null);
  const pickGeneration = useRef(0),
    filePicker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    pickGeneration.current++;
    setFiles([]);
    setDocuments([]);
    preparedResearch.current = null;
    readerRequest.current = null;
    if (activeReader.current)
      void api.stopReader(activeReader.current).catch(() => {});
    setReading(false);
  }, [id, s?.paired]);
  const [address, setAddress] = useState("");
  const [p, provider] = useState<Provider>(() => {
    const v = localStorage.getItem("provider");
    return v && Object.hasOwn(presets, v) ? (v as Provider) : "GroqCloud";
  });
  const [model, setModel] = useState(
      localStorage.getItem("primary") || presets[p][0],
    ),
    [second, setSecond] = useState(
      localStorage.getItem("secondary") || presets[p][1],
    ),
    [compare, setCompare] = useState(false);
  const [agentMode, setAgentMode] = useState(
      localStorage.getItem("use-agents") === "true",
    ),
    [agents, setAgents] = useState<Agent[]>([]),
    [agentId, setAgentId] = useState(""),
    [roomMode, setRoomMode] = useState(false),
    [chosenAgents, setChosenAgents] = useState<string[]>([]),
    [agentError, setAgentError] = useState(""),
    [catalogVersion, reloadCatalog] = useState(0),
    [catalogBusy, setCatalogBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setAgents([]);
    setAgentId("");
    setChosenAgents([]);
    setAgentError("");
    setCatalogBusy(false);
    if (agentMode && s?.paired && !settings) {
      setCatalogBusy(true);
      api
        .agents(id)
        .then((list) => {
          if (live) {
            setAgents(list);
            setAgentId(list[0]?.id || "");
            setChosenAgents(list[0] ? [list[0].id] : []);
          }
        })
        .catch((e) => {
          if (live) setAgentError(String(e.message));
        })
        .finally(() => {
          if (live) setCatalogBusy(false);
        });
    }
    return () => {
      live = false;
    };
  }, [agentMode, s?.paired, id, settings, catalogVersion]);
  const [light, setLight] = useState(localStorage.getItem("theme") === "light");
  const bottom = useRef<HTMLDivElement>(null),
    scroll = useRef<HTMLDivElement>(null),
    pinned = useRef(true);
  async function run(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        String(e instanceof Error ? e.message : e).replace(
          /^Error invoking remote method '[^']+': Error: /,
          "",
        ),
      );
    }
  }
  useEffect(() => {
    const off = api.listen(setState);
    void run(async () => {
      const snapshot = await api.state();
      setState(snapshot);
      if (!snapshot.keys.includes(p) && p !== "GroqCloud")
        changeProvider("GroqCloud");
    });
    return off;
  }, []);
  useEffect(() => {
    localStorage.setItem("theme", light ? "light" : "dark");
    document.documentElement.classList.toggle("light", light);
  }, [light]);
  useEffect(() => {
    localStorage.setItem("provider", p);
    localStorage.setItem("primary", model);
    localStorage.setItem("secondary", second);
  }, [p, model, second]);
  useEffect(() => {
    if (pinned.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [s, id]);
  const chat = s?.chats.find((c) => c.id === id);
  const room =
    s?.paired && !settings && chat?.roomId && !chat.cloudUnavailable
      ? chat.id
      : undefined;
  const pollError = useRoomMessages(room);
  function select(v: string) {
    setTeam(null);
    newId(v);

    setDraft("");
    pinned.current = true;
    setSettings(false);
    setError("");
  }
  function configure() {
    setAddress(s?.apiBase ?? "");
    setPub(s?.publicKey ?? "");
    setCustom(s?.customBase ?? "");
    setSettings(true);
    setKey("");
    setNotice("");
    setError("");
  }
  function changeProvider(v: Provider) {
    provider(v);
    setModel(presets[v][0]);
    setSecond(presets[v][1]);
    setKey("");
    setNotice("");
  }
  async function pair() {
    setWorking(true);
    await run(async () => {
      await api.pair(token.trim());
      setToken("");
      if (s?.keys.includes(p)) setSettings(false);
      else configure();
    });
    setWorking(false);
  }
  const documentQuestion =
    documents.length === 1
      ? "Summarize this document and cite the relevant passages."
      : "Summarize these documents and cite the relevant passages.";
  const question = draft.trim() || (documents.length ? documentQuestion : "");
  const hasMessage = !!question || files.length > 0;
  async function send() {
    if (!s?.paired || s.busy || working || reading || !hasMessage) return;
    let prompt: string;
    try {
      prompt = attachmentPrompt(question, files);
    } catch (e) {
      setError(String((e as Error).message));
      return;
    }
    if (documents.length && draft.trim().length > 16000) {
      setError("Reader questions can contain up to 16,000 characters.");
      return;
    }
    const originalDocuments = documents;
    const originalDraft = draft;
    const originalFiles = files;
    const generation = pickGeneration.current;
    setFiles([]);
    setWorking(true);
    setDraft("");
    await run(async () => {
      try {
        let readerId: string | undefined;
        if (originalDocuments.length) {
          let job = readerRequest.current;
          if (
            !job ||
            job.chat !== id ||
            job.question !== question ||
            originalDocuments.length !== job.files.length ||
            originalDocuments.some((f, i) => f !== job!.files[i])
          ) {
            job = {
              id: crypto.randomUUID(),
              chat: id,
              question,
              files: originalDocuments,
            };
            readerRequest.current = job;
          }
          setReaderStatus(true);
          activeReader.current = job.id;
          const input = await Promise.all(
            originalDocuments.map(async (f) => {
              try {
                return {
                  name: f.name,
                  bytes: new Uint8Array(await f.arrayBuffer()),
                };
              } catch {
                throw Error(
                  "Could not open " +
                    f.name +
                    " on this computer. If it is stored in OneDrive, download it first, then attach the local copy.",
                );
              }
            }),
          );
          if (
            generation !== pickGeneration.current ||
            activeReader.current !== job.id
          )
            throw Error("Document reading stopped.");
          const evidence = await api.readDocuments({
            chatId: id,
            requestId: job.id,
            question: job.question,
            files: input,
          });
          if (
            generation !== pickGeneration.current ||
            activeReader.current !== job.id
          )
            throw Error("Document reading stopped.");
          prompt = attachmentPrompt(prompt + "\n\n" + evidence, []);
          readerId = job.id;
          activeReader.current = null;
          setReaderStatus(false);
        }
        if (agentMode) {
          if (!s.paired || !(roomMode ? chosenAgents.length : agentId))
            throw Error("Choose an available ReadyCode agent.");
          preparedResearch.current = {
            prompt,
            draft: originalDraft,
            files: originalFiles,
            documents: originalDocuments,
          };
          await api.research(id, roomMode ? chosenAgents : agentId, prompt, readerId);
          if (generation === pickGeneration.current) {
            setDocuments([]);
            readerRequest.current = null;
          }
          return;
        }
        await api.send({
          id,
          provider: p,
          models: compare ? [model, second] : [model],
          readerId,
          prompt,
        });
        if (generation === pickGeneration.current) {
          setDocuments([]);
          readerRequest.current = null;
        }
      } catch (e) {
        if (generation === pickGeneration.current) {
          setDraft((v) => v || originalDraft);
          setFiles(originalFiles);
        }
        throw e;
      } finally {
        activeReader.current = null;
        setReaderStatus(false);
      }
    });
    setWorking(false);
  }
  const research = chat?.research;
  const researchPending =
    research &&
    ["submitting", "unconfirmed", "queued", "running"].includes(
      research.status,
    );
  const canResearch = !!(
    s?.paired &&
    (roomMode
      ? chosenAgents.length &&
        chosenAgents.every((id) => agents.some((a) => a.id === id))
      : agents.some((a) => a.id === agentId)) &&
    !researchPending &&
    !catalogBusy
  );
  if (!s)
    return <main className="loading">{error || "Opening ReadyCode…"}</main>;
  const welcome = !s.paired,
    hasKey = s.keys.includes(p);
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <Mark />
          <span>ReadyCode</span>
        </div>
        <button
          className="new"
          onClick={() => {
            select(crypto.randomUUID());
          }}
        >
          ＋ &nbsp; New chat
        </button>
        <div className="section-label">Conversations</div>
        <nav>
          {s.chats.map((c) => (
            <div className="chat-nav-row" key={c.id}>
              <button
                className={id === c.id ? "selected" : ""}
                onClick={() => select(c.id)}
              >
                {c.title}
                {c.cloudUnavailable ? " · Local copy" : ""}
              </button>
              <button
                className="remove-chat"
                disabled={working || s.busy || reading || readerStatus}
                aria-label={"Remove chat: " + c.title}
                title="Remove chat"
                onClick={() => setRemoveId(c.id)}
              >
                ×
              </button>
            </div>
          ))}
          {!s.chats.length && <small>Your chats will appear here.</small>}
        </nav>
        <div className="side-foot">
          <button onClick={() => void run(() => api.open("history"))}>
            ↗ &nbsp; Cloud chat room
          </button>
          <button onClick={configure}>⚙ &nbsp; Settings</button>
        </div>
      </aside>
      <main>
        <header>
          <span className="crumb">
            Workspace &nbsp;/&nbsp;{" "}
            <strong>{welcome ? "Welcome" : chat?.title || "New chat"}</strong>
          </span>
          <button
            disabled={!room}
            onClick={() => room && setTeam({ id: room })}
          >
            Ask the Cloud Team ↗
          </button>
          <button
            className="theme"
            aria-label="Switch light or dark theme"
            onClick={() => setLight(!light)}
          >
            {light ? "☾" : "☼"}
          </button>
        </header>
        {s.updateReady && (
          <div className="row" role="status">
            {s.updateMessage}
            <button disabled={working || reading || s.busy || !!readerStatus}
              onClick={() => run(() => api.installUpdate())}>Restart to update</button>
          </div>
        )}
        {team && room === team.id && (
          <CloudTeam
            key={team.id}
            id={team.id}
            model={team.model}
            close={() => setTeam(null)}
          />
        )}
        {s.paired &&
          s.chats
            .filter((c) => c.id === removeId)
            .map((c) => (
              <RemoveChatDialog
                key={c.id}
                title={c.title}
                online={!!c.roomId && !c.cloudUnavailable}
                close={() => setRemoveId("")}
                remove={async (scope) => {
                  await api.deleteChat(c.id, scope);
                  setRemoveId("");
                  if (id === c.id) select(crypto.randomUUID());
                }}
              />
            ))}
        {pollError && <p className="alert">{pollError}</p>}
        {error && (
          <div className="alert" role="alert">
            {error}{" "}
            <button onClick={() => setError("")} aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}
        {settings ? (
          <div className="content">
            <div className="settings">
              <div className="row">
                <h1>Settings</h1>
                <button
                  aria-label="Close settings"
                  onClick={() => {
                    setSettings(false);
                    setKey("");
                    setError("");
                  }}
                >
                  ×
                </button>
              </div>
              <div className="row">
                <span>ReadyCode Companion {s.appVersion}</span>
                {s.updateMessage ? <>
                  <span role="status">{s.updateMessage}</span>
                  {!s.updateReady && <button onClick={() => run(() => api.checkUpdate())}>Check for updates</button>}
                </> : <span>Manual updates for this build</span>}
              </div>
              <label>
                Provider
                <select
                  aria-label="Provider"
                  value={p}
                  onChange={(e) => changeProvider(e.target.value as Provider)}
                >
                  <option value="GroqCloud">
                    GroqCloud · free plan available
                  </option>
                  <optgroup label="Other providers · separate keys">
                    {Object.keys(presets)
                      .filter((v) => v !== "GroqCloud")
                      .map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                  </optgroup>
                </select>
              </label>
              {p === "Custom" && (
                <>
                  <label>
                    Custom provider API base
                    <input
                      value={custom}
                      onChange={(e) => setCustom(e.target.value)}
                      placeholder="https://your-provider.example/v1"
                    />
                  </label>
                  <button
                    onClick={() =>
                      void run(async () => {
                        await api.customAddress(custom);
                        setNotice("Provider address saved.");
                      })
                    }
                  >
                    Save provider address
                  </button>
                </>
              )}
              {p === "GroqCloud" ? (
                <div>
                  <p className="hint">
                    Create a key on your own GroqCloud account. Its free plan
                    includes GPT-OSS models with usage limits.
                  </p>
                  <button onClick={() => void run(() => api.open("groqKeys"))}>
                    Get a GroqCloud key ↗
                  </button>
                  <details>
                    <summary>Trouble opening GroqCloud?</summary>
                    <p className="hint">
                      If Groq shows “Access denied,” try its sign-in page first.
                      You can also continue with an OpenRouter key.
                    </p>
                    <div className="buttons">
                      <button
                        onClick={() => void run(() => api.open("groqLogin"))}
                      >
                        GroqCloud sign-in ↗
                      </button>
                      <button onClick={() => changeProvider("OpenRouter")}>
                        Use OpenRouter
                      </button>
                    </div>
                  </details>
                </div>
              ) : (
                !s.keys.length &&
                !key && (
                  <button onClick={() => changeProvider("GroqCloud")}>
                    Start with GroqCloud’s free plan
                  </button>
                )
              )}
              <label>
                API key
                <input
                  type="password"
                  autoComplete="off"
                  value={key}
                  placeholder={
                    hasKey
                      ? "A key is saved on this device"
                      : "Paste your provider key"
                  }
                  onChange={(e) => setKey(e.target.value)}
                />
              </label>
              <p className="hint">
                Encrypted on this device. Sent directly to {p} when you send a
                message.
              </p>
              <div className="buttons">
                <button
                  className="primary"
                  disabled={!key.trim()}
                  onClick={() =>
                    void run(async () => {
                      await api.key(p, key);
                      setKey("");
                      setNotice("Key saved on this device.");
                    })
                  }
                >
                  Save key
                </button>
                {(p === "OpenRouter" ||
                  p === "GroqCloud" ||
                  p === "Custom") && (
                  <button
                    disabled={!key.trim() && !hasKey}
                    onClick={() =>
                      void run(async () => {
                        await api.testKey(p, key.trim());
                        setNotice(p + " accepted this key.");
                      })
                    }
                  >
                    Test key
                  </button>
                )}
                {hasKey && (
                  <button
                    onClick={() =>
                      void run(async () => {
                        await api.key(p, "");
                        setKey("");
                        setNotice("Saved key removed.");
                      })
                    }
                  >
                    Remove key
                  </button>
                )}
              </div>
              <label>
                Model
                <input
                  list="models"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </label>
              {notice && <p role="status">{notice}</p>}
              <h2>ReadyCode account</h2>
              {!s.fixedCloud && (
                <>
                  <label>
                    ReadyCode API address
                    <input
                      value={address}
                      disabled={s.paired}
                      onChange={(e) => setAddress(e.target.value)}
                    />
                  </label>
                  <label>
                    ReadyCode public key
                    <input
                      disabled={s.paired}
                      value={pub}
                      onChange={(e) => setPub(e.target.value)}
                      placeholder="From the ReadyCode pairing page"
                    />
                  </label>
                  {!s.paired && (
                    <button
                      onClick={() =>
                        void run(async () => {
                          await api.apiAddress(address, pub);
                          setNotice("API address saved.");
                        })
                      }
                    >
                      Save ReadyCode settings
                    </button>
                  )}
                </>
              )}
              <p className="hint">
                {s.paired
                  ? "This device uses your account for compaction and cloud history."
                  : "Pair this device to chat, compact context and use the Cloud Team."}
              </p>
              {!s.paired && (
                <button
                  onClick={() => {
                    setSettings(false);
                  }}
                >
                  Go to pairing
                </button>
              )}
              {s.paired && (
                <div className="buttons">
                  <button onClick={() => void run(() => api.refresh())}>
                    Retry sync{s.historyEnabled ? " & refresh history" : ""}
                  </button>
                  <button
                    onClick={() =>
                      void run(async () => {
                        await api.unlink();
                        select(crypto.randomUUID());
                      })
                    }
                  >
                    Disconnect
                  </button>
                </div>
              )}
              <button onClick={() => void run(() => api.open("teams"))}>
                View on readycode.ai ↗
              </button>
              {s.historyError && <p className="error">{s.historyError}</p>}
              {s.syncError && <p className="error">{s.syncError}</p>}
            </div>
          </div>
        ) : welcome ? (
          <div className="content welcome">
            <div className="welcome-inner">
              <div className="hero-mark">
                <Mark />
              </div>
              <h1>Connect to ReadyCode</h1>
              <p className="intro">
                As a chat grows, ReadyCode can send fewer input tokens by
                shortening repeated history. Your account keeps the full
                messages and replies, so you can reopen the original
                conversation later.
              </p>
              <SavingsExample
                open={() => void run(() => api.open("savings"))}
              />
              <button
                className="primary"
                onClick={() => void run(() => api.open("pair"))}
              >
                {s.reconnect
                  ? "Reconnect to ReadyCode"
                  : "Connect ReadyCode Account"}{" "}
                ↗
              </button>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void pair();
                }}
              >
                <label>
                  Enter the pairing code from your ReadyCode account
                  <input
                    autoComplete="one-time-code"
                    placeholder="ABCD-EFGH"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                </label>
                <button
                  disabled={
                    !/^[A-Z0-9]{8}$/i.test(token.replace(/[\s-]/g, "")) ||
                    working
                  }
                >
                  {working ? "Pairing…" : "Pair device"}
                </button>
              </form>
              {(!s.apiBase || !s.publicKey) && (
                <button onClick={configure}>
                  Configure ReadyCode connection
                </button>
              )}
              <div className="composer locked">
                <textarea
                  aria-label="Message"
                  disabled
                  placeholder="Connect your ReadyCode account to start chatting"
                />
                <button disabled>Send ↑</button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div
              ref={scroll}
              className="content transcript"
              onScroll={() => {
                const el = scroll.current;
                if (el)
                  pinned.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 100;
              }}
            >
              <div className="thread">
                {chat ? (
                  <>
                    <h1>{chat.title}</h1>
                    {chat.turns.map((t) => (
                      <ReplyBoundary key={t.id}>
                        <Messages
                          turn={t}
                          chatId={id}
                          onError={setError}
                          secondOpinion={
                            room
                              ? (model) =>
                                  void run(async () => {
                                    if (!(await api.openTeam(room, model)))
                                      setTeam({ id: room, model });
                                  })
                              : undefined
                          }
                        />
                      </ReplyBoundary>
                    ))}
                    {research && !chat.cloudUnavailable && (
                      <section className="research-progress" aria-live="polite">
                        {!chat.turns.some((t) => t.id === research.userId) && (
                          <p>{research.prompt}</p>
                        )}
                        <span>
                          {
                            {
                              submitting: "Sending to ReadyCode…",
                              unconfirmed: "Submission unconfirmed",
                              queued: "Agent request queued",
                              running: "Waiting for the agent…",
                              completed: "Agent replied",
                              failed: "Agent request failed",
                            }[research.status]
                          }
                        </span>
                        {research.error && <p>{research.error}</p>}
                        {research.status === "unconfirmed" && (
                          <button
                            disabled={working}
                            onClick={() =>
                              void run(async () => {
                                if (
                                  preparedResearch.current?.prompt ===
                                    research.prompt &&
                                  preparedResearch.current.draft === draft &&
                                  preparedResearch.current.files === files &&
                                  preparedResearch.current.documents ===
                                    documents
                                ) {
                                  setDraft("");
                                  setFiles([]);
                                  setDocuments([]);
                                  readerRequest.current = null;
                                }
                                await api.research(
                                  id,
                                  research.agentIds ?? research.agentId,
                                  research.prompt,
                                );
                              })
                            }
                          >
                            Retry this submission
                          </button>
                        )}
                      </section>
                    )}
                  </>
                ) : (
                  <div className="empty">
                    <Mark />
                    <h1>Start a conversation</h1>
                    <p>
                      ReadyCode saves your full conversation so you can return
                      to it later. Each reply shows how many input tokens
                      ReadyCode saved. Short chats may already use the optimal
                      context.
                    </p>
                    <SavingsExample
                      open={() => void run(() => api.open("savings"))}
                    />
                  </div>
                )}
                {chat &&
                  !chat.cloudUnavailable &&
                  [
                    ...(chat.rounds ?? []),
                    ...(research?.agentIds ? [research] : []),
                  ].map((round) => (
                    <section
                      key={round.requestId}
                      aria-label="Room reply status"
                      className="research-progress"
                    >
                      <strong>Ask the room</strong> ·{" "}
                      {round.prompt.slice(0, 80)}
                      {round.participants?.map((p) => (
                        <div key={p.agent_id}>
                          {p.label} · {p.status}
                          {p.error && " · " + p.error}{" "}
                          {p.status === "failed" && round.runId && (
                            <button
                              disabled={working}
                              onClick={() =>
                                void run(async () => {
                                  setWorking(true);
                                  try {
                                    await api.retryAgent(
                                      id,
                                      round.runId!,
                                      p.agent_id,
                                    );
                                  } finally {
                                    setWorking(false);
                                  }
                                })
                              }
                            >
                              Retry {p.label}
                            </button>
                          )}
                        </div>
                      ))}
                    </section>
                  ))}
                <div ref={bottom} />
              </div>
            </div>
            <div className="compose">
              {chat?.cloudUnavailable ? (
                <div>
                  <p>
                    This chat is no longer available on ReadyCode. You can still
                    read the copy on this computer.
                  </p>
                  <button onClick={() => select(crypto.randomUUID())}>
                    Start a new chat
                  </button>
                </div>
              ) : (
                <>
                  <div className="model-row">
                    <label>
                      Provider
                      <select
                        aria-label="Chat provider"
                        value={agentMode ? "ReadyCode Agents" : p}
                        onChange={(e) => {
                          if (e.target.value === "settings") {
                            configure();
                            return;
                          }
                          const agent = e.target.value === "ReadyCode Agents";
                          setAgentMode(agent);
                          localStorage.setItem("use-agents", String(agent));
                          if (!agent)
                            changeProvider(e.target.value as Provider);
                          setError("");
                        }}
                      >
                        <option value="GroqCloud">
                          GroqCloud · free plan available
                        </option>
                        <option value="ReadyCode Agents">
                          ReadyCode Agents · chat and research
                        </option>
                        {(Object.keys(presets) as Provider[])
                          .filter(
                            (v) =>
                              v !== "GroqCloud" &&
                              (s.keys.includes(v) || v === p),
                          )
                          .map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                        <option value="settings">Other providers…</option>
                      </select>
                    </label>
                    {agentMode ? (
                      <>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={roomMode}
                            onChange={(e) => {
                              setRoomMode(e.target.checked);
                              if (e.target.checked)
                                setChosenAgents(agentId ? [agentId] : []);
                            }}
                          />{" "}
                          Ask the room
                        </label>
                        {!roomMode && (
                          <label>
                            Cloud agent
                            <select
                              aria-label="Cloud agent"
                              disabled={!agents.length}
                              value={agentId}
                              onChange={(e) => setAgentId(e.target.value)}
                            >
                              {!agents.length && (
                                <option value="">
                                  {catalogBusy ? "Loading…" : "Unavailable"}
                                </option>
                              )}
                              {agents.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name
                                    .toLowerCase()
                                    .includes(a.provider.toLowerCase())
                                    ? a.name
                                    : a.name + " · " + a.provider}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </>
                    ) : (
                      <>
                        <label>
                          Model
                          <input
                            list="models"
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                          />
                        </label>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={compare}
                            onChange={(e) => setCompare(e.target.checked)}
                          />{" "}
                          Compare
                        </label>
                        {compare && (
                          <label>
                            Second model
                            <input
                              list="models"
                              value={second}
                              onChange={(e) => setSecond(e.target.value)}
                            />
                          </label>
                        )}
                      </>
                    )}
                  </div>
                  {agentMode && (
                    <p className="hint">
                      {!s.paired
                        ? "Connect ReadyCode to chat with your cloud agents."
                        : agentError ||
                          (!catalogBusy && !agents.length
                            ? "No ReadyCode agents are available for this account. Check your OpenRouter key in ReadyCode AI setup."
                            : "Chat through ReadyCode. Your agent can search when the question needs web sources.")}{" "}
                      {s.paired && !catalogBusy && (
                        <>
                          <button onClick={() => reloadCatalog((n) => n + 1)}>
                            Refresh agents
                          </button>{" "}
                          <button
                            onClick={() => void run(() => api.open("aiSetup"))}
                          >
                            AI setup ↗
                          </button>
                        </>
                      )}
                    </p>
                  )}
                  {agentMode && roomMode && agents.length > 0 && (
                    <fieldset className="room-picker">
                      <legend>Choose who replies</legend>
                      {agents.map((a) => (
                        <label key={a.id} className="check">
                          <input
                            type="checkbox"
                            checked={chosenAgents.includes(a.id)}
                            disabled={
                              !chosenAgents.includes(a.id) &&
                              chosenAgents.length >= 8
                            }
                            onChange={(e) =>
                              setChosenAgents((ids) =>
                                e.target.checked
                                  ? [...ids, a.id]
                                  : ids.filter((id) => id !== a.id),
                              )
                            }
                          />
                          {a.name}
                        </label>
                      ))}
                      {agents.length <= 8 && (
                        <button
                          type="button"
                          onClick={() =>
                            setChosenAgents(agents.map((a) => a.id))
                          }
                        >
                          Select all
                        </button>
                      )}
                      <p className="hint">
                        {chosenAgents.length} selected. Each reply uses your
                        account’s provider key and has its own savings receipt.
                      </p>
                    </fieldset>
                  )}
                  <div className="attachment-row">
                    <input
                      ref={filePicker}
                      hidden
                      type="file"
                      multiple
                      accept={fileTypes}
                      aria-label="Attachments"
                      onChange={async (e) => {
                        const chosen = Array.from(e.currentTarget.files ?? []);
                        e.currentTarget.value = "";
                        if (!chosen.length) return;
                        const n = ++pickGeneration.current;
                        setReading(true);
                        setError("");
                        try {
                          const docs = [
                            ...documents,
                            ...chosen.filter((f) => isReaderFile(f.name)),
                          ];
                          if (
                            docs.length +
                              files.length +
                              chosen.filter((f) => !isReaderFile(f.name))
                                .length >
                            8
                          )
                            throw Error(
                              "Attach at most eight files per message.",
                            );
                          if (
                            docs.some((f) => !f.size) ||
                            docs.reduce((n, f) => n + f.size, 0) > readerLimit
                          )
                            throw Error(
                              "Choose nonempty Reader documents totaling up to 8 MiB.",
                            );
                          const next = await readAttachments(
                            chosen.filter((f) => !isReaderFile(f.name)),
                            files,
                          );
                          if (n === pickGeneration.current) {
                            setFiles(next);
                            setDocuments(docs);
                          }
                        } catch (err) {
                          if (n === pickGeneration.current)
                            setError(String((err as Error).message));
                        } finally {
                          if (n === pickGeneration.current) setReading(false);
                        }
                      }}
                    />
                    <button
                      disabled={working || reading || s.busy}
                      onClick={() => filePicker.current?.click()}
                    >
                      {reading ? "Reading…" : "Attach files"}
                    </button>
                    {documents.map((f, i) => (
                      <button
                        key={"doc" + i}
                        disabled={working || reading}
                        aria-label={"Remove " + f.name}
                        onClick={() =>
                          setDocuments(documents.filter((_, j) => j !== i))
                        }
                      >
                        {f.name} · Reader ×
                      </button>
                    ))}
                    {files.map((f, i) => (
                      <button
                        key={i}
                        disabled={working || reading}
                        aria-label={"Remove " + f.name}
                        onClick={() =>
                          setFiles(files.filter((_, j) => j !== i))
                        }
                      >
                        {f.name} ×
                      </button>
                    ))}
                  </div>
                  {documents.length > 0 && (
                    <p className="hint">
                      {draft.trim()
                        ? "Send uploads your documents and question to ReadyCode Reader."
                        : "Press Send for a cited summary, or type a question about the document."}
                      Reader checks candidate passages through the OpenRouter
                      key saved on your ReadyCode account. Only verified
                      excerpts go into the chat.
                    </p>
                  )}
                  {readerStatus && (
                    <p role="status">
                      Reading documents with ReadyCode…{" "}
                      <button
                        onClick={() => {
                          const id = activeReader.current;
                          activeReader.current = null;
                          if (id) void api.stopReader(id).catch(() => {});
                        }}
                      >
                        Stop reading
                      </button>
                    </p>
                  )}
                  {files.length > 0 && (
                    <small className="hint">
                      Sending includes the full file text in your ReadyCode chat
                      history.
                    </small>
                  )}
                  <div className="composer">
                    <textarea
                      aria-label="Message"
                      placeholder={
                        documents.length
                          ? documentQuestion
                          : agentMode
                            ? "Message your ReadyCode agent…"
                            : "Message ReadyCode…"
                      }
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          !e.shiftKey &&
                          !e.nativeEvent.isComposing
                        ) {
                          e.preventDefault();
                          if (agentMode ? canResearch : hasKey) void send();
                        }
                      }}
                    />
                    {s.busy ? (
                      <button onClick={() => void run(() => api.stop())}>
                        Stop
                      </button>
                    ) : agentMode ? (
                      <button
                        className="primary"
                        disabled={
                          !canResearch || !hasMessage || reading || working
                        }
                        onClick={() => void send()}
                      >
                        {roomMode
                          ? "Send to " +
                            chosenAgents.length +
                            (chosenAgents.length === 1 ? " agent" : " agents")
                          : "Send ↑"}
                      </button>
                    ) : hasKey ? (
                      <button
                        className="primary"
                        disabled={
                          !hasMessage ||
                          reading ||
                          working ||
                          !model.trim() ||
                          (compare && (!second.trim() || model === second))
                        }
                        onClick={() => void send()}
                      >
                        Send ↑
                      </button>
                    ) : (
                      <button className="primary" onClick={configure}>
                        Add key
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}
        <footer>
          <span>{agentMode ? "ReadyCode Agents" : model}</span>
          <span>
            <i className={hasKey ? "on" : ""} />
            {agentMode
              ? "Cloud credentials"
              : hasKey
                ? "Key on this computer"
                : "No local key"}
          </span>
          <span>
            <i className={s.verified && !s.syncError ? "on" : ""} />
            {s.syncError
              ? "Sync pending"
              : s.verified
                ? "Cloud connected"
                : s.paired
                  ? "Token saved"
                  : "Unpaired"}
          </span>
        </footer>
      </main>
      <datalist id="models">
        {presets[p].filter(Boolean).map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
