import { createElement, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  ArrowRight,
  Bot,
  CalendarDays,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Eye,
  EyeOff,
  FileText,
  Images,
  MessageCircleMore,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';

import brandFallback from '../assets/brand-logo.svg';
import LoginPixelDino from '../components/LoginPixelDino.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useBranding } from '../context/BrandingContext.jsx';

const PUBLIC_REGISTRATION_ENABLED =
  String(import.meta.env.VITE_ALLOW_PUBLIC_REGISTRATION || '').toLowerCase() === 'true';

const SYSTEM_FEATURES = [
  {
    icon: UsersRound,
    title: '團隊派工',
    description: '依工地與班別分派任務，清楚掌握接單、進行中與完工狀態。',
    tone: 'blue',
  },
  {
    icon: Clock3,
    title: '工時管理',
    description: '手機直接開始與結束工作，自動彙整每位夥伴的現場工時。',
    tone: 'green',
  },
  {
    icon: Camera,
    title: '施工照片',
    description: '照片跟著任務保存，完工前後、異常位置與簽名都不再散落。',
    tone: 'amber',
  },
  {
    icon: Images,
    title: '照片牆',
    description: '用時間與工地快速瀏覽現場紀錄，找照片不必再翻群組訊息。',
    tone: 'cyan',
  },
  {
    icon: CalendarDays,
    title: '行事曆排程',
    description: '日曆集中顯示預定工作與到期日，臨時插單也能快速調整。',
    tone: 'violet',
  },
  {
    icon: MessageCircleMore,
    title: 'LINE 通知',
    description: '派工與狀態更新即時通知，現場人員可從熟悉的管道收到提醒。',
    tone: 'lime',
  },
  {
    icon: FileText,
    title: '報價與請款',
    description: '客戶、品項、估價單與請款進度放在同一套流程裡管理。',
    tone: 'rose',
  },
  {
    icon: ClipboardCheck,
    title: '完工回報',
    description: '備註、照片與完工時間一次留下，後續查核與交接更完整。',
    tone: 'slate',
  },
];

const ASSISTANT_PRESETS = [
  {
    question: '今天先做哪些工作？',
    answer: '先處理已到期與今日預定任務，再依地點集中相近工地，減少來回交通時間。',
    actions: ['查看今日行事曆', '確認待接單任務', '檢查逾期項目'],
  },
  {
    question: '完工回報要寫什麼？',
    answer: '建議記錄完成項目、現場異常、使用材料與後續注意事項，並附上至少一張施工照片。',
    actions: ['填寫工作說明', '上傳完工照片', '確認工時已停止'],
  },
  {
    question: '報價單怎麼快速檢查？',
    answer: '依序確認客戶與地址、品項數量、單價合計、稅金、有效日期，以及印章是否避開非零金額。',
    actions: ['核對客戶資料', '檢查合計金額', '預覽 PDF'],
  },
];

const LoginPixelShowcase = () => (
  <section className="login-showcase" aria-hidden="true">
    <div className="login-showcase__panel">
      <div className="login-showcase__label">現場派工工作台</div>
      <div className="login-showcase__screen">
        <div className="login-showcase__grid" />
        <div className="login-showcase__scanline" />
        <div className="login-showcase__shadow" />
        <LoginPixelDino />
      </div>
      <div className="login-showcase__copy">
        <h2>派工、工時、行事曆整合</h2>
        <p>現場回報與後台排程同步，支援 LINE 通知與任務追蹤。</p>
        <ul className="login-showcase__features">
          <li>任務指派與接單狀態同步</li>
          <li>工時開始與結束快速記錄</li>
          <li>月曆與週檢視安排行程</li>
          <li>LINE 卡片通知與快捷操作</li>
        </ul>
      </div>
    </div>
  </section>
);

const LoginPage = () => {
  const navigate = useNavigate();
  const { login, register, loading } = useAuth();
  const { branding, refresh: refreshBranding } = useBranding();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [assistantPreset, setAssistantPreset] = useState(0);

  const brandName = branding.name || '立翔水電工程行';
  const logoSrc = branding.logoUrl || brandFallback;

  useEffect(() => {
    let active = true;
    fetch('/api/public/photos')
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => {
        if (active) {
          setPhotos(Array.isArray(data) ? data.slice(0, 6) : []);
        }
      })
      .catch(() => {
        if (active) setPhotos([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    try {
      if (mode === 'login') {
        await login({ username: form.username, password: form.password });
        refreshBranding().catch(() => {});
        navigate('/app');
        return;
      }

      if (!PUBLIC_REGISTRATION_ENABLED) {
        toast.error('目前不開放自行註冊，請聯絡管理員建立帳號。');
        setMode('login');
        return;
      }

      await register({
        username: form.username,
        password: form.password,
      });
      toast.success('建立帳號成功，請使用新帳號登入');
      setForm({ username: '', password: '' });
      setMode('login');
    } catch (err) {
      const isLogin = mode === 'login';
      const notFoundUser = err.response?.status === 404 && isLogin;
      const message =
        (notFoundUser && '查無此帳號或密碼錯誤') ||
        err.response?.data?.msg ||
        '操作失敗，請稍後再試';

      toast.error(message);
    }
  };

  const switchMode = () => {
    setMode((prev) => (prev === 'login' ? 'register' : 'login'));
  };

  return (
    <main className="login-page">
      <section className="login-hero" aria-labelledby="login-title">
        <div className="login-shell">
          <LoginPixelShowcase />
          <form className="login-card login-card--animated" onSubmit={handleSubmit}>
            <div className="card-header">
              <div className="login-brand">
                <div className="login-brand__logo">
                  <img src={logoSrc} alt={`${brandName} Logo`} />
                </div>
                <div className="login-brand__text">
                  <h1 id="login-title" className="login-brand__name">{brandName}</h1>
                  <p className="login-brand__tag">OPERATIONS SUITE</p>
                </div>
              </div>
              <p className="login-card__subtitle">
                {mode === 'login' ? '請輸入帳號密碼登入系統' : '建立新帳號開始使用系統'}
              </p>
            </div>

            <div className="form-group">
              <label htmlFor="username">帳號</label>
              <input
                id="username"
                type="text"
                name="username"
                value={form.username}
                onChange={handleChange}
                autoComplete="username"
                required
                placeholder="輸入帳號"
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">密碼</label>
              <div className="login-password-field">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                  placeholder="輸入密碼"
                />
                <button
                  type="button"
                  className="login-password-toggle"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? '隱藏密碼' : '顯示密碼'}
                  title={showPassword ? '隱藏密碼' : '顯示密碼'}
                >
                  {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading}>
              {loading ? '登入中...' : mode === 'login' ? '登入' : '建立帳號'}
            </button>

            {PUBLIC_REGISTRATION_ENABLED ? (
            <p className="login-switch">
              {mode === 'login' ? '沒有帳號？' : '已有帳號？'}{' '}
              <button type="button" onClick={switchMode}>
                {mode === 'login' ? '建立新帳號' : '返回登入'}
              </button>
            </p>
            ) : null}
          </form>
        </div>
      </section>

      <section className="login-capabilities" aria-labelledby="capabilities-title">
        <div className="login-section-inner">
          <div className="login-section-heading">
            <p className="login-section-kicker">現場到內勤，同一套流程</p>
            <h2 id="capabilities-title">每天會用到的工作，都集中在這裡</h2>
            <p>任務從派工、施工、回報一路接到報價與請款，現場和辦公室看到的是同一份進度。</p>
          </div>
          <div className="login-feature-grid">
            {SYSTEM_FEATURES.map(({ icon, title, description, tone }) => (
              <article className={`login-feature login-feature--${tone}`} key={title}>
                <span className="login-feature__icon" aria-hidden="true">{createElement(icon)}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="login-photo-band" aria-labelledby="photo-wall-title">
        <div className="login-section-inner login-photo-layout">
          <div className="login-photo-copy">
            <span className="login-feature__icon login-feature__icon--photo" aria-hidden="true"><Images /></span>
            <p className="login-section-kicker">照片牆</p>
            <h2 id="photo-wall-title">施工紀錄不用再散落在聊天室</h2>
            <p>每張照片都能回到對應任務，完工驗收、客戶詢問與日後維修都更容易查找。</p>
            <div className="login-photo-points">
              <span><CheckCircle2 aria-hidden="true" />依任務保存</span>
              <span><CheckCircle2 aria-hidden="true" />支援現場上傳</span>
              <span><CheckCircle2 aria-hidden="true" />快速回看紀錄</span>
            </div>
          </div>
          <div className="login-photo-wall" aria-label="施工照片預覽">
            {(photos.length ? photos.slice(0, 4) : Array.from({ length: 4 })).map((photo, index) => (
              <figure className={`login-photo login-photo--${index + 1}`} key={photo?.url || `empty-${index}`}>
                {photo?.url ? (
                  <img src={photo.url} alt={photo.name || `施工紀錄 ${index + 1}`} loading="lazy" />
                ) : (
                  <div className="login-photo__empty"><Camera aria-hidden="true" /><span>施工紀錄</span></div>
                )}
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="login-assistant-band" aria-labelledby="assistant-title">
        <div className="login-section-inner login-assistant-layout">
          <div className="login-assistant-copy">
            <span className="login-feature__icon login-feature__icon--assistant" aria-hidden="true"><Bot /></span>
            <p className="login-section-kicker">現場小幫手</p>
            <h2 id="assistant-title">常見問題，先給你一個能直接執行的答案</h2>
            <div className="login-assistant-prompts" aria-label="快速問題">
              {ASSISTANT_PRESETS.map((preset, index) => (
                <button
                  type="button"
                  className={assistantPreset === index ? 'is-active' : ''}
                  onClick={() => setAssistantPreset(index)}
                  aria-pressed={assistantPreset === index}
                  key={preset.question}
                >
                  {preset.question}<ArrowRight aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
          <div className="login-assistant-panel" aria-live="polite">
            <div className="login-assistant-panel__head">
              <span><Bot aria-hidden="true" />工作建議</span>
              <small>快速範本</small>
            </div>
            <p className="login-assistant-panel__question">{ASSISTANT_PRESETS[assistantPreset].question}</p>
            <p className="login-assistant-panel__answer">{ASSISTANT_PRESETS[assistantPreset].answer}</p>
            <ol>
              {ASSISTANT_PRESETS[assistantPreset].actions.map((action) => (
                <li key={action}><CheckCircle2 aria-hidden="true" />{action}</li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <footer className="login-footer">
        <div className="login-section-inner">
          <span><ShieldCheck aria-hidden="true" />立翔水電內部工作系統</span>
          <a href="/sale">前往公開網站<ArrowRight aria-hidden="true" /></a>
        </div>
      </footer>
    </main>
  );
};

export default LoginPage;
