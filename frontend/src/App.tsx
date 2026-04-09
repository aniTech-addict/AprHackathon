import { useMemo, useState } from 'react'
import './App.css'
import { InputPage } from './pages/InputPage'
import { ClarityPage } from './pages/ClarityPage'
import { PlanningPage } from './pages/PlanningPage'
import type { Phase, StartResearchResponse } from './types'

function App() {
  const [currentPhase, setCurrentPhase] = useState<Phase>('input')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const apiBaseUrl = useMemo(
    () => import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000',
    [],
  )

  function handleInputSubmit(response: StartResearchResponse) {
    setSessionId(response.sessionId)
    setError(null)

    if (response.nextStep === 'ask_clarity_questions') {
      setCurrentPhase('clarity')
    } else {
      setCurrentPhase('planning')
    }
  }

  function handleClarityComplete() {
    setError(null)
    setCurrentPhase('planning')
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
        onClarityComplete={handleClarityComplete}
        onError={handleError}
      />
    )
  }

  if (currentPhase === 'planning' && sessionId) {
    return <PlanningPage apiBaseUrl={apiBaseUrl} sessionId={sessionId} onError={handleError} />
  }

  return null
}

export default App
