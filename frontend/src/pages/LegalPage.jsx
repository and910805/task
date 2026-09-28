import { Link, useParams } from 'react-router-dom';

import brandFallback from '../assets/brand-logo.svg';

const OPERATOR_NAME = 'kuanlin';
const CONTACT_EMAIL = 'goole910805@gmail.com';
const UPDATED = '2026-09-29';

const OperatorContact = () => (
  <p>營運者：{OPERATOR_NAME}<br />客服信箱：<a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>
);

const Privacy = () => (
  <>
    <h1 className="tg-page__title">TaskGo 隱私權政策</h1>
    <p className="tg-hint">更新日期：{UPDATED}</p>
    <h2>我們蒐集的資料</h2>
    <ul>
      <li>帳號資料：帳號名稱與密碼（僅保存加密雜湊）。</li>
      <li>公司與成員資料：公司名稱、服務類型、成員角色、邀請紀錄。</li>
      <li>工作資料：任務標題、地點、時間、說明、狀態、工時紀錄與完工說明。</li>
      <li>客戶與交易資料：你輸入的客戶及聯絡人姓名、Email、電話、地址、統一編號，以及報價、合約、請款、收款紀錄與材料進出資料。</li>
      <li>你主動上傳的內容：施工照片、語音與逐字稿、電子簽名。</li>
      <li>通知設定：你選擇提供的 Email 或 LINE 使用者代碼；開啟 iOS 推播時的裝置推播代碼。</li>
      <li>技術紀錄：為防止濫用與排除故障所需的連線 IP 與伺服器紀錄。</li>
    </ul>
    <h2>使用目的</h2>
    <p>用於提供派工、工時、施工回報、客戶管理、報價請款、材料管理、報表與通知功能，以及維護服務安全。我們不販售個人資料，也不使用廣告追蹤或第三方分析工具。</p>
    <h2>誰可以看到你的資料</h2>
    <p>
      公司資料依工作區成員資格與角色限制存取：現場人員可查看指派給自己的工作；主管、辦公室人員與管理員依各自權限存取工作及業務資料。
      加入一家公司不會讓你取得其他公司的存取權。為提供服務，我們使用雲端主機、檔案儲存、Email 寄送、LINE 訊息與 Apple 推播服務，相關資料會由這些服務處理。
    </p>
    <h2>裝置權限</h2>
    <p>相機、相簿與麥克風只在你按下拍照、選擇照片或錄音時使用，用來把內容附加到工作上。你可隨時在 iOS「設定」中關閉。</p>
    <h2>保存與刪除</h2>
    <p>
      你可以在 App 內「我的 → 刪除帳號」刪除帳號。若你是公司擁有者且公司仍有其他成員，需先轉移擁有權；
      若公司只有你一人，公司及其工作資料會一併刪除。你在其他公司留下的工作紀錄會保留給該公司，但不再連結到你的帳號。
      解除帳號關聯不會自動移除照片、簽名或文字內容中原有的個人資訊；如需更正或刪除這些內容，請聯絡所屬公司管理員或客服。
    </p>
    <h2>聯絡我們</h2>
    <OperatorContact />
  </>
);

const Terms = () => (
  <>
    <h1 className="tg-page__title">TaskGo 服務條款</h1>
    <p className="tg-hint">更新日期：{UPDATED}</p>
    <h2>服務內容</h2>
    <p>TaskGo 提供現場服務團隊的派工、工時、施工回報、客戶管理、報價請款與材料管理工具。各公司自行管理其成員與資料。</p>
    <h2>帳號與公司</h2>
    <p>請妥善保管帳號密碼。公司擁有者與管理員負責邀請成員、設定角色，並確保上傳內容合法且取得必要同意。</p>
    <h2>方案與費用</h2>
    <p>目前未提供線上付款。如日後推出付費方案，將事先公告並取得你的同意。</p>
    <h2>禁止行為</h2>
    <p>不得利用本服務上傳違法內容、侵害他人權利，或嘗試存取其他公司的資料。</p>
    <h2>聯絡我們</h2>
    <OperatorContact />
  </>
);

const Support = () => (
  <>
    <h1 className="tg-page__title">TaskGo 客服中心</h1>
    <OperatorContact />
    <p>帳號、工作區權限、資料刪除與問題回報，請聯絡客服信箱。請勿寄送密碼或驗證碼。</p>
    <p><Link to="/legal/privacy">隱私權政策</Link> · <Link to="/legal/terms">服務條款</Link></p>
  </>
);

const LegalPage = () => {
  const { doc } = useParams();
  return (
    <main className="tg-auth">
      <article className="tg-card tg-legal" style={{ maxWidth: 760, width: '100%' }}>
        {doc === 'support' ? <Support /> : doc === 'terms' ? <Terms /> : <Privacy />}
        <p style={{ marginTop: '1.5rem' }}>
          <img src={brandFallback} alt="" width={20} height={20} style={{ verticalAlign: '-4px' }} />{' '}
          <Link to="/login">返回 TaskGo</Link>
        </p>
      </article>
    </main>
  );
};

export default LegalPage;
