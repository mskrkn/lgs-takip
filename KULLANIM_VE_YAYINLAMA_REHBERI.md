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

## 🌿 Branch Yapısı ve Yayın Akışı

```
feature/*  veya  fix/*   (develop'tan açılır)
        ↓ (local test)
    develop                 -> STAGING'e otomatik hedef dal
        ↓ (staging'de test edilir, kontrol listesi tamamlanır)
      main                  -> PRODUCTION'a otomatik hedef dal
```

Acil canlı hata: `main`'den `hotfix/*` aç, düzelt, hem `main`'e hem `develop`'a
yansıt (aksi halde aynı hata develop'tan tekrar gelir).

**Asla** doğrudan `main`'e/production'a test edilmemiş kod göndermeyin — önce
`develop` + staging'den geçsin.

## 🧪 Staging Ortamı

`https://staging.edupusula.com` — **aynı VM'de**, `edupusula.service`'ten tamamen
bağımsız ikinci bir servis (`edupusula-staging.service`, port 8081,
`/home/mskrk/edupusula-staging`, `develop` dalı). Kendi veritabanı ve gizli
anahtarı var — production verisiyle hiçbir ilişkisi yok. Sayfa üstünde sarı
"⚠️ STAGING ORTAMI — gerçek veri değil" şeridi görünür (`EDUPUSULA_ENV=staging`
ortam değişkeni ile, bkz. `server.py` `_inject_env_banner`), böylece production
ile karıştırılmaz.

Yeni kod staging'e göndermek: **`deploy_staging.bat`** (önce `develop`'a push
edilmiş olmalı).

Staging'de test edilecekler (her güncellemede): giriş/çıkış/yetkilendirme,
öğretmen paneli (öğrenci/sınıf listesi, istatistikler), deneme sistemi (ekleme,
net hesaplama, grafikler), Pusi (analiz, rank, eksik veri, veri uydurmama),
Soru Havuzu (listeleme, grid, filtreleme, çoklu seçim).

## 🚀 Production'a Almak (Deploy)

1. Staging'de test tamamlandı ve sorun yoksa `develop`'u `main`'e merge edin.
2. Bu bilgisayarda **`deploy_vm.bat`**'a çift tıklayın. Bu script VM'e SSH ile bağlanıp
   `git pull --ff-only` yapar ve `edupusula.service`'i yeniden başlatır.
3. Birkaç saniye içinde `https://edupusula.com` yeni kodu servis eder.

Elle yapmak isterseniz (gcloud CLI kurulu olmalı):

```
gcloud compute ssh edupusula-sunucu --zone us-central1-a --command "cd /home/mskrk/edupusula && git pull --ff-only && sudo systemctl restart edupusula"
```

Ayni sekilde staging icin:

```
gcloud compute ssh edupusula-sunucu --zone us-central1-a --command "cd /home/mskrk/edupusula-staging && git pull --ff-only && sudo systemctl restart edupusula-staging"
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
sudo systemctl status edupusula          # Flask uygulaması (production, :8080)
sudo systemctl status edupusula-staging  # Flask uygulaması (staging, :8081)
sudo systemctl status cloudflared        # Cloudflare Tunnel bağlayıcısı (ikisini de tasir)
sudo journalctl -u edupusula -f          # production canlı loglar
sudo journalctl -u edupusula-staging -f  # staging canlı loglar
```

Üçü de `enabled` + `Restart=on-failure` ile kurulu; VM yeniden başlarsa otomatik ayağa
kalkarlar.

## 📲 Cep Telefonunda Uygulama Olarak Kurulum (PWA)

* **iOS (iPhone):** Safari'de `edupusula.com`'u açın -> Alttaki **Paylaş** simgesine
  dokunun -> **"Ana Ekrana Ekle"** seçeneğini seçin.
* **Android:** Chrome'da `edupusula.com`'u açın -> Sağ üstteki 3 noktaya veya ekrandaki
  **"Uygulamayı Yükle"** butonuna dokunun -> **"Yükle"** deyin.

Not: Uygulamanın bir Service Worker'ı (`sw.js`) var; sayfayı network'ten çekemediğinde
son başarılı yüklemeyi önbellekten gösterir. Tünel/servis kısa süreliğine kesilirse
kullanıcılar bunu fark etmeyebilir (eski bir görünüm yerine hata sayfası yerine).
