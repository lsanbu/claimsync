'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ArrowLeft, Play, Loader2, CheckCircle2, XCircle,
  AlertTriangle, RefreshCw, Clock, Download, FileText,
  Activity, ChevronDown, ChevronUp, X, Search
} from 'lucide-react'
import RunFilesTab from '@/components/runs/RunFilesTab'
import RunIntervalsTab from '@/components/runs/RunIntervalsTab'
import { FileRecord, IntervalRecord } from '@/components/runs/types'

// -- Types --
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
}

// -- Helpers --
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: 'bg-emerald-100 text-emerald-700',
    running: 'bg-amber-100 text-amber-700',
    failed:  'bg-red-100 text-red-700',
    partial: 'bg-yellow-100 text-yellow-700',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
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

function defaultFrom(): string {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d.toISOString().slice(0, 10) + ' 00:00'
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10) + ' 23:59'
}

// -- Main Page --
export default function AdhocRunPage() {
  const router = useRouter()
  const params = useParams()
  const code = (params?.code as string || '').toUpperCase()

  const [fromDt, setFromDt]         = useState(defaultFrom)
  const [toDt, setToDt]             = useState(defaultTo)
  const [triggering, setTriggering] = useState(false)
  const [triggerMsg, setTriggerMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [runs, setRuns]             = useState<RunRecord[]>([])
  const [runsLoading, setRunsLoading] = useState(true)

  const [expandedRun, setExpandedRun] = useState<string | null>(null)
  const [activeTab, setActiveTab]     = useState<Record<string, 'files' | 'intervals'>>({})
  const [files, setFiles]             = useState<Record<string, FileRecord[]>>({})
  const [filesLoading, setFilesLoading] = useState<string | null>(null)
  const [intervals, setIntervals]     = useState<Record<string, IntervalRecord[]>>({})
  const [intervalsLoading, setIntervalsLoading] = useState<string | null>(null)

  const getToken = () => typeof window !== 'undefined' ? sessionStorage.getItem('cs_admin_token') : null

  // -- Load runs --
  const loadRuns = useCallback(async () => {
    const token = getToken()
    if (!token) { router.push('/admin/login'); return }
    setRunsLoading(true)
    try {
      const res = await fetch(`/api/claimssync/admin/facilities/${code}/runs`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.status === 401) { router.push('/admin/login'); return }
      if (!res.ok) return
      const data = await res.json()
      setRuns(data.runs ?? [])
    } catch { /* ignore */ }
    finally { setRunsLoading(false) }
  }, [code])

  // Auto-refresh every 30s
  useEffect(() => {
    loadRuns()
    const id = setInterval(loadRuns, 30000)
    return () => clearInterval(id)
  }, [loadRuns])

  // -- Trigger adhoc run --
  const handleTrigger = async () => {
    const token = getToken()
    if (!token) { router.push('/admin/login'); return }
    setTriggering(true); setTriggerMsg(null)
    try {
      const res = await fetch(`/api/claimssync/admin/facilities/${code}/adhoc-run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_datetime: fromDt, to_datetime: toDt }),
      })
      const data = await res.json()
      if (res.ok) {
        setTriggerMsg({ ok: true, text: data.message || 'Adhoc run triggered successfully' })
        setTimeout(loadRuns, 3000)
      } else {
        setTriggerMsg({ ok: false, text: data.detail || `Error (${res.status})` })
      }
    } catch (e: any) {
      setTriggerMsg({ ok: false, text: e.message })
    } finally {
      setTriggering(false)
    }
  }

  // -- Load files for a run --
  const loadFiles = async (runId: string) => {
    if (files[runId]) return
    const token = getToken()
    if (!token) return
    setFilesLoading(runId)
    try {
      const res = await fetch(`/api/claimssync/admin/facilities/${code}/runs/${runId}/files`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setFiles(prev => ({ ...prev, [runId]: data.files ?? [] }))
      }
    } catch { /* ignore */ }
    finally { setFilesLoading(null) }
  }

  // -- Load intervals for a run --
  const loadIntervals = async (runId: string) => {
    if (intervals[runId]) return
    const token = getToken()
    if (!token) return
    setIntervalsLoading(runId)
    try {
      const res = await fetch(`/api/claimssync/admin/facilities/${code}/runs/${runId}/intervals`, {
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
    if (expandedRun === runId) {
      setExpandedRun(null)
    } else {
      setExpandedRun(runId)
      setActiveTab(prev => ({ ...prev, [runId]: prev[runId] || 'files' }))
      loadFiles(runId)
      loadIntervals(runId)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-blue-900 text-white px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
            <span className="text-blue-900 font-bold text-sm">CS</span>
          </div>
          <div>
            <span className="font-semibold">ClaimSync</span>
            <span className="text-blue-300 text-xs ml-2">&mdash; Admin Portal</span>
          </div>
        </div>
        <nav className="flex items-center gap-4 text-sm">
          <button onClick={() => router.push('/admin/dashboard')}  className="text-blue-200 hover:text-white">Dashboard</button>
          <button onClick={() => router.push('/admin/onboarding')} className="text-blue-200 hover:text-white">Onboarding</button>
          <button onClick={() => router.push('/admin/facilities')} className="text-blue-200 hover:text-white">Facilities</button>
        </nav>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">

        {/* Back + title */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/admin/facilities')}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 bg-white"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Facilities
            </button>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Adhoc Run &mdash; {code}</h1>
              <p className="text-xs text-gray-400">Trigger a manual sync for specific date range</p>
            </div>
          </div>
        </div>

        {/* SECTION A: Adhoc Run Form */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
              <Play className="w-4 h-4 text-blue-600" />
            </div>
            <h2 className="text-sm font-semibold text-gray-700">Trigger Adhoc Run</h2>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
              <input
                type="text"
                value={fromDt}
                onChange={e => setFromDt(e.target.value)}
                placeholder="YYYY-MM-DD HH:MM"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              <p className="text-xs text-gray-400 mt-0.5">YYYY-MM-DD or YYYY-MM-DD HH:MM</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
              <input
                type="text"
                value={toDt}
                onChange={e => setToDt(e.target.value)}
                placeholder="YYYY-MM-DD HH:MM"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
          </div>

          <button
            onClick={handleTrigger}
            disabled={triggering || !fromDt.trim() || !toDt.trim()}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
          >
            {triggering
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Triggering&hellip;</>
              : <><Play className="w-4 h-4" /> Run Now</>
            }
          </button>

          {triggerMsg && (
            <div className={`mt-3 text-xs rounded-lg px-4 py-3 flex items-center gap-2 ${
              triggerMsg.ok
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                : 'bg-red-50 border border-red-200 text-red-700'
            }`}>
              {triggerMsg.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
              {triggerMsg.text}
            </div>
          )}
        </div>

        {/* SECTION B: Run History */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-semibold text-gray-700">Run History</span>
              <span className="text-xs text-gray-400">(last 10 &middot; auto-refreshes)</span>
            </div>
            <button onClick={loadRuns} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          </div>

          {runsLoading && runs.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading runs&hellip;
            </div>
          ) : runs.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">No sync runs found for {code}</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {/* Header */}
              <div className="grid grid-cols-6 gap-3 px-5 py-2 text-xs font-medium text-gray-400 uppercase tracking-wide bg-gray-50">
                <div>Started</div>
                <div>From</div>
                <div>To</div>
                <div>Status</div>
                <div className="text-right">Files</div>
                <div className="text-right">Actions</div>
              </div>
              {runs.map(run => (
                <div key={run.run_id}>
                  <div className="grid grid-cols-6 gap-3 px-5 py-3 items-center hover:bg-gray-50 transition-colors">
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
                          onClick={() => toggleRun(run.run_id)}
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

                  {/* Expanded detail (tabs) */}
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
                          onClick={() => { setActiveTab(prev => ({ ...prev, [run.run_id]: 'intervals' })); loadIntervals(run.run_id) }}
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
                          facilityCode={code}
                          runId={run.run_id}
                        />
                      )}

                      {/* Intervals tab */}
                      {activeTab[run.run_id] === 'intervals' && (
                        <RunIntervalsTab
                          intervals={intervals[run.run_id] || []}
                          loading={intervalsLoading === run.run_id}
                          facilityCode={code}
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
      </div>
    </div>
  )
}
