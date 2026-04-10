import { useEffect, useMemo, useRef, useState } from 'react'
import { ResizableTwoColumnLayout } from '../components/ResizableTwoColumnLayout'
import { AsyncProgressPanel } from '../components/AsyncProgressPanel'
import type { ReviewExportResponse, ReviewPage, ReviewParagraph, ReviewPreviewResponse } from '../types'

interface ReviewPageProps {
  apiBaseUrl: string
  sessionId: string
  planId: string | null
  onError: (error: string) => void
  onParagraphGenerationStateChange?: (hasGeneratedParagraphs: boolean) => void
  onApprovedDraftMarkdownChange?: (markdown: string) => void
  onApprovedDraftLoadingChange?: (isLoading: boolean) => void
  onApprovedDraftErrorChange?: (message: string | null) => void
}

export function ReviewPage({
  apiBaseUrl,
  sessionId,
  planId,
  onError,
  onParagraphGenerationStateChange,
  onApprovedDraftMarkdownChange,
  onApprovedDraftLoadingChange,
  onApprovedDraftErrorChange,
}: ReviewPageProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false)
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
  const [relevanceThreshold, setRelevanceThreshold] = useState(0.78)
  const [activeParagraphId, setActiveParagraphId] = useState<string | null>(null)
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null)
  const [isSourcePreviewLoading, setIsSourcePreviewLoading] = useState(false)
  const [sourcePreviewError, setSourcePreviewError] = useState<string | null>(null)
  const [sourcePreviewText, setSourcePreviewText] = useState<string>('')
  const [sourcePreviewTitle, setSourcePreviewTitle] = useState<string>('')
  const [editingParagraphId, setEditingParagraphId] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState('')
  const [aiRefineParagraphId, setAiRefineParagraphId] = useState<string | null>(null)
  const [aiRefineInstruction, setAiRefineInstruction] = useState('')
  const [approvedDraftMarkdown, setApprovedDraftMarkdown] = useState('')
  const [busyOperationLabel, setBusyOperationLabel] = useState<string | null>(null)
  const activePageIndexRef = useRef(0)
  const activeParagraphIdRef = useRef<string | null>(null)
  const activeSourceIdRef = useRef<string | null>(null)

  useEffect(() => {
    activePageIndexRef.current = activePageIndex
  }, [activePageIndex])

  useEffect(() => {
    activeParagraphIdRef.current = activeParagraphId
  }, [activeParagraphId])

  useEffect(() => {
    activeSourceIdRef.current = activeSourceId
  }, [activeSourceId])

  function setPageSelection(nextPageIndex: number) {
    activePageIndexRef.current = nextPageIndex
    setActivePageIndex(nextPageIndex)
  }

  function setParagraphAndSourceSelection(nextParagraphId: string | null, nextSourceId: string | null) {
    activeParagraphIdRef.current = nextParagraphId
    activeSourceIdRef.current = nextSourceId
    setActiveParagraphId(nextParagraphId)
    setActiveSourceId(nextSourceId)
  }

  const relevanceThresholdLabel = useMemo(() => `${Math.round(relevanceThreshold * 100)}%`, [relevanceThreshold])

  function getPreferredSourceId(paragraph: ReviewParagraph | null): string | null {
    if (!paragraph || paragraph.sources.length === 0) {
      return null
    }

    const preferredIndex = Math.max(0, paragraph.paragraphIndex - 1)
    return paragraph.sources[preferredIndex]?.id || paragraph.sources[0].id
  }

  function startEditing(paragraph: ReviewParagraph) {
    setEditingParagraphId(paragraph.id)
    setEditingDraft(paragraph.content)
  }

  function cancelEditing() {
    setEditingParagraphId(null)
    setEditingDraft('')
  }

  function openAiRefine(paragraph: ReviewParagraph) {
    setAiRefineParagraphId(paragraph.id)
    setAiRefineInstruction('')
  }

  function cancelAiRefine() {
    setAiRefineParagraphId(null)
    setAiRefineInstruction('')
  }

  function selectParagraph(paragraph: ReviewParagraph | null) {
    setParagraphAndSourceSelection(paragraph?.id || null, getPreferredSourceId(paragraph))
  }

  function applyReviewPayload(payload: ReviewPreviewResponse) {
    setReviewData(payload)
    setDocumentParagraphs(payload.paragraphs)
    setReviewPages(payload.pages || [])
    setApprovedSegmentOrders(payload.approvedSegmentOrders || [])
  }

  function syncSelectionAfterPayload(payload: ReviewPreviewResponse) {
    const currentPageIndex = activePageIndexRef.current
    const currentParagraphId = activeParagraphIdRef.current
    const currentSourceId = activeSourceIdRef.current

    const nextPageIndex = Math.min(currentPageIndex, Math.max(payload.pages.length - 1, 0))
    setPageSelection(nextPageIndex)

    const keepCurrent =
      (currentParagraphId && payload.paragraphs.find((paragraph) => paragraph.id === currentParagraphId)) || null
    const fallbackParagraph = payload.pages[nextPageIndex]?.paragraphs?.[0] || payload.paragraphs[0] || null
    const nextActiveParagraph = keepCurrent || fallbackParagraph

    if (!nextActiveParagraph || nextActiveParagraph.sources.length === 0) {
      setParagraphAndSourceSelection(nextActiveParagraph?.id || null, null)
      return
    }

    const keepCurrentSource = currentSourceId
      ? nextActiveParagraph.sources.find((source) => source.id === currentSourceId) || null
      : null

    setParagraphAndSourceSelection(
      nextActiveParagraph.id,
      keepCurrentSource?.id || getPreferredSourceId(nextActiveParagraph),
    )
  }

  async function runParagraphMutation(
    paragraphId: string,
    init: RequestInit,
    actionPathSuffix = '',
  ): Promise<boolean> {
    if (!reviewData) {
      return false
    }

    setBusyParagraphId(paragraphId)
    setBusyOperationLabel(
      actionPathSuffix === '/approve'
        ? 'Approving paragraph'
        : init.method === 'DELETE'
          ? 'Deleting paragraph'
          : init.body && String(init.body).includes('"mode":"ai"')
            ? 'AI refining paragraph'
            : 'Updating paragraph',
    )
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
      return true
    } catch (mutationError) {
      const errorMessage = mutationError instanceof Error ? mutationError.message : 'Failed to update paragraph.'
      setError(errorMessage)
      onError(errorMessage)
      return false
    } finally {
      setBusyParagraphId(null)
      setBusyOperationLabel(null)
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

  useEffect(() => {
    const hasGeneratedParagraphs = liveParagraphs.some((paragraph) => paragraph.content.trim().length > 0)
    onParagraphGenerationStateChange?.(hasGeneratedParagraphs)
  }, [liveParagraphs, onParagraphGenerationStateChange])

  useEffect(() => {
    onApprovedDraftMarkdownChange?.(approvedDraftMarkdown)
  }, [approvedDraftMarkdown, onApprovedDraftMarkdownChange])

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

  async function refineWithAi(paragraphId: string, instruction?: string): Promise<boolean> {
    if (!reviewData) {
      return false
    }

    return runParagraphMutation(paragraphId, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        planId: reviewData.planId,
        mode: 'ai',
        instruction,
      }),
    })
  }

  async function submitAiRefine(paragraphId: string) {
    const instruction = aiRefineInstruction.trim() || undefined
    const success = await refineWithAi(paragraphId, instruction)
    if (success) {
      cancelAiRefine()
    }
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
    setBusyOperationLabel('Exporting review package')
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
      setBusyOperationLabel(null)
    }
  }

  async function handleApproveAndContinue() {
    if (!reviewData || !activePage) {
      return
    }

    setIsApproving(true)
    setBusyOperationLabel('Approving page and generating next one')
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
            relevanceThreshold,
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
      setPageSelection(nextIndex)

      const nextParagraph = payload.pages[nextIndex]?.paragraphs?.[0] || payload.paragraphs[0] || null
      setParagraphAndSourceSelection(nextParagraph?.id || null, getPreferredSourceId(nextParagraph))
      setEditingParagraphId(null)
      setEditingDraft('')
    } catch (approveError) {
      const errorMessage =
        approveError instanceof Error ? approveError.message : 'Unexpected error while approving the page.'
      setError(errorMessage)
      onError(errorMessage)
    } finally {
      setIsApproving(false)
      setBusyOperationLabel(null)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    let pollTimeout: number | null = null

    async function loadReviewData(silent = false) {
      if (!silent) {
        setIsLoading(true)
      }
      setError(null)

      const queryParams = new URLSearchParams()
      if (planId) {
        queryParams.set('planId', planId)
      }
      queryParams.set('relevanceThreshold', relevanceThreshold.toFixed(2))
      const query = `?${queryParams.toString()}`

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
        setIsGeneratingPreview(Boolean(payload.isGenerating))

        const hasActiveSelection = Boolean(activeParagraphIdRef.current)
        if (!hasActiveSelection) {
          setPageSelection(0)
          const firstParagraph = payload.pages?.[0]?.paragraphs?.[0] || payload.paragraphs[0] || null
          setParagraphAndSourceSelection(firstParagraph?.id || null, getPreferredSourceId(firstParagraph))
        } else {
          syncSelectionAfterPayload(payload)
        }

        if (payload.isGenerating) {
          pollTimeout = window.setTimeout(() => {
            void loadReviewData(true)
          }, 1800)
        }
      } catch (loadError) {
        if ((loadError as { name?: string }).name === 'AbortError') {
          return
        }

        const errorMessage =
          loadError instanceof Error ? loadError.message : 'Unexpected error while loading review preview.'
        setError(errorMessage)
        onError(errorMessage)
      } finally {
        if (!silent) {
          setIsLoading(false)
        }
      }
    }

    void loadReviewData()

    return () => {
      controller.abort()
      if (pollTimeout) {
        window.clearTimeout(pollTimeout)
      }
    }
  }, [apiBaseUrl, sessionId, planId, relevanceThreshold, onError])

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

  const currentPageHasPendingParagraphs = currentPageParagraphs.some(
    (paragraph) => paragraph.status === 'pending_review',
  )
  const currentPageHasApprovedParagraphs = currentPageParagraphs.some(
    (paragraph) => paragraph.status === 'approved',
  )

  const currentPageApproved = Boolean(activePage && approvedSegmentOrders.includes(activePage.segmentOrder))

  const rawApprovedDraftMarkdown = useMemo(() => {
    if (!reviewData) {
      return ''
    }

    const approvedSet = new Set(approvedSegmentOrders)
    const segmentTitleByOrder = new Map<number, string>()
    for (const page of reviewPages) {
      segmentTitleByOrder.set(page.segmentOrder, page.segmentTitle)
    }

    const approvedParagraphs = liveParagraphs
      .filter((paragraph) => paragraph.status === 'approved' && approvedSet.has(paragraph.segmentOrder))
      .sort((a, b) => a.segmentOrder - b.segmentOrder || a.paragraphIndex - b.paragraphIndex)

    if (approvedParagraphs.length === 0) {
      return ''
    }

    const lines: string[] = [
      `# Approved Draft Progress: ${reviewData.topic}`,
      '',
      `Generated at: ${new Date().toISOString()}`,
      '',
    ]

    let currentSegmentOrder = -1
    for (const paragraph of approvedParagraphs) {
      if (paragraph.segmentOrder !== currentSegmentOrder) {
        currentSegmentOrder = paragraph.segmentOrder
        const title = segmentTitleByOrder.get(paragraph.segmentOrder) || `Section ${paragraph.segmentOrder}`
        lines.push(`## ${paragraph.segmentOrder}. ${title}`)
        lines.push('')
      }

      lines.push(paragraph.content)
      lines.push('')
    }

    return lines.join('\n').trim()
  }, [reviewData, approvedSegmentOrders, reviewPages, liveParagraphs])

  useEffect(() => {
    const draftPlanId = reviewData?.planId || ''

    if (!draftPlanId || !rawApprovedDraftMarkdown) {
      setApprovedDraftMarkdown('')
      onApprovedDraftLoadingChange?.(false)
      onApprovedDraftErrorChange?.(null)
      return
    }

    const controller = new AbortController()

    async function loadPolishedDraftMarkdown() {
      onApprovedDraftLoadingChange?.(true)
      onApprovedDraftErrorChange?.(null)

      const query = new URLSearchParams({
        planId: draftPlanId,
        relevanceThreshold: relevanceThreshold.toFixed(2),
      })

      try {
        const response = await fetch(
          `${apiBaseUrl}/api/research/${sessionId}/review-draft-markdown?${query.toString()}`,
          { signal: controller.signal },
        )

        if (!response.ok) {
          const payload = (await response.json()) as { message?: string }
          throw new Error(payload.message || 'Failed to build polished markdown draft.')
        }

        const payload = (await response.json()) as { markdown?: string }
        const polished = String(payload.markdown || '').trim()
        setApprovedDraftMarkdown(polished || rawApprovedDraftMarkdown)
        onApprovedDraftErrorChange?.(null)
      } catch (draftError) {
        if ((draftError as { name?: string }).name === 'AbortError') {
          return
        }

        onApprovedDraftErrorChange?.(
          draftError instanceof Error ? draftError.message : 'Failed to load polished markdown draft.',
        )
        setApprovedDraftMarkdown(rawApprovedDraftMarkdown)
      } finally {
        onApprovedDraftLoadingChange?.(false)
      }
    }

    void loadPolishedDraftMarkdown()

    return () => {
      controller.abort()
    }
  }, [
    apiBaseUrl,
    sessionId,
    reviewData,
    relevanceThreshold,
    rawApprovedDraftMarkdown,
    onApprovedDraftLoadingChange,
    onApprovedDraftErrorChange,
  ])

  async function handleDownloadApprovedDraftMarkdown() {
    if (!reviewData || !approvedDraftMarkdown) {
      return
    }

    const blob = new Blob([approvedDraftMarkdown], {
      type: 'text/markdown;charset=utf-8',
    })

    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `approved-draft-${reviewData.sessionId}-${reviewData.planId}.md`
    link.click()
    window.URL.revokeObjectURL(url)
  }

  function goToPage(nextIndex: number) {
    if (nextIndex < 0 || nextIndex >= reviewPages.length) {
      return
    }

    setPageSelection(nextIndex)
    const firstParagraph = reviewPages[nextIndex]?.paragraphs?.[0]
    selectParagraph(firstParagraph || null)
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
      activeSourceIdRef.current = null
      setActiveSourceId(null)
      setIsSourcePreviewLoading(false)
      setSourcePreviewError(null)
      setSourcePreviewText('')
      setSourcePreviewTitle('')
      return
    }

    const preferredSourceId = getPreferredSourceId(activeParagraph)
    activeSourceIdRef.current = preferredSourceId
    setActiveSourceId(preferredSourceId)
  }, [activeParagraph?.id])

  useEffect(() => {
    const source = activeSource
    if (!source) {
      setIsSourcePreviewLoading(false)
      setSourcePreviewError(null)
      setSourcePreviewText('')
      setSourcePreviewTitle('')
      return
    }

    const selectedSource = source

    const controller = new AbortController()

    async function loadSourcePreview() {
      setIsSourcePreviewLoading(true)
      setSourcePreviewError(null)
      setSourcePreviewText('')
      setSourcePreviewTitle('')

      try {
        const response = await fetch(
          `${apiBaseUrl}/api/research/${sessionId}/source-preview?url=${encodeURIComponent(selectedSource.url)}`,
          { signal: controller.signal },
        )

        if (!response.ok) {
          const payload = (await response.json()) as { message?: string }
          throw new Error(payload.message || 'Failed to load webpage preview.')
        }

        const payload = (await response.json()) as { title?: string; excerpt?: string }
        setSourcePreviewTitle(payload.title || selectedSource.title)
        setSourcePreviewText(payload.excerpt || '')
      } catch (previewError) {
        if ((previewError as { name?: string }).name === 'AbortError') {
          return
        }

        const message =
          previewError instanceof Error ? previewError.message : 'Failed to load webpage preview.'
        setSourcePreviewError(message)
      } finally {
        setIsSourcePreviewLoading(false)
      }
    }

    void loadSourcePreview()

    return () => {
      controller.abort()
    }
  }, [apiBaseUrl, sessionId, activeSource?.id])

  if (isLoading) {
    return (
      <main className="shell shell-wide">
        <header className="hero">
          <p className="eyebrow">Web Researcher Agent</p>
          <h1>Phase 4: Source Review</h1>
          <p className="lead">Loading paragraph-to-source preview...</p>
        </header>

        <section className="card">
          <AsyncProgressPanel
            title="Preparing review preview"
            description="We are loading generated paragraphs, linked sources, and the current review progress state."
            expectedSeconds={40}
            steps={[
              'Loading approved plan and segment context',
              'Fetching paragraph drafts and citations',
              'Preparing source browser and page navigation',
            ]}
          />
        </section>
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
          <div className="review-toolbar-row review-toolbar-row-primary">
            <div className="review-page-nav-group">
              <button
                type="button"
                className="text-button"
                onClick={() => goToPage(activePageIndex - 1)}
                disabled={activePageIndex <= 0}
              >
                Previous Page
              </button>

              <p className="review-page-indicator">
                Page {activePageIndex + 1} / {Math.max(reviewPages.length, 1)}
                {currentPageApproved ? ' - approved' : ' - in review'}
              </p>

              <button
                type="button"
                className="text-button"
                onClick={() => goToPage(activePageIndex + 1)}
                disabled={!currentPageApproved || activePageIndex >= reviewPages.length - 1}
              >
                Next Page
              </button>
            </div>

            <div className="review-approve-group">
              <button
                type="button"
                className="button"
                onClick={handleApproveAndContinue}
                disabled={
                  !activePage ||
                  currentPageApproved ||
                  isApproving ||
                  currentPageHasPendingParagraphs ||
                  !currentPageHasApprovedParagraphs
                }
              >
                {isApproving ? 'Approving...' : currentPageApproved ? 'Page Approved' : 'Approve & Continue'}
              </button>
            </div>
          </div>

          <div className="review-toolbar-row review-toolbar-row-secondary">
            <div className="review-threshold-control">
              <label htmlFor="relevance-threshold" className="hint">
                Focus strictness: {relevanceThresholdLabel}
              </label>
              <input
                id="relevance-threshold"
                type="range"
                min={0.6}
                max={0.95}
                step={0.01}
                value={relevanceThreshold}
                onChange={(event) => setRelevanceThreshold(Number(event.target.value))}
              />
            </div>

            <div className="review-export-group">
              <button type="button" className="button" onClick={handleExport} disabled={isExporting}>
                {isExporting ? 'Exporting...' : 'Export Review JSON'}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => void handleDownloadApprovedDraftMarkdown()}
                disabled={!approvedDraftMarkdown}
              >
                Download Approved Draft (.md)
              </button>
            </div>
          </div>

          {exportNotice ? <p className="success-note review-success-note">{exportNotice}</p> : null}
        </div>
      </header>

      {isGeneratingPreview ? (
        <section className="card">
          <AsyncProgressPanel
            compact
            title="Building page content"
            description="Paragraphs are generated one-by-one and appear below as soon as each one is ready."
            expectedSeconds={42}
            steps={[
              'Generating paragraph drafts',
              'Attaching sources to each paragraph',
              'Refreshing live preview incrementally',
            ]}
          />
        </section>
      ) : null}

      {busyOperationLabel ? (
        <section className="card">
          <AsyncProgressPanel
            compact
            title={busyOperationLabel}
            description="The backend is processing this request. This can take longer when AI rewriting or source refresh is involved."
            expectedSeconds={35}
            steps={[
              'Sending request to backend',
              'Processing with AI and validation',
              'Refreshing updated review state',
            ]}
          />
        </section>
      ) : null}

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
                        onMouseEnter={() => selectParagraph(paragraph)}
                        onFocus={() => selectParagraph(paragraph)}
                        onClick={() => selectParagraph(paragraph)}
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
                                onClick={() => void saveEditing(paragraph.id)}
                                disabled={!editingDraft.trim() || busyParagraphId === paragraph.id}
                              >
                                {busyParagraphId === paragraph.id ? 'Saving...' : 'Save paragraph'}
                              </button>
                              <button
                                type="button"
                                className="text-button danger"
                                onClick={cancelEditing}
                                disabled={busyParagraphId === paragraph.id}
                              >
                                Cancel
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <p>{paragraph.content}</p>
                            <div className="review-doc-paragraph-meta">
                              <span className={`review-status-chip status-${paragraph.status}`}>
                                {paragraph.status === 'pending_review'
                                  ? 'Pending review'
                                  : paragraph.status === 'approved'
                                    ? 'Approved'
                                    : 'Deleted'}
                              </span>
                              {paragraph.lastEditedBy ? (
                                <span className="hint">Last edit: {paragraph.lastEditedBy.toUpperCase()}</span>
                              ) : null}
                            </div>
                            <div className="review-doc-actions">
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => startEditing(paragraph)}
                                disabled={busyParagraphId === paragraph.id}
                              >
                                Manual Refine
                              </button>
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => openAiRefine(paragraph)}
                                disabled={busyParagraphId === paragraph.id}
                              >
                                AI Refine
                              </button>
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => void approveParagraph(paragraph.id)}
                                disabled={busyParagraphId === paragraph.id || paragraph.status === 'approved'}
                              >
                                Approve Paragraph
                              </button>
                              <button
                                type="button"
                                className="text-button danger"
                                onClick={() => void deleteParagraph(paragraph.id)}
                                disabled={busyParagraphId === paragraph.id}
                              >
                                Delete Paragraph
                              </button>
                            </div>

                            {aiRefineParagraphId === paragraph.id ? (
                              <div className="ai-refine-box">
                                <label className="label" htmlFor={`ai-instruction-${paragraph.id}`}>
                                  AI refinement instruction (optional)
                                </label>
                                <textarea
                                  id={`ai-instruction-${paragraph.id}`}
                                  className="field"
                                  rows={3}
                                  placeholder="Example: keep the tone analytical, focus on causal drivers, and add stronger transitions to next paragraph."
                                  value={aiRefineInstruction}
                                  onChange={(event) => setAiRefineInstruction(event.target.value)}
                                />
                                <div className="review-doc-edit-actions">
                                  <button
                                    type="button"
                                    className="text-button"
                                    onClick={() => void submitAiRefine(paragraph.id)}
                                    disabled={busyParagraphId === paragraph.id}
                                  >
                                    {busyParagraphId === paragraph.id ? 'Refining...' : 'Apply AI Refine'}
                                  </button>
                                  <button
                                    type="button"
                                    className="text-button danger"
                                    onClick={cancelAiRefine}
                                    disabled={busyParagraphId === paragraph.id}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </>
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
                                activeSourceIdRef.current = source.id
                                setActiveSourceId(source.id)
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
                            {isSourcePreviewLoading ? <p className="hint">Loading webpage preview...</p> : null}
                            {!isSourcePreviewLoading && sourcePreviewError ? (
                              <p className="error">{sourcePreviewError}</p>
                            ) : null}

                            {!isSourcePreviewLoading && !sourcePreviewError ? (
                              <article className="source-preview-text" aria-label="Extracted webpage preview text">
                                <h4>{sourcePreviewTitle || activeSource.title}</h4>
                                <p>{sourcePreviewText || 'No preview text available for this source.'}</p>
                              </article>
                            ) : null}
                          </div>

                          <p className="hint mini-browser-note">
                            This preview is fetched by the backend to avoid iframe blocking and connection-refused issues.
                            If extraction fails, use "Open in full tab".
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
