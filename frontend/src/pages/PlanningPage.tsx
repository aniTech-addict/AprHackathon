import type { FormEvent } from 'react'
import { useState } from 'react'
import type { PlanningResponse } from '../types'

interface PlanningPageProps {
  apiBaseUrl: string
  sessionId: string
  onError: (error: string) => void
}

export function PlanningPage({ apiBaseUrl, sessionId, onError }: PlanningPageProps) {
  const [endGoal, setEndGoal] = useState<
    'propose_solutions' | 'evaluate_and_explain' | 'explore_current_approaches'
  >('evaluate_and_explain')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [planData, setPlanData] = useState<PlanningResponse | null>(null)

  async function handlePlanning(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      const response = await fetch(`${apiBaseUrl}/api/research/${sessionId}/plan-research`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ endGoal }),
      })

      if (!response.ok) {
        const payload = (await response.json()) as { message?: string }
        throw new Error(payload.message || 'Failed to generate research plan.')
      }

      const payload = (await response.json()) as PlanningResponse
      setPlanData(payload)
    } catch (submitError) {
      const errorMsg =
        submitError instanceof Error ? submitError.message : 'Unexpected error while planning research.'
      setError(errorMsg)
      onError(errorMsg)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!planData) {
    return (
      <main className="shell">
        <header className="hero">
          <p className="eyebrow">Web Researcher Agent</p>
          <h1>Phase 3: Research Planning</h1>
          <p className="lead">Generate a segmented research plan based on your topic and clarifications.</p>
        </header>

        <section className="card form-card">
          <form onSubmit={handlePlanning}>
            <label htmlFor="endGoal" className="label">
              End Goal of Research
            </label>
            <select
              id="endGoal"
              className="field"
              value={endGoal}
              onChange={(event) =>
                setEndGoal(
                  event.target
                    .value as
                    | 'propose_solutions'
                    | 'evaluate_and_explain'
                    | 'explore_current_approaches'
                )
              }
            >
              <option value="evaluate_and_explain">Evaluate & Explain (history, trends, predictions)</option>
              <option value="propose_solutions">Propose Solutions</option>
              <option value="explore_current_approaches">Explore Current Approaches</option>
            </select>

            <button type="submit" className="button" disabled={isSubmitting}>
              {isSubmitting ? 'Generating Plan...' : 'Generate Research Plan'}
            </button>
          </form>

          {error ? <p className="error">{error}</p> : null}
        </section>
      </main>
    )
  }

  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">Web Researcher Agent</p>
        <h1>Research Plan Generated</h1>
        <p className="lead">Review your segmented research plan below.</p>
      </header>

      <section className="card">
        <h2>Plan Overview</h2>
        <p>
          <strong>Total Pages:</strong> {planData.totalPages}
        </p>
        <p>
          <strong>Segments:</strong> {planData.segmentCount}
        </p>

        <h3>Segmented Outline</h3>
        <div className="segments-list">
          {planData.segments.map((segment) => (
            <article key={segment.order} className="segment-card">
              <h4>
                {segment.order}. {segment.title}
              </h4>
              <p>
                <strong>Topic:</strong> {segment.topic}
              </p>
              <p className="hint">
                <strong>Search Queries:</strong>
              </p>
              <ul>
                {segment.searchQueries.map((query, idx) => (
                  <li key={idx}>{query}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <div className="markdown-preview">
          <h3>Plan Markdown</h3>
          <pre className="code-block">{planData.planMarkdown}</pre>
        </div>

        <button className="button">Approve Plan & Start Research</button>
      </section>
    </main>
  )
}
