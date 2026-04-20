'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ArrowLeft, RefreshCw, Loader2, CheckCircle2,
  Building2, AlertTriangle, Calendar, Download,
  Activity, BarChart2, FileText, Cpu, Play,
  ChevronUp, Search
} from 'lucide-react'
import RunFilesTab from '@/components/runs/RunFilesTab'
import RunIntervalsTab from '@/components/runs/RunIntervalsTab'
import { FileRecord, IntervalRecord } from '@/components/runs/types'
import CredentialAlertBanner from '@/components/CredentialAlertBanner'
import { statusLabel } from '@/lib/api'

interface RunRecord {
  run_id:               string
  started_at:           string
  ended_at:             string | null
  status:               string
  files_downloaded:     number
  from_date:            string
  to_date:              string
  intervals_total:      number
  intervals_completed:  number
  trigger_type:         string
  engine_version:       string
}

interface FacilityDetail {
  facility_id:      string
  facility_code:    string
  facility_name:    string
  status:           string
  blob_container:   string
  lookback_days:    number
  kv_secret_prefix: string
  tenant_name:      string
  recent_runs:      RunRecord[]
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    success:              'bg-emerald-100 text-emerald-700',
    failed:               'bg-red-100 text-red-700',
    running:              'bg-blue-100 text-blue-700',
    partial:              'bg-yellow-100 text-yellow-700',
    auth_failed:          'bg-red-100 text-red-700',
    skipped_auth_failed:  'bg-amber-100 text-amber-800',
    active:               'bg-emerald-100 text-emerald-700',
    inactive:             'bg-gray-100 text-gray-500',
  }
  // For the two v3.13 statuses, bypass `capitalize` so the label stays readable
  // ("Auth Failed" / "Skipped — Fix Credentials"); others keep the prior look.
  const useLabel = status === 'auth_failed' || status === 'skipped_auth_failed'
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${useLabel ? '' : 'capitalize'} ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {useLabel ? statusLabel(status) : status}
    </span>
  )
}

function StatCard({ icon, label, value, sub, bg }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; bg: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-3 ${bg}`}>{icon}</div>
      <div className="text-xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function fmtDt(dt: string | null) {
  if (!dt) return '\u2014'
  return new Date(dt).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

function fmtDate(dt: string | null) {
  if (!dt) return '\u2014'
  return new Date(dt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// v2.26: elapsed-duration formatter for run rows.
// endedAt=null → use `now` (live tick while status='running'); startedAt
// missing → em-dash. Output: "42s" / "4m 32s" / "1h 12m".
function fmtDuration(startedAt: string | null, endedAt: string | null, now: number): string {
  if (!startedAt) return '\u2014'
  const start = new Date(startedAt).getTime()
  const end   = endedAt ? new Date(endedAt).getTime() : now
  const sec   = Math.max(0, Math.floor((end - start) / 1000))
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}m ${sec % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export default function ResellerFacilityDetailPage() {
  const router     = useRouter()
  const params     = useParams()
  const facilityId = params?.id as string

  const [facility, setFacility] = useState<FacilityDetail | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  // Run detail state
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [expandedRun, setExpandedRun] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Record<string, 'files' | 'intervals'>>({})
  const [files, setFiles] = useState<Record<string, FileRecord[]>>({})
  const [filesLoading, setFilesLoading] = useState<string | null>(null)
  const [intervals, setIntervals] = useState<Record<string, IntervalRecord[]>>({})
  const [intervalsLoading, setIntervalsLoading] = useState<string | null>(null)

  const getToken = () => typeof window !== 'undefined' ? sessionStorage.getItem('cs_token') : null

  const logout = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('cs_token')
      sessionStorage.removeItem('cs_user')
    }
    router.push('/reseller/login')
  }

  const load = useCallback(async () => {
    const token = getToken()
    if (!token) { router.push('/reseller/login'); return }
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/claimssync/reseller/facilities/${facilityId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.status === 401) { logout(); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setFacility(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [facilityId])

  // Load runs separately using facility_code (once facility is loaded)
  const loadRuns = useCallback(async (code: string) => {
    const token = getToken()
    if (!token) return
    setRunsLoading(true)
    try {
      const res = await fetch(`/api/claimssync/reseller/facilities/${code}/runs`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setRuns(data.runs ?? [])
      }
    } catch { /* ignore */ }
    finally { setRunsLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!facility) return
    loadRuns(facility.facility_code)
    const id = setInterval(() => loadRuns(facility.facility_code), 30000)
    return () => clearInterval(id)
  }, [facility?.facility_code, loadRuns])

  // v2.26: 1s tick drives live Duration cell for status='running' rows.
  // Idles when no run is running so we don't burn a timer for nothing.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const hasRunning = runs.some(r => r.status === 'running')
    if (!hasRunning) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [runs])

  const loadFiles = async (runId: string, code: string) => {
    if (files[runId]) return
    const token = getToken()
    if (!token) return
    setFilesLoading(runId)
    try {
      const res = await fetch(`/api/claimssync/reseller/facilities/${code}/runs/${runId}/files`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setFiles(prev => ({ ...prev, [runId]: data.files ?? [] }))
      }
    } catch { /* ignore */ }
    finally { setFilesLoading(null) }
  }

  const loadIntervals = async (runId: string, code: string) => {
    if (intervals[runId]) return
    const token = getToken()
    if (!token) return
    setIntervalsLoading(runId)
    try {
      const res = await fetch(`/api/claimssync/reseller/facilities/${code}/runs/${runId}/intervals`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setIntervals(prev => ({ ...prev, [runId]: data.intervals ?? [] }))
      }
    } catch { /* ignore */ }
    finally { setIntervalsLoading(null) }
  }

  const toggleRun = (runId: string) => {
    if (!facility) return
    if (expandedRun === runId) {
      setExpandedRun(null)
    } else {
      setExpandedRun(runId)
      setActiveTab(prev => ({ ...prev, [runId]: prev[runId] || 'files' }))
      loadFiles(runId, facility.facility_code)
      loadIntervals(runId, facility.facility_code)
    }
  }

  const summaryRuns = facility?.recent_runs ?? []
  const totalFiles   = summaryRuns.reduce((s, r) => s + (r.files_downloaded ?? 0), 0)
  const successCount = summaryRuns.filter(r => r.status === 'success').length
  const successRate  = summaryRuns.length > 0 ? Math.round((successCount / summaryRuns.length) * 100) : 100
  const lastRun      = summaryRuns[0] ?? null

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-800 text-white px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
            <span className="text-blue-800 font-bold text-sm">CS</span>
          </div>
          <div>
            <span className="font-semibold">ClaimSync</span>
            <span className="text-blue-300 text-xs ml-2">&mdash; Reseller Portal</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <nav className="flex items-center gap-4 text-sm">
            <button onClick={() => router.push('/reseller/dashboard')}  className="text-blue-200 hover:text-white transition-colors">Dashboard</button>
            <button onClick={() => router.push('/reseller/facilities')} className="text-blue-200 hover:text-white transition-colors">Facilities</button>
            <button onClick={() => router.push('/reseller/onboarding')} className="text-blue-200 hover:text-white transition-colors">Requests</button>
          </nav>
          <button onClick={logout} className="text-xs text-blue-300 hover:text-white">Logout</button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center gap-2">
          <button onClick={() => router.push('/reseller/facilities')}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 bg-white hover:bg-gray-50 transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> Facilities
          </button>
          <button onClick={load}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 bg-white hover:bg-gray-50 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          {facility && (
            <button onClick={() => router.push(`/reseller/facilities/${facilityId}/adhoc-run`)}
              className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded-lg px-3 py-1.5 bg-white hover:bg-blue-50 transition-colors">
              <Play className="w-3.5 h-3.5" /> Adhoc Run
            </button>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-4 py-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {facility && (
          <>
            {/* v3.13: Credential-error banner when latest run is auth-blocked */}
            <CredentialAlertBanner status={lastRun?.status ?? null} />

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h1 className="text-base font-bold text-gray-900">{facility.facility_name}</h1>
                      <span className="text-xs font-mono text-gray-400">{facility.facility_code}</span>
                      <StatusBadge status={facility.status} />
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {facility.tenant_name} &middot; Lookback {facility.lookback_days} days
                    </div>
                  </div>
                </div>
                <div className="text-right text-xs text-gray-400">
                  <div>Last sync {fmtDt(lastRun?.started_at ?? null)}</div>
                  {lastRun && <div className="mt-0.5"><StatusBadge status={lastRun.status} /></div>}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4">
              <StatCard icon={<Activity className="w-4 h-4 text-blue-600" />} bg="bg-blue-50" label="Total Runs" value={summaryRuns.length} sub="last 10 shown" />
              <StatCard icon={<Download className="w-4 h-4 text-emerald-600" />} bg="bg-emerald-50" label="Files Downloaded" value={totalFiles.toLocaleString()} />
              <StatCard icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />} bg="bg-emerald-50" label="Success Rate" value={`${successRate}%`} />
              <StatCard icon={<Calendar className="w-4 h-4 text-gray-500" />} bg="bg-gray-50" label="Last Sync"
                value={lastRun ? new Date(lastRun.started_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '\u2014'}
                sub={lastRun ? new Date(lastRun.started_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : undefined} />
            </div>

            {/* Run history with expandable Files/Intervals tabs */}
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-semibold text-gray-700">Sync Run History</span>
                  <span className="text-xs text-gray-400">(auto-refreshes)</span>
                </div>
                <button onClick={() => facility && loadRuns(facility.facility_code)} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
              </div>

              {runsLoading && runs.length === 0 ? (
                <div className="py-12 text-center text-sm text-gray-400 flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading runs...
                </div>
              ) : runs.length === 0 ? (
                <div className="py-12 text-center">
                  <FileText className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">No sync runs yet</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  <div className="grid grid-cols-7 gap-3 px-5 py-2 text-xs font-medium text-gray-400 uppercase tracking-wide bg-gray-50">
                    <div>Started</div>
                    <div>From</div>
                    <div>To</div>
                    <div>Status</div>
                    <div>Duration</div>
                    <div className="text-right">Files</div>
                    <div className="text-right">Actions</div>
                  </div>
                  {runs.map(run => (
                    <div key={run.run_id}>
                      <div className="grid grid-cols-7 gap-3 px-5 py-3 items-center hover:bg-gray-50 transition-colors">
                        <div className="text-xs text-gray-700">{fmtDt(run.started_at)}</div>
                        <div className="text-xs text-gray-500">{fmtDate(run.from_date)}</div>
                        <div className="text-xs text-gray-500">{fmtDate(run.to_date)}</div>
                        <div>
                          <StatusBadge status={run.status} />
                          {run.trigger_type === 'manual' && <span className="ml-1 text-xs text-blue-500">(adhoc)</span>}
                        </div>
                        {/* v2.26: Duration = ended_at - started_at for completed rows,
                            live tick from `now` while status='running', em-dash if the
                            run stopped without writing ended_at (e.g. some failed runs). */}
                        <div className="text-xs text-gray-500 tabular-nums">
                          {run.status === 'running'
                            ? <span className="text-amber-600">{fmtDuration(run.started_at, null, now)}</span>
                            : run.ended_at
                              ? fmtDuration(run.started_at, run.ended_at, now)
                              : '\u2014'}
                        </div>
                        <div className="text-right text-sm font-semibold text-gray-800">{run.files_downloaded}</div>
                        <div className="text-right">
                          {run.status === 'success' && (
                            <button onClick={() => toggleRun(run.run_id)}
                              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 ml-auto">
                              {expandedRun === run.run_id
                                ? <><ChevronUp className="w-3 h-3" /> Hide</>
                                : <><Search className="w-3 h-3" /> Details</>}
                            </button>
                          )}
                        </div>
                      </div>

                      {expandedRun === run.run_id && (
                        <div className="px-5 pb-4 bg-gray-50 border-t border-gray-100">
                          <div className="flex gap-1 pt-3 pb-2 border-b border-gray-200 mb-3">
                            <button
                              onClick={() => setActiveTab(prev => ({ ...prev, [run.run_id]: 'files' }))}
                              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                                (activeTab[run.run_id] || 'files') === 'files'
                                  ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
                              }`}>
                              Files ({(files[run.run_id] || []).length})
                            </button>
                            <button
                              onClick={() => { setActiveTab(prev => ({ ...prev, [run.run_id]: 'intervals' })); loadIntervals(run.run_id, facility.facility_code) }}
                              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                                activeTab[run.run_id] === 'intervals'
                                  ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
                              }`}>
                              Intervals ({run.intervals_total})
                            </button>
                          </div>

                          {(activeTab[run.run_id] || 'files') === 'files' && (
                            <RunFilesTab files={files[run.run_id] || []} loading={filesLoading === run.run_id}
                              facilityCode={facility.facility_code} runId={run.run_id} />
                          )}
                          {activeTab[run.run_id] === 'intervals' && (
                            <RunIntervalsTab intervals={intervals[run.run_id] || []} loading={intervalsLoading === run.run_id}
                              facilityCode={facility.facility_code} getToken={getToken} apiPrefix="/api/claimssync/reseller" />
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
