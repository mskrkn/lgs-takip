@echo off
REM ============================================================
REM  ARTIK KULLANILMIYOR - CALISTIRMAYIN
REM  Sistem Google Cloud'daki "edupusula-sunucu" VM'sine tasindi
REM  (bkz. eski_sunucuyu_durdur.bat). Bu script bu bilgisayarda
REM  edupusula.com tuneline IKINCI bir baglanti kurar; bu da
REM  Cloudflare'in trafigi bu PC ile VM arasinda rastgele
REM  paylastirmasina ve iki ayri SQLite veritabaninin olusmasina
REM  yol acar. Canliya yeni kod gondermek icin deploy_vm.bat kullanin.
REM ============================================================
REM
REM --- Asagisi eski duzeltme adimlaridir, referans icin birakildi ---
REM  Cloudflare Tunnel servis DUZELTME script'i
REM  BU DOSYAYI SAG TIK > "Yonetici olarak calistir" ILE ACIN.
REM  Onceki kurulumda "Cloudflared" servisi yanlis (parametresiz)
REM  kurulmustu ve surekli cokuyordu. Bu script onu kaldirip
REM  NSSM ile dogru parametrelerle yeniden kurar.
REM ============================================================
echo UYARI: Bu script artik kullanilmiyor, sistem VM'e tasindi.
echo Devam etmek istediginize EMIN misiniz? Degilseniz Ctrl+C ile kapatin.
pause

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo HATA: Bu dosyayi Yonetici olarak calistirmaniz gerekiyor.
    echo Sag tik yapip "Yonetici olarak calistir" secin.
    pause
    exit /b 1
)

chcp 65001 >nul
set CFEXE=C:\Program Files (x86)\cloudflared\cloudflared.exe
set NSSMEXE=C:\Users\mskrk\AppData\Local\Microsoft\WinGet\Packages\NSSM.NSSM_Microsoft.Winget.Source_8wekyb3d8bbwe\nssm-2.24-101-g897c7ad\win64\nssm.exe
set SYSCF=C:\Windows\System32\config\systemprofile\.cloudflared
set TUNNELID=4011180a-6553-4324-9413-adfbdca4d7ba
set PROJDIR=C:\Users\mskrk\OneDrive\Desktop\denemetakipmskrkn

echo ========================================================
echo  1/3: Bozuk "Cloudflared" servisi kaldiriliyor
echo ========================================================
net stop Cloudflared >nul 2>&1
"%CFEXE%" service uninstall >nul 2>&1
sc delete Cloudflared >nul 2>&1

echo ========================================================
echo  2/3: Ayar dosyalarinin SYSTEM hesabina kopyalandigindan
echo       emin olunuyor
echo ========================================================
if not exist "%SYSCF%" mkdir "%SYSCF%"
copy /Y "%USERPROFILE%\.cloudflared\config.yml" "%SYSCF%\config.yml" >nul
copy /Y "%USERPROFILE%\.cloudflared\%TUNNELID%.json" "%SYSCF%\%TUNNELID%.json" >nul
echo Kopyalandi: %SYSCF%

echo ========================================================
echo  3/3: Tunel, NSSM ile DOGRU parametrelerle servis olarak
echo       kuruluyor
echo ========================================================
sc query CloudflaredTunnel >nul 2>&1
if %errorlevel% equ 0 (
    net stop CloudflaredTunnel >nul 2>&1
    "%NSSMEXE%" remove CloudflaredTunnel confirm >nul 2>&1
)
"%NSSMEXE%" install CloudflaredTunnel "%CFEXE%"
"%NSSMEXE%" set CloudflaredTunnel AppParameters "tunnel run denemetakip"
"%NSSMEXE%" set CloudflaredTunnel Start SERVICE_AUTO_START
"%NSSMEXE%" set CloudflaredTunnel AppStdout "%PROJDIR%\tunnel_log.txt"
"%NSSMEXE%" set CloudflaredTunnel AppStderr "%PROJDIR%\tunnel_hata.txt"
net start CloudflaredTunnel

echo.
echo ========================================================
echo  Kontrol ediliyor (5 saniye bekleniyor)...
echo ========================================================
timeout /t 5 /nobreak >nul
sc query CloudflaredTunnel

echo.
echo Servis durumu "RUNNING" yaziyorsa basarili demektir.
echo https://edupusula.com adresini birkac saniye icinde
echo tekrar deneyebilirsiniz.
pause
