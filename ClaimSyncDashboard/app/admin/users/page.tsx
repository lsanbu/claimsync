'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Plus, Shield, ShieldCheck,
  Loader2, CheckCircle2, XCircle, RefreshCw, Eye, EyeOff
} from 'lucide-react'

function getAdminToken() { return sessionStorage.getItem('cs_admin_token') }

export default function AdminUsersPage() {
  const router = useRouter()
  const [users,   setUsers]   = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok'|'err'; text: string } | null>(null)
  const [showPw,  setShowPw]  = useState(false)

  // New user form
  const [name,         setName]         = useState('')
  const [email,        setEmail]        = useState('')
  const [password,     setPassword]     = useState('')
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [creating,     setCreating]     = useState(false)

  const load = useCallback(async () => {
    const token = getAdminToken()
    if (!token) { router.push('/admin/login'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/claimssync/admin/users', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.status === 401) { router.push('/admin/login'); return }
      if (res.status === 403) { router.push('/admin/dashboard'); return }
      setUsers(await res.json())
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const createUser = async () => {
    if (!name || !email || !password) {
      setMessage({ type: 'err', text: 'Name, email and password are required' }); return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/claimssync/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAdminToken()}` },
        body: JSON.stringify({ name, email, password, is_super_admin: isSuperAdmin })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail)
      setMessage({ type: 'ok', text: `${name} created successfully` })
      setShowAdd(false)
      setName(''); setEmail(''); setPassword(''); setIsSuperAdmin(false)
      load()
    } catch (e: any) {
      setMessage({ type: 'err', text: e.message })
    } finally { setCreating(false) }
  }

  const toggleStatus = async (adminId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active'
    try {
      const res = await fetch(`/api/claimssync/admin/users/${adminId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAdminToken()}` },
        body: JSON.stringify({ status: newStatus })
      })
      if (!res.ok) throw new Error('Update failed')
      load()
    } catch (e: any) {
      setMessage({ type: 'err', text: e.message })
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-slate-800 text-white px-6 py-3 flex items-center gap-3">
        <button onClick={() => router.push('/admin/dashboard')} className="p-1.5 rounded-lg hover:bg-slate-700">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
          <span className="text-slate-800 font-bold text-sm">CS</span>
        </div>
        <span className="font-semibold">Admin Users</span>
        <span className="text-xs bg-amber-500 text-white px-2 py-0.5 rounded font-medium ml-1">Super Admin Only</span>
        <button onClick={load} className="ml-auto p-1.5 rounded-lg hover:bg-slate-700">
          <RefreshCw className="w-4 h-4 text-slate-400" />
        </button>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">

        {message && (
          <div className={`text-sm px-4 py-3 rounded-xl flex items-center gap-2
            ${message.type === 'ok' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {message.type === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {message.text}
          </div>
        )}

        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Kaaryaa Admin Users</h1>
          <button onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1.5 text-sm bg-slate-800 text-white px-4 py-2 rounded-lg hover:bg-slate-900">
            <Plus className="w-4 h-4" /> Add Admin
          </button>
        </div>

        {/* Add user form */}
        {showAdd && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
            <h2 className="font-semibold text-gray-800 text-sm">New Admin User</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
                <input value={name} onChange={e => setName(e.target.value)}
                  placeholder="Senthil"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-slate-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email *</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="senthil@kaaryaa.com"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-slate-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Password *</label>
                <div className="relative">
                  <input type={showPw ? 'text' : 'password'} value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Min 8 characters"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 pr-9 focus:outline-none focus:ring-1 focus:ring-slate-300" />
                  <button onClick={() => setShowPw(!showPw)}
                    className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="flex items-center">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={isSuperAdmin}
                    onChange={e => setIsSuperAdmin(e.target.checked)}
                    className="rounded border-gray-300" />
                  <span className="text-sm text-gray-700">Super Admin</span>
                </label>
                <span className="ml-2 text-xs text-gray-400">(can manage users + config)</span>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={createUser} disabled={creating}
                className="flex items-center gap-2 bg-slate-800 text-white text-sm px-5 py-2 rounded-lg hover:bg-slate-900 disabled:opacity-50">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Create User
              </button>
              <button onClick={() => setShowAdd(false)}
                className="text-sm text-gray-500 border border-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Users table */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 hidden sm:table-cell">Email</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Role</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500 hidden md:table-cell">Last Login</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">
                  <Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…
                </td></tr>
              ) : users.map(u => (
                <tr key={u.admin_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{u.name}</td>
                  <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{u.email}</td>
                  <td className="px-4 py-3 text-center">
                    {u.is_super_admin
                      ? <span className="flex items-center justify-center gap-1 text-amber-600">
                          <ShieldCheck className="w-3.5 h-3.5" /> Super
                        </span>
                      : <span className="flex items-center justify-center gap-1 text-slate-500">
                          <Shield className="w-3.5 h-3.5" /> Admin
                        </span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full font-medium
                      ${u.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {u.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-400 hidden md:table-cell">
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short' }) : 'Never'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => toggleStatus(u.admin_id, u.status)}
                      className="text-xs text-gray-400 hover:text-gray-700 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50">
                      {u.status === 'active' ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-gray-400 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <span className="font-semibold text-amber-700">Note:</span> All admin users share onboarding approval rights.
          Only Super Admins can access this page, manage resellers, and change platform configuration.
        </div>

      </main>
    </div>
  )
}
