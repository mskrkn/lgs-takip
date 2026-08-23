# 📱 LGS Deneme Takip Sistemi - Mobil, Çoklu PC ve Canlıya Alma Rehberi

Bu sistem artık **PWA (Progressive Web App)**, **Mobil Uyumlu Arayüz**, **Yerel Ağda Paylaşım** ve **Bulut Senkronizasyonu** ile donatılmıştır.

---

## 🚀 1. YÖNTEM: Aynı Wi-Fi Ağında (Evde / Okulda) Anında Çalıştırma

Bilgisayarınız açıkken aynı internete (Wi-Fi) bağlı telefon veya diğer bilgisayarlardan girmek için:

1. Klasördeki **`baslat.bat`** dosyasına çift tıklayın.
2. Açılan siyah pencerede size özel bir bağlantı linki görünecektir (Örn: `http://192.168.1.35:8080`).
3. **Cep telefonunuzun tarayıcısını (Chrome / Safari)** açıp bu adresi yazın.
4. Telefonunuzda **"Ana Ekrana Ekle"** veya **"Uygulamayı Yükle"** butonuna basarak doğrudan mobil uygulama gibi kullanmaya başlayın!

---

## 🌐 2. YÖNTEM: İnternete Ücretsiz Yükleme (Her Yerden ve Her Cihazdan Erişim)

Uygulamanızı **GitHub Pages** veya **Vercel** ile 1 dakikada tamamen ücretsiz olarak internete açabilirsiniz.

### Seçenek A: GitHub Pages İle (Önerilen)
1. [GitHub](https://github.com)'a giriş yapın ve yeni bir repository (depo) oluşturun (Örn: `lgs-takip`).
2. Bu klasördeki tüm dosyaları GitHub deposuna yükleyin.
3. Depo ayarlarından **Settings > Pages** sekmesine gidin.
4. **Source:** `Deploy from a branch` -> **Branch:** `main` seçip **Save** butonuna tıklayın.
5. 1 dakika içinde size özel linkiniz hazır olur: `https://kullaniciadiniz.github.io/lgs-takip/`

### Seçenek B: Vercel / Netlify İle (Sürükle-Bırak)
1. [vercel.com](https://vercel.com) veya [netlify.com](https://netlify.com) adresine ücretsiz üye olun.
2. Bu proje klasörünü siteye sürükleyip bırakın.
3. Anında size özel `https://lgs-takip-xxx.vercel.app` şeklinde kalıcı bir adres verilir.

---

## ☁️ 3. YÖNTEM: Cihazlar Arası Otomatik Veri Eşitleme (Bulut Senkronizasyonu)

Farklı bilgisayarlarda veya telefonunuzda yaptığınız değişikliklerin otomatik olarak birbirine eşitlenmesi için:

1. Uygulamanın sol menüsünden **Ayarlar & Bulut** sayfasına gidin.
2. **Ortak Senkronizasyon Anahtarınızı** belirleyin (Örn: `okulum-lgs-2026`).
3. **Google Firebase (Ücretsiz)** üzerinden aldığınız yapılandırmayı kaydedin.
4. Artık bilgisayarda eklediğiniz bir deneme veya öğrenci, telefonunuzda da anında güncellenecektir!

---

## 📲 Cep Telefonunda Uygulama Olarak Kurulum:
* **iOS (iPhone):** Safari'de sayfayı açın -> Alttaki **Paylaş** simgesine dokunun -> **"Ana Ekrana Ekle"** seçeneğini seçin.
* **Android:** Chrome'da sayfayı açın -> Sağ üstteki 3 noktaya veya ekrandaki **"Uygulamayı Yükle"** butonuna dokunun -> **"Yükle"** deyin.
