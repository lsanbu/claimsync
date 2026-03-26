import { NextRequest, NextResponse } from 'next/server'

const API_BASE = process.env.CLAIMSSYNC_API_URL!
const API_KEY  = process.env.CLAIMSSYNC_API_KEY!

// ── Shared proxy handler ───────────────────────────────────────────────────────

async function proxy(req: NextRequest, params: { path: string[] }) {
  const path   = params.path.join('/')
  const search = req.nextUrl.search || ''
  const url    = `${API_BASE}/${path}${search}`

  // JWT auth routes pass Bearer token — API key not needed for these
  const isAuthRoute = path.startsWith('auth/') ||
                      path.startsWith('reseller/') ||
                      path.startsWith('admin/') ||
                      path.startsWith('credentials/') ||
                      path.startsWith('onboard/')

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (!isAuthRoute) {
    headers['X-API-Key'] = API_KEY
  }
  // Forward Authorization header if present (JWT Bearer token)
  const authHeader = req.headers.get('Authorization')
  if (authHeader) {
    headers['Authorization'] = authHeader
  }

  try {
    // Forward body for POST/PUT
    let body: string | undefined
    if (req.method === 'POST' || req.method === 'PUT') {
      body = await req.text()
    }

    const res = await fetch(url, {
      method:  req.method,
      headers,
      body,
      cache: 'no-store',   // never cache auth/mutation requests
    })

    // Handle empty responses (204 etc)
    const text = await res.text()
    if (!text) {
      return NextResponse.json({}, { status: res.status })
    }

    try {
      const data = JSON.parse(text)
      return NextResponse.json(data, { status: res.status })
    } catch {
      return new NextResponse(text, {
        status: res.status,
        headers: { 'Content-Type': 'text/plain' }
      })
    }
  } catch (err) {
    return NextResponse.json(
      { error: 'API unreachable', detail: String(err) },
      { status: 503 }
    )
  }
}

// ── HTTP method exports ────────────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params)
}

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params)
}

export async function PUT(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params)
}

export async function DELETE(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params)
}
