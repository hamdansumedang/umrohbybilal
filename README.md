# LiveSync Dashboard (Node.js) — Obsidian versi live

Webapp live yang selalu menampilkan data CouchDB (Self-hosted LiveSync).
V1: daftar files, preview markdown, backlinks, graph ala Obsidian, auto-refresh tiap 3 detik via `_changes`.

## Jalankan lokal

```bash
cd "Web App"
copy .env.example .env
# edit .env: COUCH_USER, COUCH_PASS
npm install
npm start
# buka http://localhost:3000
```

## API (via server, tanpa CORS)

- `GET /api/health` — status CouchDB + jumlah docs
- `GET /api/docs` — daftar + preview + `[[links]]`
- `GET /api/changes?since=...` — live poll
- `GET /api/doc?id=...` — isi 1 note

## Mode sumber data

- **Lokal** (di PC): kalau `VAULT_DIR` ada → baca file vault langsung (tercepat).
- **CouchDB terdekripsi** (di hosting): kalau `VAULT_DIR` tidak ada → server merakit +
  mendekripsi note + gambar langsung dari CouchDB pakai `VAULT_PASSPHRASE`
  (lib resmi `@vrtmrz/livesync-commonlib`, E2E v2/HKDF). Tampilan sama persis.

Env yang wajib di host: `COUCH_URL`, `COUCH_DB`, `COUCH_USER`, `COUCH_PASS`,
`VAULT_PASSPHRASE`. Lihat `.env.example`.

## Deploy / GitHub

Repo nanti: push folder ini saja. Di VPS tambah service `dashboard` di docker-compose, env sama dengan CouchDB.
