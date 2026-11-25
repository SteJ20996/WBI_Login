/* Client Portal: sign in with account/contract number + email, then see the account summary. */
(function () {
  "use strict";
  var W = window.WBI, $ = W.$, esc = W.esc;
  var stopIdle = null;
  $("year").textContent = String(new Date().getFullYear());

  function showSignin(message) {
    if (stopIdle) { stopIdle(); stopIdle = null; }
    $("app").innerHTML =
      '<div class="signin-wrap"><div class="card signin-shell">' +
        '<div class="signin-aside"><h1>Client Portal</h1><div class="rule"></div></div>' +
        '<form class="signin" id="login" novalidate>' +
          '<div class="stack"><h2>Sign in</h2><p class="muted small">Enter your account/contract number &amp; your email associated with your account/contract.</p></div>' +
          '<div class="field"><label for="li-no">Account number</label><input id="li-no" autocomplete="username" spellcheck="false" placeholder="ABC-12345678-01" maxlength="15" required></div>' +
          '<div class="field"><label for="li-email">Email</label><input id="li-email" type="email" autocomplete="email" placeholder="name@example.com" required></div>' +
          '<div class="human" id="human"></div>' +
          '<div class="alert bad" id="li-err" role="alert" hidden></div>' +
          '<button class="btn" type="submit" id="li-btn">Sign in</button>' +
          '<div class="notes"><p class="muted small">5 wrong tries lock that account number for 5 minutes.</p><p class="muted small">Need help signing in? Contact your WBI agent.</p></div>' +
        '</form></div></div>';
    W.bindAcctInput($("li-no"));
    var human = W.mountHuman($("human"), "client-login");
    if (message) showError(message);

    $("login").addEventListener("submit", function (e) {
      e.preventDefault();
      var accountNo = W.formatAcct($("li-no").value, true);
      var email = $("li-email").value.trim();
      if (!/^[A-Z]{3}-\d{8}-\d{2}$/.test(accountNo) || !email) return showError("Enter your account number (for example ABC-12345678-01) and your email.");
      if (!human.token()) return showError("Please complete the verification first.");
      var btn = $("li-btn"); btn.disabled = true; btn.textContent = "Signing in…";
      W.api("/api/client/login", { method: "POST", body: { accountNo: accountNo, email: email, turnstileToken: human.token() } }).then(function (res) {
        btn.disabled = false; btn.textContent = "Sign in";
        if (res.ok) return loadAccount(true);
        human.reset();
        showError(W.signinError(res, "account number and email"));
      });
    });
  }

  function showError(msg) { var el = $("li-err"); if (el) { el.textContent = msg; el.hidden = false; } }

  function showAccount(a) {
    $("app").innerHTML =
      '<p class="acct-no">Account Number: <strong class="tabular">' + esc(a.accountNo) + '</strong></p>' +
      '<div class="dash-head"><h1>Welcome, ' + esc(a.name) + '</h1><button class="btn secondary" type="button" id="logout">Sign out</button></div>' +
      '<p class="meta"><span>Account start date:<span class="val tabular">' + esc(W.mdy(a.startDate)) + '</span></span><span>Your total deposit:<span class="val tabular">' + esc(W.money(a.depositCents)) + '</span></span></p>' +
      '<section class="card account" aria-label="Account summary">' +
        '<div class="row row-balance"><span class="lbl">Your account balance:</span><span class="box tabular">' + esc(W.money(a.balanceCents)) + '</span></div>' +
        '<div class="divider"></div>' +
        '<div class="row row-interest"><span class="lbl">Interest Earned:</span><span class="box tabular">' + esc(W.money(a.interestCents)) + '</span></div>' +
      '</section>';
    $("logout").addEventListener("click", function () { signOut(); });
    if (!stopIdle) stopIdle = W.watchIdle(5, function () { stopIdle = null; signOut("You were signed out after 5 minutes without activity."); });
  }

  function signOut(message) {
    W.api("/api/client/logout", { method: "POST" }).then(function () { showSignin(); if (message) W.toast(message); });
  }

  function loadAccount(justSignedIn) {
    W.api("/api/client/me").then(function (res) {
      if (res.ok) showAccount(res.data);
      else showSignin(justSignedIn ? "Sign-in did not complete. Please try again." : "");
    });
  }

  loadAccount(false);
})();
