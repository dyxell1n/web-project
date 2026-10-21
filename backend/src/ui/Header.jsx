const ASSET = '/img/';

export default function Header({ user, onAuth, onLogout }) {
  const displayName = user?.name?.trim() || user?.email?.split('@')[0];
  const homePrefix = window.location.pathname.startsWith('/admin') ? '/' : '';

  return <header className="header shell">
    <a className="brand" href={`${homePrefix}#home`} aria-label="MEDIA home">
      <img src={`${ASSET}moonico.jpg`} alt="" />
      {user && <span className="welcome-user">Welcome back, <b>{displayName}</b></span>}
    </a>
    <nav className="main-nav"><a href={`${homePrefix}#home`}>Home</a><a href={`${homePrefix}#workspace`}>Task</a><a href={`${homePrefix}#history`}>History</a>{user?.role === 'ADMIN' && <a href="/admin">Admin</a>}</nav>
    {user ? <button className="header-action" onClick={onLogout}>Log out ↗</button> : <button className="header-action" onClick={() => onAuth('login')}>Log in / Sign up ↗</button>}
  </header>;
}
