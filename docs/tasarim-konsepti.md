# fastread — Tasarım Konsepti

## Bir cümlede

fastread, akademik bir PDF'i solda orijinal / sağda Türkçe çeviri olarak yan yana okuduğun, okurken not ve alıntı aldığın, bu notların makale künyesiyle birlikte kişisel bir veritabanında tutulduğu ve zamanla Obsidian tarzı bir **bilgi ağına** dönüştüğü, yerel LLM destekli bir "derin okuma" masaüstü uygulaması.

## Problem

Yabancı dilde akademik makale okumak yavaş: çeviri için sekmeler arasında geçiş yapılıyor, alınan notlar Word dosyalarında/defterlerde dağılıyor, hangi notun hangi makaleden geldiği ve başka hangi notla ilişkili olduğu zamanla kayboluyor. Okuma bittiğinde elde "bilgi" değil, dağınık dosyalar kalıyor.

## Kullanıcı

Çok sayıda İngilizce akademik makale okuyan araştırmacı/akademisyen/öğrenci — okuduklarını sadece anlamak değil, zamanla birbirine bağlı bir kişisel bilgi tabanına dönüştürmek isteyen biri. Teknik olarak rahat, kendi bilgisayarında yerel bir LLM (LM Studio) çalıştırabilecek kadar meraklı.

## Temel değer önerisi

- **Hız** — sayfa sayfa, anında çeviri; sekmeler arası geçiş yok.
- **Anlama** — çeviriye ek olarak "bu sayfayı yorumla" ile kısa bir yapay zeka özeti/yorumu.
- **Hafıza** — her not, hangi makaleden ve hangi sayfadan geldiğini (APA künyesiyle birlikte) hep bilir.
- **Bağlantı** — notlar `[[çift köşeli parantez]]` ile birbirine bağlanır, zamanla bir düşünce/bilgi ağı oluşur (Obsidian mantığı).
- **Gizlilik / kontrol** — çeviri ve yorumlama öncelikle kullanıcının kendi bilgisayarındaki LM Studio modelleriyle çalışır; bulut (Gemini) sadece yedek/opsiyonel.

## Bilgi mimarisi — 4 ana ekran

1. **Kütüphane** — eklenmiş tüm makalelerin listesi/kartları (başlık, yazar, yıl, APA önizleme). "+ PDF Ekle" ile yeni makale eklenir; PDF'in ilk sayfasından künye bilgisi otomatik çıkarılıp kullanıcıya onaylatılır.
2. **Okuyucu** — asıl deneyim. Ekranı boydan boya kaplayan iki "kağıt sayfa": solda orijinal PDF (yakınlaştırılabilir), sağda Türkçe çeviri. Sağ kenarda ince bir "yorum şeridi" — Word'deki yorum ekleme mantığına yakın: metinde bir söz öbeği seçildiğinde otomatik vurgulanır ve kenarda küçük bir ikon belirir; ikona tıklayınca küçük bir kart açılıp not/yorum yazılabilir, `[[bağlantı]]` kurulabilir.
3. **Bilgi Ağı** — tüm makaleler ve notların bir düğüm-bağlantı (force-directed graph) görünümü. Makaleler ve notlar farklı renk/boyutta düğümler; `[[bağlantı]]`lar ve "not → ait olduğu makale" ilişkileri kenar (edge) olarak çizilir. Bir düğüme tıklayınca ilgili sayfaya/nota gidilir.
4. **Ayarlar** — çeviri/yorumlama motoru: LM Studio adresi + model adı, Gemini API anahtarı, hangi motorun öncelikli olacağı, hedef dil. "Bağlantıyı test et" ile hızlı doğrulama.

## Anahtar etkileşimler (tasarımda özellikle düşünülmesi gerekenler)

- **Künye onay ekranı** — PDF eklenince açılan, yapay zekanın doldurduğu ama kullanıcının düzeltebildiği bir form + canlı APA önizlemesi.
- **Sayfa çevirisi** — "Sayfayı Çevir" tek tıkla çalışır; çeviri düzenlenebilir (ham metin moduna geçiş), motor adı (lmstudio/gemini) küçük bir rozetle gösterilir.
- **Seç → vurgula → yorum ekle** akışı — bu uygulamanın imza etkileşimi. Seçim yapıldığı anda görsel geri bildirim (vurgu rengi) + kenarda beliren yorum ikonu arasındaki bağ çok net olmalı.
- **Bilgi ağı gezintisi** — büyüdükçe dağınıklaşabilecek bir graf; filtreleme/arama, düğüm kümelenmesi, "bu makaleye ait notları vurgula" gibi ihtiyaçlar öngörülebilir.
- **Motor durumu** — LM Studio'ya bağlı mı değil mi, hangi motor kullanılıyor; kullanıcı bunu her an bilmeli (küçük bir durum rozeti/ışığı iyi bir fırsat).
- **Boş durumlar** — hiç makale yok, sayfa çevrilmemiş, hiç not yok, bilgi ağı boş: bunların her biri kullanıcıyı bir sonraki adıma nazikçe yönlendirmeli.

## Görsel yön / ruh hali

- **"Dijital okuma odası"** hissi: koyu, sakin bir zemin üzerinde, kağıt tonunda (krem/beyaz) parlayan iki "gerçek sayfa" — kitaplık/kütüphane referansı, ekran değil kağıt okuyormuş hissi.
- Akademik ve ciddi ama soğuk değil; steril bir "yazılım" havasından çok, düşünme ve okuma için tasarlanmış sakin bir alan.
- Vurgu renkleri iş görür: notlar/bağlantılar için bir ton (mevcut çalışmada indigo/mavi), vurgu/alıntılar için ayrı bir ton (amber/altın) — bilgi ağındaki düğüm renkleriyle de tutarlı olmalı.
- Tipografi: sayfa içerikleri için okunaklı bir serif (kitap hissi), arayüz (butonlar, menüler) için nötr bir sans-serif.
- "fastread" adındaki hız/derinlik gerilimi görsel olarak da düşünülebilir: hızlı/anlık geri bildirimler (çeviri, vurgu) sakin/derin bir sayfa deneyiminin içinde gerçekleşiyor.

## Farklılaştırıcı çerçeve

fastread'i şöyle konumlandırmak faydalı olabilir: **Kindle'ın okuma rahatlığı + Google Translate'in anlık çevirisi + Obsidian'ın bağlantılı not mantığı** — ama tamamen yerel/gizlilik-öncelikli ve özellikle akademik/çok dilli okuma için.

## Şu an teknik olarak var olan (referans için)

Electron masaüstü uygulaması (Windows), React arayüz, yerel SQLite veritabanı, pdf.js ile PDF render, LM Studio (yerel) → Gemini API (yedek) çeviri/yorumlama motoru. Tasarım konsepti bu teknik temelle sınırlı değil — vizyon, mevcut uygulamadan daha ileri gidebilir; önemli olan yukarıdaki 4 ekran ve imza etkileşimin tutarlı bir görsel dile kavuşması.
