import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { useState } from 'react'

interface ResizableTwoColumnLayoutProps {
  left: ReactNode
  right: ReactNode
  initialLeftWidthPercent?: number
  minLeftWidthPercent?: number
  maxLeftWidthPercent?: number
  className?: string
}

export function ResizableTwoColumnLayout({
  left,
  right,
  initialLeftWidthPercent = 58,
  minLeftWidthPercent = 35,
  maxLeftWidthPercent = 75,
  className = '',
}: ResizableTwoColumnLayoutProps) {
  const [leftWidthPercent, setLeftWidthPercent] = useState(initialLeftWidthPercent)

  function clampWidth(value: number) {
    return Math.max(minLeftWidthPercent, Math.min(maxLeftWidthPercent, value))
  }

  function handleResizeStart(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault()
    const container = event.currentTarget.parentElement
    if (!container) return

    const rect = container.getBoundingClientRect()

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const cursorX = moveEvent.clientX - rect.left
      const nextWidth = (cursorX / rect.width) * 100
      setLeftWidthPercent(clampWidth(nextWidth))
    }

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  return (
    <div
      className={`resizable-two-col ${className}`.trim()}
      style={{
        gridTemplateColumns: `${leftWidthPercent}% 10px minmax(0, 1fr)`,
      }}
    >
      <div className="resizable-two-col-left">{left}</div>

      <div
        className="resizable-two-col-resizer"
        role="separator"
        aria-label="Resize columns"
        aria-orientation="vertical"
        onMouseDown={handleResizeStart}
        title="Drag to resize columns"
      />

      <aside className="resizable-two-col-right">{right}</aside>
    </div>
  )
}
