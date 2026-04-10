import { useEffect, useMemo, useState } from 'react'
import { ResizableTwoColumnLayout } from '../components/ResizableTwoColumnLayout'
import type { ReviewExportResponse, ReviewPage, ReviewParagraph, ReviewPreviewResponse } from '../types'

interface ReviewPageProps {
  apiBaseUrl: string
  sessionId: string
  planId: string | null
  onError: (error: string) => void
}

export function ReviewPage({ apiBaseUrl, sessionId, planId, onError }: ReviewPageProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [busyParagraphId, setBusyParagraphId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exportNotice, setExportNotice] = useState<string | null>(null)
  const [reviewData, setReviewData] = useState<ReviewPreviewResponse | null>(null)
  const [documentParagraphs, setDocumentParagraphs] = useState<ReviewParagraph[]>([])
  const [reviewPages, setReviewPages] = useState<ReviewPage[]>([])
  const [activePageIndex, setActivePageIndex] = useState(0)
  const [approvedSegmentOrders, setApprovedSegmentOrders] = useState<number[]>([])
  const [activeParagraphId, setActiveParagraphId] = useState<string | null>(null)
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null)
  const [isFrameLoading, setIsFrameLoading] = useState(false)
  const [editingParagraphId, setEditingParagraphId] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState('')

  function startEditing(paragraph: ReviewParagraph) {
    setEditingParagraphId(paragraph.id)
    setEditingDraft(paragraph.content)
  }

  function cancelEditing() {
    setEditingParagraphId(null)
    setEditingDraft('')
  }

  function applyReviewPayload(payload: ReviewPreviewResponse) {
    setReviewData(payload)
    setDocumentParagraphs(payload.paragraphs)
    setReviewPages(payload.pages || [])
    setApprovedSegmentOrders(payload.approvedSegmentOrders || [])
  }

  function syncSelectionAfterPayload(payload: ReviewPreviewResponse) {
    const nextPageIndex = Math.min(activePageIndex, Math.max(payload.pages.length - 1, 0))
    setActivePageIndex(nextPageIndex)

    const keepCurrent =
      (activeParagraphId && payload.paragraphs.find((paragraph) => paragraph.id === activeParagraphId)) || null
    const fallbackParagraph = payload.pages[nextPageIndex]?.paragraphs?.[0] || payload.paragraphs[0] || null
    const nextActiveParagraph = keepCurrent || fallbackParagraph

    setActiveParagraphId(nextActiveParagraph?.id || null)
    setActiveSourceId(nextActiveParagraph?.sources?.[0]?.id || null)
  }

  async function runParagraphMutation(
    paragraphId: string,
    init: RequestInit,
    actionPathSuffix = '',
  ) {
    if (!reviewData) {
      return
    }

    setBusyParagraphId(paragraphId)
    setError(null)

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/research/${sessionId}/review-preview/paragraphs/${paragraphId}${actionPathSuffix}`,
        init,
      )

      if (!response.ok) {
        const payload = (await response.json()) as { message?: string }
        throw new Error(payload.message || 'Failed to update paragraph.')
      }

      const payload = (await response.json()) as ReviewPreviewResponse
      applyReviewPayload(payload)
      syncSelectionAfterPayload(payload)
    } catch (mutationError) {
      const errorMessage = mutationError instanceof Error ? mutationError.message : 'Failed to update paragraph.'
      setError(errorMessage)
      onError(errorMessage)
    } finally {
      setBusyParagraphId(null)
    }
  }

  const liveParagraphs = useMemo<ReviewParagraph[]>(() => {
    if (!editingParagraphId) {
      return documentParagraphs
    }

    return documentParagraphs.map((paragraph) =>
      paragraph.id === editingParagraphId
        ? {
            ...paragraph,
            content: editingDraft,
          }
        : paragraph,
    )
  }, [documentParagraphs, editingParagraphId, editingDraft])

  async function saveEditing(paragraphId: string) {
    const nextContent = editingDraft.trim()
    if (!nextContent) {
      return
    }

    if (!reviewData) {
      return
    }

    await runParagraphMutation(paragraphId, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        planId: reviewData.planId,
        mode: 'manual',
        content: nextContent,
      }),
    })

    cancelEditing()
  }

  async function refineWithAi(paragraphId: string) {
    if (!reviewData) {
      return
    }

    await runParagraphMutation(paragraphId, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        planId: reviewData.planId,
        mode: 'ai',
      }),
    })
  }

  async function approveParagraph(paragraphId: string) {
    if (!reviewData) {
      return
    }

    await runParagraphMutation(paragraphId, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        planId: reviewData.planId,
      }),
    }, '/approve')
  }

  async function deleteParagraph(paragraphId: string) {
    if (!reviewData) {
      return
    }

    await runParagraphMutation(paragraphId, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        planId: reviewData.planId,
      }),
    })
  }

  async function handleExport() {
    setIsExporting(true)
    setExportNotice(null)

    try {
      if (!reviewData) {
        throw new Error('Review data is not ready yet.')
      }

      const paragraphs = liveParagraphs
      const pages = reviewPages.map((page) => ({
        ...page,
        paragraphs: page.paragraphs.map((pageParagraph) => {
          const edited = paragraphs.find((paragraph) => paragraph.id === pageParagraph.id)
          return edited || pageParagraph
        }),
      }))
      const sources = paragraphs.flatMap((paragraph) =>
        paragraph.sources.map((source) => ({
          ...source,
          paragraphId: paragraph.id,
          paragraphOrder: paragraph.order,
        })),
      )

      const payload: ReviewExportResponse = {
        sessionId,
        planId: reviewData.planId,
        topic: reviewData.topic,
        planStatus: reviewData.planStatus,
        exportedAt: new Date().toISOString(),
        pageCount: pages.length,
        paragraphCount: paragraphs.length,
        sourceCount: sources.length,
        pages: pages.map((page) => ({
          segmentOrder: page.segmentOrder,
          segmentTitle: page.segmentTitle,
          topic: page.topic,
          paragraphs: page.paragraphs.map((paragraph) => ({
            id: paragraph.id,
            order: paragraph.order,
            paragraphIndex: paragraph.paragraphIndex,
            content: paragraph.content,
          })),
        })),
        paragraphs: paragraphs.map((paragraph) => ({
          id: paragraph.id,
          order: paragraph.order,
          segmentOrder: paragraph.segmentOrder,
          paragraphIndex: paragraph.paragraphIndex,
          segmentTitle: paragraph.segmentTitle,
          content: paragraph.content,
          citations: paragraph.sources.map((source) => ({
            sourceId: source.id,
            title: source.title,
            url: source.url,
            excerpt: source.excerpt,
          })),
        })),
        sources,
      }

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8',
      })

      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `review-export-${payload.sessionId}-${payload.planId}.json`
      link.click()
      window.URL.revokeObjectURL(url)

      setExportNotice('Review export downloaded successfully.')
    } catch (exportError) {
      const errorMessage =
        exportError instanceof Error ? exportError.message : 'Unexpected error while exporting review data.'
      setError(errorMessage)
      onError(errorMessage)
    } finally {
      setIsExporting(false)
    }
  }

  async function handleApproveAndContinue() {
    if (!reviewData || !activePage) {
      return
    }

    setIsApproving(true)
    setError(null)

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/research/${sessionId}/review-preview/approve`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            planId: reviewData.planId,
            segmentOrder: activePage.segmentOrder,
          }),
        },
      )

      if (!response.ok) {
        const payload = (await response.json()) as { message?: string }
        throw new Error(payload.message || 'Failed to approve the current page.')
      }

      const payload = (await response.json()) as ReviewPreviewResponse
      applyReviewPayload(payload)

      const nextIndex = Math.min(activePageIndex + 1, Math.max(payload.pages.length - 1, 0))
      setActivePageIndex(nextIndex)

      const nextParagraph = payload.pages[nextIndex]?.paragraphs?.[0] || payload.paragraphs[0] || null
      setActiveParagraphId(nextParagraph?.id || null)
      setActiveSourceId(nextParagraph?.sources[0]?.id || null)
      setEditingParagraphId(null)
      setEditingDraft('')
    } catch (approveError) {
      const errorMessage =
        approveError instanceof Error ? approveError.message : 'Unexpected error while approving the page.'
      setError(errorMessage)
      onError(errorMessage)
    } finally {
      setIsApproving(false)
    }
  }

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
        applyReviewPayload(payload)
        setActivePageIndex(0)

        const firstParagraph = payload.pages?.[0]?.paragraphs?.[0] || payload.paragraphs[0] || null
        setActiveParagraphId(firstParagraph?.id || null)
        setActiveSourceId(firstParagraph?.sources[0]?.id || null)
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
    if (liveParagraphs.length === 0) {
      return null
    }

    if (!activeParagraphId) {
      return liveParagraphs[0]
    }

    return (
      liveParagraphs.find((paragraph) => paragraph.id === activeParagraphId) || liveParagraphs[0]
    )
  }, [liveParagraphs, activeParagraphId])

  const activePage = useMemo<ReviewPage | null>(() => {
    if (reviewPages.length === 0) {
      return null
    }

    return reviewPages[activePageIndex] || reviewPages[0]
  }, [reviewPages, activePageIndex])

  const currentPageParagraphs = useMemo(() => {
    if (!activePage) {
      return []
    }

    return activePage.paragraphs
      .map((pageParagraph) => liveParagraphs.find((paragraph) => paragraph.id === pageParagraph.id) || pageParagraph)
      .sort((a, b) => a.paragraphIndex - b.paragraphIndex)
  }, [activePage, liveParagraphs])

  const currentPageApproved = Boolean(activePage && approvedSegmentOrders.includes(activePage.segmentOrder))

  function goToPage(nextIndex: number) {
    if (nextIndex < 0 || nextIndex >= reviewPages.length) {
      return
    }

    setActivePageIndex(nextIndex)
    const firstParagraph = reviewPages[nextIndex]?.paragraphs?.[0]
    setActiveParagraphId(firstParagraph?.id || null)
    setEditingParagraphId(null)
    setEditingDraft('')
  }

  const activeSource = useMemo(() => {
    if (!activeParagraph || activeParagraph.sources.length === 0) {
      return null
    }

    if (!activeSourceId) {
      return activeParagraph.sources[0]
    }

    return activeParagraph.sources.find((source) => source.id === activeSourceId) || activeParagraph.sources[0]
  }, [activeParagraph, activeSourceId])

  useEffect(() => {
    if (!activeParagraph || activeParagraph.sources.length === 0) {
      setActiveSourceId(null)
      setIsFrameLoading(false)
      return
    }

    setActiveSourceId(activeParagraph.sources[0].id)
    setIsFrameLoading(true)
  }, [activeParagraph?.id])

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
          Review each segment as an independent page. Finish one page, then move to the next.
        </p>
        <div className="review-toolbar">
          <button
            type="button"
            className="button"
            onClick={handleApproveAndContinue}
            disabled={!activePage || currentPageApproved || isApproving}
          >
            {isApproving ? 'Approving...' : currentPageApproved ? 'Page Approved' : 'Approve & Continue'}
          </button>
          <button type="button" className="button" onClick={handleExport} disabled={isExporting}>
            {isExporting ? 'Exporting...' : 'Export Review JSON'}
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => goToPage(activePageIndex - 1)}
            disabled={activePageIndex <= 0}
          >
            Previous Page
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => goToPage(activePageIndex + 1)}
            disabled={!currentPageApproved || activePageIndex >= reviewPages.length - 1}
          >
            Next Page
          </button>
          {exportNotice ? <p className="success-note review-success-note">{exportNotice}</p> : null}
        </div>
      </header>

      <section className="card">
        <ResizableTwoColumnLayout
          className="review-two-col"
          left={
            <div className="review-left-col">
              <h2>Draft Document</h2>
              <p className="hint">
                Page {activePageIndex + 1} of {Math.max(reviewPages.length, 1)}
                {activePage ? ` - ${activePage.segmentTitle}` : ''}
                {currentPageApproved ? ' - approved' : ' - waiting for approval'}
              </p>

              <article className="review-document-page" aria-label="Draft research content">
                <h3 className="review-document-title">
                  {activePage ? `${activePage.segmentOrder}. ${activePage.segmentTitle}` : reviewData?.topic}
                </h3>

                <div className="review-document-body" role="list" aria-label="Document paragraphs">
                  {currentPageParagraphs.map((paragraph) => {
                    const isActive = paragraph.id === activeParagraph?.id
                    const isEditing = paragraph.id === editingParagraphId

                    return (
                      <section
                        key={paragraph.id}
                        role="listitem"
                        tabIndex={0}
                        title="Hover to preview sources. Double-click to edit."
                        className={`review-doc-paragraph ${isActive ? 'is-active' : ''} ${isEditing ? 'is-editing' : ''}`.trim()}
                        onMouseEnter={() => setActiveParagraphId(paragraph.id)}
                        onFocus={() => setActiveParagraphId(paragraph.id)}
                        onClick={() => setActiveParagraphId(paragraph.id)}
                        onDoubleClick={() => startEditing(paragraph)}
                      >
                        {isEditing ? (
                          <>
                            <textarea
                              className="field review-doc-editor"
                              rows={6}
                              value={editingDraft}
                              onChange={(event) => setEditingDraft(event.target.value)}
                            />
                            <div className="review-doc-edit-actions">
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => saveEditing(paragraph.id)}
                                disabled={!editingDraft.trim()}
                              >
                                Save paragraph
                              </button>
                              <button
                                type="button"
                                className="text-button danger"
                                onClick={cancelEditing}
                              >
                                Cancel
                              </button>
                            </div>
                          </>
                        ) : (
                          <p>{paragraph.content}</p>
                        )}
                      </section>
                    )
                  })}
                </div>
              </article>
            </div>
          }
          right={
            <div className="review-right-col">
              <h2>Source Browser</h2>

              {!activeParagraph ? (
                <p className="hint">No paragraph selected yet.</p>
              ) : (
                <>
                  <div className="active-paragraph-summary">
                    <p className="hint">
                      Page {activeParagraph.segmentOrder} • Paragraph {activeParagraph.paragraphIndex}
                    </p>
                    <h3>{activeParagraph.segmentTitle}</h3>
                    <p>{activeParagraph.content}</p>
                  </div>

                  {activeParagraph.sources.length === 0 ? (
                    <p className="hint">No sources are attached to this paragraph yet.</p>
                  ) : (
                    <div className="source-browser-shell">
                      <div className="source-browser-toolbar" role="tablist" aria-label="Source tabs">
                        {activeParagraph.sources.map((source, index) => {
                          const isSourceActive = source.id === activeSource?.id
                          return (
                            <button
                              key={source.id}
                              type="button"
                              role="tab"
                              aria-selected={isSourceActive}
                              className={`source-tab-button ${isSourceActive ? 'is-active' : ''}`}
                              onClick={() => {
                                setActiveSourceId(source.id)
                                setIsFrameLoading(true)
                              }}
                            >
                              Source {index + 1}
                            </button>
                          )
                        })}
                      </div>

                      {activeSource ? (
                        <>
                          <div className="source-card" role="region" aria-label="Selected source details">
                            <h4>{activeSource.title}</h4>
                            <p>{activeSource.excerpt}</p>
                            <a href={activeSource.url} target="_blank" rel="noreferrer" className="source-link">
                              Open in full tab
                            </a>
                          </div>

                          <div className="mini-browser-frame-wrap">
                            {isFrameLoading ? <p className="hint">Loading webpage preview...</p> : null}
                            <iframe
                              key={activeSource.id}
                              src={activeSource.url}
                              title={`Source preview: ${activeSource.title}`}
                              className="mini-browser-frame"
                              onLoad={() => setIsFrameLoading(false)}
                              referrerPolicy="no-referrer"
                            />
                          </div>

                          <p className="hint mini-browser-note">
                            Some websites block embedding. If a preview is blocked, use "Open in full tab".
                          </p>
                        </>
                      ) : null}
                    </div>
                  )}
                </>
              )}
            </div>
          }
        />
      </section>
    </main>
  )
}
