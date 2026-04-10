import type { FormEvent } from 'react'
import React from 'react'
import type { StartResearchResponse } from '../types'
import { AsyncProgressPanel } from '../components/AsyncProgressPanel'

interface InputPageProps {
  apiBaseUrl: string
  onInputSubmit: (response: StartResearchResponse) => void
  onError: (error: string) => void
}

export function InputPage({ apiBaseUrl, onInputSubmit, onError }: InputPageProps) {
  const [topic, setTopic] = React.useState('')
  const [preferredSitesText, setPreferredSitesText] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

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
      onInputSubmit(payload)
    } catch (submitError) {
      const errorMsg =
        submitError instanceof Error ? submitError.message : 'Unexpected error while starting research session.'
      setError(errorMsg)
      onError(errorMsg)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">Web Researcher Agent</p>
        <h1>Phase 1: Input Section</h1>
        <p className="lead">
          Submit the initial research topic. The system classifies it as descriptive or vague and decides whether
          planning can start directly or clarity questions are needed.
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
            We will auto-filter sources by reputation and still prioritize any trusted sites you provide.
          </p>

          <button type="submit" className="button" disabled={isSubmitting}>
            {isSubmitting ? 'Categorizing...' : 'Start Research Input Phase'}
          </button>

          {isSubmitting ? (
            <AsyncProgressPanel
              compact
              title="Analyzing your request"
              description="We are classifying your topic and deciding whether to ask follow-up questions or move directly to planning."
              expectedSeconds={22}
              steps={[
                'Checking topic clarity',
                'Deciding next workflow step',
                'Preparing your next screen',
              ]}
            />
          ) : null}
        </form>

        {error ? <p className="error">{error}</p> : null}
      </section>
    </main>
  )
}
