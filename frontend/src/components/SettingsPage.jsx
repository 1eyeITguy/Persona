import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext.jsx'

const REDACTED = '••••••••'

export default function SettingsPage() {
  const { getToken } = useAuth()

  const [form, setForm] = useState({
    host: '',
    port: 389,
    use_ssl: false,
    base_dn: '',
    service_account_dn: '',
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
  )
}
