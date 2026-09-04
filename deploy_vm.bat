@echo off
REM ============================================================
REM  Canliya (Google Cloud VM: edupusula-sunucu) yeni kod gonderir.
REM  On kosul: gondermek istediginiz her sey GitHub'daki "main"
REM  dalina push edilmis olmali (bu depoda commit + push yeterli,
REM  git-autopush hook'u zaten push'u otomatik yapiyor).
REM
REM  Veritabani (yetki_veritabani.db), .flask_secret_key ve uploads/
REM  klasoru VM'de git deposunun DISINDA durur (.gitignore) ve bu
REM  islemden ETKILENMEZ.
REM ============================================================
chcp 65001 >nul
echo ========================================================
echo   VM'e (edupusula-sunucu) deploy ediliyor...
echo ========================================================
gcloud compute ssh edupusula-sunucu --zone us-central1-a --command "cd /home/mskrk/edupusula && git pull --ff-only && sudo systemctl restart edupusula && echo DEPLOY_OK && git log -1 --format='Canlida artik: %%h %%s'"
echo.
echo ========================================================
echo   Tamamlandi. https://edupusula.com birkac saniye icinde
echo   yeni kodu servis edecek.
echo ========================================================
pause
