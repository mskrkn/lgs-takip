@echo off
REM ============================================================
REM  ARTIK KULLANILMIYOR - CALISTIRMAYIN
REM  Sistem Google Cloud'daki "edupusula-sunucu" VM'sine tasindi
REM  (bkz. eski_sunucuyu_durdur.bat). Bu script bu bilgisayarda
REM  edupusula.com tuneline IKINCI bir baglanti + yerel sunucu
REM  kurar; bu durum Cloudflare'in trafigi bu PC ile VM arasinda
REM  rastgele paylastirmasina ve iki ayri (birbirinden habersiz)
REM  SQLite veritabaninin olusmasina yol acar. Canliya yeni kod
REM  gondermek icin deploy_vm.bat kullanin.
REM ============================================================
REM
REM --- Asagisi eski kurulum adimlaridir, referans icin birakildi ---
REM  Deneme Takip Sistemi - Arka Plan Servisi Kurulumu
REM  BU DOSYAYI SAG TIK > "Yonetici olarak calistir" ILE ACIN.
REM  Tek seferlik bir kurulumdur; kurulduktan sonra bilgisayar
REM  her acildiginda sunucu ve tunel otomatik, pencere acmadan
REM  arka planda baslar.
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
set PROJDIR=C:\Users\mskrk\OneDrive\Desktop\denemetakipmskrkn
set CFEXE=C:\Program Files (x86)\cloudflared\cloudflared.exe
set NSSMEXE=C:\Users\mskrk\AppData\Local\Microsoft\WinGet\Packages\NSSM.NSSM_Microsoft.Winget.Source_8wekyb3d8bbwe\nssm-2.24-101-g897c7ad\win64\nssm.exe
set SYSCF=C:\Windows\System32\config\systemprofile\.cloudflared
set TUNNELID=4011180a-6553-4324-9413-adfbdca4d7ba
set PYEXE=C:\Users\mskrk\AppData\Local\Programs\Python\Python314\python.exe

echo ========================================================
echo  1/2: Cloudflare Tunnel servisi kuruluyor
echo ========================================================

sc query Cloudflared >nul 2>&1
if %errorlevel% equ 0 (
    echo Zaten kurulu, atlaniyor.
) else (
    if not exist "%SYSCF%" mkdir "%SYSCF%"
    copy /Y "%USERPROFILE%\.cloudflared\config.yml" "%SYSCF%\config.yml" >nul
    copy /Y "%USERPROFILE%\.cloudflared\%TUNNELID%.json" "%SYSCF%\%TUNNELID%.json" >nul
    "%CFEXE%" service install
    sc config Cloudflared start= auto >nul
)
net start Cloudflared

echo.
echo ========================================================
echo  2/2: Deneme Takip sunucu servisi kuruluyor
echo ========================================================

sc query DenemeTakipSunucu >nul 2>&1
if %errorlevel% equ 0 (
    echo Zaten kurulu, atlaniyor.
) else (
    "%NSSMEXE%" install DenemeTakipSunucu "%PYEXE%" "%PROJDIR%\server.py"
    "%NSSMEXE%" set DenemeTakipSunucu AppDirectory "%PROJDIR%"
    "%NSSMEXE%" set DenemeTakipSunucu Start SERVICE_AUTO_START
    "%NSSMEXE%" set DenemeTakipSunucu AppStdout "%PROJDIR%\servis_log.txt"
    "%NSSMEXE%" set DenemeTakipSunucu AppStderr "%PROJDIR%\servis_hata.txt"
)
net start DenemeTakipSunucu

echo.
echo ========================================================
echo  Kurulum tamamlandi.
echo  - "Cloudflared" ve "DenemeTakipSunucu" servisleri artik
echo    bilgisayar her acildiginda, pencere gormeden, otomatik
echo    calisacak.
echo  - https://edupusula.com adresi artik surekli aktif.
echo  - Artik baslat.bat'i CALISTIRMANIZA GEREK YOK. Calistirirsaniz
echo    "port kullanimda" hatasi alabilirsiniz (servisler zaten
echo    o portu kullaniyor olacak).
echo ========================================================
pause
