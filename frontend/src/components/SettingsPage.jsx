import { useState, useEffect, useRef } from 'react'
import { Loader2, ExternalLink, AlertTriangle, ChevronRight, Search } from 'lucide-react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext.jsx'

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

function EntraSection({ authHeaders }) {
  const [config, setConfig] = useState(null)    // null = loading, false = not configured, obj = configured
  const [loading, setLoading] = useState(true)
  const [saveResult, setSaveResult] = useState(null)
  const [disconnecting, setDisconnecting] = useState(false)

  // Connect flow: null | 'manual'
  const [mode, setMode] = useState(null)
  const [guideOpen, setGuideOpen] = useState(false)

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
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function cancelConnect() {
    setMode(null)
    setTestResult(null)
    setSaveResult(null)
    setGuideOpen(false)
  }

  function startConnect() {
    setForm({ tenant_id: '', client_id: '', client_secret: '', secret_expires: '' })
    setTestResult(null)
    setSaveResult(null)
    setGuideOpen(true)
    setMode('manual')
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
    setGuideOpen(false)
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
              onClick={() => config ? startManualEdit() : startConnect()}
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


        {/* ── Manual form ── */}
        {mode === 'manual' && (
          <>
            <button onClick={cancelConnect} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
              ← Back
            </button>

            {/* Setup guide */}
            <div className="rounded-md border border-border-subtle bg-app-bg overflow-hidden">
              <button
                type="button"
                onClick={() => setGuideOpen(v => !v)}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
              >
                <span className="text-xs font-medium text-slate-300">How to create an App Registration in Azure</span>
                <ChevronRight className={`h-4 w-4 text-slate-500 transition-transform ${guideOpen ? 'rotate-90' : ''}`} />
              </button>
              {guideOpen && (
                <div className="border-t border-border-subtle px-4 py-3 text-xs text-slate-400 space-y-3">
                  <ol className="list-decimal list-inside space-y-2">
                    <li>
                      <a href="https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener noreferrer" className="text-brand-primary hover:underline inline-flex items-center gap-1">
                        Azure Portal → App Registrations <ExternalLink className="h-3 w-3" />
                      </a>{' '}→ <strong className="text-slate-300">New registration</strong>
                    </li>
                    <li>Any name (e.g. <em>Persona</em>), select <strong className="text-slate-300">Single tenant</strong></li>
                    <li>Copy the <strong className="text-slate-300">Application (client) ID</strong> and <strong className="text-slate-300">Directory (tenant) ID</strong> from the Overview page</li>
                    <li>
                      <strong className="text-slate-300">API permissions</strong> → Add a permission → Microsoft Graph → <strong className="text-slate-300">Application permissions</strong> → add:
                      <ul className="mt-1 ml-4 space-y-0.5 list-disc">
                        {REQUIRED_PERMISSIONS.map(p => <li key={p} className="font-mono">{p}</li>)}
                      </ul>
                    </li>
                    <li>Click <strong className="text-slate-300">Grant admin consent</strong> for your tenant</li>
                    <li><strong className="text-slate-300">Certificates &amp; secrets</strong> → New client secret → copy the <strong className="text-slate-300">Value</strong> immediately</li>
                  </ol>
                </div>
              )}
            </div>

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

// ---------------------------------------------------------------------------
// LicensesSection — embedded in Entra tab, full-width
// ---------------------------------------------------------------------------

function LicensesSection({ authHeaders }) {
  const [licenses, setLicenses]     = useState(null)
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [saveResult, setSaveResult] = useState(null)
  const [q, setQ]                   = useState('')
  const [edits, setEdits]           = useState({})

  useEffect(() => {
    axios
      .get('/api/v1/settings/license-config', { headers: authHeaders() })
      .then(res => {
        setLicenses(res.data)
        const init = {}
        res.data.forEach(l => {
          init[l.sku_id] = {
            assignable:           l.assignable,
            visible_on_main_page: l.visible_on_main_page,
            custom_name:          l.custom_name ?? '',
          }
        })
        setEdits(init)
      })
      .catch(() => setLicenses([]))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function setField(skuId, field, value) {
    setEdits(prev => ({ ...prev, [skuId]: { ...prev[skuId], [field]: value } }))
    setSaveResult(null)
  }

  async function handleSave() {
    setSaving(true)
    setSaveResult(null)
    const payload = (licenses ?? []).map(l => ({
      sku_id:               l.sku_id,
      assignable:           edits[l.sku_id]?.assignable           ?? false,
      visible_on_main_page: edits[l.sku_id]?.visible_on_main_page ?? false,
      custom_name:          edits[l.sku_id]?.custom_name?.trim()  || null,
    }))
    try {
      await axios.put('/api/v1/settings/license-config', payload, { headers: authHeaders() })
      setSaveResult('ok')
    } catch (err) {
      setSaveResult(err.response?.data?.detail || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const filtered = (licenses ?? []).filter(l =>
    !q || l.graph_display_name.toLowerCase().includes(q.toLowerCase()) ||
          l.sku_part_number.toLowerCase().includes(q.toLowerCase())
  )

  const assignableCount    = (licenses ?? []).filter(l => edits[l.sku_id]?.assignable).length
  const visibleCount       = (licenses ?? []).filter(l => edits[l.sku_id]?.visible_on_main_page).length

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />Loading tenant licenses…
      </div>
    )
  }

  if (!loading && licenses?.length === 0) {
    return (
      <p className="py-4 text-sm text-slate-500">
        No tenant licenses found. Ensure the app registration has
        Directory.Read.All or Organization.Read.All permission and admin consent granted.
      </p>
    )
  }

  return (
    <div className="mt-6">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">License Configuration</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Set a custom display name, control visibility on the main Licenses page,
            and enable assignment from the user blade.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-brand-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-primary/80 disabled:opacity-60 transition-colors"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save
        </button>
      </div>

      {saveResult === 'ok' && (
        <div className="mb-3 rounded-md border border-success/30 bg-success/5 px-4 py-2 text-sm text-success">
          Saved — {assignableCount} assignable, {visibleCount} visible on main page.
        </div>
      )}
      {saveResult && saveResult !== 'ok' && (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">
          {saveResult}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          placeholder="Filter licenses…"
          value={q}
          onChange={e => setQ(e.target.value)}
          className="w-full rounded-md border border-border-subtle bg-app-bg py-1.5 pl-8 pr-3 text-sm text-slate-200 placeholder:text-slate-500 focus:border-brand-primary focus:outline-none"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border-subtle overflow-hidden">
        {/* Sticky header */}
        <div className="grid grid-cols-[1fr_180px_80px_80px_64px_64px] items-center gap-x-3 border-b border-border-subtle bg-surface/90 px-4 py-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">License Name</span>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Custom Name</span>
          <span className="text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Assigned</span>
          <span className="text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Available</span>
          <span className="text-center text-xs font-semibold uppercase tracking-wider text-slate-500" title="Visible on main Licenses page">Main Page</span>
          <span className="text-center text-xs font-semibold uppercase tracking-wider text-slate-500" title="Assignable from user blade">User Blade</span>
        </div>

        <div className="max-h-[calc(100vh-380px)] overflow-y-auto">
          {filtered.map(lic => {
            const edit2  = edits[lic.sku_id] ?? { assignable: false, visible_on_main_page: false, custom_name: '' }
            const active = edit2.assignable || edit2.visible_on_main_page
            return (
              <div
                key={lic.sku_id}
                className={`grid grid-cols-[1fr_180px_80px_80px_64px_64px] items-center gap-x-3 border-b border-border-subtle/30 px-4 py-2.5 last:border-0 transition-colors ${
                  active ? 'bg-brand-primary/5' : 'hover:bg-white/[0.02]'
                }`}
              >
                {/* Name */}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-200">
                    {edit2.custom_name?.trim() || lic.graph_display_name}
                  </p>
                  <p className="truncate font-mono text-xs text-slate-600">{lic.sku_part_number}</p>
                </div>

                {/* Custom name input */}
                <input
                  type="text"
                  value={edit2.custom_name ?? ''}
                  onChange={e => setField(lic.sku_id, 'custom_name', e.target.value)}
                  placeholder="Override name…"
                  className="rounded border border-border-subtle/50 bg-app-bg px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-brand-primary focus:outline-none w-full"
                />

                {/* Counts */}
                <p className="text-right text-sm tabular-nums text-slate-400">{lic.assigned.toLocaleString()}</p>
                <p className={`text-right text-sm font-medium tabular-nums ${lic.available === 0 ? 'text-warning' : 'text-success'}`}>
                  {lic.available.toLocaleString()}
                </p>

                {/* Visible on main page */}
                <div className="flex justify-center">
                  <input
                    type="checkbox"
                    checked={edit2.visible_on_main_page}
                    title="Show on main Licenses page"
                    onChange={e => setField(lic.sku_id, 'visible_on_main_page', e.target.checked)}
                    className="accent-brand-primary cursor-pointer h-4 w-4"
                  />
                </div>

                {/* Assignable from user blade */}
                <div className="flex justify-center">
                  <input
                    type="checkbox"
                    checked={edit2.assignable}
                    title="Assignable from user blade"
                    onChange={e => setField(lic.sku_id, 'assignable', e.target.checked)}
                    className="accent-brand-primary cursor-pointer h-4 w-4"
                  />
                </div>
              </div>
            )
          })}

          {filtered.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-slate-500">
              No licenses match &ldquo;{q}&rdquo;
            </p>
          )}
        </div>
      </div>

      <p className="mt-2 text-xs text-slate-600">
        {licenses?.length ?? 0} licenses total · {assignableCount} assignable from user blade · {visibleCount} visible on main page
      </p>
    </div>
  )
}

export default function SettingsPage() {
  const { getToken } = useAuth()

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
  const [activeTab, setActiveTab] = useState('ad')
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

  const TABS = [
    { id: 'ad',    label: 'AD Connection' },
    { id: 'entra', label: 'Entra' },
  ]

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Page header + tab bar */}
      <div className="shrink-0 border-b border-border-subtle bg-surface px-8 pt-6">
        <h1 className="mb-4 text-lg font-semibold text-white">Settings</h1>
        <div className="flex gap-0">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`-mb-px border-b-2 px-5 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-brand-primary text-brand-primary'
                  : 'border-transparent text-slate-400 hover:border-slate-600 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">

      {/* ── AD Connection tab ── */}
      {activeTab === 'ad' && (
      <div className="max-w-xl p-8">

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

      </div>
      )} {/* end AD tab */}

      {/* ── Entra tab ── */}
      {activeTab === 'entra' && (
        <div className="p-8">
          <EntraSection authHeaders={authHeaders} />
          <LicensesSection authHeaders={authHeaders} />
        </div>
      )}

      </div> {/* end scroll container */}
    </div>
  )
}
