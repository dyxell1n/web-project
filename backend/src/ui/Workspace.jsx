import { useRef, useState } from 'react';
const ASSET = '/img/';
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const taskTypes = [
  { value: 'MEDIA_CONVERT', number: '01', title: 'Image conversion', note: 'WEBP / AVIF / JPEG / PNG' },
  { value: 'ARCHIVE_COMPRESS', number: '02', title: 'Compression & archiving', note: 'ZIP / TAR.GZ' },
  { value: 'SYNTHETIC_BENCHMARK', number: '03', title: 'CPU stress test', note: 'Measure compute performance' },
];

const legacyStages = {
  'Очікує призначення воркера': 'Waiting for worker assignment',
  'В черзі': 'Queued',
  'Успішно виконано': 'Completed successfully',
  'Скасовано користувачем': 'Cancelled by user',
  'Перервано користувачем': 'Interrupted by user',
  'Призначено воркеру, запуск обробки...': 'Assigned to a worker, starting…',
  'Підключення до потоку подій': 'Connecting to the event stream',
  'Помилка виконання': 'Execution failed',
};
const statusLabels = { PENDING: 'Queued', PROCESSING: 'In progress', COMPLETED: 'Completed', FAILED: 'Failed', CANCELLED: 'Cancelled', 'CONNECTING…': 'Connecting…' };

function Options({ type, values, setValues, onGenerate, demoStatus, user }) {
  const change = (key) => (e) => setValues((old) => ({ ...old, [key]: e.target.value }));
  if (type === 'ARCHIVE_COMPRESS') return <div className="options-grid">
    <label className="field">ARCHIVE FORMAT <span>ZIP / TAR.GZ</span><select value={values.archiveFormat} onChange={change('archiveFormat')}><option value="zip">ZIP</option><option value="tar.gz">TAR.GZ</option></select></label>
    <label className="field">COMPRESSION LEVEL <span>1 - 9</span><input type="number" min="1" max="9" value={values.compression} onChange={change('compression')} /></label>
    <div className="option-extra"><button className="inline-link" type="button" onClick={onGenerate}>Generate a 10 MB sample file ↗</button>{demoStatus && <small>{demoStatus}</small>}{!user && <small>Log in to generate a sample file</small>}</div>
  </div>;
  if (type === 'SYNTHETIC_BENCHMARK') return <div className="options-grid">
    <label className="field">TEST COMPLEXITY <span>1 - 10</span><input type="number" min="1" max="10" value={values.complexity} onChange={change('complexity')} /></label>
    <div className="complexity-meter"><span>ESTIMATED LOAD</span><div><i style={{ width: `${Number(values.complexity) * 10}%` }} /></div><small>{values.complexity}/10 / {Number(values.complexity) < 4 ? 'LOW' : Number(values.complexity) < 8 ? 'MEDIUM' : 'HIGH'}</small></div>
    <p className="option-note">Matrix calculations without uploading a file.</p>
  </div>;
  return <div className="options-grid">
    <label className="field">OUTPUT FORMAT <span>WEBP / AVIF / JPEG / PNG</span><select value={values.imgFormat} onChange={change('imgFormat')}><option value="webp">WebP · recommended</option><option value="avif">AVIF · next generation</option><option value="jpeg">JPEG</option><option value="png">PNG</option></select></label>
    <label className="field">WIDTH <span>PX / OPTIONAL</span><input type="number" min="1" placeholder="Original size" value={values.width} onChange={change('width')} /></label>
    <label className="field">QUALITY <span>1 - 100%</span><input type="number" min="1" max="100" value={values.quality} onChange={change('quality')} /></label>
  </div>;
}

function Tracker({ tracker, onCancel, token }) {
  if (!tracker) return <div className="tracker-empty"><span>↗</span><div><b>LIVE MONITOR</b><p>Create a task to see its status and progress here.</p></div></div>;
  const done = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(tracker.status);
  const download = `/api/tasks/${tracker.taskId}/download?token=${encodeURIComponent(token)}`;
  return <div className="tracker-live"><div className="tracker-head"><span>TASK · {tracker.taskId?.slice(0, 8)}</span><b className={done ? 'done' : ''}>{statusLabels[tracker.status] || tracker.status}</b></div><p>{legacyStages[tracker.stage] || tracker.stage || 'Waiting for worker assignment'} <span>{tracker.workerId || 'Queued'}</span></p><div className="progress"><i style={{ width: `${tracker.progress || 0}%` }} /></div><div className="tracker-foot"><span>PROGRESS {tracker.progress || 0}%</span>{!done ? <button className="inline-link" onClick={onCancel}>Cancel ×</button> : null}</div>{tracker.status === 'COMPLETED' && <a className="download-link" href={download}>Download result ↗</a>}{tracker.status === 'FAILED' && <p className="error-text">{legacyStages[tracker.errorMessage] || tracker.errorMessage || 'Execution failed'}</p>}</div>;
}

export default function Workspace({ type, onTypeChange, user, onAuth, onCreate, tracker, onCancel, token, onGenerate, demoStatus, busy, message }) {
  const [values, setValues] = useState({ imgFormat: 'webp', width: '', quality: '80', archiveFormat: 'zip', compression: '9', complexity: '5' });
  const [file, setFile] = useState(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const pickFile = (candidate) => { setError(''); if (candidate?.size > MAX_FILE_SIZE) { setError(`File is ${(candidate.size / 1024 / 1024).toFixed(1)} MB. Maximum size is 50 MB.`); return; } setFile(candidate || null); };
  const submit = (e) => { e.preventDefault(); if (!user) { onAuth('login'); return; } if (type !== 'SYNTHETIC_BENCHMARK' && !file && !demoStatus.startsWith('Ready:')) { setError('Choose a file to continue.'); return; } onCreate({ type, values, file }); };
  return <section className="workspace shell" id="workspace">
    <div className="work-layout">
      <div className="work-main">
        <form onSubmit={submit} className="task-form">
          <div className="form-heading"><span>PROCESSING OPTIONS</span><span>{taskTypes.find((item) => item.value === type)?.title}</span></div>
          <Options type={type} values={values} setValues={setValues} onGenerate={onGenerate} demoStatus={demoStatus} user={user} />
          {type !== 'SYNTHETIC_BENCHMARK' && <div className={`dropzone ${drag ? 'dragging' : ''} ${file ? 'has-file' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); pickFile(e.dataTransfer.files[0]); }} onClick={() => fileRef.current?.click()}>
            <input ref={fileRef} type="file" onChange={(e) => pickFile(e.target.files[0])} hidden />
            <span className="upload-icon">{file ? '✓' : '↑'}</span><span><b>{file ? file.name : 'Drop a file here'}</b><small>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · click to replace` : 'or click to browse · up to 50 MB'}</small></span><span className="file-types">{type === 'MEDIA_CONVERT' ? 'IMAGE' : 'FILE'}<br />MAX 50 MB</span>
          </div>}
          {error && <p className="error-text">{error}</p>}
          <div className="submit-row"><p>Your result will appear in the task history when processing is complete.</p><button type="submit" className="primary-button" disabled={busy}>{busy ? 'SUBMITTING…' : 'START TASK ↗'}</button></div>
          {message && <p className="form-message">{message}</p>}
        </form>
        <div className="tracker-panel"><div className="form-heading"><span>CURRENT TASK</span><span>EXECUTION STATUS</span></div><Tracker tracker={tracker} onCancel={onCancel} token={token} /></div>
      </div>
      <aside className="work-aside"><img src={`${ASSET}img2.jpg`} alt="A planet rising above the lunar horizon"/><div className="aside-caption"><span>EARTH · 001</span><span>FROM PROCESSING TO RESULTS</span></div></aside>
    </div>
  </section>;
}
