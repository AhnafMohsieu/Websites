# Websites

Three WordPress storefronts built for Bangladeshi retail, each browsable as a
static capture of the running install:

| Build | Archive | Pages | Catalogue | Weight |
|---|---|---|---|---|
| NoriBD — seafood e-commerce | [/nori/](https://ahnafmohsieu.github.io/Websites/nori/) | 45 | 22 products, 6 categories | 63 MB |
| Bangu Bhozon — multi-category retail | [/bangubhozon/](https://ahnafmohsieu.github.io/Websites/bangubhozon/) | 78 | 60 products, 6 departments | 13 MB |
| Cafe Neptune — takeaway ordering | [/cafe-neptune/](https://ahnafmohsieu.github.io/Websites/cafe-neptune/) | 81 | 55 products, 5 categories | 16 MB |

The landing page is https://ahnafmohsieu.github.io/Websites/.

## What the archives are

Each folder is a crawl of the original WordPress site running locally against
its own MySQL database: every page, product, category, image, stylesheet, and
script, with absolute URLs rewritten to relative paths so the capture works
from any host.

Browsing is real — navigation, catalogue, product pages, galleries, responsive
layout. Anything requiring PHP or MySQL is not: cart, checkout, payment
callbacks, account pages, contact form. GitHub Pages serves static files only.

Each archive page carries a small fixed banner: a link back to this hub, a note
that ordering is disabled, and a script that intercepts cart and wishlist clicks
so they explain themselves instead of navigating to a dead endpoint. Pages that
only exist behind PHP (filtered pagination, account actions, `wp-json`, XML-RPC
and RSS feeds) are not captured, and their links are removed rather than left
dangling; anything else that misses lands on `404.html`.

## Rebuilding an archive

The source installs live in Local by Flywheel. To re-capture one:

1. Start the site's database (MySQL) and serve `app/public` with PHP's built-in
   server, plus a router that decodes percent-encoded paths:

   ```bash
   php -S 127.0.0.1:8080 -t app/public router.php
   ```

2. Point `wp-config.php` at the database and block outbound HTTP, otherwise
   WordPress deadlocks against the single-threaded dev server:

   ```php
   define( 'WP_HTTP_BLOCK_EXTERNAL', true );
   define( 'WP_ACCESSIBLE_HOSTS', 'none.invalid' );
   define( 'DISABLE_WP_CRON', true );
   ```

3. Crawl with `tools/mirror.js` (zero dependencies):

   ```bash
   node tools/mirror.js --base http://127.0.0.1:8080 --out ../cafe-neptune --label "Cafe Neptune"
   ```

4. Post-process with `tools/polish.js`: strips WordPress machine-only links
   (`wp-json`, `xmlrpc.php`, feeds), renames percent-encoded files, and re-fetches
   assets that 404'd.

5. Heal CSS-internal references with `tools/heal-css.js`, then confirm nothing is
   left with `tools/check-css.js`. A crawler that only follows markup misses the
   fonts and sprites named inside stylesheets, which is the difference between a
   page that looks right and one that renders in the wrong typeface.

   ```bash
   node tools/heal-css.js --dir ../cafe-neptune --base http://127.0.0.1:8080
   node tools/check-css.js ../cafe-neptune
   ```

6. Add the archive banner, the back-link, and the cart guard with
   `tools/inject-note.js`:

   ```bash
   node tools/inject-note.js --dir ../cafe-neptune --root ..
   ```

7. Verify twice. `tools/verify-mirror.js` walks every local reference on disk.
   `tools/verify-live.js` then checks the published copy: every page returns 200,
   every asset named inside a stylesheet resolves, and every page carries the
   banner wiring.

   ```bash
   node tools/verify-live.js . https://ahnafmohsieu.github.io/Websites
   ```

`tools/router.php` is the PHP dev-server router used in step 1. It decodes
percent-encoded paths (WordPress media filenames contain spaces) and refuses to
serve outside the document root.

## Restoring a working shop

`IMPORT.md` documents restoring the full All-in-One WP Migration archive — with
database, theme, plugins, and media — onto any PHP host.

## Editing

`index.html` is hand-written; `styles.css` holds the design tokens. No build
step. Served from `main` / `/ (root)` by GitHub Pages.
