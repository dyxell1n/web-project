const tasks = [
  { value: 'MEDIA_CONVERT', number: '01', title: 'IMAGE', subtitle: 'CONVERSION' },
  { value: 'ARCHIVE_COMPRESS', number: '02', title: 'COMPRESSION &', subtitle: 'ARCHIVING' },
  { value: 'SYNTHETIC_BENCHMARK', number: '03', title: 'CPU STRESS', subtitle: 'TEST' },
];

export default function TaskSelector({ type, onSelect }) {
  return <section className="intro-strip shell" aria-label="Choose a task type">
    {tasks.map((task) => <button key={task.value} type="button" className={type === task.value ? 'active' : ''} aria-pressed={type === task.value} onClick={() => onSelect(task.value)}>
      <span>{task.number}</span><b>{task.title}<br />{task.subtitle}</b>
    </button>)}
    <img src="/img/img3.jpg" alt="The Moon and Earth against a starry sky" />
  </section>;
}
