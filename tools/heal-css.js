"use strict";
// Fetch assets referenced from inside CSS (fonts, icons, sprites) that a mirror
// is missing.  node heal-css.js --dir <mirror> --base http://127.0.0.1:8080
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf("--" + n);
  return i > -1 && argv[i + 1] ? argv[i + 1] : d;
};

const ROOT = path.resolve(arg("dir"));
const BASE = arg("base", "").replace(/\/$/, "");

const walk = function* (dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(f);
    else yield f;
  }
};

const pending = new Map(); // absolute target -> site-relative url path

for (const file of walk(ROOT)) {
  if (!file.endsWith(".css")) continue;
  const css = fs.readFileSync(file, "utf8");
  for (const m of css.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/g)) {
    const raw = m[2].trim();
    if (/^(data:|#|https?:|\/\/)/i.test(raw)) continue;
    let decoded = raw.split(/[?#]/)[0];
    try {
      decoded = decodeURIComponent(decoded);
    } catch {}
    const resolved = path.resolve(path.dirname(file), decoded);
    if (fs.existsSync(resolved)) continue;
    const rel = path.relative(ROOT, resolved).split(path.sep).join("/");
    pending.set(resolved, rel);
  }
}

(async () => {
  let healed = 0;
  const failed = [];
  for (const [target, rel] of pending) {
    const url = BASE + "/" + rel.split("/").map(encodeURIComponent).join("/");
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        failed.push(`${res.status} ${rel}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, buf);
      healed++;
    } catch (err) {
      failed.push(`${err.message} ${rel}`);
    }
  }
  console.log(JSON.stringify({ dir: ROOT, wanted: pending.size, healed, failed: failed.length }, null, 2));
  failed.slice(0, 10).forEach((f) => console.log("  ! " + f));
})();
