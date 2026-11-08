import { cp, mkdir, rename, writeFile, rm, readdir } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const executable = require("electron");
let app, target;
async function requireFreshDirectory(path) {
  await mkdir(path, { recursive: true });
  if ((await readdir(path)).length)
    throw Error(
      "Package into an empty directory so old files cannot ship with the app.",
    );
}
if (process.platform === "win32") {
  target = resolve(process.argv[2] || "release/ReadyCode Companion");
  await requireFreshDirectory(target);
  await cp(dirname(executable), target, { recursive: true });
  const { rcedit } = await import("rcedit");
  await rcedit(join(target, "electron.exe"), {
    icon: resolve("assets/readycode.ico"),
    "version-string": {
      ProductName: "ReadyCode Companion",
      FileDescription: "ReadyCode Companion",
    },
  });
  await rename(
    join(target, "electron.exe"),
    join(target, "ReadyCode Companion.exe"),
  );
  app = join(target, "resources", "app");
} else if (process.platform === "darwin") {
  target = resolve(process.argv[2] || "release/ReadyCode Companion.app");
  await mkdir(dirname(target), { recursive: true });
  await requireFreshDirectory(target);
  execFileSync("/usr/bin/ditto", [
    resolve(dirname(executable), "../../"),
    target,
  ]);
  const plist = join(target, "Contents", "Info.plist");
  for (const [name, value] of Object.entries({
    CFBundleName: "ReadyCode Companion",
    CFBundleDisplayName: "ReadyCode Companion",
    CFBundleIdentifier: "ai.readycode.companion",
  })) {
    execFileSync("/usr/bin/plutil", [
      "-replace",
      name,
      "-string",
      value,
      plist,
    ]);
  }
  app = join(target, "Contents", "Resources", "app");
} else throw Error("Build the portable edition on Windows or macOS.");
await mkdir(app, { recursive: true });
await cp("dist", join(app, "dist"), { recursive: true });
await writeFile(
  join(app, "package.json"),
  JSON.stringify({
    name: "readycode-companion",
    productName: "ReadyCode Companion",
    version: require("../package.json").version,
    main: "dist/main.cjs",
  }),
);
if (process.platform === "darwin") {
  await rm(join(dirname(app), "default_app.asar"), { force: true });
  execFileSync("/usr/bin/codesign", [
    "--force",
    "--deep",
    "--sign",
    "-",
    target,
  ]);
}
console.log(target);
