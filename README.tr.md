# fastread

**Akademik makaleleri yan yana oku — solda orijinal, sağda çeviri — okurken not al, notların
zamanla birbirine bağlı bir bilgi ağına dönüşsün.**

Çeviri, [LM Studio](https://lmstudio.ai) üzerinden **yerel bir LLM** ile yapılır; okuduğun
makaleler bilgisayarından çıkmaz. Bulut modeli (Gemini) isteğe bağlı yedek olarak
kullanılabilir, varsayılan olarak kapalıdır.

🇬🇧 [English README](README.md)

![Okuyucu — orijinal PDF ve Türkçe çevirisi yan yana](docs/screenshots/02-reader.png)

---

## Neden

Yabancı dilde makale okumak sekmeler arasında gidip gelmek demek; alınan notlar da bir süre
sonra hangi makaleden geldiği belli olmayacak şekilde dosyalara dağılıyor. fastread üçünü tek
yerde tutuyor: kaynak sayfa, çeviri ve not — her not, geldiği makaleye ve sayfaya kalıcı
olarak bağlı.

## Özellikler

**Yan yana okuma.** Orijinal PDF sayfası solda, çevirisi sağda. Çeviri sayfa bazlı yapılır,
geldikçe akar ve yerel veritabanına kaydedilir — aynı sayfayı tekrar açtığında model yeniden
çalışmaz.

**Sayfa düzenini koruyan çeviri.** Sağdaki sayfa düz bir metin yığını değil. fastread, PDF'in
kendi çizim komutlarından sayfanın yapısını yeniden kurar ve her parçayı hak ettiği gibi
işler:

| Öğe                      | Nasıl işleniyor                                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Başlıklar ve paragraflar | Ayrı bloklar olarak algılanır ve sütunlar arasında doğru okuma sırasıyla çevrilir                                                      |
| Tablolar                 | Sayfadan görüntü olarak kırpılır — yalnızca başlığı çevrilir, böylece hücre değerleri ve sayılar modelce bozulamaz                     |
| Şekiller                 | Tablolarla aynı: görsel korunur, başlık çevrilir                                                                                       |
| Vektör grafikler         | Çubuklar ve döndürülmüş eksen etiketleri tek bir şekil olarak tanınır ve bütün hâlinde kırpılır; onlarca çevrilebilir parçaya bölünmez |
| Dipnotlar                | Dipnot biçiminde gösterilir; yalnızca URL içeren bir dipnot çevrilmeye çalışılmadan olduğu gibi bırakılır                              |

**Notlar ve alıntılar.** Çeviride bir söz öbeği seçtiğinde otomatik olarak alıntı (highlight)
kaydedilir ve kenarda bir işaret belirir — Word'deki yorum mantığına yakın. Üstüne yorum
yazabilir ya da sayfaya serbest not ekleyebilirsin.

**Obsidian tarzı bağlantı.** Bir notun içine `[[Başka bir not başlığı]]` yazdığında fastread
iki notu birbirine bağlar. Bu bağlantılar ve her notun ait olduğu makale, bilgi ağını
oluşturur.

**APA künyesi.** İçe aktarırken ilk sayfa modele gönderilir ve başlık, yazarlar, yıl, dergi
ve DOI taslağı çıkarılır. Sen onaylar veya düzeltirsin, APA 7 künyesi üretilir.

## Ekran görüntüleri

| Kütüphane                                     | Bilgi ağı                                   |
| --------------------------------------------- | ------------------------------------------- |
| ![Kütüphane](docs/screenshots/01-library.png) | ![Bilgi ağı](docs/screenshots/05-graph.png) |

| Şekiller ve grafikler bozulmadan                                                              | Kenar notları                                                   |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| ![Grafik, çevrilmiş başlığıyla görsel olarak kırpıldı](docs/screenshots/03-reader-figure.png) | ![Wiki bağlantılı kenar notları](docs/screenshots/04-notes.png) |

## Kurulum

[Node.js](https://nodejs.org) 20 veya üstü gerekir.

```bash
git clone https://github.com/<kullanici-adin>/fastread.git
cd fastread
npm install
npm run dev
```

Windows'ta komut satırına hiç girmene gerek yok — çift tıklanabilir üç dosya var:
`kur.bat` (kurulum), `baslat.bat` (çalıştır), `exe-olustur.bat` (kurulum dosyası üret).

### Bağımsız uygulama derleme

```bash
npm run build:win     # Windows kurulum dosyası (NSIS) -> dist/
npm run build:mac     # macOS .dmg                     -> dist/
npm run build:linux   # Linux AppImage                 -> dist/
```

Her hedef kendi işletim sisteminde derlenmelidir. Native derleme yoktur — veritabanı
[sql.js](https://sql.js.org) (WebAssembly'ye derlenmiş SQLite) olduğu için `npm install`
herhangi bir C++ derleyicisi istemez.

## Çeviri kurulumu

### LM Studio (önerilen, yerel)

1. [LM Studio](https://lmstudio.ai)'yu kur ve bir model indir. Talimat izleyen her model
   çalışır; büyük modeller akademik çeviride belirgin biçimde daha iyi sonuç verir.
2. **Local Server** (veya **Developer**) sekmesini aç ve sunucuyu başlat.
3. fastread'in **Ayarlar** sayfasında adresi doğrula — genelde `http://localhost:1234/v1` —
   ve **Bağlantıyı test et** ile kontrol et.

### Gemini (opsiyonel, bulut yedeği)

[AI Studio](https://aistudio.google.com/)'dan aldığın API anahtarını Ayarlar'a yapıştır ve
motor sırasını belirle. Yedek açıkken, yerel motor çalışmadığında sayfa metni Google'ın
sunucularına gönderilir — Ayarlar sayfası bunu ilgili alanın yanında açıkça belirtir.

## Veriler nerede tutuluyor

Her şey kendi bilgisayarında kalır:

- `%APPDATA%/fastread/fastread.sqlite` — makaleler, notlar, bağlantılar, önbelleğe alınmış
  çeviriler (Linux'ta `~/.config/fastread/`, macOS'ta
  `~/Library/Application Support/fastread/`)
- `%APPDATA%/fastread/settings.json` — motor ayarları ve varsa API anahtarın

PDF'ler kütüphaneye **kopyalanmaz**, yalnızca dosya yolu saklanır. PDF'i taşır veya silersen
bağlantı kopar; notlar ve künye bilgisi veritabanında kalır.

## Proje yapısı

```
src/
  main/       Electron ana süreç — SQLite (sql.js), LLM çağrıları, IPC
  preload/    contextBridge ile renderer'a açılan yüzey (window.api)
  renderer/   React arayüzü — Kütüphane / Okuyucu / Bilgi Ağı / Ayarlar
    lib/pdfLayout.ts   sayfa yapısının yeniden kurulması (okuyucunun kalbi)
  shared/     iki sürecin ortak kullandığı tipler + APA biçimlendirici
docs/         tasarım notları ve ekran görüntüleri
```

## Geliştirme

```bash
npm run dev        # geliştirme modu
npm run typecheck  # TypeScript, iki tsconfig için
npm run lint       # ESLint
npm run format     # Prettier
npm run build      # tip kontrolü + out/ içine prodüksiyon derlemesi
```

## Bilinen sınırlamalar

- Künye çıkarma tamamen modele bağlı. Model geçerli JSON döndürmezse form boş gelir ve elle
  doldurman gerekir.
- Çeviri sayfa bazlı; sayfa sonunu aşan bir cümle iki parça hâlinde çevrilir.
- Sayfa düzeni çıkarımı sezgiseldir. Çizgili tabloları ve başlıklı şekilleri olan iki sütunlu
  makalelere göre ayarlandı; sıra dışı düzenlerde düz paragrafa düşebilir.
- Bilgi ağı düğüm konumları her açılışta yeniden hesaplanır, kayıtlı bir düzen yoktur.
- Arayüz yalnızca Türkçe; ancak _çevirinin_ hedef dili Ayarlar'dan seçilebilir.

## Lisans

[MIT](LICENSE)

## Güvenlik

Okuyucu her PDF'i güvenilmeyen bir belge olarak ele alır — çünkü öyledir. PDF'ten çıkarılan
metin ve onun çevirisi, DOM'a ulaşmadan önce DOMPurify ile temizlenir; pencerenin uygulamanın
kendi arayüzü dışına gitmesine izin verilmez; renderer, bağlam yalıtımıyla ve kum havuzunda
(sandbox) çalışır; preload genel bir IPC kanalı yerine yalnızca dar ve amaca özel bir API açar.
`file:read` sadece kütüphaneye kayıtlı bir PDF'i açabilir.

Gemini API anahtarın (kullanıyorsan) `settings.json` içinde yalnızca sana okuma izni verecek
şekilde saklanır ve yalnızca Google'ın uç noktasına, istek başlığında gönderilir.

Bir güvenlik açığı bulursan lütfen bir issue aç (herkese açık paylaşmak istemediğin bir konu
için depo sahibinin profilindeki e-posta adresini kullanabilirsin).
