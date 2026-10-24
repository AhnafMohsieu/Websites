"use strict";
// Check that every url() inside a mirror's CSS resolves on disk.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(process.argv[2]);
const walk = function* (dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(f);
    else yield f;
  }
};

let files = 0;
let refs = 0;
const missing = new Map();

for (const file of walk(ROOT)) {
  if (!file.endsWith(".css")) continue;
  files++;
  const css = fs.readFileSync(file, "utf8");
  for (const m of css.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/g)) {
    const raw = m[2].trim();
    if (/^(data:|#|https?:|\/\/)/i.test(raw)) continue;
    refs++;
    let decoded = raw.split(/[?#]/)[0];
    try {
      decoded = decodeURIComponent(decoded);
    } catch {}
    const resolved = path.resolve(path.dirname(file), decoded);
    if (!fs.existsSync(resolved)) {
      const key = path.relative(ROOT, resolved);
      if (!missing.has(key)) missing.set(key, path.relative(ROOT, file));
    }
  }
}

console.log(JSON.stringify({ cssFiles: files, urlRefs: refs, missing: missing.size }, null, 2));
let i = 0;
for (const [ref, from] of missing) {
  if (i++ >= 12) break;
  console.log(`  ${ref}  <- ${from}`);
}
