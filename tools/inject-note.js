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
  const html = fs.readFileSync(file, "utf8");
  if (!html.includes('id="mirror-note"') || html.includes("mirror-note__back")) continue;

  const relDir = path.relative(DIR, path.dirname(file));
  const depth = relDir === "" || relDir === "." ? 0 : relDir.split(path.sep).length;
  // depth + 1 steps: out of the site folder, into the repo root.
  const prefix = "../".repeat(depth + 1);

  const next = html
    .replace(
      /(<button type="button" aria-label="Dismiss">)/,
      `<a class="mirror-note__back" href="${prefix}" style="color:#FAF9F6;white-space:nowrap;text-decoration:underline;text-underline-offset:2px;font-weight:600">&larr; Case studies</a>\n  $1`
    )
    .replace(
      /<\/body>/,
      `<script src="${prefix}archive-note.js" defer></script>\n</body>`
    );
  if (next !== html) {
    fs.writeFileSync(file, next);
    changed++;
  }
}
console.log(JSON.stringify({ dir: DIR, pagesUpdated: changed }));
