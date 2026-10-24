/*
 * Static-archive behaviour for WooCommerce pages.
 *
 * The pages were captured from a running WordPress install, so the cart
 * controls are still in the markup but the endpoints behind them do not exist
 * on static hosting. Rather than let a click fail silently (or navigate to a
 * 404), intercept it and explain what happened. The explanation bar is
 * dismissible and the dismissal is remembered, so a reader who has understood
 * the note once is not told again on every product page.
 */
(function () {
  "use strict";

  var STORE_KEY = "archive-note-dismissed";
  var SELECTOR = [
    ".single_add_to_cart_button",
    ".add_to_cart_button",
    "button[name='add-to-cart']",
    "a[href*='add-to-cart=']",
    ".wc-block-components-product-button__button",
    ".tinvwl_add_to_wishlist_button",
    ".add_to_wishlist",
    "a[href*='add-to-wishlist=']",
  ].join(",");

  var note = document.getElementById("mirror-note");

  /*
   * A few plugin scripts rebuild asset URLs against the domain root after the
   * page loads (the language switcher is one). This capture is served from a
   * subfolder, so those requests 404 against the user's site root. Map them
   * back into the archive: /wp-content/x -> /Websites/<site>/wp-content/x.
   */
  var script = document.querySelector('script[src$="archive-note.js"]');
  var repoPath = script ? new URL(script.src, location.href).pathname.replace(/archive-note\.js$/, "") : null;
  var siteRoot = null;
  if (repoPath && location.pathname.indexOf(repoPath) === 0) {
    var slug = location.pathname.slice(repoPath.length).split("/")[0];
    if (slug) siteRoot = repoPath + slug + "/";
  }

  function sweep() {
    if (!siteRoot) return;
    var attrs = ["src", "href", "data-src", "poster"];
    document.querySelectorAll('[src^="/"], [href^="/"], [data-src^="/"], [poster^="/"]').forEach(function (el) {
      attrs.forEach(function (attr) {
        var value = el.getAttribute(attr);
        if (!value || value.charAt(0) !== "/" || value.indexOf("//") === 0) return;
        if (value.indexOf(repoPath) === 0) return;
        el.setAttribute(attr, siteRoot + value.slice(1));
      });
    });
  }

  function dismiss() {
    try {
      localStorage.setItem(STORE_KEY, "1");
    } catch (e) {}
    if (note) note.remove();
    note = null;
  }

  var remembered = false;
  try {
    remembered = localStorage.getItem(STORE_KEY) === "1";
  } catch (e) {}
  if (remembered) dismiss();

  // The page carries its own inline handler for the close button; catch the
  // click in the capture phase so the preference is stored before the node goes.
  document.addEventListener(
    "click",
    function (event) {
      var button = event.target.closest && event.target.closest("#mirror-note button");
      if (button) dismiss();
    },
    true
  );

  function announce(message) {
    if (!note) return;
    var text = note.querySelector("span");
    if (!text) return;
    if (!note.dataset.originalText) note.dataset.originalText = text.textContent;
    text.textContent = message;
    note.style.background = "#9A3B26";
    clearTimeout(note._timer);
    note._timer = setTimeout(function () {
      if (!note) return;
      text.textContent = note.dataset.originalText;
      note.style.background = "#14110F";
    }, 5000);
  }

  document.addEventListener(
    "click",
    function (event) {
      var control = event.target.closest && event.target.closest(SELECTOR);
      if (!control) return;
      event.preventDefault();
      event.stopPropagation();
      announce("Static archive — cart, checkout and wishlist are disabled. Everything else in the capture still works.");
    },
    true
  );

  document.addEventListener(
    "submit",
    function (event) {
      var form = event.target;
      if (!form || !form.classList || !form.classList.contains("cart")) return;
      event.preventDefault();
      event.stopPropagation();
      announce("Static archive — the cart is disabled, so this form does not submit.");
    },
    true
  );

  // A few themes add a "loading" class and never clear it when the AJAX call
  // fails; clear it once the page settles.
  window.addEventListener("load", function () {
    setTimeout(function () {
      document.querySelectorAll(".loading").forEach(function (el) {
        el.classList.remove("loading");
      });
    }, 1200);
  });

  // Plugin scripts run at their own pace, so sweep a few times after load.
  sweep();
  [400, 1200, 2500].forEach(function (delay) {
    setTimeout(sweep, delay);
  });
})();
