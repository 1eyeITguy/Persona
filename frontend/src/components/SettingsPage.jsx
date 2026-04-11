import { useState, useEffect } from 'react'
import { Loader2, ExternalLink, AlertTriangle, CheckCircle, ChevronRight } from 'lucide-react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext.jsx'
import { useAppConfig } from '../hooks/useAppConfig.js'

const REDACTED = '••••••••'

// ---------------------------------------------------------------------------
// Entra expiry helpers
// ---------------------------------------------------------------------------

function daysUntil(isoDate) {
  if (!isoDate) return null
  const diff = new Date(isoDate) - new Date()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function ExpiryBadge({ isoDate }) {
  if (!isoDate) return null
  const days = daysUntil(isoDate)
  if (days === null) return null
  if (days <= 0)
    return (
      <span className="inline-flex items-center gap-1 text-xs text-danger font-medium">
        <AlertTriangle className="h-3 w-3" /> Expired
      </span>
    )
  if (days <= 7)
    return (
      <span className="inline-flex items-center gap-1 text-xs text-danger font-medium">
        <AlertTriangle className="h-3 w-3" /> Expires in {days}d
      </span>
    )
  if (days <= 30)
    return (
      <span className="inline-flex items-center gap-1 text-xs text-warning font-medium">
        <AlertTriangle className="h-3 w-3" /> Expires in {days}d
      </span>
    )
  return <span className="text-xs text-slate-500">Expires {isoDate}</span>
}

// ---------------------------------------------------------------------------
// EntraSection
// ---------------------------------------------------------------------------

const REQUIRED_PERMISSIONS = [
  'User.Read.All',
  'Group.Read.All',
  'Directory.Read.All',
  'AuditLog.Read.All',
]

function EntraSection({ authHeaders, bootstrapClientId }) {
  const [config, setConfig] = useState(null)    // null = loading, false = not configured, obj = configured
  const [loading, setLoading] = useState(true)
  const [saveResult, setSaveResult] = useState(null)
  const [disconnecting, setDisconnecting] = useState(false)

  // Connect flow state
  // mode: null | 'choose' | 'auto' | 'manual'
  // For 'auto': autoPhase: 'bootstrap' | 'creating' | 'done' | 'error'
  const [mode, setMode] = useState(null)
  const [autoPhase, setAutoPhase] = useState('bootstrap')
  const [autoClientId, setAutoClientId] = useState('')
  const [autoLoading, setAutoLoading] = useState(false)
  const [autoError, setAutoError] = useState('')
  const [autoResult, setAutoResult] = useState(null) // {client_id, secret_expires}

  // Manual form state
  const [form, setForm] = useState({ tenant_id: '', client_id: '', client_secret: '', secret_expires: '' })
  const [testResult, setTestResult] = useState(null)
  const [testLoading, setTestLoading] = useState(false)
  const [saveLoading, setSaveLoading] = useState(false)

  const inputCls =
    'w-full rounded-md border border-border-subtle bg-app-bg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary'
  const labelCls = 'mb-1 block text-sm font-medium text-slate-300'

  useEffect(() => {
    axios
      .get('/api/v1/entra/config', { headers: authHeaders() })
      .then(res => setConfig(res.data))
      .catch(err => {
        if (err.response?.status === 404) setConfig(false)
      })
      .finally(() => {
        setLoading(false)
        // Check if we just returned from an OAuth redirect targeting this page
        const sessionToken = sessionStorage.getItem('entra_session_token')
        if (sessionToken) {
          setMode('auto')
          setAutoPhase('creating')
          runCreateApp(sessionToken)
        }
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function runCreateApp(sessionToken) {
    try {
      const res = await axios.post(
        '/api/v1/entra/oauth2/create-app',
        { session_token: sessionToken },
        { headers: authHeaders() },
      )
      sessionStorage.removeItem('entra_session_token')
      if (res.data.success) {
        setAutoResult({ client_id: res.data.client_id, secret_expires: res.data.secret_expires })
        setAutoPhase('done')
        // Refresh config so connected summary appears after closing
        axios
          .get('/api/v1/entra/config', { headers: authHeaders() })
          .then(r => setConfig(r.data))
          .catch(() => {})
      } else {
        setAutoError(res.data.message || 'App Registration creation failed.')
        setAutoPhase('error')
      }
    } catch (err) {
      sessionStorage.removeItem('entra_session_token')
      setAutoError(err.response?.data?.detail || 'App Registration creation failed.')
      setAutoPhase('error')
    }
  }

  async function handleAutoSignIn() {
    const clientId = bootstrapClientId || autoClientId.trim()
    if (!clientId) return
    setAutoLoading(true)
    setAutoError('')
    try {
      const redirectUri = `${window.location.origin}/entra-callback`
      // Tell the callback page to return to Settings
      sessionStorage.setItem('entra_callback_redirect', '/settings')
      const res = await axios.post(
        '/api/v1/entra/oauth2/start',
        { client_id: clientId, redirect_uri: redirectUri },
        { headers: authHeaders() },
      )
      window.location.href = res.data.auth_url
    } catch (err) {
      setAutoLoading(false)
      setAutoError(err.response?.data?.detail || 'Failed to start sign-in. Please try again.')
    }
  }

  function resetAutoFlow() {
    sessionStorage.removeItem('entra_session_token')
    setAutoPhase('bootstrap')
    setAutoError('')
    setAutoLoading(false)
    setAutoResult(null)
  }

  function cancelConnect() {
    resetAutoFlow()
    setMode(null)
    setTestResult(null)
    setSaveResult(null)
  }

  function startManualEdit() {
    setForm({
      tenant_id: config?.tenant_id || '',
      client_id: config?.client_id || '',
      client_secret: '',
      secret_expires: config?.secret_expires || '',
    })
    setTestResult(null)
    setSaveResult(null)
    setMode('manual')
  }

  async function handleTest() {
    setTestResult(null)
    setTestLoading(true)
    try {
      const res = await axios.post(
        '/api/v1/settings/test-entra-connection',
        { tenant_id: form.tenant_id, client_id: form.client_id, client_secret: form.client_secret },
        { headers: authHeaders() },
      )
      setTestResult(res.data)
    } catch (err) {
      setTestResult({ success: false, message: err.response?.data?.detail || 'Test failed.' })
    } finally {
      setTestLoading(false)
    }
  }

  async function handleManualSave() {
    setSaveResult(null)
    setSaveLoading(true)
    try {
      const res = await axios.put(
        '/api/v1/entra/config',
        { ...form, secret_expires: form.secret_expires || null },
        { headers: authHeaders() },
      )
      setConfig(res.data)
      setMode(null)
      setTestResult(null)
      setSaveResult({ success: true, message: 'Entra configuration saved.' })
    } catch (err) {
      setSaveResult({ success: false, message: err.response?.data?.detail || 'Save failed.' })
    } finally {
      setSaveLoading(false)
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('Disconnect Entra ID? Cloud features will stop working.')) return
    setDisconnecting(true)
    try {
      await axios.delete('/api/v1/entra/config', { headers: authHeaders() })
      setConfig(false)
      setSaveResult(null)
    } catch (err) {
      setSaveResult({ success: false, message: err.response?.data?.detail || 'Disconnect failed.' })
    } finally {
      setDisconnecting(false)
    }
  }

  const canTest = form.tenant_id.trim() && form.client_id.trim() && form.client_secret.trim()

  if (loading) return null

  return (
    <div className="mt-8">
      <h2 className="mb-1 text-lg font-semibold text-white">Entra ID</h2>
      <p className="mb-6 text-sm text-slate-400">Microsoft Graph API connection</p>

      <div className="space-y-5 rounded-xl border border-border-subtle bg-surface p-6">

        {/* ── Status row (idle state) ── */}
        {mode === null && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`h-2 w-2 rounded-full ${config ? 'bg-success' : 'bg-slate-600'}`} />
              <span className="text-sm text-slate-300">
                {config ? 'Connected' : 'Not configured'}
              </span>
              {config && <ExpiryBadge isoDate={config.secret_expires} />}
            </div>
            <button
              onClick={() => config ? startManualEdit() : setMode('choose')}
              className="text-xs text-brand-primary hover:underline"
            >
              {config ? 'Edit' : 'Connect'}
            </button>
          </div>
        )}

        {/* Connected summary */}
        {mode === null && config && (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Tenant ID</span>
              <span className="font-mono text-xs text-slate-300">{config.tenant_id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Client ID</span>
              <span className="font-mono text-xs text-slate-300">{config.client_id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Client Secret</span>
              <span className="font-mono text-xs text-slate-300">{REDACTED}</span>
            </div>
          </div>
        )}

        {/* ── Choose mode ── */}
        {mode === 'choose' && (
          <>
            <p className="text-sm text-slate-400">How would you like to connect to Entra ID?</p>
            <div className="space-y-3">
              <button
                onClick={() => bootstrapClientId ? handleAutoSignIn() : setMode('auto')}
                disabled={autoLoading}
                className="w-full rounded-lg border-2 border-brand-primary/40 bg-brand-primary/10 hover:bg-brand-primary/20 hover:border-brand-primary/60 p-4 text-left transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white flex items-center gap-2">
                      {autoLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                      {bootstrapClientId ? 'Sign in with Microsoft' : 'Set up automatically'}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {bootstrapClientId
                        ? 'Sign in as Global Admin — Persona creates the App Registration for you.'
                        : 'Sign in as Global Admin — requires a one-time redirect URI setup.'}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-500 group-hover:text-slate-300 shrink-0" />
                </div>
              </button>
              <button
                onClick={() => { setMode('manual'); setForm({ tenant_id: '', client_id: '', client_secret: '', secret_expires: '' }) }}
                className="w-full rounded-lg border border-border-subtle hover:border-slate-500 bg-transparent hover:bg-white/5 p-4 text-left transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-300">Enter credentials manually</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      I already have an App Registration with the required permissions.
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-500 group-hover:text-slate-300 shrink-0" />
                </div>
              </button>
            </div>
            {autoError && (
              <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{autoError}</p>
            )}
            <button onClick={cancelConnect} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
              Cancel
            </button>
          </>
        )}

        {/* ── Auto setup flow ── */}
        {mode === 'auto' && autoPhase === 'bootstrap' && (
          <>
            <button onClick={() => setMode('choose')} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
              ← Back
            </button>

            <div className="rounded-md border border-border-subtle bg-app-bg px-4 py-3 text-xs text-slate-400 space-y-2">
              <p className="font-medium text-slate-300">One-time prerequisite:</p>
              <p>Create a minimal App Registration in Azure Portal (no permissions or secrets needed):</p>
              <ol className="list-decimal list-inside space-y-1 pl-1">
                <li>Azure Portal → Entra ID → App Registrations → New Registration</li>
                <li>Any name (e.g. "Persona Bootstrap"), single tenant</li>
                <li>Add redirect URI (Web): <code className="font-mono text-brand-primary break-all">{window.location.origin}/entra-callback</code></li>
              </ol>
              <p className="text-slate-500">That's it — just a name and a redirect URI. Persona handles permissions during sign-in.</p>
            </div>

            <div>
              <label className={labelCls}>Bootstrap App Client ID</label>
              <input
                className={inputCls}
                value={autoClientId}
                onChange={e => setAutoClientId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
              <p className="mt-1 text-xs text-slate-500">
                Copy the Application (client) ID from the app you just created.
              </p>
            </div>

            {autoError && (
              <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{autoError}</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleAutoSignIn}
                disabled={autoLoading || !autoClientId.trim()}
                className="flex items-center gap-2 rounded-md bg-brand-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-primary/80 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {autoLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                Sign in with Microsoft →
              </button>
              <button onClick={cancelConnect} className="rounded-md border border-border-subtle px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors">
                Cancel
              </button>
            </div>
          </>
        )}

        {mode === 'auto' && autoPhase === 'creating' && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-brand-primary" />
            <p className="text-sm font-medium text-slate-200">Creating App Registration…</p>
            <p className="text-xs text-slate-500">Setting up permissions and granting admin consent.</p>
          </div>
        )}

        {mode === 'auto' && autoPhase === 'done' && (
          <>
            <div className="rounded-md border border-success/30 bg-success/10 px-4 py-4 space-y-1.5">
              <p className="text-sm font-medium text-success flex items-center gap-2">
                <CheckCircle className="h-4 w-4 shrink-0" />
                App Registration created successfully
              </p>
              {autoResult?.client_id && (
                <p className="text-xs text-slate-500 font-mono break-all">Client ID: {autoResult.client_id}</p>
              )}
              {autoResult?.secret_expires && (
                <p className="text-xs text-slate-500">Secret expires: {autoResult.secret_expires}</p>
              )}
            </div>
            <button
              onClick={() => setMode(null)}
              className="text-sm text-brand-primary hover:underline"
            >
              Done
            </button>
          </>
        )}

        {mode === 'auto' && autoPhase === 'error' && (
          <>
            <div className="rounded-md bg-danger/10 border border-danger/20 px-4 py-3">
              <p className="text-sm font-medium text-danger mb-1">Setup failed</p>
              <p className="text-xs text-slate-400">{autoError}</p>
            </div>
            <div className="flex gap-3">
              <button onClick={resetAutoFlow} className="text-sm text-brand-primary hover:underline">
                Try Again
              </button>
              <button onClick={cancelConnect} className="text-sm text-slate-500 hover:text-slate-300 transition-colors">
                Cancel
              </button>
            </div>
          </>
        )}

        {/* ── Manual edit form ── */}
        {mode === 'manual' && (
          <>
            <button onClick={() => config ? setMode(null) : setMode('choose')} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
              ← Back
            </button>

            {!config && (
              <div className="rounded-md border border-border-subtle bg-app-bg px-4 py-3 mb-1 text-xs text-slate-400 space-y-1">
                <p className="font-medium text-slate-300 mb-1">Required API permissions:</p>
                {REQUIRED_PERMISSIONS.map(p => (
                  <div key={p} className="flex items-center gap-2">
                    <CheckCircle className="h-3 w-3 text-success shrink-0" />
                    <span>{p}</span>
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className={labelCls}>Entra Tenant ID</label>
              <input
                className={inputCls}
                value={form.tenant_id}
                onChange={e => setForm(p => ({ ...p, tenant_id: e.target.value }))}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </div>
            <div>
              <label className={labelCls}>Client ID</label>
              <input
                className={inputCls}
                value={form.client_id}
                onChange={e => setForm(p => ({ ...p, client_id: e.target.value }))}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </div>
            <div>
              <label className={labelCls}>Client Secret</label>
              <input
                type="password"
                className={inputCls}
                value={form.client_secret}
                onChange={e => { setForm(p => ({ ...p, client_secret: e.target.value })); setTestResult(null) }}
                placeholder={config ? 'Enter new secret to replace' : 'Enter client secret'}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className={labelCls}>
                Secret Expiry Date <span className="text-slate-500 font-normal">(optional)</span>
              </label>
              <input
                type="date"
                className={inputCls}
                value={form.secret_expires}
                onChange={e => setForm(p => ({ ...p, secret_expires: e.target.value }))}
              />
            </div>

            <a
              href="https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-brand-primary hover:underline"
            >
              Open Entra Portal <ExternalLink className="h-3 w-3" />
            </a>

            <button
              onClick={handleTest}
              disabled={testLoading || !canTest}
              className="flex items-center gap-2 rounded-md border border-border-subtle bg-app-bg px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5 disabled:opacity-50"
            >
              {testLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Test Connection
            </button>

            {testResult && (
              <div className={`rounded-md px-3 py-2 text-sm ${testResult.success ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                {testResult.message}
              </div>
            )}

            <div className="flex gap-3 border-t border-border-subtle pt-4">
              <button
                onClick={handleManualSave}
                disabled={saveLoading || !testResult?.success}
                className="flex items-center gap-2 rounded-md bg-brand-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-primary/80 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saveLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                Save
              </button>
              <button
                onClick={cancelConnect}
                className="rounded-md border border-border-subtle px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {/* Disconnect */}
        {mode === null && config && (
          <div className="border-t border-border-subtle pt-4">
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="text-sm text-danger hover:underline disabled:opacity-50"
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect Entra ID'}
            </button>
          </div>
        )}

        {saveResult && (
          <div className={`rounded-md px-3 py-2 text-sm ${saveResult.success ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
            {saveResult.message}
          </div>
        )}
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const { getToken } = useAuth()
  const { status } = useAppConfig()

  const [form, setForm] = useState({
    host: '',
    port: 389,
    use_ssl: false,
    base_dn: '',
    service_account_dn: '',
    allowed_group_dn: '',
  })
  // Track whether the user has typed a new password.
  // When false we send null to the backend (keep existing).
  const [newPassword, setNewPassword] = useState(null)
  const [passwordEditing, setPasswordEditing] = useState(false)

  const [loadingSettings, setLoadingSettings] = useState(true)
  const [testResult, setTestResult] = useState(null)
  const [testLoading, setTestLoading] = useState(false)
  const [saveResult, setSaveResult] = useState(null)
  const [saveLoading, setSaveLoading] = useState(false)

  function authHeaders() {
    const token = getToken()
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  // Pre-populate from current config
  useEffect(() => {
    axios
      .get('/api/v1/settings/ldap', { headers: authHeaders() })
      .then(res => {
        const { service_account_password: _pw, ...rest } = res.data
        setForm(rest)
      })
      .catch(() => {})
      .finally(() => setLoadingSettings(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleChange(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
    setTestResult(null)
    setSaveResult(null)
  }

  function handleSslToggle() {
    setForm(prev => ({
      ...prev,
      use_ssl: !prev.use_ssl,
      port: !prev.use_ssl ? 636 : 389,
    }))
    setTestResult(null)
    setSaveResult(null)
  }

  function handlePasswordClick() {
    if (!passwordEditing) {
      setPasswordEditing(true)
      setNewPassword('')
      setTestResult(null)
    }
  }

  async function handleTest() {
    setTestResult(null)
    setTestLoading(true)
    try {
      // Build test payload: include new password only if the user typed one
      const payload = {
        ...form,
        service_account_password: newPassword ?? null,
      }
      // When password is null, the test-connection endpoint doesn't support
      // "keep existing" — use the full settings endpoint which does.
      // Instead, re-use the PUT body shape (backend handles null password there).
      // Work-around: if no new password, call test via PUT dry-run is complex.
      // Simplest safe approach: require password to be entered before testing.
      if (payload.service_account_password === null) {
        // Pass the REDACTED marker — backend PUT handles keep-existing logic,
        // but test-connection needs a real string. Ask user to confirm password.
        setTestResult({
          success: false,
          message: 'Enter the service account password to run a connection test.',
        })
        return
      }
      const res = await axios.post('/api/v1/settings/test-connection', payload, {
        headers: authHeaders(),
      })
      setTestResult(res.data)
    } catch (err) {
      setTestResult({
        success: false,
        message: err.response?.data?.detail || 'Connection test failed.',
      })
    } finally {
      setTestLoading(false)
    }
  }

  async function handleSave() {
    setSaveResult(null)
    setSaveLoading(true)
    try {
      const payload = {
        ...form,
        service_account_password: newPassword ?? null,
      }
      await axios.put('/api/v1/settings/ldap', payload, { headers: authHeaders() })
      setSaveResult({ success: true, message: 'Settings saved successfully.' })
      setPasswordEditing(false)
      setNewPassword(null)
      setTestResult(null)
    } catch (err) {
      setSaveResult({
        success: false,
        message: err.response?.data?.detail || 'Failed to save settings.',
      })
    } finally {
      setSaveLoading(false)
    }
  }

  if (loadingSettings) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading settings…
      </div>
    )
  }

  const inputCls =
    'w-full rounded-md border border-border-subtle bg-app-bg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary'
  const labelCls = 'mb-1 block text-sm font-medium text-slate-300'

  return (
    <div className="max-w-xl p-8">
      <h1 className="mb-1 text-lg font-semibold text-white">Settings</h1>
      <p className="mb-6 text-sm text-slate-400">LDAP / Active Directory connection</p>

      <div className="space-y-5 rounded-xl border border-border-subtle bg-surface p-6">
        {/* Host + Port */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className={labelCls}>LDAP Host</label>
            <input
              value={form.host}
              onChange={e => handleChange('host', e.target.value)}
              className={inputCls}
              placeholder="192.168.1.10 or dc.yourdomain.com"
            />
          </div>
          <div>
            <label className={labelCls}>Port</label>
            <input
              type="number"
              value={form.port}
              onChange={e => handleChange('port', parseInt(e.target.value, 10) || 389)}
              className={inputCls}
            />
          </div>
        </div>

        {/* SSL toggle */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSslToggle}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              form.use_ssl ? 'bg-brand-primary' : 'bg-slate-600'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                form.use_ssl ? 'translate-x-4' : 'translate-x-1'
              }`}
            />
          </button>
          <span className="text-sm text-slate-300">Use SSL/LDAPS</span>
        </div>

        {/* Base DN */}
        <div>
          <label className={labelCls}>Base DN</label>
          <input
            value={form.base_dn}
            onChange={e => handleChange('base_dn', e.target.value)}
            className={inputCls}
            placeholder="DC=yourdomain,DC=com"
          />
        </div>

        {/* Service Account DN */}
        <div>
          <label className={labelCls}>Service Account DN</label>
          <input
            value={form.service_account_dn}
            onChange={e => handleChange('service_account_dn', e.target.value)}
            className={inputCls}
            placeholder="CN=persona-svc,OU=Service Accounts,DC=yourdomain,DC=com"
          />
        </div>

        {/* Service Account Password */}
        <div>
          <label className={labelCls}>Service Account Password</label>
          <input
            type="password"
            value={passwordEditing ? (newPassword ?? '') : REDACTED}
            readOnly={!passwordEditing}
            onClick={handlePasswordClick}
            onChange={e => {
              setNewPassword(e.target.value)
              setTestResult(null)
            }}
            className={`${inputCls} ${!passwordEditing ? 'cursor-pointer opacity-60' : ''}`}
            placeholder={passwordEditing ? 'Enter new password' : undefined}
          />
          <p className="mt-1 text-xs text-slate-500">
            {passwordEditing
              ? 'Type a new password, then test and save.'
              : 'Click to change the password. Leave unchanged to keep the current one.'}
          </p>
        </div>

        {/* Login group restriction */}
        <div>
          <label className={labelCls}>
            Login group restriction{' '}
            <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <input
            value={form.allowed_group_dn}
            onChange={e => handleChange('allowed_group_dn', e.target.value)}
            className={inputCls}
            placeholder="CN=Persona-Users,OU=Security Groups,DC=yourdomain,DC=com"
            spellCheck={false}
          />
          <p className="mt-1 text-xs text-slate-500">
            When set, only members of this group (including nested members) can
            log in. Leave blank to allow all AD users.
          </p>
        </div>

        {/* Test Connection */}
        <button
          onClick={handleTest}
          disabled={testLoading}
          className="flex items-center gap-2 rounded-md border border-border-subtle bg-app-bg px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5 disabled:opacity-50"
        >
          {testLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          Test Connection
        </button>

        {testResult && (
          <div
            className={`rounded-md px-3 py-2 text-sm ${
              testResult.success
                ? 'bg-success/10 text-success'
                : 'bg-danger/10 text-danger'
            }`}
          >
            {testResult.message}
          </div>
        )}

        {/* Save Changes */}
        <div className="border-t border-border-subtle pt-4">
          <button
            onClick={handleSave}
            disabled={saveLoading}
            className="flex items-center gap-2 rounded-md bg-brand-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-primary/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saveLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Changes
          </button>
          <p className="mt-2 text-xs text-slate-500">
            Connection is tested automatically before saving.
          </p>
        </div>

        {saveResult && (
          <div
            className={`rounded-md px-3 py-2 text-sm ${
              saveResult.success
                ? 'bg-success/10 text-success'
                : 'bg-danger/10 text-danger'
            }`}
          >
            {saveResult.message}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Entra ID                                                            */}
      {/* ------------------------------------------------------------------ */}
      <EntraSection authHeaders={authHeaders} bootstrapClientId={status?.entra_bootstrap_client_id || ''} />
    </div>
  )
}
