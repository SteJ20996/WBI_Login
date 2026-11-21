export const MIN_PASSWORD = 12;

/** Account / contract number: three letters, 8 digits, 2 digits, e.g. WBI-20481937-01. */
export const ACCOUNT_RE = /^[A-Z]{3}-\d{8}-\d{2}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export function normalizeAccount(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}

/** Accepts YYYY-MM-DD or MM/DD/YYYY. Returns YYYY-MM-DD, or '' when it is not a real date. */
export function normalizeDate(value: unknown): string {
  if (typeof value !== 'string') return '';
  const v = value.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v))) [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return '';
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || y < 1900 || y > 2200) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Dollar amount ("50000", "$50,000.00", 6842.17) to whole cents. Returns null when invalid. */
export function toCents(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.replace(/[$,\s]/g, '') : '';
  const match = /^(-?)(\d{1,11})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const cents = Number(match[2]) * 100 + Number((match[3] || '').padEnd(2, '0'));
  return match[1] ? -cents : cents;
}

export function cleanName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
}

export interface AccountInput {
  account_no: string;
  name: string;
  email: string;
  start_date: string;
  deposit_cents: number;
  interest_cents: number;
  /** 1 = can sign in, 0 = deactivated, null = not given in an import (keep what is saved). */
  active: number | null;
}

/** Checks one account record. Returns the clean record or a plain-English error. */
export function parseAccount(body: Record<string, unknown>): { ok: true; value: AccountInput } | { ok: false; error: string } {
  const account_no = normalizeAccount(body.accountNo);
  if (!ACCOUNT_RE.test(account_no)) return { ok: false, error: 'Account # must be three letters, 8 numbers, then 2 numbers, for example WBI-20481937-01.' };
  const name = cleanName(body.name);
  if (!name) return { ok: false, error: "Enter the client's name." };
  const email = normalizeEmail(body.email);
  if (!isEmail(email)) return { ok: false, error: 'Enter a valid email address.' };
  const start_date = normalizeDate(body.startDate);
  if (!start_date) return { ok: false, error: 'Enter a valid start date.' };
  const deposit_cents = toCents(body.deposit);
  const interest_cents = toCents(body.interest);
  if (deposit_cents === null || interest_cents === null) return { ok: false, error: 'Enter amounts as numbers, for example 50000 or 6842.17.' };
  if (deposit_cents < 0) return { ok: false, error: 'Total Deposit cannot be negative.' };
  let active: number | null;
  if ('status' in body) {
    // CSV import: Status column is optional; unknown words are refused rather than guessed.
    const status = typeof body.status === 'string' ? body.status.trim().toLowerCase() : '';
    if (status === '') active = null;
    else if (/^(active|yes|true|1)$/.test(status)) active = 1;
    else if (/^(deactivated|inactive|no|false|0)$/.test(status)) active = 0;
    else return { ok: false, error: 'Status must be Active or Deactivated (or left empty).' };
  } else {
    active = body.active === false || body.active === 0 || body.active === '0' ? 0 : 1;
  }
  return { ok: true, value: { account_no, name, email, start_date, deposit_cents, interest_cents, active } };
}

export function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}
