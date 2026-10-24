"use strict";

/**
 * Zero-dependency static mirror for a locally running WordPress site.
 *
 *   node mirror.js --base http://127.0.0.1:8080 --out <dir> [--label "Site name"]
 *
 * Crawls the sitemap plus every internal link found, rewrites absolute URLs
 * (base host, any .local host, and root-relative paths) into page-depth-relative
 * links, then downloads every referenced asset preserving its path so relative
 * CSS url() references keep working untouched.
 */

const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf("--" + name);
  return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const BASE = arg("base", "http://127.0.0.1:8080").replace(/\/$/, "");
const OUT = path.resolve(arg("out", "mirror-out"));
const LABEL = arg("label", "WordPress site");
const CONCURRENCY = Number(arg("concurrency", "3"));
const MAX_PAGES = Number(arg("max-pages", "600"));

const BASE_HOST = new URL(BASE).host;

const abs = (p) => BASE + (p.startsWith("/") ? p : "/" + p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- state */

const htmlCache = new Map(); // urlPath -> { body, depth }
const assetQueue = new Set(); // site-internal asset paths
const assetDone = new Set();
const visited = new Set();
const failed = [];

/* ----------------------------------------------------------------- urls */

const ASSET_EXT = /\.(css|js|mjs|jpg|jpeg|png|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|pdf|mp4|webm|mp3|zip)$/i;

function isLocalHost(host) {
  return host === BASE_HOST || host.endsWith(".local") || /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
}

/** Return the site-internal path (with search/hash) for a reference, or null. */
function internalPath(raw, pagePath) {
  if (!raw) return null;
  let url = raw.trim().replace(/&amp;/g, "&");
  if (!url || url.startsWith("#")) return null;
  if (/^(mailto:|tel:|data:|javascript:|blob:|about:)/i.test(url)) return null;

  try {
    if (url.startsWith("//")) url = "http:" + url;
    else if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = new URL(url, "http://mirror.invalid" + (pagePath || "/")).href;
    const parsed = new URL(url);
    if (!isLocalHost(parsed.host)) return null;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return null;
  }
}

const depthOf = (urlPath) => urlPath.split(/[?#]/)[0].split("/").filter(Boolean).length;
const prefixFor = (depth) => (depth === 0 ? "" : "../".repeat(depth));

function toRelative(urlPath, depth) {
  const hashIndex = urlPath.indexOf("#");
  const hash = hashIndex > -1 ? urlPath.slice(hashIndex) : "";
  const rest = hashIndex > -1 ? urlPath.slice(0, hashIndex) : urlPath;
  return prefixFor(depth) + rest.replace(/^\//, "") + hash;
}

function queueAsset(urlPath) {
  const clean = urlPath.split("#")[0].split("?")[0];
  if (!clean || clean === "/" || /\.html?$/i.test(clean)) return;
  assetQueue.add(clean);
}

/* -------------------------------------------------------------- fetching */

async function fetchText(url, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(60000),
        headers: { "user-agent": "static-mirror/1.0" },
      });
      return { status: res.status, body: await res.text(), type: res.headers.get("content-type") || "" };
    } catch (err) {
      if (attempt >= tries) throw err;
      await sleep(800 * attempt);
    }
  }
}

async function fetchBinary(url, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(60000),
        headers: { "user-agent": "static-mirror/1.0" },
      });
      return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") || "" };
    } catch {
      if (attempt >= tries) return { status: 0, buffer: null, type: "" };
      await sleep(600 * attempt);
    }
  }
}

/* -------------------------------------------------------------- sitemap */

async function sitemapUrls() {
  const urls = [];
  try {
    const index = await fetchText(abs("/wp-sitemap.xml"));
    const maps = [...index.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    for (const map of maps) {
      const inner = await fetchText(map);
      for (const m of inner.body.matchAll(/<loc>([^<]+)<\/loc>/g)) {
        const p = internalPath(m[1]);
        if (p) urls.push(p);
      }
    }
  } catch (err) {
    console.warn("  ! sitemap unavailable:", err.message);
  }
  return urls;
}

/* ---------------------------------------------------------------- crawl */

function fileFor(urlPath) {
  const raw = urlPath.split(/[?#]/)[0];
  // Percent-encoded names must land on disk decoded: a static host maps the
  // decoded request path to the filename, so "My%20Photo.jpg" would never match.
  let p;
  try {
    p = decodeURIComponent(raw);
  } catch {
    p = raw;
  }
  if (!p || p === "/") return "index.html";
  if (p.endsWith("/")) return p.slice(1) + "index.html";
  return /\.[a-z0-9]+$/i.test(p) ? p.slice(1) : p.slice(1) + "/index.html";
}

function shouldSkip(urlPath) {
  const p = urlPath.split(/[?#]/)[0];
  return (
    /\/(wp-admin|wp-login\.php|wp-cron\.php|xmlrpc\.php|wp-json|feed|comments)(\/|$)/.test(p) ||
    /admin-ajax\.php/.test(p) ||
    /\/wp-sitemap/.test(p) ||
    /\/wp-content\/(plugins|themes)\/[^/]+\/readme/i.test(p)
  );
}

async function crawlPage(urlPath) {
  if (visited.has(urlPath)) return;
  visited.add(urlPath);
  const depth = depthOf(urlPath);

  let page;
  try {
    page = await fetchText(abs(urlPath));
  } catch (err) {
    failed.push({ urlPath, error: err.message });
    return;
  }
  if (page.status !== 200 || !/text\/html/i.test(page.type)) {
    failed.push({ urlPath, error: `status ${page.status} ${page.type}` });
    return;
  }
  htmlCache.set(urlPath, { body: page.body, depth });

  for (const m of page.body.matchAll(/href=["']([^"']+)["']/g)) {
    const p = internalPath(m[1], urlPath);
    if (!p || p.includes("/wp-sitemap") || /admin-ajax\.php/.test(p)) continue;
    if (ASSET_EXT.test(p.split(/[?#]/)[0])) {
      queueAsset(p);
    } else if (!p.includes("?") && !shouldSkip(p) && !visited.has(p) && visited.size + 1 < MAX_PAGES) {
      // Query-string URLs are filters, feed variants, or add-to-cart POST
      // targets; they duplicate pages already reachable by path.
      pageQueue.push(p);
    }
  }
  for (const m of page.body.matchAll(/(?:src|data-src|poster)=["']([^"']+)["']/g)) {
    const p = internalPath(m[1], urlPath);
    if (p) queueAsset(p);
  }
  for (const m of page.body.matchAll(/srcset=["']([^"']+)["']/g)) {
    for (const part of m[1].split(",")) {
      const p = internalPath(part.trim().split(/\s+/)[0], urlPath);
      if (p) queueAsset(p);
    }
  }
  for (const m of page.body.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)) {
    const p = internalPath(m[2], urlPath);
    if (p) queueAsset(p);
  }
}

/* --------------------------------------------------------------- assets */

function rewriteCss(css, cssPath) {
  const depth = depthOf(cssPath);
  return css.replace(/url\((['"]?)(\/|https?:\/\/(?:127\.0\.0\.1|localhost|[a-z0-9-]+\.local)[^/]*)\/?/gi, (m, q, host) => {
    return `url(${q}${host.startsWith("/") ? prefixFor(depth) : ""}`;
  });
}

async function drainAssets() {
  let done = 0;
  for (let pass = 0; pass < 8; pass++) {
    const pending = [...assetQueue].filter((a) => !assetDone.has(a));
    if (!pending.length) break;
    const queue = pending.slice();

    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (queue.length) {
          const urlPath = queue.shift();
          if (assetDone.has(urlPath)) continue;
          assetDone.add(urlPath);
          const file = path.join(OUT, fileFor(urlPath));
          if (fs.existsSync(file)) continue;

          const res = await fetchBinary(abs(urlPath));
          if (!res.buffer || res.status >= 400) {
            console.warn(`  ! asset ${res.status} ${urlPath}`);
            continue;
          }
          fs.mkdirSync(path.dirname(file), { recursive: true });

          if (/\.css$/i.test(urlPath) || /text\/css/i.test(res.type)) {
            const css = res.buffer.toString("utf8");
            for (const m of css.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)) {
              const ref = m[2];
              if (/^(data:|#)/i.test(ref)) continue;
              const resolved = new URL(ref, "http://mirror.invalid" + urlPath);
              if (resolved.host === "mirror.invalid" || isLocalHost(resolved.host)) queueAsset(resolved.pathname);
            }
            fs.writeFileSync(file, rewriteCss(css, urlPath));
          } else {
            fs.writeFileSync(file, res.buffer);
          }
          done++;
          if (done % 40 === 0) process.stdout.write(`  assets ${done}\n`);
        }
      })
    );
  }
  return done;
}

/* ---------------------------------------------------------------- write */

const noteHtml = () => `
<style>
  .mirror-note{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;display:flex;gap:14px;align-items:center;
    justify-content:center;padding:9px 46px 9px 16px;background:#14110F;color:#FAF9F6;
    font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;text-align:center}
  .mirror-note strong{font-weight:600}
  .mirror-note button{position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:0;
    color:#FAF9F6;font-size:19px;line-height:1;cursor:pointer;padding:4px 8px}
  @media (max-width:640px){.mirror-note{font-size:11.5px;padding:7px 40px 7px 10px}}
</style>
<div class="mirror-note" id="mirror-note" role="status">
  <span><strong>Static archive</strong> of the ${LABEL} WordPress build. Every page, product and image is browsable; cart and checkout are disabled.</span>
  <button type="button" aria-label="Dismiss">&times;</button>
</div>
<script>(function(){var n=document.getElementById("mirror-note");if(!n)return;n.querySelector("button").addEventListener("click",function(){n.remove();});})();</script>
`;

function rewriteHtml(html, depth) {
  // Absolute internal URLs -> paths -> relative references.
  html = html.replace(/(?:https?:)?\/\/(?:127\.0\.0\.1:\d+|localhost:\d+|[a-z0-9-]+\.local)(\/[^"'\\\s>)]*)?/gi, (m, p) =>
    toRelative(p || "/", depth)
  );
  // JSON-escaped copies used by inline scripts and REST payloads.
  html = html.replace(
    /(?:https?:)?\\\/\\\/(?:127\.0\.0\.1:\d+|localhost:\d+|[a-z0-9-]+\.local)(\\\/[^"'\\\s>)]*)?/gi,
    (m, p) => toRelative((p || "\\/").replace(/\\\//g, "/"), depth)
  );
  // Root-relative references, single- or double-quoted.
  html = html.replace(/(href|src|action|poster|data-src|content)=(["'])\/(?!\/)/gi, (m, attr, q) => `${attr}=${q}${prefixFor(depth)}`);
  html = html.replace(/url\((['"]?)\/(?!\/)/gi, (m, q) => `url(${q}${prefixFor(depth)}`);
  return html;
}

function writePages() {
  for (const [urlPath, { body, depth }] of htmlCache) {
    let html = body;

    // srcset needs its own pass: comma-separated candidates with descriptors.
    html = html.replace(/srcset=(["'])([^"']*)\1/gi, (m, q, value) =>
      `srcset=${q}${value
        .split(",")
        .map((part) => {
          const [u, ...desc] = part.trim().split(/\s+/);
          const p = internalPath(u, urlPath);
          return p ? [toRelative(p, depth), ...desc].join(" ") : part.trim();
        })
        .join(", ")}${q}`
    );

    html = rewriteHtml(html, depth);
    html = html.replace(/<link[^>]+rel=["']canonical["'][^>]*>/gi, "");
    if (html.includes("</body>")) html = html.replace("</body>", noteHtml() + "</body>");

    const file = path.join(OUT, fileFor(urlPath));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, html);
  }
}

/* ----------------------------------------------------------------- main */

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

async function checkLinks() {
  const missing = new Map();
  for (const file of walk(OUT)) {
    if (!file.endsWith(".html")) continue;
    const html = fs.readFileSync(file, "utf8");
    for (const m of html.matchAll(/href="([^"#:?][^"]*)"/g)) {
      const target = m[1].split(/[?#]/)[0];
      if (!target) continue;
      const resolved = path.resolve(path.dirname(file), target);
      if (!fs.existsSync(resolved) && !fs.existsSync(path.join(resolved, "index.html"))) {
        missing.set(target, (missing.get(target) || 0) + 1);
      }
    }
  }
  return missing;
}

const pageQueue = [];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`mirroring ${BASE} -> ${OUT}`);

  const seeds = await sitemapUrls();
  seeds.push("/", "/shop/", "/cart/", "/checkout/", "/my-account/", "/about-us/", "/contact-us/");
  console.log(`  seeds: ${seeds.length}`);
  for (const s of seeds) if (!shouldSkip(s)) pageQueue.push(s);

  let active = 0;
  let pages = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const next = pageQueue.shift();
        if (!next) {
          if (active === 0) break;
          await sleep(60);
          continue;
        }
        if (visited.has(next)) continue;
        active++;
        try {
          await crawlPage(next);
          pages++;
          if (pages % 15 === 0) process.stdout.write(`  pages ${pages} (queued ${pageQueue.length})\n`);
        } finally {
          active--;
        }
      }
    })
  );

  console.log(`  crawled ${htmlCache.size} pages, ${failed.length} unreachable`);
  writePages();
  const assets = await drainAssets();
  console.log(`  wrote ${htmlCache.size} pages and ${assets} assets`);

  const bytes = [...walk(OUT)].reduce((n, f) => n + fs.statSync(f).size, 0);
  fs.writeFileSync(
    path.join(OUT, "mirror-manifest.json"),
    JSON.stringify(
      {
        source: BASE,
        label: LABEL,
        capturedAt: new Date().toISOString(),
        pages: htmlCache.size,
        assets,
        sizeMB: Number((bytes / 1024 / 1024).toFixed(1)),
        unreachable: failed,
      },
      null,
      2
    )
  );

  const missing = await checkLinks();
  console.log(`  total ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  if (missing.size) {
    console.log(`  dead relative links: ${missing.size} distinct`);
    [...missing.entries()].slice(0, 20).forEach(([t, n]) => console.log(`    ${n}x ${t}`));
  } else {
    console.log("  dead relative links: none");
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
