'use strict';
// Trainingsplan – minimaler Server ohne externe Abhängigkeiten.
// Speichert pro Person eine JSON-Datei in DATA_DIR.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = +process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const INDEX = path.join(__dirname, 'index.html');
fs.mkdirSync(DATA_DIR, { recursive: true });

const rid = () => Math.random().toString(36).slice(2, 9);
const validId = (id) => /^[a-z0-9-]{1,48}$/.test(id);
const fileOf = (id) => path.join(DATA_DIR, id + '.json');
const read = (id) => { try { return JSON.parse(fs.readFileSync(fileOf(id), 'utf8')); } catch { return null; } };
const write = (id, data) => {
  const tmp = fileOf(id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, fileOf(id));
};
const slug = (n) =>
  n.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'person';

function defaultState(name) {
  const ex = (n, sets, reps, weight) => ({ id: rid(), name: n, sets, reps: String(reps), weight, note: '' });
  return {
    name,
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
  };
}

function listUsers() {
  return fs.readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => { const id = f.slice(0, -5); const d = read(id); return d ? { id, name: d.name } : null; })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 2e6) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      return send(res, 200, fs.readFileSync(INDEX), 'text/html; charset=utf-8');
    }
    if (p === '/healthz') return send(res, 200, { ok: true });

    if (p === '/api/users') {
      if (req.method === 'GET') return send(res, 200, listUsers());
      if (req.method === 'POST') {
        const body = await readBody(req);
        const name = String(body.name || '').trim().slice(0, 40);
        if (!name) return send(res, 400, { error: 'Name fehlt' });
        const id = slug(name) + '-' + crypto.randomBytes(2).toString('hex');
        write(id, defaultState(name));
        return send(res, 201, { id, name });
      }
    }

    const m = p.match(/^\/api\/users\/([a-z0-9-]+)$/);
    if (m) {
      const id = m[1];
      if (!validId(id)) return send(res, 400, { error: 'Ungültige ID' });
      const cur = read(id);
      if (!cur) return send(res, 404, { error: 'Nicht gefunden' });
      if (req.method === 'GET') return send(res, 200, cur);
      if (req.method === 'PUT') {
        const body = await readBody(req);
        if (!body || !Array.isArray(body.days) || !Array.isArray(body.history)) return send(res, 400, { error: 'Ungültige Daten' });
        body.name = String(body.name || cur.name).trim().slice(0, 40) || cur.name;
        write(id, body);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'DELETE') {
        fs.unlinkSync(fileOf(id));
        return send(res, 200, { ok: true });
      }
    }
    send(res, 404, { error: 'Nicht gefunden' });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Trainingsplan läuft auf Port ${PORT}, Daten in ${DATA_DIR}`));
