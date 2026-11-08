import React, { useEffect, useState } from "react";
const api = window.companion;
export function LeadPanel() {
  const [project, setProject] = useState(""),
    [goal, setGoal] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const [result, setResult] =
    useState<Awaited<ReturnType<typeof api.leadGoal>>>();
  const [ide, setIDE] = useState<Awaited<ReturnType<typeof api.ideSetup>>>();
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
    <details>
      <summary>Coding goals · Local Codex lead</summary>
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
          {!ide && (
            <button
              disabled={busy}
              onClick={() => act(async () => setIDE(await api.ideSetup()))}
            >
              Enable Codex / Cursor MCP access
            </button>
          )}
          {ide && (
            <div>
              <p>
                With Node.js installed, register Companion in Codex or add the
                JSON below to Cursor’s MCP settings. Start a new IDE session in
                the same project and ask it to use readycode-companion for your
                goal.
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
