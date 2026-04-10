import { useMemo, useState } from 'react'
import './App.css'
import { InputPage } from './pages/InputPage'
import { ClarityPage } from './pages/ClarityPage'
import { PlanningPage } from './pages/PlanningPage'
import { ReviewPage } from './pages/ReviewPage'
import { SessionSidebar } from './components/SessionSidebar'
import type { Phase, StartResearchResponse } from './types'

function App() {
  const [currentPhase, setCurrentPhase] = useState<Phase>('input')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [planId, setPlanId] = useState<string | null>(null)
  const [initialFollowUpQuestions, setInitialFollowUpQuestions] = useState<string[]>([])
  const [initialClarityRound, setInitialClarityRound] = useState(1)
  const [_error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [reviewHasGeneratedParagraphs, setReviewHasGeneratedParagraphs] = useState(false)
  const [reviewDraftMarkdown, setReviewDraftMarkdown] = useState('')
  const [reviewDraftLoading, setReviewDraftLoading] = useState(false)
  const [reviewDraftError, setReviewDraftError] = useState<string | null>(null)

  const apiBaseUrl = useMemo(
    () => import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000',
    [],
  )

  function handleInputSubmit(response: StartResearchResponse) {
    setSessionId(response.sessionId)
    setError(null)

    if (response.nextStep === 'ask_clarity_questions') {
      setInitialFollowUpQuestions(Array.isArray(response.followUpQuestions) ? response.followUpQuestions : [])
      setInitialClarityRound(response.clarityRound || 1)
      setCurrentPhase('clarity')
    } else {
      setInitialFollowUpQuestions([])
      setInitialClarityRound(1)
      setPlanId(null)
      setCurrentPhase('planning')
    }
  }

  function handleClarityComplete() {
    setError(null)
    setPlanId(null)
    setCurrentPhase('planning')
  }

  function handlePlanApproved(nextSessionId: string, nextPlanId: string) {
    setError(null)
    setSessionId(nextSessionId)
    setPlanId(nextPlanId)
    setReviewHasGeneratedParagraphs(false)
    setReviewDraftMarkdown('')
    setReviewDraftLoading(false)
    setReviewDraftError(null)
    setCurrentPhase('review')
  }

  function handleError(errorMsg: string) {
    setError(errorMsg)
  }

  function handleSessionSelect(selectedSessionId: string) {
    setSessionId(selectedSessionId)
    setPlanId(null)
    setReviewHasGeneratedParagraphs(false)
    setReviewDraftMarkdown('')
    setReviewDraftLoading(false)
    setReviewDraftError(null)
    setCurrentPhase('input')
    setSidebarOpen(false)
  }

  // Determine the current content to render
  let content = null

  if (currentPhase === 'input') {
    content = <InputPage apiBaseUrl={apiBaseUrl} onInputSubmit={handleInputSubmit} onError={handleError} />
  } else if (currentPhase === 'clarity' && sessionId) {
    content = (
      <ClarityPage
        apiBaseUrl={apiBaseUrl}
        sessionId={sessionId}
        initialFollowUpQuestions={initialFollowUpQuestions}
        initialClarityRound={initialClarityRound}
        onClarityComplete={handleClarityComplete}
        onError={handleError}
      />
    )
  } else if (currentPhase === 'planning' && sessionId) {
    content = (
      <PlanningPage
        apiBaseUrl={apiBaseUrl}
        sessionId={sessionId}
        onError={handleError}
        onPlanApproved={handlePlanApproved}
      />
    )
  } else if (currentPhase === 'review' && sessionId) {
    content = (
      <ReviewPage
        apiBaseUrl={apiBaseUrl}
        sessionId={sessionId}
        planId={planId}
        onError={handleError}
        onParagraphGenerationStateChange={setReviewHasGeneratedParagraphs}
        onApprovedDraftMarkdownChange={setReviewDraftMarkdown}
        onApprovedDraftLoadingChange={setReviewDraftLoading}
        onApprovedDraftErrorChange={setReviewDraftError}
      />
    )
  }

  const showSidebar = currentPhase !== 'review' || reviewHasGeneratedParagraphs

  return (
    <>
      {showSidebar ? (
        <SessionSidebar
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          mode={currentPhase === 'review' ? 'markdown' : 'sessions'}
          apiBaseUrl={apiBaseUrl}
          currentSessionId={sessionId}
          onSessionSelect={handleSessionSelect}
          markdownSessionId={currentPhase === 'review' ? sessionId : null}
          markdownPlanId={currentPhase === 'review' ? planId : null}
          markdownContent={currentPhase === 'review' ? reviewDraftMarkdown : undefined}
          markdownLoading={currentPhase === 'review' ? reviewDraftLoading : undefined}
          markdownError={currentPhase === 'review' ? reviewDraftError : undefined}
        />
      ) : null}
      {content}
    </>
  )
}

export default App
