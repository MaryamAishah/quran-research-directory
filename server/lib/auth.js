import crypto from 'crypto';

const APP_PASSWORD = process.env.APP_PASSWORD || null;
const SESSION_SECRET = process.env.SESSION_SECRET
  || (APP_PASSWORD ? crypto.createHash('sha256').update(APP_PASSWORD).digest('hex') : null);
const COOKIE_NAME = 'qrd_session';
const SESSION_DAYS = 30;

// Auth is entirely opt-in: with no APP_PASSWORD set (the default for local
// use), every check below is a no-op and the app behaves exactly as before.
export function isAuthRequired() {
  return !!APP_PASSWORD;
}

export function verifyPassword(candidate) {
  if (!APP_PASSWORD) return true;
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(APP_PASSWORD);
  if (a.length !== b.length) return false; // timingSafeEqual requires equal-length buffers
  return crypto.timingSafeEqual(a, b);
}

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verify(token) {
  if (!token) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function isRequestAuthenticated(req) {
  if (!isAuthRequired()) return true;
  const cookies = parseCookies(req.headers.cookie);
  return !!verify(cookies[COOKIE_NAME]);
}

export function setSessionCookie(req, res) {
  const token = sign({ exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000 });
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
  ];
  if (isHttps) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`);
}
