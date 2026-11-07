import { build } from "esbuild";
import { mkdir, cp } from "node:fs/promises";
import { build as bundleRenderer } from "vite";
import tailwind from "tailwindcss";
const cloudAddress = process.env.READYCODE_API_BASE || "";
const cloudKey = process.env.READYCODE_PUBLIC_KEY || "";
if (cloudAddress || cloudKey) {
  const url = new URL(cloudAddress);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("Use a public HTTPS address for the ReadyCode service.");
  let isPublic = /^sb_publishable_[a-zA-Z0-9_-]+$/.test(cloudKey);
  if (!isPublic && /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(cloudKey)) {
    const claims = JSON.parse(Buffer.from(cloudKey.split(".")[1], "base64url"));
    isPublic = claims.role === "anon";
  }
  if (!isPublic)
    throw Error(
      "Supply only a publishable key or legacy anon key for a configured desktop build.",
    );
}
await bundleRenderer({
  root: "src",
  base: "./",
  css: {
    postcss: { plugins: [tailwind({ config: "./tailwind.config.cjs" })] },
  },
  build: { outDir: "../dist", emptyOutDir: true },
});
await Promise.all(
  ["main", "preload"].map((name) =>
    build({
      entryPoints: ["src/" + name + ".ts"],
      bundle: true,
      platform: "node",
      external: ["electron"],
      define: {
        "process.env.READYCODE_PUBLIC_KEY": JSON.stringify(
          process.env.READYCODE_PUBLIC_KEY || "",
        ),
        "process.env.READYCODE_API_BASE": JSON.stringify(
          process.env.READYCODE_API_BASE || "",
        ),
      },
      outfile: "dist/" + name + ".cjs",
    }),
  ),
);
await cp("assets/readycode.png", "dist/readycode.png");
