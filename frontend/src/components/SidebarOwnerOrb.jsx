const SidebarOwnerOrb = ({ logoSrc, text = 'eric' }) => {
  const letters = String(text || 'eric').split('');

  return (
    <div className="sidebar-owner-orb" aria-hidden="true">
      <div className="sidebar-owner-orb__ring" />
      <div className="sidebar-owner-orb__inner">
        <div className="sidebar-owner-orb__logo">
          <img src={logoSrc} alt="" />
        </div>
        <div className="sidebar-owner-orb__word">
          {letters.map((letter, index) => (
            <span
              key={`${letter}-${index}`}
              className="sidebar-owner-orb__letter"
              style={{ '--orb-letter-delay': `${index * 0.12}s` }}
            >
              {letter}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SidebarOwnerOrb;
