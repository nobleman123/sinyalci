# NEXUS v7 — Full-Stack Crypto Signal Platform

NEXUS, kripto piyasasını 7/24 arka planda tarayan, yüksek kaliteli setup'ları yakalayıp mobil cihazınıza **Web Push** ile anlık bildirim gönderen gelişmiş bir sinyal platformudur.

## Mimari & Teknoloji Yığını
- **Frontend**: HTML5, Vanilla JS, CSS3, Service Worker (PWA)
- **Backend**: Node.js, Fastify, TypeScript
- **Veritabanı**: PostgreSQL (Prisma ORM)
- **Cache & Queue**: Redis, BullMQ (İsteğe bağlı gelişmiş kuyruk), Node-Cron
- **Veri Kaynağı**: Binance Futures REST API (OHLCV & Tickers)

## Kurulum & Çalıştırma (Lokal)

Lokal ortamda çalıştırmak için Docker kullanmanız önerilir.

1. Bağımlılıkları kurun:
   ```bash
   cd backend
   npm install
   ```

2. `.env` dosyasını oluşturun:
   ```bash
   cp .env.example .env
   ```

3. Docker Compose ile PostgreSQL ve Redis'i başlatın:
   ```bash
   docker-compose up -d postgres redis
   ```

4. Prisma şemasını veritabanına uygulayın:
   ```bash
   cd backend
   npx prisma db push
   ```

5. Backend sunucusunu başlatın:
   ```bash
   npm run dev
   ```

6. Frontend'i test etmek için `frontend` klasöründe basit bir HTTP sunucusu başlatın:
   ```bash
   npx serve frontend -p 3000
   ```

## Web Push (VAPID) Kurulumu

Push bildirimlerinin çalışması için VAPID anahtarlarına ihtiyacınız var:
1. Backend dizininde şu komutu çalıştırın:
   ```bash
   npm run vapid:generate
   ```
2. Çıkan `PUBLIC_KEY` ve `PRIVATE_KEY` değerlerini `.env` dosyanıza ekleyin.
3. Frontend ve backend'i yeniden başlatın.

## Deployment Önerisi (Ücretsiz / Düşük Maliyet)
- **Backend & Workers**: Railway, Render veya Fly.io (Docker destekli herhangi bir platform)
- **Veritabanı**: Supabase (500MB ücretsiz PostgreSQL) veya Railway Postgres
- **Redis**: Upstash (Ücretsiz tier 10K istek/gün)
- **Frontend**: Vercel, Netlify veya Cloudflare Pages (Statik hosting)
