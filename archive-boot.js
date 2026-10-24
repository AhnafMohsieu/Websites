/*
 * Loaded synchronously in <head>, before any WordPress script runs.
 *
 * WooCommerce and the wishlist plugin poll the server on load
 * (?wc-ajax=get_refreshed_fragments and ?wc-ajax=tinvwl). A static host answers
 * 405, and the wishlist script then reads fields off the missing response and
 * throws. Answering the poll locally keeps the console clean, saves two
 * doomed requests per page, and changes nothing on screen.
 */
(function () {
  "use strict";

  var POLL = /[?&]wc-ajax=/;

  function payload(url) {
    return /tinvwl=/.test(url) ? "{}" : '{"fragments":{},"cart_hash":""}';
  }

  function define(xhr, name, value) {
    try {
      Object.defineProperty(xhr, name, { value: value, configurable: true });
    } catch (e) {}
  }

  function finish(xhr, url) {
    var body = payload(url);
    define(xhr, "readyState", 4);
    define(xhr, "status", 200);
    define(xhr, "statusText", "OK");
    define(xhr, "responseText", body);
    define(xhr, "response", body);
    xhr.getAllResponseHeaders = function () {
      return "content-type: application/json\r\n";
    };
    xhr.getResponseHeader = function (name) {
      return /content-type/i.test(name) ? "application/json" : null;
    };
    setTimeout(function () {
      // jQuery 3 listens on load, older transports on readystatechange. Fire
      // whichever the caller registered so the callback runs exactly once.
      if (typeof xhr.onload === "function") {
        try {
          xhr.onload();
        } catch (e) {}
      } else if (typeof xhr.onreadystatechange === "function") {
        try {
          xhr.onreadystatechange();
        } catch (e) {}
      }
    }, 0);
  }

  var Native = window.XMLHttpRequest;
  if (Native) {
    var proto = Native.prototype;
    var nativeOpen = proto.open;
    var nativeSend = proto.send;
    proto.open = function (method, url) {
      this.__archiveUrl = String(url);
      this.__archivePoll = POLL.test(this.__archiveUrl);
      return nativeOpen.apply(this, arguments);
    };
    proto.send = function () {
      if (this.__archivePoll) {
        finish(this, this.__archiveUrl || "");
        return;
      }
      return nativeSend.apply(this, arguments);
    };
  }

  if (window.fetch) {
    var nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      if (POLL.test(url)) {
        return Promise.resolve(
          new Response(payload(url), { status: 200, headers: { "Content-Type": "application/json" } })
        );
      }
      return nativeFetch.call(this, input, init);
    };
  }

  /*
   * Contact Form 7 fetches its form schema from wp-json and throws the failed
   * Response object when the host answers 404. Nothing can consume that error
   * here — the form is blocked at submit — so keep it out of the console.
   */
  window.addEventListener("unhandledrejection", function (event) {
    if (typeof Response !== "undefined" && event.reason instanceof Response) event.preventDefault();
  });

  /*
   * The wishlist plugin caches its state in localStorage under a key it builds
   * from the site hash. With no cache it falls back to a timer that calls its
   * render function with `undefined` and throws. Seed an empty record as soon
   * as the plugin publishes its settings, which is before its script runs, so
   * the render path gets an object it can read.
   */
  try {
    var settings;
    Object.defineProperty(window, "tinvwl_add_to_wishlist", {
      configurable: true,
      get: function () {
        return settings;
      },
      set: function (value) {
        settings = value;
        if (!value || !value.hash_key) return;
        try {
          if (!localStorage.getItem(value.hash_key)) {
            localStorage.setItem(
              value.hash_key,
              JSON.stringify({ products: {}, counter: 0, stats: {}, stats_count: 0 })
            );
          }
        } catch (e) {}
      },
    });
  } catch (e) {}
})();
