'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronRight, CheckCircle2, XCircle, Clock,
  Loader2, ArrowLeft, Building2, User, FileText,
  AlertTriangle, RefreshCw
} from 'lucide-react'

// ── Shared helpers ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    submitted: 'bg-amber-100 text-amber-700 border-amber-200',
    reviewing: 'bg-blue-100 text-blue-700 border-blue-200',
    approved:  'bg-emerald-100 text-emerald-700 border-emerald-200',
    rejected:  'bg-red-100 text-red-700 border-red-200',
    draft:     'bg-gray-100 text-gray-600 border-gray-200',
    cancelled: 'bg-gray-100 text-gray-500 border-gray-200',
  }
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize border ${map[status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>{status}</span>
}

function fmtDate(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function getAdminToken() { return sessionStorage.getItem('cs_admin_token') }
function getAdminUser()  { const u = sessionStorage.getItem('cs_admin_user'); return u ? JSON.parse(u) : null }


// ════════════════════════════════════════════════════════════════════════
// ONBOARDING LIST PAGE  —  /admin/onboarding
// ════════════════════════════════════════════════════════════════════════

export function OnboardingListPage() {
  const router   = useRouter()
  const [rows,    setRows]    = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState('')

  const load = useCallback(async () => {
    const token = getAdminToken()
    if (!token) { router.push('/admin/login'); return }
    setLoading(true)
    try {
      const url = filter ? `/api/claimssync/admin/onboarding?status=${filter}` : '/api/claimssync/admin/onboarding'
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
      if (res.status === 401) { router.push('/admin/login'); return }
      setRows(await res.json())
    } finally { setLoading(false) }
  }, [filter])

  useEffect(() => { load() }, [load])

  const pending = rows.filter(r => ['submitted','reviewing'].includes(r.status)).length

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-slate-800 text-white px-6 py-3 flex items-center gap-3">
        <button onClick={() => router.push('/admin/dashboard')} className="p-1.5 rounded-lg hover:bg-slate-700">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
          <span className="text-slate-800 font-bold text-sm">CS</span>
        </div>
        <span className="font-semibold">Onboarding Requests</span>
        {pending > 0 && (
          <span className="ml-2 text-xs bg-amber-500 text-white px-2 py-0.5 rounded-full font-bold">
            {pending} pending
          </span>
        )}
        <button onClick={load} className="ml-auto p-1.5 rounded-lg hover:bg-slate-700">
          <RefreshCw className="w-4 h-4 text-slate-400" />
        </button>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">

        {/* Filter tabs */}
        <div className="flex gap-2 flex-wrap">
          {['', 'submitted', 'reviewing', 'approved', 'rejected'].map(s => (
            <button key={s}
              onClick={() => setFilter(s)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors
                ${filter === s ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-gray-600 border-gray-200 hover:border-slate-400'}`}>
              {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-12">No requests found</div>
        ) : (
          <div className="space-y-2">
            {rows.map(r => (
              <div key={r.request_id}
                className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => router.push(`/admin/onboarding/${r.request_id}`)}>
                <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4 text-blue-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-gray-800">{r.tenant_name}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {r.reseller_name} · {r.contact_email} · {fmtDate(r.created_at)}
                  </div>
                </div>
                <div className="text-right shrink-0 hidden sm:block">
                  <div className="text-xs text-gray-500">{(r.proposed_facilities?.length ?? 0)} facility</div>
                  <div className="text-xs text-gray-400">{r.requested_plan_code}</div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}


// ════════════════════════════════════════════════════════════════════════
// ONBOARDING DETAIL PAGE  —  /admin/onboarding/[id]
// ════════════════════════════════════════════════════════════════════════

export function OnboardingDetailPage({ requestId }: { requestId: string }) {
  const router = useRouter()
  const [req,      setReq]      = useState<any>(null)
  const [loading,  setLoading]  = useState(true)
  const [acting,   setActing]   = useState(false)
  const [showApprove, setShowApprove] = useState(false)
  const [showReject,  setShowReject]  = useState(false)
  const [reviewNotes,      setReviewNotes]      = useState('')
  const [rejectionReason,  setRejectionReason]  = useState('')
  const [trialDays,        setTrialDays]        = useState(30)
  const [message,  setMessage]  = useState<{ type: 'ok'|'err'; text: string } | null>(null)
  const user = getAdminUser()

  const load = useCallback(async () => {
    const token = getAdminToken()
    if (!token) { router.push('/admin/login'); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/claimssync/admin/onboarding/${requestId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.status === 401) { router.push('/admin/login'); return }
      setReq(await res.json())
    } finally { setLoading(false) }
  }, [requestId])

  useEffect(() => { load() }, [load])

  const doApprove = async () => {
    setActing(true)
    try {
      const res = await fetch(`/api/claimssync/admin/onboarding/${requestId}/approve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAdminToken()}` },
        body: JSON.stringify({ review_notes: reviewNotes, trial_days_granted: trialDays })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail)
      setMessage({ type: 'ok', text: data.message })
      setShowApprove(false)
      load()
    } catch (e: any) {
      setMessage({ type: 'err', text: e.message })
    } finally { setActing(false) }
  }

  const doReject = async () => {
    if (!rejectionReason) { setMessage({ type: 'err', text: 'Rejection reason required' }); return }
    setActing(true)
    try {
      const res = await fetch(`/api/claimssync/admin/onboarding/${requestId}/reject`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAdminToken()}` },
        body: JSON.stringify({ rejection_reason: rejectionReason, review_notes: reviewNotes })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail)
      setMessage({ type: 'ok', text: data.message })
      setShowReject(false)
      load()
    } catch (e: any) {
      setMessage({ type: 'err', text: e.message })
    } finally { setActing(false) }
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
    </div>
  )

  const canAct = req && ['submitted','reviewing','draft'].includes(req.status)
  const facilities = typeof req?.proposed_facilities === 'string'
    ? JSON.parse(req.proposed_facilities) : (req?.proposed_facilities ?? [])

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-slate-800 text-white px-6 py-3 flex items-center gap-3">
        <button onClick={() => router.push('/admin/onboarding')} className="p-1.5 rounded-lg hover:bg-slate-700">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
          <span className="text-slate-800 font-bold text-sm">CS</span>
        </div>
        <span className="font-semibold truncate">{req?.tenant_name}</span>
        {req && <StatusBadge status={req.status} />}
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">

        {message && (
          <div className={`text-sm px-4 py-3 rounded-xl flex items-center gap-2
            ${message.type === 'ok' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {message.type === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            {message.text}
          </div>
        )}

        {/* Client details */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <User className="w-4 h-4 text-blue-500" />
            <h2 className="font-semibold text-gray-800">Client Details</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            {[
              ['Clinic Name', req?.tenant_name],
              ['Contact',     req?.contact_name],
              ['Email',       req?.contact_email],
              ['Phone',       req?.contact_phone || '—'],
              ['Emirate',     req?.tenant_emirate || '—'],
              ['Plan',        req?.requested_plan_code],
              ['Reseller',    req?.reseller_name],
              ['Submitted',   fmtDate(req?.submitted_at)],
              ['Created',     fmtDate(req?.created_at)],
            ].map(([label, val]) => (
              <div key={label as string} className="bg-gray-50 rounded-lg p-2">
                <div className="text-gray-400 mb-0.5">{label}</div>
                <div className="font-medium text-gray-700 truncate">{val}</div>
              </div>
            ))}
          </div>
          {req?.reseller_notes && (
            <div className="mt-3 bg-blue-50 rounded-lg p-3 text-xs text-blue-700">
              <span className="font-semibold">Reseller notes: </span>{req.reseller_notes}
            </div>
          )}
        </div>

        {/* Proposed facilities */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="w-4 h-4 text-blue-500" />
            <h2 className="font-semibold text-gray-800">Proposed Facilities ({facilities.length})</h2>
          </div>
          <div className="space-y-2">
            {facilities.map((f: any, i: number) => (
              <div key={i} className="bg-gray-50 rounded-lg px-3 py-2.5 flex items-center justify-between text-xs">
                <div>
                  <span className="font-mono font-semibold text-gray-800">{f.facility_code}</span>
                  <span className="text-gray-500 ml-2">{f.facility_name}</span>
                  {f.payer_id && <span className="text-gray-400 ml-2">UserID: {f.payer_id}</span>}
                </div>
                <span className="text-blue-600 font-medium">{f.plan_code || 'STARTER'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Review status */}
        {req?.status === 'approved' && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span className="font-semibold text-emerald-700">Approved by {req.reviewed_by}</span>
              <span className="text-emerald-500">{fmtDate(req.approved_at)}</span>
            </div>
            {req.review_notes && <p className="text-emerald-700">{req.review_notes}</p>}
            <p className="text-emerald-600 mt-1">Trial: {req.trial_days_granted} days · Tenant ID: {req.tenant_id}</p>
          </div>
        )}

        {req?.status === 'rejected' && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs">
            <div className="flex items-center gap-2 mb-2">
              <XCircle className="w-4 h-4 text-red-500" />
              <span className="font-semibold text-red-700">Rejected by {req.reviewed_by}</span>
            </div>
            <p className="text-red-700"><span className="font-medium">Reason:</span> {req.rejection_reason}</p>
            {req.review_notes && <p className="text-red-600 mt-1">{req.review_notes}</p>}
          </div>
        )}

        {/* Action buttons */}
        {canAct && !showApprove && !showReject && (
          <div className="flex gap-3">
            <button onClick={() => setShowApprove(true)}
              className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-2.5 rounded-xl transition-colors">
              <CheckCircle2 className="w-4 h-4" /> Approve
            </button>
            <button onClick={() => setShowReject(true)}
              className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium py-2.5 rounded-xl transition-colors">
              <XCircle className="w-4 h-4" /> Reject
            </button>
          </div>
        )}

        {/* Approve panel */}
        {showApprove && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 space-y-3">
            <h3 className="font-semibold text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> Confirm Approval
            </h3>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Trial Days</label>
              <input type="number" value={trialDays} onChange={e => setTrialDays(Number(e.target.value))}
                className="w-32 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Review Notes (optional)</label>
              <textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} rows={2}
                placeholder="Any notes for the reseller..."
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-emerald-300 resize-none" />
            </div>
            <div className="flex gap-2">
              <button onClick={doApprove} disabled={acting}
                className="flex items-center gap-2 bg-emerald-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Confirm Approve
              </button>
              <button onClick={() => setShowApprove(false)}
                className="text-sm text-gray-500 border border-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Reject panel */}
        {showReject && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 space-y-3">
            <h3 className="font-semibold text-red-800 flex items-center gap-2">
              <XCircle className="w-4 h-4" /> Confirm Rejection
            </h3>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Reason <span className="text-red-500">*</span>
              </label>
              <input value={rejectionReason} onChange={e => setRejectionReason(e.target.value)}
                placeholder="e.g. Incomplete facility details"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-red-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Additional Notes</label>
              <textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} rows={2}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-red-300 resize-none" />
            </div>
            <div className="flex gap-2">
              <button onClick={doReject} disabled={acting}
                className="flex items-center gap-2 bg-red-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50">
                {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                Confirm Reject
              </button>
              <button onClick={() => setShowReject(false)}
                className="text-sm text-gray-500 border border-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        )}

      </main>
    </div>
  )
}

// Default export — list page
export default OnboardingListPage
