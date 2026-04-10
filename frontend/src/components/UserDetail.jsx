import { useState, useEffect, useMemo } from 'react'
import { X, Loader2, AlertCircle, User, Search } from 'lucide-react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext.jsx'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatDate(value) {
  if (!value) return null
  if (value === 'Never') return 'Never'
  try {
    return new Date(value).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return value
  }
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_STYLES = {
  Enabled:      'bg-success/15 text-success border-success/20',
  Disabled:     'bg-danger/15 text-danger border-danger/20',
  'Locked Out': 'bg-warning/15 text-warning border-warning/20',
}

function StatusBadge({ status }) {
  const cls = STATUS_STYLES[status] ?? 'bg-slate-500/15 text-slate-400 border-slate-500/20'
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Shared field components
// ---------------------------------------------------------------------------

/** Two-column label / value row with a hairline bottom border. */
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

/** Read-only checkbox row matching ADUC's Account Options style. */
function FlagField({ label, checked }) {
  return (
    <label className="flex cursor-default items-center gap-2.5 py-1">
      <span
        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
          checked
            ? 'border-brand-primary bg-brand-primary'
            : 'border-slate-600 bg-transparent'
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

/** Section heading inside a tab. */
function SectionHeading({ children }) {
  return (
    <h3 className="mb-2 mt-6 first:mt-0 text-xs font-semibold uppercase tracking-wider text-slate-500">
      {children}
    </h3>
  )
}

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'general',          label: 'General' },
  { id: 'account',          label: 'Account' },
  { id: 'address',          label: 'Address' },
  { id: 'profile',          label: 'Profile' },
  { id: 'organization',     label: 'Organization' },
  { id: 'member-of',        label: 'Member Of' },
  { id: 'object',           label: 'Object' },
  { id: 'attribute-editor', label: 'Attribute Editor' },
]

// ---------------------------------------------------------------------------
// Tab: General
// ---------------------------------------------------------------------------

function GeneralTab({ user }) {
  return (
    <dl>
      <Field label="First name"    value={user.given_name} />
      <Field label="Last name"     value={user.surname} />
      <Field label="Initials"      value={user.initials} />
      <Field label="Display name"  value={user.display_name} />
      <Field label="Description"   value={user.description} />
      <Field label="Office"        value={user.office} />
      <Field label="Telephone"     value={user.telephone_number} />
      <Field label="Mobile"        value={user.mobile} />
      <Field label="Email"         value={user.mail} />
      <Field label="Web page"      value={user.web_page} />
    </dl>
  )
}

// ---------------------------------------------------------------------------
// Tab: Account
// ---------------------------------------------------------------------------

function AccountTab({ user }) {
  return (
    <div>
      <SectionHeading>Logon name</SectionHeading>
      <dl>
        <Field label="User principal name" value={user.upn} />
        <Field label="SAM account name"    value={user.sam_account_name} />
      </dl>

      <SectionHeading>Account options</SectionHeading>
      <div className="space-y-0.5">
        <FlagField
          label="User must change password at next logon"
          checked={user.must_change_password && !user.uac_flags?.['Password never expires']}
        />
        {Object.entries(user.uac_flags ?? {}).map(([label, val]) => (
          <FlagField key={label} label={label} checked={val} />
        ))}
      </div>

      <SectionHeading>Account activity</SectionHeading>
      <dl>
        <Field label="Account expires"    value={formatDate(user.account_expires) ?? user.account_expires} />
        <Field label="Password last set"  value={formatDate(user.pwd_last_set)} />
        <Field label="Last logon"         value={formatDate(user.last_logon)} />
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
// Tab: Address
// ---------------------------------------------------------------------------

function AddressTab({ user }) {
  return (
    <dl>
      <Field label="Street"          value={user.street_address} />
      <Field label="City"            value={user.city} />
      <Field label="State / Province" value={user.state} />
      <Field label="Postal code"     value={user.postal_code} />
      <Field label="Country"         value={user.country} />
    </dl>
  )
}

// ---------------------------------------------------------------------------
// Tab: Profile
// ---------------------------------------------------------------------------

function ProfileTab({ user }) {
  return (
    <div>
      <SectionHeading>User profile</SectionHeading>
      <dl>
        <Field label="Profile path"  value={user.profile_path}  mono />
        <Field label="Logon script"  value={user.logon_script}  mono />
      </dl>

      <SectionHeading>Home folder</SectionHeading>
      <dl>
        <Field label="Drive"         value={user.home_drive}     mono />
        <Field label="Path"          value={user.home_directory} mono />
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
          <SectionHeading>
            Direct reports ({user.direct_reports.length})
          </SectionHeading>
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
// Tab: Member Of
// ---------------------------------------------------------------------------

function MemberOfTab({ user }) {
  if (!user.member_of?.length) {
    return <p className="text-sm text-slate-500">Not a member of any groups.</p>
  }

  const sorted = [...user.member_of].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )

  return (
    <ul className="space-y-2">
      {sorted.map(group => (
        <li
          key={group.dn}
          className="rounded-md border border-border-subtle bg-app-bg/60 px-3 py-2.5"
        >
          <p className="text-sm font-medium text-slate-200">{group.name}</p>
          <p className="mt-0.5 break-all font-mono text-xs text-slate-500">{group.dn}</p>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Tab: Object  (Advanced Features metadata)
// ---------------------------------------------------------------------------

function ObjectTab({ user }) {
  return (
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
  )
}

// ---------------------------------------------------------------------------
// Tab: Attribute Editor
// ---------------------------------------------------------------------------

function AttributeEditorTab({ rawAttributes }) {
  const [filter, setFilter] = useState('')

  const entries = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return Object.entries(rawAttributes ?? {}).filter(
      ([k, v]) => !q || k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q)
    )
  }, [rawAttributes, filter])

  return (
    <div className="flex flex-col gap-3">
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
            <th className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wider text-slate-500 w-52">
              Attribute
            </th>
            <th className="pb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Value
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([attr, val]) => (
            <tr
              key={attr}
              className="border-b border-border-subtle/30 hover:bg-white/[0.03]"
            >
              <td className="py-1.5 pr-4 align-top font-mono text-xs text-slate-400">
                {attr}
              </td>
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
          <div className="h-5 w-18 rounded-full bg-white/10" />
        </div>
      </div>
      {/* Fake tab bar */}
      <div className="flex gap-1">
        {[80, 72, 64, 60, 96, 72, 56, 100].map((w, i) => (
          <div key={i} className="h-7 rounded bg-white/10" style={{ width: w }} />
        ))}
      </div>
      {/* Fake field rows */}
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

export default function UserDetail({ userDn, onClose, onUserSelect }) {
  const { getToken } = useAuth()
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [activeTab, setActiveTab] = useState('general')

  useEffect(() => {
    if (!userDn) return
    setUser(null)
    setError(null)
    setLoading(true)
    setActiveTab('general')
    const token = getToken()
    axios
      .get(`/api/v1/ad/user/${encodeURIComponent(userDn)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      .then(res => setUser(res.data))
      .catch(() => setError('Failed to load user details.'))
      .finally(() => setLoading(false))
  }, [userDn]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!userDn) return null

  function renderTabContent() {
    if (!user) return null
    switch (activeTab) {
      case 'general':          return <GeneralTab user={user} />
      case 'account':          return <AccountTab user={user} />
      case 'address':          return <AddressTab user={user} />
      case 'profile':          return <ProfileTab user={user} />
      case 'organization':     return <OrganizationTab user={user} onUserSelect={onUserSelect} />
      case 'member-of':        return <MemberOfTab user={user} />
      case 'object':           return <ObjectTab user={user} />
      case 'attribute-editor': return <AttributeEditorTab rawAttributes={user.raw_attributes} />
      default:                 return null
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
            <div className="flex h-14 w-14 shrink-0 select-none items-center justify-center rounded-full bg-brand-primary text-lg font-bold text-white">
              {getInitials(user.display_name)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-white">
                {user.display_name || user.sam_account_name}
              </p>
              {(user.title || user.department) && (
                <p className="truncate text-sm text-slate-400">
                  {[user.title, user.department].filter(Boolean).join(' — ')}
                </p>
              )}
              <div className="mt-1.5">
                <StatusBadge status={user.account_status} />
              </div>
            </div>
          </div>

          {/* ── Tab bar ── */}
          <div className="flex shrink-0 overflow-x-auto overflow-y-hidden border-b border-border-subtle">
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
