import { useCallback, useEffect, useState } from 'react';

const initialMetrics = {
  redis: 'checking',
  workers: { active: 0, desired: 2, min: 2, max: 4 },
  tasks: { active: 0, waiting: 0, completed: 0, failed: 0 },
  averageExecutionMs: 0,
};

export default function AdminDashboard({ user, token, onAuth }) {
  const [metrics, setMetrics] = useState(initialMetrics);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);

  const loadMetrics = useCallback(async () => {
    if (!token || user?.role !== 'ADMIN') return;
    try {
      const response = await fetch('/api/admin/metrics', { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load admin metrics');
      setMetrics(data);
      setUpdatedAt(new Date());
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [token, user?.role]);

  useEffect(() => {
    loadMetrics();
    if (!token || user?.role !== 'ADMIN') return undefined;
    const interval = window.setInterval(loadMetrics, 5000);
    return () => window.clearInterval(interval);
  }, [loadMetrics, token, user?.role]);

  if (!token) return <div className="admin-page"><div className="admin-background" aria-hidden="true" /><section className="admin-shell shell"><p className="eyebrow">ADMINISTRATION</p><h1>Admin dashboard</h1><p>Sign in with an administrator account to view system metrics.</p><button className="primary-button" onClick={onAuth}>LOG IN ↗</button></section></div>;
  if (user && user.role !== 'ADMIN') return <div className="admin-page"><div className="admin-background" aria-hidden="true" /><section className="admin-shell shell"><p className="eyebrow">ADMINISTRATION</p><h1>Admin dashboard</h1><p className="admin-error">Administrator access required.</p></section></div>;

  const metricCards = [
    { label: 'REDIS', value: metrics.redis, detail: 'Queue connection', state: metrics.redis === 'connected' ? 'good' : 'pending' },
    { label: 'WORKERS ONLINE', value: `${metrics.workers.active} / ${metrics.workers.max}`, detail: `${metrics.workers.desired} desired · ${metrics.workers.min} minimum`, state: 'neutral' },
    { label: 'ACTIVE TASKS', value: metrics.tasks.active, detail: 'Currently processing', state: 'neutral' },
    { label: 'WAITING TASKS', value: metrics.tasks.waiting, detail: 'Waiting in BullMQ', state: metrics.tasks.waiting > 0 ? 'pending' : 'good' },
  ];

  return <div className="admin-page"><div className="admin-background" aria-hidden="true" /><section className="admin-shell shell">
    <div className="admin-heading"><h1>Admin dashboard</h1><button className="refresh-button" onClick={loadMetrics}>REFRESH METRICS ↻</button></div>
    <div className="admin-metrics">{metricCards.map((card) => <article className={`admin-metric ${card.state}`} key={card.label}><span>{card.label}</span><strong>{card.value}</strong><small>{card.detail}</small></article>)}</div>
    <div className="admin-footer"><span>Average execution · {Math.round(metrics.averageExecutionMs / 1000)} sec</span><span>{updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : 'Loading metrics…'}</span></div>
    {error && <p className="admin-error">{error}</p>}
  </section></div>;
}
