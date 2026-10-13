@echo off
REM ─────────────────────────────────────────────────────────────
REM  Backup database Supabase ResiAH ke folder backup\
REM  Password diminta saat runtime (tidak tersimpan di file/history).
REM  Ambil password: Supabase Dashboard > Project Settings >
REM                  Database > Database password
REM ─────────────────────────────────────────────────────────────
setlocal

set PROJECT_REF=ytsvvbbsrnoxwlsbaoja
set PGHOST=aws-0-ap-northeast-1.pooler.supabase.com
set PGPORT=5432
set PGUSER=postgres.%PROJECT_REF%
set PGDATABASE=postgres

for /f "tokens=1-3 delims=/ " %%a in ('date /t') do set D=%%c-%%b-%%a
for /f "tokens=1-2 delims=:" %%a in ('time /t') do set T=%%a%%b
set STAMP=%D%_%T: =%
set OUTDIR=%~dp0..\backup\%STAMP%

echo.
echo  Backup Supabase ResiAH
echo  Host : %PGHOST%
echo  Ke   : %OUTDIR%
echo.

set /p PGPASSWORD=Database password (tidak tampil saat diketik di beberapa terminal): 
if "%PGPASSWORD%"=="" (
  echo [BATAL] Password kosong.
  exit /b 1
)

mkdir "%OUTDIR%" 2>nul

echo.
echo [1/3] Dump struktur (schema, RLS policy, function, index)...
pg_dump --schema-only --no-owner --no-privileges -n public -f "%OUTDIR%\01-schema.sql"
if errorlevel 1 goto :fail

echo [2/3] Dump data (semua tabel public)...
pg_dump --data-only --no-owner --no-privileges -n public -f "%OUTDIR%\02-data.sql"
if errorlevel 1 goto :fail

echo [3/3] Dump user auth...
pg_dump --no-owner --no-privileges -n auth -t auth.users -f "%OUTDIR%\03-auth-users.sql"
if errorlevel 1 echo    (dilewati - tidak ada akses ke schema auth, normal)

set PGPASSWORD=
echo.
echo  SELESAI. File ada di:
echo  %OUTDIR%
dir /b "%OUTDIR%"
echo.
echo  Cara restore nanti: psql -f 01-schema.sql lalu psql -f 02-data.sql
exit /b 0

:fail
set PGPASSWORD=
echo.
echo [GAGAL] pg_dump error. Cek password, atau coba host direct:
echo         db.%PROJECT_REF%.supabase.co (butuh IPv6)
exit /b 1
