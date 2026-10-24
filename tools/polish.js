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

const MACHINE = /<link\b[^>]*(wp-json|xmlrpc\.php|feed\/|api\.w\.org|rel=["']alternate["'])[^>]*>\s*/gi;
// Anchors to RSS feeds, login, and XML-RPC have no static equivalent; keep the
// visible text and drop the dead link.
const DEAD_ANCHOR = /<a\b[^>]*href=["'][^"']*(?:\/feed\/|wp-login\.php|xmlrpc\.php)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;

let stripped = 0;
for (const file of walk(ROOT)) {
  if (!file.endsWith(".html")) continue;
  const html = fs.readFileSync(file, "utf8");
  const next = html
    .replace(MACHINE, () => {
      stripped++;
      return "";
    })
    .replace(DEAD_ANCHOR, (m, inner) => {
      stripped++;
      return inner;
    });
  if (next !== html) fs.writeFileSync(file, next);
}

/* 3. make root-relative plugin configs depth-aware ---------------------- */

/*
 * gtranslate stores its flags base as an absolute path in a JSON blob
 * ("flags_location":"\/wp-content\/plugins\/gtranslate\/flags\/"). The widget
 * assigns that straight to img.src, so under a subfolder mirror the browser
 * requests it at the domain root, misses, and only then does archive-note.js
 * patch the element. Rewriting it to a document-relative path up front means
 * the first request already lands in the archive.
 */
const FLAGS_LOCATION = /("flags_location"\s*:\s*")\\\/([^"]*)(")/g;

let relativeFlags = 0;
for (const file of walk(ROOT)) {
  if (!file.endsWith(".html")) continue;
  const html = fs.readFileSync(file, "utf8");
  if (html.indexOf("flags_location") === -1) continue;

  // The site root is the nearest ancestor that owns wp-content; the flags path
  // has to climb exactly that many levels to resolve from any page.
  let depth = 0;
  for (let dir = path.dirname(file); dir.length >= ROOT.length; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "wp-content"))) break;
    depth++;
    if (dir === ROOT) break;
  }
  const up = depth ? "../".repeat(depth) : "";

  const next = html.replace(FLAGS_LOCATION, (m, head, rest, tail) => {
    relativeFlags++;
    return head + up + rest + tail;
  });
  if (next !== html) fs.writeFileSync(file, next);
}

/* 4. make social metadata absolute -------------------------------------- */

/*
 * The crawl rewrote every URL to a relative one, which is right for <img> and
 * <a> but useless in og:image: a scraper has no page context to resolve it
 * against. Point the social tags at the published copy, and give every archived
 * page a canonical URL so it is not read as a stray copy of some other host.
 */
const PUBLIC = arg("public", "https://ahnafmohsieu.github.io/Websites").replace(/\/$/, "");
const OG_IMAGE = /(<meta\s+(?:property|name)=["'](?:og:image|twitter:image)["']\s+content=["'])([^"']+)(["'])/gi;

let socialized = 0;
let canonicals = 0;
for (const file of walk(ROOT)) {
  if (!file.endsWith(".html")) continue;
  const dir = path.dirname(file);

  // Only archive pages: the hub and 404 sit outside a site folder.
  let siteRoot = null;
  for (let d = dir; d.length >= ROOT.length; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, "wp-content"))) {
      siteRoot = d;
      break;
    }
    if (d === ROOT) break;
  }
  if (!siteRoot) continue;

  let html = fs.readFileSync(file, "utf8");
  const before = html;

  html = html.replace(OG_IMAGE, (m, head, value, tail) => {
    if (/^(https?:)?\/\//i.test(value)) return m;
    const abs = path.resolve(dir, decode(value));
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    socialized++;
    return head + PUBLIC + "/" + rel.split("/").map(encodeURIComponent).join("/") + tail;
  });

  if (!html.includes('rel="canonical"')) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/").replace(/index\.html$/, "");
    const url = PUBLIC + "/" + rel.split("/").map(encodeURIComponent).join("/");
    const tags = `<link rel="canonical" href="${url}">\n<meta property="og:url" content="${url}">\n`;
    html = html.replace(/<\/head>/i, (m) => tags + m);
    canonicals++;
  }

  if (html !== before) fs.writeFileSync(file, html);
}

/* 5. heal missing assets ------------------------------------------------ */

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
    // Root-relative refs only occur in the repo-level 404.html, where "/" is the
    // published /Websites/ root, not this checkout. Nothing to resolve locally.
    if (raw.charAt(0) === "/") continue;
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
  console.log(JSON.stringify({ dir: ROOT, renamed, strippedLinks: stripped, relativeFlags, socialized, canonicals, missingAssets: missing.size, healed }, null, 2));
  if (missing.size) for (const rel of missing.keys()) console.log("  missing " + rel);
}
