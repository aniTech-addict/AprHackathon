import { ReactNode, useEffect, useRef } from 'react'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
  actions?: ReactNode
  size?: 'small' | 'medium' | 'large'
  className?: string
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  actions,
  size = 'medium',
  className = ''
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<Element | null>(null)

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement
      modalRef.current?.focus()

      const handleEscape = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          onClose()
        }
      }

      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'

      return () => {
        document.removeEventListener('keydown', handleEscape)
        document.body.style.overflow = ''
        if (previousFocusRef.current instanceof HTMLElement) {
          previousFocusRef.current.focus()
        }
      }
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const sizeClasses = {
    small: 'modal-small',
    medium: 'modal-medium',
    large: 'modal-large'
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className={`modal-content ${sizeClasses[size]} ${className}`}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-header">
          <h2 id="modal-title" className="modal-title">{title}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          {children}
        </div>
        {actions && (
          <div className="modal-actions">
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}