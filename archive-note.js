/*
 * Static-archive behaviour for WooCommerce pages.
 *
 * The pages were captured from a running WordPress install, so the cart
 * controls are still in the markup but the endpoints behind them do not exist
 * on static hosting. Rather than let a click fail silently (or navigate to a
 * 404), intercept it and explain what happened.
 */
(function () {
  "use strict";

  var SELECTOR = [
    ".single_add_to_cart_button",
    ".add_to_cart_button",
    "button[name='add-to-cart']",
    "a[href*='add-to-cart=']",
    ".wc-block-components-product-button__button",
    ".tinvwl_add_to_wishlist_button",
  ].join(",");

  function announce(message) {
    var note = document.getElementById("mirror-note");
    if (!note) return;
    var text = note.querySelector("span");
    if (!text) return;
    if (!note.dataset.originalText) note.dataset.originalText = text.textContent;
    text.textContent = message;
    note.style.background = "#9A3B26";
    clearTimeout(note._timer);
    note._timer = setTimeout(function () {
      text.textContent = note.dataset.originalText;
      note.style.background = "#14110F";
    }, 4500);
  }

  document.addEventListener(
    "click",
    function (event) {
      var control = event.target.closest(SELECTOR);
      if (!control) return;
      event.preventDefault();
      event.stopPropagation();
      announce("Static archive — cart, checkout and wishlist are disabled. Browsing works everywhere else.");
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

  // A few themes show a "loading" class and never clear it when the AJAX call
  // fails; clear it once the page settles.
  window.addEventListener("load", function () {
    setTimeout(function () {
      document.querySelectorAll(".loading").forEach(function (el) {
        el.classList.remove("loading");
      });
    }, 1200);
  });
})();
