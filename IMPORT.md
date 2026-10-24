# Restoring a site from its `.wpress` export

Each build exists as a single All-in-One WP Migration archive (`.wpress`). The
archives are 350–530 MB and are therefore **not** committed here: GitHub rejects
files above 100 MB. Request the archive from mahinahmed923@gmail.com.

A `.wpress` file is not a website and cannot be opened in a browser. It contains
a database dump plus `wp-content` (theme, plugins, uploads) in that plugin's own
container format. It needs a running WordPress to mean anything.

## What you need

- PHP 8.0+ and MySQL 5.7+ (or MariaDB 10.4+)
- A WordPress installation, fresh and empty
- The All-in-One WP Migration plugin

## Steps

1. **Create the WordPress site.** On Pantheon: Dashboard → Sites → Add New Site
   → WordPress. On any shared PHP host: use the one-click WordPress installer.
2. **Sign in** to the new site as an administrator.
3. **Install the importer.** Plugins → Add New → search "All-in-One WP Migration"
   → Install → Activate.
4. **Import.** All-in-One WP Migration → Import → Import From → File. Select the
   `.wpress` archive and confirm the overwrite warning.
5. **Watch the size limit.** The free plugin caps uploads at 512 MB.
   `bangubhozon` is 527.6 MB and will be refused. For that one, raise
   `upload_max_filesize` and `post_max_size` to 1024M in `php.ini`, or use the
   paid extension, or import via WP-CLI:

   ```bash
   wp plugin install all-in-one-wp-migration --activate
   wp aiowp-migration import /path/to/bangubhozon.local.wpress
   ```

6. **Re-save permalinks.** Settings → Permalinks → Save. This rewrites the
   `.htaccess`/routing rules for the new host and fixes 404s on inner pages.
7. **Fix the site URL if the dashboard redirects.** The archive stores the old
   `siteurl`. If you get redirected to a dead host, add to `wp-config.php`:

   ```php
   define('WP_HOME', 'https://your-new-host.example');
   define('WP_SITEURL', 'https://your-new-host.example');
   ```

   then update the `siteurl` and `home` rows in `wp_options` and run a search
   replace on the old domain:

   ```bash
   wp search-replace 'https://old-host.example' 'https://your-new-host.example' --all-tables
   ```

8. **Reconnect payments.** The bKash and Nagad credentials are tied to the
   original merchant accounts. Open WooCommerce → Settings → Payments and
   re-enter sandbox or live keys before testing checkout.
9. **Test the order flow** end to end: add to cart, checkout, payment callback,
   order confirmation email.

## Why this is not on GitHub Pages

Pages serves static files only. WordPress requires PHP and MySQL at request time,
so the site cannot be built or run there — no configuration changes that. Static
hosting is a good fit for the [portfolio](https://ahnafmohsieu.github.io/Portfolio/),
not for a working shop.
