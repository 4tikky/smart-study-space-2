@echo off
setlocal
cd /d "%~dp0"
if /i "%~1"=="backend" goto backend
if /i "%~1"=="frontend" goto frontend

where py >nul 2>&1
if errorlevel 1 (
    echo Python Launcher tidak ditemukan. Instal Python 3.12 untuk Windows.
    goto fail
)
py -3.12 -c "import sys" >nul 2>&1
if errorlevel 1 (
    echo Python 3.12 tidak ditemukan. Instal Python 3.12 untuk Windows.
    goto fail
)
where node >nul 2>&1
if errorlevel 1 (
    echo Node.js tidak ditemukan. Instal Node.js 22 LTS atau lebih baru.
    goto fail
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) < 22 ? 1 : 0)"
if errorlevel 1 (
    echo Instal Node.js 22 LTS atau lebih baru.
    goto fail
)
where npm >nul 2>&1
if errorlevel 1 (
    echo npm tidak ditemukan. Pasang npm melalui installer Node.js.
    goto fail
)
if not exist "weights.pt" (
    echo weights.pt tidak ditemukan. Ekstrak proyek bersama bobot aslinya.
    goto fail
)
if not exist ".venv\Scripts\python.exe" (
    py -3.12 -m venv .venv
    if errorlevel 1 goto fail
)
.venv\Scripts\python.exe -c "import torch, torchvision" >nul 2>&1
if errorlevel 1 (
    .venv\Scripts\python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
    if errorlevel 1 goto fail
)
.venv\Scripts\python.exe -m pip install --disable-pip-version-check -r backend\requirements.txt
if errorlevel 1 goto fail
call npm --prefix frontend ci --no-audit --no-fund
if errorlevel 1 goto fail

start "Smart Study Space - FastAPI" "%ComSpec%" /k call "%~f0" backend
start "Smart Study Space - Vite" "%ComSpec%" /k call "%~f0" frontend
echo.
echo Buka http://localhost:5173 setelah kedua layanan aktif.
echo API dan dokumentasi: http://localhost:8000/docs
echo Gunakan Ctrl+C di masing-masing jendela untuk menghentikan layanan.
exit /b 0

:backend
.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --ws-max-size 2097152 --reload --reload-dir backend
exit /b %errorlevel%

:frontend
call npm --prefix frontend run dev -- --strictPort
exit /b %errorlevel%

:fail
echo Penyiapan Smart Study Space gagal. Lihat pesan di atas.
pause
exit /b 1
