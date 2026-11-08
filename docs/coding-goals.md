# Coding goals pilot

Pair Companion, open **Coding goals · Local Codex lead**, and choose a trusted Git project. The built-in lead starts from the selected HEAD in a separate worktree. Uncommitted changes in the original checkout are outside that snapshot. Install and sign in to the Codex CLI, enter a goal, and select **Run goal with two agents**. Codex chooses two distinct account agents and assigns them separate tasks sequentially in the same ReadyCode room. Review the report, test evidence and diff before choosing **Keep as local commit**. The commit is on the displayed local goal branch. Building dependencies and running tests in a fresh worktree depends on your local environment.

For an external IDE, install Node.js, choose the same project, then select **Enable Codex / Cursor MCP access**. For Codex choose **Register in Codex**. For Cursor add the displayed server entry to its MCP settings. Start a new IDE session and tell its lead to use readycode-companion. Re-enable project access in Companion after a restart. The local adapter connects to the running paired desktop app. Keep its session descriptor private.

| MCP tool | Purpose |
| --- | --- |
| project | Check which local checkout was selected. |
| start_goal | Create a goal ID for the project. Keep this ID to resume. |
| agents | Discover cloud specialists available to that goal. |
| assignment | Send a task to one agent. Reuse its request UUID on retry. Optional depends_on references explicitly saved handoffs. |
| results | Poll one assignment by request UUID for its reply, run status and receipt. |
| handoff | Store a short lead-checked result and Git revision on this device for future dependent jobs. |

The cloud room keeps the assignments and replies. A local handoff is included in subsequent cloud input when the lead declares the dependency. The existing cloud chat route can also include room history. Per-worker filtering of that history requires backend support. Usage receipts cover ReadyCode-dispatched requests. External IDE model calls follow the IDE's provider configuration.

The pilot uses one active project connection. To test locally using an unconfigured development build, run `npm run build`, then `node tests/coding-goal.mjs`. This exercises a full Electron restart, agent fallback, addressed assignments and the stdio bridge with a simulated account.
