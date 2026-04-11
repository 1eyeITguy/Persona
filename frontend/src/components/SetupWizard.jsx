import { useState, useRef } from 'react'
import axios from 'axios'
import { Shield, CheckCircle, Eye, EyeOff, Loader2, ExternalLink, ChevronRight, Upload } from 'lucide-react'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StepIndicator({ current, total }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => {
        const step = i + 1
        const done = step < current
        const active = step === current
        return (
          <div key={step} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium border-2 transition-colors ${
                active
                  ? 'border-brand-primary bg-brand-primary text-white'
                  : done
                  ? 'border-brand-primary bg-brand-primary/20 text-brand-primary'
                  : 'border-border-subtle bg-surface text-slate-500'
              }`}
            >
              {done ? <CheckCircle className="h-4 w-4" /> : step}
            </div>
            {step < total && (
              <div
                className={`h-px w-8 transition-colors ${
                  done ? 'bg-brand-primary' : 'bg-border-subtle'
                }`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function Card({ children }) {
  return (
    <div className="w-full max-w-md rounded-xl border border-border-subtle bg-surface p-8 shadow-2xl">
      {children}
    </div>
  )
}

function Logo() {
  return (
    <div className="flex flex-col items-center mb-8 gap-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-primary shadow-lg">
        <Shield className="h-7 w-7 text-white" />
      </div>
      <span className="text-2xl font-bold tracking-tight text-white">Persona</span>
    </div>
  )
}

function Label({ children, htmlFor }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-300 mb-1">
      {children}
    </label>
  )
}

function Input({ id, type = 'text', value, onChange, placeholder, ...rest }) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="w-full rounded-md border border-border-subtle bg-app-bg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
      {...rest}
    />
  )
}

function Button({ children, onClick, disabled, loading, className = '' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        disabled || loading
          ? 'bg-brand-primary/50'
          : 'bg-brand-primary hover:bg-brand-primary/80'
      } ${className}`}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Password strength helper
// ---------------------------------------------------------------------------

function getPasswordStrength(password) {
  if (!password) return null
  let score = 0
  if (password.length >= 12) score++
  if (/[A-Z]/.test(password)) score++
  if (/[a-z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++
  if (score <= 2) return 'weak'
  if (score <= 3) return 'fair'
  return 'strong'
}

const STRENGTH_COLOR = {
  weak: 'bg-danger',
  fair: 'bg-warning',
  strong: 'bg-success',
}
const STRENGTH_LABEL = {
  weak: 'text-danger',
  fair: 'text-warning',
  strong: 'text-success',
}

function PasswordStrengthMeter({ password }) {
  const strength = getPasswordStrength(password)
  if (!strength) return null
  const widths = { weak: 'w-1/3', fair: 'w-2/3', strong: 'w-full' }
  return (
    <div className="mt-2">
      <div className="h-1.5 w-full rounded-full bg-app-bg">
        <div
          className={`h-1.5 rounded-full transition-all ${widths[strength]} ${STRENGTH_COLOR[strength]}`}
        />
      </div>
      <p className={`mt-1 text-xs ${STRENGTH_LABEL[strength]}`}>
        Password strength: <span className="capitalize font-medium">{strength}</span>
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 1 — Welcome
// ---------------------------------------------------------------------------

function Step1({ onNext }) {
  return (
    <>
      <h1 className="text-xl font-semibold text-white mb-2">Welcome to Persona</h1>
      <p className="text-sm text-slate-400 mb-8">
        Your open-source help desk tool for Active Directory and Entra ID environments.
        Let's get you set up in two steps.
      </p>
      <Button onClick={onNext}>Get Started →</Button>
    </>
  )
}

// ---------------------------------------------------------------------------
// Step 2 — Create Local Admin Account
// ---------------------------------------------------------------------------

function Step2({ onNext }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const requirements = [
    { label: 'At least 12 characters', met: password.length >= 12 },
    { label: 'Uppercase and lowercase letters', met: /[A-Z]/.test(password) && /[a-z]/.test(password) },
    { label: 'At least one number', met: /[0-9]/.test(password) },
    { label: 'At least one special character', met: /[^A-Za-z0-9]/.test(password) },
  ]
  const allRequirementsMet = requirements.every((r) => r.met)
  const canSubmit = username.length >= 3 && allRequirementsMet && password === confirm

  async function handleSubmit() {
    setError('')
    setLoading(true)
    try {
      await axios.post('/api/v1/settings/bootstrap', {
        username,
        password,
        confirm_password: confirm,
      })
      onNext()
    } catch (err) {
      setError(err.response?.data?.detail || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-white mb-1">Create Your Admin Account</h1>
      <p className="text-sm text-slate-400 mb-6">
        This account lets you log in to configure Persona before connecting to Active
        Directory. Keep these credentials safe — this is your recovery account if AD
        is ever unreachable.
      </p>

      <div className="space-y-4">
        <div>
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
            autoComplete="username"
          />
        </div>

        <div>
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <PasswordStrengthMeter password={password} />
        </div>

        <div>
          <Label htmlFor="confirm">Confirm Password</Label>
          <Input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••••••"
            autoComplete="new-password"
          />
          {confirm && password !== confirm && (
            <p className="mt-1 text-xs text-danger">Passwords do not match</p>
          )}
        </div>

        {/* Requirements checklist */}
        <ul className="space-y-1">
          {requirements.map((r) => (
            <li
              key={r.label}
              className={`flex items-center gap-2 text-xs ${
                r.met ? 'text-success' : 'text-slate-500'
              }`}
            >
              <span>{r.met ? '✓' : '○'}</span>
              {r.label}
            </li>
          ))}
        </ul>

        {error && <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

        <Button onClick={handleSubmit} disabled={!canSubmit} loading={loading}>
          Create Account →
        </Button>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Step 3 — Connect to Active Directory
// ---------------------------------------------------------------------------

function Step3({ ldapData, setLdapData, onNext }) {
  const [loading, setLoading] = useState(false)
  const [testResult, setTestResult] = useState(null)

  function handleSslToggle() {
    setLdapData((prev) => ({
      ...prev,
      use_ssl: !prev.use_ssl,
      port: !prev.use_ssl ? 636 : 389,
    }))
    setTestResult(null)
  }

  async function handleTest() {
    setTestResult(null)
    setLoading(true)
    try {
      const res = await axios.post('/api/v1/settings/test-connection', ldapData)
      setTestResult(res.data)
    } catch (err) {
      setTestResult({
        success: false,
        message: err.response?.data?.detail || 'Connection test failed.',
      })
    } finally {
      setLoading(false)
    }
  }

  const canTest =
    ldapData.host.trim() &&
    ldapData.base_dn.trim() &&
    ldapData.service_account_dn.trim() &&
    ldapData.service_account_password.trim()

  return (
    <>
      <h1 className="text-xl font-semibold text-white mb-1">Connect to Active Directory</h1>
      <p className="text-sm text-slate-400 mb-6">
        Enter your domain controller details so Persona can browse the directory.
      </p>

      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Label htmlFor="host">Domain Controller / LDAP Host</Label>
            <Input
              id="host"
              value={ldapData.host}
              onChange={(e) => { setLdapData((p) => ({ ...p, host: e.target.value })); setTestResult(null) }}
              placeholder="192.168.1.10 or dc.yourdomain.com"
            />
          </div>
          <div>
            <Label htmlFor="port">Port</Label>
            <Input
              id="port"
              type="number"
              value={ldapData.port}
              onChange={(e) => { setLdapData((p) => ({ ...p, port: parseInt(e.target.value, 10) || 389 })); setTestResult(null) }}
            />
          </div>
        </div>

        {/* SSL toggle */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSslToggle}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              ldapData.use_ssl ? 'bg-brand-primary' : 'bg-slate-600'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                ldapData.use_ssl ? 'translate-x-4' : 'translate-x-1'
              }`}
            />
          </button>
          <span className="text-sm text-slate-300">Use SSL/LDAPS</span>
        </div>

        <div>
          <Label htmlFor="base_dn">Base DN</Label>
          <Input
            id="base_dn"
            value={ldapData.base_dn}
            onChange={(e) => { setLdapData((p) => ({ ...p, base_dn: e.target.value })); setTestResult(null) }}
            placeholder="DC=yourdomain,DC=com"
          />
          <p className="mt-1 text-xs text-slate-500">
            Your Base DN is the root of your Active Directory. For a domain like
            yourdomain.com it would be DC=yourdomain,DC=com
          </p>
        </div>

        <div>
          <Label htmlFor="svc_dn">Service Account DN</Label>
          <Input
            id="svc_dn"
            value={ldapData.service_account_dn}
            onChange={(e) => { setLdapData((p) => ({ ...p, service_account_dn: e.target.value })); setTestResult(null) }}
            placeholder="CN=persona-svc,OU=Service Accounts,DC=yourdomain,DC=com"
          />
        </div>

        <div>
          <Label htmlFor="svc_pw">Service Account Password</Label>
          <Input
            id="svc_pw"
            type="password"
            value={ldapData.service_account_password}
            onChange={(e) => { setLdapData((p) => ({ ...p, service_account_password: e.target.value })); setTestResult(null) }}
            placeholder="••••••••"
            autoComplete="current-password"
          />
          <p className="mt-1 text-xs text-slate-500">
            Persona uses a read-only service account to browse the directory. This
            account only needs Read permissions on the AD objects you want help desk
            staff to see.
          </p>
        </div>

        <Button onClick={handleTest} loading={loading} disabled={!canTest}>
          Test Connection
        </Button>

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

        <Button onClick={onNext} disabled={!testResult?.success} loading={false}>
          Next →
        </Button>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Step 4 — Connect to Entra ID (optional)
// ---------------------------------------------------------------------------

// Graph API application permissions required on the app registration.
// Grouped: core identity permissions (always required) + Exchange permissions (for Exchange tab).
const REQUIRED_PERMISSIONS = [
  // Core identity — always required
  { name: 'User.Read.All',        note: 'Read all user profiles' },
  { name: 'Group.Read.All',       note: 'Read group memberships' },
  { name: 'Directory.Read.All',   note: 'Read directory data' },
  { name: 'AuditLog.Read.All',    note: 'Read sign-in activity' },
  // Exchange Online — required for the Exchange tab
  { name: 'MailboxSettings.Read', note: 'Read OOO status and archive settings' },
  { name: 'Mail.Read',            note: 'Read mailbox folder sizes' },
  { name: 'Exchange.ManageAsApp', note: 'Exchange Online PowerShell app-only access' },
]

// ── Manual entry form (existing flow, unchanged) ──────────────────────────

const DEFAULT_ENTRA = { tenant_id: '', client_id: '', client_secret: '', secret_expires: '' }

function ManualEntraForm({ onSave }) {
  const [form, setForm] = useState(DEFAULT_ENTRA)
  const [loading, setLoading] = useState(false)
  const [testResult, setTestResult] = useState(null)

  function handleChange(field, value) {
    setForm((p) => ({ ...p, [field]: value }))
    setTestResult(null)
  }

  const canTest =
    form.tenant_id.trim() && form.client_id.trim() && form.client_secret.trim()

  async function handleTest() {
    setTestResult(null)
    setLoading(true)
    try {
      const res = await axios.post('/api/v1/settings/test-entra-connection', {
        tenant_id: form.tenant_id,
        client_id: form.client_id,
        client_secret: form.client_secret,
      })
      setTestResult(res.data)
    } catch (err) {
      setTestResult({
        success: false,
        message: err.response?.data?.detail || 'Connection test failed.',
      })
    } finally {
      setLoading(false)
    }
  }

  function handleSave() {
    onSave({
      tenant_id: form.tenant_id,
      client_id: form.client_id,
      client_secret: form.client_secret,
      secret_expires: form.secret_expires || undefined,
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="entra_tid">Entra Tenant ID</Label>
        <Input
          id="entra_tid"
          value={form.tenant_id}
          onChange={(e) => handleChange('tenant_id', e.target.value)}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        />
      </div>
      <div>
        <Label htmlFor="entra_cid">Client ID</Label>
        <Input
          id="entra_cid"
          value={form.client_id}
          onChange={(e) => handleChange('client_id', e.target.value)}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        />
      </div>
      <div>
        <Label htmlFor="entra_secret">Client Secret</Label>
        <Input
          id="entra_secret"
          type="password"
          value={form.client_secret}
          onChange={(e) => handleChange('client_secret', e.target.value)}
          placeholder="••••••••••••"
          autoComplete="new-password"
        />
      </div>
      <div>
        <Label htmlFor="entra_exp">
          Secret Expiry Date{' '}
          <span className="text-slate-500 font-normal">(optional)</span>
        </Label>
        <Input
          id="entra_exp"
          type="date"
          value={form.secret_expires}
          onChange={(e) => handleChange('secret_expires', e.target.value)}
        />
        <p className="mt-1 text-xs text-slate-500">
          Copy this from your App Registration in the Entra portal.
        </p>
      </div>

      <Button onClick={handleTest} loading={loading} disabled={!canTest}>
        Test Connection
      </Button>

      {testResult && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${
            testResult.success ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
          }`}
        >
          {testResult.message}
        </div>
      )}

      <Button onClick={handleSave} disabled={!testResult?.success}>
        Save and Continue →
      </Button>
    </div>
  )
}

// ── StepEntra: connect Entra ID ──────────────────────────────────────────────

function StepEntra({ onSave, onSkip }) {
  const [guideOpen, setGuideOpen] = useState(true)

  return (
    <>
      <h1 className="text-xl font-semibold text-white mb-1">
        Connect to Entra ID{' '}
        <span className="text-base font-normal text-slate-500">(optional)</span>
      </h1>
      <p className="text-sm text-slate-400 mb-5">
        Link Persona to Microsoft Entra ID to see cloud identity details alongside AD data.
      </p>

      {/* Setup guide */}
      <div className="rounded-md border border-border-subtle bg-app-bg overflow-hidden mb-5">
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
                  {REQUIRED_PERMISSIONS.map(p => (
                    <li key={p.name}>
                      <span className="font-mono">{p.name}</span>
                      <span className="ml-1 text-slate-500">— {p.note}</span>
                    </li>
                  ))}
                </ul>
              </li>
              <li>Click <strong className="text-slate-300">Grant admin consent</strong> for your tenant</li>
              <li><strong className="text-slate-300">Certificates &amp; secrets</strong> → New client secret → copy the <strong className="text-slate-300">Value</strong> immediately</li>
              <li>
                <strong className="text-slate-300">Certificates &amp; secrets</strong> → <strong className="text-slate-300">Certificates</strong> tab → upload a certificate (needed for Exchange PowerShell — configured in the next step)
              </li>
            </ol>
          </div>
        )}
      </div>

      <ManualEntraForm onSave={onSave} />

      <button
        onClick={onSkip}
        className="w-full text-center text-sm text-slate-500 hover:text-slate-300 transition-colors py-1 mt-3"
      >
        Skip for now →
      </button>
    </>
  )
}

// ---------------------------------------------------------------------------
// Step 5 — Exchange Online PowerShell (optional)
// ---------------------------------------------------------------------------

function StepExchangePS({ onSave, onSkip }) {
  const [guideOpen, setGuideOpen] = useState(false)
  const [appId, setAppId] = useState('')
  const [tenantDomain, setTenantDomain] = useState('')
  const [certFile, setCertFile] = useState(null)
  const [certPassword, setCertPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const fileRef = useRef(null)

  async function handleSaveAndTest() {
    if (!appId.trim() || !tenantDomain.trim()) return
    setTestResult(null)
    setLoading(true)
    try {
      const form = new FormData()
      form.append('app_id', appId.trim())
      form.append('tenant_domain', tenantDomain.trim())
      if (certFile) form.append('certificate', certFile)
      if (certPassword) form.append('cert_password', certPassword)

      // Endpoint accepts unauthenticated requests during initial setup
      await axios.put('/api/v1/settings/exchange-ps-config', form)

      const testRes = await axios.post('/api/v1/settings/test-exchange-ps')
      setTestResult(testRes.data)
      if (testRes.data.success) {
        setTimeout(() => onSave(), 1500)
      }
    } catch (err) {
      setTestResult({
        success: false,
        message: err.response?.data?.detail || 'Failed to save configuration.',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-white mb-1">
        Exchange Online PowerShell{' '}
        <span className="text-base font-normal text-slate-500">(optional)</span>
      </h1>
      <p className="text-sm text-slate-400 mb-5">
        Required for shared mailbox access visibility. Uses certificate-based app authentication.
        All Exchange Online mailbox data (email aliases, OOO, archive status) is available without
        this step — only shared mailbox access requires it.
      </p>

      {/* Setup guide */}
      <div className="rounded-md border border-border-subtle bg-app-bg overflow-hidden mb-5">
        <button
          type="button"
          onClick={() => setGuideOpen(v => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
        >
          <span className="text-xs font-medium text-slate-300">How to configure Exchange Online PowerShell access</span>
          <ChevronRight className={`h-4 w-4 text-slate-500 transition-transform ${guideOpen ? 'rotate-90' : ''}`} />
        </button>
        {guideOpen && (
          <div className="border-t border-border-subtle px-4 py-3 text-xs text-slate-400 space-y-3">
            <p className="font-medium text-slate-300">1 — Upload a certificate to the app registration</p>
            <p>Generate a self-signed certificate or use an existing one. Upload it under
              <strong className="text-slate-300"> Certificates &amp; secrets → Certificates</strong> in the
              Azure Portal. Note the <strong className="text-slate-300">thumbprint</strong>.</p>
            <p>To generate a self-signed cert (PowerShell):</p>
            <pre className="bg-black/30 rounded p-2 text-xs font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap">{`$cert = New-SelfSignedCertificate \\
  -Subject "CN=Persona-ExchangePS" \\
  -CertStoreLocation "Cert:\\CurrentUser\\My" \\
  -KeyExportPolicy Exportable \\
  -KeySpec Signature \\
  -KeyLength 2048 \\
  -HashAlgorithm SHA256 \\
  -NotAfter (Get-Date).AddYears(2)

# Export PFX to current directory (set a password)
$pw = ConvertTo-SecureString "YourPFXPassword" -AsPlainText -Force
Export-PfxCertificate -Cert $cert \\
  -FilePath .\\persona-exchange.pfx \\
  -Password $pw

# Export CER for upload to Azure
Export-Certificate -Cert $cert -FilePath .\\persona-exchange.cer`}</pre>

            <p className="font-medium text-slate-300 pt-1">2 — Grant the service principal Exchange access</p>
            <p>Run these commands in <strong className="text-slate-300">Exchange Online PowerShell</strong> as an Exchange admin:</p>
            <pre className="bg-black/30 rounded p-2 text-xs font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap">{`# App Registrations → Overview → Application (client) ID
$clientId = "<Application (client) ID>"

# Enterprise Applications → Overview → Object ID  (different from above!)
$objectId = "<Service Principal Object ID>"

$sp = New-ServicePrincipal \\
  -AppId $clientId \\
  -ServiceId $objectId \\
  -DisplayName "Persona"

# Mail Recipients covers read + write on addresses, OOO, and groups
New-ManagementRoleAssignment \\
  -Role "Mail Recipients" \\
  -App $sp.Identity`}</pre>
            <p>After granting the role, Exchange Online replication may take <strong className="text-slate-300">5–15 minutes</strong> — wait before running the connection test.</p>
          </div>
        )}
      </div>

      {/* Form */}
      <div className="space-y-4">
        <div>
          <Label htmlFor="exch_appid">Application (Client) ID</Label>
          <Input
            id="exch_appid"
            value={appId}
            onChange={e => setAppId(e.target.value)}
            placeholder="Same Client ID used for Graph API"
          />
        </div>
        <div>
          <Label htmlFor="exch_domain">Tenant Primary Domain</Label>
          <Input
            id="exch_domain"
            value={tenantDomain}
            onChange={e => setTenantDomain(e.target.value)}
            placeholder="contoso.com"
          />
          <p className="mt-1 text-xs text-slate-500">The primary domain of your Microsoft 365 tenant (not the tenant ID).</p>
        </div>
        <div>
          <Label>Certificate (PFX file)</Label>
          <input
            ref={fileRef}
            type="file"
            accept=".pfx,.p12"
            className="hidden"
            onChange={e => setCertFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full items-center gap-2 rounded-md border border-border-subtle bg-app-bg px-3 py-2 text-sm text-slate-300 hover:border-brand-primary/50 hover:bg-white/5 transition-colors"
          >
            <Upload className="h-4 w-4 text-slate-500" />
            {certFile ? certFile.name : 'Choose PFX file…'}
          </button>
        </div>
        {certFile && (
          <div>
            <Label htmlFor="exch_certpw">Certificate Password <span className="text-slate-500 font-normal">(if encrypted)</span></Label>
            <Input
              id="exch_certpw"
              type="password"
              value={certPassword}
              onChange={e => setCertPassword(e.target.value)}
              placeholder="Leave blank if no password"
              autoComplete="new-password"
            />
          </div>
        )}
      </div>

      {testResult && (
        <div className={`mt-4 rounded-md px-3 py-2 text-sm ${
          testResult.success
            ? 'bg-success/10 text-success'
            : 'bg-danger/10 text-danger'
        }`}>
          {testResult.message}
        </div>
      )}

      <div className="mt-6 space-y-2">
        <Button
          onClick={handleSaveAndTest}
          loading={loading}
          disabled={!appId.trim() || !tenantDomain.trim() || !certFile}
        >
          Save &amp; Test Connection →
        </Button>
      </div>

      <button
        onClick={onSkip}
        className="w-full text-center text-sm text-slate-500 hover:text-slate-300 transition-colors py-1 mt-3"
      >
        Skip for now →
      </button>
    </>
  )
}

// ---------------------------------------------------------------------------
// Step 6 — Confirm & Save
// ---------------------------------------------------------------------------

function Step5({ ldapData, entraCreds, onFinish }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    setError('')
    setLoading(true)
    try {
      await axios.post('/api/v1/settings/setup', {
        ldap: ldapData,
        site_name: 'Persona',
        ...(entraCreds ? { entra: entraCreds } : {}),
      })
      onFinish()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save settings.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-white mb-1">You're almost done!</h1>
      <p className="text-sm text-slate-400 mb-6">Review your settings before saving.</p>

      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
        Active Directory
      </p>
      <div className="rounded-md border border-border-subtle bg-app-bg p-4 text-sm space-y-2 mb-4">
        <Row label="Host" value={ldapData.host} />
        <Row label="Port" value={String(ldapData.port)} />
        <Row label="SSL" value={ldapData.use_ssl ? 'Enabled' : 'Disabled'} />
        <Row label="Base DN" value={ldapData.base_dn} />
        <Row label="Service Account" value={ldapData.service_account_dn} />
        <Row label="Password" value="••••••••" />
      </div>

      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
        Entra ID
      </p>
      <div className="rounded-md border border-border-subtle bg-app-bg p-4 text-sm space-y-2 mb-6">
        {entraCreds ? (
          <>
            <Row label="Tenant ID" value={entraCreds.tenant_id} />
            <Row label="Client ID" value={entraCreds.client_id} />
            <Row label="Secret" value="••••••••" />
            {entraCreds.secret_expires && (
              <Row label="Expires" value={entraCreds.secret_expires} />
            )}
          </>
        ) : (
          <p className="text-slate-500 text-xs">Skipped — can be connected later in Settings.</p>
        )}
      </div>

      {error && (
        <p className="mb-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
      )}

      <Button onClick={handleSave} loading={loading}>
        Save &amp; Finish
      </Button>
    </>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200 font-mono text-xs truncate max-w-[60%] text-right">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SetupWizard — orchestrates all steps
// ---------------------------------------------------------------------------

const DEFAULT_LDAP = {
  host: '',
  port: 389,
  use_ssl: false,
  base_dn: '',
  service_account_dn: '',
  service_account_password: '',
}

export default function SetupWizard() {
  const [step, setStep] = useState(1)
  const [ldapData, setLdapData] = useState(DEFAULT_LDAP)
  const [entraCreds, setEntraCreds] = useState(undefined) // undefined = not yet decided

  function handleFinish() {
    // Redirect to login — full page reload so App re-checks /settings/status
    window.location.href = '/login'
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app-bg px-4 py-12">
      <div className="w-full max-w-md">
        <Logo />
        <StepIndicator current={step} total={6} />
        <Card>
          {step === 1 && <Step1 onNext={() => setStep(2)} />}
          {step === 2 && <Step2 onNext={() => setStep(3)} />}
          {step === 3 && (
            <Step3 ldapData={ldapData} setLdapData={setLdapData} onNext={() => setStep(4)} />
          )}
          {step === 4 && (
            <StepEntra
              onSave={(creds) => { setEntraCreds(creds); setStep(5) }}
              onSkip={() => { setEntraCreds(false); setStep(5) }}
            />
          )}
          {step === 5 && (
            <StepExchangePS
              onSave={() => setStep(6)}
              onSkip={() => setStep(6)}
            />
          )}
          {step === 6 && (
            <Step5 ldapData={ldapData} entraCreds={entraCreds} onFinish={handleFinish} />
          )}
        </Card>
      </div>
    </div>
  )
}
