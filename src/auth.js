import crypto from 'node:crypto';
import { config } from './store.js';

const COOKIE = 'vigie_session';
const MAX_AGE = 30 * 86_400_000;
const MAX_ATTEMPTS = 10;
const LOCK_TIME = 15 * 60_000;

const envPassword = () => process.env.ADMIN_PASSWORD || null;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest();

export const passwordFromEnv = () => Boolean(envPassword());
export const needsSetup = () => !envPassword() && !config.settings.passwordHash;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString('base64')}:${hash.toString('base64')}`;
}

export function checkPassword(password) {
  if (typeof password !== 'string' || !password) return false;
  const fromEnv = envPassword();
  if (fromEnv) return crypto.timingSafeEqual(sha256(password), sha256(fromEnv));
  const stored = config.settings.passwordHash;
  if (!stored) return false;
  const [, salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Sessions are signed with the password fingerprint, so changing the
// password signs every existing session out.
function sign(expires) {
  const fingerprint = envPassword() ? sha256(`env:${envPassword()}`).toString('hex') : config.settings.passwordHash;
  return crypto.createHmac('sha256', config.settings.sessionSecret).update(`${expires}|${fingerprint}`).digest('base64url');
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(/;\s*/)) {
    if (part.startsWith(`${name}=`)) return decodeURIComponent(part.slice(name.length + 1));
  }
  return null;
}

export function isAuthenticated(req) {
  const value = readCookie(req, COOKIE);
  if (!value || needsSetup()) return false;
  const [expires, signature] = value.split('.');
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  const expected = sign(expires);
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function startSession(req, res) {
  const expires = String(Date.now() + MAX_AGE);
  res.cookie(COOKIE, `${expires}.${sign(expires)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: MAX_AGE,
    path: '/',
  });
}

export function endSession(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

const attempts = new Map();

export function isLocked(ip) {
  const entry = attempts.get(ip);
  return Boolean(entry && entry.until > Date.now() && entry.count >= MAX_ATTEMPTS);
}

export function recordFailure(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.until < now) attempts.set(ip, { count: 1, until: now + LOCK_TIME });
  else entry.count++;
}

export function clearFailures(ip) {
  attempts.delete(ip);
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of attempts) if (entry.until < now) attempts.delete(ip);
}, LOCK_TIME).unref();
