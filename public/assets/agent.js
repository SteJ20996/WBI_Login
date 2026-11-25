/* Agent/Financial Specialist Portal: sign in, then view and edit every client account. */
(function () {
  "use strict";
  var W = window.WBI, $ = W.$, esc = W.esc;
  var ACCT_RE = /^[A-Z]{3}-\d{8}-\d{2}$/;
  var ui = { me: null, q: "", page: 1, editing: null, armed: false, searchTimer: null, stopIdle: null, importRows: null };
  $("year").textContent = String(new Date().getFullYear());

  var lock = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 4 15h8a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 12 6h-.5V4.5A3.5 3.5 0 0 0 8 1Zm-2 5V4.5a2 2 0 1 1 4 0V6H6Z"/></svg>';

  function signedOut(message) {
    if (ui.stopIdle) { ui.stopIdle(); ui.stopIdle = null; }
    ["acct-dlg", "import-dlg", "pw-dlg"].forEach(function (id) { if ($(id).open) $(id).close(); });
    ui.me = null;
    showSignin(message || "");
  }

  /* ---------- first-time setup ---------- */
  function showSetup() {
    $("app").innerHTML =
      '<div class="signin-wrap narrow"><div class="card signin-shell single">' +
        '<form class="signin" id="setup" novalidate>' +
          '<div class="stack"><h2>Create the first Agent/Financial Specialist account</h2><p class="muted small">This page appears only once, before any account exists. Use the setup token from the Cloudflare settings.</p></div>' +
          '<div class="field"><label for="su-token">Setup token</label><input id="su-token" type="password" autocomplete="off"></div>' +
          '<div class="field"><label for="su-name">Your name</label><input id="su-name" autocomplete="name"></div>' +
          '<div class="field"><label for="su-email">Agent/Financial Specialist email</label><input id="su-email" type="email" autocomplete="username"></div>' +
          '<div class="field"><label for="su-pass">Password (at least 12 characters)</label><input id="su-pass" type="password" autocomplete="new-password"></div>' +
          '<div class="field"><label for="su-again">Password again</label><input id="su-again" type="password" autocomplete="new-password"></div>' +
          '<div class="alert bad" id="su-err" role="alert" hidden></div>' +
          '<button class="btn" type="submit">Create account</button>' +
        '</form></div></div>';
    $("setup").addEventListener("submit", function (e) {
      e.preventDefault();
      var err = function (m) { $("su-err").textContent = m; $("su-err").hidden = false; };
      if ($("su-pass").value !== $("su-again").value) return err("The two passwords do not match.");
      W.api("/api/agent/setup", { method: "POST", body: { setupToken: $("su-token").value, name: $("su-name").value, email: $("su-email").value, password: $("su-pass").value } }).then(function (res) {
        if (res.ok) { var email = $("su-email").value; showSignin(""); $("ad-email").value = email; W.toast("Account created. Sign in to continue."); return; }
        if (res.data.error === "token") return err("The setup token is not correct.");
        if (res.data.error === "locked") return err(W.signinError(res, ""));
        if (res.data.error === "closed") return showSignin("");
        err(res.data.message || "The account could not be created. Please try again.");
      });
    });
  }

  /* ---------- sign-in ---------- */
  function showSignin(message) {
    $("app").innerHTML =
      '<div class="signin-wrap narrow"><div class="card signin-shell single">' +
        '<form class="signin" id="admin-login" novalidate>' +
          '<div class="stack"><h2>Agent/Financial Specialist sign-in</h2><p class="muted small">For WBI staff only.</p></div>' +
          '<div class="field"><label for="ad-email">Agent/Financial Specialist email</label><input id="ad-email" type="email" autocomplete="username" placeholder="name@example.com"></div>' +
          '<div class="field"><label for="ad-pass">Password</label><input id="ad-pass" type="password" autocomplete="current-password"></div>' +
          '<div class="human" id="human"></div>' +
          '<div class="alert bad" id="ad-err" role="alert" hidden></div>' +
          '<button class="btn" type="submit" id="ad-btn">Sign in</button>' +
          '<p class="muted small">5 wrong tries lock Agent/Financial Specialist sign-in for 5 minutes.</p>' +
        '</form></div></div>';
    var human = W.mountHuman($("human"), "agent-login");
    var err = function (m) { $("ad-err").textContent = m; $("ad-err").hidden = false; };
    if (message) err(message);
    $("admin-login").addEventListener("submit", function (e) {
      e.preventDefault();
      var email = $("ad-email").value.trim(), pass = $("ad-pass").value;
      if (!email || !pass) return err("Enter your email and password.");
      if (!human.token()) return err("Please complete the verification first.");
      var btn = $("ad-btn"); btn.disabled = true; btn.textContent = "Signing in…";
      W.api("/api/agent/login", { method: "POST", body: { email: email, password: pass, turnstileToken: human.token() } }).then(function (res) {
        btn.disabled = false; btn.textContent = "Sign in";
        if (res.ok) return start();
        $("ad-pass").value = "";
        human.reset();
        err(W.signinError(res, "email and password"));
      });
    });
  }

  /* ---------- back office ---------- */
  function showOffice() {
    $("app").innerHTML =
      '<div class="admin-bar"><span class="small muted">' + lock + ' Signed in as <strong>' + esc(ui.me.email) + '</strong></span>' +
        '<div class="actions"><button class="btn secondary small" type="button" id="pw-open">Change password</button><button class="btn secondary small" type="button" id="admin-logout">Sign out</button></div></div>' +
      '<section class="card section" aria-labelledby="tbl-title">' +
        '<div class="section-head"><div><h2 id="tbl-title">Client accounts</h2><p class="muted small" id="count"></p></div>' +
          '<div class="tools"><input type="search" id="q" placeholder="Search account #, name, or email" aria-label="Search account #, name, or email">' +
          '<button class="btn small" type="button" id="add-client">+ Add account</button>' +
          '<button class="btn secondary small" type="button" id="import-open">Import CSV</button>' +
          '<a class="btn secondary small" href="/api/agent/export" id="export">Download CSV</a></div></div>' +
        '<div class="table-wrap"><table class="data"><thead><tr><th>Account #</th><th>Client</th><th>Email</th><th>Start Date</th><th class="num">Total Deposit</th><th class="num">Interest Earned</th><th class="num">Total Balance</th><th>Status</th><th></th></tr></thead><tbody id="rows"><tr><td colspan="9" class="empty">Loading…</td></tr></tbody><tfoot id="totals"></tfoot></table></div>' +
        '<div class="pager" id="pager"></div>' +
        '<p class="muted small">Total Balance = Total Deposit + Interest Earned, calculated automatically. Clients see the new figures the next time their page loads.</p>' +
      '</section>' +
      '<details class="card section log-box mt" id="log-box"><summary>Change log</summary><div id="log"><p class="empty">Loading…</p></div></details>';
    $("q").addEventListener("input", function () {
      ui.q = $("q").value; ui.page = 1;
      clearTimeout(ui.searchTimer);
      ui.searchTimer = setTimeout(function () { load(); }, 200);
    });
    $("log-box").addEventListener("toggle", function () { if ($("log-box").open) loadLog(); });
    $("pw-open").addEventListener("click", openPassword);
    $("admin-logout").addEventListener("click", function () { signOut(); });
    $("add-client").addEventListener("click", function () { openAccount(null); });
    $("import-open").addEventListener("click", openImport);
    if (!ui.stopIdle) ui.stopIdle = W.watchIdle(5, function () { ui.stopIdle = null; signOut("You were signed out after 5 minutes without activity."); });
    load();
  }

  function signOut(message) {
    W.api("/api/agent/logout", { method: "POST" }).then(function () { signedOut(); if (message) W.toast(message); });
  }

  function guard(res) {
    if (res.status === 401) { signedOut("Please sign in again."); return false; }
    return true;
  }

  var rowsById = {};
  function load(focusId) {
    var params = new URLSearchParams({ q: ui.q, page: String(ui.page) });
    if (focusId) params.set("focus", String(focusId));
    W.api("/api/agent/accounts?" + params.toString()).then(function (res) {
      if (!guard(res) || !$("rows")) return;
      if (!res.ok) { $("rows").innerHTML = '<tr><td colspan="9" class="empty">The accounts could not load. Please reload the page.</td></tr>'; return; }
      var d = res.data;
      ui.page = d.page;
      rowsById = {};
      $("count").textContent = d.allCount + (d.allCount === 1 ? " account" : " accounts");
      $("rows").innerHTML = d.accounts.length ? d.accounts.map(function (c) {
        rowsById[c.id] = c;
        return '<tr data-edit="' + c.id + '"><td class="tabular"><strong>' + esc(c.accountNo) + '</strong></td><td>' + esc(c.name) + '</td>' +
          '<td class="muted em" title="' + esc(c.email) + '">' + esc(c.email) + '</td><td class="tabular">' + esc(W.mdy(c.startDate)) + '</td>' +
          '<td class="num">' + esc(W.money(c.depositCents)) + '</td><td class="num">' + esc(W.money(c.interestCents)) + '</td><td class="num bal">' + esc(W.money(c.balanceCents)) + '</td>' +
          '<td>' + (c.active ? '<span class="pill good">Active</span>' : '<span class="pill bad">Deactivated</span>') + '</td>' +
          '<td><button class="btn secondary small" type="button" data-edit="' + c.id + '">Edit</button></td></tr>';
      }).join("") : '<tr><td colspan="9" class="empty">' + (ui.q ? "No accounts match this search." : "No accounts yet. Use + Add account or Import CSV.") + '</td></tr>';
      $("totals").innerHTML = d.total ? '<tr><td colspan="4">Total (all ' + d.total + (ui.q ? " matching" : "") + ')</td><td class="num">' + esc(W.money(d.sums.depositCents)) + '</td><td class="num">' + esc(W.money(d.sums.interestCents)) + '</td><td class="num">' + esc(W.money(d.sums.balanceCents)) + '</td><td colspan="2"></td></tr>' : "";
      var from = (d.page - 1) * d.pageSize;
      $("pager").innerHTML = d.total > d.pageSize ?
        '<span class="muted small">Showing ' + (from + 1) + '–' + (from + d.accounts.length) + ' of ' + d.total + '</span>' +
        '<div class="pager-btns"><button class="btn secondary small" type="button" data-page="prev"' + (d.page === 1 ? " disabled" : "") + '>Previous</button>' +
        '<span class="small">Page ' + d.page + ' of ' + d.pages + '</span>' +
        '<button class="btn secondary small" type="button" data-page="next"' + (d.page === d.pages ? " disabled" : "") + '>Next</button></div>' : "";
    });
  }

  function loadLog() {
    W.api("/api/agent/audit").then(function (res) {
      if (!guard(res) || !$("log")) return;
      var list = (res.data.entries || []);
      $("log").innerHTML = list.length ? '<ul class="log">' + list.map(function (a) {
        return '<li><time>' + esc(W.stamp(a.at)) + '</time><span>' + esc(a.detail) + '</span></li>';
      }).join("") + '</ul>' : '<p class="empty">No changes yet.</p>';
    });
  }
  function refreshLog() { if ($("log-box") && $("log-box").open) loadLog(); }

  /* ---------- add / edit / delete ---------- */
  function cents(v) {
    var s = String(v || "").replace(/[$,\s]/g, "");
    if (!/^-?\d{1,11}(\.\d{1,2})?$/.test(s)) return NaN;
    return Math.round(Number(s) * 100);
  }
  function updateBal() {
    var d = cents($("af-dep").value), i = cents($("af-int").value);
    $("af-bal").value = isNaN(d) || isNaN(i) ? "" : W.money(d + i);
  }
  function openAccount(id) {
    var c = id ? rowsById[id] : null;
    ui.editing = c ? c.id : null; ui.armed = false;
    $("acct-title").textContent = c ? "Edit account" : "New account";
    $("af-no").value = c ? c.accountNo : "";
    $("af-start").value = c ? c.startDate : new Date().toISOString().slice(0, 10);
    $("af-name").value = c ? c.name : "";
    $("af-email").value = c ? c.email : "";
    $("af-dep").value = c ? W.plain(c.depositCents) : "";
    $("af-int").value = c ? W.plain(c.interestCents) : "0.00";
    $("af-active").checked = c ? c.active : true;
    $("af-last").textContent = c ? (c.lastLoginAt ? "Last sign-in: " + W.stamp(c.lastLoginAt) : "This client has not signed in yet.") : "";
    $("af-err").hidden = true;
    var del = $("af-delete"); del.hidden = !c; del.classList.remove("armed"); del.textContent = "Delete account";
    updateBal();
    $("acct-dlg").showModal();
  }
  function saveAccount() {
    var fail = function (m) { $("af-err").textContent = m; $("af-err").hidden = false; };
    var body = {
      accountNo: W.formatAcct($("af-no").value, true),
      name: $("af-name").value.trim(),
      email: $("af-email").value.trim(),
      startDate: $("af-start").value,
      deposit: $("af-dep").value,
      interest: $("af-int").value,
      active: $("af-active").checked
    };
    if (!ACCT_RE.test(body.accountNo)) return fail("Account # must be three letters, 8 numbers, then 2 numbers, for example WBI-20481937-01.");
    if (isNaN(cents(body.deposit)) || isNaN(cents(body.interest))) return fail("Enter amounts as numbers, for example 50000 or 6842.17.");
    var save = $("af-save"); save.disabled = true;
    var req = ui.editing ? W.api("/api/agent/accounts/" + ui.editing, { method: "PUT", body: body }) : W.api("/api/agent/accounts", { method: "POST", body: body });
    req.then(function (res) {
      save.disabled = false;
      if (!guard(res)) return;
      if (!res.ok) return fail(res.data.message || "The account could not be saved. Please try again.");
      $("acct-dlg").close();
      load(res.data.id);
      refreshLog();
      W.toast("Saved. The client sees the change the next time their page loads.");
    });
  }
  function deleteAccount() {
    var del = $("af-delete");
    if (!ui.armed) { ui.armed = true; del.classList.add("armed"); del.textContent = "Click again to delete"; return; }
    W.api("/api/agent/accounts/" + ui.editing, { method: "DELETE" }).then(function (res) {
      if (!guard(res)) return;
      if (!res.ok) { $("af-err").textContent = res.data.message || "The account could not be deleted."; $("af-err").hidden = false; return; }
      $("acct-dlg").close(); load(); refreshLog(); W.toast("Account deleted.");
    });
  }

  /* ---------- CSV import ---------- */
  function parseCsv(text) {
    var rows = [], row = [], field = "", i = 0, q = false;
    text = text.replace(/^﻿/, "");
    while (i < text.length) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(field); rows.push(row); row = []; field = ""; }
      else field += ch;
      i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
  var COLUMNS = {
    accountNo: ["account", "accountno", "accountnumber", "contract", "contractnumber", "accountcontractnumber"],
    name: ["clientname", "name", "client"],
    email: ["email", "emailaddress"],
    startDate: ["startdate", "accountstartdate", "start"],
    deposit: ["totaldeposit", "deposit"],
    interest: ["interestearned", "interest"],
    status: ["status", "active"]
  };
  function readRows(text) {
    var table = parseCsv(text).filter(function (r) { return r.some(function (c) { return c.trim() !== ""; }); });
    if (table.length < 2) return { error: "The file has no account rows." };
    var head = table[0].map(function (h) { return h.toLowerCase().replace(/[^a-z0-9]/g, ""); });
    var at = {};
    Object.keys(COLUMNS).forEach(function (k) { at[k] = head.findIndex(function (h) { return COLUMNS[k].indexOf(h) > -1; }); });
    var missing = ["accountNo", "name", "email", "startDate", "deposit", "interest"].filter(function (k) { return at[k] < 0; });
    if (missing.length) return { error: "Missing column(s): " + missing.map(function (k) { return { accountNo: "Account #", name: "Client name", email: "Email", startDate: "Start date", deposit: "Total deposit", interest: "Interest earned" }[k]; }).join(", ") + "." };
    return {
      rows: table.slice(1).map(function (r, n) {
        var get = function (k) { return at[k] < 0 ? "" : String(r[at[k]] || "").trim(); };
        return {
          line: n + 2,
          accountNo: W.formatAcct(get("accountNo"), true),
          name: get("name"), email: get("email"), startDate: get("startDate"),
          deposit: get("deposit"), interest: get("interest"),
          status: get("status") // empty = keep the saved status (new accounts start Active)
        };
      })
    };
  }
  function openImport() {
    ui.importRows = null;
    $("im-file").value = ""; $("im-summary").textContent = ""; $("im-err").hidden = true; $("im-ok").hidden = true;
    $("im-go").disabled = true; $("im-go").textContent = "Import";
    $("import-dlg").showModal();
  }
  function showImportProblems(title, list) {
    $("im-err").innerHTML = esc(title) + (list && list.length ? '<ul class="problems">' + list.map(function (p) { return "<li>Line " + p.line + ": " + esc(p.message) + "</li>"; }).join("") + "</ul>" : "");
    $("im-err").hidden = false;
  }

  /* ---------- password ---------- */
  function openPassword() {
    ["pw-current", "pw-new", "pw-again"].forEach(function (id) { $(id).value = ""; });
    $("pw-err").hidden = true;
    $("pw-dlg").showModal();
  }

  /* ---------- events ---------- */
  document.addEventListener("click", function (e) {
    var el = e.target.closest("button, tr[data-edit]");
    if (!el) return;
    if (el.dataset.page) { ui.page += el.dataset.page === "next" ? 1 : -1; load(); var tw = document.querySelector(".table-wrap"); if (tw) tw.scrollIntoView({ block: "start" }); return; }
    if (el.dataset.edit) return openAccount(Number(el.dataset.edit));
    if (el.id === "af-cancel") return $("acct-dlg").close();
    if (el.id === "af-delete") return deleteAccount();
    if (el.id === "pw-cancel") return $("pw-dlg").close();
    if (el.id === "im-close") return $("import-dlg").close();
    if (el.id === "im-template") {
      var blob = new Blob(["Account #,Client name,Email,Start date,Total deposit,Interest earned,Status\r\nWBI-12345678-01,Jane Sample,jane@example.com,01/15/2024,50000.00,1250.75,Active\r\n"], { type: "text/csv" });
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "wbi-accounts-template.csv";
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      return;
    }
    if (el.id === "im-go" && ui.importRows) {
      el.disabled = true; el.textContent = "Importing…";
      W.api("/api/agent/import", { method: "POST", body: { rows: ui.importRows } }).then(function (res) {
        el.textContent = "Import";
        if (!guard(res)) return;
        if (!res.ok) { el.disabled = false; return showImportProblems(res.data.problems ? "Nothing was saved. Fix these rows and try again" + (res.data.problemCount > res.data.problems.length ? " (first " + res.data.problems.length + " of " + res.data.problemCount + " shown)" : "") + ":" : (res.data.message || "The import did not work. Please try again."), res.data.problems); }
        ui.importRows = null;
        $("im-err").hidden = true;
        $("im-ok").textContent = "Done: " + res.data.added + " added, " + res.data.updated + " updated.";
        $("im-ok").hidden = false;
        ui.page = 1; load(); refreshLog();
      });
    }
  });
  document.addEventListener("change", function (e) {
    if (e.target.id !== "im-file") return;
    var file = e.target.files && e.target.files[0];
    $("im-err").hidden = true; $("im-ok").hidden = true; $("im-go").disabled = true; ui.importRows = null;
    if (!file) { $("im-summary").textContent = ""; return; }
    if (file.size > 1500000) return showImportProblems("This file is too large. Split it into files of up to 2,000 rows.");
    file.text().then(function (text) {
      var out = readRows(text);
      if (out.error) { $("im-summary").textContent = ""; return showImportProblems(out.error); }
      ui.importRows = out.rows;
      $("im-summary").textContent = out.rows.length + " account row" + (out.rows.length === 1 ? "" : "s") + " found in " + file.name + ".";
      $("im-go").disabled = false;
      $("im-go").textContent = "Import " + out.rows.length + " row" + (out.rows.length === 1 ? "" : "s");
    });
  });
  document.addEventListener("input", function (e) {
    if (e.target.id === "af-dep" || e.target.id === "af-int") updateBal();
  });
  W.bindAcctInput($("af-no"));
  $("acct-form").addEventListener("submit", function (e) { e.preventDefault(); saveAccount(); });
  $("pw-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var err = function (m) { $("pw-err").textContent = m; $("pw-err").hidden = false; };
    if ($("pw-new").value !== $("pw-again").value) return err("The two new passwords do not match.");
    W.api("/api/agent/password", { method: "POST", body: { currentPassword: $("pw-current").value, newPassword: $("pw-new").value } }).then(function (res) {
      if (!guard(res)) return;
      if (!res.ok) return err(res.data.message || "The password could not be changed.");
      $("pw-dlg").close(); refreshLog(); W.toast("Password changed.");
    });
  });

  /* ---------- start ---------- */
  function start() {
    W.api("/api/agent/me").then(function (res) {
      if (res.ok) { ui.me = res.data; ui.q = ""; ui.page = 1; return showOffice(); }
      W.api("/api/agent/setup").then(function (s) {
        if (s.ok && s.data.needed && s.data.available) return showSetup();
        if (s.ok && s.data.needed) {
          $("app").innerHTML = '<div class="signin-wrap narrow"><div class="card signin-shell single"><div class="signin"><h2>Almost ready</h2><p class="muted">No Agent/Financial Specialist account exists yet. Add a SETUP_TOKEN secret in Cloudflare, then reload this page to create the first account.</p></div></div></div>';
          return;
        }
        showSignin("");
      });
    });
  }
  start();
})();
