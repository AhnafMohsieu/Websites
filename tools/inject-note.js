"use strict";
// Add a "Case studies" escape hatch to the injected archive banner on every
// page, with a relative path that works at any depth, and load the cart guard.
//   node tools/inject-note.js --dir <mirror> --root <repo root>
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf("--" + n);
  return i > -1 && argv[i + 1] ? argv[i + 1] : d;
};

const DIR = path.resolve(arg("dir"));
const ROOT = path.resolve(arg("root"));

const walk = function* (dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(f);
    else yield f;
  }
};

let changed = 0;
for (const file of walk(DIR)) {
  if (!file.endsWith(".html")) continue;
  let html = fs.readFileSync(file, "utf8");
  const original = html;
  if (!html.includes('id="mirror-note"')) continue;

  const relDir = path.relative(DIR, path.dirname(file));
  const depth = relDir === "" || relDir === "." ? 0 : relDir.split(path.sep).length;
  // depth + 1 steps: out of the site folder, into the repo root.
  const prefix = "../".repeat(depth + 1);

  // Each edit is guarded on its own marker so the tool can be re-run on pages
  // captured before a given piece existed.
  if (!html.includes("mirror-note__back")) {
    html = html.replace(
      /(<button type="button" aria-label="Dismiss">)/,
      `<a class="mirror-note__back" href="${prefix}" style="color:#FAF9F6;white-space:nowrap;text-decoration:underline;text-underline-offset:2px;font-weight:600">&larr; Case studies</a>\n  $1`
    );
  }
  if (!html.includes("archive-boot.js")) {
    // Synchronous, in <head>: the cart/wishlist poll fires while the page is
    // still parsing, so a deferred script at the end of <body> is too late.
    html = html.replace(/<\/head>/, `<script src="${prefix}archive-boot.js"></script>\n</head>`);
  }
  if (!html.includes('archive-note.js"')) {
    html = html.replace(/<\/body>/, `<script src="${prefix}archive-note.js" defer></script>\n</body>`);
  }

  if (html !== original) {
    fs.writeFileSync(file, html);
    changed++;
  }
}
console.log(JSON.stringify({ dir: DIR, pagesUpdated: changed }));
