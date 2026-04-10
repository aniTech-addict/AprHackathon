import { useEffect, useMemo, useState } from 'react'

interface AsyncProgressPanelProps {
  title: string
  description: string
  steps: string[]
  expectedSeconds?: number
  compact?: boolean
}

function formatElapsed(totalSeconds: number): string {
  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds}s`
}

export function AsyncProgressPanel({
  title,
  description,
  steps,
  expectedSeconds = 40,
  compact = false,
}: AsyncProgressPanelProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  useEffect(() => {
    const interval = window.setInterval(() => {
      setElapsedSeconds((previous) => previous + 1)
    }, 1000)

    return () => {
      window.clearInterval(interval)
    }
  }, [])

  const activeStepIndex = useMemo(() => {
    if (steps.length === 0) {
      return 0
    }

    if (elapsedSeconds < 4) {
      return 0
    }

    const progress = Math.min(1, elapsedSeconds / Math.max(expectedSeconds, 1))
    return Math.min(steps.length - 1, Math.floor(progress * steps.length))
  }, [elapsedSeconds, expectedSeconds, steps.length])

  return (
    <section className={`async-progress-panel ${compact ? 'is-compact' : ''}`.trim()} aria-live="polite">
      <div className="async-progress-head">
        <h3>{title}</h3>
        <span className="async-progress-time">{formatElapsed(elapsedSeconds)}</span>
      </div>
      <p className="hint async-progress-description">{description}</p>
      <div className="async-progress-track" role="progressbar" aria-valuetext="Processing request">
        <div className="async-progress-fill" />
      </div>
      {steps.length > 0 ? (
        <ul className="async-progress-steps">
          {steps.map((step, index) => {
            const statusClass = index < activeStepIndex ? 'is-done' : index === activeStepIndex ? 'is-active' : ''
            return (
              <li key={`${step}-${index}`} className={statusClass}>
                <span className="async-step-dot" aria-hidden="true" />
                {step}
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
