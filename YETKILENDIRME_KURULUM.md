# Öğretmen / Veli / Öğrenci Yetkilendirme Sistemi — Kurulum Rehberi

Bu güncelleme, uygulamanıza **gerçek, sunucu taraflı** bir giriş ve yetkilendirme
sistemi ekler:

- **Admin (siz):** Eskisi gibi tüm uygulamayı kullanır (import, export, analiz vb.).
  Ayrıca hesap oluşturma, şifre sıfırlama, hesap pasifleştirme ve kendi şifresini
  değiştirme işlemlerini **Kullanıcılar** sayfasından yapar.
- **Öğretmen:** Sadece kendi sınıfının öğrenci bazlı detayını görür; diğer sınıfların
  yalnızca ortalama net bilgisini (öğrenci ismi olmadan) görür.
- **Veli:** Kendisine bağlı çocuğunun/çocuklarının (birden fazla olabilir) verisini +
  tüm sınıfların genel ortalamalarını görür. Birden fazla çocuğu olan veliler giriş
  yaptıktan sonra çocuklar arasında sekmeyle geçiş yapabilir.
- **Öğrenci:** Kendi deneme sonuçlarını, gelişim grafiğini, en güçlü/geliştirilmesi
  gereken dersini ve genel sınıf ortalamalarıyla anonim karşılaştırmasını görür.

Bu filtreleme **sunucuda** yapılır, tarayıcı konsolundan bile aşılamaz. Öğrenci ID'si
gibi bir tanımlayıcı değiştirilerek başka bir öğrencinin verisine erişilmeye
çalışılırsa (URL/istek manipülasyonu), sunucu bunu merkezi bir yetki kontrolüyle
reddeder.

---

## 1. Kurulum (bir kere yapılır)

1. Bilgisayarınızda komut satırını (CMD / PowerShell) açın ve proje klasörüne gidin.
2. Şunu çalıştırın (Flask kütüphanesini kurar):
   ```
   pip install -r requirements.txt
   ```
3. `baslat.bat` dosyasını her zamanki gibi çalıştırın. İlk açılışta konsolda
   şöyle bir mesaj göreceksiniz:
   ```
   İLK KURULUM: varsayılan admin hesabı oluşturuldu
   Kullanıcı adı : admin
   Şifre         : admin123
   ```
4. Tarayıcı açıldığında bu bilgilerle giriş yapın (admin hesabı doğrudan ana
   uygulamaya girer, ayrı bir giriş ekranı görmez — arka planda oturum kontrolü
   yapılır).
5. **Önemli:** Sol menüden **Kullanıcılar** sayfasına gidip kendi admin şifrenizi
   güvenli bir şeyle değiştirmeniz önerilir (şimdilik şifre değişimi API'si
   `/api/me/password` üzerinden mevcuttur; isterseniz ben arayüze de ekleyebilirim).

## 2. Öğretmen / Veli Verisinin Sunucuya Gönderilmesi

Verileriniz hâlâ tarayıcınızda (IndexedDB) tutulur — bu değişmedi. Öğretmen ve
velilerin veri görebilmesi için:

1. Admin olarak giriş yapın.
2. Sol menüden **Kullanıcılar** sayfasına gidin.
3. **"📤 Güncel Veriyi Sunucuya Gönder"** butonuna basın.
4. Yeni öğrenci/deneme eklediğinizde bu adımı tekrarlayın (verileri güncel tutmak için).

## 3. Öğretmen / Veli / Öğrenci Hesabı Oluşturma

**Kullanıcılar** sayfasında:

- **Öğretmen** için: Rol = Öğretmen, sınıf adını girin (örn. `8/A`) — bu, mevcut
  öğrencilerinizin sınıf adlarıyla **birebir aynı** yazılmalı (verileri
  sunucuya gönderdikten sonra sınıf adları öneri listesinde görünür).
- **Veli** için: Rol = Veli, listeden bir veya birden fazla çocuk seçin (checkbox
  listesi) — bir velinin birden fazla çocuğu olabilir.
- **Öğrenci** için: Rol = Öğrenci, açılır listeden kendisine ait öğrenci kaydını
  seçin.

Oluşturduğunuz kullanıcı adı ve şifreyi ilgili kişiye iletin. Giriş sayfası
adresi: `http://<bilgisayarınızın-ağ-adresi>:8080/login.html` (aynı adres
`baslat.bat` çalıştığında konsolda gösterilir).

Bir hesabı geçici olarak devre dışı bırakmak isterseniz (silmeden), aynı
sayfadaki **"Pasifleştir"** butonunu kullanabilirsiniz — pasif bir hesapla giriş
denemesi reddedilir. Kendi admin şifrenizi de aynı sayfanın altındaki **"Kendi
Şifremi Değiştir"** formundan güncelleyebilirsiniz.

## 4. Nelerin Değiştiğine Dair Teknik Özet

- `server.py` artık basit dosya sunucusu değil, Flask tabanlı bir API sunucusu.
- `yetki_veritabani.db` adlı yeni bir SQLite dosyası oluşturulur (kullanıcı
  hesapları + sunucuya gönderilen öğrenci/deneme/sonuç kopyası burada tutulur).
  Bu dosya `.gitignore`'a eklendi, paylaşılmamalı.
- `login.html`, `ogretmen.html`, `veli.html`, `ogrenci.html` — yeni, sade portallar.
- `index.html` artık yalnızca admin oturumu olan tarayıcılara açılır (sunucu
  tarafında kontrol edilir).
- Eski sunucu dosyanız `server_eski_statik_sunucu.py.bak` olarak yedeklendi.
- Var olan bir `yetki_veritabani.db` dosyanız varsa, sunucu ilk açılışta veri
  kaybı olmadan otomatik olarak yeni şemaya (öğrenci rolü, çoklu çocuk, aktif/pasif
  alanı) geçirir.

## 5. Sınırlamalar / Bilinmesi Gerekenler

- Bu kurulum yerel ağ (aynı Wi-Fi) kullanımı için tasarlanmıştır, tıpkı öncekii
  gibi. İnternete açık bir sunucuya taşımayı düşünürseniz (herkese açık URL),
  HTTPS ve ek güvenlik önlemleri gerekir — bu durumda tekrar yazın.
- Konu/kazanım bazlı analiz yalnızca optik okuma ile içe aktarılan sonuçlarda
  (topicMap / answers verisi olan) görüntülenir; Excel/PDF/manuel girişlerde bu
  bölüm boş kalabilir (ana uygulamada da aynı davranış geçerlidir).
