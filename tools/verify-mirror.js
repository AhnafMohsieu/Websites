"use strict";
// Verify that every local reference inside a mirror resolves on disk.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(process.argv[2]);
const stats = { html: 0, refs: 0, missing: new Map(), external: 0 };

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(f);
    else yield f;
  }
}

const isExternal = (u) => /^(https?:|mailto:|tel:|data:|javascript:|#|\/\/)/i.test(u);

for (const file of walk(ROOT)) {
  if (!file.endsWith(".html")) continue;
  stats.html++;
  const html = fs.readFileSync(file, "utf8");
  const refs = [];
  for (const m of html.matchAll(/(?:src|href|poster|data-src)=["']([^"']+)["']/g)) refs.push(m[1]);
  for (const m of html.matchAll(/srcset=["']([^"']+)["']/g)) {
    for (const part of m[1].split(",")) refs.push(part.trim().split(/\s+/)[0]);
  }
  for (const m of html.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)) refs.push(m[2]);

  for (const raw of refs) {
    if (!raw || isExternal(raw)) {
      if (raw && /^https?:/.test(raw)) stats.external++;
      continue;
    }
    const clean = raw.split(/[?#]/)[0];
    if (!clean) continue;
    stats.refs++;
    let decoded = clean;
    try {
      decoded = decodeURIComponent(clean);
    } catch {}
    const resolved = path.resolve(path.dirname(file), decoded);
    if (!fs.existsSync(resolved) && !fs.existsSync(path.join(resolved, "index.html"))) {
      const rel = path.relative(ROOT, file);
      if (!stats.missing.has(clean)) stats.missing.set(clean, new Set());
      stats.missing.get(clean).add(rel);
    }
  }
}

console.log(JSON.stringify({ root: ROOT, htmlFiles: stats.html, localRefs: stats.refs, externalRefs: stats.external, missing: stats.missing.size }, null, 2));
let i = 0;
for (const [ref, from] of stats.missing) {
  if (i++ >= 20) break;
  console.log(`  ${ref}   <- ${[...from].slice(0, 2).join(", ")}`);
}
