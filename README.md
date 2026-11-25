# WBI Client Portal

Private client portal for Wealth Builder & Insurances at **wealthbuilderins.com**.

- **Clients** (`/`) sign in with their account/contract number (format `ABC-12345678-01`) and email,
  then see their account number, start date, total deposit, interest earned and account balance.
- **Agent/Financial Specialist** (`/agent/`) signs in with email and password, then views and edits every
  account in a table (50 per page, search, add, edit, deactivate, delete, CSV import and download,
  change log). Changes show up for the client on their next page load. Each agent can change their own
  sign-in email and password; **Main** accounts can add more Agent/Financial Specialist accounts
  (Main or Standard), edit them, reset their passwords, or turn their sign-in off.
- The site is kept out of search engines (`robots.txt`, `X-Robots-Tag`, `noindex`).

**To launch it on Cloudflare, follow [docs/DEPLOY.md](docs/DEPLOY.md).**

## How it is built

| Part | Where |
|---|---|
| Pages (HTML, CSS, browser JS, logo) | `public/` |
| Server code (Cloudflare Pages Functions) | `functions/` (`functions/api/...` is the API) |
| Database (Cloudflare D1, binding `DB`) | schema in `migrations/0001_init.sql`, created automatically on first use |
| Settings | `wrangler.toml` (D1 binding); secrets are added in the Cloudflare dashboard |

### Security in short

- Sign-in for both portals needs Cloudflare **Turnstile**, checked on the server with Siteverify
  (hostname and action must match).
- **5 wrong tries lock** that account number (or agent email) for 5 minutes on that network, and
  30 tries an hour from anywhere lock it for 15 minutes. Every try is counted before the details are
  checked, in one atomic statement, so a burst of parallel requests cannot get past the limit, and a
  stranger elsewhere cannot keep the real owner locked out.
- Changing the agent password signs out every other device. The CSV import saves all rows in one
  transaction (all or nothing) and never re-activates a deactivated client unless the file says so.
- Agent passwords are stored only as **PBKDF2-SHA256** hashes (100,000 rounds, random salt).
- Sessions use random tokens in `__Host-` `HttpOnly; Secure; SameSite=Strict` cookies; only a SHA-256 hash of the
  token is stored. Sessions end after 30 minutes idle on the server, 8 hours at most, and the pages sign
  out after 5 minutes without activity.
- A client session can only read that client's own row. Deactivating, deleting, or changing a client's
  email or account number signs that client out.
- Requests that change data must come from the site's own pages (`Origin` check), and every response
  carries a strict Content-Security-Policy and anti-framing headers.
- Every change in the agent portal is written to the change log (who, when, old → new values).

Known limit: the client sign-in uses account number + email only, as the business requested.
Account numbers appear on paper documents, so the Turnstile check, the lock, and the optional
sign-in notice emails are what protect it.

## Work on it locally

Needs Node.js 20+.

```sh
npm install
cp .dev.vars.example .dev.vars   # local test mode: skips Turnstile on localhost only
npm run dev                      # http://localhost:8788  and  http://localhost:8788/agent/
npm test                         # end-to-end test (starts its own server and database)
npm run typecheck
```

`npm test` runs the API and security checks, imports 300 sample accounts, and, if Chrome is installed
(or `CHROME_PATH` is set), drives both pages in a browser and saves screenshots to `tests/output/`.
