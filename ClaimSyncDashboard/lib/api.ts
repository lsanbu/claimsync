// lib/api.ts
// All calls go through /api/claimssync/* proxy — API key stays server-side

export const PROXY = '/api/claimssync'

export async function apiFetch<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T> {
  const url = new URL(`${PROXY}/${path}`, 'http://localhost')
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
    })
  }
  const res = await fetch(url.pathname + url.search, { cache: 'no-store' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

// ── Typed helpers ──────────────────────────────────────────────────────────────

export interface RunSummary {
  run_id: string
  facility_id: string
  trigger_type: string
  status: 'running' | 'success' | 'failed' | 'partial'
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  search_from_date: string
  search_to_date: string
  files_downloaded: number
  files_skipped: number
  files_duplicate: number
  intervals_completed: number
  intervals_total: number
  engine_version: string | null
  host_name: string | null
  error_message: string | null
}

export interface FileRecord {
  file_id: string
  run_id: string
  facility_id: string
  file_name: string
  file_type: string
  blob_path: string | null
  local_path: string | null
  is_duplicate: boolean
  downloaded_at: string
}

export interface StatsData {
  total_runs: number
  successful_runs: number
  failed_runs: number
  total_files_downloaded: number
  total_files_duplicate: number
  avg_duration_seconds: number | null
  last_run_at: string | null
  last_run_status: string | null
}

export interface PayerStat {
  payer: string
  file_count: number
  run_count: number
}

export interface Page<T> {
  total: number
  limit: number
  offset: number
  items: T[]
}

// Parse payer name from filename
// e.g. MF2618_H13238_OP_THIQA _120326... → "THIQA"
//      MF2618_H13238_OP_Aafiya TPA_120326... → "Aafiya TPA"
export function parsePayer(fileName: string): string {
  const parts = fileName.split('_')
  // Typical pattern: MF2618 _ facilityCode _ OP/IP _ PAYER _ date...
  if (parts.length >= 4) {
    const candidate = parts.slice(3, parts.length - 3).join('_').trim()
    if (candidate) return candidate
  }
  return 'Unknown'
}

export function fmtDuration(seconds: number | null): string {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-AE', {
    timeZone: 'Asia/Dubai',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function statusColor(status: string) {
  switch (status) {
    case 'success': return 'text-emerald-700 bg-emerald-50 border-emerald-200'
    case 'failed':  return 'text-red-700 bg-red-50 border-red-200'
    case 'running': return 'text-blue-700 bg-blue-50 border-blue-200'
    case 'partial': return 'text-amber-700 bg-amber-50 border-amber-200'
    default:        return 'text-gray-600 bg-gray-50 border-gray-200'
  }
}
