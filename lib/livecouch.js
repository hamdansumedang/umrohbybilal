// Backend CouchDB terdekripsi (E2E v2/HKDF) untuk dashboard.
// Dipakai saat VAULT_DIR tidak ada (hosting) — sumber tunggal dari CouchDB.
let worker = null;
async function getWorker() {
  if (!worker) worker = await import('@vrtmrz/livesync-commonlib/compat/worker/bgWorker');
  return worker;
}

const META_PREFIX = '/\\:';
const IMG_RE = /\.(png|jpe?g|gif|svg|webp|bmp)$/i;

function b64ToU8(b64) { return Uint8Array.from(Buffer.from(b64, 'base64')); }

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function run() {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
  return out;
}

function createBackend({ couchUrl, db, user, pass, passphrase }) {
  const URL = couchUrl.replace(/\/$/, '');
  const PASS = passphrase;
  const auth = 'Basic ' + Buffer.from(user + ':' + pass).toString('base64');
  let salt = null;
  const chunkCache = new Map(); // id -> plaintext piece

  async function cf(p) {
    const r = await fetch(URL + p, { headers: { Authorization: auth } });
    const t = await r.text();
    if (r.status === 401 || r.status === 403) throw new Error('CouchDB AUTH ' + r.status);
    if (!r.ok) throw new Error('CouchDB ' + r.status + ' ' + t.slice(0, 150));
    return JSON.parse(t);
  }
  const docUrl = (id) => `/${encodeURIComponent(db)}/${encodeURIComponent(id)}`;

  async function getSalt() {
    if (!PASS) throw new Error('VAULT_PASSPHRASE belum diisi di env host.');
    if (salt) return salt;
    const d = await cf(`${docUrl('_local/obsidian_livesync_sync_parameters')}`);
    if (!d.pbkdf2salt) throw new Error('Salt vault tidak ketemu di CouchDB.');
    salt = b64ToU8(d.pbkdf2salt);
    return salt;
  }

  // Dekripsi 1 potongan teks (sudah termasuk prefix %=/legacy).
  async function decPiece(data) {
    const { decryptHKDFWorker } = await getWorker();
    const s = String(data);
    if (s.startsWith('%=')) return await decryptHKDFWorker(s, PASS, await getSalt());
    return s; // tidak terenkripsi / format lama polos
  }

  async function decMeta(doc) {
    const p = String(doc.path || '');
    if (p.startsWith(META_PREFIX)) {
      const { decryptHKDFWorker } = await getWorker();
      const meta = JSON.parse(await decryptHKDFWorker(p.slice(META_PREFIX.length), PASS, await getSalt()));
      return { path: meta.path, mtime: meta.mtime, ctime: meta.ctime, size: meta.size, children: meta.children || [] };
    }
    return { path: p, mtime: doc.mtime, ctime: doc.ctime, size: doc.size, children: doc.children || [] };
  }

  async function getChunkText(id) {
    if (chunkCache.has(id)) return chunkCache.get(id);
    const c = await cf(docUrl(id));
    const piece = await decPiece(c.data ?? '');
    if (chunkCache.size > 3000) chunkCache.clear();
    chunkCache.set(id, piece);
    return piece;
  }

  function cleanRel(p) { return String(p).replace(/^\/+/, ''); }

  async function buildIndex() {
    await getSalt();
    const all = await cf(`/${encodeURIComponent(db)}/_all_docs?limit=5000`);
    const ids = (all.rows || []).map(r => r.id).filter(id => id.startsWith('f:'));
    const raws = await mapLimit(ids, 8, async (id) => {
      try { return { id, doc: await cf(docUrl(id)) }; }
      catch { return { id, doc: null }; }
    });
    const notes = [];
    for (const { id, doc } of raws) {
      if (!doc || doc.deleted) continue;
      let m;
      try { m = await decMeta(doc); } catch { continue; }
      const rel = cleanRel(m.path);
      if (!rel || !/\.md$/i.test(rel)) {
        // file non-md (gambar/lampiran): tetap index untuk media
        if (!rel) continue;
        notes.push({ id, rel, name: rel.split('/').pop(), base: rel.split('/').pop().replace(/\.md$/i, ''), mtime: m.mtime || 0, size: m.size || 0, type: doc.type || '', children: m.children || [], binary: true });
        continue;
      }
      notes.push({ id, rel, name: rel.split('/').pop(), base: rel.split('/').pop().replace(/\.md$/i, ''), mtime: m.mtime || 0, size: m.size || 0, type: doc.type || '', children: m.children || [], binary: false });
    }
    notes.sort((a, b) => a.rel.localeCompare(b.rel));
    const media = notes.filter(n => n.binary || IMG_RE.test(n.rel)).map(n => n.rel);
    return { notes, media, seq: all.update_seq };
  }

  // Isi penuh 1 file: rakit children berurutan.
  async function getContent(entry) {
    const parts = await mapLimit(entry.children || [], 8, getChunkText);
    const joined = parts.join('');
    if (entry.type === 'newnote' || IMG_RE.test(entry.rel) || entry.binary) {
      return { buffer: Buffer.from(joined, 'base64'), binary: true };
    }
    return { text: joined, binary: false };
  }

  async function getSeq() {
    const info = await cf(`/${encodeURIComponent(db)}`);
    return info.update_seq;
  }

  return { buildIndex, getContent, getSeq, docUrl, cf };
}

module.exports = { createBackend };
