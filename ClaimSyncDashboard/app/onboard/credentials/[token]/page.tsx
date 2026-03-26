'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams } from 'next/navigation'
import {
  Shield, Eye, EyeOff, CheckCircle2, AlertTriangle,
  Loader2, Clock, Lock, Building2, RefreshCw, Mail
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────
interface TokenInfo {
  valid:          boolean
  reason?:        string          // 'expired' | 'already_used' | 'revoked'
  facility_code:  string
  facility_name:  string
  expires_at?:    string
}

type PageState = 'loading' | 'form' | 'expired' | 'used' | 'revoked' | 'success' | 'error'

const GREEN = '#0F6E56'

// ── Countdown hook ─────────────────────────────────────────────────────────────
function useCountdown(expiresAt: string | undefined) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!expiresAt) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [expiresAt])

  return useMemo(() => {
    if (!expiresAt) return null
    const diff = new Date(expiresAt).getTime() - now
    if (diff <= 0) return 'Expired'
    const h = Math.floor(diff / 3_600_000)
    const m = Math.floor((diff % 3_600_000) / 60_000)
    const s = Math.floor((diff % 60_000) / 1000)
    if (h > 0) return `${h}h ${m}m remaining`
    if (m > 0) return `${m}m ${s}s remaining`
    return `${s}s remaining`
  }, [expiresAt, now])
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function CredentialEntryPage() {
  const params = useParams()
  const token  = params?.token as string

  const [state, setState]                   = useState<PageState>('loading')
  const [info, setInfo]                     = useState<TokenInfo | null>(null)
  const [errorMsg, setErrorMsg]             = useState('')
  const [submitting, setSubmitting]         = useState(false)
  const [showPassword, setShowPassword]     = useState(false)
  const [showConfirm, setShowConfirm]       = useState(false)

  // Form fields
  const [userid, setUserid]                 = useState('')
  const [password, setPassword]             = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [callerLicense, setCallerLicense]   = useState('')

  const countdown = useCountdown(info?.expires_at)

  // Validate token on mount
  useEffect(() => {
    if (!token) return
    ;(async () => {
      try {
        const res = await fetch(`/api/claimssync/onboard/credentials/${token}`)
        if (res.status === 404) { setState('error'); setErrorMsg('This link was not found. Please check the URL or contact your administrator.'); return }
        if (!res.ok) { setState('error'); setErrorMsg(`Unexpected error (${res.status})`); return }
        const raw = await res.json()
        const data: TokenInfo = {
          ...raw,
          valid: raw.valid ?? (raw.status === 'valid'),
          reason: raw.reason ?? (raw.status !== 'valid' ? raw.status : undefined),
        }
        setInfo(data)
        if (!data.valid && data.reason === 'already_used') { setState('used'); return }
        if (!data.valid && data.reason === 'expired')      { setState('expired'); return }
        if (!data.valid && data.reason === 'revoked')      { setState('revoked'); return }
        if (!data.valid) { setState('error'); setErrorMsg('This link is no longer valid.'); return }
        setState('form')
      } catch {
        setState('error')
        setErrorMsg('Unable to reach the server. Please try again.')
      }
    })()
  }, [token])

  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword
  const formValid = userid.trim() && password.trim() && confirmPassword.trim() && callerLicense.trim() && !passwordMismatch

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formValid) return
    setSubmitting(true); setErrorMsg('')
    try {
      const res = await fetch(`/api/claimssync/onboard/credentials/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userid:         userid.trim(),
          password:       password.trim(),
          caller_license: callerLicense.trim(),
        })
      })
      if (res.status === 400) { setState('used'); return }
      if (res.status === 410) { setState('expired'); return }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `Server error (${res.status})`)
      }
      setState('success')
    } catch (e: any) {
      setErrorMsg(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50 to-gray-50">
      {/* Header */}
      <header style={{ backgroundColor: GREEN }} className="text-white px-6 py-4">
        <div className="max-w-xl mx-auto flex items-center gap-3">
          <div className="w-9 h-9 bg-white rounded-lg flex items-center justify-center">
            <span style={{ color: GREEN }} className="font-bold text-sm">CS</span>
          </div>
          <div>
            <span className="font-semibold text-lg">ClaimSync</span>
            <span className="text-emerald-200 text-xs ml-2">Secure Credential Setup</span>
          </div>
        </div>
      </header>

      <div className="max-w-xl mx-auto px-6 py-10">

        {/* Loading */}
        {state === 'loading' && (
          <div className="text-center py-20">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" style={{ color: GREEN }} />
            <p className="text-sm text-gray-500">Validating your link…</p>
          </div>
        )}

        {/* Expired */}
        {state === 'expired' && (
          <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-8 text-center">
            <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Clock className="w-7 h-7 text-amber-600" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Link Expired</h2>
            <p className="text-sm text-gray-500 mb-4">
              This credential link has expired. Please contact your administrator
              or reseller to request a new one.
            </p>
            <div className="inline-flex items-center gap-2 text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
              <Mail className="w-3.5 h-3.5" /> Contact support for a new link
            </div>
            {info && (
              <p className="text-xs text-gray-400 mt-4">Facility: {info.facility_code}</p>
            )}
          </div>
        )}

        {/* Already Used */}
        {state === 'used' && (
          <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm p-8 text-center">
            <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-7 h-7 text-emerald-600" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Already Submitted</h2>
            <p className="text-sm text-gray-500">
              Credentials for this facility have already been submitted successfully.
              If you need to update them, please contact your administrator.
            </p>
            {info && (
              <p className="text-xs text-gray-400 mt-4">
                {info.facility_name} ({info.facility_code})
              </p>
            )}
          </div>
        )}

        {/* Revoked — new link was issued */}
        {state === 'revoked' && (
          <div className="bg-white rounded-2xl border border-blue-200 shadow-sm p-8 text-center">
            <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <RefreshCw className="w-7 h-7 text-blue-600" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">New Link Issued</h2>
            <p className="text-sm text-gray-500 mb-4">
              A newer credential link has been issued for this facility.
              Please check your email for the updated link.
            </p>
            <div className="inline-flex items-center gap-2 text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2">
              <Mail className="w-3.5 h-3.5" /> Check your inbox for the new link
            </div>
            {info && (
              <p className="text-xs text-gray-400 mt-4">Facility: {info.facility_code}</p>
            )}
          </div>
        )}

        {/* Success */}
        {state === 'success' && (
          <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm p-8 text-center">
            <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-7 h-7 text-emerald-600" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Credentials Saved</h2>
            <p className="text-sm text-gray-600">
              Your Shafafiya API credentials have been securely stored.
              Your facility will be activated within 24 hours.
            </p>
            {info && (
              <p className="text-xs text-gray-400 mt-4">
                {info.facility_name} ({info.facility_code})
              </p>
            )}
          </div>
        )}

        {/* Error */}
        {state === 'error' && (
          <div className="bg-white rounded-2xl border border-red-200 shadow-sm p-8 text-center">
            <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-7 h-7 text-red-600" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Link Not Found</h2>
            <p className="text-sm text-gray-500">{errorMsg}</p>
          </div>
        )}

        {/* Form */}
        {state === 'form' && info && (
          <div className="space-y-5">
            {/* Info banner */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#e6f4f0' }}>
                  <Shield className="w-5 h-5" style={{ color: GREEN }} />
                </div>
                <div>
                  <h1 className="text-lg font-bold text-gray-900">Secure Credential Setup</h1>
                  <p className="text-xs text-gray-400">
                    Enter your Shafafiya API credentials below
                  </p>
                </div>
              </div>

              {/* Facility badge */}
              <div className="rounded-lg px-4 py-3 flex items-start gap-3" style={{ backgroundColor: '#e6f4f0', border: '1px solid #b3ddd1' }}>
                <Building2 className="w-4 h-4 mt-0.5 shrink-0" style={{ color: GREEN }} />
                <div className="flex-1">
                  <p className="text-xs font-medium" style={{ color: '#0a5441' }}>
                    {info.facility_name}
                  </p>
                  <p className="text-xs font-mono mt-0.5" style={{ color: GREEN }}>
                    {info.facility_code}
                  </p>
                  <p className="text-xs mt-1" style={{ color: '#3d9b83' }}>
                    Your credentials are encrypted and stored directly in Azure Key Vault.
                    They are never stored in the database.
                  </p>
                </div>
              </div>

              {/* Expiry countdown */}
              {countdown && countdown !== 'Expired' && (
                <div className="mt-3 flex items-center gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span>This link expires in <strong>{countdown}</strong></span>
                </div>
              )}
            </div>

            {/* Credential form */}
            <form
              onSubmit={handleSubmit}
              className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4"
            >
              {errorMsg && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-4 py-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> {errorMsg}
                </div>
              )}

              {/* User ID */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Shafafiya User ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={userid}
                  onChange={e => setUserid(e.target.value)}
                  placeholder="Enter your Shafafiya user ID"
                  required
                  autoComplete="off"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:border-emerald-300"
                  style={{ '--tw-ring-color': '#0F6E56' } as React.CSSProperties}
                  onFocus={e => e.target.style.boxShadow = `0 0 0 2px ${GREEN}33`}
                  onBlur={e => e.target.style.boxShadow = 'none'}
                />
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Shafafiya Password <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Enter your Shafafiya password"
                    required
                    autoComplete="new-password"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3.5 py-2.5 pr-10 focus:outline-none"
                    onFocus={e => e.target.style.boxShadow = `0 0 0 2px ${GREEN}33`}
                    onBlur={e => e.target.style.boxShadow = 'none'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Confirm Password <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    required
                    autoComplete="new-password"
                    className={`w-full text-sm border rounded-lg px-3.5 py-2.5 pr-10 focus:outline-none ${
                      passwordMismatch ? 'border-red-300 bg-red-50' : 'border-gray-200'
                    }`}
                    onFocus={e => { if (!passwordMismatch) e.target.style.boxShadow = `0 0 0 2px ${GREEN}33` }}
                    onBlur={e => e.target.style.boxShadow = 'none'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {passwordMismatch && (
                  <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
                )}
              </div>

              {/* Caller License */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Caller License Key <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={callerLicense}
                  onChange={e => setCallerLicense(e.target.value)}
                  placeholder="Enter your caller license key"
                  required
                  autoComplete="off"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3.5 py-2.5 focus:outline-none"
                  onFocus={e => e.target.style.boxShadow = `0 0 0 2px ${GREEN}33`}
                  onBlur={e => e.target.style.boxShadow = 'none'}
                />
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={submitting || !formValid}
                className="w-full flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-3 rounded-lg transition-colors"
                style={{ backgroundColor: GREEN }}
                onMouseEnter={e => { if (!submitting && formValid) (e.target as HTMLElement).style.backgroundColor = '#0a5441' }}
                onMouseLeave={e => (e.target as HTMLElement).style.backgroundColor = GREEN}
              >
                {submitting
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving Credentials…</>
                  : <><Lock className="w-4 h-4" /> Submit Credentials Securely</>
                }
              </button>

              <p className="text-xs text-gray-400 text-center">
                This is a one-time link. Credentials cannot be changed after submission.
              </p>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
