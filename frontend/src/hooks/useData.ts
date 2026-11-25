import { useCallback, useEffect, useState } from 'react'
import { api } from '../services/api'
import { browserMode } from '../services/runtime'
import { subscribeDataChanged } from '../services/supabase'

export function useData<T>(path: string | null, interval = 0, stopPolling?: (data: T) => boolean) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ path: string | null; data: T | null; error: string | null; loading: boolean }>({
    path: null, data: null, error: null, loading: true,
  })
  const refresh = useCallback(() => setRevision(old => old + 1), [])
  useEffect(() => {
    if (browserMode && path && /^\/api\/(occupancy|floors|operator\/monitoring|configuration|cameras|settings|history|analytics)/.test(path)) return subscribeDataChanged(refresh)
  }, [path, refresh])
  useEffect(() => {
    if (!path) return
    let timer = 0
    let expiry = 0
    const controller = new AbortController()
    async function load() {
      let terminal = false
      try {
        const data = await api<T>(path!, { signal: controller.signal })
        terminal = stopPolling?.(data) ?? false
        if (!controller.signal.aborted) {
          clearTimeout(expiry)
          const validUntil = (data as { valid_until?: string })?.valid_until
          const remaining = validUntil ? Date.parse(validUntil) - Date.now() : Infinity
          if (remaining > 0) setState({ path, data, error: null, loading: false })
          if (Number.isFinite(remaining)) expiry = window.setTimeout(() => {
            if (controller.signal.aborted) return
            // Clear old data before the network refresh; a slow/offline request must
            // never leave expired counts visible as live availability.
            setState({ path, data: null, error: 'Data pemantauan kedaluwarsa. Menunggu pembaruan kamera.', loading: false })
            refresh()
          }, Math.max(0, remaining))
        }
      } catch (error) {
        if (!controller.signal.aborted) setState({ path, data: null, error: (error as Error).message, loading: false })
      } finally {
        const cadence = browserMode && !path!.startsWith('/api/jobs/') && path !== '/api/model/info' ? Math.max(interval, 15000) : interval
        if (interval && !terminal && !controller.signal.aborted) timer = window.setTimeout(load, cadence)
      }
    }
    void load()
    return () => { controller.abort(); clearTimeout(timer); clearTimeout(expiry) }
  }, [path, interval, revision, stopPolling, refresh])
  return state.path === path ? { ...state, refresh } : { data: null, error: null, loading: !!path, refresh }
}
