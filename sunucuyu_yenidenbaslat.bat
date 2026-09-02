@echo off
REM SAG TIK > "Yonetici olarak calistir" ile acin.
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo HATA: Yonetici olarak calistirmaniz gerekiyor.
    pause
    exit /b 1
)
chcp 65001 >nul
echo Sunucu servisi yeniden baslatiliyor (duzeltilmis kod yuklenecek)...
net stop DenemeTakipSunucu
net start DenemeTakipSunucu
echo.
echo Tamamlandi.
pause
