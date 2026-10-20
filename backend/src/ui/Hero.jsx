const ASSET = '/img/';

export default function Hero({ lbResult, lbStats, ping }) {
  const workers = Object.entries(lbStats || {});

  return <section className="hero shell" id="home">
    <div className="hero-copy">
      <div className="hero-title-wrap"><h1>MEDIA<br /><span>CONVERTER</span></h1></div>
      <p className="hero-description">A media converter and archiver created for the Web Application Development and Maintenance course.</p>
    </div>
    <img className="astronaut" src={`${ASSET}img1.png`} alt="Astronaut in space" />
    <div className="hero-credit"><span>OLEKSANDR BEZKOROVAINY</span><i /><span>PMI-33</span></div>
    <div className="hero-side">
      <button className="lb-card" onClick={ping} aria-label="Check load balancing connection">
        <span className="lb-card-head">
          <img src={`${ASSET}earthico.jpg`} alt="" />
          <span className="lb-card-title"><b>Load balancing<br />test</b></span>
        </span>
        <span className="lb-check"><span>Check connection</span><b aria-hidden="true">↗</b></span>
        <span className="lb-result">
          <span className="lb-result-label">LATEST RESPONSE</span>
          <span className="lb-state">{lbResult?.error ? 'Server unavailable' : lbResult ? <><b>{lbResult.server}</b><i>{lbResult.latency} ms</i></> : 'Waiting for first check'}</span>
        </span>
        <span className="lb-workers">
          <span className="lb-workers-heading">WORKER REQUESTS <b>{workers.reduce((sum, [, count]) => sum + count, 0)}</b></span>
          {workers.length ? workers.map(([server, count]) => <span className="lb-worker" key={server}>{server}<b>{count}</b></span>) : <span className="lb-worker-empty">No worker responses yet</span>}
        </span>
      </button>
    </div>
    <div className="hero-credit"><span>OLEKSANDR BEZKOROVAINY</span><i /><span>PMI-33</span></div>
  </section>;
}
