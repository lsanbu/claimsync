'use client'
import { useState, useEffect, useCallback } from 'react'
import { apiFetch, fmtDate, fmtDuration, statusColor } from '@/lib/api'
import {
  Settings, Play, RefreshCw, CheckCircle2, XCircle,
  Loader2, Clock, Calendar, Database, ChevronDown, ChevronUp
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Facility {
  facility_id: string
  facility_code: string
  facility_name: string
  status: string
  blob_container: string
  lookback_days: number
  interval_hours: number
  api_sleep_seconds: number
  kv_secret_prefix: string
  cron_expression: string
  schedule_active: boolean
  last_run: LastRun | null
}

interface LastRun {
  run_id: string
  status: string
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  files_downloaded: number
  files_skipped_existing: number
  intervals_completed: number
  search_from_date: string
  search_to_date: string
  error_message: string | null
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const color = status === 'success' ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
    : status === 'failed'  ? 'bg-red-100 text-red-700 border-red-200'
    : status === 'running' ? 'bg-blue-100 text-blue-700 border-blue-200'
    : 'bg-gray-100 text-gray-600 border-gray-200'
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border capitalize ${color}`}>
      {status}
    </span>
  )
}

function LastRunCard({ run }: { run: LastRun }) {
  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
      <div>
        <div className="text-gray-400 mb-0.5">Status</div>
        <StatusPill status={run.status} />
      </div>
      <div>
        <div className="text-gray-400 mb-0.5">Started</div>
        <div className="font-medium text-gray-700">{fmtDate(run.started_at)}</div>
      </div>
      <div>
        <div className="text-gray-400 mb-0.5">Duration</div>
        <div className="font-medium text-gray-700">{fmtDuration(run.duration_seconds)}</div>
      </div>
      <div>
        <div className="text-gray-400 mb-0.5">Files</div>
        <div className="font-medium text-gray-700">
          {run.files_downloaded} downloaded
          {run.files_skipped_existing > 0 &&
            <span className="text-gray-400 ml-1">· {run.files_skipped_existing} skipped</span>}
        </div>
      </div>
      <div>
        <div className="text-gray-400 mb-0.5">Search window</div>
        <div className="font-medium text-gray-700">
          {run.search_from_date?.slice(0,10)} → {run.search_to_date?.slice(0,10)}
        </div>
      </div>
      <div>
        <div className="text-gray-400 mb-0.5">Intervals</div>
        <div className="font-medium text-gray-700">{run.intervals_completed}</div>
      </div>
      {run.error_message && (
        <div className="col-span-2 sm:col-span-4 text-red-600 bg-red-50 rounded px-2 py-1">
          {run.error_message}
        </div>
      )}
    </div>
  )
}

// ── Main FacilityCard ──────────────────────────────────────────────────────────

function FacilityCard({ facility, onRefresh }: {
  facility: Facility
  onRefresh: () => void
}) {
  const [expanded, setExpanded]   = useState(false)
  const [saving,   setSaving]     = useState(false)
  const [running,  setRunning]    = useState(false)
  const [polling,  setPolling]    = useState(false)
  const [message,  setMessage]    = useState<{type:'ok'|'err', text:string} | null>(null)

  // Editable fields
  const [cron,      setCron]      = useState(facility.cron_expression || '0 2 * * *')
  const [lookback,  setLookback]  = useState(String(facility.lookback_days))
  const [fromDate,  setFromDate]  = useState('')
  const [toDate,    setToDate]    = useState('')

  const showMsg = (type: 'ok'|'err', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }

  // Save config
  const saveConfig = async () => {
    setSaving(true)
    try {
      await apiFetch(`facilities/${facility.facility_id}/config`, undefined)
      // Use PUT via fetch directly
      const res = await fetch(`/api/claimssync/facilities/${facility.facility_id}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cron_expression: cron,
          lookback_days: parseInt(lookback) || undefined,
        })
      })
      if (!res.ok) throw new Error(await res.text())
      showMsg('ok', 'Config saved ✓')
      onRefresh()
    } catch (e: any) {
      showMsg('err', `Save failed: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  // Trigger adhoc run
  const triggerRun = async () => {
    if (!fromDate || !toDate) {
      showMsg('err', 'Please set From and To dates')
      return
    }
    setRunning(true)
    try {
      const res = await fetch(`/api/claimssync/facilities/${facility.facility_id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_date: fromDate,
          to_date: toDate,
        })
      })
      if (!res.ok) throw new Error(await res.text())
      showMsg('ok', 'Run triggered — polling status…')
      setPolling(true)
      // Poll every 15s for up to 5 min
      let attempts = 0
      const interval = setInterval(async () => {
        attempts++
        try {
          const status = await apiFetch<any>(`facilities/${facility.facility_id}/run/status`)
          if (status.status === 'success' || status.status === 'failed') {
            clearInterval(interval)
            setPolling(false)
            showMsg(
              status.status === 'success' ? 'ok' : 'err',
              `Run ${status.status} — ${status.files_downloaded ?? 0} files downloaded`
            )
            onRefresh()
          }
        } catch {}
        if (attempts > 20) {
          clearInterval(interval)
          setPolling(false)
        }
      }, 15000)
    } catch (e: any) {
      showMsg('err', `Trigger failed: ${e.message}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-9 h-9 bg-brand-50 rounded-lg flex items-center justify-center shrink-0">
          <Database className="w-4 h-4 text-brand-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-800">{facility.facility_code}</span>
            <span className="text-xs text-gray-400">{facility.facility_name}</span>
            <StatusPill status={facility.status} />
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            Blob: {facility.blob_container} · KV: {facility.kv_secret_prefix}
          </div>
        </div>
        {/* Last run badge */}
        {facility.last_run && (
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            <StatusPill status={facility.last_run.status} />
            <span className="text-xs text-gray-400">
              {fmtDate(facility.last_run.started_at)}
            </span>
          </div>
        )}
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors shrink-0"
        >
          {expanded
            ? <ChevronUp className="w-4 h-4 text-gray-400" />
            : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-4 space-y-4">

          {/* Message bar */}
          {message && (
            <div className={`text-xs px-3 py-2 rounded-lg flex items-center gap-2 ${
              message.type === 'ok'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {message.type === 'ok'
                ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                : <XCircle className="w-3.5 h-3.5 shrink-0" />}
              {message.text}
            </div>
          )}

          {/* Last run */}
          {facility.last_run && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Last Run
              </h4>
              <LastRunCard run={facility.last_run} />
            </div>
          )}

          {/* Config section */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Settings className="w-3.5 h-3.5" /> Schedule & Config
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Cron Expression
                  <span className="ml-1 text-gray-400">(UTC)</span>
                </label>
                <input
                  value={cron}
                  onChange={e => setCron(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 font-mono bg-white focus:outline-none focus:ring-1 focus:ring-brand-300"
                  placeholder="0 2 * * *"
                />
                <div className="text-xs text-gray-400 mt-0.5">
                  Current: <span className="font-mono">{facility.cron_expression}</span>
                  {facility.cron_expression === '0 2 * * *' && ' — 06:00 UAE daily'}
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Lookback Days</label>
                <input
                  type="number"
                  value={lookback}
                  onChange={e => setLookback(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-brand-300"
                  min={1} max={365}
                />
              </div>
            </div>

            {/* Read-only params */}
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                { label: 'Interval Hours', value: facility.interval_hours },
                { label: 'API Sleep (s)',  value: facility.api_sleep_seconds },
                { label: 'Blob Container', value: facility.blob_container },
              ].map(p => (
                <div key={p.label} className="bg-gray-50 rounded-lg p-2">
                  <div className="text-xs text-gray-400">{p.label}</div>
                  <div className="text-xs font-medium text-gray-700 truncate">{p.value}</div>
                </div>
              ))}
            </div>

            <button
              onClick={saveConfig}
              disabled={saving}
              className="mt-3 flex items-center gap-1.5 text-xs bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              {saving
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <CheckCircle2 className="w-3.5 h-3.5" />}
              Save Config
            </button>
          </div>

          {/* Adhoc run section */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Play className="w-3.5 h-3.5" /> Adhoc Run
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  From Date <span className="text-gray-400">(DD/MM/YYYY HH:MM:SS)</span>
                </label>
                <input
                  value={fromDate}
                  onChange={e => setFromDate(e.target.value)}
                  placeholder="11/03/2026 00:00:00"
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 font-mono bg-white focus:outline-none focus:ring-1 focus:ring-brand-300"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  To Date <span className="text-gray-400">(DD/MM/YYYY HH:MM:SS)</span>
                </label>
                <input
                  value={toDate}
                  onChange={e => setToDate(e.target.value)}
                  placeholder="11/03/2026 23:59:59"
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 font-mono bg-white focus:outline-none focus:ring-1 focus:ring-brand-300"
                />
              </div>
            </div>

            <button
              onClick={triggerRun}
              disabled={running || polling}
              className="mt-3 flex items-center gap-1.5 text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {polling
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Polling…</>
                : running
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Triggering…</>
                : <><Play className="w-3.5 h-3.5" /> Run Now</>}
            </button>
            <p className="text-xs text-gray-400 mt-1.5">
              Triggers engine for the specified date range. Polling updates automatically.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function FacilityConfigPage() {
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<Facility[]>('facilities')
      setFacilities(data)
      setError(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Facility Config & Control</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            View parameters, update schedule, trigger adhoc runs
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading facilities…
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {!loading && facilities.map(f => (
        <FacilityCard key={f.facility_id} facility={f} onRefresh={load} />
      ))}
    </div>
  )
}
