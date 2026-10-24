"use strict";
/**
 * Repair dead links inside the archives.
 *
 * The crawl cannot follow URLs that only exist behind PHP, and a few theme
 * menus point at pages that never existed. Leaving those anchors in place means
 * a visitor clicks a footer label and lands on the 404 page, so this tool:
 *
 *   1. rewrites anchors listed in --map (old=new, repeatable), and
 *   2. drops the href from any local anchor whose target file is missing,
 *      leaving the text in place.
 *
 *   node tools/fix-links.js --dir <repo root> [--map a=b] [--write]
 *
 * Without --write it only reports.
 */
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf("--" + n);
  return i > -1 && argv[i + 1] ? argv[i + 1] : d;
};

const ROOT = path.resolve(arg("dir", "."));
const WRITE = argv.includes("--write");
const MAP = new Map();
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== "--map" || !argv[i + 1]) continue;
  const [from, to] = argv[i + 1].split("=");
  if (from && to) MAP.set(from, to);
}

const SKIP = /^(https?:|mailto:|tel:|javascript:|data:|#|\/\/)/i;
const ANCHOR = /<a\b([^>]*?)>/gi;
const HREF = /\shref\s*=\s*(["'])(.*?)\1/i;
// A list item whose only content is a dead link: drop the whole item, so the
// menu does not keep a label that does nothing.
const DEAD_ITEM = /[ \t]*<li\b[^>]*>\s*<a\b([^>]*?)>[\s\S]*?<\/a>\s*<\/li>\s*\n?/gi;

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

const resolves = (from, raw) => {
  const clean = raw.split(/[?#]/)[0];
  if (!clean) return true;
  let target = path.resolve(path.dirname(from), decode(clean));
  if (clean.endsWith("/")) target = path.join(target, "index.html");
  try {
    const stat = fs.statSync(target);
    return stat.isFile() || fs.existsSync(path.join(target, "index.html"));
  } catch {
    return false;
  }
};

const report = { files: 0, written: 0, mapped: 0, stripped: 0, removedItems: 0, targets: new Map() };

for (const file of walk(ROOT)) {
  if (!file.endsWith(".html")) continue;
  const html = fs.readFileSync(file, "utf8");
  let changed = false;

  // Pass 1: remove list items whose link goes nowhere.
  let next = html.replace(DEAD_ITEM, (item, attrs) => {
    const m = attrs.match(HREF);
    if (!m) return item;
    const value = m[2];
    if (!value || SKIP.test(value) || value.charAt(0) === "/") return item;
    if (MAP.has(value) || MAP.has(value.replace(/\/$/, ""))) return item;
    if (resolves(file, value)) return item;
    const target = value.split(/[?#]/)[0];
    const rel = path.relative(ROOT, path.resolve(path.dirname(file), decode(target))).split(path.sep).join("/");
    report.targets.set(rel + " (item)", (report.targets.get(rel + " (item)") || 0) + 1);
    report.removedItems++;
    changed = true;
    return "";
  });

  // Pass 2: rewrite mapped anchors, strip the href from any other dead link.
  next = next.replace(ANCHOR, (tag, attrs) => {
    const m = attrs.match(HREF);
    if (!m) return tag;
    let value = m[2];
    if (!value || SKIP.test(value)) return tag;

    const key = value.replace(/^\.\//, "");
    if (MAP.has(key) || MAP.has(key.replace(/\/$/, ""))) {
      const to = MAP.get(key) || MAP.get(key.replace(/\/$/, ""));
      value = to;
      changed = true;
      report.mapped++;
    }

    if (value.charAt(0) === "/") return tag; // root-relative: resolves to the published root, not this checkout

    if (resolves(file, value)) {
      return `<a${attrs.replace(HREF, ` href="${value}"`)}>`;
    }

    const target = value.split(/[?#]/)[0];
    const rel = path.relative(ROOT, path.resolve(path.dirname(file), decode(target))).split(path.sep).join("/");
    report.targets.set(rel, (report.targets.get(rel) || 0) + 1);
    report.stripped++;
    changed = true;
    // Keep the attributes that style the label, drop only the destination.
    return `<a${attrs.replace(HREF, "")}>`;
  });

  if (changed) {
    report.files++;
    if (WRITE) {
      fs.writeFileSync(file, next);
      report.written++;
    }
  }
}

console.log(
  JSON.stringify(
    {
      dir: ROOT,
      write: WRITE,
      filesTouched: report.files,
      filesWritten: report.written,
      mapped: report.mapped,
      stripped: report.stripped,
      removedItems: report.removedItems,
      deadTargets: report.targets.size,
    },
    null,
    2
  )
);
for (const [target, count] of [...report.targets.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count}\t${target}`);
}
