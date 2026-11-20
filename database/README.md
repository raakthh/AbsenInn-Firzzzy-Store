# Database — Supabase PostgreSQL

| File | Isi |
|---|---|
| `migrations/0001_schema.sql` | 25 tabel (company_id di setiap data bisnis), FK, constraint, index, trigger `updated_at`, kode karyawan otomatis, `app.bootstrap_company()` |
| `migrations/0002_security.sql` | Row Level Security untuk semua tabel + trigger penjaga kolom (karyawan hanya boleh ubah HP/alamat, status tugas, tandai notifikasi dibaca) |
| `migrations/0003_storage.sql` | Bucket privat `attendance-selfies`, `leave-attachments`, `company-assets` + policy |
| `migrations/0004_admin_helpers.sql` | `app.link_account()` — menghubungkan akun Supabase Auth ke profil/karyawan |
| `migrations/0005_task_history_clock.sql` | Urutan riwayat tugas akurat (`clock_timestamp()`) — Phase 5 |
| `schema.sql` | **Gabungan semua migration** (dibuat oleh `python3 tools/build_schema.py`) — untuk ditempel sekali di SQL Editor |
| `seed.sql` | Data demo **fiktif** (aman untuk GitHub) — untuk project Supabase demo, bukan database toko |
| `seed.private.sql` | **Data asli Firzzzy Store** — dikecualikan dari Git lewat `.gitignore` |
| `reset_operational.private.sql` | **Hapus data uji coba** (absensi, izin, tugas, payroll, notifikasi) tapi pertahankan karyawan, akun, pengaturan & gaji — dikecualikan dari Git |
| `tests/rls_tests.sql` | Tes keamanan otomatis; berjalan dalam transaksi lalu `ROLLBACK` (tidak meninggalkan data) |

## Langkah setup (Firzzzy Store)

1. **Ambil kunci publik.** Supabase → *Project Settings → API*. Salin **Project URL** dan **anon/publishable key** ke `frontend/js/config.js` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`).
   ⚠ Jangan pernah menyalin **service_role key** ke frontend, chat, atau GitHub.
2. **Matikan pendaftaran publik.** *Authentication → Sign In / Providers → Email* → nonaktifkan **Allow new users to sign up**. Akun hanya dibuat oleh owner.
3. **Buat tabel.** *SQL Editor → New query* → tempel isi `schema.sql` → **Run**. Aman dijalankan ulang.
4. **Buat 4 akun.** *Authentication → Users → Add user → Create new user*, centang **Auto Confirm User**:
   `farizky@firzzzystore.com`, `ira@firzzzystore.com`, `laila@firzzzystore.com`, `tanti@firzzzystore.com`.
   Beri password sementara untuk karyawan; setelah login mereka bisa menggantinya (menu profil → **Ganti password**).
5. **Isi data toko.** SQL Editor → tempel `seed.private.sql` → **Run**. Tabel hasil di bawah harus menampilkan 1 owner + 3 karyawan. Kalau ada pesan "belum ada di Supabase Auth", buat akunnya lalu jalankan ulang.
6. **(Disarankan) Uji keamanan.** Jalankan `tests/rls_tests.sql` → tab *Messages*/*Results* harus diakhiri `SEMUA TES RLS LULUS`.
7. **URL untuk reset password.** *Authentication → URL Configuration*: **Site URL** = alamat yang Anda pakai (mis. `http://127.0.0.1:5500`), lalu tambah **Redirect URLs**: `http://127.0.0.1:5500/**` (dan `http://localhost:8000/**` jika memakai `python -m http.server`).
8. **Isi `.env` untuk Django** (salin dari `.env.example`, jangan di-commit):
   - `DATABASE_URL` — *Connect* (tombol di atas dashboard) → **Session pooler** → URI, ganti `[YOUR-PASSWORD]` dengan password database. Pakai user `postgres` bawaan (pemilik tabel) — Django melakukan otorisasinya sendiri.
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, dan **`SUPABASE_SERVICE_ROLE_KEY`** (Project Settings → API Keys). Service role key **hanya** di `.env`/dashboard hosting — untuk upload selfie, lampiran izin, signed URL, dan undangan akun karyawan.
   - `SUPABASE_JWT_SECRET` hanya jika project masih memakai *Legacy JWT secret* (Project Settings → JWT Keys). Project baru memakai JWT Signing Keys → Django memverifikasi otomatis lewat JWKS, kosongkan saja.
9. **Jalankan Django & aktifkan mode produksi.** `pip install -r backend/requirements.txt`, lalu `cd backend && python manage.py runserver 8000`. Di `frontend/js/config.js` ubah `MODE: 'production'` (biarkan `API_BASE_URL: '/api'`). Buka **http://localhost:8000** — UI dan API satu alamat. Tambahkan `http://localhost:8000/**` di *Redirect URLs* (langkah 7).
10. **Hari pertama**: Settings → *Absensi & Lokasi* → **Gunakan lokasi saya saat ini** (saat berada di toko) → Simpan; Payroll → *Konfigurasi Gaji* → isi gaji pokok, tunjangan, tarif lembur tiap karyawan.

Panduan deploy online (Render + GitHub Actions): [`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md).

### Memperbarui database yang sudah berjalan
Saat ada migration baru (mis. `0005_*.sql`), cukup tempel ulang **`schema.sql`** di SQL Editor → Run. Semua perintah aman dijalankan ulang dan data tidak terhapus.

Jika SQL Editor menolak policy pada `storage.objects` ("must be owner"), buat policy yang sama via *Storage → Policies*; bagian lain tetap berjalan.

## Model keamanan (ringkas)
- **Owner**: CRUD semua tabel perusahaannya sendiri; tidak bisa melihat perusahaan lain; tidak bisa membaca notifikasi pribadi karyawan; audit log hanya bisa ditambah (tidak bisa diedit/dihapus).
- **Employee**: hanya membaca data miliknya — absensi, bukti selfie, izin, tugas yang ditugaskan, slip gaji **yang sudah disetujui**. Tidak bisa melihat konfigurasi gaji, tidak bisa menulis absensi langsung, tidak bisa menyetujui izin, hanya bisa mengajukan izin/koreksi berstatus `pending`.
- **Karyawan nonaktif**: semua akses data tertutup otomatis.
- **Anonim**: tidak punya akses ke tabel apa pun.
- **Django** terhubung dengan role database tepercaya (pemilik tabel → melewati RLS) dan melakukan otorisasinya sendiri di setiap endpoint (diuji oleh `backend/*/tests`). Trigger penjaga tetap aktif; untuk perubahan tugas Django meneruskan identitas pengguna ke `auth.uid()` agar riwayat mencatat pelaku yang benar.

## Schema vs Django
Schema dikelola **hanya** oleh file SQL di `migrations/`. Model Django memakai `managed = False`, sehingga `manage.py migrate` tidak pernah membuat/mengubah tabel bisnis — tidak ada bentrok migration. Perubahan schema berikutnya = file baru `0006_*.sql`, lalu `python3 tools/build_schema.py` (CI memeriksa `schema.sql` selalu sinkron).

## Tes lokal (developer)
`tools/supabase_shim.sql` meniru objek Supabase (`auth.users`, `auth.uid()`, `storage.*`, role `anon/authenticated`) agar migration + RLS bisa diuji di PostgreSQL biasa. **Jangan** dijalankan di Supabase.
```bash
createdb absen && psql -d absen -f tools/supabase_shim.sql -f database/schema.sql -f database/tests/rls_tests.sql
```
