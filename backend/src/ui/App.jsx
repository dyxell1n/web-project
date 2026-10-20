import { useCallback, useEffect, useRef, useState } from 'react';
import Header from './Header.jsx';
import Hero from './Hero.jsx';
import AuthDialog from './AuthDialog.jsx';
import Workspace from './Workspace.jsx';
import TaskHistory from './TaskHistory.jsx';
import TaskSelector from './TaskSelector.jsx';

const ASSET = '/img/';

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('jwt_token'));
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState(null);
  const [authMessage, setAuthMessage] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [lbResult, setLbResult] = useState(null);
  const [lbStats, setLbStats] = useState({});
  const lbHits = useRef({});
  const [tasks, setTasks] = useState([]);
  const [tracker, setTracker] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [demoFile, setDemoFile] = useState(null);
  const [demoStatus, setDemoStatus] = useState('');
  const [taskType, setTaskType] = useState('MEDIA_CONVERT');
  const eventSource = useRef(null);
  const ping = useCallback(async () => {
    try {
      const start = Date.now();
      const response = await fetch('/health', { cache: 'no-store' });
      if (!response.ok) throw new Error('Health check failed');
      const data = await response.json();
      const server = response.headers.get('x-served-by') || data.server;
      lbHits.current[server] = (lbHits.current[server] || 0) + 1;
      setLbResult({ server, latency: Date.now() - start });
      setLbStats({ ...lbHits.current });
    } catch {
      setLbResult({ error: true });
    }
  }, []);
  const loadTasks = useCallback(async () => { if (!token) return; try { const response = await fetch('/api/tasks', { headers: { Authorization: `Bearer ${token}` } }); if (response.ok) setTasks((await response.json()).tasks); } catch (error) { console.error('Не вдалося завантажити задачі', error); } }, [token]);
  const logout = useCallback(() => { localStorage.removeItem('jwt_token'); setToken(null); setUser(null); setTasks([]); setTracker(null); eventSource.current?.close(); }, []);
  useEffect(() => { ping(); }, [ping]);
  useEffect(() => { if (!token) { setUser(null); return; } let cancelled = false; fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => { if (!response.ok) throw new Error('Session expired'); const data = await response.json(); if (!cancelled) { setUser(data.user); loadTasks(); } }).catch(() => { if (!cancelled) logout(); }); return () => { cancelled = true; }; }, [token, loadTasks, logout]);
  useEffect(() => () => eventSource.current?.close(), []);
  const authSubmit = async (mode, fields) => { setAuthBusy(true); setAuthMessage(mode === 'login' ? 'Logging in…' : 'Creating account…'); try { const response = await fetch(`/api/auth/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: fields.email, password: fields.password, ...(mode === 'register' ? { name: fields.name } : {}) }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'The request could not be completed.'); localStorage.setItem('jwt_token', data.token); setToken(data.token); setUser(data.user); setAuthMode(null); setAuthMessage(''); } catch (error) { setAuthMessage(error.message); } finally { setAuthBusy(false); } };
  const monitor = useCallback((taskId) => { eventSource.current?.close(); setTracker({ taskId, status: 'CONNECTING…', progress: 0, stage: 'Connecting to the event stream' }); const stream = new EventSource(`/api/tasks/${taskId}/events?token=${encodeURIComponent(token)}`); eventSource.current = stream; stream.onmessage = (event) => { try { const data = JSON.parse(event.data); setTracker(data); if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(data.status)) { stream.close(); loadTasks(); } } catch { /* Ignore malformed stream updates. */ } }; stream.onerror = () => loadTasks(); }, [token, loadTasks]);
  const cancelTask = async (taskId) => { if (!window.confirm('Cancel this task?')) return; try { const response = await fetch(`/api/tasks/${taskId}/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.error); loadTasks(); } catch (error) { window.alert(error.message); } };
  const generateDemo = async () => { if (!token) { setAuthMode('login'); return; } setDemoStatus('Generating sample file…'); try { const response = await fetch('/api/tasks/generate-demo', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sizeMb: 10 }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setDemoFile(data); setDemoStatus(`Ready: ${data.fileName} · ${(data.fileSize / 1024 / 1024).toFixed(1)} MB`); } catch (error) { setDemoStatus(`Error: ${error.message}`); } };
  const createTask = async ({ type, values, file }) => { setBusy(true); setMessage('Sending task to server…'); const form = new FormData(); form.append('type', type); const options = type === 'MEDIA_CONVERT' ? { targetFormat: values.imgFormat, width: values.width || undefined, quality: values.quality || 80 } : type === 'ARCHIVE_COMPRESS' ? { format: values.archiveFormat, compressionLevel: values.compression || 9 } : { complexity: values.complexity || 5 }; form.append('options', JSON.stringify(options)); if (type !== 'SYNTHETIC_BENCHMARK') { if (file) form.append('file', file); else if (demoFile) { form.append('demoFileName', demoFile.fileName); form.append('demoFileSize', demoFile.fileSize); } else { setMessage('Choose a file or generate a sample file.'); setBusy(false); return; } } try { const response = await fetch('/api/tasks', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setMessage(`Task created · ${data.task.id.slice(0, 8)}`); setDemoFile(null); setDemoStatus(''); monitor(data.task.id); loadTasks(); } catch (error) { setMessage(`Error: ${error.message}`); } finally { setBusy(false); } };
  return <><Header user={user} onAuth={(mode) => { setAuthMessage(''); setAuthMode(mode); }} onLogout={logout} /><main><Hero lbResult={lbResult} lbStats={lbStats} ping={ping} /><TaskSelector type={taskType} onSelect={(value) => { setTaskType(value); const selector = document.querySelector('.intro-strip'); if (selector) window.scrollTo({ top: window.scrollY + selector.getBoundingClientRect().top, behavior: 'smooth' }); }} /><Workspace type={taskType} user={user} onAuth={(mode) => { setAuthMessage(''); setAuthMode(mode); }} onCreate={createTask} tracker={tracker} onCancel={() => tracker && cancelTask(tracker.taskId)} token={token} onGenerate={generateDemo} demoStatus={demoStatus} busy={busy} message={message} /><TaskHistory tasks={tasks} onRefresh={loadTasks} onCancel={cancelTask} onMonitor={monitor} user={user} onAuth={() => setAuthMode('login')} /></main><AuthDialog mode={authMode} setMode={(mode) => { setAuthMessage(''); setAuthMode(mode); }} onClose={() => setAuthMode(null)} onSubmit={authSubmit} message={authMessage} busy={authBusy} /></>;
}
