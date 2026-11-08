import { app } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AppUpdater } from "electron-updater";

const preview = process.env.READYCODE_PREVIEW_RELEASE === "1" && process.env.READYCODE_OFFICIAL_RELEASE !== "1";
const managedWindows = process.platform === "win32" && app.isPackaged &&
  (preview || process.env.READYCODE_OFFICIAL_RELEASE === "1");
let updater: AppUpdater | undefined;
export let updateMessage = "";
export let updateReady = false;
export function startUpdates(notify: () => void) {
  if (!managedWindows || !existsSync(join(process.resourcesPath, "app-update.yml"))) return;
  // Portable builds ship without updater dependencies.
  updater = require("electron-updater").autoUpdater as AppUpdater;
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;
  updater.allowPrerelease = preview;
  const report = (text: string) => { updateMessage = text; notify(); };
  updater.on("checking-for-update", () => report("Checking for updates…"));
  updater.on("update-not-available", () => report("You have the latest version."));
  updater.on("update-available", info => report("Downloading version " + info.version + "…"));
  updater.on("error", () => report("Update check or download failed. Try again in Settings."));
  updater.on("update-downloaded", info => {
    updateReady = true;
    report("Version " + info.version + " is ready to install.");
  });
  checkUpdates();
  setInterval(checkUpdates, 4 * 60 * 60 * 1000).unref();
}
export function checkUpdates() {
  if (updater && !updateReady)
    void updater.checkForUpdates().then(result => result?.downloadPromise)
      .catch(() => { /* error event updates Settings */ });
}
export function installUpdate() {
  if (!updater || !updateReady) throw Error("No downloaded update is ready.");
  updater.quitAndInstall(false, true);
}
