import { useCallback, useEffect, useState } from 'react'
import { api } from '../services/api'

export function useData<T>(path: string | null, interval = 0, stopPolling?: (data: T) => boolean) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ path: string | null; data: T | null; error: string | null; loading: boolean }>({
    path: null, data: null, error: null, loading: true,
  })
  const refresh = useCallback(() => setRevision(old => old + 1), [])
  useEffect(() => {
    if (!path) return
    let timer = 0
    const controller = new AbortController()
    async function load() {
      let terminal = false
      try {
        const data = await api<T>(path!, { signal: controller.signal })
        terminal = stopPolling?.(data) ?? false
        if (!controller.signal.aborted) setState({ path, data, error: null, loading: false })
      } catch (error) {
        if (!controller.signal.aborted) setState({ path, data: null, error: (error as Error).message, loading: false })
      } finally {
        if (interval && !terminal && !controller.signal.aborted) timer = window.setTimeout(load, interval)
      }
    }
    void load()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [path, interval, revision, stopPolling])
  return state.path === path ? { ...state, refresh } : { data: null, error: null, loading: !!path, refresh }
}
