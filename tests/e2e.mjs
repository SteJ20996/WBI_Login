// End-to-end test: starts `wrangler pages dev` with a fresh local D1 database and
// checks the API, security rules and (if Chrome is available) the two pages in a browser.
// Run: npm test            (set CHROME_PATH to use a specific Chrome/Chromium)
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const SETUP_TOKEN = 'test-setup-token';
let passed = 0;
const step = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
};

// ---------- 1. schema.ts and the migration file must match ----------
const migration = readFileSync(join(root, 'migrations/0001_init.sql'), 'utf8')
  .split('\n').filter((l) => l.trim() && !l.trim().startsWith('--')).map((l) => l.trim());
const schemaTs = readFileSync(join(root, 'functions/_lib/schema.ts'), 'utf8');
const tsStatements = [...schemaTs.matchAll(/^\s*"(CREATE [^"]+)",?$/gm)].map((m) => m[1]);
assert.deepEqual(tsStatements, migration, 'functions/_lib/schema.ts differs from migrations/0001_init.sql');
console.log('  ok  schema.ts matches migrations/0001_init.sql');

// ---------- 2. start the local server ----------
const state = mkdtempSync(join(tmpdir(), 'wbi-e2e-'));
const server = spawn(
  'npx',
  ['wrangler', 'pages', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', state,
    '--binding', 'TURNSTILE_TEST_BYPASS=true', '--binding', `SETUP_TOKEN=${SETUP_TOKEN}`],
  { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
);
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
// Stop the whole process group (npx -> wrangler -> workerd), not just npx.
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch {} rmSync(state, { recursive: true, force: true }); };
process.on('exit', stop);

try { await fetch(BASE + '/robots.txt'); throw new Error(`Port ${PORT} is already in use; stop the other server first.`); } catch (e) { if (String(e).includes('already in use')) throw e; }
for (let i = 0; ; i++) {
  try { if ((await fetch(BASE + '/robots.txt')).ok) break; } catch {}
  if (i > 120) { console.error(log); throw new Error('wrangler pages dev did not start'); }
  await new Promise((r) => setTimeout(r, 500));
}

// ---------- 3. API ----------
const jar = { agent: '', client: '' };
async function call(path, { method = 'GET', body, who, origin = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (origin && method !== 'GET') headers.Origin = BASE;
  if (who && jar[who]) headers.Cookie = jar[who];
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const set = res.headers.get('set-cookie');
  if (set && who) jar[who] = set.split(';')[0];
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { text }; }
  return { status: res.status, data, headers: res.headers };
}

const names = ['Brian Le', 'Linda Nguyen', 'David Chen', 'Maria Lopez', 'Kevin Park', 'Anna Tran', 'Tuan Pham', 'Mei Wang'];
const rows = Array.from({ length: 300 }, (_, i) => ({
  line: i + 2,
  accountNo: `WBI-${String(20000000 + i * 37).padStart(8, '0')}-01`,
  name: names[i % names.length],
  email: `client${i}@example.com`,
  startDate: i % 2 ? `0${(i % 9) + 1}/15/2023` : '2024-02-29',
  deposit: `$${(10000 + i * 125).toLocaleString('en-US')}.50`,
  interest: String(100 + i),
  active: i !== 7,
}));

console.log('API');
await step('security headers and noindex on every page', async () => {
  const r = await call('/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
});
await step('config reports local test mode', async () => {
  const r = await call('/api/config');
  assert.equal(r.data.localTestMode, true);
});
await step('first-time setup is open, rejects a wrong token and a missing Origin', async () => {
  assert.deepEqual((await call('/api/agent/setup')).data, { needed: true, available: true });
  assert.equal((await call('/api/agent/setup', { method: 'POST', body: { setupToken: 'nope', email: 'kim@example.com', name: 'Kim', password: 'a-long-password-1' } })).status, 401);
  assert.equal((await call('/api/agent/setup', { method: 'POST', origin: false, body: { setupToken: SETUP_TOKEN } })).status, 403);
  assert.equal((await call('/api/agent/setup', { method: 'POST', body: { setupToken: SETUP_TOKEN, email: 'kim@example.com', name: 'Kim', password: 'short' } })).status, 400);
});
await step('first agent is created, then setup closes', async () => {
  const r = await call('/api/agent/setup', { method: 'POST', body: { setupToken: SETUP_TOKEN, email: 'Kim@Example.com', name: 'Kim Dinh', password: 'a-long-password-1' } });
  assert.equal(r.status, 200);
  assert.equal((await call('/api/agent/setup')).data.needed, false);
  assert.equal((await call('/api/agent/setup', { method: 'POST', body: { setupToken: SETUP_TOKEN, email: 'x@example.com', name: 'X', password: 'a-long-password-2' } })).status, 403);
});
await step('agent sign-in locks after 5 wrong tries', async () => {
  for (let i = 1; i <= 4; i++) assert.equal((await call('/api/agent/login', { method: 'POST', body: { email: 'nobody@example.com', password: 'wrong', turnstileToken: 'x' } })).status, 401);
  const fifth = await call('/api/agent/login', { method: 'POST', body: { email: 'nobody@example.com', password: 'wrong', turnstileToken: 'x' } });
  assert.equal(fifth.status, 429);
  assert.ok(fifth.data.retryAfterSec > 290);
});
await step('agent signs in; back office needs that session', async () => {
  assert.equal((await call('/api/agent/accounts')).status, 401);
  assert.equal((await call('/api/agent/login', { method: 'POST', who: 'agent', body: { email: 'kim@example.com', password: 'wrong-one', turnstileToken: 'x' } })).status, 401);
  const r = await call('/api/agent/login', { method: 'POST', who: 'agent', body: { email: 'kim@example.com', password: 'a-long-password-1', turnstileToken: 'x' } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
  assert.equal((await call('/api/agent/me', { who: 'agent' })).data.email, 'kim@example.com');
});
await step('CSV import with one bad row saves nothing', async () => {
  const bad = rows.slice(0, 5).concat([{ ...rows[5], accountNo: 'WB-1' }, { ...rows[6], startDate: '02/30/2024' }]);
  const r = await call('/api/agent/import', { method: 'POST', who: 'agent', body: { rows: bad } });
  assert.equal(r.status, 400);
  assert.equal(r.data.problemCount, 2);
  assert.equal((await call('/api/agent/accounts', { who: 'agent' })).data.allCount, 0);
});
await step('CSV import of 300 accounts', async () => {
  const r = await call('/api/agent/import', { method: 'POST', who: 'agent', body: { rows } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.added, r.data.updated], [300, 0]);
  const again = await call('/api/agent/import', { method: 'POST', who: 'agent', body: { rows: rows.slice(0, 3) } });
  assert.deepEqual([again.data.added, again.data.updated], [0, 3]);
});
let target;
await step('table: 50 per page, totals, search, jump to a given account', async () => {
  const p1 = await call('/api/agent/accounts', { who: 'agent' });
  assert.equal(p1.data.accounts.length, 50);
  assert.deepEqual([p1.data.total, p1.data.pages], [300, 6]);
  const depositSum = rows.reduce((s, r) => s + Math.round(Number(r.deposit.replace(/[$,]/g, '')) * 100), 0);
  assert.equal(p1.data.sums.depositCents, depositSum);
  const p6 = await call('/api/agent/accounts?page=6', { who: 'agent' });
  assert.equal(p6.data.accounts.length, 50);
  const search = await call('/api/agent/accounts?q=' + encodeURIComponent('client29'), { who: 'agent' });
  assert.equal(search.data.total, 11); // client29, client290..299
  const tricky = await call('/api/agent/accounts?q=' + encodeURIComponent('%_'), { who: 'agent' });
  assert.equal(tricky.data.total, 0);
  target = p6.data.accounts[10];
  const focus = await call('/api/agent/accounts?focus=' + target.id, { who: 'agent' });
  assert.equal(focus.data.page, 6);
});
await step('add, duplicate and edit an account', async () => {
  const add = await call('/api/agent/accounts', { method: 'POST', who: 'agent', body: { accountNo: 'abc-12345678-01', name: 'Brian Le', email: 'BRIAN.LE@example.com', startDate: '2023-03-15', deposit: '50000', interest: '6842.17', active: true } });
  assert.equal(add.status, 200);
  const dup = await call('/api/agent/accounts', { method: 'POST', who: 'agent', body: { accountNo: 'ABC-12345678-01', name: 'X', email: 'x@example.com', startDate: '2023-03-15', deposit: '1', interest: '0' } });
  assert.equal(dup.status, 409);
  const bad = await call('/api/agent/accounts', { method: 'POST', who: 'agent', body: { accountNo: 'ABC-12345678-02', name: 'X', email: 'not-an-email', startDate: '2023-03-15', deposit: '1', interest: '0' } });
  assert.equal(bad.status, 400);
  target = { id: add.data.id };
});
await step('client sign-in: wrong email is refused, then locks after 5 tries', async () => {
  const other = rows[20].accountNo;
  for (let i = 1; i <= 4; i++) assert.equal((await call('/api/client/login', { method: 'POST', body: { accountNo: other, email: 'wrong@example.com', turnstileToken: 'x' } })).status, 401);
  assert.equal((await call('/api/client/login', { method: 'POST', body: { accountNo: other, email: 'wrong@example.com', turnstileToken: 'x' } })).status, 429);
  // Even the right email is refused while the lock lasts.
  const locked = await call('/api/client/login', { method: 'POST', body: { accountNo: other, email: rows[20].email, turnstileToken: 'x' } });
  assert.equal(locked.status, 429);
});
await step('client signs in and sees only their own figures', async () => {
  const r = await call('/api/client/login', { method: 'POST', who: 'client', body: { accountNo: 'ABC-12345678-01', email: 'brian.le@example.com', turnstileToken: 'x' } });
  assert.equal(r.status, 200);
  const me = await call('/api/client/me', { who: 'client' });
  assert.deepEqual(me.data, { accountNo: 'ABC-12345678-01', name: 'Brian Le', startDate: '2023-03-15', depositCents: 5000000, interestCents: 684217, balanceCents: 5684217 });
  assert.equal((await call('/api/agent/accounts', { who: 'client' })).status, 401);
});
await step('agent edit shows up for the client right away', async () => {
  const r = await call('/api/agent/accounts/' + target.id, { method: 'PUT', who: 'agent', body: { accountNo: 'ABC-12345678-01', name: 'Brian Le', email: 'brian.le@example.com', startDate: '2023-03-15', deposit: '60,000.00', interest: '7000', active: true } });
  assert.equal(r.status, 200);
  const me = await call('/api/client/me', { who: 'client' });
  assert.equal(me.data.balanceCents, 6700000);
});
await step('deactivating an account signs the client out', async () => {
  await call('/api/agent/accounts/' + target.id, { method: 'PUT', who: 'agent', body: { accountNo: 'ABC-12345678-01', name: 'Brian Le', email: 'brian.le@example.com', startDate: '2023-03-15', deposit: '60000', interest: '7000', active: false } });
  assert.equal((await call('/api/client/me', { who: 'client' })).status, 401);
  assert.equal((await call('/api/client/login', { method: 'POST', body: { accountNo: 'ABC-12345678-01', email: 'brian.le@example.com', turnstileToken: 'x' } })).status, 401);
});
await step('change log records the edits', async () => {
  const log = await call('/api/agent/audit', { who: 'agent' });
  assert.ok(log.data.entries.some((e) => /interest \$6,842\.17 → \$7,000\.00/.test(e.detail)));
  assert.ok(log.data.entries.some((e) => /deactivated/.test(e.detail)));
});
await step('CSV export has every account', async () => {
  const res = await fetch(BASE + '/api/agent/export', { headers: { Cookie: jar.agent } });
  const text = await res.text();
  assert.match(res.headers.get('content-disposition'), /attachment/);
  assert.equal(text.trim().split('\r\n').length, 302);
});
await step('delete an account', async () => {
  assert.equal((await call('/api/agent/accounts/' + target.id, { method: 'DELETE', who: 'agent' })).status, 200);
  assert.equal((await call('/api/agent/accounts/' + target.id, { method: 'DELETE', who: 'agent' })).status, 404);
});
await step('re-import without a Status column keeps a deactivated client deactivated', async () => {
  const off = rows[50];
  const list = await call('/api/agent/accounts?q=' + encodeURIComponent(off.email), { who: 'agent' });
  const id = list.data.accounts[0].id;
  await call('/api/agent/accounts/' + id, { method: 'PUT', who: 'agent', body: { ...off, active: false } });
  const plain = { ...off }; delete plain.active; plain.status = '';
  assert.equal((await call('/api/agent/import', { method: 'POST', who: 'agent', body: { rows: [plain] } })).status, 200);
  assert.equal((await call('/api/agent/accounts?q=' + encodeURIComponent(off.email), { who: 'agent' })).data.accounts[0].active, false);
  const odd = { ...plain, status: 'Closed' };
  const r = await call('/api/agent/import', { method: 'POST', who: 'agent', body: { rows: [odd] } });
  assert.equal(r.status, 400);
  assert.match(r.data.problems[0].message, /Status must be/);
  assert.equal((await call('/api/agent/import', { method: 'POST', who: 'agent', body: { rows: [null] } })).status, 400);
});
await step('many wrong tries sent at once still lock after 5', async () => {
  const acct = rows[60];
  const burst = await Promise.all(Array.from({ length: 12 }, () => call('/api/client/login', { method: 'POST', body: { accountNo: acct.accountNo, email: 'wrong@example.com', turnstileToken: 'x' } })));
  assert.ok(burst.filter((r) => r.status === 401).length <= 5, 'more than 5 wrong tries were checked');
  assert.equal((await call('/api/client/login', { method: 'POST', body: { accountNo: acct.accountNo, email: acct.email, turnstileToken: 'x' } })).status, 429);
});
await step('a lock from one network does not block the owner on another network', async () => {
  const acct = rows[70];
  const from = (ip, email) => fetch(BASE + '/api/client/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, 'CF-Connecting-IP': ip }, body: JSON.stringify({ accountNo: acct.accountNo, email, turnstileToken: 'x' }) });
  for (let i = 0; i < 5; i++) await from('203.0.113.9', 'wrong@example.com');
  assert.equal((await from('203.0.113.9', acct.email)).status, 429);
  assert.equal((await from('198.51.100.7', acct.email)).status, 200);
});
await step('import of 2,000 rows is saved in one go', async () => {
  const big = Array.from({ length: 2000 }, (_, i) => ({ line: i + 2, accountNo: `BIG-${String(30000000 + i).padStart(8, '0')}-01`, name: 'Bulk Test', email: `bulk${i}@example.com`, startDate: '2025-01-02', deposit: '1000', interest: '1', status: '' }));
  const r = await call('/api/agent/import', { method: 'POST', who: 'agent', body: { rows: big } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.added, 2000);
  assert.equal((await call('/api/agent/accounts?q=bulk', { who: 'agent' })).data.total, 2000);
});
await step('change password, sign out, sign in with the new one', async () => {
  assert.equal((await call('/api/agent/password', { method: 'POST', who: 'agent', body: { currentPassword: 'wrong', newPassword: 'another-long-pass-2' } })).status, 400);
  const second = await call('/api/agent/login', { method: 'POST', body: { email: 'kim@example.com', password: 'a-long-password-1', turnstileToken: 'x' } });
  const otherCookie = second.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(BASE + '/api/agent/me', { headers: { Cookie: otherCookie } })).status, 200);
  assert.equal((await call('/api/agent/password', { method: 'POST', who: 'agent', body: { currentPassword: 'a-long-password-1', newPassword: 'another-long-pass-2' } })).status, 200);
  assert.equal((await fetch(BASE + '/api/agent/me', { headers: { Cookie: otherCookie } })).status, 401, 'other device should be signed out');
  assert.equal((await call('/api/agent/me', { who: 'agent' })).status, 200, 'this device stays signed in');
  assert.equal((await call('/api/agent/logout', { method: 'POST', who: 'agent' })).status, 200);
  assert.equal((await call('/api/agent/me', { who: 'agent' })).status, 401);
  assert.equal((await call('/api/agent/login', { method: 'POST', who: 'agent', body: { email: 'kim@example.com', password: 'another-long-pass-2', turnstileToken: 'x' } })).status, 200);
});

// ---------- 4. pages in a real browser ----------
const chrome = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p));
if (!chrome) {
  console.log('Browser checks skipped (no Chrome found; set CHROME_PATH).');
} else {
  console.log('Browser');
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: chrome });
  const out = join(root, 'tests/output');
  mkdirSync(out, { recursive: true });
  const problems = [];
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_TUNNEL|ERR_NAME|net::|401|429/.test(m.text())) problems.push(m.text()); });

  await step('client page: dashes are added while typing, sign-in shows the account', async () => {
    await page.goto(BASE + '/');
    await page.click('#li-no');
    await page.keyboard.type(rows[40].accountNo.replace(/-/g, '').toLowerCase());
    assert.equal(await page.inputValue('#li-no'), rows[40].accountNo);
    await page.fill('#li-email', rows[40].email.toUpperCase());
    await page.click('#li-btn');
    await page.waitForSelector('.row-balance .box');
    assert.match(await page.textContent('.acct-no'), new RegExp(rows[40].accountNo));
    await page.screenshot({ path: join(out, 'client-account.png'), fullPage: true });
    await page.click('#logout');
    await page.waitForSelector('#login');
    await page.screenshot({ path: join(out, 'client-signin.png'), fullPage: true });
  });
  await step('agent page: sign in, 2,300-row table pages, edit dialog saves', async () => {
    await page.goto(BASE + '/agent/');
    await page.fill('#ad-email', 'kim@example.com');
    await page.fill('#ad-pass', 'another-long-pass-2');
    await page.click('#ad-btn');
    await page.waitForSelector('#rows tr[data-edit]');
    assert.equal(await page.locator('#rows tr[data-edit]').count(), 50);
    assert.match(await page.textContent('#pager'), /Page 1 of 46/);
    await page.click('[data-page=next]');
    await page.waitForFunction(() => /Page 2 of 46/.test(document.getElementById('pager').textContent));
    await page.locator('#rows button[data-edit]').first().click();
    await page.fill('#af-int', '999.99');
    assert.match(await page.inputValue('#af-bal'), /\$/);
    await page.click('#af-save');
    await page.waitForFunction(() => !document.getElementById('acct-dlg').open);
    await page.waitForFunction(() => /\$999\.99/.test(document.getElementById('rows').textContent));
    await page.fill('#q', 'client29');
    await page.waitForFunction(() => /all 11 matching/.test(document.getElementById('totals').textContent));
    await page.screenshot({ path: join(out, 'agent-table.png'), fullPage: true });
  });
  await step('no script errors or blocked resources on either page', async () => {
    assert.deepEqual(problems, []);
  });
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  await phone.goto(BASE + '/');
  await phone.waitForSelector('#login');
  await step('phone width: no sideways scrolling', async () => {
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= 390), true);
    await phone.screenshot({ path: join(out, 'client-signin-phone.png'), fullPage: true });
  });
  await browser.close();
}

console.log(`\nAll ${passed + 1} checks passed.`);
stop();
process.exit(0);
