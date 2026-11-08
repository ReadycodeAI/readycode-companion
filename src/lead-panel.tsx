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
          value={client}
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
            setIDE(await api.ideSetup());
            if (client === "Codex") {
              await api.registerCodex();
              setStatus("Registered. Start a new Codex chat in your project.");
            } else if (client === "Cursor") {
              await api.registerCursor();
              setStatus("Confirm installation in Cursor.");
            } else setStatus("Add the server below in your local model host.");
          })
        }
      >
        Connect {client}
      </button>
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
        Choose project manually
      </button>
      {(project || ide) && (
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
                    If automatic registration failed, sign in to the Codex CLI
                    and retry using the button. You can also run the command
                    below yourself.
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
                Start a new {client} chat, send this prompt and confirm the
                proposed project in Companion.
              </p>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                Call the readycode-companion project tool with workspace set to
                my current Git checkout. Show recent goals and read the roadmap
                before starting new work.
              </pre>
              <button
                onClick={() =>
                  act(async () => {
                    const state = await api.ideStatus();
                    setProject(await api.ideProject());
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
                Keep Companion open. After restarting it, reconnect your host
                here.
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
