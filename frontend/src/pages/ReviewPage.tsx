import { useEffect, useMemo, useState } from 'react'
import { ResizableTwoColumnLayout } from '../components/ResizableTwoColumnLayout'
import type { ReviewParagraph, ReviewPreviewResponse } from '../types'

interface ReviewPageProps {
  apiBaseUrl: string
  sessionId: string
  planId: string | null
  onError: (error: string) => void
}

export function ReviewPage({ apiBaseUrl, sessionId, planId, onError }: ReviewPageProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reviewData, setReviewData] = useState<ReviewPreviewResponse | null>(null)
  const [activeParagraphId, setActiveParagraphId] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadReviewData() {
      setIsLoading(true)
      setError(null)

      const query = planId ? `?planId=${encodeURIComponent(planId)}` : ''

      try {
        const response = await fetch(`${apiBaseUrl}/api/research/${sessionId}/review-preview${query}`, {
          signal: controller.signal,
        })

        if (!response.ok) {
          const payload = (await response.json()) as { message?: string }
          throw new Error(payload.message || 'Failed to load review preview data.')
        }

        const payload = (await response.json()) as ReviewPreviewResponse
        setReviewData(payload)
        setActiveParagraphId(payload.paragraphs[0]?.id || null)
      } catch (loadError) {
        if ((loadError as { name?: string }).name === 'AbortError') {
          return
        }

        const errorMessage =
          loadError instanceof Error ? loadError.message : 'Unexpected error while loading review preview.'
        setError(errorMessage)
        onError(errorMessage)
      } finally {
        setIsLoading(false)
      }
    }

    void loadReviewData()

    return () => {
      controller.abort()
    }
  }, [apiBaseUrl, sessionId, planId, onError])

  const activeParagraph = useMemo<ReviewParagraph | null>(() => {
    if (!reviewData || reviewData.paragraphs.length === 0) {
      return null
    }

    if (!activeParagraphId) {
      return reviewData.paragraphs[0]
    }

    return reviewData.paragraphs.find((paragraph) => paragraph.id === activeParagraphId) || reviewData.paragraphs[0]
  }, [reviewData, activeParagraphId])

  if (isLoading) {
    return (
      <main className="shell shell-wide">
        <header className="hero">
          <p className="eyebrow">Web Researcher Agent</p>
          <h1>Phase 4: Source Review</h1>
          <p className="lead">Loading paragraph-to-source preview...</p>
        </header>
      </main>
    )
  }

  if (error) {
    return (
      <main className="shell shell-wide">
        <header className="hero">
          <p className="eyebrow">Web Researcher Agent</p>
          <h1>Phase 4: Source Review</h1>
          <p className="lead">Click a paragraph to preview the evidence in the right panel.</p>
        </header>

        <section className="card">
          <p className="error">{error}</p>
        </section>
      </main>
    )
  }

  return (
    <main className="shell shell-wide">
      <header className="hero">
        <p className="eyebrow">Web Researcher Agent</p>
        <h1>Phase 4: Source Review</h1>
        <p className="lead">
          Select any paragraph to preview the sources that inspired it. This keeps verification inside one workflow.
        </p>
      </header>

      <section className="card">
        <ResizableTwoColumnLayout
          className="review-two-col"
          left={
            <div className="review-left-col">
              <h2>Paragraphs</h2>
              <p className="hint">Topic: {reviewData?.topic}</p>

              <div className="review-paragraph-list" role="list" aria-label="Paragraph review list">
                {(reviewData?.paragraphs || []).map((paragraph) => {
                  const isActive = paragraph.id === activeParagraph?.id

                  return (
                    <button
                      key={paragraph.id}
                      type="button"
                      className={`paragraph-preview-card ${isActive ? 'is-active' : ''}`}
                      onClick={() => setActiveParagraphId(paragraph.id)}
                    >
                      <span className="paragraph-preview-order">Paragraph {paragraph.order}</span>
                      <strong>{paragraph.segmentTitle}</strong>
                      <p>{paragraph.content}</p>
                      <span className="paragraph-preview-cta">{isActive ? 'Previewing sources' : 'Click to preview sources'}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          }
          right={
            <div className="review-right-col">
              <h2>Source Preview</h2>

              {!activeParagraph ? (
                <p className="hint">No paragraph selected yet.</p>
              ) : (
                <>
                  <div className="active-paragraph-summary">
                    <p className="hint">Paragraph {activeParagraph.order}</p>
                    <h3>{activeParagraph.segmentTitle}</h3>
                    <p>{activeParagraph.content}</p>
                  </div>

                  <div className="source-list" role="list" aria-label="Sources for selected paragraph">
                    {activeParagraph.sources.map((source) => (
                      <article key={source.id} className="source-card" role="listitem">
                        <h4>{source.title}</h4>
                        <p>{source.excerpt}</p>
                        <a href={source.url} target="_blank" rel="noreferrer" className="source-link">
                          Open source
                        </a>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </div>
          }
        />
      </section>
    </main>
  )
}
