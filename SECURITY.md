# Security

Report security issues privately to the repository maintainers through GitHub private vulnerability reporting when available. Omit provider keys, device tokens and chat transcripts from reports.

The main process owns credentials, provider requests and external links. The renderer has no Node access and cannot fetch remote code. A cloud room URL must belong to the exact HTTPS origin readycode.ai. Custom provider credentials are cleared before changing their destination.

Local transcript caches are ordinary per-user files. Protect the OS account and device. Cloud provider credentials are managed only on readycode.ai.

