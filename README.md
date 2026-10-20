# VCrypto

VCrypto, mobil ekrana göre tasarlanmış ve desteklenen tarayıcılarda ana ekrana yüklenebilen kripto piyasası web uygulamasıdır.

## Özellikler
- CoinGecko Public API üzerinden canlı global piyasa özeti ve ilk 250 coin
- Coin adı/sembolü arama, sıralama ve 24 saatlik yükselen/düşen listeleri
- Cihazda saklanan favoriler
- Coin detay paneli: fiyat, piyasa değeri, hacim, ATH ve sıralama
- Telefonlarda sabit alt navigasyon, güvenli alan desteği ve duyarlı masaüstü görünümü
- PWA manifesti ve çevrimdışı uygulama kabuğu önbelleği
- Piyasa verilerini iki dakikada bir otomatik yenileme

## Yayınlama
GitHub Pages kaynağı GitHub Actions olarak ayarlandığında `.github/workflows/pages.yml` otomatik yayınlar.

## Ana ekrana yükleme
Siteyi desteklenen bir tarayıcıda açıp **Ana ekrana ekle / Uygulamayı yükle** seçeneğini kullan. Uygulama içi tarayıcı kurulum seçeneğini göstermeyebilir; bu durumda bağlantıyı Chrome gibi bir tarayıcıda aç.

Piyasa verileri CoinGecko Public API'den alınır ve API limitlerine bağlı olabilir. VCrypto yatırım tavsiyesi değildir.