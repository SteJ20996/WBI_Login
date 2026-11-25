# Launching the WBI Client Portal on Cloudflare

This guide puts the portal live at **https://wealthbuilderins.com** using the WBI Cloudflare account.
Everything is done in web pages: the Cloudflare dashboard and GitHub. No command line is needed.
Plan about 1 to 2 hours, plus waiting time for the domain if its nameservers still have to move.

What you will end up with:

| Address | Who uses it |
|---|---|
| `https://wealthbuilderins.com/` | Clients sign in with their account/contract number and email |
| `https://wealthbuilderins.com/agent/` | The Agent/Financial Specialist signs in with email and password |

The pieces: **Cloudflare Pages** serves the site and runs the sign-in code, **D1** is the database,
**Turnstile** is the "verify you are human" check, and (optional) **Resend** sends sign-in notice emails.

---

## Step 0. Get the code ready on GitHub

1. Merge the pull request that adds the portal into the `main` branch of `WBI_Login`.
2. Decide who owns the repository. A personal GitHub repository cannot have a second owner, and
   Cloudflare can only connect repositories from accounts or organizations the person connecting can
   reach as an owner ("Accounts belonging to other users are not listed, even if they granted you
   repository access" — Cloudflare docs). Pick one:
   - **Recommended:** create a free GitHub **Organization** (github.com → your avatar → *Your organizations*
     → *New organization* → Free). Invite the client and make both of you **Owner**. Then transfer the
     repository: `WBI_Login` → *Settings* → *General* → *Danger Zone* → *Transfer*. Both of you are now
     owners, and either of you can connect it to Cloudflare.
   - **Quick option:** keep the repository under `SteJ20996`. When you connect it in Step 4, sign in to
     GitHub as `SteJ20996` in that browser window, and install the Cloudflare app on that account with
     access to `WBI_Login` only.

## Step 0.5. Workers plan: start on Free

The portal launches on the **Workers Free** plan. Nothing to buy now.

One thing to watch: on Free, each request may use at most 10 ms of processing (CPU) time. Checking an
agent password safely is the one heavy step (agent sign-in, first-time setup, password change), and it
may go over that limit. Step 7 includes a quick test. If it fails, switch to **Workers Paid** ($5/month):
*Workers & Pages* → *Plans* (or *Compute* → *Workers plans*) → *Workers Paid*. No code change is needed.

What else Free means for this portal:
- D1 can restore the database to any minute in the last **7 days** (30 days on Paid). Use
  **Download CSV** in the portal regularly as an extra backup.
- Daily allowances (100,000 requests; 5 million database rows read and 100,000 written) are far above
  what a small client list uses.

## Step 1. Put the domain on Cloudflare

1. Sign in to the WBI Cloudflare account. Open *Account Home* (or *Domains*).
2. If `wealthbuilderins.com` is already listed with status **Active**, go to Step 2.
3. If not: *Add a domain* → enter `wealthbuilderins.com` → choose the **Free** plan → Cloudflare shows two
   nameservers. At the company where the domain was bought, replace its nameservers with those two.
   Wait until Cloudflare shows the domain as **Active** (minutes to a few hours).
   (If the domain was bought through Cloudflare Registrar, it is already Active.)

## Step 2. Create the database (D1)

1. *Storage & Databases* → *D1 SQL Database* → *Create Database*.
2. Name: `wbi-login`. Location: *Western North America* if asked. Click *Create*.
3. Copy the **Database ID** shown on the database page.
4. On GitHub, open `wrangler.toml` in the repository → pencil icon (*Edit this file*) → replace
   `00000000-0000-0000-0000-000000000000` with the Database ID → *Commit changes* to `main`.

The tables are created automatically on the first visit. (They are also in `migrations/0001_init.sql`
if you ever want to create them by hand in the D1 *Console*.)

## Step 3. Create the "verify you are human" widget (Turnstile)

1. *Application security* → *Turnstile* → *Add widget*.
2. Widget name: `WBI Client Portal`. Hostnames: add `wealthbuilderins.com` and `www.wealthbuilderins.com`.
   Also add the `….pages.dev` address you get in Step 4 if you want to test before the domain is connected
   (you can edit the widget later).
3. Widget mode: **Managed**. Pre-clearance: **No**. Click *Create*.
4. Keep the page open; you need the **Site Key** and the **Secret Key** in Step 5.

## Step 4. Create the Pages project and connect GitHub

1. *Workers & Pages* → *Create application* → *Pages* tab → *Import an existing Git repository*
   (or *Connect to Git*).
2. Connect GitHub and choose the account or organization from Step 0, then the repository `WBI_Login`.
3. Set up builds and deployments:
   - Project name: `wbi-login`
   - Production branch: `main`
   - Framework preset: **None**
   - Build command: leave empty
   - Build output directory: `public`
   - Root directory: leave as is (`/`)
4. Click *Save and Deploy*. The first deployment finishes in about a minute.
   The sign-in pages will say the service is unavailable until Step 5 is done; that is expected.

`wrangler.toml` in the repository connects the D1 database to the project (binding name `DB`).
Because of that file, the database binding shows as read-only in the dashboard. That is normal.

5. **Turn off preview deployments.** *Settings* → *Builds* (or *Builds & deployments*) → *Branch control* →
   *Preview branch*: **None** → *Save*. Otherwise every other branch pushed to GitHub would get its own
   public `….pages.dev` address connected to the real client database.

## Step 5. Add the secrets

Pages project `wbi-login` → *Settings* → *Variables and Secrets* → *Add*. For each line below choose
type **Secret**, environment **Production**, then *Save*:

| Name | Value |
|---|---|
| `TURNSTILE_SITE_KEY` | Site Key from Step 3 |
| `TURNSTILE_SECRET_KEY` | Secret Key from Step 3 |
| `SETUP_TOKEN` | Any long random text, e.g. 30+ letters and numbers. Used once in Step 7. |

Optional, for sign-in notice emails (see Step 9): `RESEND_API_KEY` and `NOTIFY_FROM`.

Then apply them: *Deployments* → the latest Production deployment → *⋯* → *Retry deployment*.

## Step 6. Connect the domain

1. Pages project → *Custom domains* → *Set up a custom domain* → `wealthbuilderins.com` → *Continue* →
   *Activate domain*.
2. Repeat for `www.wealthbuilderins.com` (visitors there are sent to the address without `www`).
3. Wait until both show **Active** and the SSL certificate is issued (usually a few minutes).

## Step 7. Create the Agent/Financial Specialist account

1. Open `https://wealthbuilderins.com/agent/`. Because no account exists yet, it shows
   **Create the first Agent/Financial Specialist account**.
2. Enter the `SETUP_TOKEN` from Step 5, the agent's name, email, and a password of at least 12 characters.
3. Sign in with that email and password.
4. The setup page closes for good once an account exists. You may now delete the `SETUP_TOKEN` secret.
5. **Free-plan check:** sign out and sign in again as the agent 4 or 5 times, and once use
   *Change password*. If any attempt shows **Error 1102** ("Worker exceeded resource limits") or
   "Sign-in is temporarily unavailable", switch to Workers Paid (Step 0.5) and try again.

The agent can change the password any time with *Change password* in the portal.

## Step 8. Add the clients

Either one at a time with **+ Add account**, or all at once:

1. In the portal click **Import CSV** → **Download a blank template**.
2. Fill it in Excel or Google Sheets, one client per row, and save as **CSV**:
   - `Account #`: three letters, 8 numbers, 2 numbers, e.g. `WBI-20481937-01` (dashes optional)
   - `Client name`, `Email`
   - `Start date`: `MM/DD/YYYY` or `YYYY-MM-DD`
   - `Total deposit`, `Interest earned`: numbers; `$` and commas are fine
   - `Status` (optional): `Active` or `Deactivated`
3. **Import CSV** → choose the file → *Import*. If any row has a problem, nothing is saved and the
   page lists the line numbers to fix. Importing a file again updates accounts that already exist.

**Download CSV** saves every account to a file. Do this regularly as a backup copy.

## Step 9 (optional). Sign-in notice emails

When set up, a client (and the agent) gets a short email each time their portal account is signed in.
The getwbi.net site already has a verified Resend sending domain (`notify.getwbi.net`), so the quickest
way is to reuse it:

1. Resend → *API Keys* → *Create API key* → permission **Sending access**, domain `notify.getwbi.net`.
2. Add two more Secrets to the Pages project (Step 5): `RESEND_API_KEY` = the new key, and
   `NOTIFY_FROM` = `WBI <portal@notify.getwbi.net>`. Retry the deployment.

(To send from the new domain instead, add `notify.wealthbuilderins.com` as a domain in Resend first,
the same way it was done for getwbi.net, and use that address in `NOTIFY_FROM`.)

## Step 10. Check before telling clients

- [ ] `https://wealthbuilderins.com/` shows the sign-in page with the Cloudflare human check.
- [ ] A test client signs in and sees the right figures; *Sign out* works.
- [ ] Five wrong tries lock that account number for 5 minutes (on that device's network).
- [ ] In `/agent/`, edit the test client's Interest Earned → reload the client page on another device →
      the new figure shows.
- [ ] A deactivated client cannot sign in.
- [ ] Phone check: both pages look right.
- [ ] `https://wealthbuilderins.com/robots.txt` shows `Disallow: /` (the portal stays out of Google).
- [ ] Agent sign-in works every time on the Free plan (Step 7, point 5).
- [ ] Delete the test client.

## Recommended

- Move to **Workers Paid ($5/month)** later if agent sign-in ever fails, or when a 30-day database
  restore window is wanted.
- Keep the Cloudflare account and GitHub organization protected with 2-step verification.
- Never add `TURNSTILE_TEST_BYPASS` in the Cloudflare dashboard. It is only for testing on a computer.
- Optional extra shield: *Security* → *WAF* → *Rate limiting rules* → limit `POST` requests to
  paths starting with `/api/client/login` and `/api/agent/login` (for example 20 per minute per IP).

## If something goes wrong

| What you see | Check |
|---|---|
| "Sign-in is temporarily unavailable" | `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` secrets saved for **Production**, then *Retry deployment* |
| "Please complete the verification again" every time | Turnstile widget hostnames include the exact address in the browser bar |
| "Sign-in is not available yet" under the form | `TURNSTILE_SITE_KEY` is missing |
| Deployment fails mentioning D1 / database | `database_id` in `wrangler.toml` matches the D1 database ID |
| Agent sign-in shows error 1102 or "unavailable" | The Free plan's 10 ms CPU limit was reached: switch to Workers Paid (Step 0.5). To confirm first, look for *Exceeded CPU Time Limits* in the Pages project's *Functions* / *Metrics* view, or for `exceededCpu` in *Real-time logs* |
| `/agent/` says "Almost ready" | `SETUP_TOKEN` secret missing; add it and retry the deployment |
| Error details | Pages project → *Deployments* → a deployment → *Functions* → *Real-time logs* (*Begin log stream*) |
