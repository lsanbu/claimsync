'use client'

import { useState } from 'react'
import {
  RefreshCw, Mail, AlertTriangle, Copy, CheckCircle2,
  Loader2, ChevronDown, ChevronUp, Shield, Clock
} from 'lucide-react'

interface Props {
  facilityId:   string
  facilityCode: string
  currentEmail: string | null | undefined
}

interface ResendResult {
  credential_url:  string
  expires_at:      string
}

export default function ResendCredentialToken({ facilityId, facilityCode, currentEmail }: Props) {
  const [expanded, setExpanded]     = useState(false)
  const [email, setEmail]           = useState(currentEmail ?? '')
  const [adminNote, setAdminNote]   = useState('')
  const [sending, setSending]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [result, setResult]         = useState<ResendResult | null>(null)
  const [copied, setCopied]         = useState(false)

  const getToken = () =>
    typeof window !== 'undefined' ? sessionStorage.getItem('cs_admin_token') : null

  const handleResend = async () => {
    const token = getToken()
    if (!token || !email.trim()) return
    setSending(true); setError(null); setResult(null)
    try {
      const res = await fetch(`/api/claimssync/admin/facilities/${facilityId}/resend-token`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          send_to_email: email.trim(),
          admin_note:    adminNote.trim() || null,
        }),
      })
      if (res.status === 401) {
        window.location.href = '/admin/login'
        return
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `Failed (HTTP ${res.status})`)
      }
      const data: ResendResult = await res.json()
      setResult(data)
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.detail || e?.message || 'Request failed'
      setError(msg)
    } finally {
      setSending(false)
    }
  }

  const copyUrl = () => {
    if (!result) return
    navigator.clipboard.writeText(result.credential_url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const fmtExpiry = (dt: string) =>
    new Date(dt).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })

  // ── Collapsed ────────────────────────────────────────────────────────────────
  if (!expanded) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-semibold text-gray-700">Credential Link</span>
          </div>
          <button
            onClick={() => setExpanded(true)}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Resend Link
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>
      </div>
    )
  }

  // ── Expanded ─────────────────────────────────────────────────────────────────
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-semibold text-gray-700">Resend Credential Link</span>
        </div>
        <button
          onClick={() => { setExpanded(false); setError(null); setResult(null) }}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
        >
          Collapse <ChevronUp className="w-3 h-3" />
        </button>
      </div>

      {/* Warning */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-700">
          <p className="font-medium">Previous tokens will be revoked</p>
          <p className="mt-0.5">
            Sending a new credential link for <span className="font-mono font-medium">{facilityCode}</span> will
            immediately revoke any previously issued, unused tokens.
          </p>
        </div>
      </div>

      {/* Form */}
      {!result && (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Recipient Email <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="email@facility.com"
                required
                className="w-full text-sm border border-gray-200 rounded-lg pl-8 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Admin Note <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              value={adminNote}
              onChange={e => setAdminNote(e.target.value)}
              rows={2}
              placeholder="Reason for resend, internal reference…"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2.5 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
            </div>
          )}

          <button
            onClick={handleResend}
            disabled={sending || !email.trim()}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {sending
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</>
              : <><RefreshCw className="w-3.5 h-3.5" /> Send New Credential Link</>
            }
          </button>
        </div>
      )}

      {/* Success */}
      {result && (
        <div className="space-y-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 flex items-center gap-2 text-xs text-emerald-700">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span className="font-medium">New credential link sent to {email}</span>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Credential URL</label>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-gray-50 rounded-lg border border-gray-200 px-3 py-2 text-xs font-mono text-gray-700 truncate">
                {result.credential_url}
              </div>
              <button
                onClick={copyUrl}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border transition-colors whitespace-nowrap bg-white border-blue-200 text-blue-700 hover:bg-blue-50"
              >
                {copied
                  ? <><CheckCircle2 className="w-3.5 h-3.5" /> Copied!</>
                  : <><Copy className="w-3.5 h-3.5" /> Copy</>
                }
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Clock className="w-3.5 h-3.5" />
            Expires: {fmtExpiry(result.expires_at)}
          </div>

          <button
            onClick={() => { setResult(null); setAdminNote('') }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Send another
          </button>
        </div>
      )}
    </div>
  )
}
