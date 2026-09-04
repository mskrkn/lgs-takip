@echo off
REM ============================================================
REM  Staging'e (VM: edupusula-sunucu, port 8081, staging.edupusula.com)
REM  yeni kod gonderir. "develop" dalini takip eder.
REM
REM  On kosul: gondermek istediginiz her sey GitHub'daki "develop"
REM  dalina push edilmis olmali.
REM
REM  Staging kendi ayri veritabanina/gizli anahtarina sahiptir -
REM  production verisiyle hicbir ilgisi yoktur.
REM ============================================================
chcp 65001 >nul
echo ========================================================
echo   STAGING'e (edupusula-sunucu, develop dali) deploy ediliyor...
echo ========================================================
gcloud compute ssh edupusula-sunucu --zone us-central1-a --command "cd /home/mskrk/edupusula-staging && git pull --ff-only && sudo systemctl restart edupusula-staging && echo DEPLOY_OK && git log -1 --format='Staging'da artik: %%h %%s'"
echo.
echo ========================================================
echo   Tamamlandi. https://staging.edupusula.com birkac saniye
echo   icinde yeni kodu servis edecek (sarı "STAGING" banner'i ile).
echo ========================================================
pause
