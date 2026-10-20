import { useState } from 'react';

export default function AuthDialog({ mode, setMode, onClose, onSubmit, message, busy }) {
  const [fields, setFields] = useState({ email: '', name: '', password: '' });
  if (!mode) return null;
  const update = (key) => (e) => setFields({ ...fields, [key]: e.target.value });
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
      <p className="eyebrow">PERSONAL ACCESS · MEDIA</p><h2 id="auth-title">{mode === 'login' ? 'Welcome back.' : 'Create your account.'}</h2>
      <p className="muted">Log in to start tasks and save your history.</p>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(mode, fields); }}>
        {mode === 'register' && <label>Name<input value={fields.name} onChange={update('name')} placeholder="Oleksandr" /></label>}
        <label>Email<input type="email" required value={fields.email} onChange={update('email')} placeholder="name@example.com" /></label>
        <label>Password<input type="password" required minLength="6" value={fields.password} onChange={update('password')} placeholder="At least 6 characters" /></label>
        <button className="primary-button full" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in ↗' : 'Create account ↗'}</button>
      </form>
      {message && <p className="form-message">{message}</p>}
      <button className="switch-auth" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); }}> {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}</button>
    </section>
  </div>;
}
