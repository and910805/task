import { Link } from 'react-router-dom';

import brandFallback from '../assets/brand-logo.svg';
import { useAuth } from '../context/AuthContext.jsx';
import { useBranding } from '../context/BrandingContext.jsx';

const LandingPage = () => {
  const { isAuthenticated } = useAuth();
  const { branding } = useBranding();
  const brandName = branding.name || '立翔水電行';
  const logoSrc = branding.logoUrl || brandFallback;

  return (
    <div className="landing-page">
      <header className="landing-nav">
        <div className="landing-brand">
          <img src={logoSrc} alt={`${brandName} Logo`} />
          <strong>{brandName}</strong>
        </div>
        <div className="landing-nav__actions">
          {isAuthenticated ? (
            <Link to="/app" className="landing-btn landing-btn--ghost">
              進入系統
            </Link>
          ) : null}
          <Link to="/login" className="landing-btn">
            立即登入
          </Link>
        </div>
      </header>

      <main className="landing-hero">
        <p className="landing-kicker">Commercial Service Platform</p>
        <h1>工程調度、回報、工時與簽核，一站整合。</h1>
        <p className="landing-lead">
          專為現場工程與內勤協作打造，從任務派工到照片、語音、簽名與報表，流程清楚、追蹤即時。
        </p>
        <div className="landing-hero__actions">
          <Link to={isAuthenticated ? '/app' : '/login'} className="landing-btn">
            {isAuthenticated ? '前往工作台' : '開始使用'}
          </Link>
          <a href="#features" className="landing-btn landing-btn--ghost">
            看功能介紹
          </a>
        </div>
      </main>

      <section id="features" className="landing-features">
        <article>
          <h2>任務派工透明</h2>
          <p>支援多人指派、狀態流轉與地點資訊，主管與現場同時掌握進度。</p>
        </article>
        <article>
          <h2>現場證據完整</h2>
          <p>照片、語音、簽名與工時紀錄集中於任務明細，查核與交接更快速。</p>
        </article>
        <article>
          <h2>通知與報表自動化</h2>
          <p>任務更新可走 Email 或 LINE，並可匯出 Excel，便於管理層彙整。</p>
        </article>
      </section>
    </div>
  );
};

export default LandingPage;
