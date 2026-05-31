'use client'

import { useState } from 'react'
import { AlertTriangle, KeyRound, RefreshCw, CheckCircle2, Loader2 } from 'lucide-react'
import { isAuthBlocked } from '@/lib/api'

interface Props {
  status:             string | null | undefined
  facilityCode?:      string
  lastAuthFailedAt?:  string | null   // ISO datetime from tenant_facilities
  // Optional action callbacks — rendered as buttons when provided
  onResend?:          () => Promise<void>
  isAdmin?:           boolean
  onMarkResolved?:    () => Promise<void>
}

function fmtDt(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Shown above the facility overview when the latest run was auth_failed
// (red, downloads currently broken) or skipped_auth_failed (amber, scheduled
// runs are being skipped until credentials are updated).
//
// Renders nothing when status is fine — safe to drop in unconditionally.
// Pass onResend / onMarkResolved to show action buttons.
export default function CredentialAlertBanner({
  status,
  facilityCode,
  lastAuthFailedAt,
  onResend,
  isAdmin,
  onMarkResolved,
}: Props) {
  const [resending,  setResending]  = useState(false)
  const [resolving,  setResolving]  = useState(false)
  const [resendDone, setResendDone] = useState(false)
  const [resolveDone, setResolveDone] = useState(false)

  if (!isAuthBlocked(status)) return null

  const isHard = status === 'auth_failed'

  const handleResend = async () => {
    if (!onResend || resending) return
    setResending(true)
    try {
      await onResend()
      setResendDone(true)
    } finally {
      setResending(false)
    }
  }

  const handleResolve = async () => {
    if (!onMarkResolved || resolving) return
    setResolving(true)
    try {
      await onMarkResolved()
      setResolveDone(true)
    } finally {
      setResolving(false)
    }
  }

  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        isHard
          ? 'bg-red-50 border-red-200 text-red-800'
          : 'bg-amber-50 border-amber-200 text-amber-800'
      }`}
      role="alert"
    >
      <div className="flex items-start gap-3">
        {isHard
          ? <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          : <KeyRound      className="w-5 h-5 shrink-0 mt-0.5" />}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">
            {facilityCode ? `${facilityCode} — ` : ''}
            {isHard ? 'Credential error — downloads paused' : 'Scheduled syncs paused — credentials need updating'}
          </div>
          <div className="text-xs mt-0.5 opacity-90">
            {isHard
              ? 'Shafafiya rejected the facility login. Update credentials below, then trigger an adhoc run to verify.'
              : 'Scheduled runs are being skipped because the previous real run failed authentication.'}
          </div>
          {lastAuthFailedAt && (
            <div className="text-xs mt-1 opacity-75">
              Failed at: {fmtDt(lastAuthFailedAt)}
              {' · '}Client has been notified by email
            </div>
          )}

          {/* Action buttons */}
          {(onResend || (isAdmin && onMarkResolved)) && (
            <div className="flex flex-wrap gap-2 mt-3">
              {onResend && !resendDone && (
                <button
                  onClick={handleResend}
                  disabled={resending}
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors
                    ${isHard
                      ? 'bg-red-700 text-white hover:bg-red-800 disabled:opacity-50'
                      : 'bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-50'
                    }`}
                >
                  {resending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  Resend Update Link
                </button>
              )}
              {resendDone && (
                <span className="flex items-center gap-1 text-xs text-emerald-700 font-medium">
                  <CheckCircle2 className="w-3 h-3" /> Update link resent
                </span>
              )}

              {isAdmin && onMarkResolved && !resolveDone && (
                <button
                  onClick={handleResolve}
                  disabled={resolving}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium bg-white border border-current opacity-70 hover:opacity-100 disabled:opacity-40 transition-opacity"
                >
                  {resolving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                  Mark as Resolved
                </button>
              )}
              {resolveDone && (
                <span className="flex items-center gap-1 text-xs text-emerald-700 font-medium">
                  <CheckCircle2 className="w-3 h-3" /> Marked resolved — engine resumes next run
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
