import type { Job } from '../types'
export const localJobs = new Map<string, Job & { output?: string; controller?: AbortController }>()
export function disposeJob(id: string) {
  const job = localJobs.get(id)
  job?.controller?.abort()
  if (job?.output) URL.revokeObjectURL(job.output)
  localJobs.delete(id)
}
export function localVideoUrl(path: string) {
  const id = /^\/api\/jobs\/([^/]+)\/video$/.exec(path)?.[1]
  return id ? localJobs.get(id)?.output || '' : ''
}
