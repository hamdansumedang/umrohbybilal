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

## Catatan E2E

Jika vault terenkripsi, isi note tampil 🔒 di V1 (metadata + graph tetap live).
V2: dekripsi penuh pakai `VAULT_PASSPHRASE` mengikuti format chunk LiveSync (HKDF/AES-GCM).

## Deploy / GitHub

Repo nanti: push folder ini saja. Di VPS tambah service `dashboard` di docker-compose, env sama dengan CouchDB.
