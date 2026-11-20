# AbsenInn — HR & Workforce Management System

> **Kerja Lebih Teratur, Tim Lebih Produktif.** · SMART EMPLOYEE MANAGEMENT

AbsenInn membantu pemilik UMKM mengelola karyawan, absensi selfie + GPS, izin/cuti, tugas, payroll, dan analitik performa dalam satu platform.

**Stack:** HTML5 · CSS3 · Vanilla JavaScript (ES6+) · Chart.js · Django 5+/6 + Django REST Framework · Supabase PostgreSQL/Auth/Storage/RLS · ReportLab (PDF) · Docker/Render · GitHub Actions.

---

## Demo

**Live demo (data fiktif):** `https://<username>.github.io/<repo>/` · login `owner@absenninn.demo` / `demo1234` (karyawan: `aisyah@absenninn.demo`)

Repo ini selalu dalam **mode demo**. Versi produksi (dipakai sungguhan oleh Firzzzy Store) di-deploy dari repo yang sama ke Render dengan `FRONTEND_MODE=production` — data asli ada di Supabase, tidak pernah di repo. Lihat [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Status pengembangan

| Phase | Lingkup | Status |
|---|---|---|
| 1 | Struktur project, design system, logo, login, layout Owner & Employee, semua halaman utama, responsif | ✅ |
| 2 | Supabase: schema, migration, RLS + storage policy, Supabase Auth, seed | ✅ — [`database/README.md`](database/README.md) |
| 3 | Django + DRF: verifikasi JWT Supabase (JWKS/HS256), otorisasi server per perusahaan & role, validasi, employees/settings/notifikasi/audit | ✅ — [`backend/README.md`](backend/README.md) |
| 4 | Attendance backend: selfie → private bucket, GPS + Haversine di server, monitoring, koreksi, rekonsiliasi, bukti via signed URL | ✅ |
| 5 | Leave (lampiran asli, approval → absensi, kuota) & Task (status, progress, riwayat via trigger DB) | ✅ |
| 6 | Payroll engine (gajian = tanggal masuk, prorata absen & cuti tidak dibayar, lembur per jam, tanpa potongan terlambat), alur approval, pembayaran manual, slip gaji PDF | ✅ |
| 7 | Analytics API (rumus yang sama dengan UI) | ✅ |
| 8 | Pengingat terjadwal (check-in, check-out, rekonsiliasi, deadline, gajian) + polling notifikasi | ✅ |
| 9 | 77 tes API + tes RLS + E2E produksi (Django + Postgres asli) + E2E demo, Docker, CI, panduan deploy | ✅ — [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) |

### Dua mode
* **`MODE: 'demo'`** — seluruh UI berjalan di browser dengan data fiktif (`localStorage`), tanpa server. Cocok untuk portofolio/presentasi. Pengecekan role di mode ini **bukan** keamanan sungguhan.
* **`MODE: 'production'`** — login Supabase Auth; semua data lewat Django, yang memverifikasi token di setiap request dan menegakkan aturan bisnis. Data di PostgreSQL Supabase, foto & lampiran di bucket privat.

**Batasan yang perlu diketahui:**
- GPS browser dapat dimanipulasi — sistem memvalidasi di server dan menandai data mencurigakan untuk direview, bukan anti-kecurangan sempurna.
- Pembayaran gaji tetap **manual** (transfer oleh owner); sistem hanya mencatat setelah owner mengonfirmasi.
- Lembur dihitung otomatis dari jam check-out melewati jam pulang (per jam penuh); owner dapat mengubah jam lembur per karyawan sebelum approval.
- Logo perusahaan & foto profil kustom belum didukung (memakai logo AbsenInn & inisial nama).

---

## Menjalankan secara lokal

Kamera & GPS hanya berfungsi di **HTTPS atau `localhost`** — jangan buka file HTML langsung.

**Mode demo (tanpa backend):**
```bash
cd AbsenInn/frontend && python3 -m http.server 8000     # buka http://localhost:8000
```

**Mode produksi (Django + Supabase):** isi `.env` (lihat [`database/README.md`](database/README.md) langkah 8), lalu
```bash
pip install -r backend/requirements.txt
cd backend && python manage.py runserver 8000            # UI + API di http://localhost:8000
```
dan ubah `MODE: 'production'` di `frontend/js/config.js`. Deploy online: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

Chart.js dan font dimuat dari CDN; tanpa internet grafik menampilkan pesan fallback, fitur lain tetap jalan (ikon sudah tertanam).

### Akun demo (fiktif) — password: `demo1234`
| Role | Email |
|---|---|
| Owner | owner@absenninn.demo |
| Employee | aisyah@absenninn.demo, bima@…, citra@…, dimas@…, eka@absenninn.demo |

Tombol **Reset data demo** (banner atas atau Settings → Akun) mengembalikan data awal.

### Skenario uji cepat
1. Login **owner** → Settings → *Absensi & Lokasi* → **Gunakan lokasi saya saat ini** → Simpan (koordinat tidak di-hardcode).
2. Logout → login **aisyah** → Dashboard → **Check-in Sekarang** → izinkan kamera & lokasi → ambil selfie → konfirmasi.
3. Coba dari lokasi lain / radius kecil → muncul peringatan *di luar radius* → *Kirim untuk Review*.
4. My Leave → ajukan izin → login owner → Leave Management → setujui/tolak (tolak wajib catatan).
5. Owner → Payroll → *Preview & Adjust* → Ajukan → Setujui → Konfirmasi Pembayaran → employee menerima notifikasi & slip.
6. Owner → Attendance → koreksi absensi (alasan wajib) → tercatat di Aktivitas Terbaru (audit log).

### Test otomatis
| Test | Cakupan |
|---|---|
| `backend/` → `python manage.py test` | **77 tes API** di atas schema SQL asli: verifikasi token (HS256, ES256/JWKS, kedaluwarsa, audience), isolasi antar-perusahaan, hak akses role, validasi, check-in/out (radius, akurasi, selfie palsu, upload gagal), koreksi & rekonsiliasi, izin + lampiran, tugas, **payroll engine dengan nominal rupiah persis**, alur approval/pembayaran, PDF, analytics, pengingat |
| `database/tests/rls_tests.sql` | Keamanan database (RLS) di PostgreSQL sungguhan |
| `tools/e2e_production.py` | **39 skenario E2E produksi**: Django + PostgreSQL asli + UI di Chrome headless (hanya SDK Supabase Auth yang di-stub, token JWT asli). Owner & 3 karyawan: lokasi, gaji, check-in selfie+GPS, lampiran izin, approval, tugas, payroll → PDF → pembayaran, analytics, audit |
| `tools/e2e_phase1.py` | 87 skenario UI mode demo |
| `tools/e2e_phase2_auth.py` | 29 skenario login produksi (Supabase SDK di-stub) |
```bash
cd backend && python manage.py test
cd .. && pip install playwright && python3 tools/e2e_production.py && python3 tools/e2e_phase1.py && python3 tools/e2e_phase2_auth.py
```
CI (`.github/workflows/ci.yml`) menjalankan tes RLS, cek sinkron `schema.sql`, tes API, dan `check --deploy` di setiap push.

---|---|
| `tools/e2e_phase1.py` | 87 skenario UI mode demo: semua halaman, CRUD, check-in dalam/luar radius, kamera ditolak, GPS mati, upload gagal + retry, guard role, privasi slip gaji, responsif |
| `tools/e2e_phase2_auth.py` | 29 skenario login produksi (Supabase SDK di-stub): password salah, akun tanpa profil / nonaktif ditolak, guard role, "Ingat saya", logout, ganti & reset password |
| `database/tests/rls_tests.sql` | Keamanan database di PostgreSQL sungguhan: isolasi antar-perusahaan, privasi gaji/selfie/notifikasi, karyawan tidak bisa menulis absensi/menyetujui izin/ubah payroll, karyawan nonaktif & anonim tanpa akses |
```bash
pip install playwright && python3 tools/e2e_phase1.py && python3 tools/e2e_phase2_auth.py
```

---

## Struktur project

```
AbsenInn/
├── frontend/
│   ├── index.html                # loading screen → redirect sesuai sesi
│   ├── login.html
│   ├── owner/                    # 11 halaman owner (desktop-first)
│   ├── employee/                 # 8 halaman employee (mobile-friendly, bottom nav)
│   ├── css/  style.css (tokens) · components.css · dashboard.css (shell) · responsive.css
│   ├── js/
│   │   ├── config.js             # MODE demo/production, URL publik (tanpa secret)
│   │   ├── api.js                # klien REST + simulasi demo (aturan bisnis & role)
│   │   ├── auth.js               # login, sesi, page guard
│   │   ├── attendance.js         # alur check-in/out selfie + GPS
│   │   ├── camera.js · location.js (Haversine)
│   │   ├── employees.js · payroll.js   # form karyawan, slip gaji (shared)
│   │   ├── core/                 # icons, format, store (demo), ui components, layout, charts, metrics
│   │   └── pages/{owner,employee}/*.js # logika per halaman
│   └── assets/  images/logo.svg · logo-mark.svg · icons/favicon.svg
├── backend/                      # Django + DRF — lihat backend/README.md
│   ├── config/                   # settings (env), urls, wsgi
│   ├── core/                     # JWT auth, permissions, storage, events, test runner
│   └── accounts · employees · attendance · leave_management · task_management · payroll · analytics · notifications
├── database/                     # migrations/0001–0005, schema.sql, seed.sql, seed.private.sql (gitignored), tests/
├── docs/DEPLOYMENT.md            # Supabase + Render + GitHub Actions
├── tools/                        # build_pages.py · build_schema.py · supabase_shim.sql · e2e_*.py
├── Dockerfile · render.yaml · .github/workflows/{ci,reminders}.yml
└── .env.example
```

Shell HTML halaman dashboard dibuat konsisten oleh `python3 tools/build_pages.py` (urutan script & `<head>` sama). Logika ada di `js/pages/...`.

## Design system
- Primary indigo/violet `#6C55F2 → #8B5CF6`, secondary soft blue `#7DB3FF`, accent mint `#22C9A0/#4FE0B8`, teks navy `#17153B`, status: success hijau, pending oranye, rejected/overdue merah.
- Font Plus Jakarta Sans, grid 4px, radius 8–20px, soft shadow.
- Logo: monogram **A** geometris dengan checkmark mint sebagai palang (attendance indicator).
- Komponen reusable (`js/core/ui.js`): toast, modal, confirm dialog, badge status, avatar, tabel + pagination, tabs, dropdown, form + validasi, loading/empty/error state.

## Keamanan (prinsip yang dipegang sejak Phase 1)
- Tidak ada Service Role Key / secret di frontend (`config.js` hanya nilai publik).
- Data gaji privat: karyawan hanya melihat slip miliknya setelah payroll disetujui — ditegakkan Django + RLS.
- Selfie & lampiran → private bucket, tipe file dicek dari isi (magic bytes), dibaca via signed URL 5 menit.
- Service role key hanya di server (`.env` / dashboard hosting).
- Setiap koreksi absensi, keputusan izin, perubahan payroll & pengaturan tercatat di audit log.
