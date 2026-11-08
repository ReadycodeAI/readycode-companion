# Coding goals pilot

Pair Companion, open **Coding goals · Local Codex lead**, and choose a trusted Git project. The built-in lead starts from the selected HEAD in a separate worktree. Uncommitted changes in the original checkout are outside that snapshot. Install and sign in to the Codex CLI, enter a goal, and select **Run coding goal**. The default starts with the lead and consults at most one specialist for an independent review or unresolved verification failure. **Lead only** disables specialist dispatch. **Require two specialists** runs the explicit team pilot. A locally launched Codex CLI usually uses its configured inference provider. Review the report, test evidence and diff before choosing **Keep as local commit**. The commit is on the displayed local goal branch. Building dependencies and running tests in a fresh worktree depends on your local environment.

For an external IDE, install Node.js and open **IDE & MCP setup** in the sidebar. Companion checks known installation locations and PATH for available hosts. Pick Codex or Cursor and click **Connect**. Codex registers its MCP server; Cursor opens its MCP installation prompt. Start a new IDE session in your project and call **project**. Companion uses the IDE workspace root when available, or the lead can supply its current checkout. Confirm the displayed repository path once. The manual picker is optional. Other MCP-capable hosts can use the displayed configuration. Start a new IDE session and tell its lead to use readycode-companion. Re-enable project access in Companion after a restart. The local adapter connects to the running paired desktop app. Keep its session descriptor private.

| MCP tool | Purpose |
| --- | --- |
| project | Verify the local checkout and list recent goals for this account and project. |
| roadmap | Read or update the concise local plan, including checks, accepted changes, blockers and next steps. |
| start_goal | Create a goal ID for the project. Keep this ID to resume. |
| dispatch | Inspect Git paths and get a local routing recommendation. Supply an observed blocker when requesting escalation. |
| agents | Discover cloud specialists available to that goal. |
| assignment | Send a task to one agent. Reuse its request UUID on retry. Optional depends_on references explicitly saved handoffs. |
| results | Poll one assignment by request UUID for its reply, run status and receipt. |
| handoff | Store a short lead-checked result and Git revision on this device for future dependent jobs. |

For a local Llama, Qwen or other tool-capable model, select **Local model host** in setup. Enable the displayed stdio server in a coding host that supports MCP and local file and shell tools. A local model server such as Ollama supplies inference; its host executes requested tool calls. Every MCP session receives the same lead instructions during initialization. Call **project**, then use **Check IDE connection** in Companion to verify the selected folder. Read the existing roadmap before starting new work. Once configured, give the goal in plain language and let the lead pick specialists.

The cloud room keeps the assignments and replies. A local handoff is included in subsequent cloud input when the lead declares the dependency. The existing cloud chat route can also include room history. Per-worker filtering of that history requires backend support. Usage receipts cover ReadyCode-dispatched requests. External IDE model calls follow the IDE's provider configuration.

The pilot uses one active project connection. To test locally using an unconfigured development build, run `npm run build`, then `node tests/coding-goal.mjs`. This exercises a full Electron restart, agent fallback, addressed assignments and the stdio bridge with a simulated account.
