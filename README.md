# Mine QRIS SaaS (Fullstack)

Aplikasi fullstack SaaS untuk simulasi layanan pembayaran digital bergaya QRIS dengan dashboard merchant.

## Fitur Utama

- Registrasi dan login multi-peran (Owner + Cashier)
- Team management (owner dapat tambah dan nonaktifkan cashier)
- Role-based access control:
  - Owner: kelola produk, set transaksi lunas, kelola tim
  - Cashier: buat transaksi dan pantau data operasional
- Dashboard ringkasan bisnis (produk, transaksi, pending, tim aktif, omzet)
- Manajemen produk (tambah, ubah, hapus)
- Manajemen transaksi (buat transaksi, generate payload QRIS, set lunas)
- Audit log aktivitas operasional
- Endpoint API backend dengan validasi input dan error handling
- UI frontend dashboard yang langsung terhubung ke API
- Penyimpanan data lokal JSON (`/home/runner/work/mine/mine/data/db.json`)

## Stack

- Backend: Node.js + Express + TypeScript
- Frontend: HTML + CSS + Vanilla JavaScript
- Persistence: local JSON storage

## Menjalankan Project

```bash
npm install
npm run dev
```

Akses aplikasi di `http://localhost:3000`.

## Build dan Verifikasi

```bash
npm run build
npm test
npm start
```

## API Ringkas

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/me`
- `GET /api/dashboard`
- `GET /api/team-members`
- `POST /api/team-members`
- `POST /api/team-members/:id/deactivate`
- `GET /api/products`
- `POST /api/products`
- `PUT /api/products/:id`
- `DELETE /api/products/:id`
- `GET /api/transactions`
- `POST /api/transactions`
- `POST /api/transactions/:id/pay`
- `GET /api/transactions/:id/qris`
- `GET /api/audit-logs`

## Catatan

Project ini adalah implementasi SaaS fullstack production-style MVP yang tersinkron dari backend sampai frontend dalam satu repo.
