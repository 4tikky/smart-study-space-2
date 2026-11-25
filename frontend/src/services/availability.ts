import type { Availability, Camera, Floor, FloorConfig, Occupancy, Settings, Summary, ZoneConfig } from '../types'
import { aggregate } from './vision/core'

export type Report = Summary & { camera_id: number; observed_at: string; expires_at: string }
export type Snapshot = { server_now: string; floors: FloorConfig[]; zones: ZoneConfig[]; cameras: Camera[]; reports: Report[]; settings: Settings }
export function buildOccupancy(snapshot: Snapshot, requestStarted = Date.now()): Occupancy & { valid_until?: string } {
  const now = Date.parse(snapshot.server_now)
  const reportById = new Map(snapshot.reports.filter(report => Date.parse(report.expires_at) > now).map(report => [report.camera_id, report]))
  const available = (summary: Summary | null): Availability => summary?.occupancy == null ? 'unavailable'
    : summary.occupancy * 100 >= snapshot.settings.full_at ? 'full' : summary.occupancy * 100 >= snapshot.settings.limited_at ? 'limited' : 'plenty'
  const expiries: string[] = []
  const floors: Floor[] = snapshot.floors.filter(floor => floor.enabled).map(floor => {
    const cameras = snapshot.cameras.filter(camera => camera.enabled && camera.floor_id === floor.id)
    const hasZones = cameras.some(camera => camera.zone_id != null)
    const contributing = cameras.filter(camera => !hasZones || camera.zone_id != null).flatMap(camera => reportById.get(camera.id) || [])
    const reports = cameras.flatMap(camera => reportById.get(camera.id) || [])
    expiries.push(...reports.map(report => report.expires_at))
    const summary = aggregate(contributing)
    return { ...floor, summary, status: available(summary), connection: contributing.length ? 'online' : cameras.length ? 'offline' : 'unconfigured',
      last_updated: contributing.map(item => item.observed_at).sort().at(-1) || null,
      active_sources: reports.length, configured_sources: cameras.length, reporting_scopes: contributing.length,
      configured_scopes: cameras.filter(camera => !hasZones || camera.zone_id != null).length,
      zones: snapshot.zones.filter(zone => zone.floor_id === floor.id).map(zone => {
        const camera = cameras.find(camera => camera.zone_id === zone.id), report = camera && reportById.get(camera.id)
        return { ...zone, summary: report || null, connection: report ? 'online' : camera ? 'offline' : 'unconfigured', last_updated: report?.observed_at || null }
      }) }
  })
  const summary = aggregate(floors.flatMap(floor => floor.summary || []))
  // Translate the server expiry to the browser's clock, which may be inaccurate.
  const firstExpiry = expiries.sort()[0]
  return { summary, status: available(summary), floors, active_sources: floors.reduce((sum, floor) => sum + floor.active_sources, 0),
    monitored_floors: floors.filter(floor => floor.summary != null).length,
    last_updated: floors.flatMap(floor => floor.last_updated || []).sort().at(-1) || null,
    valid_until: firstExpiry ? new Date(requestStarted + Math.max(0, Date.parse(firstExpiry) - now)).toISOString() : undefined }
}
