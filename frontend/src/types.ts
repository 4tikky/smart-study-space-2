export type Summary = { total: number; empty: number; occupied: number; occupancy: number | null }
export type Availability = 'unavailable' | 'plenty' | 'limited' | 'full'
export type Connection = 'online' | 'offline' | 'unconfigured'
export type FloorConfig = { id: number; name: string; description: string; enabled: boolean }
export type ZoneConfig = {
  id: number; floor_id: number; name: string; description: string; outlets: number | null
  layout_row: number | null; layout_col: number | null
}
export type Zone = ZoneConfig & { summary: Summary | null; connection: Connection; last_updated: string | null }
export type Floor = FloorConfig & {
  summary: Summary | null; status: Availability; connection: Connection; last_updated: string | null
  active_sources: number; configured_sources: number; reporting_scopes: number; configured_scopes: number; zones: Zone[]
}
export type Camera = {
  id: number; name: string; kind: 'browser' | 'stream'; floor_id: number; zone_id: number | null
  interval_ms: number; enabled: boolean; busy: boolean
}
export type Settings = { limited_at: number; full_at: number; retention_days: number }
export type Configuration = { floors: FloorConfig[]; zones: ZoneConfig[]; cameras: Camera[]; settings: Settings }
export type Occupancy = {
  summary: Summary | null; status: Availability; floors: Floor[]; last_updated: string | null
  active_sources: number; monitored_floors: number
}
export type Operator = Occupancy & {
  preview: { name: string; timestamp: string; image: string } | null; last_detection: HistoryRecord | null
}
export type Detection = {
  id: number; kelas: 'EmptyChair' | 'OccupiedChair'; status: string; confidence: number
  x1: number; y1: number; x2: number; y2: number; track_id?: number
}
export type Prediction = {
  rows: Detection[]; summary: Summary; elapsed_ms: number; device: string; width: number; height: number
}
export type ImageResult = Prediction & { annotated: string; session_id: string; history_id: number }
export type VideoFrame = Summary & { frame: number; seconds: number; playback_seconds: number; elapsed_ms: number }
export type Job = {
  id: string; status: 'queued' | 'processing' | 'completed' | 'error'; progress: number
  latest?: VideoFrame; frames: VideoFrame[]; error?: string; processed_frames?: number; sample_every?: number
}
export type LiveFrame = Prediction & { smoothed: Summary; timestamp: string; fps: number | null; image?: string }
export type ModelStatus = 'ready' | 'loading' | 'error'
export type InferenceOptions = { confidence: number; resolution: number; device: 'cpu' | 'auto' }
export type HistoryRecord = Summary & {
  id: number; session_id: string; timestamp: string; source: 'image' | 'video' | 'live'
  floor_id: number | null; floor_name: string | null; zone_name: string | null
  camera_id: number | null; camera_name: string | null; elapsed_ms: number
}
export type MetadataKey = 'dataset_size' | 'train_size' | 'validation_size' | 'test_size' | 'epochs'
  | 'precision' | 'recall' | 'f1' | 'map50' | 'map5095'
export type Metadata = Record<MetadataKey, number | null> & { reference: string }
export type ModelInfo = { architecture: string; file: string; classes: string[]; status: ModelStatus; device: string | null
  defaults: InferenceOptions; metadata: Metadata }
export type AnalyticsPoint = { label: string; samples: number; occupancy: number | null; empty: number }
export type Analytics = { count: number; average: number | null; trend: AnalyticsPoint[]; floors: AnalyticsPoint[]
  hourly: AnalyticsPoint[]; daily: AnalyticsPoint[]; peak: AnalyticsPoint | null }
