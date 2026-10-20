const ASSET = '/img/';

export default function Header({ user, onAuth, onLogout }) {
  const displayName = user?.name?.trim() || user?.email?.split('@')[0];

  return <header className="header shell">
    <a className="brand" href="#home" aria-label="MEDIA home">
      <img src={`${ASSET}moonico.jpg`} alt="" />
      {user && <span className="welcome-user">Welcome back, <b>{displayName}</b></span>}
    </a>
    <nav className="main-nav"><a href="#home">Home</a><a href="#workspace">Task</a><a href="#history">History</a></nav>
    {user ? <button className="header-action" onClick={onLogout}>Log out ↗</button> : <button className="header-action" onClick={() => onAuth('login')}>Log in / Sign up ↗</button>}
  </header>;
}
