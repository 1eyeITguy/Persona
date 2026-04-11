import { useState, useEffect, useMemo } from 'react'
import { X, Loader2, AlertCircle, User, Search, Monitor } from 'lucide-react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext.jsx'
import { getInitials, formatDate } from '../utils.js'
import teamsIconUrl from '../assets/teams-icon.jpg'

// ---------------------------------------------------------------------------
// Status badge (supports optional label prefix like "AD:" or "Entra:")
// ---------------------------------------------------------------------------

const STATUS_STYLES = {
  Enabled:      'bg-success/15 text-success border-success/20',
  Disabled:     'bg-danger/15 text-danger border-danger/20',
  'Locked Out': 'bg-warning/15 text-warning border-warning/20',
  Active:       'bg-success/15 text-success border-success/20',
  Inactive:     'bg-danger/15 text-danger border-danger/20',
}

function StatusBadge({ status, label }) {
  const cls = STATUS_STYLES[status] ?? 'bg-slate-500/15 text-slate-400 border-slate-500/20'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label && <span className="opacity-70">{label}:</span>}
      {status}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Group type badge
// ---------------------------------------------------------------------------

const GROUP_TYPE_STYLES = {
  Security:     'bg-slate-500/20 text-slate-300 border-slate-500/30',
  M365:         'bg-blue-500/20 text-blue-300 border-blue-500/30',
  Dynamic:      'bg-purple-500/20 text-purple-300 border-purple-500/30',
  Distribution: 'bg-slate-600/20 text-slate-400 border-slate-600/30',
}

function GroupTypeBadge({ type }) {
  const cls = GROUP_TYPE_STYLES[type] ?? GROUP_TYPE_STYLES.Distribution
  return (
    <span className={`ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium shrink-0 ${cls}`}>
      {type}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Shared field components
// ---------------------------------------------------------------------------

function Field({ label, value, mono = false }) {
  const display = value === null || value === undefined || value === '' ? null : String(value)
  return (
    <div className="grid grid-cols-[11rem_1fr] gap-x-4 border-b border-border-subtle/40 py-2 last:border-0">
      <dt className="self-start pt-px text-xs text-slate-500">{label}</dt>
      <dd className={`break-all text-sm ${mono ? 'font-mono text-xs text-slate-300' : 'text-slate-200'}`}>
        {display ?? <span className="text-slate-600">—</span>}
      </dd>
    </div>
  )
}

function FlagField({ label, checked }) {
  return (
    <label className="flex cursor-default items-center gap-2.5 py-1">
      <span
        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
          checked ? 'border-brand-primary bg-brand-primary' : 'border-slate-600 bg-transparent'
        }`}
      >
        {checked && (
          <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 10 10" fill="none">
            <path d="M1.5 5l2.5 2.5 5-5" stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="text-sm text-slate-300">{label}</span>
    </label>
  )
}

function SectionHeading({ children }) {
  return (
    <h3 className="mb-2 mt-6 first:mt-0 text-xs font-semibold uppercase tracking-wider text-slate-500">
      {children}
    </h3>
  )
}

function BadgeList({ items, colorClass }) {
  if (!items?.length) return <p className="text-sm text-slate-500">None</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(item => (
        <span key={item} className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${colorClass}`}>
          {item}
        </span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'identity',     label: 'Identity' },
  { id: 'auth-methods', label: 'Authentication Methods' },
  { id: 'licenses',     label: 'Licenses' },
  { id: 'account',      label: 'Account' },
  { id: 'contact',      label: 'Contact' },
  { id: 'organization', label: 'Organization' },
  { id: 'member-of',    label: 'Member Of' },
  { id: 'devices',      label: 'Devices' },
  { id: 'attributes',   label: 'Attributes' },
]

// ---------------------------------------------------------------------------
// Tab: Identity (UPN, SAM, Entra data)
// ---------------------------------------------------------------------------

function IdentityTab({ user }) {
  return (
    <div>
      <SectionHeading>Account Identifiers</SectionHeading>
      <dl>
        <Field label="User Principal Name" value={user.upn} mono />
        <Field label="SAM Account Name"    value={user.sam_account_name} mono />
        <Field label="Distinguished Name"  value={user.dn} mono />
      </dl>

      {user.is_synced && (
        <>
          <SectionHeading>Entra Identity</SectionHeading>
          <dl>
            <Field label="Entra Object ID" value={user.entra_object_id} mono />
            <Field label="Last Sign-in"    value={formatDate(user.entra_last_sign_in)} />
          </dl>
        </>
      )}

      {!user.is_synced && (
        <div className="mt-6 rounded-md border border-border-subtle/50 bg-app-bg/60 px-4 py-3">
          <p className="text-sm text-slate-500">
            This user has no Entra counterpart. Cloud identity data is not available.
          </p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab: Authentication Methods
// ---------------------------------------------------------------------------

function AuthMethodsTab({ user }) {
  const methods    = user.entra_mfa_methods ?? []
  const defaultMfa = user.entra_default_mfa_method

  if (!user.is_synced) {
    return (
      <div className="rounded-md border border-border-subtle/50 bg-app-bg/60 px-4 py-3">
        <p className="text-sm text-slate-500">Cloud identity data is not available for AD-only users.</p>
      </div>
    )
  }

  if (!methods.length) {
    return (
      <div className="rounded-md border border-warning/20 bg-warning/5 px-4 py-3">
        <p className="text-sm text-warning">No authentication methods registered.</p>
        <p className="mt-1 text-xs text-slate-500">This account may be at higher risk. Consider requiring MFA enrollment.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Default sign-in method */}
      {defaultMfa && (
        <div className="flex items-start gap-3 rounded-md border border-brand-primary/30 bg-brand-primary/5 px-4 py-3">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="6.5"/>
            <path d="M8 5v3.5l2 2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div>
            <p className="text-xs text-slate-500">Default sign-in method</p>
            <p className="text-sm font-medium text-slate-200">{defaultMfa}</p>
          </div>
        </div>
      )}

      {/* Methods table */}
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border-subtle">
            <th className="pb-2 pr-8 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              Authentication method
            </th>
            <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              Detail
            </th>
          </tr>
        </thead>
        <tbody>
          {methods.map((m, i) => (
            <tr key={i} className="border-b border-border-subtle/30 hover:bg-white/[0.02]">
              <td className="py-2.5 pr-8 text-sm text-slate-200">{m.method_type}</td>
              <td className="py-2.5 text-sm text-slate-400">{m.detail || <span className="text-slate-600">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// License assign / unassign modal (shared by LicensesTab + LicenseCardList)
// ---------------------------------------------------------------------------

/** Generic confirmation dialog — appears above any existing modals. */
function ConfirmDialog({ title, children, confirmLabel, danger = false, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70" onClick={onCancel}>
      <div
        className="w-[420px] rounded-lg border border-border-subtle bg-surface shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
          <div className="mt-2 text-sm text-slate-400 space-y-1">{children}</div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-md px-4 py-1.5 text-xs font-medium text-white transition-colors ${
              danger
                ? 'bg-danger hover:bg-danger/80'
                : 'bg-brand-primary hover:bg-brand-primary/80'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Full-screen modal for managing all tenant licenses.
 * Pre-checks currently assigned ones; user can check/uncheck to stage changes.
 */
function LicenseAssignModal({ currentLicenses, tenantLicenses, licenseConfig = {}, tenantLoading, saving, onClose, onApply }) {
  const assignedSkuIds = new Set(currentLicenses.map(l => l.sku_id))

  // selections: sku_id → true (should be assigned after save)
  const [selections, setSelections] = useState(
    () => Object.fromEntries(currentLicenses.map(l => [l.sku_id, true]))
  )
  const [q, setQ] = useState('')
  const [confirming, setConfirming] = useState(false)

  // Apply custom display names from config
  function resolvedName(lic) {
    return licenseConfig[lic.sku_id]?.display_name || lic.display_name
  }

  // A license is visible in the modal if:
  //   - it is marked assignable in config, OR
  //   - it is already assigned to the user (so they can uncheck/remove it)
  const hasConfig = Object.keys(licenseConfig).length > 0
  const visibleLicenses = (tenantLicenses ?? []).filter(t =>
    !hasConfig ||                             // no config yet — show everything
    licenseConfig[t.sku_id]?.assignable ||    // marked assignable
    assignedSkuIds.has(t.sku_id)              // already assigned — always show
  )

  function toggle(skuId, noSeats) {
    if (noSeats) return
    setSelections(prev => ({ ...prev, [skuId]: !prev[skuId] }))
  }

  const filtered = visibleLicenses.filter(t =>
    !q || resolvedName(t).toLowerCase().includes(q.toLowerCase()) ||
          t.sku_part_number.toLowerCase().includes(q.toLowerCase())
  )

  const toAdd    = visibleLicenses.filter(t => selections[t.sku_id] && !assignedSkuIds.has(t.sku_id)).map(t => t.sku_id)
  const toRemove = currentLicenses.filter(l => !selections[l.sku_id]).map(l => l.sku_id)
  const hasChanges = toAdd.length > 0 || toRemove.length > 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="flex w-[540px] max-h-[80vh] flex-col rounded-lg border border-border-subtle bg-surface shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Manage Licenses</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Check to assign · uncheck to remove
              {hasConfig && <span className="ml-1 text-slate-600">· showing assignable + current</span>}
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-white/5 hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="shrink-0 border-b border-border-subtle px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search licenses…"
              value={q}
              onChange={e => setQ(e.target.value)}
              className="w-full rounded-md border border-border-subtle bg-app-bg py-1.5 pl-8 pr-3 text-sm text-slate-200 placeholder:text-slate-500 focus:border-brand-primary focus:outline-none"
            />
          </div>
        </div>

        {/* License list */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {tenantLoading && (
            <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />Loading licenses…
            </div>
          )}
          {!tenantLoading && filtered.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-500">No licenses match &ldquo;{q}&rdquo;</p>
          )}
          <ul className="space-y-2">
            {filtered.map(lic => {
              const isAssigned = assignedSkuIds.has(lic.sku_id)
              const isSelected = selections[lic.sku_id] ?? false
              const noSeats    = lic.available === 0 && !isAssigned
              const willAdd    = isSelected && !isAssigned
              const willRemove = !isSelected && isAssigned

              return (
                <li
                  key={lic.sku_id}
                  onClick={() => toggle(lic.sku_id, noSeats)}
                  title={noSeats ? 'No available seats in tenant' : undefined}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors ${
                    noSeats     ? 'cursor-not-allowed border-border-subtle/30 bg-app-bg/30 opacity-40' :
                    willAdd     ? 'border-success/40 bg-success/5' :
                    willRemove  ? 'border-danger/30 bg-danger/5' :
                    isSelected  ? 'border-brand-primary/40 bg-brand-primary/10' :
                                  'border-border-subtle bg-app-bg/60 hover:border-slate-600'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={noSeats}
                    onChange={() => toggle(lic.sku_id, noSeats)}
                    onClick={e => e.stopPropagation()}
                    className="mt-0.5 accent-brand-primary shrink-0 disabled:cursor-not-allowed"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-200">{resolvedName(lic)}</p>
                    <p className="truncate text-xs text-slate-600">{lic.sku_part_number}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      <span className={lic.available === 0 ? 'text-warning' : ''}>
                        {lic.assigned.toLocaleString()} assigned
                      </span>
                      {' · '}
                      <span className={lic.available === 0 ? 'text-warning' : 'text-success'}>
                        {lic.available.toLocaleString()} available
                      </span>
                      {' of '}{lic.total.toLocaleString()} total
                    </p>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    {isAssigned && !willRemove && (
                      <span className="text-[10px] text-brand-primary font-medium">Current</span>
                    )}
                    {willAdd    && <span className="text-[10px] text-success font-medium">+ Assign</span>}
                    {willRemove && <span className="text-[10px] text-danger font-medium">− Remove</span>}
                    {noSeats    && <span className="text-[10px] text-slate-500">No seats</span>}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between border-t border-border-subtle px-5 py-3">
          <p className="text-xs text-slate-500">
            {hasChanges ? (
              <>
                {toAdd.length > 0 && <span className="text-success">+{toAdd.length} to assign</span>}
                {toAdd.length > 0 && toRemove.length > 0 && <span className="mx-1 text-slate-600">·</span>}
                {toRemove.length > 0 && <span className="text-danger">−{toRemove.length} to remove</span>}
              </>
            ) : (
              'No changes'
            )}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="rounded-md px-3 py-1.5 text-xs text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => setConfirming(true)}
              disabled={!hasChanges || saving}
              className="flex items-center gap-1.5 rounded-md bg-brand-primary px-4 py-1.5 text-xs font-medium text-white hover:bg-brand-primary/80 disabled:opacity-50 transition-colors"
            >
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
              Apply Changes
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation dialog */}
      {confirming && (() => {
        const tenantMap = Object.fromEntries((tenantLicenses ?? []).map(t => [t.sku_id, t]))
        const addNames    = toAdd.map(id => tenantMap[id]?.display_name ?? id)
        const removeNames = toRemove.map(id => {
          const cur = currentLicenses.find(l => l.sku_id === id)
          return cur?.display_name ?? tenantMap[id]?.display_name ?? id
        })
        return (
          <ConfirmDialog
            title="Confirm License Changes"
            confirmLabel="Apply Changes"
            onConfirm={() => { setConfirming(false); onApply(toAdd, toRemove) }}
            onCancel={() => setConfirming(false)}
          >
            {addNames.length > 0 && (
              <div>
                <p className="font-medium text-success">Assigning:</p>
                <ul className="mt-1 ml-3 list-disc space-y-0.5">
                  {addNames.map(n => <li key={n}>{n}</li>)}
                </ul>
              </div>
            )}
            {removeNames.length > 0 && (
              <div>
                <p className="font-medium text-danger">Removing:</p>
                <ul className="mt-1 ml-3 list-disc space-y-0.5">
                  {removeNames.map(n => <li key={n}>{n}</li>)}
                </ul>
              </div>
            )}
          </ConfirmDialog>
        )
      })()}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab: Licenses
// ---------------------------------------------------------------------------

function LicensesTab({ user }) {
  const { getToken } = useAuth()
  const entraObjectId = user.entra_object_id

  // Local copy — updated after saves so panel reflects changes immediately
  const [assigned, setAssigned] = useState(user.entra_licenses ?? [])

  // For unassign: checkboxes on the main list (checked = marked for removal)
  const [markedForRemoval, setMarkedForRemoval] = useState(new Set())

  // Modal
  const [modalOpen, setModalOpen]           = useState(false)
  const [tenantLicenses, setTenantLicenses] = useState(null)
  const [licenseConfig, setLicenseConfig]   = useState({}) // {sku_id: LicenseConfigEntry}
  const [tenantLoading, setTenantLoading]   = useState(false)

  // Action state
  const [saving, setSaving]                 = useState(false)
  const [error, setError]                   = useState(null)
  const [success, setSuccess]               = useState(null)
  const [confirmUnassign, setConfirmUnassign] = useState(false)

  function fetchTenant() {
    setTenantLoading(true)
    const token = getToken()
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    Promise.all([
      axios.get('/api/v1/entra/licenses',          { headers }),
      axios.get('/api/v1/settings/license-config', { headers }),
    ])
      .then(([licRes, cfgRes]) => {
        setTenantLicenses(licRes.data)
        setLicenseConfig(Object.fromEntries(cfgRes.data.map(c => [c.sku_id, c])))
      })
      .catch(() => { setTenantLicenses([]); setLicenseConfig({}) })
      .finally(() => setTenantLoading(false))
  }

  function openModal() {
    if (!tenantLicenses) fetchTenant()
    setModalOpen(true)
    setError(null)
    setSuccess(null)
  }

  function toggleRemoval(skuId) {
    setMarkedForRemoval(prev => {
      const next = new Set(prev)
      next.has(skuId) ? next.delete(skuId) : next.add(skuId)
      return next
    })
    setError(null)
    setSuccess(null)
  }

  async function callApi(toAdd, toRemove) {
    const token = getToken()
    const params = new URLSearchParams()
    toAdd.forEach(id => params.append('add', id))
    toRemove.forEach(id => params.append('remove', id))
    await axios.post(
      `/api/v1/entra/users/${encodeURIComponent(entraObjectId)}/assign-licenses?${params}`,
      null,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    )
    // Refresh tenant counts
    const res = await axios.get('/api/v1/entra/licenses', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    setTenantLicenses(res.data)
  }

  async function handleUnassign() {
    if (!markedForRemoval.size) return
    setSaving(true)
    setError(null)
    try {
      await callApi([], [...markedForRemoval])
      setAssigned(prev => prev.filter(l => !markedForRemoval.has(l.sku_id)))
      setMarkedForRemoval(new Set())
      setSuccess(`${markedForRemoval.size} license${markedForRemoval.size !== 1 ? 's' : ''} removed.`)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to remove licenses.')
    } finally {
      setSaving(false)
    }
  }

  async function handleModalApply(toAdd, toRemove) {
    if (!toAdd.length && !toRemove.length) { setModalOpen(false); return }
    setSaving(true)
    setError(null)
    try {
      await callApi(toAdd, toRemove)
      // Build updated assigned list
      const tenantMap = Object.fromEntries((tenantLicenses ?? []).map(t => [t.sku_id, t]))
      const afterRemove = assigned.filter(l => !toRemove.includes(l.sku_id))
      const newLicenses = toAdd
        .map(id => tenantMap[id])
        .filter(Boolean)
        .map(t => ({ sku_id: t.sku_id, sku_part_number: t.sku_part_number, display_name: t.display_name }))
      setAssigned([...afterRemove, ...newLicenses])
      setMarkedForRemoval(new Set())
      setModalOpen(false)
      setSuccess('Licenses updated.')
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to update licenses.')
    } finally {
      setSaving(false)
    }
  }

  if (!user.is_synced) {
    return (
      <div className="rounded-md border border-border-subtle/50 bg-app-bg/60 px-4 py-3">
        <p className="text-sm text-slate-500">Cloud identity data is not available for AD-only users.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          {assigned.length} license{assigned.length !== 1 ? 's' : ''} assigned
        </p>
        <button
          onClick={openModal}
          className="flex items-center gap-1.5 rounded-md border border-brand-primary/40 bg-brand-primary/10 px-3 py-1.5 text-xs font-medium text-brand-primary transition-colors hover:bg-brand-primary/20"
        >
          + Assign Additional License
        </button>
      </div>

      {/* Status messages */}
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}
        </div>
      )}
      {success && !error && (
        <div className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-xs text-success">
          {success}
        </div>
      )}

      {/* Assigned license list */}
      {!assigned.length ? (
        <p className="text-sm text-slate-500">No licenses assigned.</p>
      ) : (
        <>
          <ul className="space-y-2">
            {assigned.map(lic => {
              const marked = markedForRemoval.has(lic.sku_id)
              return (
                <li
                  key={lic.sku_id}
                  onClick={() => toggleRemoval(lic.sku_id)}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors ${
                    marked
                      ? 'border-danger/40 bg-danger/5'
                      : 'border-brand-primary/30 bg-brand-primary/5 hover:border-brand-primary/50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={marked}
                    onChange={() => toggleRemoval(lic.sku_id)}
                    onClick={e => e.stopPropagation()}
                    className="mt-0.5 accent-danger shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-200">{lic.display_name}</p>
                    <p className="truncate text-xs text-slate-600">{lic.sku_part_number}</p>
                  </div>
                  {marked && <span className="shrink-0 text-xs font-medium text-danger">− Remove</span>}
                </li>
              )
            })}
          </ul>

          {/* Unassign button */}
          {markedForRemoval.size > 0 && (
            <button
              onClick={() => setConfirmUnassign(true)}
              disabled={saving}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm font-medium text-danger hover:bg-danger/20 disabled:opacity-60 transition-colors"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Unassign {markedForRemoval.size} License{markedForRemoval.size !== 1 ? 's' : ''}
            </button>
          )}
        </>
      )}

      {/* Unassign confirmation */}
      {confirmUnassign && (
        <ConfirmDialog
          title="Confirm License Removal"
          confirmLabel="Unassign"
          danger
          onConfirm={() => { setConfirmUnassign(false); handleUnassign() }}
          onCancel={() => setConfirmUnassign(false)}
        >
          <p>Remove the following license{markedForRemoval.size !== 1 ? 's' : ''} from this user?</p>
          <ul className="mt-1 ml-3 list-disc space-y-0.5">
            {assigned
              .filter(l => markedForRemoval.has(l.sku_id))
              .map(l => <li key={l.sku_id}>{l.display_name}</li>)
            }
          </ul>
        </ConfirmDialog>
      )}

      {/* Modal */}
      {modalOpen && (
        <LicenseAssignModal
          currentLicenses={assigned}
          tenantLicenses={tenantLicenses}
          licenseConfig={licenseConfig}
          tenantLoading={tenantLoading}
          saving={saving}
          onClose={() => { setModalOpen(false); setError(null) }}
          onApply={handleModalApply}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab: Account
// ---------------------------------------------------------------------------

function AccountTab({ user }) {
  return (
    <div>
      <SectionHeading>Account Options</SectionHeading>
      <div className="space-y-0.5">
        <FlagField
          label="User must change password at next logon"
          checked={user.must_change_password && !user.uac_flags?.['Password never expires']}
        />
        {Object.entries(user.uac_flags ?? {}).map(([label, val]) => (
          <FlagField key={label} label={label} checked={val} />
        ))}
      </div>

      <SectionHeading>Account Activity</SectionHeading>
      <dl>
        <Field label="Account expires"    value={formatDate(user.account_expires) ?? user.account_expires} />
        <Field label="Password last set"  value={formatDate(user.pwd_last_set)} />
        <Field label="Last logon (AD)"    value={formatDate(user.last_logon)} />
        <Field label="Logon count"        value={user.logon_count} />
        <Field label="Bad password count" value={user.bad_pwd_count} />
        <Field label="Bad password time"  value={formatDate(user.bad_password_time)} />
        {user.lockout_time && (
          <Field label="Locked out at" value={formatDate(user.lockout_time)} />
        )}
      </dl>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab: Contact
// ---------------------------------------------------------------------------

function ContactTab({ user }) {
  return (
    <div>
      <SectionHeading>Contact</SectionHeading>
      <dl>
        <Field label="Email"     value={user.mail} />
        <Field label="Telephone" value={user.telephone_number} />
        <Field label="Mobile"    value={user.mobile} />
        <Field label="Office"    value={user.office} />
        <Field label="Web page"  value={user.web_page} />
      </dl>

      <SectionHeading>Address</SectionHeading>
      <dl>
        <Field label="Street"            value={user.street_address} />
        <Field label="City"              value={user.city} />
        <Field label="State / Province"  value={user.state} />
        <Field label="Postal code"       value={user.postal_code} />
        <Field label="Country"           value={user.country} />
      </dl>

      <SectionHeading>Profile Paths</SectionHeading>
      <dl>
        <Field label="Profile path"  value={user.profile_path}  mono />
        <Field label="Logon script"  value={user.logon_script}  mono />
        <Field label="Home drive"    value={user.home_drive}    mono />
        <Field label="Home directory" value={user.home_directory} mono />
      </dl>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab: Organization
// ---------------------------------------------------------------------------

/** Small avatar used for manager / direct report cards. */
function UserAvatar({ photo, name, size = 'sm' }) {
  const [err, setErr] = useState(false)
  const dim = size === 'lg' ? 'h-10 w-10 text-sm' : 'h-8 w-8 text-xs'
  if (photo && !err) {
    return (
      <img
        src={photo}
        alt=""
        onError={() => setErr(true)}
        className={`${dim} shrink-0 rounded-full object-cover ring-1 ring-white/10`}
      />
    )
  }
  return (
    <div className={`${dim} flex shrink-0 select-none items-center justify-center rounded-full bg-brand-primary/30 font-bold text-brand-primary`}>
      {getInitials(name)}
    </div>
  )
}

function OrganizationTab({ user, onUserSelect }) {
  return (
    <div>
      <dl>
        <Field label="Title"       value={user.title} />
        <Field label="Department"  value={user.department} />
        <Field label="Company"     value={user.company} />
        <Field label="Description" value={user.description} />
      </dl>

      {user.manager_display_name && (
        <>
          <SectionHeading>Manager</SectionHeading>
          <button
            onClick={() => onUserSelect?.(user.manager_dn)}
            className="flex w-full items-center gap-3 rounded-md border border-border-subtle/50 bg-app-bg/60 px-3 py-2.5 text-left transition-colors hover:border-brand-primary/40 hover:bg-brand-primary/5"
          >
            <UserAvatar photo={user.manager_photo} name={user.manager_display_name} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-brand-primary">{user.manager_display_name}</p>
              {user.manager_title && (
                <p className="truncate text-xs text-slate-500">{user.manager_title}</p>
              )}
            </div>
          </button>
        </>
      )}

      {user.direct_reports?.length > 0 && (
        <>
          <SectionHeading>Direct Reports ({user.direct_reports.length})</SectionHeading>
          <ul className="space-y-1.5">
            {user.direct_reports.map(dr => (
              <li key={dr.dn}>
                <button
                  onClick={() => onUserSelect?.(dr.dn)}
                  className="flex w-full items-center gap-3 rounded-md border border-border-subtle/50 bg-app-bg/60 px-3 py-2.5 text-left transition-colors hover:border-brand-primary/40 hover:bg-brand-primary/5"
                >
                  <UserAvatar photo={dr.photo} name={dr.name} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-brand-primary">{dr.name}</p>
                    {dr.title && (
                      <p className="truncate text-xs text-slate-500">{dr.title}</p>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab: Member Of — sortable, selectable, exportable
// ---------------------------------------------------------------------------

/** Download rows as a CSV file. */
export function exportCsv(rows, filename) {
  const header = rows[0] ? Object.keys(rows[0]).join(',') : ''
  const body = rows.map(r =>
    Object.values(r).map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
  ).join('\n')
  const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Microsoft Teams icon — rendered from the official Teams PNG asset. */
function TeamsIcon() {
  return (
    <img
      src={teamsIconUrl}
      alt="Microsoft Teams"
      title="Has Microsoft Teams"
      className="h-5 w-5 shrink-0 object-contain"
    />
  )
}

/** Section order for cloud groups. */
const CLOUD_SECTION_ORDER = ['Security', 'Distribution', 'M365', 'Dynamic']

/** Section order for AD on-prem groups. */
const AD_SECTION_ORDER = ['Security', 'Distribution']

/** Sort a group list by name in the given direction. */
function sortByName(list, dir) {
  return [...list].sort((a, b) => {
    const cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    return dir === 'asc' ? cmp : -cmp
  })
}

/** Group a cloud group list into sections, sorted by name within each section. */
function groupBySections(groups, dir) {
  const result = {}
  for (const s of CLOUD_SECTION_ORDER) {
    result[s] = sortByName(groups.filter(g => g.group_type === s), dir)
  }
  return result
}

/** Group an AD group list into Security / Distribution sections. */
function groupAdBySections(groups, dir) {
  const result = {}
  for (const s of AD_SECTION_ORDER) {
    result[s] = sortByName(groups.filter(g => g.group_type === s), dir)
  }
  return result
}

/** Column header with name sort toggle and select-all + export controls. */
function ColumnHeader({ label, count, sortDir, onSortName,
                        selectedCount, selectableCount, onSelectAll, onExport }) {
  const allSelected = selectableCount > 0 && selectedCount === selectableCount
  const someSelected = selectedCount > 0 && !allSelected

  return (
    <div className="mb-2 space-y-1.5">
      {/* Title row */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={allSelected}
          ref={el => { if (el) el.indeterminate = someSelected }}
          onChange={onSelectAll}
          disabled={selectableCount === 0}
          className="accent-brand-primary cursor-pointer disabled:cursor-default disabled:opacity-40"
          title={allSelected ? 'Deselect all' : 'Select all'}
        />
        <p className="flex-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
          {label} — {count}
          {selectedCount > 0 && (
            <span className="ml-1 text-brand-primary">({selectedCount} selected)</span>
          )}
        </p>
        <button
          onClick={onExport}
          title={selectedCount > 0 ? 'Export selected' : 'Export all'}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-200"
        >
          <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 10v4h12v-4M8 2v8M5 7l3 3 3-3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Export
        </button>
      </div>

      {/* Name sort toggle */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-slate-600 uppercase tracking-wide">Sort:</span>
        <button
          onClick={onSortName}
          className="rounded px-1.5 py-0.5 text-[10px] font-medium text-brand-primary bg-brand-primary/20 transition-colors hover:bg-brand-primary/30"
        >
          Name {sortDir === 'asc' ? '↑' : '↓'}
        </button>
      </div>
    </div>
  )
}

/** Render a single section of AD on-prem groups with checkboxes. */
function AdGroupSection({ title, groups, selected, onToggle }) {
  if (!groups.length) return null
  return (
    <div className="mb-3 last:mb-0">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">{title}</p>
      <ul className="space-y-1.5">
        {groups.map(g => (
          <li key={g.dn}
            onClick={() => onToggle(g.dn)}
            className={`flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 transition-colors ${
              selected.has(g.dn)
                ? 'border-brand-primary/40 bg-brand-primary/10'
                : 'border-border-subtle bg-app-bg/60 hover:border-slate-600'
            }`}
          >
            <input
              type="checkbox"
              checked={selected.has(g.dn)}
              onChange={() => onToggle(g.dn)}
              onClick={e => e.stopPropagation()}
              className="accent-brand-primary shrink-0"
            />
            <span className="truncate text-sm text-slate-200">{g.name}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Render a single section of cloud groups with checkboxes. */
function CloudGroupSection({ title, groups, selected, onToggle, dynamic: isDynamic = false }) {
  if (!groups.length) return null
  return (
    <div className="mb-3 last:mb-0">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">{title}</p>
      <ul className="space-y-1.5">
        {groups.map(g => {
          const checked = selected.has(g.name)
          return (
            <li key={g.name}
              onClick={() => !isDynamic && onToggle(g.name)}
              title={isDynamic ? 'Dynamic groups cannot be manually assigned' : undefined}
              className={`flex items-center gap-2.5 rounded-md border px-3 py-2 transition-colors ${
                isDynamic
                  ? 'cursor-not-allowed border-border-subtle/30 bg-app-bg/30 opacity-40'
                  : checked
                  ? 'cursor-pointer border-brand-primary/40 bg-brand-primary/10'
                  : 'cursor-pointer border-border-subtle bg-app-bg/60 hover:border-slate-600'
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={isDynamic}
                onChange={() => !isDynamic && onToggle(g.name)}
                onClick={e => e.stopPropagation()}
                className="accent-brand-primary shrink-0 disabled:cursor-not-allowed"
              />
              <span className={`flex-1 truncate text-sm ${isDynamic ? 'text-slate-500' : 'text-slate-200'}`}>
                {g.name}
              </span>
              {g.has_team && <TeamsIcon />}
              {title !== 'M365' && <GroupTypeBadge type={g.group_type} />}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function MemberOfTab({ user }) {
  const adGroups  = user.member_of ?? []
  const cloudGroups = user.entra_cloud_groups ?? []
  const isSynced  = user.is_synced

  // ── Sort state ────────────────────────────────────────────────────────────
  const [adSortDir,    setAdSortDir]    = useState('asc')
  const [cloudSortDir, setCloudSortDir] = useState('asc')

  // ── Selection state ───────────────────────────────────────────────────────
  const [adSelected,    setAdSelected]    = useState(new Set())
  const [cloudSelected, setCloudSelected] = useState(new Set())

  // ── Sorted / sectioned lists ──────────────────────────────────────────────
  const adSections     = groupAdBySections(adGroups, adSortDir)
  const allAdFlat      = AD_SECTION_ORDER.flatMap(s => adSections[s])
  const cloudSections  = groupBySections(cloudGroups, cloudSortDir)

  // ── Select all helpers ────────────────────────────────────────────────────
  const adSelectable    = adGroups
  const cloudSelectable = cloudGroups.filter(g => g.group_type !== 'Dynamic')

  function handleAdSelectAll() {
    if (adSelected.size === adSelectable.length) {
      setAdSelected(new Set())
    } else {
      setAdSelected(new Set(adSelectable.map(g => g.dn)))
    }
  }

  function handleCloudSelectAll() {
    if (cloudSelected.size === cloudSelectable.length) {
      setCloudSelected(new Set())
    } else {
      setCloudSelected(new Set(cloudSelectable.map(g => g.name)))
    }
  }

  function toggleAdGroup(dn) {
    setAdSelected(prev => { const n = new Set(prev); n.has(dn) ? n.delete(dn) : n.add(dn); return n })
  }

  function toggleCloudGroup(name) {
    setCloudSelected(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n })
  }

  // ── Export ────────────────────────────────────────────────────────────────
  const allCloudFlat = CLOUD_SECTION_ORDER.flatMap(s => cloudSections[s])

  function exportAd() {
    const rows = (adSelected.size > 0
      ? allAdFlat.filter(g => adSelected.has(g.dn))
      : allAdFlat
    ).map(g => ({ Name: g.name, Type: g.group_type, DN: g.dn, Source: 'AD' }))
    exportCsv(rows, `ad-groups-${Date.now()}.csv`)
  }

  function exportCloud() {
    const rows = (cloudSelected.size > 0
      ? allCloudFlat.filter(g => cloudSelected.has(g.name))
      : allCloudFlat
    ).map(g => ({ Name: g.name, Type: g.group_type, 'Has Team': g.has_team ? 'Yes' : '', Source: 'Entra' }))
    exportCsv(rows, `entra-groups-${Date.now()}.csv`)
  }

  // ── Render: single column (AD-only users) ─────────────────────────────────
  if (!isSynced) {
    if (!adGroups.length) return <p className="text-sm text-slate-500">Not a member of any groups.</p>
    return (
      <div>
        <ColumnHeader
          label="On-Prem (AD)"
          count={adGroups.length}
          sortDir={adSortDir}
          onSortName={() => setAdSortDir(d => d === 'asc' ? 'desc' : 'asc')}
          selectedCount={adSelected.size}
          selectableCount={adSelectable.length}
          onSelectAll={handleAdSelectAll}
          onExport={exportAd}
        />
        {AD_SECTION_ORDER.map(s => (
          <AdGroupSection key={s} title={s} groups={adSections[s]} selected={adSelected} onToggle={toggleAdGroup} />
        ))}
      </div>
    )
  }

  // ── Render: two-column (synced users) ─────────────────────────────────────
  return (
    <div>
      {/* Combined export banner */}
      {(adSelected.size > 0 || cloudSelected.size > 0) && (
        <div className="mb-3 flex items-center justify-between rounded-md border border-brand-primary/30 bg-brand-primary/10 px-3 py-2">
          <span className="text-xs text-slate-300">
            {adSelected.size + cloudSelected.size} group{adSelected.size + cloudSelected.size !== 1 ? 's' : ''} selected
          </span>
          <button
            onClick={() => {
              const adRows = allAdFlat
                .filter(g => adSelected.has(g.dn))
                .map(g => ({ Name: g.name, Source: 'AD', Type: g.group_type, 'Has Team': '', DN: g.dn }))
              const cloudRows = allCloudFlat
                .filter(g => cloudSelected.has(g.name))
                .map(g => ({ Name: g.name, Source: 'Entra', Type: g.group_type, 'Has Team': g.has_team ? 'Yes' : '', DN: '' }))
              exportCsv([...adRows, ...cloudRows], `groups-combined-${Date.now()}.csv`)
            }}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-brand-primary transition-colors hover:bg-brand-primary/10"
          >
            <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 10v4h12v-4M8 2v8M5 7l3 3 3-3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Export combined
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* AD column */}
        <div>
          <ColumnHeader
            label="On-Prem (AD)"
            count={adGroups.length}
            sortDir={adSortDir}
            onSortName={() => setAdSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            selectedCount={adSelected.size}
            selectableCount={adSelectable.length}
            onSelectAll={handleAdSelectAll}
            onExport={exportAd}
          />
          {adGroups.length ? (
            AD_SECTION_ORDER.map(s => (
              <AdGroupSection key={s} title={s} groups={adSections[s]} selected={adSelected} onToggle={toggleAdGroup} />
            ))
          ) : (
            <p className="text-sm text-slate-500">No on-prem groups.</p>
          )}
        </div>

        {/* Entra column — sectioned */}
        <div>
          <ColumnHeader
            label="Cloud (Entra)"
            count={cloudGroups.length}
            sortDir={cloudSortDir}
            onSortName={() => setCloudSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            selectedCount={cloudSelected.size}
            selectableCount={cloudSelectable.length}
            onSelectAll={handleCloudSelectAll}
            onExport={exportCloud}
          />
          {cloudGroups.length ? (
            CLOUD_SECTION_ORDER.map(sectionType => (
              <CloudGroupSection
                key={sectionType}
                title={sectionType}
                groups={cloudSections[sectionType]}
                selected={cloudSelected}
                onToggle={toggleCloudGroup}
                dynamic={sectionType === 'Dynamic'}
              />
            ))
          ) : (
            <p className="text-sm text-slate-500">No cloud groups.</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Exported: standalone cloud groups list (reused by EntraUserDetailPanel)
// ---------------------------------------------------------------------------

/**
 * Sortable, selectable, exportable list of Entra cloud groups.
 * Dynamic groups are grayed out and not selectable.
 * Used standalone in EntraUserDetailPanel where there is no AD column.
 */
export function CloudGroupsList({ groups = [] }) {
  const [sortDir, setSortDir] = useState('asc')
  const [selected, setSelected] = useState(new Set())

  const selectable  = groups.filter(g => g.group_type !== 'Dynamic')
  const sections    = groupBySections(groups, sortDir)
  const allFlat     = CLOUD_SECTION_ORDER.flatMap(s => sections[s])

  const allSelected  = selectable.length > 0 && selected.size === selectable.length
  const someSelected = selected.size > 0 && !allSelected

  function handleSelectAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(selectable.map(g => g.name)))
  }

  function toggleGroup(name) {
    setSelected(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n })
  }

  function handleExport() {
    const rows = (selected.size > 0
      ? allFlat.filter(g => selected.has(g.name))
      : allFlat
    ).map(g => ({ Name: g.name, Type: g.group_type, 'Has Team': g.has_team ? 'Yes' : '', Source: 'Entra' }))
    exportCsv(rows, `entra-groups-${Date.now()}.csv`)
  }

  if (!groups.length) return <p className="text-sm text-slate-500">No cloud group memberships.</p>

  return (
    <div>
      {/* Header */}
      <div className="mb-3 space-y-1.5">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={allSelected}
            ref={el => { if (el) el.indeterminate = someSelected }}
            onChange={handleSelectAll}
            disabled={selectable.length === 0}
            className="accent-brand-primary cursor-pointer disabled:cursor-default disabled:opacity-40"
            title={allSelected ? 'Deselect all' : 'Select all'}
          />
          <p className="flex-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Cloud Groups — {groups.length}
            {selected.size > 0 && <span className="ml-1 text-brand-primary">({selected.size} selected)</span>}
          </p>
          <button
            onClick={handleExport}
            title={selected.size > 0 ? 'Export selected' : 'Export all'}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-200"
          >
            <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 10v4h12v-4M8 2v8M5 7l3 3 3-3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Export
          </button>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-slate-600 uppercase tracking-wide">Sort:</span>
          <button
            onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            className="rounded px-1.5 py-0.5 text-[10px] font-medium text-brand-primary bg-brand-primary/20 transition-colors hover:bg-brand-primary/30"
          >
            Name {sortDir === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      </div>

      {/* Sections */}
      {CLOUD_SECTION_ORDER.map(sectionType => (
        <CloudGroupSection
          key={sectionType}
          title={sectionType}
          groups={sections[sectionType]}
          selected={selected}
          onToggle={toggleGroup}
          dynamic={sectionType === 'Dynamic'}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared device card (used by both UserDetail and EntraUserDetailPanel)
// ---------------------------------------------------------------------------

const COMPLIANCE_STYLES = {
  compliant:    'border-success/20 bg-success/10 text-success',
  noncompliant: 'border-danger/20 bg-danger/10 text-danger',
  unknown:      'border-slate-600/30 bg-slate-700/20 text-slate-400',
}

// ---------------------------------------------------------------------------
// Exported: standalone license manager (reused by EntraUserDetailPanel)
// ---------------------------------------------------------------------------

/**
 * Same assign/unassign UX as LicensesTab but for cloud-only Entra users.
 * Accepts entraObjectId + initial assignedLicenses as props.
 */
export function LicenseCardList({ entraObjectId, assignedLicenses = [] }) {
  const { getToken } = useAuth()
  const [assigned, setAssigned]             = useState(assignedLicenses)
  const [markedForRemoval, setMarkedForRemoval] = useState(new Set())
  const [modalOpen, setModalOpen]           = useState(false)
  const [confirmUnassign, setConfirmUnassign] = useState(false)
  const [tenantLicenses, setTenantLicenses] = useState(null)
  const [licenseConfig, setLicenseConfig]   = useState({})
  const [tenantLoading, setTenantLoading]   = useState(false)
  const [saving, setSaving]                 = useState(false)
  const [error, setError]                   = useState(null)
  const [success, setSuccess]               = useState(null)

  function fetchTenant() {
    setTenantLoading(true)
    const token = getToken()
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    Promise.all([
      axios.get('/api/v1/entra/licenses',          { headers }),
      axios.get('/api/v1/settings/license-config', { headers }),
    ])
      .then(([licRes, cfgRes]) => {
        setTenantLicenses(licRes.data)
        setLicenseConfig(Object.fromEntries(cfgRes.data.map(c => [c.sku_id, c])))
      })
      .catch(() => { setTenantLicenses([]); setLicenseConfig({}) })
      .finally(() => setTenantLoading(false))
  }

  async function callApi(toAdd, toRemove) {
    const token = getToken()
    const params = new URLSearchParams()
    toAdd.forEach(id => params.append('add', id))
    toRemove.forEach(id => params.append('remove', id))
    await axios.post(
      `/api/v1/entra/users/${encodeURIComponent(entraObjectId)}/assign-licenses?${params}`,
      null, { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    )
    const res = await axios.get('/api/v1/entra/licenses', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    setTenantLicenses(res.data)
  }

  async function handleUnassign() {
    if (!markedForRemoval.size) return
    setSaving(true); setError(null)
    try {
      await callApi([], [...markedForRemoval])
      setAssigned(prev => prev.filter(l => !markedForRemoval.has(l.sku_id)))
      setMarkedForRemoval(new Set())
      setSuccess(`${markedForRemoval.size} license${markedForRemoval.size !== 1 ? 's' : ''} removed.`)
    } catch (err) { setError(err.response?.data?.detail || 'Failed to remove licenses.') }
    finally { setSaving(false) }
  }

  async function handleModalApply(toAdd, toRemove) {
    if (!toAdd.length && !toRemove.length) { setModalOpen(false); return }
    setSaving(true); setError(null)
    try {
      await callApi(toAdd, toRemove)
      const tenantMap = Object.fromEntries((tenantLicenses ?? []).map(t => [t.sku_id, t]))
      const afterRemove = assigned.filter(l => !toRemove.includes(l.sku_id))
      const newLics = toAdd.map(id => tenantMap[id]).filter(Boolean)
        .map(t => ({ sku_id: t.sku_id, sku_part_number: t.sku_part_number, display_name: t.display_name }))
      setAssigned([...afterRemove, ...newLics])
      setMarkedForRemoval(new Set()); setModalOpen(false); setSuccess('Licenses updated.')
    } catch (err) { setError(err.response?.data?.detail || 'Failed to update licenses.') }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{assigned.length} license{assigned.length !== 1 ? 's' : ''} assigned</p>
        <button onClick={() => { if (!tenantLicenses) fetchTenant(); setModalOpen(true); setError(null); setSuccess(null) }}
          className="flex items-center gap-1.5 rounded-md border border-brand-primary/40 bg-brand-primary/10 px-3 py-1.5 text-xs font-medium text-brand-primary transition-colors hover:bg-brand-primary/20">
          + Assign Additional License
        </button>
      </div>
      {error && <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger"><AlertCircle className="h-3.5 w-3.5 shrink-0"/>{error}</div>}
      {success && !error && <div className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-xs text-success">{success}</div>}
      {!assigned.length
        ? <p className="text-sm text-slate-500">No licenses assigned.</p>
        : <>
            <ul className="space-y-2">
              {assigned.map(lic => {
                const marked = markedForRemoval.has(lic.sku_id)
                return (
                  <li key={lic.sku_id} onClick={() => { setMarkedForRemoval(prev => { const n = new Set(prev); n.has(lic.sku_id) ? n.delete(lic.sku_id) : n.add(lic.sku_id); return n }); setError(null); setSuccess(null) }}
                    className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors ${marked ? 'border-danger/40 bg-danger/5' : 'border-brand-primary/30 bg-brand-primary/5 hover:border-brand-primary/50'}`}>
                    <input type="checkbox" checked={marked} onChange={() => {}} onClick={e => e.stopPropagation()} className="mt-0.5 accent-danger shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-200">{lic.display_name}</p>
                      <p className="truncate text-xs text-slate-600">{lic.sku_part_number}</p>
                    </div>
                    {marked && <span className="shrink-0 text-xs font-medium text-danger">− Remove</span>}
                  </li>
                )
              })}
            </ul>
            {markedForRemoval.size > 0 && (
              <button onClick={() => setConfirmUnassign(true)} disabled={saving}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm font-medium text-danger hover:bg-danger/20 disabled:opacity-60 transition-colors">
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Unassign {markedForRemoval.size} License{markedForRemoval.size !== 1 ? 's' : ''}
              </button>
            )}
          </>
      }
      {confirmUnassign && (
        <ConfirmDialog
          title="Confirm License Removal"
          confirmLabel="Unassign"
          danger
          onConfirm={() => { setConfirmUnassign(false); handleUnassign() }}
          onCancel={() => setConfirmUnassign(false)}
        >
          <p>Remove the following license{markedForRemoval.size !== 1 ? 's' : ''} from this user?</p>
          <ul className="mt-1 ml-3 list-disc space-y-0.5">
            {assigned
              .filter(l => markedForRemoval.has(l.sku_id))
              .map(l => <li key={l.sku_id}>{l.display_name}</li>)
            }
          </ul>
        </ConfirmDialog>
      )}
      {modalOpen && (
        <LicenseAssignModal currentLicenses={assigned} tenantLicenses={tenantLicenses}
          licenseConfig={licenseConfig} tenantLoading={tenantLoading} saving={saving}
          onClose={() => { setModalOpen(false); setError(null) }} onApply={handleModalApply} />
      )}
    </div>
  )
}

export function EntraDeviceCard({ device }) {
  const complianceCls = COMPLIANCE_STYLES[device.compliance_state?.toLowerCase()] ?? COMPLIANCE_STYLES.unknown
  const isIntune = device.device_type === 'intune'

  return (
    <li className="rounded-md border border-border-subtle bg-app-bg/60 px-3 py-2.5 space-y-1">
      <div className="flex items-center gap-2">
        <Monitor className="h-4 w-4 shrink-0 text-slate-500" />
        <p className="flex-1 truncate text-sm font-medium text-slate-200">
          {device.display_name || 'Unknown device'}
        </p>
        {isIntune && device.compliance_state && (
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${complianceCls}`}>
            {device.compliance_state}
          </span>
        )}
        {!isIntune && (
          <span className="inline-flex items-center rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-300">
            {device.trust_type ?? 'Registered'}
          </span>
        )}
      </div>

      {(device.operating_system || device.os_version) && (
        <p className="pl-6 text-xs text-slate-400">
          {[device.operating_system, device.os_version].filter(Boolean).join(' · ')}
        </p>
      )}

      {(device.manufacturer || device.model) && (
        <p className="pl-6 text-xs text-slate-500">
          {[device.manufacturer, device.model].filter(Boolean).join(' ')}
        </p>
      )}

      {isIntune && device.last_sync_date_time && (
        <p className="pl-6 text-xs text-slate-600">
          Last sync: {new Date(device.last_sync_date_time).toLocaleDateString()}
        </p>
      )}
      {!isIntune && device.last_sync_date_time && (
        <p className="pl-6 text-xs text-slate-600">
          Last seen: {new Date(device.last_sync_date_time).toLocaleDateString()}
        </p>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Tab: Devices
// ---------------------------------------------------------------------------

/**
 * isSynced + entraObjectId — use Entra/Intune as the primary source.
 * AD-only users fall back to the AD managedBy LDAP query.
 */
function DevicesTab({ userDn, isSynced, entraObjectId, getToken }) {
  const [devices, setDevices] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!userDn) return
    setDevices(null)
    setError(null)
    setLoading(true)
    const token = getToken()
    const headers = token ? { Authorization: `Bearer ${token}` } : {}

    if (isSynced && entraObjectId) {
      // Synced user — fetch Intune + Entra registered devices from Graph
      axios
        .get(`/api/v1/entra/users/${encodeURIComponent(entraObjectId)}/devices`, { headers })
        .then(res => setDevices(res.data))
        .catch(err => {
          if (err.response?.status === 503) setError('entra_not_configured')
          else setError('fetch_error')
        })
        .finally(() => setLoading(false))
    } else {
      // AD-only — fall back to managedBy LDAP query
      axios
        .get('/api/v1/ad/user-devices', { headers, params: { user_dn: userDn } })
        .then(res => {
          // Normalise ADComputerSummary → display shape
          setDevices(res.data.map(d => ({
            device_id: d.dn,
            display_name: d.name,
            device_type: 'ad',
            operating_system: d.operating_system,
            os_version: null,
            model: null,
            manufacturer: null,
            compliance_state: null,
            management_state: d.account_status === 'Enabled' ? 'managed' : 'disabled',
            enrolled_date_time: null,
            last_sync_date_time: null,
            is_managed: d.account_status === 'Enabled',
            trust_type: null,
            dns_hostname: d.dns_hostname,
          })))
        })
        .catch(() => setError('fetch_error'))
        .finally(() => setLoading(false))
    }
  }, [userDn, isSynced, entraObjectId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading devices...
      </div>
    )
  }

  if (error === 'entra_not_configured') {
    return (
      <div className="rounded-md border border-border-subtle/50 bg-app-bg/60 px-4 py-4">
        <p className="text-sm text-slate-400">
          Entra ID is not connected.{' '}
          <a href="/settings" className="text-brand-primary hover:underline">Go to Settings</a>
          {' '}to connect.
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-danger">
        <AlertCircle className="h-4 w-4 shrink-0" />
        Failed to load devices.
      </div>
    )
  }

  if (!devices) return null

  if (!devices.length) {
    return (
      <div className="rounded-md border border-border-subtle/50 bg-app-bg/60 px-4 py-8 text-center">
        <Monitor className="mx-auto mb-2 h-8 w-8 text-slate-600" />
        <p className="text-sm text-slate-500">No devices found for this user.</p>
        <p className="mt-1 text-xs text-slate-600">
          {isSynced
            ? 'Requires DeviceManagementManagedDevices.Read.All and/or Device.Read.All on the app registration.'
            : 'Devices appear here when the user is set as Managed By on a computer in AD.'}
        </p>
      </div>
    )
  }

  // AD-only devices use a simpler card layout since they lack Intune fields
  if (!isSynced) {
    return (
      <ul className="space-y-2">
        {devices.map(d => (
          <li key={d.device_id} className="rounded-md border border-border-subtle bg-app-bg/60 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Monitor className="h-4 w-4 shrink-0 text-slate-500" />
              <p className="text-sm font-medium text-slate-200">{d.display_name}</p>
              <span className={`ml-auto inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
                d.is_managed ? 'border-success/20 bg-success/10 text-success' : 'border-danger/20 bg-danger/10 text-danger'
              }`}>
                {d.is_managed ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            {d.dns_hostname && <p className="mt-0.5 pl-6 font-mono text-xs text-slate-500">{d.dns_hostname}</p>}
            {d.operating_system && <p className="mt-0.5 pl-6 text-xs text-slate-500">{d.operating_system}</p>}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <ul className="space-y-2">
      {devices.map(d => <EntraDeviceCard key={d.device_id} device={d} />)}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Tab: Attributes (raw LDAP + advanced object metadata)
// ---------------------------------------------------------------------------

function AttributesTab({ user }) {
  const [filter, setFilter] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const entries = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return Object.entries(user.raw_attributes ?? {}).filter(
      ([k, v]) => !q || k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q)
    )
  }, [user.raw_attributes, filter])

  return (
    <div className="flex flex-col gap-3">
      {/* Advanced object metadata collapsible */}
      <div className="rounded-md border border-border-subtle/50">
        <button
          onClick={() => setShowAdvanced(v => !v)}
          className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300 transition-colors"
        >
          <span>Advanced (Object Metadata)</span>
          <span>{showAdvanced ? '▲' : '▼'}</span>
        </button>
        {showAdvanced && (
          <div className="border-t border-border-subtle/50 px-3 pb-3">
            <dl>
              <Field label="Distinguished name" value={user.dn}          mono />
              <Field label="Object SID"         value={user.object_sid}  mono />
              <Field label="Object GUID"        value={user.object_guid} mono />
              <Field label="Primary group ID"   value={user.primary_group_id} />
              <Field label="USN created"        value={user.usn_created} />
              <Field label="USN changed"        value={user.usn_changed} />
              <Field label="When created"       value={formatDate(user.when_created)} />
              <Field label="When changed"       value={formatDate(user.when_changed)} />
            </dl>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          placeholder="Filter attributes…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="w-full rounded-md border border-border-subtle bg-app-bg py-1.5 pl-8 pr-3 text-sm text-slate-200 placeholder:text-slate-500 focus:border-brand-primary focus:outline-none"
        />
      </div>

      {/* Table */}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left">
            <th className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wider text-slate-500 w-52">Attribute</th>
            <th className="pb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Value</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([attr, val]) => (
            <tr key={attr} className="border-b border-border-subtle/30 hover:bg-white/[0.03]">
              <td className="py-1.5 pr-4 align-top font-mono text-xs text-slate-400">{attr}</td>
              <td className="py-1.5 align-top font-mono text-xs break-all">
                {val
                  ? <span className="text-slate-300">{val}</span>
                  : <span className="italic text-slate-600">not set</span>
                }
              </td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={2} className="py-6 text-center text-sm text-slate-500">
                No attributes match &ldquo;{filter}&rdquo;
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function Skeleton() {
  return (
    <div className="animate-pulse space-y-5 p-5">
      <div className="flex items-center gap-4">
        <div className="h-14 w-14 rounded-full bg-white/10" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-44 rounded bg-white/10" />
          <div className="h-3 w-32 rounded bg-white/10" />
          <div className="flex gap-2">
            <div className="h-5 w-20 rounded-full bg-white/10" />
            <div className="h-5 w-20 rounded-full bg-white/10" />
          </div>
        </div>
      </div>
      <div className="flex gap-1">
        {[72, 64, 60, 90, 72, 56, 80].map((w, i) => (
          <div key={i} className="h-7 rounded bg-white/10" style={{ width: w }} />
        ))}
      </div>
      {[1, 2, 3, 4, 5, 6].map(n => (
        <div key={n} className="grid grid-cols-[11rem_1fr] gap-4">
          <div className="h-3 rounded bg-white/10" />
          <div className="h-3 rounded bg-white/10" />
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// UserDetail — main export
// ---------------------------------------------------------------------------

/**
 * mode "merged"  — fetches /api/v1/ad/user/{dn}/merged (AD + Entra data for synced users)
 * mode "ad-only" — fetches /api/v1/ad/user/{dn} (AD data only)
 */
export default function UserDetail({ userDn, mode = 'merged', onClose, onUserSelect }) {
  const { getToken } = useAuth()
  const [user, setUser]             = useState(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)
  const [activeTab, setActiveTab]   = useState('identity')
  const [photoError, setPhotoError] = useState(false)

  useEffect(() => {
    if (!userDn) return
    setUser(null)
    setError(null)
    setLoading(true)
    setActiveTab('identity')
    setPhotoError(false)

    const token = getToken()
    const endpoint = mode === 'merged'
      ? `/api/v1/ad/user/${encodeURIComponent(userDn)}/merged`
      : `/api/v1/ad/user/${encodeURIComponent(userDn)}`

    axios
      .get(endpoint, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(res => setUser(res.data))
      .catch(() => setError('Failed to load user details.'))
      .finally(() => setLoading(false))
  }, [userDn, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!userDn) return null

  // Determine which photo to show: Entra photo > AD photo > initials
  const photoSrc = user?.entra_photo || user?.photo || null

  function renderTabContent() {
    if (!user) return null
    switch (activeTab) {
      case 'identity':     return <IdentityTab user={user} />
      case 'auth-methods': return <AuthMethodsTab user={user} />
      case 'licenses':     return <LicensesTab user={user} />
      case 'account':      return <AccountTab user={user} />
      case 'contact':      return <ContactTab user={user} />
      case 'organization': return <OrganizationTab user={user} onUserSelect={onUserSelect} />
      case 'member-of':    return <MemberOfTab user={user} />
      case 'devices':      return <DevicesTab userDn={userDn} isSynced={user.is_synced} entraObjectId={user.entra_object_id} getToken={getToken} />
      case 'attributes':   return <AttributesTab user={user} />
      default:             return null
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden border-l border-border-subtle bg-surface">

      {/* ── Top bar ── */}
      <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-5 py-3">
        <span className="text-sm font-medium text-slate-400">User Properties</span>
        <button
          onClick={onClose}
          className="rounded p-1 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {loading && <Skeleton />}

      {error && !loading && (
        <div className="flex items-center gap-2 p-6 text-sm text-danger">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {user && !loading && (
        <>
          {/* ── Identity header ── */}
          <div className="flex shrink-0 items-center gap-4 border-b border-border-subtle px-5 py-4">
            {photoSrc && !photoError ? (
              <img
                src={photoSrc}
                alt=""
                onError={() => setPhotoError(true)}
                className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-white/10"
              />
            ) : (
              <div className="flex h-14 w-14 shrink-0 select-none items-center justify-center rounded-full bg-brand-primary text-lg font-bold text-white">
                {getInitials(user.display_name)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-white">
                {user.display_name || user.sam_account_name}
              </p>
              {(user.title || user.department) && (
                <p className="truncate text-sm text-slate-400">
                  {[user.title, user.department].filter(Boolean).join(' — ')}
                </p>
              )}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <StatusBadge status={user.account_status} label={user.is_synced ? 'AD' : null} />
                {user.is_synced && user.entra_account_enabled !== null && user.entra_account_enabled !== undefined && (
                  <StatusBadge
                    status={user.entra_account_enabled ? 'Active' : 'Inactive'}
                    label="Entra"
                  />
                )}
              </div>
            </div>
          </div>

          {/* ── Tab bar ── */}
          <div className="flex shrink-0 overflow-x-auto overflow-y-hidden border-b border-border-subtle scrollbar-none">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 text-xs font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'border-brand-primary text-brand-primary'
                    : 'border-transparent text-slate-400 hover:border-slate-600 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Tab content ── */}
          <div className="flex-1 overflow-y-auto p-5">
            {renderTabContent()}
          </div>
        </>
      )}
    </div>
  )
}
