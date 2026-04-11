import { useState, useEffect, useMemo } from 'react'
import { X, Loader2, AlertCircle, User, Search, Monitor } from 'lucide-react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext.jsx'
import { getInitials, formatDate } from '../utils.js'

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

          <SectionHeading>MFA Methods</SectionHeading>
          <BadgeList
            items={user.entra_mfa_methods}
            colorClass="border-success/30 bg-success/10 text-success"
          />

          <SectionHeading>Licenses</SectionHeading>
          <BadgeList
            items={user.entra_licenses}
            colorClass="border-brand-primary/30 bg-brand-primary/10 text-brand-primary"
          />
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

function OrganizationTab({ user, onUserSelect }) {
  return (
    <div>
      <dl>
        <Field label="Title"      value={user.title} />
        <Field label="Department" value={user.department} />
        <Field label="Company"    value={user.company} />
        <Field label="Description" value={user.description} />
      </dl>

      {user.manager_display_name && (
        <>
          <SectionHeading>Manager</SectionHeading>
          <button
            onClick={() => onUserSelect?.(user.manager_dn)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-brand-primary transition-colors hover:bg-brand-primary/10"
          >
            <User className="h-4 w-4 shrink-0" />
            {user.manager_display_name}
          </button>
        </>
      )}

      {user.direct_reports?.length > 0 && (
        <>
          <SectionHeading>Direct Reports ({user.direct_reports.length})</SectionHeading>
          <ul className="space-y-0.5">
            {user.direct_reports.map(dr => (
              <li key={dr.dn}>
                <button
                  onClick={() => onUserSelect?.(dr.dn)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-brand-primary transition-colors hover:bg-brand-primary/10"
                >
                  <User className="h-4 w-4 shrink-0" />
                  {dr.name}
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
// Tab: Member Of (two-column for synced users)
// ---------------------------------------------------------------------------

function GroupListItem({ group, badge }) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-app-bg/60 px-3 py-2">
      <p className="truncate text-sm font-medium text-slate-200">{group.name}</p>
      {badge && <GroupTypeBadge type={badge} />}
    </li>
  )
}

function MemberOfTab({ user }) {
  const adGroups = user.member_of ?? []
  const cloudGroups = user.entra_cloud_groups ?? []
  const isSynced = user.is_synced

  const sortedAd = [...adGroups].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  const sortedCloud = [...cloudGroups].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  if (!isSynced) {
    // Single column for AD-only users
    if (!sortedAd.length) return <p className="text-sm text-slate-500">Not a member of any groups.</p>
    return (
      <ul className="space-y-2">
        {sortedAd.map(g => <GroupListItem key={g.dn} group={g} />)}
      </ul>
    )
  }

  // Two-column layout for synced users
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          On-Prem (AD) — {sortedAd.length}
        </p>
        {sortedAd.length ? (
          <ul className="space-y-2">
            {sortedAd.map(g => <GroupListItem key={g.dn} group={g} />)}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No on-prem groups.</p>
        )}
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Cloud (Entra) — {sortedCloud.length}
        </p>
        {sortedCloud.length ? (
          <ul className="space-y-2">
            {sortedCloud.map(g => (
              <GroupListItem key={g.name} group={g} badge={g.group_type} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No cloud groups.</p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab: Devices
// ---------------------------------------------------------------------------

function DevicesTab({ userDn, getToken }) {
  const [devices, setDevices] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!userDn) return
    setDevices(null)
    setError(null)
    setLoading(true)
    const token = getToken()
    axios
      .get('/api/v1/ad/user-devices', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        params: { user_dn: userDn },
      })
      .then(res => setDevices(res.data))
      .catch(() => setError('Failed to load device assignments.'))
      .finally(() => setLoading(false))
  }, [userDn]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading devices...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-danger">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {error}
      </div>
    )
  }

  if (!devices) return null

  if (!devices.length) {
    return (
      <div className="rounded-md border border-border-subtle/50 bg-app-bg/60 px-4 py-8 text-center">
        <Monitor className="mx-auto mb-2 h-8 w-8 text-slate-600" />
        <p className="text-sm text-slate-500">No managed devices found for this user.</p>
        <p className="mt-1 text-xs text-slate-600">Devices appear here when the user is set as the Managed By contact in AD.</p>
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {devices.map(d => (
        <li key={d.dn} className="rounded-md border border-border-subtle bg-app-bg/60 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4 shrink-0 text-slate-500" />
            <p className="text-sm font-medium text-slate-200">{d.name}</p>
            <span className={`ml-auto inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
              d.account_status === 'Enabled'
                ? 'border-success/20 bg-success/10 text-success'
                : 'border-danger/20 bg-danger/10 text-danger'
            }`}>
              {d.account_status}
            </span>
          </div>
          {d.dns_hostname && (
            <p className="mt-0.5 font-mono text-xs text-slate-500">{d.dns_hostname}</p>
          )}
          {d.operating_system && (
            <p className="mt-0.5 text-xs text-slate-500">{d.operating_system}</p>
          )}
        </li>
      ))}
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
      case 'account':      return <AccountTab user={user} />
      case 'contact':      return <ContactTab user={user} />
      case 'organization': return <OrganizationTab user={user} onUserSelect={onUserSelect} />
      case 'member-of':    return <MemberOfTab user={user} />
      case 'devices':      return <DevicesTab userDn={userDn} getToken={getToken} />
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
