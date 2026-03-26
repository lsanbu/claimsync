'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ArrowLeft, CheckCircle2, XCircle, Clock, Building2,
  User, Phone, Mail, FileText, Calendar, Loader2,
  AlertTriangle, RefreshCw, BadgeCheck, Ban, Copy, Link, Shield
} from 'lucide-react'
import ResendCredentialToken from '@/components/admin/ResendCredentialToken'

// ── Types ──────────────────────────────────────────────────────────────────────
interface OnboardingDetail {
  request_id:           string
  reseller_id:          string
  tenant_id:            string | null
  facility_id:          string | null
  reseller_name:        string
  reseller_email:       string
  facility_code:        string
  facility_name:        string
  facility_type:        string | null
  emirate:              string | null
  contact_name:         string | null
  contact_email:        string | null
  contact_phone:        string | null
  plan_type:            string
  credentials_provided: boolean
  proposed_facilities:  Array<{ facility_code?: string; facility_name?: string; plan_code?: string; payer_id?: string; lookback_days?: number }> | null
  status:               'pending' | 'submitted' | 'approved' | 'rejected' | 'provisioning'
  submission_notes:     string | null
  review_notes:         string | null
  rejection_reason:     string | null
  trial_days_granted:   number | null
  credential_token:     string | null
  submitted_at:         string
  reviewed_at:          string | null
  reviewed_by:          string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending:      'bg-amber-100 text-amber-700 border border-amber-200',
    submitted:    'bg-blue-100 text-blue-700 border border-blue-200',
    approved:     'bg-emerald-100 text-emerald-700 border border-emerald-200',
    rejected:     'bg-red-100 text-red-700 border border-red-200',
    provisioning: 'bg-blue-100 text-blue-700 border border-blue-200',
  }
  const icons: Record<string, React.ReactNode> = {
    pending:      <Clock className="w-3.5 h-3.5" />,
    submitted:    <Clock className="w-3.5 h-3.5" />,
    approved:     <CheckCircle2 className="w-3.5 h-3.5" />,
    rejected:     <XCircle className="w-3.5 h-3.5" />,
    provisioning: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
  }
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium capitalize ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {icons[status]}
      {status}
    </span>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-400 w-40 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-800 font-medium">{value || <span className="text-gray-400 font-normal">—</span>}</span>
    </div>
  )
}

function fmtDate(dt: string | null) {
  if (!dt) return null
  return new Date(dt).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function AdminOnboardingDetailPage() {
  const router  = useRouter()
  const params  = useParams()
  const id      = params?.id as string

  const [detail,     setDetail]     = useState<OnboardingDetail | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [actionNote, setActionNote] = useState('')
  const [trialDays,  setTrialDays]  = useState(30)
  const [rejectMsg,  setRejectMsg]  = useState('')
  const [acting,     setActing]     = useState<'approve' | 'reject' | null>(null)
  const [showReject, setShowReject] = useState(false)
  const [user,       setUser]       = useState<any>(null)
  const [credToken,  setCredToken]  = useState<string | null>(null)
  const [copied,     setCopied]     = useState(false)

  const fac = detail?.proposed_facilities?.[0] ?? {} as any

  const getToken = () => {
    if (typeof window !== 'undefined') return sessionStorage.getItem('cs_admin_token')
    return null
  }

  const load = useCallback(async () => {
    const token = getToken()
    if (!token) { router.push('/admin/login'); return }
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/claimssync/admin/onboarding/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.status === 401) { router.push('/admin/login'); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      setDetail(d)
      if (d.credential_token) setCredToken(d.credential_token)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    const u = typeof window !== 'undefined' ? sessionStorage.getItem('cs_admin_user') : null
    if (u) setUser(JSON.parse(u))
    load()
  }, [load])

  const handleApprove = async () => {
    const token = getToken()
    if (!token) return
    setActing('approve')
    try {
      const res = await fetch(`/api/claimssync/admin/onboarding/${id}/approve`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_notes: actionNote || null, trial_days_granted: trialDays })
      })
      if (!res.ok) throw new Error(`Approve failed: HTTP ${res.status}`)
      const data = await res.json()
      if (data.credential_token) setCredToken(data.credential_token)
      await load()
      setActionNote('')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setActing(null)
    }
  }

  const handleReject = async () => {
    const token = getToken()
    if (!token || !rejectMsg.trim()) return
    setActing('reject')
    try {
      const res = await fetch(`/api/claimssync/admin/onboarding/${id}/reject`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejection_reason: rejectMsg, review_notes: actionNote || null })
      })
      if (!res.ok) throw new Error(`Reject failed: HTTP ${res.status}`)
      await load()
      setActionNote(''); setRejectMsg(''); setShowReject(false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setActing(null)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
    </div>
  )

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
        <span className="text-xs text-blue-300">{user?.name || 'Admin'}</span>
      </header>

      {/* Body */}
      <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">

        {/* Back + Title */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/admin/onboarding')}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 bg-white hover:bg-gray-50 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Requests
          </button>
          <button
            onClick={load}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 bg-white hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-4 py-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {detail && (
          <>
            {/* Title row */}
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-lg font-bold text-gray-900">{fac.facility_name || detail.facility_name || 'Onboarding Request'}</h1>
                <p className="text-xs text-gray-400 mt-0.5">
                  Request #{detail.request_id} · Submitted {fmtDate(detail.submitted_at)}
                </p>
              </div>
              <StatusBadge status={detail.status} />
            </div>

            <div className="grid grid-cols-2 gap-4">

              {/* Facility Info */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-0.5">
                <div className="flex items-center gap-2 mb-3">
                  <Building2 className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-semibold text-gray-700">Facility Details</span>
                </div>
                <InfoRow label="Facility Code"  value={fac.facility_code} />
                <InfoRow label="Facility Name"  value={fac.facility_name} />
                <InfoRow label="Plan"            value={fac.plan_code?.toUpperCase()} />
                <InfoRow label="Payer ID"        value={fac.payer_id} />
                <InfoRow label="Lookback Days"   value={fac.lookback_days ? `${fac.lookback_days} days` : null} />
                <InfoRow label="Credentials"     value={detail.credentials_provided ? 'Provided ✓' : 'Not yet provided'} />
              </div>

              {/* Reseller Info */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-0.5">
                <div className="flex items-center gap-2 mb-3">
                  <User className="w-4 h-4 text-emerald-600" />
                  <span className="text-sm font-semibold text-gray-700">Submitted By</span>
                </div>
                <InfoRow label="Reseller"        value={detail.reseller_name} />
                <InfoRow label="Email"           value={detail.reseller_email} />
                <InfoRow label="Contact Name"    value={detail.contact_name} />
                <InfoRow label="Contact Email"   value={detail.contact_email} />
                <InfoRow label="Contact Phone"   value={detail.contact_phone} />
              </div>

              {/* Submission Notes */}
              {detail.submission_notes && (
                <div className="col-span-2 bg-amber-50 rounded-xl border border-amber-200 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="w-4 h-4 text-amber-600" />
                    <span className="text-sm font-semibold text-amber-700">Submission Notes</span>
                  </div>
                  <p className="text-sm text-amber-800">{detail.submission_notes}</p>
                </div>
              )}

              {/* Review info (if already actioned) */}
              {(detail.status === 'approved' || detail.status === 'rejected') && (
                <div className={`col-span-2 rounded-xl border p-4 ${
                  detail.status === 'approved'
                    ? 'bg-emerald-50 border-emerald-200'
                    : 'bg-red-50 border-red-200'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    {detail.status === 'approved'
                      ? <BadgeCheck className="w-4 h-4 text-emerald-600" />
                      : <Ban className="w-4 h-4 text-red-600" />
                    }
                    <span className={`text-sm font-semibold ${
                      detail.status === 'approved' ? 'text-emerald-700' : 'text-red-700'
                    }`}>
                      {detail.status === 'approved' ? 'Approved' : 'Rejected'} by {detail.reviewed_by} · {fmtDate(detail.reviewed_at)}
                    </span>
                  </div>
                  {detail.review_notes && (
                    <p className="text-sm text-gray-700 mb-1">
                      <span className="font-medium">Notes:</span> {detail.review_notes}
                    </p>
                  )}
                  {detail.rejection_reason && (
                    <p className="text-sm text-red-700">
                      <span className="font-medium">Reason:</span> {detail.rejection_reason}
                    </p>
                  )}
                  {detail.trial_days_granted && (
                    <p className="text-sm text-emerald-700">
                      <span className="font-medium">Trial:</span> {detail.trial_days_granted} days granted
                    </p>
                  )}
                </div>
              )}

              {/* Credential Link — show after approval */}
              {detail.status === 'approved' && credToken && (
                <div className="col-span-2 bg-blue-50 rounded-xl border border-blue-200 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-semibold text-blue-700">Credential Link</span>
                    <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${
                      detail.credentials_provided
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      {detail.credentials_provided ? 'Credentials Received' : 'Waiting for Credentials'}
                    </span>
                  </div>
                  <p className="text-xs text-blue-600 mb-2">Send this link to the client to securely enter their Shafafiya API credentials:</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-white rounded-lg border border-blue-200 px-3 py-2 text-xs font-mono text-gray-700 truncate">
                      {typeof window !== 'undefined' ? `${window.location.origin}/onboard/credentials/${credToken}` : `/onboard/credentials/${credToken}`}
                    </div>
                    <button
                      onClick={() => {
                        const url = `${window.location.origin}/onboard/credentials/${credToken}`
                        navigator.clipboard.writeText(url)
                        setCopied(true)
                        setTimeout(() => setCopied(false), 2000)
                      }}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border transition-colors whitespace-nowrap bg-white border-blue-200 text-blue-700 hover:bg-blue-100"
                    >
                      {copied
                        ? <><CheckCircle2 className="w-3.5 h-3.5" /> Copied!</>
                        : <><Copy className="w-3.5 h-3.5" /> Copy Link</>
                      }
                    </button>
                  </div>
                </div>
              )}

              {/* Resend Credential Token — show after approval */}
              {detail.status === 'approved' && detail.facility_id && (
                <div className="col-span-2">
                  <ResendCredentialToken
                    facilityId={detail.facility_id}
                    facilityCode={fac.facility_code || detail.facility_code}
                    currentEmail={detail.contact_email || detail.reseller_email}
                  />
                </div>
              )}
            </div>

            {/* Action Panel — show for pending or submitted */}
            {(detail.status === 'pending' || detail.status === 'submitted') && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Review Action</h2>

                <div className="space-y-3 mb-4">
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1">
                      Review Notes <span className="text-gray-400">(optional)</span>
                    </label>
                    <textarea
                      value={actionNote}
                      onChange={e => setActionNote(e.target.value)}
                      rows={2}
                      placeholder="Any internal notes about this request…"
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="text-xs font-medium text-gray-600">Trial Days</label>
                    <input
                      type="number"
                      value={trialDays}
                      onChange={e => setTrialDays(Number(e.target.value))}
                      min={1} max={365}
                      className="w-20 text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                    <span className="text-xs text-gray-400">days from approval</span>
                  </div>
                </div>

                {/* Reject reason input */}
                {showReject && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg space-y-2">
                    <label className="text-xs font-medium text-red-700 block">
                      Rejection Reason <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={rejectMsg}
                      onChange={e => setRejectMsg(e.target.value)}
                      rows={2}
                      placeholder="Enter reason (will be visible to reseller)…"
                      className="w-full text-sm border border-red-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none bg-white"
                    />
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleApprove}
                    disabled={acting !== null}
                    className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    {acting === 'approve'
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <CheckCircle2 className="w-4 h-4" />
                    }
                    Approve & Provision
                  </button>

                  {!showReject ? (
                    <button
                      onClick={() => setShowReject(true)}
                      className="flex items-center gap-2 border border-red-300 hover:bg-red-50 text-red-600 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                    >
                      <XCircle className="w-4 h-4" /> Reject
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={handleReject}
                        disabled={acting !== null || !rejectMsg.trim()}
                        className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                      >
                        {acting === 'reject'
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <Ban className="w-4 h-4" />
                        }
                        Confirm Reject
                      </button>
                      <button
                        onClick={() => { setShowReject(false); setRejectMsg('') }}
                        className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
