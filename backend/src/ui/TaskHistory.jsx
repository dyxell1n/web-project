const ASSET = '/img/';

const typeLabels = {
  MEDIA_CONVERT: 'Image conversion',
  ARCHIVE_COMPRESS: 'Archiving',
  SYNTHETIC_BENCHMARK: 'CPU stress test',
};

const statusLabels = {
  PENDING: 'Queued',
  PROCESSING: 'In progress',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

const legacyStages = {
  'Успішно виконано': 'Completed successfully',
  'Скасовано користувачем': 'Cancelled by user',
  'Перервано користувачем': 'Interrupted by user',
  'Призначено воркеру, запуск обробки...': 'Assigned to a worker, starting…',
  'Помилка виконання': 'Execution failed',
};

export default function TaskHistory({ tasks, onRefresh, onCancel, onMonitor, user, onAuth }) {
  return <section className="history shell" id="history">
    <div className="history-heading"><h2>Task history</h2><button className="refresh-button" onClick={user ? onRefresh : onAuth}>{user ? 'REFRESH HISTORY ↻' : 'LOG IN TO VIEW ↗'}</button></div>
    <div className="history-layout">
      <div className="history-image"><img src={`${ASSET}img4.jpg`} alt="Rocket on the launch pad" /></div>
      <div className="table-wrap"><table><thead><tr><th>ID</th><th>TASK</th><th>STATUS</th><th>PROGRESS</th><th>FILE</th><th>TIME</th><th>CREATED</th><th>ACTIONS</th></tr></thead><tbody>
        {!user ? <tr><td colSpan="8" className="empty-table">Log in to view your task history.</td></tr> : tasks.length === 0 ? <tr><td colSpan="8" className="empty-table">No tasks yet. Create your first task above.</td></tr> : tasks.map((task) => <tr key={task.id}>
          <td className="task-id">{task.id.slice(0, 8)}…</td>
          <td>{typeLabels[task.type] || task.type}</td>
          <td><span className={`status-pill ${task.status.toLowerCase()}`}>{statusLabels[task.status] || task.status}</span></td>
          <td><span className="table-progress">{task.progress}%</span><small>{legacyStages[task.stage] || task.stage || ''}</small></td>
          <td className="file-cell" title={task.inputFileName}>{task.inputFileName || 'No file'}</td>
          <td>{task.executionTimeMs ? `${task.executionTimeMs} ms` : '—'}</td>
          <td>{new Date(task.createdAt).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
          <td className="actions">{['PENDING', 'PROCESSING'].includes(task.status) && <><button onClick={() => onMonitor(task.id)}>Monitor</button><button onClick={() => onCancel(task.id)} aria-label="Cancel task">×</button></>}{task.status === 'COMPLETED' && task.outputFileName && <a href={`/api/tasks/${task.id}/download?token=${encodeURIComponent(localStorage.getItem('jwt_token') || '')}`}>↓ file</a>}{task.status === 'FAILED' && <span title={task.errorMessage}>Details</span>}</td>
        </tr>)}
      </tbody></table></div>
    </div>
    <footer className="site-footer"><span>MEDIA <i>CONVERTER & ARCHIVER</i></span><span>WEB APPLICATION DEVELOPMENT & MAINTENANCE · PMI-33</span><a href="#home">BACK TO TOP ↑</a></footer>
  </section>;
}
