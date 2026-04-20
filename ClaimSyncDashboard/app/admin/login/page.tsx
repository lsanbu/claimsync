'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, LogIn, Shield } from 'lucide-react'

export default function AdminLoginPage() {
  const router = useRouter()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  const handleLogin = async () => {
    if (!email || !password) { setError('Please enter email and password'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/claimssync/auth/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Login failed')
      sessionStorage.setItem('cs_admin_token', data.access_token)
      sessionStorage.setItem('cs_admin_user', JSON.stringify({
        name: data.name, email: data.email,
        role: data.role, admin_id: data.admin_id,
        is_super_admin: data.is_super_admin
      }))
      router.push('/admin/dashboard')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-white rounded-2xl shadow-lg mb-4">
            <span className="text-slate-800 font-bold text-xl">CS</span>
          </div>
          <h1 className="text-white font-bold text-2xl">ClaimSync</h1>
          <p className="text-slate-400 text-sm mt-1">Kaaryaa Admin Portal</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="flex items-center gap-2 mb-6">
            <Shield className="w-5 h-5 text-slate-600" />
            <h2 className="font-semibold text-gray-800">Admin Sign In</h2>
            <span className="ml-auto text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Kaaryaa Internal</span>
          </div>

          {error && (
            <div className="mb-4 text-xs bg-red-50 border border-red-200 text-red-600 rounded-lg px-3 py-2">{error}</div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="anbu@kaaryaa.com"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-slate-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="••••••••"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-slate-300" />
            </div>
            <button onClick={handleLogin} disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white font-medium text-sm py-2.5 rounded-lg transition-colors">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</> : <><LogIn className="w-4 h-4" /> Sign In</>}
            </button>
          </div>
        </div>
        <p className="text-center text-slate-500 text-xs mt-6">Kaaryaa Intelligence LLP · Internal Use Only</p>
      </div>
    </div>
  )
}
