import type { FormEvent } from 'react'
import React, { useState } from 'react'

interface ClarityPageProps {
  apiBaseUrl: string
  sessionId: string
  onClarityComplete: () => void
  onError: (error: string) => void
}

export function ClarityPage({ apiBaseUrl, sessionId, onClarityComplete, onError }: ClarityPageProps) {
  const [userBackground, setUserBackground] = useState<'researcher' | 'student' | 'teacher'>('student')
  const [researchGoal, setResearchGoal] = useState('')
  const [sourcePreferences, setSourcePreferences] = useState<string[]>(['reputable_only'])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (!researchGoal.trim()) {
      setError('Please describe your research goal.')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch(`${apiBaseUrl}/api/research/${sessionId}/clarity`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userBackground,
          researchGoal,
          sourcePreferences,
        }),
      })

      if (!response.ok) {
        const payload = (await response.json()) as { message?: string }
        throw new Error(payload.message || 'Failed to save clarity responses.')
      }

      onClarityComplete()
    } catch (submitError) {
      const errorMsg =
        submitError instanceof Error ? submitError.message : 'Unexpected error while saving clarity.'
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
        <h1>Phase 2B: Clarity Questions</h1>
        <p className="lead">
          Your initial input needs clarification. Please answer these questions to shape the research direction.
        </p>
      </header>

      <section className="card form-card">
        <form onSubmit={handleSubmit}>
          <div>
            <label htmlFor="background" className="label">
              Your Background
            </label>
            <select
              id="background"
              className="field"
              value={userBackground}
              onChange={(event) =>
                setUserBackground(event.target.value as 'researcher' | 'student' | 'teacher')
              }
            >
              <option value="student">Student</option>
              <option value="researcher">Researcher</option>
              <option value="teacher">Teacher</option>
            </select>
          </div>

          <div>
            <label htmlFor="goal" className="label">
              Research Goal *
            </label>
            <textarea
              id="goal"
              className="field"
              rows={4}
              placeholder="Describe what you want to achieve with this research..."
              value={researchGoal}
              onChange={(event) => setResearchGoal(event.target.value)}
            />
          </div>

          <div>
            <label className="label">Source Preferences</label>
            <p className="hint">Select which types of sources you prefer:</p>
            <div className="checkbox-group">
              {[
                { value: 'research_papers', label: 'Research Papers' },
                { value: 'articles_news', label: 'Articles & News' },
                { value: 'academic_papers', label: 'Academic Papers' },
                { value: 'reputable_only', label: 'Reputable Only (.edu, .gov)' },
              ].map((option) => (
                <label key={option.value} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={sourcePreferences.includes(option.value)}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setSourcePreferences([...sourcePreferences, option.value])
                      } else {
                        setSourcePreferences(sourcePreferences.filter((v) => v !== option.value))
                      }
                    }}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          <button type="submit" className="button" disabled={isSubmitting}>
            {isSubmitting ? 'Processing...' : 'Continue to Planning'}
          </button>
        </form>

        {error ? <p className="error">{error}</p> : null}
      </section>
    </main>
  )
}
