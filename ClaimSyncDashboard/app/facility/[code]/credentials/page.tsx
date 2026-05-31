'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Loader2, CheckCircle2, AlertTriangle, KeyRound } from 'lucide-react'

interface TokenData {
  facility_code: string
  facility_name: string
  token:         string
  credential_url: string
  expires_at:    string
}

interface SubmitResult {
  success: boolean
  message: string
}

export default function FacilityCredentialsPage() {
  const params   = useParams()
  const code     = ((params?.code as string) || '').toUpperCase()

  const [tokenData,  setTokenData]  = useState<TokenData | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)

  const [userid,    setUserid]    = useState('')
  const [password,  setPassword]  = useState('')
  const [callerLic, setCallerLic] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result,     setResult]     = useState<SubmitResult | null>(null)

  useEffect(() => {
    if (!code) return
    fetch(`/api/claimssync/facility/${code}/update-credentials`)
      .then(r => r.json())
      .then(d => {
        if (d.token) {
          setTokenData(d)
        } else {
          setError(d.detail || 'Unable to load credential update link')
        }
      })
      .catch(() => setError('Network error — please try again'))
      .finally(() => setLoading(false))
  }, [code])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!tokenData || !userid.trim() || !password.trim() || !callerLic.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/claimssync/onboard/credentials/${tokenData.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userid:         userid.trim(),
          password:       password.trim(),
          caller_license: callerLic.trim(),
        }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setResult({ success: true, message: 'Credentials updated. Your files will sync tomorrow morning at 06:00 UAE.' })
      } else {
        setResult({ success: false, message: data.detail || 'Submission failed — please try again.' })
      }
    } catch {
      setResult({ success: false, message: 'Network error — please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg overflow-hidden">

        {/* Header */}
        <div className="bg-[#0F6E56] px-8 py-6 text-center">
          <h1 className="text-xl font-bold text-white">ClaimSync</h1>
          <p className="text-emerald-200 text-xs mt-1">Shafafiya Credentials Update</p>
        </div>

        <div className="px-8 py-6">
          {loading && (
            <div className="flex items-center justify-center py-8 gap-2 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading…</span>
            </div>
          )}

          {!loading && error && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-red-700">Unable to load</div>
                <div className="text-xs text-red-600 mt-0.5">{error}</div>
              </div>
            </div>
          )}

          {!loading && !error && tokenData && result?.success && (
            <div className="text-center py-4">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <h2 className="text-lg font-bold text-gray-800 mb-2">Credentials Updated</h2>
              <p className="text-sm text-gray-500">{result.message}</p>
            </div>
          )}

          {!loading && !error && tokenData && !result?.success && (
            <>
              {/* Facility badge */}
              <div className="flex items-center gap-2 mb-5">
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-emerald-600" />
                  <span className="text-sm font-semibold text-emerald-700">{tokenData.facility_name}</span>
                  <span className="text-xs bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-full font-mono">{tokenData.facility_code}</span>
                </div>
              </div>

              <p className="text-sm text-gray-600 mb-5">
                Enter your Shafafiya portal credentials below. They will be stored securely in Azure Key Vault.
              </p>

              {result && !result.success && (
                <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span className="text-xs text-red-700">{result.message}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Shafafiya User ID</label>
                  <input
                    type="text"
                    value={userid}
                    onChange={e => setUserid(e.target.value)}
                    placeholder="e.g. MF2618_user"
                    required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Shafafiya Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Caller License</label>
                  <input
                    type="text"
                    value={callerLic}
                    onChange={e => setCallerLic(e.target.value)}
                    placeholder="e.g. LIC-12345"
                    required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting || !userid.trim() || !password.trim() || !callerLic.trim()}
                  className="w-full bg-[#0F6E56] text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-[#0d5e49] disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {submitting ? 'Saving…' : 'Update Credentials'}
                </button>
              </form>

              <p className="text-xs text-gray-400 text-center mt-4">
                Your credentials are transmitted over TLS and stored encrypted in Azure Key Vault.
                ClaimSync staff cannot view your password.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
