'use strict';
// Trainingsplan – Server ohne externe Abhängigkeiten.
// - Pro Person eine JSON-Datei in DATA_DIR/users
// - PINs werden mit scrypt gehasht gespeichert
// - Anmeldung liefert signierte Tokens (HMAC), Trainer-PIN kommt aus der Umgebungsvariable TRAINER_PIN
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = +process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');
const TRAINER_PIN = String(process.env.TRAINER_PIN || '');
const PIN_RE = /^\d{4,8}$/;
const USER_TOKEN_MS = 30 * 24 * 3600 * 1000; // 30 Tage
const TRAINER_TOKEN_MS = 12 * 3600 * 1000;   // 12 Stunden

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/library.json': ['library.json', 'application/json; charset=utf-8'],
};

fs.mkdirSync(USERS_DIR, { recursive: true });
// Migration: Dateien der Vorgängerversion (direkt in DATA_DIR) nach users/ verschieben
for (const f of fs.readdirSync(DATA_DIR)) {
  if (f.endsWith('.json')) { try { fs.renameSync(path.join(DATA_DIR, f), path.join(USERS_DIR, f)); } catch {} }
}

// Signatur-Schlüssel (einmalig erzeugt, bleibt im Datenordner erhalten)
const SECRET_FILE = path.join(DATA_DIR, '.secret');
let SECRET;
try { SECRET = fs.readFileSync(SECRET_FILE); } catch {
  SECRET = crypto.randomBytes(32);
  fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 });
}

const rid = () => Math.random().toString(36).slice(2, 9);
const validId = (id) => /^[a-z0-9-]{1,48}$/.test(id);
const fileOf = (id) => path.join(USERS_DIR, id + '.json');
const read = (id) => { try { return JSON.parse(fs.readFileSync(fileOf(id), 'utf8')); } catch { return null; } };
const write = (id, data) => {
  const tmp = fileOf(id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, fileOf(id));
};
const slug = (n) =>
  n.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'person';

// ---- PIN-Hashing, Tokens, Sperre bei Fehlversuchen ----
function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(pin, salt, 32).toString('hex');
}
function checkPin(pin, stored) {
  if (!stored) return false;
  const [s, h] = stored.split(':');
  const calc = crypto.scryptSync(pin, Buffer.from(s, 'hex'), 32);
  return crypto.timingSafeEqual(calc, Buffer.from(h, 'hex'));
}
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const checkTrainerPin = (pin) => TRAINER_PIN !== '' && crypto.timingSafeEqual(sha(pin), sha(TRAINER_PIN));
const fp = (u) => (u && u.pin ? u.pin.slice(-12) : ''); // ändert sich mit der PIN → alte Tokens werden ungültig

function sign(payload) {
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
}
function verify(token) {
  if (!token) return null;
  const [p, s] = token.split('.');
  if (!p || !s) return null;
  const e = crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
  if (s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null;
  try { const d = JSON.parse(Buffer.from(p, 'base64url').toString()); return d.exp > Date.now() ? d : null; } catch { return null; }
}
function auth(req) {
  const h = req.headers.authorization || '';
  return verify(h.startsWith('Bearer ') ? h.slice(7) : '');
}
const userToken = (id, u) => sign({ r: 'u', id, k: fp(u), exp: Date.now() + USER_TOKEN_MS });

const fails = new Map();
function locked(key) {
  const f = fails.get(key);
  if (!f) return 0;
  if (f.n >= 5 && Date.now() >= f.until) { fails.delete(key); return 0; }
  return f.n >= 5 ? Math.ceil((f.until - Date.now()) / 1000) : 0;
}
function fail(key) {
  const f = fails.get(key) || { n: 0, until: 0 };
  f.n++; if (f.n >= 5) f.until = Date.now() + 5 * 60 * 1000;
  fails.set(key, f);
}

// ---- Daten ----
function defaultState(name, pinHash) {
  const ex = (n, sets, reps, weight) => ({ id: rid(), name: n, sets, reps: String(reps), weight, note: '' });
  return {
    name,
    pin: pinHash,
    days: [
      { id: rid(), name: 'Tag A – Push', exercises: [
        ex('Bankdrücken', 3, '8-10', 40), ex('Schulterdrücken', 3, '10', 20),
        ex('Seitheben', 3, '12', 8), ex('Trizepsdrücken', 3, '12', 20) ] },
      { id: rid(), name: 'Tag B – Pull', exercises: [
        ex('Latziehen', 3, '10', 45), ex('Rudern am Kabel', 3, '10', 40),
        ex('Face Pulls', 3, '15', 20), ex('Bizeps-Curls', 3, '12', 10) ] },
      { id: rid(), name: 'Tag C – Beine', exercises: [
        ex('Beinpresse', 3, '10', 80), ex('Rumänisches Kreuzheben', 3, '8', 50),
        ex('Beinbeuger', 3, '12', 30), ex('Wadenheben', 3, '15', 40) ] },
    ],
    history: [],
    sessions: {},
    custom: [],
    settings: { rest: 90, auto: true, sound: true, vibrate: true },
  };
}

function listUsers() {
  return fs.readdirSync(USERS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const id = f.slice(0, -5); const d = read(id);
      if (!d) return null;
      const h = d.history || [];
      return { id, name: d.name, sessions: h.length, last: h.length ? h[h.length - 1].date : null };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 2e6) { reject(new Error('Anfrage zu groß')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > max) { reject(new Error('Bild zu groß')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const COMMONS = process.env.COMMONS_API || 'https://commons.wikimedia.org/w/api.php';
const IMG_HOST = process.env.IMG_HOST || 'upload.wikimedia.org'; // nur von hier werden Bilder geladen
const UA = 'Trainingsplan/1.0 (selbst gehostete Trainingsplan-App)';
const stripHtml = (h) => String(h || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/\s+/g, ' ').trim().slice(0, 120);
async function searchImages(q) {
  const u = new URL(COMMONS);
  Object.entries({ action: 'query', generator: 'search', gsrnamespace: '6', gsrlimit: '18', gsrsearch: q + ' filetype:bitmap', prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: '640', format: 'json', origin: '*' }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error('Status ' + r.status);
  const j = await r.json();
  return Object.values((j.query && j.query.pages) || {})
    .sort((x, y) => (x.index || 0) - (y.index || 0))
    .map((pg) => {
      const ii = pg.imageinfo && pg.imageinfo[0]; if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime || '')) return null;
      const md = ii.extmetadata || {};
      return { thumb: ii.thumburl || ii.url, title: String(pg.title || '').replace(/^File:/, '').replace(/\.\w+$/, '').slice(0, 90),
        credit: [stripHtml(md.Artist && md.Artist.value) || 'Unbekannt', stripHtml(md.LicenseShortName && md.LicenseShortName.value)].filter(Boolean).join(', '), page: ii.descriptionurl || '' };
    })
    .filter((x) => x && x.thumb);
}
async function fetchImage(url) {
  let u; try { u = new URL(url); } catch { throw new Error('Ungültige Adresse'); }
  if (u.hostname !== IMG_HOST || !['https:', 'http:'].includes(u.protocol) || (u.protocol === 'http:' && !process.env.IMG_HOST)) throw new Error('Nur Bilder von ' + IMG_HOST + ' erlaubt');
  const r = await fetch(u, { headers: { 'User-Agent': UA }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('Status ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 3e6) throw new Error('Bild zu groß');
  const ext = imgExt(buf); if (!ext) throw new Error('Kein gültiges Bild');
  const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(IMG_DIR, name), buf);
  return '/img/u/' + name;
}
const IMG_DIR = path.join(DATA_DIR, 'img');
fs.mkdirSync(IMG_DIR, { recursive: true });
const IMG_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
function imgExt(b) { // Dateityp an den ersten Bytes erkennen, nicht am Namen
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b.length > 12 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://x').pathname;
    const ip = req.socket.remoteAddress || '';
    const method = req.method;

    if (method === 'GET' && STATIC[p]) {
      const [f, type] = STATIC[p];
      return send(res, 200, fs.readFileSync(path.join(__dirname, f)), type);
    }
    if (method === 'GET' && p === '/sw.js') { // Service Worker: nie zwischenspeichern, damit Updates ankommen
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
      return res.end(fs.readFileSync(path.join(__dirname, 'sw.js')));
    }
    if (method === 'GET' && p === '/manifest.webmanifest') {
      res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(fs.readFileSync(path.join(__dirname, 'manifest.webmanifest')));
    }
    const icon = method === 'GET' && p.match(/^\/icons\/([a-z0-9-]+\.png)$/);
    if (icon) {
      try {
        const buf = fs.readFileSync(path.join(__dirname, 'icons', icon[1]));
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
        return res.end(buf);
      } catch { return send(res, 404, { error: 'Nicht gefunden' }); }
    }
    const font = method === 'GET' && p.match(/^\/fonts\/([a-z0-9-]+\.woff2)$/);
    if (font) { // gebündelte Schriften (offline nutzbar), lange zwischenspeichern
      try {
        const buf = fs.readFileSync(path.join(__dirname, 'fonts', font[1]));
        res.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=31536000, immutable' });
        return res.end(buf);
      } catch { return send(res, 404, { error: 'Nicht gefunden' }); }
    }
    // Übungsfotos: mitgelieferte (img/lib) und hochgeladene (DATA_DIR/img), Dateinamen sind nicht erratbar
    const img = method === 'GET' && p.match(/^\/img\/(lib|u)\/([a-z0-9-]+\.(?:jpg|png|webp))$/);
    if (img) {
      try {
        const buf = fs.readFileSync(path.join(img[1] === 'lib' ? path.join(__dirname, 'img', 'lib') : IMG_DIR, img[2]));
        res.writeHead(200, { 'Content-Type': IMG_TYPES[img[2].split('.').pop()], 'Cache-Control': 'public, max-age=86400' });
        return res.end(buf);
      } catch { return send(res, 404, { error: 'Nicht gefunden' }); }
    }
    if (p === '/healthz') return send(res, 200, { ok: true });
    if (!p.startsWith('/api/')) return send(res, 404, { error: 'Nicht gefunden' });

    const a = auth(req);

    if (p === '/api/session' && method === 'GET') {
      return a ? send(res, 200, { role: a.r, id: a.id || null }) : send(res, 401, { error: 'Nicht angemeldet' });
    }

    if (p === '/api/img' && method === 'POST') {
      const cu = a && a.r === 'u' ? read(a.id) : null;
      if (!a || (a.r === 'u' && !(cu && a.k === fp(cu)))) return send(res, 401, { error: 'Nicht angemeldet' });
      const buf = await readRaw(req, 2.5e6);
      const ext = imgExt(buf);
      if (!ext) return send(res, 400, { error: 'Nur JPG-, PNG- oder WebP-Bilder erlaubt' });
      const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
      fs.writeFileSync(path.join(IMG_DIR, name), buf);
      return send(res, 201, { url: '/img/u/' + name });
    }

    // Bildersuche im Internet (Wikimedia Commons, freie Lizenzen). Der Server sucht und lädt, der Browser kontaktiert keine Fremdseite.
    if ((p === '/api/imgsearch' && method === 'GET') || (p === '/api/imgfetch' && method === 'POST')) {
      const cu = a && a.r === 'u' ? read(a.id) : null;
      if (!a || (a.r === 'u' && !(cu && a.k === fp(cu)))) return send(res, 401, { error: 'Nicht angemeldet' });
      try {
        if (method === 'GET') {
          const q = String(new URL(req.url, 'http://x').searchParams.get('q') || '').trim().slice(0, 80);
          if (q.length < 2) return send(res, 400, { error: 'Bitte einen Suchbegriff eingeben' });
          return send(res, 200, { results: await searchImages(q) });
        }
        const body = await readBody(req);
        const url = String(body.url || '');
        return send(res, 201, { url: await fetchImage(url) });
      } catch (e) {
        return send(res, 502, { error: 'Bildersuche nicht erreichbar: ' + String(e.message || e) });
      }
    }

    // Personenliste: Namen sind öffentlich (für die Auswahl), Statistiken nur für den Trainer
    if (p === '/api/users' && method === 'GET') {
      const list = listUsers();
      return send(res, 200, a && a.r === 't' ? list : list.map(({ id, name }) => ({ id, name })));
    }

    if (p === '/api/users' && method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim().slice(0, 40);
      const pin = String(body.pin || '');
      if (!name) return send(res, 400, { error: 'Name fehlt' });
      if (!PIN_RE.test(pin)) return send(res, 400, { error: 'Die PIN muss aus 4–8 Ziffern bestehen' });
      const id = slug(name) + '-' + crypto.randomBytes(2).toString('hex');
      const state = defaultState(name, hashPin(pin));
      write(id, state);
      return send(res, 201, { id, name, token: userToken(id, state) });
    }

    if (p === '/api/login' && method === 'POST') {
      const body = await readBody(req);
      const id = String(body.id || ''), pin = String(body.pin || '');
      const cur = validId(id) ? read(id) : null;
      if (!cur) return send(res, 404, { error: 'Person nicht gefunden' });
      const key = ip + '|' + id;
      const wait = locked(key);
      if (wait) return send(res, 429, { error: `Zu viele Versuche. Bitte in ${wait} Sekunden erneut versuchen.` });
      if (!cur.pin) { // Übernahme aus der Vorgängerversion: erste eingegebene PIN wird gesetzt
        if (!PIN_RE.test(pin)) return send(res, 400, { error: 'Bitte eine neue PIN mit 4–8 Ziffern wählen' });
        cur.pin = hashPin(pin); write(id, cur);
        return send(res, 200, { token: userToken(id, cur), pinSet: true });
      }
      if (!checkPin(pin, cur.pin)) { fail(key); return send(res, 401, { error: 'Falsche PIN' }); }
      fails.delete(key);
      return send(res, 200, { token: userToken(id, cur) });
    }

    if (p === '/api/trainer/login' && method === 'POST') {
      if (!TRAINER_PIN) return send(res, 503, { error: 'Trainer-Zugang ist nicht eingerichtet (TRAINER_PIN fehlt)' });
      const body = await readBody(req);
      const key = ip + '|trainer';
      const wait = locked(key);
      if (wait) return send(res, 429, { error: `Zu viele Versuche. Bitte in ${wait} Sekunden erneut versuchen.` });
      if (!checkTrainerPin(String(body.pin || ''))) { fail(key); return send(res, 401, { error: 'Falsche Trainer-PIN' }); }
      fails.delete(key);
      return send(res, 200, { token: sign({ r: 't', exp: Date.now() + TRAINER_TOKEN_MS }) });
    }

    const m = p.match(/^\/api\/users\/([a-z0-9-]+)(\/pin)?$/);
    if (m) {
      const id = m[1];
      if (!validId(id)) return send(res, 400, { error: 'Ungültige ID' });
      const cur = read(id);
      if (!cur) return send(res, 404, { error: 'Nicht gefunden' });
      const allowed = a && (a.r === 't' || (a.r === 'u' && a.id === id && a.k === fp(cur)));
      if (!allowed) return send(res, 401, { error: 'Nicht angemeldet' });

      if (m[2]) { // PIN ändern
        if (method !== 'POST') return send(res, 405, { error: 'Nicht erlaubt' });
        const body = await readBody(req);
        const pin = String(body.pin || '');
        if (!PIN_RE.test(pin)) return send(res, 400, { error: 'Die PIN muss aus 4–8 Ziffern bestehen' });
        if (a.r === 'u') {
          const key = ip + '|' + id;
          const wait = locked(key);
          if (wait) return send(res, 429, { error: `Zu viele Versuche. Bitte in ${wait} Sekunden erneut versuchen.` });
          if (!checkPin(String(body.old || ''), cur.pin)) { fail(key); return send(res, 401, { error: 'Aktuelle PIN ist falsch' }); }
          fails.delete(key);
        }
        cur.pin = hashPin(pin); write(id, cur);
        return send(res, 200, a.r === 'u' ? { ok: true, token: userToken(id, cur) } : { ok: true });
      }

      if (method === 'GET') { const { pin, ...rest } = cur; return send(res, 200, rest); }
      if (method === 'PUT') {
        const body = await readBody(req);
        if (!body || !Array.isArray(body.days) || !Array.isArray(body.history)) return send(res, 400, { error: 'Ungültige Daten' });
        body.name = String(body.name || cur.name).trim().slice(0, 40) || cur.name;
        body.pin = cur.pin; // PIN lässt sich nur über die PIN-Route ändern
        write(id, body);
        return send(res, 200, { ok: true });
      }
      if (method === 'DELETE') { fs.unlinkSync(fileOf(id)); return send(res, 200, { ok: true }); }
    }
    send(res, 404, { error: 'Nicht gefunden' });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
});

if (!TRAINER_PIN) console.warn('Hinweis: TRAINER_PIN ist nicht gesetzt – der Trainer-Zugang ist deaktiviert.');
server.listen(PORT, '0.0.0.0', () => console.log(`Trainingsplan läuft auf Port ${PORT}, Daten in ${DATA_DIR}`));
