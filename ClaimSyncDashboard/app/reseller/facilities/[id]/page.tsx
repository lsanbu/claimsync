'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ArrowLeft, RefreshCw, Loader2, CheckCircle2,
  Building2, AlertTriangle, Calendar, Download,
  Activity, BarChart2, FileText, Cpu, Play
} from 'lucide-react'

// ── Types matching actual API response ─────────────────────────────────────────
interface RunRecord {
  run_id:               string
  started_at:           string
  ended_at:             string | null
  status:               string
  files_downloaded:     number
  intervals_completed:  number
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

// ── Helpers ────────────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    success:  'bg-emerald-100 text-emerald-700',
    failed:   'bg-red-100 text-red-700',
    running:  'bg-blue-100 text-blue-700',
    active:   'bg-emerald-100 text-emerald-700',
    inactive: 'bg-gray-100 text-gray-500',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
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

function fmtDate(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

function fmtDuration(start: string, end: string | null) {
  if (!end) return '—'
  const sec = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000)
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m ${sec % 60}s`
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function ResellerFacilityDetailPage() {
  const router     = useRouter()
  const params     = useParams()
  const facilityId = params?.id as string

  const [facility, setFacility] = useState<FacilityDetail | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [user,     setUser]     = useState<any>(null)

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
      setFacility(await res.json())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [facilityId])

  useEffect(() => {
    const u = typeof window !== 'undefined' ? sessionStorage.getItem('cs_user') : null
    if (u) setUser(JSON.parse(u))
    load()
  }, [load])

  // ── Derived stats ──────────────────────────────────────────────────────────
  const runs         = facility?.recent_runs ?? []
  const totalFiles   = runs.reduce((s, r) => s + (r.files_downloaded ?? 0), 0)
  const successCount = runs.filter(r => r.status === 'success').length
  const successRate  = runs.length > 0 ? Math.round((successCount / runs.length) * 100) : 100
  const lastRun      = runs[0] ?? null

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-blue-800 text-white px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
            <span className="text-blue-800 font-bold text-sm">CS</span>
          </div>
          <div>
            <span className="font-semibold">ClaimSync</span>
            <span className="text-blue-300 text-xs ml-2">— Reseller Portal</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <nav className="flex items-center gap-4 text-sm">
            <button onClick={() => router.push('/reseller/dashboard')}  className="text-blue-200 hover:text-white transition-colors">Dashboard</button>
            <button onClick={() => router.push('/reseller/onboarding')} className="text-blue-200 hover:text-white transition-colors">Requests</button>
          </nav>
          <button onClick={logout} className="text-xs text-blue-300 hover:text-white">Logout</button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">

        {/* Back */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/reseller/dashboard')}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 bg-white hover:bg-gray-50 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
          </button>
          <button
            onClick={load}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 bg-white hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          {facility && (
            <button
              onClick={() => router.push(`/admin/facilities/${facility.facility_code}/adhoc-run`)}
              className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded-lg px-3 py-1.5 bg-white hover:bg-blue-50 transition-colors"
            >
              <Play className="w-3.5 h-3.5" /> Run Adhoc
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
            {/* Facility header */}
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
                      {facility.tenant_name} · Lookback {facility.lookback_days} days
                    </div>
                  </div>
                </div>
                <div className="text-right text-xs text-gray-400">
                  <div>Last sync {fmtDate(lastRun?.started_at ?? null)}</div>
                  {lastRun && <div className="mt-0.5"><StatusBadge status={lastRun.status} /></div>}
                </div>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-4 gap-4">
              <StatCard
                icon={<Activity className="w-4 h-4 text-blue-600" />}
                bg="bg-blue-50"
                label="Total Runs"
                value={runs.length}
                sub="last 8 shown"
              />
              <StatCard
                icon={<Download className="w-4 h-4 text-emerald-600" />}
                bg="bg-emerald-50"
                label="Files Downloaded"
                value={totalFiles.toLocaleString()}
              />
              <StatCard
                icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                bg="bg-emerald-50"
                label="Success Rate"
                value={`${successRate}%`}
              />
              <StatCard
                icon={<Calendar className="w-4 h-4 text-gray-500" />}
                bg="bg-gray-50"
                label="Last Sync"
                value={lastRun ? new Date(lastRun.started_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'}
                sub={lastRun ? new Date(lastRun.started_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : undefined}
              />
            </div>

            {/* Run history table */}
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-semibold text-gray-700">Sync Run History</span>
                  <span className="text-xs text-gray-400">(recent {runs.length})</span>
                </div>
              </div>

              {runs.length === 0 ? (
                <div className="py-12 text-center">
                  <FileText className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">No sync runs yet</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  <div className="grid grid-cols-5 gap-4 px-5 py-2 text-xs font-medium text-gray-400 uppercase tracking-wide">
                    <div>Started</div>
                    <div>Status</div>
                    <div className="text-right">Files</div>
                    <div className="text-right">Intervals</div>
                    <div className="text-right">Duration</div>
                  </div>
                  {runs.map(run => (
                    <div key={run.run_id} className="grid grid-cols-5 gap-4 px-5 py-3 items-center hover:bg-gray-50 transition-colors">
                      <div className="text-xs text-gray-700">{fmtDate(run.started_at)}</div>
                      <div>
                        <StatusBadge status={run.status} />
                        <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                          <Cpu className="w-3 h-3" /> v{run.engine_version}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-semibold text-gray-800">{run.files_downloaded}</span>
                      </div>
                      <div className="text-right text-xs text-gray-500">{run.intervals_completed}</div>
                      <div className="text-right text-xs text-gray-500">{fmtDuration(run.started_at, run.ended_at)}</div>
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
