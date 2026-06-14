import { build } from "bun";
import { copyFile, cp, mkdir } from "fs/promises";
import { existsSync } from "fs";

const DIST = "dist";

async function run(): Promise<void> {
  console.log("🔨 Bundling TypeScript…");

  await mkdir(DIST, { recursive: true });

  const result = await build({
    entrypoints: ["src/main.ts"],
    outdir: DIST,
    target: "browser",
    format: "esm",
    minify: true,
    sourcemap: "external",
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
  });

  if (!result.success) {
    console.error("Build failed:");
    result.logs.forEach((l) => console.error(l));
    process.exit(1);
  }

  console.log("📄 Copying static assets…");

  // HTML + CSS
  await copyFile("index.html", `${DIST}/index.html`);
  await copyFile("style.css", `${DIST}/style.css`);

  // Database file
  if (existsSync("db/etymap.db")) {
    await mkdir(`${DIST}/db`, { recursive: true });
    await copyFile("db/etymap.db", `${DIST}/db/etymap.db`);
    console.log("  ✓ db/etymap.db");
  } else {
    console.warn("  ⚠ db/etymap.db not found — place it at db/etymap.db before deploying");
  }

  console.log(`✅ Build complete → ${DIST}/`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
