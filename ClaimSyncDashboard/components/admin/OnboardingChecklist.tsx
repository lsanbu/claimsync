'use client'

import { useState } from 'react'
import {
  CheckCircle2, Clock, Lock, ChevronDown, ChevronRight,
  Loader2, AlertTriangle, ListChecks
} from 'lucide-react'

export interface ChecklistStep {
  id:        number
  name:      string
  scope:     'request' | 'facility'
  auto:      boolean
  status:    'done' | 'pending' | 'locked'
  timestamp: string | null
  detail:    string | null
}

interface Props {
  requestId:   string
  steps:       ChecklistStep[]
  complete:    number
  total:       number
  readOnly?:   boolean
  onRefresh?:  () => void | Promise<void>
}

const MANUAL_STEP_KEYS: Record<number, 'pull_configured' | 'folders_created' | 'dry_run_verified'> = {
  6: 'pull_configured',
  7: 'folders_created',
  8: 'dry_run_verified',
}

function fmtDate(dt: string | null) {
  if (!dt) return null
  return new Date(dt).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

function StatusIcon({ status }: { status: ChecklistStep['status'] }) {
  if (status === 'done')   return <CheckCircle2 className="w-4 h-4 text-emerald-500" />
  if (status === 'locked') return <Lock         className="w-4 h-4 text-gray-300" />
  return                          <Clock        className="w-4 h-4 text-amber-500" />
}

export default function OnboardingChecklist({
  requestId, steps, complete, total, readOnly = false, onRefresh,
}: Props) {
  const [open,    setOpen]    = useState(false)
  const [busy,    setBusy]    = useState<number | null>(null)
  const [err,     setErr]     = useState<string | null>(null)

  const pct    = total > 0 ? Math.round((complete / total) * 100) : 0
  const isFull = complete === total && total > 0

  const getToken = () => {
    if (typeof window === 'undefined') return null
    return sessionStorage.getItem('cs_admin_token')
  }

  const toggleManualStep = async (step: ChecklistStep) => {
    if (readOnly) return
    const key = MANUAL_STEP_KEYS[step.id]
    if (!key) return
    const token = getToken()
    if (!token) return
    setBusy(step.id); setErr(null)
    try {
      const res = await fetch(`/api/claimssync/admin/onboarding/${requestId}/checklist`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ step: key, checked: step.status !== 'done' }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      if (onRefresh) await onRefresh()
    } catch (e: any) {
      setErr(e.message || 'Update failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header — always visible, click toggles */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
      >
        <ListChecks className="w-4 h-4 text-blue-600 shrink-0" />
        <span className="text-sm font-semibold text-gray-700">Onboarding Checklist</span>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium border
            ${isFull
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-slate-100 text-slate-700 border-slate-200'}`}
        >
          {complete} / {total} complete
        </span>
        {readOnly && (
          <span className="text-xs text-gray-400 italic">read-only</span>
        )}
        <span className="ml-auto text-gray-400">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
      </button>

      {/* Progress bar */}
      <div className="h-1 bg-gray-100">
        <div
          className={`h-full transition-all ${isFull ? 'bg-emerald-500' : 'bg-blue-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Body — collapsible */}
      {open && (
        <div className="divide-y divide-gray-100">
          {err && (
            <div className="bg-red-50 text-red-700 text-xs px-4 py-2 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {err}
            </div>
          )}
          {steps.map(step => {
            const manualKey  = MANUAL_STEP_KEYS[step.id]
            const isManual   = !step.auto && !!manualKey
            const isLoading  = busy === step.id
            const checked    = step.status === 'done'
            const ts         = fmtDate(step.timestamp)
            return (
              <div
                key={step.id}
                className={`flex items-start gap-3 px-4 py-3 ${step.status === 'locked' ? 'opacity-60' : ''}`}
              >
                <div className="pt-0.5 shrink-0">
                  <StatusIcon status={step.status} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-gray-400">Step {step.id}</span>
                    <span className="text-sm font-medium text-gray-800">{step.name}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wide
                        ${step.scope === 'facility'
                          ? 'bg-blue-50 text-blue-600 border border-blue-100'
                          : 'bg-gray-50 text-gray-500 border border-gray-100'}`}
                    >
                      {step.scope}
                    </span>
                    {isManual && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wide bg-amber-50 text-amber-600 border border-amber-100">
                        manual
                      </span>
                    )}
                  </div>
                  {(ts || step.detail) && (
                    <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
                      {ts && <span>{ts}</span>}
                      {ts && step.detail && <span className="text-gray-300">·</span>}
                      {step.detail && <span>{step.detail}</span>}
                    </div>
                  )}
                </div>
                {isManual && (
                  <div className="shrink-0 pt-0.5">
                    {isLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                    ) : (
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={readOnly}
                        onChange={() => toggleManualStep(step)}
                        className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-400 cursor-pointer disabled:cursor-not-allowed"
                      />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
