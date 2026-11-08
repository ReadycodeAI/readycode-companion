const official = process.env.READYCODE_OFFICIAL_RELEASE === "1";
const repository = process.env.GITHUB_REPOSITORY || "";
const publisher = process.env.READYCODE_SIGNING_PUBLISHER?.trim();
if (official && (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !publisher ||
    !process.env.READYCODE_API_BASE || !process.env.READYCODE_PUBLIC_KEY))
  throw Error("Official builds need the GitHub repository, certificate publisher and ReadyCode public configuration.");
const [owner, repo] = repository.split("/");
const azureAccount = process.env.AZURE_SIGNING_ACCOUNT;
const azureProfile = process.env.AZURE_SIGNING_PROFILE;
const azureEndpoint = process.env.AZURE_SIGNING_ENDPOINT;
if (official && azureAccount && (!azureProfile || !azureEndpoint?.startsWith("https://")))
  throw Error("Azure signing requires a profile and its regional HTTPS signing endpoint.");
module.exports = {
  appId: "ai.readycode.companion",
  productName: "ReadyCode Companion",
  electronDist: require("node:path").dirname(require("electron")),
  directories: { output: "release/windows" },
  files: ["dist/**/*", "package.json"],
  extraResources: [{from:"scripts/ide-mcp.cjs",to:"ide-mcp.cjs"}],
  forceCodeSigning: official,
  publish: official ? [{provider: "github", owner, repo}] : null,
  win: {
    target: [{target: "nsis", arch: ["x64"]}],
    icon: "assets/readycode.ico",
    ...(official && (azureAccount
      ? {azureSignOptions: {publisherName: publisher, codeSigningAccountName: azureAccount,
          certificateProfileName: azureProfile, endpoint: azureEndpoint}}
      : {signtoolOptions: {publisherName: [publisher]}})),
  },
  nsis: {
    oneClick: true, perMachine: false, deleteAppDataOnUninstall: false,
    artifactName: "ReadyCode-Companion-Setup-x64.exe",
  },
};
