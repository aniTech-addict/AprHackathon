import { useMemo, useState } from 'react'
import './App.css'
import { InputPage } from './pages/InputPage'
import { ClarityPage } from './pages/ClarityPage'
import { PlanningPage } from './pages/PlanningPage'
import { ReviewPage } from './pages/ReviewPage'
import type { Phase, StartResearchResponse } from './types'

function App() {
  const [currentPhase, setCurrentPhase] = useState<Phase>('input')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [planId, setPlanId] = useState<string | null>(null)
  const [initialFollowUpQuestions, setInitialFollowUpQuestions] = useState<string[]>([])
  const [initialClarityRound, setInitialClarityRound] = useState(1)
  const [_error, setError] = useState<string | null>(null)

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
    setCurrentPhase('review')
  }

  function handleError(errorMsg: string) {
    setError(errorMsg)
  }

  if (currentPhase === 'input') {
    return <InputPage apiBaseUrl={apiBaseUrl} onInputSubmit={handleInputSubmit} onError={handleError} />
  }

  if (currentPhase === 'clarity' && sessionId) {
    return (
      <ClarityPage
        apiBaseUrl={apiBaseUrl}
        sessionId={sessionId}
        initialFollowUpQuestions={initialFollowUpQuestions}
        initialClarityRound={initialClarityRound}
        onClarityComplete={handleClarityComplete}
        onError={handleError}
      />
    )
  }

  if (currentPhase === 'planning' && sessionId) {
    return (
      <PlanningPage
        apiBaseUrl={apiBaseUrl}
        sessionId={sessionId}
        onError={handleError}
        onPlanApproved={handlePlanApproved}
      />
    )
  }

  if (currentPhase === 'review' && sessionId) {
    return <ReviewPage apiBaseUrl={apiBaseUrl} sessionId={sessionId} planId={planId} onError={handleError} />
  }

  return null
}

export default App
