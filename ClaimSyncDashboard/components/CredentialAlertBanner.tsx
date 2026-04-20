import { AlertTriangle, KeyRound } from 'lucide-react'
import { isAuthBlocked } from '@/lib/api'

// Shown above the facility overview when the latest run was auth_failed
// (red, downloads currently broken) or skipped_auth_failed (amber, scheduled
// runs are being skipped until credentials are updated).
//
// Renders nothing when status is fine — safe to drop in unconditionally.
export default function CredentialAlertBanner({ status }: { status: string | null | undefined }) {
  if (!isAuthBlocked(status)) return null

  const isHard = status === 'auth_failed'
  return (
    <div
      className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${
        isHard
          ? 'bg-red-50 border-red-200 text-red-800'
          : 'bg-amber-50 border-amber-200 text-amber-800'
      }`}
      role="alert"
    >
      {isHard
        ? <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
        : <KeyRound      className="w-5 h-5 shrink-0 mt-0.5" />}
      <div className="text-sm">
        <div className="font-semibold">
          ⚠️ Credential error — downloads paused
        </div>
        <div className="text-xs mt-0.5 opacity-90">
          {isHard
            ? 'Shafafiya rejected the facility login on the last run. Update the Shafafiya password in Key Vault and trigger an adhoc run to verify.'
            : 'Scheduled runs are being skipped because the previous real run failed authentication. Update the Shafafiya password in Key Vault and trigger an adhoc run to verify.'}
        </div>
      </div>
    </div>
  )
}
