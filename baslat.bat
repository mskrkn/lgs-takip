@echo off
title LGS Deneme Takip Sistemi
chcp 65001 >nul
cls
echo ========================================================
echo   LGS Deneme Takip Sistemi Baslatiliyor...
echo ========================================================
echo.
echo Uzaktan erisim tuneli baslatiliyor (edupusula.com)...
start "Cloudflare Tunnel - KAPATMAYIN" cloudflared tunnel run denemetakip
echo.
python server.py
pause
