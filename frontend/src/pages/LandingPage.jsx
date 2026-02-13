const LandingPage = () => {
  const salePagePath = '/salesite/sale.html';

  return (
    <div className="sale-shell">
      <iframe className="sale-shell__frame" src={salePagePath} title="Service Sales Page" />

      <div className="sale-shell__fallback">
        <p>If this page does not render, open the sales page directly.</p>
        <a href={salePagePath} target="_blank" rel="noreferrer" className="landing-btn">
          Open Sales Page
        </a>
      </div>
    </div>
  );
};

export default LandingPage;
