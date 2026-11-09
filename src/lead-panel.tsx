import React, { useEffect, useState } from "react";
const api = window.companion;
export function LeadPanel({
  room,
}: {
  room?: import("./types").Chat;
}) {
  const [project, setProject] = useState(""),
    [goal, setGoal] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const [result, setResult] =
    useState<Awaited<ReturnType<typeof api.leadGoal>>>();
  const [ide, setIDE] = useState<Awaited<ReturnType<typeof api.ideSetup>>>();
  const [client, setClient] = useState("Codex");
  const [policy, setPolicy] = useState<"auto" | "solo" | "two">("auto");
  const [hosts, setHosts] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let live = true;
    api
      .detectHosts()
      .then((found) => {
        if (live) {
          setHosts(found);

        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => api.leadProgress(setStatus), []);
  const [connected, setConnected] = useState(false);
  const [shared, setShared] = useState<string>();
  const [registered, setRegistered] = useState(false);
  useEffect(() => {
    if (!ide) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const state = await api.ideStatus();
        const folder = await api.ideProject();
        if (!live) return;
        setProject(folder);
        setConnected(!!folder && state !== "waiting" && state !== "disabled");
        if (state === "disabled") { setIDE(undefined); return; }
      } catch { /* Retry while setup is open. */ }
      if (live) timer = setTimeout(poll, 1500);
    }
    void poll();
    return () => { live = false; clearTimeout(timer); };
  }, [ide]);
  useEffect(() => () => { void api.disconnectIDE().catch(() => {}); }, []);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setStatus("");
    try {
      await fn();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const active = registered && shared === room?.id;
  const [pendingToggle, setPendingToggle] = useState<boolean>();
  async function toggle(enable: boolean) {
    if (!enable) {
      await api.disconnectIDE();
      setIDE(undefined);
      setRegistered(false);
      setConnected(false);
      setShared(undefined);
      setStatus("Disconnected.");
      return;
    }
    try {
      if (!registered || !ide) {
        setIDE(await api.ideSetup());
        if (client === "Codex") await api.registerCodex();
        if (client === "Cursor") await api.registerCursor();
      }
      if (room?.roomId && !room.cloudUnavailable) {
        await api.shareIDERoom(room.id);
        setStatus("Room prompt copied. Keep Companion open and paste into a new " + client + " chat.");
      } else {
        setStatus("IDE access enabled. Open a saved chat to share its discussion.");
      }
      setRegistered(true);
      setShared(room?.id);
    } catch (error) {
      await api.disconnectIDE();
      setRegistered(false);
      setIDE(undefined);
      throw error;
    }
  }
  return (
    <section className="ide-inline">
      <label className="ide-toggle">
        <input type="checkbox" checked={pendingToggle ?? active} disabled={busy}
          onChange={event => {
            const enabled = event.target.checked;
            setPendingToggle(enabled);
            void act(() => toggle(enabled)).finally(() => setPendingToggle(undefined));
          }}/>
        Connect to {client}
      </label>
      <span role="status">{pendingToggle === true ? "Connecting…" : pendingToggle === false ? "Disconnecting…" : status}</span>
      <details className="ide-options"><summary>IDE options</summary><label>Host
        <select
          aria-label="IDE setup"
          disabled={busy || registered} value={client}
          onChange={(e) => setClient(e.target.value)}
        >
          {["Codex", "Cursor", "Local model host"].map((c) => (
            <option key={c} value={c}>
              {c}
              {hosts[c] ? " · detected" : ""}
            </option>
          ))}
        </select>
      </label>
      {(project || ide) && (
        <>
          {ide && (
            <div>
              <details open={client === "Local model host" || undefined}><summary>Connection settings</summary>
              {connected && <p>Connected to {project}</p>}
              {!connected && <p>For local coding, send this in your IDE and confirm the folder:<br/>
                <code>Use the readycode-companion project tool to connect this workspace.</code></p>}
              <details open={client === "Local model host" || undefined}><summary>Manual setup</summary>
                <p>Install Node.js 22 or newer. {client === "Codex" ? "Run this command, then open a new chat." : "Add this server in your host’s MCP settings."}</p>
                <pre style={{whiteSpace:"pre-wrap"}}>{client === "Codex" ?
                  `codex mcp add readycode-companion -- node "${ide.script}" "${ide.descriptor}"` :
                  JSON.stringify({mcpServers:{"readycode-companion":{command:"node",args:[ide.script,ide.descriptor]}}},null,2)}</pre>
              </details>
              </details>
            </div>
          )}
          {project && <details><summary>Run a coding goal</summary><p>{project}</p>
          <label>
            Goal{" "}
            <input
              value={goal}
              maxLength={4000}
              disabled={busy}
              onChange={(e) => setGoal(e.target.value)}
            />
          </label>

          <button
            disabled={busy || !project || !goal.trim()}
            onClick={() =>
              act(async () => {
                setResult(undefined);
                setResult(await api.leadGoal(goal, policy));
              })
            }
          >
            Run coding goal
          </button>
          <label>
            {" "}
            Cloud help{" "}
            <select
              value={policy}
              onChange={(e) => setPolicy(e.target.value as typeof policy)}
            >
              <option value="auto">Local first · escalate if needed</option>
              <option value="solo">Lead only</option>
              <option value="two">Require two specialists</option>
            </select>
          </label>
          </details>}
        </>
      )}

      <details><summary>Local project</summary><button
        disabled={busy}
        onClick={() =>
          act(async () => {
            const p = await api.connectProject();
            if (p) {
              setProject(p);
              setIDE(undefined);
              setResult(undefined);
            }
          })
        }
      >
        Choose project manually
      </button></details>

      {result && (
        <>
          <p>{result.branch}</p>
          <pre
            style={{ whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}
          >
            {result.report}
          </pre>
          <details>
            <summary>Review changes</summary>
            <pre style={{ maxHeight: 240, overflow: "auto" }}>
              {result.diff || "No changes"}
            </pre>
          </details>
          <button
            disabled={busy || !result.diff}
            onClick={() =>
              act(async () => {
                const hash = await api.saveLead();
                setStatus(
                  "Saved local commit " + hash + " on " + result.branch,
                );
                setResult(undefined);
              })
            }
          >
            Keep as local commit
          </button>
        </>
      )}
    </details>
    </section>
  );
}
