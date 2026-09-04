# 📱 LGS Deneme Takip Sistemi - Kullanım ve Yayınlama Rehberi

## 🌐 Canlı Sistem Mimarisi (Güncel)

`edupusula.com` şu anda **Google Cloud VM**'de (`edupusula-sunucu`, proje: `takipedupusula`,
zone: `us-central1-a`) çalışıyor. Trafik oraya **Cloudflare Tunnel** (`denemetakip` tüneli)
üzerinden yönlendiriliyor. Akış:

```
Kullanıcı -> edupusula.com -> Cloudflare -> Tunnel (denemetakip)
                                             -> VM: cloudflared.service (systemd)
                                             -> VM: localhost:8080
                                             -> VM: edupusula.service (systemd) = python server.py
                                             -> VM: /home/mskrk/edupusula (git checkout, main dalı)
```

VM'de veritabanı (`yetki_veritabani.db`), gizli anahtar (`.flask_secret_key`) ve
`uploads/` klasörü git deposunun **dışında** durur (`.gitignore`) — bir deploy asla
gerçek veriye dokunmaz.

⚠️ **ÖNEMLİ:** Bu bilgisayarda (veya başka bir bilgisayarda) `cloudflared tunnel run
denemetakip` çalıştırmayın. Aynı tünele ikinci bir bağlantı Cloudflare'in trafiği bu PC
ile VM arasında rastgele paylaştırmasına ve iki farklı SQLite veritabanının birbirinden
habersiz ilerlemesine yol açar (bir teşhis ve düzeltme süreciyle bu tam olarak yaşandı,
bkz. proje geçmişi). `baslat.bat` artık tüneli başlatmıyor, sadece yerel test içindir.

## 🚀 Yeni Kodu Canlıya Almak (Deploy)

1. Değişikliği bu depoda `main` dalına push edin (feature dalındaysanız önce merge edin).
2. Bu bilgisayarda **`deploy_vm.bat`**'a çift tıklayın. Bu script VM'e SSH ile bağlanıp
   `git pull --ff-only` yapar ve `edupusula.service`'i yeniden başlatır.
3. Birkaç saniye içinde `https://edupusula.com` yeni kodu servis eder.

Elle yapmak isterseniz (gcloud CLI kurulu olmalı):

```
gcloud compute ssh edupusula-sunucu --zone us-central1-a --command "cd /home/mskrk/edupusula && git pull --ff-only && sudo systemctl restart edupusula"
```

## 🖥️ Yerel/LAN'da Test Etme

Canlıya almadan önce bilgisayarınızda denemek için:

1. **`baslat.bat`**'a çift tıklayın (artık sadece `python server.py` çalıştırır, tünel
   AÇMAZ).
2. Aynı bilgisayardan `http://localhost:8080` adresini açın.
3. Aynı Wi-Fi'daki telefon/bilgisayardan test etmek için bilgisayarınızın yerel IP'sini
   kullanın (Örn: `http://192.168.1.35:8080`) — `ipconfig` ile bulabilirsiniz.

Bu mod tamamen izole — `edupusula.com`'u veya oradaki gerçek veriyi etkilemez.

## ☁️ VM Yönetimi (Sorun Giderme)

VM'ye bağlanmak: `gcloud compute ssh edupusula-sunucu --zone us-central1-a`

Servis durumları:
```
sudo systemctl status edupusula      # Flask uygulaması
sudo systemctl status cloudflared    # Cloudflare Tunnel bağlayıcısı
sudo journalctl -u edupusula -f      # canlı loglar
```

İkisi de `enabled` + `Restart=on-failure` ile kurulu; VM yeniden başlarsa otomatik ayağa
kalkarlar.

## 📲 Cep Telefonunda Uygulama Olarak Kurulum (PWA)

* **iOS (iPhone):** Safari'de `edupusula.com`'u açın -> Alttaki **Paylaş** simgesine
  dokunun -> **"Ana Ekrana Ekle"** seçeneğini seçin.
* **Android:** Chrome'da `edupusula.com`'u açın -> Sağ üstteki 3 noktaya veya ekrandaki
  **"Uygulamayı Yükle"** butonuna dokunun -> **"Yükle"** deyin.

Not: Uygulamanın bir Service Worker'ı (`sw.js`) var; sayfayı network'ten çekemediğinde
son başarılı yüklemeyi önbellekten gösterir. Tünel/servis kısa süreliğine kesilirse
kullanıcılar bunu fark etmeyebilir (eski bir görünüm yerine hata sayfası yerine).
