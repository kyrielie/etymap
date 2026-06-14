/**
 * dev.ts — lightweight dev server for Etymap
 *
 * Serves the project root so that:
 *   - index.html is at http://localhost:3000/
 *   - style.css is at http://localhost:3000/style.css
 *   - db/etymap.db is at http://localhost:3000/db/etymap.db  ← critical
 *   - src/main.ts (and imports) are bundled on-the-fly via Bun
 *
 * Usage: bun run dev.ts
 */

import { existsSync } from "fs";
import { join, extname } from "path";

const ROOT = import.meta.dir;
const PORT = 3000;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".ts": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  // CRITICAL: SQLite binary must not be served as text
  ".db": "application/octet-stream",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let pathname = url.pathname;

    // Default to index.html
    if (pathname === "/" || pathname === "") pathname = "/index.html";

    // TypeScript entry — bundle on the fly
    if (pathname === "/main.js") {
      const result = await Bun.build({
        entrypoints: [join(ROOT, "src/main.ts")],
        target: "browser",
        format: "esm",
        sourcemap: "inline",
      });
      if (!result.success) {
        const errors = result.logs.map((l) => l.message).join("\n");
        return new Response(`// Build error:\n${errors}`, {
          status: 500,
          headers: { "Content-Type": "application/javascript" },
        });
      }
      const output = await result.outputs[0].text();
      return new Response(output, {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }

    // Static file
    const filePath = join(ROOT, pathname);
    if (!existsSync(filePath)) {
      return new Response(`404: ${pathname} not found\n\nLooked at: ${filePath}`, {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const ext = extname(pathname).toLowerCase();
    const contentType = MIME[ext] ?? "application/octet-stream";

    const file = Bun.file(filePath);
    return new Response(file, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
        // Allow sql.js WASM to load cross-origin
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
    });
  },
});

console.log(`\n  Etymap dev server running at http://localhost:${PORT}\n`);

// Warn if db is missing
const dbPath = join(ROOT, "db/etymap.db");
if (!existsSync(dbPath)) {
  console.warn(`  ⚠  db/etymap.db not found at ${dbPath}`);
  console.warn(`     Place etymap.db in the db/ directory.\n`);
} else {
  const size = (await Bun.file(dbPath).arrayBuffer()).byteLength;
  console.log(`  ✓  db/etymap.db found (${(size / 1024).toFixed(0)} KB)`);
  console.log(`     Serving at http://localhost:${PORT}/db/etymap.db\n`);
}
