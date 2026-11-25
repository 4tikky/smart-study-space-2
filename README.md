# Smart Study Space

Pemantauan ketersediaan kursi untuk Perpustakaan Universitas Diponegoro. Tampilan mahasiswa menampilkan ketersediaan per lantai dan zona. Ruang kerja operator menyediakan deteksi gambar, video, pemantauan kamera, konfigurasi, dan analitik.

React, TypeScript, Vite, Tailwind CSS, komponen shadcn/ui berbasis Radix, Lucide, Recharts, dan Framer Motion digunakan pada frontend. Backend FastAPI menggunakan Python 3.12, Ultralytics YOLO, OpenCV, Pillow, WebSocket, dan SQLite.

## Jalankan di Windows

1. Instal **Python 3.12** dengan Python Launcher (`py`) dan **Node.js 22 LTS atau lebih baru** dengan npm.
2. Ekstrak proyek. Pastikan `weights.pt` berada di direktori yang sama dengan `app.py` dan `run-dev.bat`.
3. Klik dua kali `run-dev.bat`. Instalasi pertama memerlukan internet untuk mengunduh dependensi, termasuk PyTorch untuk CPU.
4. Buka [dasbor mahasiswa](http://localhost:5173). Backend tersedia di [port 8000](http://localhost:8000/api/health) dan [Swagger UI](http://localhost:8000/docs). Tunggu status **Model siap** pada halaman **Informasi Model** sebelum menjalankan inferensi.

Biarkan kedua jendela terminal terbuka. Tekan Ctrl+C di masing-masing jendela untuk menghentikan layanan.

### Instalasi manual

Dari PowerShell pada direktori proyek:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
npm --prefix frontend ci
```

Terminal backend:

```powershell
.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --ws-max-size 2097152
```

Terminal frontend:

```powershell
npm --prefix frontend run dev -- --strictPort
```

Di Linux atau macOS, buat lingkungan dengan `python3.12 -m venv .venv` lalu gunakan `.venv/bin/python` dan perintah npm yang sama. Pada macOS instal PyTorch dari PyPI. Perintah build frontend adalah `npm --prefix frontend run build`.

### Konfigurasi lingkungan

SQLite diinisialisasi otomatis saat backend dijalankan. Data disimpan di `backend/data/study-space.sqlite3` secara default. Lantai 1–3 dibuat pada inisialisasi pertama tanpa kamera, catatan, atau statistik bawaan.

| Variabel | Lokasi | Fungsi |
| --- | --- | --- |
| `SSS_DATA_DIR` | `.env` di root | Direktori SQLite, pengaturan library Python, dan job video |
| `SSS_ORIGINS` | `.env` di root | Daftar origin browser dipisahkan koma. Default mencakup localhost dan 127.0.0.1 pada port 5173 |
| `SSS_BACKEND_URL` | `frontend/.env.local` | Target proxy Vite untuk API dan WebSocket |
| `VITE_API_URL` | `frontend/.env.local` | URL API opsional untuk mengakses FastAPI langsung |

Berkas contoh disertakan. Gunakan satu proses FastAPI. Status kamera langsung dan antrean video bersifat lokal di proses tersebut. Mode demo menyediakan peralihan peran tanpa autentikasi. Launcher membatasi akses ke loopback.

## Alur penggunaan

### Mahasiswa

Beranda merangkum kursi pada area dengan kamera yang terhubung dan memiliki hasil terbaru. Pilih **Lihat detail** untuk melihat status kamera, zona, dan skema zona jika operator menetapkan posisi baris dan kolom. Kartu lantai menandai sumber tanpa konfigurasi dan sumber offline. Jumlah yang ditampilkan berasal dari kursi yang terdeteksi di area terpantau. Tampilan mahasiswa hanya meminta data agregat. Foto di beranda adalah ilustrasi.

### Operator

- **Deteksi Gambar** menerima JPG, JPEG, PNG, atau WebP hingga 20 MB dan 24 megapiksel. Pilih **Analisis gambar** untuk melihat prediksi, koordinat, dan waktu inferensi. Hasil dapat diunduh sebagai gambar PNG beranotasi, CSV, atau JSON.
- **Deteksi Video** menerima MP4, AVI, atau MOV hingga 150 MB dan 10 menit, dengan maksimal 1920 piksel di sisi terpanjang serta sekitar 2,1 megapiksel per frame. Dukungan decoding bergantung pada codec OpenCV. Server menganalisis frame sampel dan mengekspor MP4 H.264 tanpa audio. Sampling otomatis dibatasi hingga 1.200 frame. Grafik menggunakan waktu sumber yang diberikan decoder jika tersedia, dengan perkiraan berbasis FPS sebagai cadangan. Video hasil menggunakan cadence sampling konstan. Catatan sesi video menyimpan ringkasan frame sampel terakhir.
- **Pemantauan Langsung** membuka webcam atau kamera USB melalui browser. Pilih perangkat dari daftar, izinkan akses kamera, lalu pilih **Mulai pemantauan**. Untuk menayangkan hasil ke dasbor mahasiswa, daftarkan sumber kamera dan pilih sumber itu saat memulai sesi. Kamera IP atau RTSP membutuhkan URL yang dapat dijangkau oleh backend serta codec yang didukung. **Hentikan pemantauan** atau tutup halaman untuk mengakhiri sesi. Atur confidence dan interval sebelum memulai. Opsi **Otomatis** menggunakan CUDA jika build PyTorch mendukungnya dan GPU tersedia.
- **Pengaturan** mengelola lantai, zona, kamera, ambang ketersediaan, dan retensi. Gunakan satu kamera per lantai tanpa zona atau satu per zona yang masing-masing memiliki cakupan fisik terpisah. Saat ada kamera zona aktif secara konfigurasi, total lantai memakai cakupan zona. Posisi baris dan kolom adalah skema zona, dan stopkontak merupakan informasi fasilitas yang diisi manual.
- **Riwayat Deteksi** menyimpan sesi, waktu, lokasi, jumlah kursi, dan durasi inferensi. Gunakan filter lalu pilih **Ekspor CSV** untuk mengunduh catatan sesuai filter. Untuk kamera langsung, backend menyimpan pengamatan pertama, pengamatan berkala, dan pengamatan terakhir jika waktunya berbeda.
- **Analitik** memakai sampel riwayat dari kamera terdaftar. Grafik dan perbandingan menampilkan rata-rata per sampel sesuai rentang dan pengelompokan dalam WIB.
- **Informasi Model** menampilkan YOLO26s dan status checkpoint `weights.pt`. Kelasnya adalah `EmptyChair` dan `OccupiedChair`. Masukkan metadata evaluasi berdasarkan laporan yang diketahui dan cantumkan referensinya. Metadata yang kosong ditampilkan sebagai **Tidak tersedia**.

## Penyimpanan dan cara menghitung

Keterisian dihitung sebagai kursi terisi dibagi total kursi terdeteksi. Bila tidak ada deteksi, keterisian ditampilkan sebagai tanda pisah. Pemantauan memakai pengamatan median dari tiga frame terbaru setelah riwayat pendek terisi. Kotak pada pratinjau selalu berasal dari frame yang ditampilkan. Pelacakan berbasis tumpang tindih memberi ID sementara selama satu sesi. Objek yang tertutup lama atau bergerak cepat dapat memperoleh ID baru. Jumlah deteksi per frame tidak dijumlahkan sebagai kursi unik.

Frame kamera langsung dipertahankan di memori untuk pratinjau selama sesi. SQLite menyimpan agregat kamera dan rincian geometris deteksi gambar. Gambar yang diunggah diproses di memori. Video unggahan dihapus setelah job selesai. Hasil MP4 bersifat sementara selama sekitar satu jam dan dibersihkan otomatis. Berkas hasil dapat diunduh oleh operator selama masih tersedia. Retensi riwayat default 90 hari dan bisa diubah di pengaturan.

## Pengujian

```powershell
npm --prefix frontend run build
.venv\Scripts\python.exe -m pip install -r backend\requirements-test.txt
.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
.venv\Scripts\python.exe -m compileall -q backend
```

Uji backend menjalankan checkpoint asli pada CPU, memeriksa jumlah dan koordinat kotak, mengekspor video dan riwayat CSV, mengirim beberapa frame melalui WebSocket, dan memeriksa perubahan status serta agregat lantai sebelum, selama, dan setelah sesi. Uji WebSocket menggunakan input visual yang diketahui agar hasil bisa diulang. Ilustrasi tersebut berfungsi sebagai input uji, dan semua hasil uji berasal dari inferensi YOLO.

Build produksi frontend, uji FastAPI, dan tujuh uji Streamlit lolos pada Linux. Ekspor video diperiksa sebagai MP4 H.264. Uji jaringan lokal juga mengalirkan HTTP MJPEG melalui OpenCV, YOLO, dan WebSocket hingga perubahan status lantai terverifikasi. Windows, perangkat webcam/USB, dan kamera RTSP fisik belum diuji. Verifikasi tampilan browser pada desktop dan seluler, unduhan di browser, dan pemulihan koneksi di browser tertunda karena relay pratinjau lingkungan tidak merespons.

Untuk uji lokal dengan perangkat fisik, daftarkan satu kamera untuk Lantai 1 dari **Pengaturan**, mulai pemantauan dari tab operator, lalu buka beranda mahasiswa pada tab kedua. Periksa pembaruan kursi dan transisi offline saat pemantauan dihentikan. Uji unggah gambar, unduh PNG/CSV/JSON, putar hasil video, dan periksa tampilan pada lebar 390 px serta pada desktop. Hentikan backend saat frontend terbuka untuk memeriksa pesan koneksi dan pulihkan dengan menjalankan backend lagi.

## Struktur

- `frontend/src/components`, `layouts`, `pages`, `hooks`, `services`: antarmuka mahasiswa dan operator.
- `backend/routers`, `services`, dan `database`: API, pemrosesan media, sesi live, dan persistensi SQLite.
- `weights.pt` dan `inference.py`: checkpoint asli serta fungsi validasi, normalisasi prediksi, dan ringkasan yang digunakan kembali.
- `app.py`, `run.bat`, dan `requirements.txt`: aplikasi Streamlit cadangan. Jalankan `run.bat` dan buka [localhost:8501](http://localhost:8501).
