import { useEffect, useMemo, useState } from 'react';

const SERVICES = [
  { title: '水電工程維修', description: '住宅、店面、辦公空間的日常修繕與故障排除。' },
  { title: '申請水電', description: '新案送件、流程協助與現場配置建議。' },
  { title: '家庭水電維修', description: '插座、燈具、漏水、跳電等家庭常見問題快速處理。' },
  { title: '水電工程估價', description: '透明項目明細，施工前先確認價格與工項。' },
  { title: '緊急搶修', description: '突發故障優先派工，縮短停工與停電時間。' },
  { title: '老舊電線更新', description: '老屋線路汰換，提升安全與用電穩定。' },
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

  const serviceCards = useMemo(() => {
    const safeCount = Math.max(photos.length, 1);
    return SERVICES.map((service, index) => ({
      ...service,
      image: photos[index % safeCount]?.url || '',
      rank: String(index + 1).padStart(2, '0'),
    }));
  }, [photos]);

  const heroPrimary = photos[0]?.url || '';
  const heroSecondary = photos[1]?.url || '';
  const galleryPhotos = photos.slice(0, 9);

  return (
    <main className="landing-v3">
      <div className="landing-v3__glow landing-v3__glow--top" />
      <div className="landing-v3__glow landing-v3__glow--bottom" />

      <header className="landing-v3__nav">
        <div className="landing-v3__brand">
          <strong>立翔水電行</strong>
          <span>專業・誠信・責任・熱忱 ｜ 水電維修與估價</span>
        </div>
        <div className="landing-v3__actions">
          <a href="#services" className="landing-btn landing-btn--ghost">
            服務項目
          </a>
          <a href="/login" className="landing-btn">
            後台登入
          </a>
          <a href="/sale" className="landing-btn landing-btn--ghost">
            舊版頁面
          </a>
        </div>
      </header>

      <section className="landing-v3__hero">
        <div className="landing-v3__hero-copy">
          <p className="landing-v3__kicker">LIXIANG PLUMBING & ELECTRIC</p>
          <h1>到府水電維修<br />工程估價一站完成</h1>
          <p>
            針對家庭、店面與小型工程提供清楚報價與施工，維修流程透明、回覆快速，讓現場問題能在最短時間內處理完成。
          </p>
          <div className="landing-v3__tagline">
            <span>專業</span>
            <span>誠信</span>
            <span>責任</span>
            <span>熱忱</span>
          </div>
          <div className="landing-v3__hero-actions">
            <a href="#services" className="landing-btn">立即查看服務</a>
            <a href="#gallery" className="landing-btn landing-btn--ghost">施工圖庫</a>
          </div>
        </div>
        <div className="landing-v3__hero-media">
          <div className="landing-v3__hero-card landing-v3__hero-card--main">
            {heroPrimary ? <img src={heroPrimary} alt="立翔水電服務主視覺" /> : <div className="landing-v3__hero-empty">圖片載入中</div>}
          </div>
          <div className="landing-v3__hero-card landing-v3__hero-card--sub">
            {heroSecondary ? <img src={heroSecondary} alt="立翔水電施工示意" /> : <div className="landing-v3__hero-empty">圖片載入中</div>}
          </div>
          <aside className="landing-v3__trust-card">
            <h2>服務承諾</h2>
            <p>先估價再施工，重點工項事前確認，交付內容清楚可追蹤。</p>
          </aside>
        </div>
      </section>

      <section id="services" className="landing-v3__services" aria-label="服務項目">
        <div className="landing-v3__section-head">
          <p>Services</p>
          <h2>六大常用服務</h2>
        </div>
        {serviceCards.map((card) => (
          <article key={card.title} className="landing-v3__service-card">
            <span className="landing-v3__service-rank">{card.rank}</span>
            {card.image ? <img src={card.image} alt={card.title} loading="lazy" /> : <div className="landing-v3__service-empty" />}
            <h3>{card.title}</h3>
            <p>{card.description}</p>
          </article>
        ))}
      </section>

      <section id="gallery" className="landing-v3__gallery" aria-label="施工與服務圖片">
        <div className="landing-v3__section-head landing-v3__section-head--inline">
          <div>
            <p>Gallery</p>
            <h2>施工與服務圖庫</h2>
          </div>
          <span>{loading ? '讀取中...' : `共 ${photos.length} 張`}</span>
        </div>
        <div className="landing-v3__gallery-grid">
          {galleryPhotos.map((photo, index) => (
            <figure key={photo.url} className={`landing-v3__gallery-item landing-v3__gallery-item--${index % 3}`}>
              <img src={photo.url} alt={photo.name || '立翔水電服務圖片'} loading="lazy" />
            </figure>
          ))}
        </div>
      </section>

      <section className="landing-v3__cta">
        <div>
          <p>需要估價或現場勘查</p>
          <h2>歡迎直接聯絡立翔水電行</h2>
        </div>
        <a href="/login" className="landing-btn">進入系統</a>
      </section>
    </main>
  );
};

export default LandingPage;
