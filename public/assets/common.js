/* Shared helpers for the client page and the agent page. */
(function () {
  "use strict";
  var W = (window.WBI = {});

  W.$ = function (id) { return document.getElementById(id); };

  W.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  /** Cents to "$1,234.56". */
  W.money = function (cents) {
    var n = Number(cents) || 0, sign = n < 0 ? "-" : "", a = Math.abs(n);
    return sign + "$" + Math.floor(a / 100).toLocaleString("en-US") + "." + String(a % 100).padStart(2, "0");
  };

  /** Cents to "1234.56" for form fields. */
  W.plain = function (cents) { return ((Number(cents) || 0) / 100).toFixed(2); };

  /** "2023-03-15" to "03/15/2023". */
  W.mdy = function (iso) {
    if (!iso) return "";
    var p = String(iso).split("-");
    return p[1] + "/" + p[2] + "/" + p[0];
  };

  W.stamp = function (ms) {
    return new Intl.DateTimeFormat("en-US", { month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
  };

  /**
   * Account / contract number: three letters, 8 numbers, 2 numbers (WBI-20481937-01).
   * Both dashes appear by themselves while typing.
   */
  W.formatAcct = function (v, deleting) {
    var str = String(v || "");
    var dashes = (str.match(/-/g) || []).length;
    var raw = str.toUpperCase().replace(/[^A-Z0-9]/g, "");
    var letters = "", i = 0;
    while (i < raw.length && letters.length < 3) { if (/[A-Z]/.test(raw[i])) letters += raw[i]; i++; }
    var digits = raw.slice(i).replace(/\D/g, "").slice(0, 10);
    var mid = digits.slice(0, 8), tail = digits.slice(8);
    var out = letters;
    if (letters.length === 3 && (digits.length > 0 || !deleting || dashes >= 1)) out += "-";
    out += mid;
    if (mid.length === 8 && (tail.length > 0 || !deleting || dashes >= 2)) out += "-";
    return out + tail;
  };

  W.bindAcctInput = function (input) {
    input.addEventListener("input", function (e) {
      input.value = W.formatAcct(input.value, String(e.inputType || "").indexOf("delete") === 0);
    });
  };

  /** JSON request to this site's API. Never throws; returns { status, ok, data }. */
  W.api = function (path, opts) {
    opts = opts || {};
    var init = { method: opts.method || "GET", credentials: "same-origin", headers: {} };
    if (opts.body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
    return fetch(path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, ok: res.ok, data: data || {} }; });
    }, function () { return { status: 0, ok: false, data: { error: "network" } }; });
  };

  W.toast = function (msg) {
    var box = W.$("toasts"), el = document.createElement("div");
    el.className = "toast"; el.textContent = msg; box.appendChild(el);
    setTimeout(function () { el.remove(); }, 6000);
  };

  /** Plain-English messages for sign-in errors. */
  W.signinError = function (res, what) {
    var d = res.data || {};
    if (res.status === 429 && d.error === "locked") {
      var min = Math.max(1, Math.ceil((d.retryAfterSec || 300) / 60));
      return "Too many attempts. Try again in " + min + " minute" + (min === 1 ? "" : "s") + ".";
    }
    if (d.error === "verification") return "Please complete the verification again.";
    if (d.error === "unavailable" || res.status === 503) return "Sign-in is temporarily unavailable. Please try again later.";
    if (res.status === 0) return "No connection. Check your internet and try again.";
    return "We couldn't sign you in. Check the " + what + ", then try again.";
  };

  /* ---------- Cloudflare Turnstile (the "verify you are human" check) ---------- */
  var configPromise = null, scriptPromise = null;
  function config() {
    if (!configPromise) configPromise = W.api("/api/config").then(function (r) { return r.data || {}; });
    return configPromise;
  }
  function loadScript() {
    if (!scriptPromise) {
      scriptPromise = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        s.async = true;
        s.onload = function () { resolve(window.turnstile); };
        s.onerror = function () { scriptPromise = null; reject(new Error("turnstile")); };
        document.head.appendChild(s);
      });
    }
    return scriptPromise;
  }

  /** Puts the human check in `box`. Returns { token(), reset() }. */
  W.mountHuman = function (box, action) {
    var state = { token: "", id: null, local: false };
    var ctl = {
      token: function () { return state.local ? "local-test" : state.token; },
      reset: function () { state.token = ""; if (state.id !== null && window.turnstile) window.turnstile.reset(state.id); }
    };
    config().then(function (cfg) {
      if (cfg.localTestMode) {
        state.local = true;
        box.innerHTML = '<p class="human-note">Local test mode: the human check is skipped on this computer only.</p>';
        return;
      }
      if (!cfg.turnstileSiteKey) {
        box.innerHTML = '<p class="human-note">Sign-in is not available yet. Please try again later.</p>';
        return;
      }
      loadScript().then(function (ts) {
        state.id = ts.render(box, {
          sitekey: cfg.turnstileSiteKey,
          action: action,
          theme: "auto",
          size: "flexible",
          callback: function (t) { state.token = t; },
          "expired-callback": function () { state.token = ""; },
          "error-callback": function () { state.token = ""; }
        });
      }, function () {
        box.innerHTML = '<p class="human-note">The verification could not load. Check your connection and reload the page.</p>';
      });
    });
    return ctl;
  };

  /** Calls onIdle after `minutes` without any activity. Returns a stop function. */
  W.watchIdle = function (minutes, onIdle) {
    var last = Date.now();
    function touch() { last = Date.now(); }
    var events = ["click", "keydown", "pointermove", "scroll", "touchstart"];
    events.forEach(function (ev) { document.addEventListener(ev, touch, { passive: true }); });
    var timer = setInterval(function () { if (Date.now() - last > minutes * 60000) { stop(); onIdle(); } }, 15000);
    function stop() { clearInterval(timer); events.forEach(function (ev) { document.removeEventListener(ev, touch); }); }
    return stop;
  };
})();
