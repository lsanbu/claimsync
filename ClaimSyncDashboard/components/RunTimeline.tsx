'use client'
import { useState, useCallback } from 'react'
import { RunSummary, FileRecord, apiFetch, fmtDate, fmtDuration, statusColor, statusLabel, parsePayer } from '@/lib/api'
import {
  ChevronDown, ChevronRight, ServerCrash, CheckCircle2,
  Loader2, AlertTriangle, FileText, RefreshCw, KeyRound
} from 'lucide-react'

interface Props { runs: RunSummary[] }

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'success':              return <CheckCircle2  className="w-4 h-4 text-emerald-500" />
    case 'failed':               return <ServerCrash   className="w-4 h-4 text-red-500" />
    case 'running':              return <Loader2       className="w-4 h-4 text-blue-500 animate-spin" />
    case 'auth_failed':          return <KeyRound      className="w-4 h-4 text-red-600" />
    case 'skipped_auth_failed':  return <KeyRound      className="w-4 h-4 text-amber-600" />
    default:                     return <AlertTriangle className="w-4 h-4 text-amber-500" />
  }
}

function FileTypePill({ type }: { type: string }) {
  const color =
    type === 'claims'       ? 'bg-blue-100 text-blue-700' :
    type === 'remittance'   ? 'bg-purple-100 text-purple-700' :
    type === 'resubmission' ? 'bg-amber-100 text-amber-700' :
                              'bg-gray-100 text-gray-600'
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium capitalize ${color}`}>
      {type}
    </span>
  )
}

function RunFiles({ runId }: { runId: string }) {
  const [files, setFiles]   = useState<FileRecord[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const loadFiles = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch<{ items: FileRecord[]; total: number }>(
        'files', { run_id: runId, limit: 100, offset: 0 }
      )
      setFiles(data.items)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [runId])

  // Auto-load on mount
  if (files === null && !loading && !error) {
    loadFiles()
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400 py-3 px-4">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading files…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-xs text-red-500 py-3 px-4">
        <AlertTriangle className="w-3.5 h-3.5" />
        {error}
        <button onClick={loadFiles} className="underline ml-1">Retry</button>
      </div>
    )
  }

  if (!files || files.length === 0) {
    return (
      <div className="text-xs text-gray-400 py-3 px-4 italic">
        No files recorded for this run.
      </div>
    )
  }

  // Group by type
  const grouped = files.reduce((acc, f) => {
    const key = f.file_type || 'unknown'
    if (!acc[key]) acc[key] = []
    acc[key].push(f)
    return acc
  }, {} as Record<string, FileRecord[]>)

  const typeOrder = ['claims', 'resubmission', 'remittance', 'unknown']

  return (
    <div className="space-y-3 px-4 pb-3">
      {/* Summary pills */}
      <div className="flex flex-wrap gap-2 text-xs">
        {Object.entries(grouped).map(([type, items]) => (
          <span key={type} className="flex items-center gap-1">
            <FileTypePill type={type} />
            <span className="text-gray-500">{items.length}</span>
          </span>
        ))}
        <button
          onClick={loadFiles}
          className="ml-auto text-gray-400 hover:text-gray-600 transition-colors"
          title="Refresh files"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {/* File list by type */}
      {typeOrder.filter(t => grouped[t]).map(type => (
        <div key={type}>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
            {type} ({grouped[type].length})
          </div>
          <div className="space-y-1">
            {grouped[type].map((file, i) => (
              <div
                key={file.file_id}
                className="flex items-center gap-2 bg-white rounded-lg border border-gray-100 px-3 py-1.5 text-xs"
              >
                <FileText className="w-3 h-3 text-gray-300 shrink-0" />
                <span className="font-mono text-gray-700 truncate flex-1" title={file.file_name}>
                  {file.file_name}
                </span>
                <span className="text-gray-400 shrink-0 hidden sm:inline">
                  {parsePayer(file.file_name)}
                </span>
                {file.is_duplicate
                  ? <span className="shrink-0 text-amber-500 text-xs font-medium">DUP</span>
                  : <span className="shrink-0 w-2 h-2 rounded-full bg-emerald-400 inline-block" />}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function RunTimeline({ runs }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (!runs.length) {
    return <div className="text-center text-gray-400 py-12 text-sm">No runs found.</div>
  }

  return (
    <div className="space-y-2">
      {runs.map((run) => {
        const isOpen = expanded === run.run_id
        const completionPct = run.intervals_total > 0
          ? Math.round((run.intervals_completed / run.intervals_total) * 100)
          : 0

        return (
          <div key={run.run_id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Row header */}
            <button
              onClick={() => setExpanded(isOpen ? null : run.run_id)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
            >
              <StatusIcon status={run.status} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${statusColor(run.status)}`}>
                    {statusLabel(run.status)}
                  </span>
                  <span className="text-xs text-gray-500">{fmtDate(run.started_at)}</span>
                  <span className="text-xs text-gray-400 hidden sm:inline">· {run.trigger_type}</span>
                </div>
                <div className="text-xs text-gray-400 mt-0.5 truncate">{run.run_id}</div>
              </div>

              <div className="text-right shrink-0 hidden sm:block">
                <div className="text-sm font-semibold text-gray-700">
                  {run.files_downloaded > 0
                    ? `${run.files_downloaded} files`
                    : <span className="text-gray-400">0 files</span>}
                </div>
                <div className="text-xs text-gray-400">{fmtDuration(run.duration_seconds)}</div>
              </div>

              {isOpen
                ? <ChevronDown  className="w-4 h-4 text-gray-400 shrink-0" />
                : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
            </button>

            {/* Expanded detail */}
            {isOpen && (
              <div className="border-t border-gray-100">
                {/* Stats row */}
                <div className="bg-gray-50 px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                  <div>
                    <div className="text-gray-400 mb-0.5">Search window</div>
                    <div className="font-medium text-gray-700">
                      {run.search_from_date?.slice(0, 10)} → {run.search_to_date?.slice(0, 10)}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-400 mb-0.5">Intervals</div>
                    <div className="font-medium text-gray-700">
                      {run.intervals_completed}/{run.intervals_total}
                      <span className="text-gray-400 ml-1">({completionPct}%)</span>
                    </div>
                    <div className="mt-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${run.status === 'success' ? 'bg-emerald-400' : 'bg-brand-400'}`}
                        style={{ width: `${completionPct}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-400 mb-0.5">Files skipped</div>
                    <div className="font-medium text-gray-700">{run.files_skipped}</div>
                  </div>
                  <div>
                    <div className="text-gray-400 mb-0.5">Engine · Host</div>
                    <div className="font-medium text-gray-700 truncate">
                      v{run.engine_version} · {run.host_name?.slice(0, 20) ?? '—'}
                    </div>
                  </div>
                  {run.error_message && (
                    <div className="col-span-2 sm:col-span-4 text-red-600 bg-red-50 rounded px-2 py-1">
                      {run.error_message}
                    </div>
                  )}
                </div>

                {/* Files section */}
                {run.files_downloaded > 0 && (
                  <div className="border-t border-gray-100">
                    <div className="px-4 pt-3 pb-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Downloaded Files ({run.files_downloaded})
                    </div>
                    <RunFiles runId={run.run_id} />
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
