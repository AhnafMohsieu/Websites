# Websites

Three WordPress storefronts built for Bangladeshi retail, each browsable as a
static capture of the running install:

| Build | Archive |
|---|---|
| NoriBD — seafood e-commerce | https://ahnafmohsieu.github.io/Websites/nori/ |
| Bangu Bhozon — multi-category retail | https://ahnafmohsieu.github.io/Websites/bangubhozon/ |
| Cafe Neptune — takeaway ordering | https://ahnafmohsieu.github.io/Websites/cafe-neptune/ |

The landing page is https://ahnafmohsieu.github.io/Websites/.

## What the archives are

Each folder is a crawl of the original WordPress site running locally against
its own MySQL database: every page, product, category, image, stylesheet, and
script, with absolute URLs rewritten to relative paths so the capture works
from any host.

Browsing is real — navigation, catalogue, product pages, galleries, responsive
layout. Anything requiring PHP or MySQL is not: cart, checkout, payment
callbacks, account pages, contact form. GitHub Pages serves static files only.

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

## Restoring a working shop

`IMPORT.md` documents restoring the full All-in-One WP Migration archive — with
database, theme, plugins, and media — onto any PHP host.

## Editing

`index.html` is hand-written; `styles.css` holds the design tokens. No build
step. Served from `main` / `/ (root)` by GitHub Pages.
