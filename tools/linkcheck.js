"use strict";
/**
 * Check every local link inside the archives, on disk.
 *   node linkcheck.js <repo root>
 * Prints each missing target with the pages that point at it.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(process.argv[2] || ".");
const SITES = ["nori", "bangubhozon", "cafe-neptune"];
const SKIP = /^(https?:|mailto:|tel:|javascript:|data:|#|\/\/)/i;

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git") continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(f);
    else yield f;
  }
}

const decode = (u) => {
  try {
    return decodeURIComponent(u);
  } catch {
    return u;
  }
};

const exists = (target) => {
  try {
    const stat = fs.statSync(target);
    if (stat.isFile()) return true;
    if (stat.isDirectory()) return fs.existsSync(path.join(target, "index.html"));
  } catch {}
  return false;
};

const missing = new Map(); // target -> Set(sources)
const total = { pages: 0, links: 0, checked: 0 };

for (const site of SITES) {
  const dir = path.join(ROOT, site);
  if (!fs.existsSync(dir)) continue;
  for (const file of walk(dir)) {
    if (!file.endsWith(".html")) continue;
    total.pages++;
    const html = fs.readFileSync(file, "utf8");
    const refs = [];
    for (const m of html.matchAll(/\b(?:href|src|poster)\s*=\s*["']([^"']*)["']/gi)) refs.push(m[1]);
    for (const m of html.matchAll(/srcset\s*=\s*["']([^"']*)["']/gi)) {
      for (const part of m[1].split(",")) refs.push(part.trim().split(/\s+/)[0]);
    }

    for (const raw of refs) {
      total.links++;
      if (!raw || SKIP.test(raw)) continue;
      const clean = raw.split(/[?#]/)[0];
      if (!clean) continue;
      total.checked++;
      let target = path.resolve(path.dirname(file), decode(clean));
      if (clean.endsWith("/")) target = path.join(target, "index.html");
      if (exists(target)) continue;
      const rel = path.relative(ROOT, target).split(path.sep).join("/");
      if (!missing.has(rel)) missing.set(rel, new Set());
      missing.get(rel).add(path.relative(ROOT, file).split(path.sep).join("/"));
    }
  }
}

const rows = [...missing.entries()].sort((a, b) => b[1].size - a[1].size);
console.log(JSON.stringify({ ...total, missingTargets: rows.length }, null, 2));
for (const [target, sources] of rows.slice(0, 60)) {
  console.log(`  ${sources.size}\t${target}`);
  for (const s of [...sources].slice(0, 2)) console.log(`      from ${s}`);
}
