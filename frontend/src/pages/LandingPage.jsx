import { useEffect, useMemo, useState } from 'react';

const SERVICE_TITLES = [
  '水電工程維修',
  '申請水電',
  '家庭水電維修',
  '水電工程估價',
  '緊急搶修',
  '老舊電線更新',
];

const LandingPage = () => {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetch('/api/public/photos')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!mounted) {
          return;
        }
        setPhotos(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (mounted) {
          setPhotos([]);
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const serviceCards = useMemo(
    () => SERVICE_TITLES.map((title, index) => ({ title, image: photos[index % Math.max(photos.length, 1)]?.url || '' })),
    [photos],
  );

  const heroImage = photos[0]?.url || '';

  return (
    <main className="landing-v2">
      <div className="landing-v2__bg-shape landing-v2__bg-shape--a" />
      <div className="landing-v2__bg-shape landing-v2__bg-shape--b" />

      <header className="landing-v2__nav">
        <div className="landing-v2__brand">
          <strong>立翔水電行</strong>
          <span>專業・誠信・責任・熱忱</span>
        </div>
        <div className="landing-v2__actions">
          <a href="/login" className="landing-btn">
            後台登入
          </a>
          <a href="/sale" className="landing-btn landing-btn--ghost">
            舊版頁面
          </a>
        </div>
      </header>

      <section className="landing-v2__hero">
        <div className="landing-v2__hero-copy">
          <p className="landing-v2__kicker">LIXIANG PLUMBING & ELECTRIC</p>
          <h1>水電工程維修與估價服務</h1>
          <p>
            住宅、店面、辦公室水電維修皆可處理，提供透明估價與快速到場服務。
          </p>
          <div className="landing-v2__tagline">
            <span>專業</span>
            <span>誠信</span>
            <span>責任</span>
            <span>熱忱</span>
          </div>
        </div>
        <div className="landing-v2__hero-media">
          {heroImage ? <img src={heroImage} alt="立翔水電服務主視覺" /> : <div className="landing-v2__hero-empty">圖片載入中</div>}
        </div>
      </section>

      <section className="landing-v2__service-grid" aria-label="服務項目">
        {serviceCards.map((card) => (
          <article key={card.title} className="landing-v2__service-card">
            {card.image ? <img src={card.image} alt={card.title} loading="lazy" /> : <div className="landing-v2__service-empty" />}
            <h2>{card.title}</h2>
          </article>
        ))}
      </section>

      <section className="landing-v2__gallery" aria-label="施工與服務圖片">
        <div className="landing-v2__section-title">
          <h3>服務圖庫</h3>
          <span>{loading ? '讀取中...' : `共 ${photos.length} 張`}</span>
        </div>
        <div className="landing-v2__gallery-grid">
          {photos.map((photo) => (
            <figure key={photo.url} className="landing-v2__gallery-item">
              <img src={photo.url} alt={photo.name || '立翔水電服務圖片'} loading="lazy" />
            </figure>
          ))}
        </div>
      </section>
    </main>
  );
};

export default LandingPage;
