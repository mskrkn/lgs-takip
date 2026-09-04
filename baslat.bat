@echo off
title LGS Deneme Takip Sistemi (YEREL TEST)
chcp 65001 >nul
cls
echo ========================================================
echo   LGS Deneme Takip Sistemi - YEREL TEST MODU
echo ========================================================
echo.
echo  UYARI: edupusula.com artik Google Cloud'daki
echo  "edupusula-sunucu" VM'sinden yayinlaniyor.
echo.
echo  Bu script ARTIK cloudflared tunelini baslatmiyor. Eskiden
echo  burada da "cloudflared tunnel run denemetakip" calistiriliyordu;
echo  bu, VM'deki AYNI tunele ikinci bir baglanti acip Cloudflare'in
echo  trafigi rastgele bu bilgisayar ile VM arasinda paylastirmasina
echo  (ve iki ayri SQLite veritabaninin sessizce birbirinden
echo  kopmasina) yol aciyordu. Bir daha calistirmayin.
echo.
echo  Bu pencere sadece bu bilgisayarda/yerel agda test icin
echo  http://localhost:8080 (veya ayni Wi-Fi'daki telefon icin
echo  http://[bu-bilgisayarin-IP'si]:8080) adresini acar.
echo  Yeni kodu CANLIYA almak icin VM'e deploy etmeniz gerekir.
echo ========================================================
echo.
python server.py
pause
