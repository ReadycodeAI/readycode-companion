# Windows releases

The x64 Windows installer uses the current Windows account. It shares the portable build’s Electron product name, app ID and existing profile. Close the portable program before opening the installed copy. Chats, device pairing and provider credentials stay under the same Windows profile. Credentials are protected with Electron safeStorage. Keep using the same ReadyCode service address. A revoked device or a changed service address can require pairing again.

Run `npm ci` and `npm run installer` on Windows for an unsigned test installer under `release/windows`. Local builds use manual updates. Signed stable installers follow stable releases. Starting with 1.0.3, published Windows preview installers also check the official GitHub repository for updates, including prereleases. Checks run on launch, every four hours and from Settings. After a new installer downloads, choose **Restart to update**. **Restart Companion** in Settings restarts the current version. Finish local coding jobs, Reader and active turns before restarting.

For each unsigned Windows preview with automatic updates, increment package.json and package-lock.json, set `READYCODE_PREVIEW_RELEASE=1` together with the public pairing configuration (`READYCODE_API_BASE` and `READYCODE_PUBLIC_KEY`), and run `npm run installer`. Publish a GitHub prerelease tagged `preview-windows-X.Y.Z` from that commit. Attach the installer, its matching `.exe.blockmap`, and `latest.yml` to the draft before publishing. Verify the installer's SHA-512 against the generated manifest and include the SHA-256 in the release notes. Preview installers up to and including 1.0.2 need a one-time manual install of 1.0.3 or later.

The official repository has a GitHub Actions environment named `windows-release`. It allows `v*` tags and already contains `READYCODE_API_BASE` and the publishable `READYCODE_PUBLIC_KEY`. Limit write access and release tag creation to trusted maintainers.

### Set up Microsoft Artifact Signing

1. In the Azure portal, choose the subscription for the publisher, register the `Microsoft.CodeSigning` resource provider, and create an **Artifact Signing account**. Review the subscription pricing before creating it. Record the account name and its regional signing endpoint. [Microsoft setup guide](https://learn.microsoft.com/azure/artifact-signing/quickstart)
2. Open **Identity validation**, choose **Public Trust**, and submit the publisher's legal entity details directly to Microsoft. After approval, create a **Public Trust** certificate profile linked to that identity. Record the profile name and the publisher common name exactly as issued.
3. In Microsoft Entra ID, create an app registration for the release workflow. Record its application (client) ID, directory (tenant) ID and the Azure subscription ID. Add a federated credential with issuer `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange` and the environment subject below. Use a custom subject if the portal's GitHub preset generates a different string. [GitHub subject formats](https://docs.github.com/en/actions/reference/security/oidc)

   `repo:ReadycodeAI@335802918/readycode-companion@1449878351:environment:windows-release`

4. Grant the app's service principal the **Artifact Signing Certificate Profile Signer** role scoped to this certificate profile. [Microsoft role instructions](https://learn.microsoft.com/azure/artifact-signing/tutorial-assign-roles)
5. In GitHub repository **Settings → Environments → windows-release → Environment variables**, add `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`, `AZURE_SIGNING_ENDPOINT`, and `READYCODE_SIGNING_PUBLISHER`. Use the HTTPS signing endpoint for the account region. Azure holds the signing key. The release job uses GitHub OIDC to sign in to Azure.

For a publisher that already holds a supported signing PFX, leave the Azure signing variables unset, configure the publisher name and supply the PFX through the environment secrets `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`.

Bump package.json and its lockfile together (for example `npm version patch --no-git-tag-version`). Push the reviewed commit and matching stable tag, such as `v1.0.1`. Actions creates a draft with a signed installer, block map and latest.yml. Publish all three assets together as the latest stable release. Keep the stable download filename and app identity across releases. GitHub then serves the download page and installed clients from the same release.

Before public rollout, install version A in a Windows test account, pair it, create a synced chat and a local provider key. Publish higher version B to a release-test repository configured with the same signing publisher. On A, check for updates, finish an active turn and choose Restart to update. Check the version in Settings, send in the old chat, verify the same pairing and provider key work, and confirm the cloud room and receipts persist. Also test a network failure and a wrong-signer installer in that test repository.
