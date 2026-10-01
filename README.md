# Ruang Tari

Aplikasi persediaan dan persewaan kostum tari tradisional dengan frontend HTML/CSS/JavaScript, backend Node.js bawaan, dan Supabase Postgres.

## Struktur

```text
frontend/
  index.html
  styles.css
  app.js
backend/
  app.js
  schema.sql
frontend/assets/illustrations/
  costumes.svg
  renters.svg
  rentals.svg
  rental_items.svg
```

## Ilustrasi UI

Ilustrasi 2D flat disimpan lokal di `frontend/assets/illustrations/`, masing-masing untuk tabel `costumes`, `renters`, `rentals`, dan `rental_items` pada `backend/schema.sql`.

## Menyiapkan Supabase

1. Buat project Supabase, lalu buka **SQL Editor**.
2. Jalankan seluruh isi `backend/schema.sql` untuk membuat empat entitas: `costumes`, `renters`, `rentals`, dan `rental_items`.
3. Buka `backend/app.js`, isi konstanta `SUPABASE_URL` dengan Project URL dan `SUPABASE_PUBLISHABLE_KEY` dengan **Publishable key** dari pengaturan API project.
4. Pastikan Node.js 18 atau lebih baru tersedia, lalu jalankan dari folder proyek:

   ```bash
   node backend/app.js
   ```

5. Buka `http://localhost:3000`.

## GitHub Pages

GitHub Pages hanya menyajikan file statis dan tidak menjalankan `backend/app.js`. Frontend otomatis memakai Supabase REST saat dibuka dari domain `github.io`, sehingga data dan formulir tetap berfungsi tanpa server Node.js terpisah.

1. Commit dan push seluruh folder `frontend/`, termasuk `frontend/assets/illustrations/` dan `.github/workflows/deploy-pages.yml`.
2. Di repository GitHub, buka **Settings > Pages** lalu pilih **GitHub Actions** pada bagian **Build and deployment > Source**.
3. Workflow menerbitkan isi folder `frontend/` setiap ada push ke branch `main` atau `master`. Jika branch utama memakai nama lain, sesuaikan daftar branch di workflow.
4. Tunggu workflow **Deploy GitHub Pages** selesai, lalu muat ulang situs.

Frontend menggunakan Supabase publishable key. Skema saat ini mengizinkan akses publik melalui role `anon`; batasi kebijakan RLS dan tambahkan autentikasi sebelum menyimpan data pelanggan sungguhan.

## Catatan akses

Skema awal memberikan akses publik pada tabel melalui role `anon` agar aplikasi langsung dapat dicoba tanpa sistem login. Ini cocok untuk prototipe atau penggunaan terbatas; sebelum menyimpan data pelanggan sungguhan, tambahkan autentikasi dan batasi kebijakan RLS berdasarkan pengguna. Gunakan hanya publishable key, jangan pernah menaruh secret/service-role key di aplikasi.