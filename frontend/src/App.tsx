import { FormEvent, useMemo, useState } from 'react'
import './App.css'

type InputCategory = 'descriptive' | 'vague'

interface StartResearchResponse {
  sessionId: string
  topic: string
  inputCategory: InputCategory
  confidence: number
  reasoning: string
  nextStep: 'ask_clarity_questions' | 'generate_research_plan'
}

function App() {
  const [topic, setTopic] = useState('')
  const [preferredSitesText, setPreferredSitesText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<StartResearchResponse | null>(null)

  const apiBaseUrl = useMemo(
    () => import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000',
    [],
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const trimmedTopic = topic.trim()
    if (!trimmedTopic) {
      setError('Please enter a research topic before continuing.')
      return
    }

    const preferredSites = preferredSitesText
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)

    setIsSubmitting(true)
    try {
      const response = await fetch(`${apiBaseUrl}/api/research/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          topic: trimmedTopic,
          preferredSites,
        }),
      })

      if (!response.ok) {
        const payload = (await response.json()) as { message?: string }
        throw new Error(payload.message || 'Failed to start research session.')
      }

      const payload = (await response.json()) as StartResearchResponse
      setResult(payload)
    } catch (submitError) {
      if (submitError instanceof Error) {
        setError(submitError.message)
      } else {
        setError('Unexpected error while starting research session.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">Web Researcher Agent</p>
        <h1>Phase 2: Input Section</h1>
        <p className="lead">
          Submit the initial research topic. The system classifies it as
          descriptive or vague and decides whether planning can start directly
          or clarity questions are needed.
        </p>
      </header>

      <section className="card form-card">
        <form onSubmit={handleSubmit}>
          <label htmlFor="topic" className="label">
            Research Topic
          </label>
          <textarea
            id="topic"
            className="field"
            rows={6}
            placeholder="Example: Analyze world hunger trends from 2000-2025 and evaluate policy-level interventions that improved food security."
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
          />

          <label htmlFor="preferred-sites" className="label">
            Preferred Sites (optional)
          </label>
          <input
            id="preferred-sites"
            className="field"
            placeholder="who.int, worldbank.org, fao.org"
            value={preferredSitesText}
            onChange={(event) => setPreferredSitesText(event.target.value)}
          />

          <p className="hint">
            We will auto-filter sources by reputation and still prioritize any
            trusted sites you provide.
          </p>

          <button type="submit" className="button" disabled={isSubmitting}>
            {isSubmitting ? 'Categorizing...' : 'Start Research Input Phase'}
          </button>
        </form>

        {error ? <p className="error">{error}</p> : null}

        {result ? (
          <article className="result">
            <h2>Input Categorization Result</h2>
            <p>
              <strong>Session:</strong> {result.sessionId}
            </p>
            <p>
              <strong>Category:</strong>{' '}
              <span className={`badge ${result.inputCategory}`}>
                {result.inputCategory}
              </span>
            </p>
            <p>
              <strong>Confidence:</strong>{' '}
              {(result.confidence * 100).toFixed(1)}%
            </p>
            <p>
              <strong>Reasoning:</strong> {result.reasoning}
            </p>
            <p>
              <strong>Next:</strong>{' '}
              {result.nextStep === 'ask_clarity_questions'
                ? 'Move to Clarity Questions phase.'
                : 'Move directly to Planning phase.'}
            </p>
          </article>
        ) : null}
      </section>
    </main>
  )
}

export default App
