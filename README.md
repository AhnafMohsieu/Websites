# Websites

Three WordPress storefronts built for Bangladeshi retail, each browsable as a
static capture of the running install:

| Build | Archive | Pages | Catalogue | Weight |
|---|---|---|---|---|
| NoriBD — seafood e-commerce | [/nori/](https://ahnafmohsieu.github.io/Websites/nori/) | 45 | 22 products, 6 categories | 63 MB |
| Bangu Bhozon — multi-category retail | [/bangubhozon/](https://ahnafmohsieu.github.io/Websites/bangubhozon/) | 83 | 60 products, 6 departments | 40 MB |
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
dangling; anything else that misses lands on `404.html`, which works out which
archive you were in and offers that shop's homepage.

Two small scripts make the captures behave on a static host:

- `archive-boot.js` loads synchronously in `<head>`. WooCommerce and the wishlist
  plugin poll for cart fragments and wishlist state while the page is still
  parsing; here those polls are answered locally with an empty payload, which
  removes two failed requests per page and stops the wishlist script from
  throwing on a response it never got.
- `archive-note.js` loads at the end of `<body>`: it guards cart, checkout,
  wishlist, search, comment, contact and account forms, rebases any
  root-relative asset URL a plugin injects after load, and keeps the banner
  dismissal in `localStorage`.

Both script tags carry a `?v=` stamp written by `tools/inject-note.js`. Bump `V`
there when either script changes, or a returning visitor keeps running the copy
their browser cached.

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

   Whitelist nothing — not even `127.0.0.1`. The dev server has one worker, and a
   loopback request to itself never returns, so every page hangs.

   If the store is in WooCommerce's *Coming soon* mode, every URL returns the
   same holding page and the crawl is worthless. Switch it off first:

   ```sql
   UPDATE wp_options SET option_value = 'no' WHERE option_name = 'woocommerce_coming_soon';
   ```

3. Crawl with `tools/mirror.js` (zero dependencies):

   ```bash
   node tools/mirror.js --base http://127.0.0.1:8080 --out ../cafe-neptune --label "Cafe Neptune"
   ```

4. Post-process with `tools/polish.js`: strips WordPress machine-only links
   (`wp-json`, `xmlrpc.php`, feeds), renames percent-encoded files, makes
   root-relative plugin config paths depth-aware (gtranslate's flag base), gives
   every page an absolute `og:image` and a canonical URL, and re-fetches assets
   that 404'd. Pass `--public` if the archive is published somewhere else.

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

7. Find dead links with `tools/linkcheck.js`, then repair them with
   `tools/fix-links.js`. Not every URL a theme prints corresponds to a page: a
   footer can name a policy page that was never published, and a menu can point
   at a category slug that does not exist. The crawl cannot follow those, so
   they are dangling anchors unless something removes them.

   ```bash
   node tools/linkcheck.js ..
   node tools/fix-links.js --dir .. --map product-category/fresh-seafood=product-category/fresh-frozen-fish/ --write
   node tools/linkcheck.js ..
   ```

   `fix-links.js` drops a list item whose only content is a dead link, rewrites
   the anchors named in `--map` to a real target, and strips the `href` from any
   other dead anchor so the label stays but goes nowhere. Run it without
   `--write` first: it reports what it would touch.

8. Verify twice. `tools/verify-mirror.js` walks every local reference on disk.
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

`index.html` is hand-written; `styles.css` holds the design tokens; `shots/`
holds the hub thumbnails — desktop and mobile renditions of each homepage,
captured from the archives themselves. No build step. Served from `main` /
`/ (root)` by GitHub Pages.
