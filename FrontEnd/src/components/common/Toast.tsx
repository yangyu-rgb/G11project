import { CircleCheck, CircleX, X } from 'lucide-react'
import { useEffect } from 'react'

type ToastProps = {
  message: string
  tone?: 'success' | 'error'
  onDismiss: () => void
}

export function Toast({ message, tone = 'success', onDismiss }: ToastProps) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 4000)
    return () => window.clearTimeout(timer)
  }, [message, onDismiss])

  const Icon = tone === 'success' ? CircleCheck : CircleX
  return (
    <div className={`toast toast--${tone}`} role="status" aria-live="polite">
      <Icon size={18} aria-hidden="true" />
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="关闭提示"><X size={18} /></button>
    </div>
  )
}
