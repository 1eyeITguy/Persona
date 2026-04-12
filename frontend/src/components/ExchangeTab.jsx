/**
 * ExchangeTab — Exchange Online mailbox data with SOA-aware rendering.
 *
 * Fetches GET /api/v1/exchange/user/{upn}/mailbox and adapts display
 * based on the resolved Source of Authority:
 *   cloud          — show mailbox data from Graph API
 *   stale_ad_attrs — warn that AD Exchange data is frozen post-migration
 *   unknown        — warn that SOA can't be determined without Entra
 *   none           — show "no mailbox"
 */

import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, AlertTriangle, Mail, MailX, ExternalLink, Users, Share2 } from 'lucide-react'
import axios from 'axios'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SectionHeading({ children }) {
  return (
    <h3 className="mb-2 mt-6 first:mt-0 text-xs font-semibold uppercase tracking-wider text-slate-500">
      {children}
    </h3>
  )
}

function Field({ label, value }) {
  const display = value === null || value === undefined || value === '' ? null : String(value)
  return (
    <div className="grid grid-cols-[11rem_1fr] gap-x-4 border-b border-border-subtle/40 py-2 last:border-0">
      <dt className="self-start pt-px text-xs text-slate-500">{label}</dt>
      <dd className="break-all text-sm text-slate-200">
        {display ?? <span className="text-slate-600">—</span>}
      </dd>
    </div>
  )
}

function WarningCard({ title, message, children }) {
  return (
    <div className="rounded-md border border-warning/30 bg-warning/5 px-4 py-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="flex-1">
          <p className="text-sm font-medium text-warning">{title}</p>
          <p className="mt-1 text-sm text-slate-400">{message}</p>
          {children}
        </div>
      </div>
    </div>
  )
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const gb = bytes / (1024 ** 3)
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = bytes / (1024 ** 2)
  if (mb >= 1) return `${mb.toFixed(0)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

// ---------------------------------------------------------------------------
// State: CLOUD — tabbed layout
// ---------------------------------------------------------------------------

const INNER_TABS = [
  { id: 'email',  label: 'Email Addresses' },
  { id: 'groups', label: 'Distribution Groups' },
  { id: 'shared', label: 'Shared Access' },
]

function CloudMailboxView({ data, sizeBytes, sizeLoading, shared, sharedLoading, onLoadShared }) {
  const [innerTab, setInnerTab] = useState('email')

  function handleTab(id) {
    setInnerTab(id)
    // Auto-trigger load the first time the Shared tab is selected
    if (id === 'shared' && shared === null && !sharedLoading) {
      onLoadShared()
    }
  }

  const emailCount = data.proxy_addresses?.length ?? 0
  const groupCount = data.distribution_groups?.length ?? 0

  return (
    <div>
      {/* Summary fields — always visible */}
      <SectionHeading>Exchange Online</SectionHeading>
      <dl>
        <Field label="Primary email"  value={data.primary_email} />
        <Field label="Display name"   value={data.display_name} />
        <Field
          label="Mailbox size"
          value={sizeLoading ? 'Loading...' : sizeBytes ? formatBytes(sizeBytes) : null}
        />
        <Field
          label="Archive"
          value={data.archive_enabled === true ? 'Enabled' : data.archive_enabled === false ? 'Disabled' : null}
        />
        <Field
          label="Out of office"
          value={data.ooo_enabled === true ? 'On' : data.ooo_enabled === false ? 'Off' : null}
        />
      </dl>

      {/* Mini tab bar */}
      <div className="mt-5 flex border-b border-border-subtle">
        {INNER_TABS.map(tab => {
          const count = tab.id === 'email' ? emailCount : tab.id === 'groups' ? groupCount : null
          const active = innerTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => handleTab(tab.id)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                active
                  ? 'border-brand-primary text-brand-primary'
                  : 'border-transparent text-slate-400 hover:border-slate-600 hover:text-slate-200'
              }`}
            >
              {tab.label}
              {count !== null && count > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-xs leading-none ${
                  active ? 'bg-brand-primary/20 text-brand-primary' : 'bg-slate-700 text-slate-400'
                }`}>
                  {count}
                </span>
              )}
              {/* Spinner on shared tab while loading */}
              {tab.id === 'shared' && sharedLoading && (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div className="mt-3">

        {innerTab === 'email' && (
          emailCount > 0 ? (
            <ul className="space-y-1">
              {data.proxy_addresses.map((addr, i) => (
                <li key={i} className="flex items-center gap-2 rounded-md border border-border-subtle/40 bg-app-bg/40 px-3 py-1.5">
                  <Mail className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  <span className="flex-1 font-mono text-xs text-slate-300">{addr.address}</span>
                  <span className={`text-xs font-medium ${addr.is_primary ? 'text-brand-primary' : 'text-slate-500'}`}>
                    {addr.is_primary ? 'Primary' : addr.protocol?.toLowerCase() === 'smtp' ? 'Alias' : addr.protocol}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No email addresses found.</p>
          )
        )}

        {innerTab === 'groups' && (
          groupCount > 0 ? (
            <ul className="space-y-1">
              {data.distribution_groups.map((g, i) => (
                <li key={i} className="flex items-center gap-2 rounded-md border border-border-subtle/40 bg-app-bg/40 px-3 py-1.5">
                  <Users className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  <span className="flex-1 text-sm text-slate-300">{g.name}</span>
                  {g.mail && <span className="font-mono text-xs text-slate-500">{g.mail}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No distribution group membership.</p>
          )
        )}

        {innerTab === 'shared' && (
          sharedLoading ? (
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading… this may take a minute
            </p>
          ) : shared === null ? (
            // Shouldn't be visible — load triggers on tab click — but just in case
            <p className="text-xs text-slate-600">Initializing…</p>
          ) : shared.length === 0 ? (
            <p className="text-sm text-slate-500">No shared mailbox access found.</p>
          ) : (
            <ul className="space-y-1">
              {shared.map((s, i) => (
                <li key={i} className="flex items-center gap-2 rounded-md border border-border-subtle/40 bg-app-bg/40 px-3 py-1.5">
                  <Share2 className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  <div className="flex-1">
                    <span className="text-sm text-slate-300">{s.display_name}</span>
                    {s.email && s.email !== s.display_name && (
                      <span className="ml-2 font-mono text-xs text-slate-500">{s.email}</span>
                    )}
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                    s.access_type === 'FullAccess'
                      ? 'border-brand-primary/30 bg-brand-primary/10 text-brand-primary'
                      : 'border-slate-500/30 bg-slate-500/10 text-slate-400'
                  }`}>
                    {s.access_type}
                  </span>
                </li>
              ))}
            </ul>
          )
        )}

      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main ExchangeTab
// ---------------------------------------------------------------------------

export default function ExchangeTab({ upn, getToken, onSoaResolved }) {
  const [mailbox, setMailbox]         = useState(null)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)
  const [sizeBytes, setSizeBytes]     = useState(null)
  const [sizeLoading, setSizeLoading] = useState(false)
  const [shared, setShared]           = useState(null)    // null = not loaded yet
  const [sharedLoading, setSharedLoading] = useState(false)

  useEffect(() => {
    if (!upn) return
    setMailbox(null)
    setSizeBytes(null)
    setShared(null)
    setError(null)
    setLoading(true)

    const token = getToken()
    const headers = token ? { Authorization: `Bearer ${token}` } : {}

    axios
      .get(`/api/v1/exchange/user/${encodeURIComponent(upn)}/mailbox`, { headers })
      .then(res => {
        setMailbox(res.data)
        onSoaResolved?.(res.data.soa)

        // Auto-load size (fast — single Get-EXOMailboxStatistics call)
        if (res.data.soa === 'cloud') {
          setSizeLoading(true)
          axios
            .get(`/api/v1/exchange/user/${encodeURIComponent(upn)}/extended`, { headers })
            .then(ext => setSizeBytes(ext.data.mailbox_size_bytes ?? null))
            .catch(() => {})
            .finally(() => setSizeLoading(false))
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [upn]) // eslint-disable-line react-hooks/exhaustive-deps

  function loadSharedAccess() {
    const token = getToken()
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    setSharedLoading(true)
    setShared(null)
    axios
      .get(`/api/v1/exchange/user/${encodeURIComponent(upn)}/shared-access`, { headers })
      .then(res => setShared(res.data.shared_mailbox_access ?? []))
      .catch(() => setShared([]))
      .finally(() => setSharedLoading(false))
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Exchange data…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-danger">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Failed to load Exchange data.
      </div>
    )
  }

  if (!mailbox) return null

  // ── CLOUD ──────────────────────────────────────────────────────────────────
  if (mailbox.soa === 'cloud') {
    return (
      <CloudMailboxView
        data={mailbox}
        sizeBytes={sizeBytes}
        sizeLoading={sizeLoading}
        shared={shared}
        sharedLoading={sharedLoading}
        onLoadShared={loadSharedAccess}
      />
    )
  }

  // ── STALE_AD_ATTRS ─────────────────────────────────────────────────────────
  if (mailbox.soa === 'stale_ad_attrs') {
    return (
      <WarningCard
        title="Exchange data in AD is not current"
        message={
          "This user's mailbox was migrated to Exchange Online. " +
          "Active Directory still contains old mailbox data from before the migration. " +
          "That data is no longer accurate."
        }
      >
        {/* Entra is required to see current data — if not connected show prompt */}
        <p className="mt-3 text-sm text-slate-400">
          Connect Entra ID to see current mailbox details from Exchange Online.
        </p>
        <Link
          to="/settings"
          className="mt-2 inline-flex items-center gap-1 text-sm text-brand-primary hover:underline"
        >
          Go to Settings <ExternalLink className="h-3 w-3" />
        </Link>
      </WarningCard>
    )
  }

  // ── UNKNOWN ────────────────────────────────────────────────────────────────
  if (mailbox.soa === 'unknown') {
    return (
      <WarningCard
        title="Exchange status unknown"
        message={
          "This organization manages Exchange Online independently of Active Directory. " +
          "Connect Entra ID to see mailbox details."
        }
      >
        <Link
          to="/settings"
          className="mt-2 inline-flex items-center gap-1 text-sm text-brand-primary hover:underline"
        >
          Go to Settings <ExternalLink className="h-3 w-3" />
        </Link>
      </WarningCard>
    )
  }

  // ── ON_PREM ────────────────────────────────────────────────────────────────
  if (mailbox.soa === 'on_prem') {
    return (
      <div className="rounded-md border border-border-subtle/50 bg-app-bg/60 px-4 py-4">
        <p className="text-sm font-medium text-slate-300">Exchange Server (on-premises)</p>
        <p className="mt-1 text-sm text-slate-500">
          This user's mailbox is hosted on an on-premises Exchange Server.
          On-premises Exchange data access is not yet available in this version.
        </p>
      </div>
    )
  }

  // ── NONE ───────────────────────────────────────────────────────────────────
  return (
    <div className="rounded-md border border-border-subtle/50 bg-app-bg/60 px-4 py-8 text-center">
      <MailX className="mx-auto mb-2 h-8 w-8 text-slate-600" />
      <p className="text-sm text-slate-500">No mailbox assigned</p>
    </div>
  )
}
