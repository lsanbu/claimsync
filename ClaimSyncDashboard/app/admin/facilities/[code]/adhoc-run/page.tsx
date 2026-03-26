'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ArrowLeft, Play, Loader2, CheckCircle2, XCircle,
  AlertTriangle, RefreshCw, Clock, Download, FileText,
  Activity, ChevronDown, ChevronUp, X, Search
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────
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

interface FileRecord {
  file_id:         string
  file_name:       string
  file_type:       string | null
  file_size_bytes: number | null
  blob_path:       string | null
  uploaded_at:     string | null
  created_at:      string
}

interface IntervalRecord {
  interval_index:   number
  type:             string
  from_time:        string | null
  to_time:          string | null
  files_found:      number | null
  request_blob:     string | null
  response_blob:    string | null
  request_exists:   boolean
  response_exists:  boolean
}

// ── Helpers ────────────────────────────────────────────────────────────────────
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
  if (!dt) return '—'
  return new Date(dt).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

function fmtDate(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtSize(bytes: number | null) {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function detectFileType(name: string): string {
  if (/^H/i.test(name)) return 'Claims'
  if (/^351/i.test(name)) return 'Remittance'
  if (/^RSB/i.test(name)) return 'Resubmission'
  return 'Other'
}

function defaultFrom(): string {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d.toISOString().slice(0, 10) + ' 00:00'
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10) + ' 23:59'
}

// ── Main Page ──────────────────────────────────────────────────────────────────
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
  const [fileFilter, setFileFilter]   = useState('')
  const [intervals, setIntervals]     = useState<Record<string, IntervalRecord[]>>({})
  const [intervalsLoading, setIntervalsLoading] = useState<string | null>(null)
  const [xmlViewer, setXmlViewer]     = useState<{ req: string; resp: string; idx: number; type: string } | null>(null)
  const [xmlLoading, setXmlLoading]   = useState(false)

  const getToken = () => typeof window !== 'undefined' ? sessionStorage.getItem('cs_admin_token') : null

  // ── Load runs ──────────────────────────────────────────────────────────
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

  // ── Trigger adhoc run ──────────────────────────────────────────────────
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
        setTimeout(loadRuns, 3000) // refresh runs after a short delay
      } else {
        setTriggerMsg({ ok: false, text: data.detail || `Error (${res.status})` })
      }
    } catch (e: any) {
      setTriggerMsg({ ok: false, text: e.message })
    } finally {
      setTriggering(false)
    }
  }

  // ── Load files for a run ───────────────────────────────────────────────
  const loadFiles = async (runId: string) => {
    if (files[runId]) { setExpandedRun(expandedRun === runId ? null : runId); return }
    const token = getToken()
    if (!token) return
    setFilesLoading(runId)
    setExpandedRun(runId)
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

  // ── Load intervals for a run ──────────────────────────────────────────
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

  // ── Load raw XML for viewer ─────────────────────────────────────────
  const loadXml = async (reqBlob: string | null, respBlob: string | null, idx: number, type: string) => {
    const token = getToken()
    if (!token) return
    setXmlLoading(true)
    let reqXml = '', respXml = ''
    try {
      if (reqBlob) {
        const fname = reqBlob.replace('search_history/', '')
        const r = await fetch(`/api/claimssync/admin/facilities/${code}/search-history/${fname}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (r.ok) reqXml = await r.text()
      }
      if (respBlob) {
        const fname = respBlob.replace('search_history/', '')
        const r = await fetch(`/api/claimssync/admin/facilities/${code}/search-history/${fname}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (r.ok) respXml = await r.text()
      }
    } catch { /* ignore */ }
    setXmlViewer({ req: reqXml, resp: respXml, idx, type })
    setXmlLoading(false)
  }

  // ── CSV export ─────────────────────────────────────────────────────────
  const exportCsv = (runId: string) => {
    const f = files[runId]
    if (!f?.length) return
    const header = 'Filename,File Type,Size,Uploaded At,Blob Path\n'
    const rows = f.map(r =>
      `"${r.file_name}","${detectFileType(r.file_name)}","${fmtSize(r.file_size_bytes)}","${fmtDt(r.uploaded_at)}","${r.blob_path || ''}"`
    ).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${code}_run_${runId.slice(0, 8)}_files.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const isSuperAdmin = (() => {
    try {
      const u = typeof window !== 'undefined' ? sessionStorage.getItem('cs_admin_user') : null
      return u ? JSON.parse(u).is_super_admin === true : false
    } catch { return false }
  })()

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
            <span className="text-blue-300 text-xs ml-2">— Admin Portal</span>
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
              <h1 className="text-lg font-bold text-gray-900">Adhoc Run — {code}</h1>
              <p className="text-xs text-gray-400">Trigger a manual sync for specific date range</p>
            </div>
          </div>
        </div>

        {/* ── SECTION A: Adhoc Run Form ────────────────────────────────── */}
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
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Triggering…</>
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

        {/* ── SECTION B: Run History ───────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-semibold text-gray-700">Run History</span>
              <span className="text-xs text-gray-400">(last 10 · auto-refreshes)</span>
            </div>
            <button onClick={loadRuns} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          </div>

          {runsLoading && runs.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading runs…
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
                          onClick={() => {
                            if (expandedRun === run.run_id) {
                              setExpandedRun(null)
                            } else {
                              setExpandedRun(run.run_id)
                              setActiveTab(prev => ({ ...prev, [run.run_id]: prev[run.run_id] || 'files' }))
                              loadFiles(run.run_id)
                              loadIntervals(run.run_id)
                            }
                          }}
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

                  {/* ── SECTION C+D: Expanded detail (tabs) ──────────── */}
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
                        <>
                          {filesLoading === run.run_id ? (
                            <div className="py-6 text-center text-xs text-gray-400 flex items-center justify-center gap-2">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading files…
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center justify-between py-2">
                                <input
                                  type="text"
                                  placeholder="Filter files…"
                                  value={fileFilter}
                                  onChange={e => setFileFilter(e.target.value)}
                                  className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 w-56 focus:outline-none focus:ring-1 focus:ring-blue-300"
                                />
                                <button
                                  onClick={() => exportCsv(run.run_id)}
                                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded-lg px-3 py-1.5 bg-white"
                                >
                                  <Download className="w-3 h-3" /> Export CSV
                                </button>
                              </div>
                              <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                                <div className="grid grid-cols-5 gap-3 px-4 py-2 text-xs font-medium text-gray-400 uppercase bg-gray-50 border-b border-gray-200">
                                  <div className="col-span-2">Filename</div>
                                  <div>Type</div>
                                  <div>Size</div>
                                  <div>Uploaded</div>
                                </div>
                                <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
                                  {(files[run.run_id] || [])
                                    .filter(f => !fileFilter || f.file_name.toLowerCase().includes(fileFilter.toLowerCase()))
                                    .map(f => (
                                      <div key={f.file_id} className="grid grid-cols-5 gap-3 px-4 py-2 items-center text-xs">
                                        <div className="col-span-2 font-mono text-gray-700 truncate" title={f.file_name}>{f.file_name}</div>
                                        <div><span className={`px-1.5 py-0.5 rounded text-xs ${
                                          detectFileType(f.file_name) === 'Claims' ? 'bg-blue-50 text-blue-600' :
                                          detectFileType(f.file_name) === 'Remittance' ? 'bg-purple-50 text-purple-600' :
                                          detectFileType(f.file_name) === 'Resubmission' ? 'bg-amber-50 text-amber-600' :
                                          'bg-gray-50 text-gray-500'
                                        }`}>{detectFileType(f.file_name)}</span></div>
                                        <div className="text-gray-500">{fmtSize(f.file_size_bytes)}</div>
                                        <div className="text-gray-500">{fmtDt(f.uploaded_at)}</div>
                                      </div>
                                    ))}
                                  {(files[run.run_id] || []).length === 0 && (
                                    <div className="py-6 text-center text-xs text-gray-400">No files recorded</div>
                                  )}
                                </div>
                              </div>
                            </>
                          )}
                        </>
                      )}

                      {/* Intervals tab */}
                      {activeTab[run.run_id] === 'intervals' && (
                        <>
                          {intervalsLoading === run.run_id ? (
                            <div className="py-6 text-center text-xs text-gray-400 flex items-center justify-center gap-2">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading intervals…
                            </div>
                          ) : (intervals[run.run_id] || []).length === 0 ? (
                            <div className="py-8 text-center text-xs text-gray-400">
                              Interval detail not available for runs before engine v3.8
                            </div>
                          ) : (
                            <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                              <div className="grid grid-cols-7 gap-2 px-4 py-2 text-xs font-medium text-gray-400 uppercase bg-gray-50 border-b border-gray-200">
                                <div>#</div>
                                <div>Type</div>
                                <div>From</div>
                                <div>To</div>
                                <div>Files</div>
                                <div>Request</div>
                                <div>Response</div>
                              </div>
                              <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
                                {(intervals[run.run_id] || []).map((intv, i) => (
                                  <div key={`${intv.type}_${intv.interval_index}`} className={`grid grid-cols-7 gap-2 px-4 py-2 items-center text-xs ${
                                    intv.response_exists ? 'bg-white' : 'bg-gray-50'
                                  }`}>
                                    <div className="text-gray-600 font-mono">{intv.interval_index}</div>
                                    <div><span className={`px-1.5 py-0.5 rounded text-xs ${
                                      intv.type === 'claim' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'
                                    }`}>{intv.type}</span></div>
                                    <div className="text-gray-500">{intv.from_time || '—'}</div>
                                    <div className="text-gray-500">{intv.to_time || '—'}</div>
                                    <div className="text-gray-700 font-medium">{intv.files_found ?? '—'}</div>
                                    <div>{intv.request_exists
                                      ? <span className="text-emerald-600 text-xs">Ready</span>
                                      : <span className="text-gray-300 text-xs">—</span>
                                    }</div>
                                    <div className="flex items-center gap-2">
                                      {intv.response_exists
                                        ? <span className="text-emerald-600 text-xs">Ready</span>
                                        : <span className="text-gray-300 text-xs">—</span>
                                      }
                                      {(intv.request_exists || intv.response_exists) && (
                                        <button
                                          onClick={() => loadXml(intv.request_blob, intv.response_blob, intv.interval_index, intv.type)}
                                          className="text-xs text-blue-600 hover:text-blue-800 underline"
                                        >
                                          View
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── XML Viewer Modal ──────────────────────────────────────── */}
      {xmlViewer && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <div>
                <h3 className="text-sm font-semibold text-gray-700">
                  Interval {xmlViewer.idx} — {xmlViewer.type}
                </h3>
                <p className="text-xs text-gray-400">Search history request/response XML</p>
              </div>
              <button onClick={() => setXmlViewer(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            {xmlLoading ? (
              <div className="flex-1 flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : (
              <div className="flex-1 overflow-auto grid grid-cols-1 md:grid-cols-2 gap-0 divide-x divide-gray-200">
                <div className="flex flex-col">
                  <div className="px-4 py-2 bg-blue-50 border-b border-gray-200 text-xs font-medium text-blue-700">
                    Request XML (sent to Shafafiya)
                  </div>
                  <pre className="flex-1 p-4 text-xs text-gray-700 overflow-auto font-mono whitespace-pre-wrap break-all bg-gray-50">
                    {xmlViewer.req || '(not available)'}
                  </pre>
                </div>
                <div className="flex flex-col">
                  <div className="px-4 py-2 bg-emerald-50 border-b border-gray-200 text-xs font-medium text-emerald-700">
                    Response XML (from Shafafiya)
                  </div>
                  <pre className="flex-1 p-4 text-xs text-gray-700 overflow-auto font-mono whitespace-pre-wrap break-all bg-gray-50">
                    {xmlViewer.resp || '(not available)'}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
