# Security

Report security issues privately to the repository maintainers through GitHub private vulnerability reporting when available. Omit provider keys, device tokens and chat transcripts from reports.

The main process owns credentials, provider requests and external links. The renderer has no Node access and cannot fetch remote code. A cloud room URL must belong to the exact HTTPS origin readycode.ai. Custom provider credentials are cleared before changing their destination.

Local transcript caches are ordinary per-user files. Protect the OS account and device. Cloud provider credentials are managed only on readycode.ai.

## Desktop and cloud

The MIT license covers the desktop software distributed in this repository. The hosted service has its own implementation. This repository includes the client-side protocol needed to connect to it. Members using direct-provider mode can inspect the compacted context sent to their provider. Treat service addresses, request formats, publishable keys and public receipts as visible to clients.

Keep cloud compaction rules, private agent instructions, worker source, operational logs and deployment credentials in their respective private projects. Enforce account access and quotas on the server for every client, including modified clients. Return only the fields needed to display results, including when fetching older receipts from history.

Official Windows releases are built under the ReadycodeAI GitHub account. A fork can distribute its own builds. The ReadyCode name and logo identify the project, and use of the desktop code does not imply endorsement by ReadyCode.

