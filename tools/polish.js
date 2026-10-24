"use strict";

/**
 * Post-process a static mirror:
 *   1. drop WordPress machine-only <link> tags (wp-json, xmlrpc, feeds)
 *   2. rename percent-encoded filenames to their decoded form
 *   3. re-fetch any local asset the mirror failed to save
 *
 *   node polish.js --dir <mirror> [--base http://127.0.0.1:8080]
 */

const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf("--" + n);
  return i > -1 && argv[i + 1] ? argv[i + 1] : d;
};

const ROOT = path.resolve(arg("dir"));
const BASE = arg("base", "").replace(/\/$/, "");

const decode = (u) => {
  try {
    return decodeURIComponent(u);
  } catch {
    return u;
  }
};

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(f);
    else yield f;
  }
}

/* 1. rename encoded filenames ------------------------------------------- */

let renamed = 0;
function renameEncoded(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      renameEncoded(full);
      const decoded = decode(e.name);
      if (decoded !== e.name) {
        const target = path.join(dir, decoded);
        if (!fs.existsSync(target)) {
          fs.renameSync(full, target);
          renamed++;
        }
      }
      continue;
    }
    if (e.name.includes("%")) {
      const decoded = decode(e.name);
      if (decoded !== e.name) {
        const target = path.join(dir, decoded);
        if (!fs.existsSync(target)) {
          fs.renameSync(full, target);
          renamed++;
        }
      }
    }
  }
}
renameEncoded(ROOT);

/* 2. strip machine-only links ------------------------------------------- */

const MACHINE = /<link\b[^>]*(wp-json|xmlrpc\.php|\/feed\/|api\.w\.org)[^>]*>\s*/gi;

let stripped = 0;
for (const file of walk(ROOT)) {
  if (!file.endsWith(".html")) continue;
  const html = fs.readFileSync(file, "utf8");
  const next = html.replace(MACHINE, () => {
    stripped++;
    return "";
  });
  if (next !== html) fs.writeFileSync(file, next);
}

/* 3. heal missing assets ------------------------------------------------ */

const ASSET = /\.(css|js|mjs|jpg|jpeg|png|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|pdf|mp4|webm|mp3)$/i;
const isExternal = (u) => /^(https?:|mailto:|tel:|data:|javascript:|#|\/\/)/i.test(u);

const missing = new Map();
for (const file of walk(ROOT)) {
  if (!file.endsWith(".html")) continue;
  const html = fs.readFileSync(file, "utf8");
  const refs = [];
  for (const m of html.matchAll(/(?:src|href|poster|data-src)=["']([^"']+)["']/g)) refs.push(m[1]);
  for (const m of html.matchAll(/srcset=["']([^"']+)["']/g)) {
    for (const part of m[1].split(",")) refs.push(part.trim().split(/\s+/)[0]);
  }
  for (const m of html.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)) refs.push(m[2]);

  for (const raw of refs) {
    if (!raw || isExternal(raw)) continue;
    const clean = raw.split(/[?#]/)[0];
    if (!clean) continue;
    const decoded = decode(clean);
    const rel = path.relative(ROOT, path.resolve(path.dirname(file), decoded));
    const resolved = path.resolve(path.dirname(file), decoded);
    if (fs.existsSync(resolved) || fs.existsSync(path.join(resolved, "index.html"))) continue;
    if (!ASSET.test(decoded)) continue;
    missing.set(rel.replace(/\\/g, "/"), true);
  }
}

let healed = 0;
if (BASE) {
  (async () => {
    for (const rel of missing.keys()) {
      const url = BASE + "/" + rel.split("/").map(encodeURIComponent).join("/");
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!res.ok) {
          console.log(`  ! ${res.status} ${rel}`);
          continue;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const target = path.join(ROOT, rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, buf);
        healed++;
      } catch (err) {
        console.log(`  ! ${err.message} ${rel}`);
      }
    }
    report();
  })();
} else {
  report();
}

function report() {
  console.log(JSON.stringify({ dir: ROOT, renamed, strippedLinks: stripped, missingAssets: missing.size, healed }, null, 2));
}
