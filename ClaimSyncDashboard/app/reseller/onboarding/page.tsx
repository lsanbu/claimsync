'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Clock, CheckCircle2, XCircle, Loader2, RefreshCw,
  PlusCircle, Building2, AlertTriangle, ChevronRight,
  FileText, Calendar
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────
interface OnboardingRequest {
  id:               number
  facility_code:    string
  facility_name:    string
  facility_type:    string | null
  emirate:          string | null
  plan_type:        string
  tenant_name:      string | null
  tenant_short_code: string | null
  status:           'pending' | 'submitted' | 'approved' | 'rejected' | 'provisioning'
  submission_notes: string | null
  rejection_reason: string | null
  trial_days_granted: number | null
  submitted_at:     string
  reviewed_at:      string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending:      'bg-amber-100 text-amber-700',
    submitted:    'bg-blue-100 text-blue-700',
    approved:     'bg-emerald-100 text-emerald-700',
    rejected:     'bg-red-100 text-red-700',
    provisioning: 'bg-blue-100 text-blue-700',
  }
  const icons: Record<string, React.ReactNode> = {
    pending:      <Clock className="w-3 h-3" />,
    submitted:    <Clock className="w-3 h-3" />,
    approved:     <CheckCircle2 className="w-3 h-3" />,
    rejected:     <XCircle className="w-3 h-3" />,
    provisioning: <Loader2 className="w-3 h-3 animate-spin" />,
  }
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium capitalize ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {icons[status]} {status}
    </span>
  )
}

function fmtDate(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
      <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
      <p className="text-sm font-medium text-gray-600">No onboarding requests yet</p>
      <p className="text-xs text-gray-400 mt-1 mb-4">Submit a new facility onboarding request to get started</p>
      <button
        onClick={onNew}
        className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        <PlusCircle className="w-4 h-4" /> Add New Facility
      </button>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function ResellerOnboardingPage() {
  const router = useRouter()
  const [requests, setRequests] = useState<OnboardingRequest[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [user,     setUser]     = useState<any>(null)

  const getToken = () => {
    if (typeof window !== 'undefined') return sessionStorage.getItem('cs_token')
    return null
  }

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
      const res = await fetch('/api/claimssync/reseller/onboarding', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.status === 401) { logout(); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setRequests(Array.isArray(data) ? data : data.items ?? [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const u = typeof window !== 'undefined' ? sessionStorage.getItem('cs_user') : null
    if (u) setUser(JSON.parse(u))
    load()
  }, [load])

  // ── Count by status ────────────────────────────────────────────────────────
  const counts = requests.reduce(
    (acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }),
    {} as Record<string, number>
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
            <button onClick={() => router.push('/reseller/dashboard')} className="text-blue-200 hover:text-white transition-colors">Dashboard</button>
            <button onClick={() => router.push('/reseller/onboarding')} className="text-white font-medium border-b border-white pb-0.5">Requests</button>
            <button onClick={() => router.push('/reseller/onboard')} className="text-blue-200 hover:text-white transition-colors">+ New Facility</button>
          </nav>
          <button onClick={logout} className="text-xs text-blue-300 hover:text-white">Logout</button>
        </div>
      </header>

      {/* Body */}
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-5">

        {/* Title + actions */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Onboarding Requests</h1>
            <p className="text-xs text-gray-400 mt-0.5">Track status of facility submissions to Kaaryaa</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 bg-white hover:bg-gray-50 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
            <button
              onClick={() => router.push('/reseller/onboard')}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              <PlusCircle className="w-3.5 h-3.5" /> New Facility
            </button>
          </div>
        </div>

        {/* Summary pills */}
        {requests.length > 0 && (
          <div className="flex items-center gap-3">
            {[
              { key: 'submitted', label: 'Submitted', color: 'bg-amber-50 text-amber-700 border-amber-200' },
              { key: 'approved', label: 'Approved', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
              { key: 'rejected', label: 'Rejected', color: 'bg-red-50 text-red-700 border-red-200' },
            ].map(s => (
              <div key={s.key} className={`text-xs px-3 py-1 rounded-full border font-medium ${s.color}`}>
                {counts[s.key] ?? 0} {s.label}
              </div>
            ))}
            <div className="text-xs text-gray-400">{requests.length} total</div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-4 py-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading requests…
          </div>
        )}

        {!loading && requests.length === 0 && (
          <EmptyState onNew={() => router.push('/reseller/onboard')} />
        )}

        {/* Request cards */}
        {!loading && requests.map(req => (
          <div
            key={req.id}
            className="bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all p-4"
          >
            <div className="flex items-start justify-between">
              {/* Left side */}
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                  <Building2 className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-800">{req.tenant_name || req.facility_name || 'New Facility'}</span>
                    <span className="text-xs text-gray-400 font-mono">{req.tenant_short_code || req.facility_code || ''}</span>
                    <StatusBadge status={req.status} />
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-gray-400">
                      {req.facility_type || 'Healthcare Facility'}
                      {req.emirate ? ` · ${req.emirate}` : ''}
                    </span>
                    <span className="text-xs text-gray-300">|</span>
                    <span className="text-xs font-medium text-blue-600 uppercase">{req.plan_type}</span>
                  </div>

                  {/* Submission notes */}
                  {req.submission_notes && (
                    <p className="text-xs text-gray-500 mt-1.5 italic">"{req.submission_notes}"</p>
                  )}

                  {/* Rejection reason */}
                  {req.status === 'rejected' && req.rejection_reason && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs text-red-600">
                      <XCircle className="w-3 h-3" />
                      <span>{req.rejection_reason}</span>
                    </div>
                  )}

                  {/* Trial days if approved */}
                  {req.status === 'approved' && req.trial_days_granted && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-600">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>{req.trial_days_granted}-day trial granted</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Right side — dates */}
              <div className="text-right shrink-0 ml-4">
                <div className="flex items-center gap-1 text-xs text-gray-400 justify-end">
                  <Calendar className="w-3 h-3" />
                  <span>Submitted {fmtDate(req.submitted_at)}</span>
                </div>
                {req.reviewed_at && (
                  <div className="text-xs text-gray-400 mt-0.5">
                    Reviewed {fmtDate(req.reviewed_at)}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
