import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { AlertCircle, Armchair, CircleCheck, LoaderCircle, SearchX, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { createContext, forwardRef, useContext, useCallback, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../utils'

const button = cva('button', {
  variants: { variant: { primary: 'button-primary', outline: 'button-outline', ghost: 'button-ghost', danger: 'button-danger' },
    size: { normal: '', icon: 'button-icon', small: 'button-small' } },
  defaultVariants: { variant: 'primary', size: 'normal' },
})

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button> & { asChild?: boolean }>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Component = asChild ? Slot : 'button'
    return <Component ref={ref} className={cn(button({ variant, size }), className)} {...props} />
  },
)
Button.displayName = 'Button'

export function Logo() {
  return <span className="brand"><span className="brand-icon"><Armchair size={24} strokeWidth={1.9} /><i /></span>
    <span><strong>Smart Study Space</strong><small>Perpustakaan UNDIP</small></span></span>
}

export function PageTitle({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="page-title"><div><h1>{title}</h1><p>{description}</p></div>{action}</div>
}

export function Panel({ title, description, action, children, className }: {
  title?: string; description?: string; action?: ReactNode; children: ReactNode; className?: string
}) {
  return <section className={cn('panel', className)}>
    {title && <header className="panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</header>}
    {children}
  </section>
}

export function Empty({ title, detail, icon = <SearchX size={25} />, action }: {
  title: string; detail: string; icon?: ReactNode; action?: ReactNode
}) {
  return <div className="empty"><span className="empty-icon">{icon}</span><strong>{title}</strong><p>{detail}</p>{action}</div>
}

export function ErrorBox({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="error-box" role="alert"><AlertCircle size={19} /><span>{message}</span>
    {retry && <Button variant="outline" size="small" onClick={retry}>Coba lagi</Button>}</div>
}

export function Skeleton({ className }: { className?: string }) {
  return <div role="status" aria-label="Memuat data" className={cn('skeleton', className)} />
}

export function Spinner() { return <LoaderCircle size={17} className="spin" /> }

export function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{help && <small>{help}</small>}</label>
}

export function Toggle({ label, checked, set, disabled }: { label: string; checked: boolean; set: (value: boolean) => void; disabled?: boolean }) {
  return <label className="toggle"><input type="checkbox" checked={checked} onChange={e => set(e.target.checked)} disabled={disabled} /><span>{label}</span></label>
}

export function Modal({ open, onOpenChange, title, detail, children, wide }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; detail?: string; children: ReactNode; wide?: boolean
}) {
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal><DialogPrimitive.Overlay className="modal-overlay" />
      <DialogPrimitive.Content className={cn('modal', wide && 'modal-wide')}>
        <div className="modal-heading">
          <div><DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className={detail ? undefined : 'sr-only'}>{detail || title}</DialogPrimitive.Description></div>
          <DialogPrimitive.Close asChild><Button variant="ghost" size="icon" aria-label="Tutup"><X size={20} /></Button></DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}

const ToastContext = createContext<(message: string, error?: boolean) => void>(() => {})
export const useToast = () => useContext(ToastContext)
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string; error?: boolean }[]>([])
  const reduced = useReducedMotion()
  const notify = useCallback((message: string, error?: boolean) => {
    const id = Date.now() + Math.random()
    setToasts(list => [...list.slice(-2), { id, message, error }])
    window.setTimeout(() => setToasts(list => list.filter(item => item.id !== id)), 4500)
  }, [])
  return <ToastContext.Provider value={notify}>{children}<div className="toasts" aria-live="polite"><AnimatePresence>
    {toasts.map(item => <motion.div key={item.id} className={cn('toast', item.error && 'toast-error')}
      initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      {item.error ? <AlertCircle size={18} /> : <CircleCheck size={18} />}{item.message}</motion.div>)}
  </AnimatePresence></div></ToastContext.Provider>
}
