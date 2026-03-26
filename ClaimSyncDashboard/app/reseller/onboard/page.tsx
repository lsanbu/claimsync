'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, ArrowRight, CheckCircle2,
  Plus, Trash2, Loader2, Building2, User, FileText
} from 'lucide-react'

const STEPS = ['Client Details', 'Facilities', 'Review & Submit']
const PLANS = [
  { code: 'STARTER',    label: 'Starter',    price: 'AED 499/mo', features: 'Up to 3 facilities' },
  { code: 'PRO',        label: 'Pro',         price: 'AED 999/mo', features: 'Up to 10 facilities' },
  { code: 'ENTERPRISE', label: 'Enterprise',  price: 'Custom',     features: 'Unlimited' },
]

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold
            ${i < current ? 'bg-emerald-500 text-white' :
              i === current ? 'bg-blue-600 text-white' :
              'bg-gray-100 text-gray-400'}`}>
            {i < current ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
          </div>
          <span className={`text-xs font-medium hidden sm:inline
            ${i === current ? 'text-blue-600' : i < current ? 'text-emerald-600' : 'text-gray-400'}`}>
            {s}
          </span>
          {i < STEPS.length - 1 && (
            <div className={`h-0.5 w-8 ${i < current ? 'bg-emerald-300' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

export default function ResellerOnboardPage() {
  const router = useRouter()
  const [step,    setStep]    = useState(0)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error,   setError]   = useState('')

  // Step 1 data
  const [tenantName,    setTenantName]    = useState('')
  const [contactName,   setContactName]   = useState('')
  const [contactEmail,  setContactEmail]  = useState('')
  const [contactPhone,  setContactPhone]  = useState('')
  const [emirate,       setEmirate]       = useState('Abu Dhabi')
  const [notes,         setNotes]         = useState('')

  // Step 2 data
  const [facilities, setFacilities] = useState([
    { facility_code: '', facility_name: '', payer_id: '', plan_code: 'STARTER', lookback_days: 90 }
  ])

  const addFacility = () => setFacilities([
    ...facilities,
    { facility_code: '', facility_name: '', payer_id: '', plan_code: 'STARTER', lookback_days: 90 }
  ])

  const removeFacility = (i: number) => setFacilities(facilities.filter((_, idx) => idx !== i))

  const updateFacility = (i: number, field: string, value: any) => {
    const updated = [...facilities]
    updated[i] = { ...updated[i], [field]: value }
    setFacilities(updated)
  }

  const validate = () => {
    if (step === 0) {
      if (!tenantName) return 'Client / Clinic name is required'
      if (!contactName) return 'Contact name is required'
      if (!contactEmail || !contactEmail.includes('@')) return 'Valid email required'
    }
    if (step === 1) {
      for (const f of facilities) {
        if (!f.facility_code) return 'Facility code is required for all facilities'
        if (!f.facility_name) return 'Facility name is required for all facilities'
      }
    }
    return null
  }

  const next = () => {
    const err = validate()
    if (err) { setError(err); return }
    setError('')
    setStep(s => s + 1)
  }

  const submit = async () => {
    const token = sessionStorage.getItem('cs_token')
    if (!token) { router.push('/reseller/login'); return }

    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/claimssync/reseller/onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          tenant_name:          tenantName,
          contact_name:         contactName,
          contact_email:        contactEmail,
          contact_phone:        contactPhone || undefined,
          tenant_emirate:       emirate,
          proposed_facilities:  facilities,
          requested_plan_code:  facilities[0]?.plan_code || 'STARTER',
          reseller_notes:       notes || undefined,
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Submission failed')
      setSuccess(data.request_id)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (success) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 max-w-md w-full text-center">
        <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-7 h-7 text-emerald-500" />
        </div>
        <h2 className="text-lg font-bold text-gray-900 mb-2">Request Submitted!</h2>
        <p className="text-sm text-gray-500 mb-2">
          Kaaryaa will review <span className="font-semibold text-gray-700">{tenantName}</span> within 1 business day.
        </p>
        <p className="text-xs text-gray-400 font-mono bg-gray-50 rounded-lg px-3 py-2 mb-6">
          Request ID: {success}
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => router.push('/reseller/onboarding')}
            className="flex-1 text-sm border border-gray-200 text-gray-600 py-2 rounded-lg hover:bg-gray-50"
          >
            View Requests
          </button>
          <button
            onClick={() => router.push('/reseller/dashboard')}
            className="flex-1 text-sm bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-blue-800 text-white px-6 py-3 flex items-center gap-3">
        <button onClick={() => router.back()} className="p-1.5 rounded-lg hover:bg-blue-700">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
          <span className="text-blue-800 font-bold text-sm">CS</span>
        </div>
        <span className="font-semibold">New Client Onboarding</span>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        <StepIndicator current={step} />

        {error && (
          <div className="mb-4 text-xs bg-red-50 border border-red-200 text-red-600 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* Step 0: Client Details */}
        {step === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <User className="w-4 h-4 text-blue-500" />
              <h2 className="font-semibold text-gray-800">Client Details</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Clinic / Hospital Name <span className="text-red-500">*</span>
                </label>
                <input value={tenantName} onChange={e => setTenantName(e.target.value)}
                  placeholder="e.g. Mediclinic Al Noor"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Contact Name <span className="text-red-500">*</span>
                </label>
                <input value={contactName} onChange={e => setContactName(e.target.value)}
                  placeholder="Finance Manager"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Email <span className="text-red-500">*</span>
                </label>
                <input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)}
                  placeholder="billing@clinic.ae"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                <input value={contactPhone} onChange={e => setContactPhone(e.target.value)}
                  placeholder="+971 50 xxx xxxx"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Emirate</label>
                <select value={emirate} onChange={e => setEmirate(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-300">
                  {['Abu Dhabi','Dubai','Sharjah','Ajman','Ras Al Khaimah','Fujairah','Umm Al Quwain'].map(e => (
                    <option key={e}>{e}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                  placeholder="Any additional info for Kaaryaa team..."
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-300 resize-none" />
              </div>
            </div>
          </div>
        )}

        {/* Step 1: Facilities */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-blue-500" />
                <h2 className="font-semibold text-gray-800">Facilities</h2>
              </div>
              <button onClick={addFacility}
                className="flex items-center gap-1.5 text-xs text-blue-600 border border-blue-200 rounded-lg px-3 py-1.5 hover:bg-blue-50">
                <Plus className="w-3.5 h-3.5" /> Add Facility
              </button>
            </div>

            {facilities.map((f, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Facility {i + 1}
                  </span>
                  {facilities.length > 1 && (
                    <button onClick={() => removeFacility(i)}
                      className="text-red-400 hover:text-red-600 p-1 rounded">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Facility Code <span className="text-red-500">*</span>
                    </label>
                    <input value={f.facility_code}
                      onChange={e => updateFacility(i, 'facility_code', e.target.value.toUpperCase())}
                      placeholder="e.g. MF2618"
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-1 focus:ring-blue-300" />
                    <p className="text-xs text-gray-400 mt-0.5">DOH-issued facility code</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Facility Name <span className="text-red-500">*</span>
                    </label>
                    <input value={f.facility_name}
                      onChange={e => updateFacility(i, 'facility_name', e.target.value)}
                      placeholder="e.g. Mediclinic Al Noor"
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-300" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Shafafiya User ID</label>
                    <input value={f.payer_id}
                      onChange={e => updateFacility(i, 'payer_id', e.target.value)}
                      placeholder="e.g. CRH234"
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-1 focus:ring-blue-300" />
                    <p className="text-xs text-gray-400 mt-0.5">Shafafiya login credentials shared separately</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Plan</label>
                    <select value={f.plan_code}
                      onChange={e => updateFacility(i, 'plan_code', e.target.value)}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-300">
                      {PLANS.map(p => (
                        <option key={p.code} value={p.code}>
                          {p.label} — {p.price}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ))}

            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs text-blue-700">
              <strong>Note:</strong> Shafafiya credentials (User ID, Password, Caller License) will be securely collected by Kaaryaa after approval via a separate encrypted form. Never share passwords in this form.
            </div>
          </div>
        )}

        {/* Step 2: Review */}
        {step === 2 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-4 h-4 text-blue-500" />
              <h2 className="font-semibold text-gray-800">Review & Submit</h2>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Client</h3>
              <div className="bg-gray-50 rounded-lg p-3 grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-gray-400">Name</span><div className="font-medium text-gray-700 mt-0.5">{tenantName}</div></div>
                <div><span className="text-gray-400">Contact</span><div className="font-medium text-gray-700 mt-0.5">{contactName}</div></div>
                <div><span className="text-gray-400">Email</span><div className="font-medium text-gray-700 mt-0.5">{contactEmail}</div></div>
                <div><span className="text-gray-400">Emirate</span><div className="font-medium text-gray-700 mt-0.5">{emirate}</div></div>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Facilities ({facilities.length})
              </h3>
              <div className="space-y-2">
                {facilities.map((f, i) => (
                  <div key={i} className="bg-gray-50 rounded-lg p-3 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-mono font-semibold text-gray-800">{f.facility_code}</span>
                      <span className="text-gray-500 ml-2">{f.facility_name}</span>
                    </div>
                    <span className="text-blue-600 font-medium">
                      {PLANS.find(p => p.code === f.plan_code)?.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {notes && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Notes</h3>
                <p className="text-xs text-gray-600 bg-gray-50 rounded-lg p-3">{notes}</p>
              </div>
            )}

            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-xs text-emerald-700">
              By submitting, you confirm all client details are accurate. Kaaryaa will review and provision the facilities within 1 business day.
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6">
          <button
            onClick={() => step === 0 ? router.back() : setStep(s => s - 1)}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-4 py-2 hover:bg-gray-50"
          >
            <ArrowLeft className="w-4 h-4" />
            {step === 0 ? 'Cancel' : 'Back'}
          </button>

          {step < 2 ? (
            <button onClick={next}
              className="flex items-center gap-2 text-sm bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700">
              Next <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={submit} disabled={loading}
              className="flex items-center gap-2 text-sm bg-emerald-600 text-white px-6 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
                : <><CheckCircle2 className="w-4 h-4" /> Submit Request</>}
            </button>
          )}
        </div>
      </main>
    </div>
  )
}
