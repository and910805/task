import AppHeader from './AppHeader.jsx';
import WorkspaceSwitcher from './WorkspaceSwitcher.jsx';

// Desktop keeps the existing sidebar; phones get a compact bar with the
// company switcher and the bottom tab bar (rendered by the app shell).
const FieldShell = ({ title, subtitle, actions = null, wide = false, children }) => (
  <div className="page tg-field-page">
    <AppHeader title={title} subtitle={subtitle} actions={actions} />
    <div className="tg-mobile-bar">
      <WorkspaceSwitcher />
    </div>
    <main className={`tg-page${wide ? ' tg-page--wide' : ''}`}>{children}</main>
  </div>
);

export default FieldShell;
