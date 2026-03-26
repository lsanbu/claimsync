'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, LogIn, ShieldCheck } from 'lucide-react'

export default function ResellerLoginPage() {
  const router = useRouter()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  const handleLogin = async () => {
    if (!email || !password) { setError('Please enter email and password'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/claimssync/auth/reseller/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Login failed')

      // Store token in sessionStorage
      sessionStorage.setItem('cs_token', data.access_token)
      sessionStorage.setItem('cs_user',  JSON.stringify({
        name: data.name, email: data.email,
        role: data.role, reseller_id: data.reseller_id
      }))
      router.push('/reseller/dashboard')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-950 to-blue-800 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-white rounded-2xl shadow-lg mb-4">
            <span className="text-blue-800 font-bold text-xl">CS</span>
          </div>
          <h1 className="text-white font-bold text-2xl">ClaimSync</h1>
          <p className="text-blue-300 text-sm mt-1">Reseller Portal</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="flex items-center gap-2 mb-6">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
            <h2 className="font-semibold text-gray-800">Partner Sign In</h2>
          </div>

          {error && (
            <div className="mb-4 text-xs bg-red-50 border border-red-200 text-red-600 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="you@claimsync.cloud"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="••••••••"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>

            <button
              onClick={handleLogin}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium text-sm py-2.5 rounded-lg transition-colors"
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</>
                : <><LogIn className="w-4 h-4" /> Sign In</>}
            </button>
          </div>

          <p className="text-center text-xs text-gray-400 mt-6">
            Trouble signing in? Contact{' '}
            <a href="mailto:support@kaaryaa.com" className="text-blue-500 hover:underline">
              support@kaaryaa.com
            </a>
          </p>
        </div>

        <p className="text-center text-blue-400 text-xs mt-6">
          Kaaryaa GenAI Solutions · ClaimSync v1.2
        </p>
      </div>
    </div>
  )
}
