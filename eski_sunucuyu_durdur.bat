@echo off
REM SAG TIK > "Yonetici olarak calistir" ile acin.
REM Sistem artik Google Cloud'daki edupusula-sunucu VM'sine tasindi.
REM Bu bilgisayardaki eski servisleri durdurup otomatik baslamalarini kapatir
REM (ileride Yonetim/Ayarlar icin sunucuyu manuel calistirmak isterseniz
REM  baslat.bat hala kullanilabilir olacak, sadece otomatik/surekli
REM  calismalari durduruluyor).
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo HATA: Yonetici olarak calistirmaniz gerekiyor.
    pause
    exit /b 1
)
chcp 65001 >nul
echo Eski Cloudflare Tunnel servisi durduruluyor...
net stop CloudflaredTunnel
sc config CloudflaredTunnel start= disabled

echo Eski Deneme Takip sunucu servisi durduruluyor...
net stop DenemeTakipSunucu
sc config DenemeTakipSunucu start= disabled

echo.
echo Tamamlandi. Artik sistem Google Cloud'daki sunucudan calisiyor.
pause
