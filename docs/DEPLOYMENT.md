# Smart Study Space: browser + Supabase + Vercel

Versi ini menggunakan frontend React/Vite yang sama. Vercel hanya menyajikan berkas statis; inferensi YOLO26s berjalan di browser melalui ONNX Runtime Web. Supabase menangani Auth, PostgreSQL, dan Realtime. Tidak ada FastAPI, Python, localhost, atau laptop pemilik yang harus aktif pada deployment ini. FastAPI, SQLite, dan `weights.pt` asli tetap tersedia melalui `run-dev.bat`.

## Model dan akurasi

`frontend/public/models/yolo26s.onnx` diekspor dari checkpoint asli tanpa pelatihan ulang, dalam FP32, opset 17, dengan dimensi spasial dinamis. `manifest.json` menyimpan SHA-256 checkpoint dan ONNX, kelas aktual, serta kontrak tensor yang diperiksa. Model menghasilkan `[1, 300, 6]`: `x1,y1,x2,y2,confidence,class_id`. Model ini end-to-end; jangan menerapkan NMS YOLO versi lama atau mengubah koordinat corner menjadi center/width/height.

Prapemrosesan menggunakan RGB/255, warna padding 114, stride 32, pembulatan resolusi ke kelipatan 32, dan letterbox persegi panjang seperti pipeline PyTorch yang ada. Browser memakai interpolasi bilinear eksplisit karena filter downsampling canvas berbeda antar-browser. Dekoder media, representasi warna, backend GPU, dan interpolasi piksel dapat menimbulkan perbedaan numerik kecil; parity numerik tidak menggantikan evaluasi lapangan dengan dataset berlabel.

Validasi yang dapat diulang:

```powershell
.\.venv\Scripts\python.exe -m pip install -r tools/requirements-onnx.txt
.\.venv\Scripts\python.exe tools/export_onnx.py
# Validasi ulang tanpa mengekspor ulang:
.\.venv\Scripts\python.exe tools/export_onnx.py --skip-export
```

Laporan aktual tersimpan dalam `tools/onnx-validation.json`, mencakup 30 perbandingan atas tiga orientasi/rasio, lima resolusi, dan dua confidence threshold. Worker memverifikasi hash ONNX sebelum membuat sesi. Model ONNX harus dapat diunduh publik agar inferensi browser bekerja; jangan menganggap bobot yang dikirim ke browser sebagai rahasia.

## Menyiapkan Supabase

1. Buat project **Free** di Supabase. Simpan database password di pengelola sandi, bukan frontend.
2. Buka **SQL Editor**, jalankan isi `supabase/migrations/202611250001_browser_architecture.sql` sekali pada project baru. Alternatif: gunakan Supabase CLI dengan `supabase link` dan `supabase db push`.
3. Opsional, jalankan `supabase/retention.sql` untuk pembersihan per jam melalui Supabase Cron. Tanpa Cron, pembersihan tetap dijalankan ketika hasil atau pengaturan disimpan. Kedaluwarsa availability selalu diperiksa saat dibaca, terlepas dari Cron.
4. Pada **Authentication**, aktifkan email/password dan nonaktifkan pendaftaran publik. Buat akun operator dari dashboard dengan email dan kata sandi awal, lalu pastikan email dikonfirmasi. Pengelolaan akun/kata sandi dilakukan administrator melalui Supabase; aplikasi tidak menyediakan signup publik.
5. Salin UUID akun dari daftar pengguna. Tambahkan melalui SQL Editor:

```sql
insert into public.operators(user_id) values ('UUID_AKUN_OPERATOR');
```

Menjadi pengguna Auth saja tidak memberi akses operator. Pengguna aplikasi tidak dapat menambah dirinya ke tabel `operators`. Untuk mencabut izin, hapus baris allowlist tersebut; RLS dan RPC langsung menolak penulisan berikutnya.

6. Di pengaturan **Data API / API keys**, salin project URL dan **publishable key**. Legacy anon key juga dapat digunakan. Jangan memasukkan `service_role`, secret key, atau database password ke variabel `VITE_*`.
7. Periksa **Database / Publications / supabase_realtime**. Migrasi memasukkan `camera_reports`, `floors`, `zones`, `cameras`, dan `app_settings` jika publication tersedia. Bila belum tersedia, aktifkan Realtime dan tambahkan kelima tabel tersebut. Jangan publish `history`, `camera_sources`, `camera_leases`, atau `operators`.
8. Atur Auth **Site URL** ke URL produksi Vercel; tambahkan URL pengembangan dan URL produksi ke daftar redirect yang diizinkan bila menggunakan undangan/reset password.
9. Masuk ke aplikasi melalui `/masuk`, lalu konfigurasi lantai, zona, dan kamera pada **Pengaturan**. Database baru tidak diberi hasil deteksi, statistik, atau konfigurasi lokasi palsu.

RLS mengizinkan pembacaan konfigurasi lokasi dan aggregate availability oleh mahasiswa, serta menolak seluruh penulisannya. Riwayat, metadata pelatihan, lease kamera, dan URL gateway hanya dapat diakses operator allowlist. Semua hasil kamera memakai lease eksklusif, waktu PostgreSQL, validasi jumlah, dan RPC yang memeriksa pemilik sesi. Browser tidak pernah mengunggah gambar atau video ke Supabase.

## Memindahkan data SQLite yang sudah ada

Hentikan penulisan ke aplikasi lama selama pengambilan snapshot. Buat ekspor lokal:

```powershell
.\.venv\Scripts\python.exe tools/export_sqlite.py
```

Tool membaca SQLite dalam mode read-only dan menghasilkan `.local/sqlite-import.sql` yang diabaikan Git. Jalankan SQL tersebut pada project Supabase kosong setelah migrasi skema, sebelum membuat konfigurasi baru. Ekspor mempertahankan ID, referensi lantai/zona/kamera, riwayat, pengaturan, dan metadata. URL stream dipisahkan ke tabel privat. File dapat berisi kredensial kamera: jangan commit, unggah ke Vercel, atau simpan di direktori `public`. Untuk database besar, jalankan melalui koneksi PostgreSQL/`psql` daripada menempelkan seluruhnya ke SQL Editor.

Ekspor tidak menggabungkan dua database yang sudah berisi data; konflik ID/nama akan menggagalkan transaksi. Tinjau retensi yang diimpor, karena penyimpanan berikutnya memangkas riwayat yang sudah melewati masa retensi. Migrasi tidak mengubah SQLite lama.

## Menjalankan versi browser secara lokal

Node.js 22 atau lebih baru diperlukan. Python tidak diperlukan untuk menjalankan frontend setelah model ONNX tersedia.

```powershell
Copy-Item frontend/.env.example frontend/.env.local
# Isi URL dan publishable key Supabase di frontend/.env.local.
npm --prefix frontend ci
npm --prefix frontend run dev
```

Buka URL Vite yang ditampilkan. Versi browser adalah default; `VITE_RUNTIME=browser` dapat ditulis eksplisit. HTTPS diperlukan untuk kamera pada ponsel. `localhost` di ponsel menunjuk ke ponsel tersebut; gunakan deployment HTTPS Vercel untuk pengujian kamera ponsel.

Untuk versi FastAPI/SQLite lama, jalankan `run-dev.bat`. Launcher memilih `VITE_RUNTIME=legacy` khusus proses frontend tersebut dan mempertahankan proxy API/WebSocket. Jangan memakai mode legacy pada deployment statis.

## Deployment Vercel langkah demi langkah

1. Pastikan perubahan lokal telah direview dan didorong ke repository Anda, termasuk `frontend/public/models/yolo26s.onnx`, `manifest.json`, dan lockfile npm. Model sekitar 38 MB, di bawah batas berkas GitHub biasa; ekspor Python tidak dijalankan oleh Vercel.
2. Buat project Vercel dan **Import Git Repository** yang sama. Gunakan root repository sebagai **Root Directory**, bukan `frontend`, agar `vercel.json` root berlaku.
3. Pilih preset **Vite** dan Node.js 22+. Konfigurasi yang sudah disertakan menggunakan:
   - Install: `npm --prefix frontend ci --no-audit --no-fund`
   - Build: `npm --prefix frontend run build`
   - Output: `frontend/dist`
4. Tambahkan variabel lingkungan untuk Production dan Preview:

```text
VITE_RUNTIME=browser
VITE_SUPABASE_URL=https://PROJECT_ANDA.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=PUBLISHABLE_KEY_ANDA
```

Jangan mengatur `VITE_API_URL`, `SSS_BACKEND_URL`, atau secret key. Variabel Vite ditanam saat build; perubahan memerlukan redeploy.

5. Klik **Deploy**. Tidak ada Vercel Function atau server Python yang dibuat. Build menyalin aset WASM/MJS dari package ONNX Runtime yang versinya dikunci.
6. Atur URL Vercel pada Supabase Auth. Buka `/`, `/masuk`, dan direct link seperti `/operator/video` untuk memeriksa SPA routing.
7. Uji dua browser/perangkat: operator login lalu mulai kamera terdaftar; mahasiswa menerima aggregate availability. Hentikan kamera dan tutup tab operator: availability harus menjadi offline, segera saat release diterima atau maksimal 45 detik sejak laporan terakhir.
8. Periksa Network: hanya aset Vercel dan koneksi HTTPS/WSS Supabase yang diperlukan; tidak boleh ada panggilan runtime ke localhost atau `/api` FastAPI. Mahasiswa tidak perlu mengunduh model.
9. Uji deteksi gambar, MP4 H.264, ekspor CSV/JSON/PNG, video MP4/WebM, konfigurasi, serta analytics setelah ada hasil kamera asli.

`vercel.json` mengatur fallback SPA, MIME-safe headers, CSP yang mengizinkan WASM/worker, dan cache model. Konfigurasi tidak membutuhkan cross-origin isolation; WASM menggunakan satu thread agar kompatibel dengan lebih banyak browser.

## Video dan kamera: kemampuan serta batasan

- Masukan tetap maksimal 150 MB dan 10 menit, 240 FPS, 16.777.216 piksel per frame, dan 8.192 piksel per sisi. Frame sampel diperkecil otomatis ke 1920×1080 atau 1080×1920 tanpa upscale, stretch, atau crop; rasio aspek dipertahankan. Sisi ganjil diberi padding satu piksel saat ekspor untuk kompatibilitas encoder.
- Sampling mempertahankan pilihan setiap N frame dan batas 1.200 frame analisis. Decoder memproses secara incremental dengan antrean empat frame. Setiap frame dibebaskan setelah dipakai. ONNX berjalan di worker dan satu permintaan inferensi dijalankan pada satu waktu.
- Ekspor memakai WebCodecs dengan timestamp eksplisit; lambatnya inferensi tidak memperlambat hasil playback. H.264/MP4 dicoba lebih dahulu, kemudian VP9/VP8 WebM. Audio tidak diekspor, sesuai implementasi lama. Buffer hasil dibatasi 128 MB selama encoding. Tidak ada transcode video penuh sebelum inferensi.
- MP4/MOV H.264 merupakan pilihan paling kompatibel. Dukungan container/codec browser lebih sempit daripada OpenCV; AVI, HEVC, dan beberapa codec MOV mungkin tidak dapat dibuka. Browser memberikan pesan kegagalan; FastAPI lama tetap mendukung codec yang tersedia di OpenCV.
- Hasil gambar/video disimpan di tab browser, bukan Storage Supabase. Unduh sebelum meninggalkan halaman. Navigasi dari halaman video membatalkan proses dan membebaskan URL hasil. Ringkasan/koordinat disimpan ke history bila Supabase tersedia; kegagalan penyimpanan ditampilkan dan hasil lokal tetap bisa diunduh.
- Pemantauan langsung membutuhkan perangkat kamera aktif dan sesi browser operator. Menutup/background tab menghentikan pemantauan; server tidak melakukan inferensi sendiri. Kamera smartphone dapat dipakai langsung lewat HTTPS tanpa laptop.
- RTSP tidak didukung browser secara langsung. Kamera IP membutuhkan media gateway tambahan yang menyajikan stream HTTPS yang dapat diputar browser, dengan CORS dan codec yang sesuai. URL HLS hanya bekerja bila browser mendukungnya secara native; WHEP/WebRTC signaling bukan URL video progresif dan membutuhkan integrasi gateway tersendiri. Tidak ada gateway berbayar wajib atau gateway palsu yang disertakan.
- Tracking mempertahankan greedy IoU, jendela oklusi tiga frame, dan ringkasan median hasil observasi. Hanya aggregate kamera yang dikirim setiap 15 detik, history live maksimal satu catatan per menit per kamera. Report kedaluwarsa setelah 45 detik dan lease setelah 60 detik. UI menghapus angka kedaluwarsa sebelum mencoba refresh jaringan.
- Smartphone/laptop lambat dapat memilih 320/480 px dan interval lebih besar. WebGPU dicoba bila tersedia dan otomatis kembali ke WASM jika adapter atau operator graph tidak didukung. YOLO26s asli tidak diganti model lebih kecil atau dikuantisasi, sehingga memori dan waktu inisialisasi tetap signifikan.
- Pratinjau kamera dapat dibagikan ke tab operator pada browser/perangkat yang sama melalui BroadcastChannel lokal. Operator di perangkat lain menerima aggregate dan history, bukan gambar kamera. Gambar pratinjau tidak melewati Supabase. Inferensi browser memerlukan pengguna mempercayai operator; RLS membatasi penulis, bukan membuktikan bahwa setiap angka berasal dari model.

## Anggaran free tier

Tidak ada layanan berbayar wajib, tetapi kapasitas gratis bukan tanpa batas. Saat diperiksa, Supabase Free mencakup 500 MB database, 5 GB egress, 200 koneksi Realtime bersamaan, dan 2 juta pesan Realtime per bulan; project gratis dapat dijeda setelah seminggu tidak aktif. Periksa [harga Supabase](https://supabase.com/pricing) sebelum deployment. Realtime menghitung pengiriman ke subscriber: satu kamera tiap 15 detik selama 30 hari kira-kira 172.800 update, dikalikan jumlah penerima aktif. Banyak kamera/mahasiswa dapat melampaui kuota meski inferensi lokal gratis.

Gunakan retensi awal tujuh hari, Cron pembersihan, dan pantau dashboard usage. Media tidak disimpan/diunggah. Model 38 MB dan runtime WASM puluhan MB dihosting/cache Vercel, hanya dimuat untuk operator yang menjalankan inferensi. Vercel Hobby juga memiliki batas dan ketentuan penggunaan; pastikan penggunaan institusi Anda memenuhi [ketentuan Hobby](https://vercel.com/docs/plans/hobby). Jangan mengklaim deployment kampus berskala besar dijamin tetap gratis.

## Pengujian

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
.\.venv\Scripts\python.exe tools/export_onnx.py --skip-export
.\.venv\Scripts\python.exe tools/browser_fixtures.py
npm --prefix frontend test
npm --prefix frontend run test:database
npm --prefix frontend run build
npm --prefix frontend run test:production
```

Playwright memakai Edge yang terpasang dan kamera virtual yang diberi gambar fixture asli; prediksi tetap berasal dari checkpoint sebenarnya. Pada OS lain pilih browser yang terpasang lewat `PLAYWRIGHT_CHANNEL` atau sesuaikan konfigurasi Playwright dan instal browser resminya. PGlite menjalankan migrasi, RLS, lease, dan query analytics pada PostgreSQL sungguhan yang ditanam di proses uji; harness hanya menggantikan identitas Auth. Ini bukan pengujian layanan Supabase Auth/Realtime hosted. Pengujian hosted, kuota aktual, perangkat mobile fisik, gateway RTSP, dan penerbitan Vercel membutuhkan project/perangkat Anda; jangan menganggapnya telah dilakukan hanya karena build lokal lulus.
