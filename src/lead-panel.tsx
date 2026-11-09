import React, { useEffect, useState } from "react";
const api = window.companion;
export function LeadPanel({
  panelRef,
}: {
  panelRef: React.Ref<HTMLDetailsElement>;
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
          setClient(Object.keys(found).find((k) => found[k]) ?? "Codex");
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => api.leadProgress(setStatus), []);
  const [connected, setConnected] = useState(false);
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
  return (
    <details className="lead-setup" ref={panelRef}>
      <summary>Coding goals · Connect your local lead</summary>
      <p>
        Connect your IDE first. When it shares its open Git project, Companion
        shows the path for you to confirm.
      </p>
      <label>
        IDE or model host{" "}
        <select
          aria-label="IDE setup"
          disabled={busy || !!ide} value={client}
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
      <button
        disabled={busy}
        onClick={() =>
          act(async () => {
            setRegistered(false); setConnected(false); if (!ide) setIDE(await api.ideSetup());
            if (client === "Codex") {
              await api.registerCodex();
              setStatus("Registered. Start a new Codex chat in your project.");
            } else if (client === "Cursor") {
              await api.registerCursor();
              setStatus("Confirm installation in Cursor.");
            } else setStatus("Add the server below in your local model host.");
            setRegistered(true);
          })
        }
        hidden={!!ide && registered}
      >
        {busy ? "Connecting…" : "Connect " + client}
      </button>
      <details><summary>Choose a project manually</summary><button
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
      {(project || ide) && (
        <>
          {ide && (
            <div>
              <p role="status">{connected ? "Connected to " + project :
                client === "Cursor" ? "Confirm the install in Cursor, then open a chat in your project." :
                client === "Codex" ? "After registration, open a new Codex chat in your project." :
                "Add the server below to your local model host."}</p>
              {!connected && <p>Send this in your IDE, then confirm the folder in Companion:<br/>
                <code>Use the readycode-companion project tool to connect this workspace.</code></p>}
              <details open={client === "Local model host" || undefined}><summary>Manual setup</summary>
                <p>Install Node.js 22 or newer. {client === "Codex" ? "Run this command, then open a new chat." : "Add this server in your host’s MCP settings."}</p>
                <pre style={{whiteSpace:"pre-wrap"}}>{client === "Codex" ?
                  `codex mcp add readycode-companion -- node "${ide.script}" "${ide.descriptor}"` :
                  JSON.stringify({mcpServers:{"readycode-companion":{command:"node",args:[ide.script,ide.descriptor]}}},null,2)}</pre>
              </details>
              <button
                onClick={() =>
                  act(async () => {
                    await api.disconnectIDE();
                    setIDE(undefined);
                  })
                }
              >
                Disconnect IDE access
              </button>
            </div>
          )}
          {project && <>          <p>{project}</p>
          <label>
            Goal{" "}
            <input
              value={goal}
              maxLength={4000}
              disabled={busy}
              onChange={(e) => setGoal(e.target.value)}
            />
          </label>
</>}
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
        </>
      )}
      <p role="status">{status}</p>
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
  );
}
