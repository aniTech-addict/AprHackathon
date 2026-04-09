import type { FormEvent, MouseEvent as ReactMouseEvent } from 'react'
import { useState } from 'react'
import type { PlanningResponse, ResearchSegment } from '../types'

interface PlanningPageProps {
  apiBaseUrl: string
  sessionId: string
  onError: (error: string) => void
}

function buildPlanMarkdown(topic: string, totalPages: number, segments: ResearchSegment[]) {
  const lines: string[] = [
    `# Research Plan: ${topic}`,
    '',
    `**Estimated Pages:** ${totalPages}`,
    `**Total Segments:** ${segments.length}`,
    '',
    '## Segmented Research Outline',
    '',
  ]

  for (const segment of segments) {
    lines.push(`### ${segment.order}. ${segment.title}`)
    lines.push(`**Topic:** ${segment.topic}`)
    lines.push('')
    lines.push('**Search Queries:**')
    for (const query of segment.searchQueries) {
      lines.push(`- ${query}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

export function PlanningPage({ apiBaseUrl, sessionId, onError }: PlanningPageProps) {
  const [endGoal, setEndGoal] = useState<
    'propose_solutions' | 'evaluate_and_explain' | 'explore_current_approaches'
  >('evaluate_and_explain')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSavingDraft, setIsSavingDraft] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editorWidthPercent, setEditorWidthPercent] = useState(58)
  const [planData, setPlanData] = useState<PlanningResponse | null>(null)
  const [editablePlan, setEditablePlan] = useState<{
    totalPages: number
    segments: ResearchSegment[]
  } | null>(null)

  function renumberSegments(segments: ResearchSegment[]): ResearchSegment[] {
    return segments.map((segment, index) => ({
      ...segment,
      order: index + 1,
    }))
  }

  function updateSegment(index: number, next: ResearchSegment) {
    if (!editablePlan) return
    const segments = [...editablePlan.segments]
    segments[index] = next
    setEditablePlan({
      ...editablePlan,
      segments: renumberSegments(segments),
    })
  }

  function addSegment() {
    if (!editablePlan) return
    const newSegment: ResearchSegment = {
      order: editablePlan.segments.length + 1,
      title: 'New Segment',
      topic: 'Describe the focus for this segment',
      searchQueries: ['new search query'],
    }

    setEditablePlan({
      ...editablePlan,
      segments: [...editablePlan.segments, newSegment],
    })
  }

  function removeSegment(index: number) {
    if (!editablePlan || editablePlan.segments.length <= 1) return
    const segments = editablePlan.segments.filter((_, idx) => idx !== index)
    setEditablePlan({
      ...editablePlan,
      segments: renumberSegments(segments),
    })
  }

  function moveSegment(index: number, direction: 'up' | 'down') {
    if (!editablePlan) return
    const nextIndex = direction === 'up' ? index - 1 : index + 1
    if (nextIndex < 0 || nextIndex >= editablePlan.segments.length) return

    const segments = [...editablePlan.segments]
    const current = segments[index]
    segments[index] = segments[nextIndex]
    segments[nextIndex] = current

    setEditablePlan({
      ...editablePlan,
      segments: renumberSegments(segments),
    })
  }

  function addQuery(segmentIndex: number) {
    if (!editablePlan) return
    const segment = editablePlan.segments[segmentIndex]
    updateSegment(segmentIndex, {
      ...segment,
      searchQueries: [...segment.searchQueries, ''],
    })
  }

  function updateQuery(segmentIndex: number, queryIndex: number, value: string) {
    if (!editablePlan) return
    const segment = editablePlan.segments[segmentIndex]
    const nextQueries = [...segment.searchQueries]
    nextQueries[queryIndex] = value
    updateSegment(segmentIndex, {
      ...segment,
      searchQueries: nextQueries,
    })
  }

  function removeQuery(segmentIndex: number, queryIndex: number) {
    if (!editablePlan) return
    const segment = editablePlan.segments[segmentIndex]
    if (segment.searchQueries.length <= 1) return

    updateSegment(segmentIndex, {
      ...segment,
      searchQueries: segment.searchQueries.filter((_, idx) => idx !== queryIndex),
    })
  }

  function normalizeEditablePlanPayload() {
    if (!editablePlan) return null
    const normalized = {
      totalPages: Math.max(1, Number(editablePlan.totalPages || 1)),
      segments: editablePlan.segments.map((segment, index) => ({
        order: index + 1,
        title: segment.title.trim(),
        topic: segment.topic.trim(),
        searchQueries: segment.searchQueries.map((query) => query.trim()).filter(Boolean),
      })),
    }
    return normalized
  }

  function clampWidth(value: number) {
    return Math.max(35, Math.min(75, value))
  }

  function handleResizeStart(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault()
    const container = event.currentTarget.parentElement
    if (!container) return

    const rect = container.getBoundingClientRect()

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const cursorX = moveEvent.clientX - rect.left
      const nextWidth = (cursorX / rect.width) * 100
      setEditorWidthPercent(clampWidth(nextWidth))
    }

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  async function handlePlanning(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)
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
      setEditablePlan({
        totalPages: payload.totalPages,
        segments: payload.segments,
      })
      setNotice('Plan generated. You can edit any field before approving.')
    } catch (submitError) {
      const errorMsg =
        submitError instanceof Error ? submitError.message : 'Unexpected error while planning research.'
      setError(errorMsg)
      onError(errorMsg)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSaveDraft(): Promise<boolean> {
    if (!planData) return false
    const normalized = normalizeEditablePlanPayload()
    if (!normalized) return false

    setError(null)
    setNotice(null)
    setIsSavingDraft(true)
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/research/${sessionId}/plans/${planData.planId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(normalized),
        },
      )

      if (!response.ok) {
        const payload = (await response.json()) as { message?: string }
        throw new Error(payload.message || 'Failed to save plan draft.')
      }

      const payload = (await response.json()) as PlanningResponse
      setPlanData(payload)
      setEditablePlan({
        totalPages: payload.totalPages,
        segments: payload.segments,
      })
      setNotice('Draft saved successfully.')
      return true
    } catch (saveError) {
      const errorMsg =
        saveError instanceof Error ? saveError.message : 'Unexpected error while saving draft.'
      setError(errorMsg)
      onError(errorMsg)
      return false
    } finally {
      setIsSavingDraft(false)
    }
  }

  async function handleApprovePlan() {
    if (!planData) return

    const saved = await handleSaveDraft()
    if (!saved) {
      return
    }

    setError(null)
    setNotice(null)
    setIsApproving(true)
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/research/${sessionId}/plans/${planData.planId}/approve`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        },
      )

      if (!response.ok) {
        const payload = (await response.json()) as { message?: string }
        throw new Error(payload.message || 'Failed to approve plan.')
      }

      setPlanData({ ...planData, status: 'approved' })
      setNotice('Plan approved. Next phase is ready for segmented research cycles.')
    } catch (approveError) {
      const errorMsg =
        approveError instanceof Error ? approveError.message : 'Unexpected error while approving plan.'
      setError(errorMsg)
      onError(errorMsg)
    } finally {
      setIsApproving(false)
    }
  }

  const canEdit = !!editablePlan
  const liveMarkdown =
    editablePlan && planData
      ? buildPlanMarkdown(planData.topic, editablePlan.totalPages, editablePlan.segments)
      : planData?.planMarkdown || ''

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
        <div
          className="plan-two-col"
          style={{
            gridTemplateColumns: `${editorWidthPercent}% 10px minmax(0, 1fr)`,
          }}
        >
          <div className="plan-editor-col">
            <h2>Plan Overview</h2>
            <label htmlFor="total-pages" className="label">
              Total Pages
            </label>
            <input
              id="total-pages"
              className="field small-field"
              type="number"
              min={1}
              value={editablePlan?.totalPages ?? planData.totalPages}
              onChange={(event) => {
                if (!editablePlan) return
                setEditablePlan({
                  ...editablePlan,
                  totalPages: Number(event.target.value || 1),
                })
              }}
            />
            <p>
              <strong>Segments:</strong> {editablePlan?.segments.length ?? planData.segmentCount}
            </p>

            <h3>Segmented Outline</h3>
            <div className="segments-list">
              {(editablePlan?.segments || planData.segments).map((segment, segmentIndex) => (
                <article key={segment.order} className="segment-card">
                  <div className="segment-header-row">
                    <h4>Segment {segment.order}</h4>
                    <div className="segment-actions">
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => moveSegment(segmentIndex, 'up')}
                        disabled={segmentIndex === 0 || !canEdit}
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => moveSegment(segmentIndex, 'down')}
                        disabled={
                          segmentIndex === (editablePlan?.segments.length || planData.segments.length) - 1 ||
                          !canEdit
                        }
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        className="text-button danger"
                        onClick={() => removeSegment(segmentIndex)}
                        disabled={!canEdit || (editablePlan?.segments.length || 0) <= 1}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <label className="label">Title</label>
                  <input
                    className="field"
                    value={segment.title}
                    onChange={(event) =>
                      updateSegment(segmentIndex, {
                        ...segment,
                        title: event.target.value,
                      })
                    }
                  />

                  <label className="label">Topic</label>
                  <textarea
                    className="field"
                    rows={3}
                    value={segment.topic}
                    onChange={(event) =>
                      updateSegment(segmentIndex, {
                        ...segment,
                        topic: event.target.value,
                      })
                    }
                  />

                  <p className="hint">
                    <strong>Search Queries</strong>
                  </p>
                  <div className="query-stack">
                    {segment.searchQueries.map((query, queryIndex) => (
                      <div key={`${segment.order}-${queryIndex}`} className="query-row">
                        <input
                          className="field"
                          value={query}
                          onChange={(event) =>
                            updateQuery(segmentIndex, queryIndex, event.target.value)
                          }
                        />
                        <button
                          type="button"
                          className="text-button danger"
                          onClick={() => removeQuery(segmentIndex, queryIndex)}
                          disabled={segment.searchQueries.length <= 1}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <button type="button" className="text-button" onClick={() => addQuery(segmentIndex)}>
                      + Add Query
                    </button>
                  </div>
                </article>
              ))}
            </div>

            <button type="button" className="text-button" onClick={addSegment}>
              + Add Segment
            </button>

            <div className="plan-actions">
              <button
                type="button"
                className="button"
                onClick={handleSaveDraft}
                disabled={isSavingDraft || isApproving}
              >
                {isSavingDraft ? 'Saving Draft...' : 'Save Draft'}
              </button>
              <button
                type="button"
                className="button"
                onClick={handleApprovePlan}
                disabled={isApproving || isSavingDraft || planData.status === 'approved'}
              >
                {isApproving
                  ? 'Approving...'
                  : planData.status === 'approved'
                    ? 'Plan Approved'
                    : 'Approve Plan & Start Research'}
              </button>
            </div>

            {notice ? <p className="success-note">{notice}</p> : null}
            {error ? <p className="error">{error}</p> : null}
          </div>

          <div
            className="col-resizer"
            role="separator"
            aria-label="Resize plan editor and markdown preview"
            aria-orientation="vertical"
            onMouseDown={handleResizeStart}
            title="Drag to resize columns"
          />

          <aside className="plan-preview-col">
            <div className="markdown-preview">
              <h3>Plan Markdown</h3>
              <pre className="code-block">{liveMarkdown}</pre>
            </div>
          </aside>
        </div>
      </section>
    </main>
  )
}
