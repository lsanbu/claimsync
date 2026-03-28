'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Building2, Users, Clock, CheckCircle2, AlertTriangle,
  FileText, TrendingUp, RefreshCw, LogOut, Loader2,
  ChevronRight, Shield, ChevronDown, ChevronUp, Activity, Search, Play
} from 'lucide-react'
import RunFilesTab from '@/components/runs/RunFilesTab'
import RunIntervalsTab from '@/components/runs/RunIntervalsTab'
import { FileRecord, IntervalRecord } from '@/components/runs/types'

function StatCard({ label, value, sub, icon: Icon, color }: any) {
  const textColor = color.includes('blue') ? 'text-blue-600' : color.includes('emerald') ? 'text-emerald-600' : color.includes('amber') ? 'text-amber-600' : color.includes('red') ? 'text-red-600' : 'text-slate-700'
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500 uppercase tracking-wide">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className={`text-2xl font-bold mb-0.5 ${textColor}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    submitted: 'bg-amber-100 text-amber-700',
    reviewing: 'bg-blue-100 text-blue-700',
    approved:  'bg-emerald-100 text-emerald-700',
    rejected:  'bg-red-100 text-red-700',
    draft:     'bg-gray-100 text-gray-600',
    success:   'bg-emerald-100 text-emerald-700',
    running:   'bg-amber-100 text-amber-700',
    failed:    'bg-red-100 text-red-700',
    partial:   'bg-yellow-100 text-yellow-700',
  }
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${map[status] || 'bg-gray-100 text-gray-600'}`}>{status}</span>
}

function fmtDate(dt: string | null) {
  if (!dt) return '\u2014'
  return new Date(dt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtDt(dt: string | null) {
  if (!dt) return '\u2014'
  return new Date(dt).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

interface RunRecord {
  run_id:              string
  started_at:          string
  ended_at:            string | null
  status:              string
  files_downloaded:    number
  from_date:           string
  to_date:             string
  engine_version:      string
  intervals_total:     number
  intervals_completed: number
  trigger_type:        string
  facility_code:       string
  facility_name:       string
}

export default function AdminDashboardPage() {
  const router = useRouter()
  const [data,    setData]    = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [user,    setUser]    = useState<any>(null)

  // Run detail state
  const [expandedRun, setExpandedRun] = useState<string | null>(null)
  const [activeTab, setActiveTab]     = useState<Record<string, 'files' | 'intervals'>>({})
  const [files, setFiles]             = useState<Record<string, FileRecord[]>>({})
  const [filesLoading, setFilesLoading] = useState<string | null>(null)
  const [intervals, setIntervals]     = useState<Record<string, IntervalRecord[]>>({})
  const [intervalsLoading, setIntervalsLoading] = useState<string | null>(null)

  const getToken = () => sessionStorage.getItem('cs_admin_token')

  const logout = () => {
    sessionStorage.removeItem('cs_admin_token')
    sessionStorage.removeItem('cs_admin_user')
    router.push('/admin/login')
  }

  const load = useCallback(async () => {
    const token = getToken()
    if (!token) { router.push('/admin/login'); return }
    const u = sessionStorage.getItem('cs_admin_user')
    if (u) setUser(JSON.parse(u))
    setLoading(true)
    try {
      const res = await fetch('/api/claimssync/admin/dashboard', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.status === 401) { logout(); return }
      setData(await res.json())
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Load files for a run
  const loadFiles = async (runId: string, facilityCode: string) => {
    if (files[runId]) return
    const token = getToken()
    if (!token) return
    setFilesLoading(runId)
    try {
      const res = await fetch(`/api/claimssync/admin/facilities/${facilityCode}/runs/${runId}/files`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setFiles(prev => ({ ...prev, [runId]: data.files ?? [] }))
      }
    } catch { /* ignore */ }
    finally { setFilesLoading(null) }
  }

  // Load intervals for a run
  const loadIntervals = async (runId: string, facilityCode: string) => {
    if (intervals[runId]) return
    const token = getToken()
    if (!token) return
    setIntervalsLoading(runId)
    try {
      const res = await fetch(`/api/claimssync/admin/facilities/${facilityCode}/runs/${runId}/intervals`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setIntervals(prev => ({ ...prev, [runId]: data.intervals ?? [] }))
      }
    } catch { /* ignore */ }
    finally { setIntervalsLoading(null) }
  }

  const toggleRun = (run: RunRecord) => {
    if (expandedRun === run.run_id) {
      setExpandedRun(null)
    } else {
      setExpandedRun(run.run_id)
      setActiveTab(prev => ({ ...prev, [run.run_id]: prev[run.run_id] || 'files' }))
      loadFiles(run.run_id, run.facility_code)
      loadIntervals(run.run_id, run.facility_code)
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
    </div>
  )

  const s = data?.stats
  const runs: RunRecord[] = data?.recent_runs ?? []

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-slate-800 text-white px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
            <span className="text-slate-800 font-bold text-sm">CS</span>
          </div>
          <div>
            <span className="font-semibold">ClaimSync</span>
            <span className="text-slate-400 text-xs ml-2">&mdash; Admin Portal</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-300 text-sm">{user?.name}</span>
            {user?.is_super_admin && (
              <span className="text-xs bg-amber-500 text-white px-1.5 py-0.5 rounded font-medium">Super</span>
            )}
          </div>
          <button onClick={load} className="p-1.5 rounded-lg hover:bg-slate-700">
            <RefreshCw className="w-4 h-4 text-slate-400" />
          </button>
          <button onClick={logout} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </header>

      {/* Nav */}
      <nav className="bg-slate-700 px-6 flex gap-1 overflow-x-auto">
        {[
          { label: 'Dashboard',    href: '/admin/dashboard' },
          { label: 'Onboarding',   href: '/admin/onboarding' },
          { label: 'Resellers',    href: '/admin/resellers' },
          { label: 'Facilities',   href: '/admin/facilities' },
          { label: 'Adhoc Run',    href: '/admin/facilities' },
          { label: 'Revenue',      href: '/admin/revenue' },
          ...(user?.is_super_admin ? [{ label: 'Users', href: '/admin/users' }] : []),
        ].map(n => (
          <button key={n.label} onClick={() => router.push(n.href)}
            className={`text-xs px-3 py-2.5 whitespace-nowrap transition-colors
              ${typeof window !== 'undefined' && window.location.pathname === n.href && n.label !== 'Adhoc Run'
                ? 'text-white border-b-2 border-amber-400'
                : n.label === 'Adhoc Run'
                  ? 'text-blue-300 hover:text-white flex items-center gap-1'
                  : 'text-slate-400 hover:text-white'}`}>
            {n.label === 'Adhoc Run' && <Play className="w-3 h-3" />}
            {n.label}
          </button>
        ))}
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">

        <div>
          <h1 className="text-lg font-bold text-gray-900">Platform Overview</h1>
          <p className="text-xs text-gray-400">Kaaryaa GenAI Solutions &middot; ClaimSync</p>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total Facilities"  value={s?.total_facilities ?? 0}   icon={Building2}    color="bg-blue-50 text-blue-500" />
          <StatCard label="Active Facilities" value={s?.active_facilities ?? 0}   icon={CheckCircle2} color="bg-emerald-50 text-emerald-500" />
          <StatCard label="Pending Approvals" value={s?.pending_approvals ?? 0}   icon={Clock}        color="bg-amber-50 text-amber-500" sub="need review" />
          <StatCard label="Runs Today"        value={s?.runs_today ?? 0}           icon={TrendingUp}   color="bg-purple-50 text-purple-500" sub={`${s?.files_today ?? 0} files`} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatCard label="Active Resellers"  value={s?.active_resellers ?? 0}   icon={Users}        color="bg-slate-50 text-slate-500" />
          <StatCard label="Total Tenants"     value={s?.total_tenants ?? 0}       icon={Building2}    color="bg-indigo-50 text-indigo-500" />
          <StatCard label="Approved Total"    value={s?.approved_total ?? 0}      icon={FileText}     color="bg-teal-50 text-teal-500" />
        </div>

        {/* Pending approvals */}
        {(s?.pending_approvals ?? 0) > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-600" />
                <span className="text-sm font-semibold text-amber-700">
                  {s.pending_approvals} Request{s.pending_approvals > 1 ? 's' : ''} Awaiting Review
                </span>
              </div>
              <button onClick={() => router.push('/admin/onboarding')}
                className="text-xs text-amber-700 hover:underline flex items-center gap-1">
                Review all <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            <div className="space-y-2">
              {data?.recent_onboarding?.filter((r: any) => ['submitted','reviewing'].includes(r.status)).map((r: any) => (
                <div key={r.request_id}
                  className="flex items-center justify-between text-xs bg-white rounded-lg px-3 py-2 cursor-pointer hover:bg-amber-50 border border-amber-100"
                  onClick={() => router.push(`/admin/onboarding/${r.request_id}`)}>
                  <div>
                    <span className="font-semibold text-gray-800">{r.tenant_name}</span>
                    <span className="text-gray-400 ml-2">via {r.reseller_name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={r.status} />
                    <ChevronRight className="w-3 h-3 text-gray-300" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Sync Runs */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-600" />
              <h2 className="text-sm font-semibold text-gray-700">Recent Sync Runs</h2>
              <span className="text-xs text-gray-400">(all facilities)</span>
            </div>
            <button onClick={load} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          </div>

          {runs.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">No sync runs found</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {/* Header */}
              <div className="grid grid-cols-7 gap-3 px-5 py-2 text-xs font-medium text-gray-400 uppercase tracking-wide bg-gray-50">
                <div>Facility</div>
                <div>Started</div>
                <div>From</div>
                <div>To</div>
                <div>Status</div>
                <div className="text-right">Files</div>
                <div className="text-right">Actions</div>
              </div>
              {runs.map(run => (
                <div key={run.run_id}>
                  <div className="grid grid-cols-7 gap-3 px-5 py-3 items-center hover:bg-gray-50 transition-colors">
                    <div>
                      <span className="inline-block text-xs font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                        {run.facility_code}
                      </span>
                    </div>
                    <div className="text-xs text-gray-700">{fmtDt(run.started_at)}</div>
                    <div className="text-xs text-gray-500">{fmtDate(run.from_date)}</div>
                    <div className="text-xs text-gray-500">{fmtDate(run.to_date)}</div>
                    <div>
                      <StatusBadge status={run.status} />
                      {run.trigger_type === 'manual' && (
                        <span className="ml-1 text-xs text-blue-500">(adhoc)</span>
                      )}
                    </div>
                    <div className="text-right text-sm font-semibold text-gray-800">{run.files_downloaded}</div>
                    <div className="text-right">
                      {run.status === 'success' && (
                        <button
                          onClick={() => toggleRun(run)}
                          className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 ml-auto"
                        >
                          {expandedRun === run.run_id
                            ? <><ChevronUp className="w-3 h-3" /> Hide</>
                            : <><Search className="w-3 h-3" /> Details</>
                          }
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded detail (Files + Intervals tabs) */}
                  {expandedRun === run.run_id && (
                    <div className="px-5 pb-4 bg-gray-50 border-t border-gray-100">
                      {/* Tab bar */}
                      <div className="flex gap-1 pt-3 pb-2 border-b border-gray-200 mb-3">
                        <button
                          onClick={() => setActiveTab(prev => ({ ...prev, [run.run_id]: 'files' }))}
                          className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                            (activeTab[run.run_id] || 'files') === 'files'
                              ? 'bg-blue-600 text-white'
                              : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          Files ({(files[run.run_id] || []).length})
                        </button>
                        <button
                          onClick={() => { setActiveTab(prev => ({ ...prev, [run.run_id]: 'intervals' })); loadIntervals(run.run_id, run.facility_code) }}
                          className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                            activeTab[run.run_id] === 'intervals'
                              ? 'bg-blue-600 text-white'
                              : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          Intervals ({run.intervals_total})
                        </button>
                      </div>

                      {/* Files tab */}
                      {(activeTab[run.run_id] || 'files') === 'files' && (
                        <RunFilesTab
                          files={files[run.run_id] || []}
                          loading={filesLoading === run.run_id}
                          facilityCode={run.facility_code}
                          runId={run.run_id}
                        />
                      )}

                      {/* Intervals tab */}
                      {activeTab[run.run_id] === 'intervals' && (
                        <RunIntervalsTab
                          intervals={intervals[run.run_id] || []}
                          loading={intervalsLoading === run.run_id}
                          facilityCode={run.facility_code}
                          getToken={getToken}
                        />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent requests */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Recent Onboarding Requests</h2>
            <button onClick={() => router.push('/admin/onboarding')}
              className="text-xs text-blue-600 hover:underline flex items-center gap-1">
              View all <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="divide-y divide-gray-50">
            {data?.recent_onboarding?.length === 0 && (
              <div className="text-center text-gray-400 text-sm py-8">No onboarding requests yet</div>
            )}
            {data?.recent_onboarding?.map((r: any) => (
              <div key={r.request_id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer"
                onClick={() => router.push(`/admin/onboarding/${r.request_id}`)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-gray-800">{r.tenant_name}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {r.reseller_name} &middot; {fmtDate(r.created_at)}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
              </div>
            ))}
          </div>
        </div>

        {/* Expiring subscriptions */}
        {(data?.expiring_subscriptions?.length ?? 0) > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <h2 className="text-sm font-semibold text-gray-700">Expiring Subscriptions (30 days)</h2>
            </div>
            <div className="divide-y divide-gray-50">
              {data.expiring_subscriptions.map((f: any) => (
                <div key={f.facility_code} className="flex items-center justify-between px-4 py-2.5 text-xs">
                  <div>
                    <span className="font-medium text-gray-800">{f.facility_code}</span>
                    <span className="text-gray-400 ml-2">{f.tenant_name}</span>
                  </div>
                  <span className={`font-semibold ${f.days_remaining <= 7 ? 'text-red-600' : 'text-amber-600'}`}>
                    {f.days_remaining}d left
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>
    </div>
  )
}
