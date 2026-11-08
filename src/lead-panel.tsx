import React, { useEffect, useState } from "react";
const api = window.companion;
export function LeadPanel({panelRef}:{panelRef:React.Ref<HTMLDetailsElement>}) {
  const [project, setProject] = useState(""),
    [goal, setGoal] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const [result, setResult] =
    useState<Awaited<ReturnType<typeof api.leadGoal>>>();
  const [ide, setIDE] = useState<Awaited<ReturnType<typeof api.ideSetup>>>();
  const [client, setClient] = useState("Codex");
  useEffect(() => api.leadProgress(setStatus), []);
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
      {!project && (
        <p>
          Select your IDE or local model host. Setup will ask for the Git folder you want it to work on.
        </p>
      )}
      <label>IDE or model host{" "}
        <select aria-label="IDE setup" value={client} onChange={e=>setClient(e.target.value)}>
          <option>Codex</option><option>Cursor</option><option>Local model host</option>
        </select>
      </label>
      {!ide && <button disabled={busy} onClick={()=>act(async()=>{
        if(!project){
          const p=await api.connectProject();
          if(!p)return;
          setProject(p);
        }
        setIDE(await api.ideSetup());
      })}>Set up {client} connection</button>}
      <button
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
        Choose project folder
      </button>
      {project && (
        <>
          <p>{project}</p>
          <label>
            Goal{" "}
            <input
              value={goal}
              maxLength={4000}
              disabled={busy}
              onChange={(e) => setGoal(e.target.value)}
            />
          </label>
          <p>
            Run the signed-in Codex CLI as lead, or enable IDE access and give
            the goal to your open Codex or Cursor session. Cloud assignments and
            replies are saved in ReadyCode. The IDE uses its own account for its
            other calls.
          </p>
          {ide && (
            <div>
              <p>
                1. Install Node.js 22 or newer on this computer and open the
                selected folder in {client}.
              </p>
              {client === "Codex" ? (
                <>
                  <p>
                    2. Sign in to the Codex CLI, then register Companion using
                    the button. You can also run the command below yourself.
                  </p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await api.registerCodex();
                        setStatus(
                          "Registered. Start a new Codex session in this project.",
                        );
                      })
                    }
                  >
                    Register in Codex
                  </button>
                  <pre
                    style={{ whiteSpace: "pre-wrap" }}
                  >{`codex mcp add readycode-companion -- node "${ide.script}" "${ide.descriptor}"`}</pre>
                </>
              ) : (
                <>
                  <p>
                    {client === "Cursor"
                      ? "2. Open Cursor Settings → MCP (Tools & MCP in some versions)."
                      : "2. In your coding host, select a local model that supports tools (for example via Ollama). The host must support MCP stdio and provide local file and test tools."}{" "}
                    Add a custom stdio server using the command and arguments
                    below. Merge the entry into your host’s configuration and
                    enable readycode-companion.
                  </p>
                  <pre style={{ whiteSpace: "pre-wrap" }}>
                    {JSON.stringify(
                      {
                        mcpServers: {
                          "readycode-companion": {
                            command: "node",
                            args: [ide.script, ide.descriptor],
                          },
                        },
                      },
                      null,
                      2,
                    )}
                  </pre>
                </>
              )}
              <p>
                3. Start a new {client} chat. Send the prompt below and approve
                the project tool if asked. The returned path should match the
                folder above.
              </p>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                Use readycode-companion’s project tool and show me the connected
                folder and any recent coding goals. Read the roadmap before
                starting new work.
              </pre>
              <button
                onClick={() =>
                  act(async () => {
                    const state = await api.ideStatus();
                    setStatus(
                      state === "waiting"
                        ? "Waiting for the IDE to call the project tool. Check the server is enabled, Node is on PATH, and the tool call is approved."
                        : state === "disabled"
                          ? "IDE access is disabled."
                          : "Project tool reached Companion at " +
                            new Date(state).toLocaleTimeString(),
                    );
                  })
                }
              >
                Check IDE connection
              </button>
              <p>4. Give your goal to the IDE. For example:</p>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                Remember my preferred AI after restarting Companion. Lead this
                locally. Use readycode-companion to give each cloud specialist a
                distinct assignment, check their replies, run the restart test
                and show me the diff before committing.
              </pre>
              <p>
                Keep Companion open. After restarting it, choose the folder and
                enable IDE access again. The IDE registration can be reused.
              </p>
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
          <button
            disabled={busy || !goal.trim()}
            onClick={() =>
              act(async () => {
                setResult(undefined);
                setResult(await api.leadGoal(goal));
              })
            }
          >
            Run goal with two agents
          </button>
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
