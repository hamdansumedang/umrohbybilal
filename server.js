require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const COUCH_URL = (process.env.COUCH_URL || 'https://livesync.srv1167690.hstgr.cloud').replace(/\/$/, '');
const COUCH_DB = process.env.COUCH_DB || 'obsidiannotes';
const COUCH_USER = process.env.COUCH_USER || 'admin';
const COUCH_PASS = process.env.COUCH_PASS || '';
const VAULT_DIR = process.env.VAULT_DIR || path.join(__dirname, '..', 'Umroh By Bilal');

if (!COUCH_PASS) {
  console.error('FATAL: COUCH_PASS kosong di .env — server tidak start biar tidak mengunci akun CouchDB.');
  process.exit(1);
}

const auth = 'Basic ' + Buffer.from(COUCH_USER + ':' + COUCH_PASS).toString('base64');
async function couchFetch(couchPath, opts = {}) {
  const res = await fetch(COUCH_URL + couchPath, {
    ...opts,
    headers: { Authorization: auth, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (res.status === 401 || res.status === 403) {
    const e = new Error('CouchDB AUTH ' + res.status + ' ' + text.slice(0, 200) + ' — hentikan polling, cek user/pass, tunggu lockout reda.');
    e.code = res.status;
    throw e;
  }
  if (!res.ok) throw new Error('CouchDB ' + res.status + ' ' + text.slice(0, 300));
  return json;
}

function extractLinks(text) {
  const out = new Set();
  const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1].trim();
    if (name) out.add(name);
  }
  return [...out].slice(0, 100);
}

function walkMd(dir, base) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'Web App') continue; // jangan index dashboard itu sendiri
      out.push(...walkMd(full, base));
    }
    else if (e.isFile() && /\.md$/i.test(e.name)) {
      const rel = path.relative(base, full).replace(/\\/g, '/');
      out.push({ full, rel });
    }
  }
  return out;
}

const MEDIA_RE = /\.(png|jpe?g|gif|svg|webp|bmp|mp4|webm|pdf)$/i;
function walkMedia(dir, base) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'Web App') continue;
      out.push(...walkMedia(full, base));
    }
    else if (e.isFile() && MEDIA_RE.test(e.name)) out.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return out;
}

app.use(express.static(path.join(__dirname, 'public')));
// Expose read-only file vault lokal (gambar/lampiran) ke /vault — GET saja.
app.use('/vault', express.static(VAULT_DIR, { fallthrough: true, maxAge: '1h' }));
// Folder _gambar ada di luar vault (sibling) — expose juga bila ada.
const GAMBAR_DIR = path.join(__dirname, '..', '_gambar');
if (fs.existsSync(GAMBAR_DIR)) app.use('/gambar', express.static(GAMBAR_DIR, { fallthrough: true, maxAge: '1h' }));

app.get('/api/health', async (req, res) => {
  try {
    const up = await couchFetch('/_up');
    const info = await couchFetch('/' + encodeURIComponent(COUCH_DB));
    res.json({ ok: true, up, db: { name: info.db_name, docs: info.doc_count, update_seq: info.update_seq } });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

// Ringan: daftar ID saja, tanpa include_docs (dulu muter karena narik 230 chunk terenkripsi sekaligus).
app.get('/api/docs', async (req, res) => {
  try {
    const all = await couchFetch('/' + encodeURIComponent(COUCH_DB) + '/_all_docs?limit=2000');
    const ids = (all.rows || []).map(r => r.id).filter(id => !id.startsWith('_design/'));
    res.json({
      ok: true, count: ids.length,
      files: ids.filter(id => id.startsWith('f:')).length,
      chunks: ids.filter(id => id.startsWith('c:')).length,
      update_seq: all.update_seq
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

// Konten asli dari vault lokal (plaintext) — ini yang jadi "Obsidian live".
app.get('/api/local-docs', (req, res) => {
  try {
    if (!fs.existsSync(VAULT_DIR)) {
      let sibling = [];
      try { sibling = fs.readdirSync(path.join(__dirname, '..')); } catch {}
      return res.status(500).json({ ok: false, error: 'VAULT_DIR tidak ketemu: ' + VAULT_DIR + ' (cwd=' + process.cwd() + ', isi folder sebelah: ' + sibling.slice(0, 10).join(', ') + '). Set env VAULT_DIR ke folder vault.' });
    }
    const files = walkMd(VAULT_DIR, VAULT_DIR).slice(0, 2000);
    const notes = files.map(({ full, rel }) => {
      let text = '';
      try { text = fs.readFileSync(full, 'utf8'); } catch {}
      const st = fs.statSync(full);
      const base = path.basename(rel).replace(/\.md$/i, '');
      return {
        id: rel, name: path.basename(rel),
        base, rel,
        links: extractLinks(text),
        preview: text.slice(0, 2000),
        mtime: st.mtimeMs, size: st.size
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
    const media = walkMedia(VAULT_DIR, VAULT_DIR).slice(0, 2000);
    res.json({ ok: true, count: notes.length, vault: VAULT_DIR, notes, media });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.get('/api/local-doc', (req, res) => {
  try {
    const rel = req.query.rel || req.query.id || '';
    const full = path.join(VAULT_DIR, rel);
    if (!full.startsWith(VAULT_DIR)) return res.status(400).json({ ok: false, error: 'path tidak valid' });
    const text = fs.readFileSync(full, 'utf8');
    res.json({ ok: true, id: rel, name: path.basename(rel), text, links: extractLinks(text) });
  } catch (e) {
    res.status(404).json({ ok: false, error: String(e.message || e) });
  }
});

app.get('/api/debug', async (req, res) => {
  try {
    const all = await couchFetch('/' + encodeURIComponent(COUCH_DB) + '/_all_docs?limit=10');
    const ids = (all.rows || []).map(r => r.id);
    res.json({ ok: true, total_rows: (all.rows || []).length, ids, vault_dir: VAULT_DIR, vault_exists: fs.existsSync(VAULT_DIR) });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

app.get('/api/changes', async (req, res) => {
  try {
    const since = req.query.since || 'now';
    const data = await couchFetch('/' + encodeURIComponent(COUCH_DB) + '/_changes?feed=normal&since=' + encodeURIComponent(since) + '&limit=200');
    res.json({ ok: true, last_seq: data.last_seq, results: (data.results || []).map(r => r.id) });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

// Endpoint lama dipertahankan biar tidak 404, tapi jangan dipakai frontend.
app.get('/api/doc', async (req, res) => {
  res.status(410).json({ ok: false, error: 'pakai /api/local-doc?rel=... (konten dari vault lokal)' });
});

app.listen(PORT, () => console.log('Dashboard live di http://localhost:' + PORT + ' | vault: ' + VAULT_DIR));
