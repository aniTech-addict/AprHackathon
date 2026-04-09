import './App.css'

function App() {
  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">Web Researcher Agent</p>
        <h1>Phase 1 Foundation Ready</h1>
        <p className="lead">
          This dashboard will run the four-stage research workflow: Input,
          Clarity and Planning, Review and Refinement, and Output.
        </p>
      </header>

      <section className="grid">
        <article className="card">
          <h2>Backend</h2>
          <p>Express + TypeScript configured with a health endpoint.</p>
          <code>GET /health</code>
        </article>
        <article className="card">
          <h2>Database</h2>
          <p>PostgreSQL + pgvector ready through Docker Compose.</p>
          <code>docker compose up -d postgres</code>
        </article>
        <article className="card">
          <h2>Frontend</h2>
          <p>React shell prepared for upcoming phase-by-phase screens.</p>
          <code>Input -&gt; Planning -&gt; Review -&gt; Output</code>
        </article>
      </section>
    </main>
  )
}

export default App
