"use strict";
/**
 * Verify the published archive on GitHub Pages: every HTML page returns 200,
 * carries the archive banner wiring, and every asset referenced from CSS
 * resolves. Run after a deploy.
 *   node tools/verify-live.js <repo root> <base url>
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(process.argv[2]);
const BASE = (process.argv[3] || "https://ahnafmohsieu.github.io/Websites").replace(/\/$/, "");
const CONCURRENCY = 12;

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git") continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(f);
    else yield f;
  }
}

const pages = [];
const assets = new Set();
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  if (rel.endsWith(".html")) pages.push(rel);
  if (rel.endsWith(".css")) {
    const css = fs.readFileSync(file, "utf8");
    for (const m of css.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/g)) {
      const raw = m[2].trim();
      if (/^(data:|#|https?:|\/\/)/i.test(raw)) continue;
      let dec = raw.split(/[?#]/)[0];
      try {
        dec = decodeURIComponent(dec);
      } catch {}
      const target = path.resolve(path.dirname(file), dec);
      if (fs.existsSync(target)) assets.add(path.relative(ROOT, target).split(path.sep).join("/"));
    }
  }
}

const url = (rel) => BASE + "/" + rel.split("/").map(encodeURIComponent).join("/");

async function head(u) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(30000) });
      if (res.status === 200 || res.status === 404) return res.status;
    } catch {}
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  return "ERR";
}

const bad = [];
let ok = 0;
const backLinks = new Set();
const queue = pages.map((p) => ({ rel: p, page: true })).concat([...assets].map((a) => ({ rel: a, page: false })));
let cursor = 0;

async function worker() {
  while (cursor < queue.length) {
    const item = queue[cursor++];
    const u = url(item.rel);
    const status = await head(u);
    if (status !== 200) {
      bad.push(`${status}  ${item.rel}`);
      continue;
    }
    ok++;
    if (item.page && item.rel.split("/").length >= 2 && /^(cafe-neptune|nori|bangubhozon)\//.test(item.rel)) {
      const html = await fetch(u, { signal: AbortSignal.timeout(30000) }).then((r) => r.text());
      if (!html.includes("mirror-note__back") || !html.includes("archive-note.js")) {
        bad.push(`BANNER  ${item.rel}`);
      }
      const back = html.match(/class="mirror-note__back" href="([^"]+)"/);
      if (back) backLinks.add(new URL(back[1], u).href);
      else bad.push(`NO-BACKLINK  ${item.rel}`);
    }
  }
}

(async () => {
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  for (const link of backLinks) {
    const status = await head(link);
    if (status !== 200) bad.push(`${status}  backlink ${link}`);
  }

  console.log(
    JSON.stringify(
      { base: BASE, pages: pages.length, assets: assets.size, backLinks: backLinks.size, ok, bad: bad.length },
      null,
      2
    )
  );
  bad.slice(0, 20).forEach((b) => console.log("  " + b));
})();
