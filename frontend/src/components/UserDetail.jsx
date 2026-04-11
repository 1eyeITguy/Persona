import { useState, useEffect, useMemo } from 'react'
import { X, Loader2, AlertCircle, User, Search } from 'lucide-react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext.jsx'
import { getInitials, formatDate } from '../utils.js'

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
  { id: 'cloud',            label: 'Cloud' },
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
// Tab: Cloud (Entra ID)
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
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {type}
    </span>
  )
}

function CloudSection({ title, children }) {
  return (
    <div className="mb-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">{title}</p>
      {children}
    </div>
  )
}

function CloudField({ label, value, mono = false }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-x-4 border-b border-border-subtle/40 py-1.5 last:border-0">
      <dt className="self-start pt-px text-xs text-slate-500">{label}</dt>
      <dd className={`text-sm ${mono ? 'font-mono text-xs text-slate-300' : 'text-slate-200'}`}>
        {value !== null && value !== undefined && value !== ''
          ? value
          : <span className="text-slate-600">—</span>}
      </dd>
    </div>
  )
}

function CloudTab({ upn, getToken }) {
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [errKind, setErrKind] = useState(null) // 'not_configured' | 'fetch_error' | null

  useEffect(() => {
    if (!upn) return
    setData(null)
    setErrKind(null)
    setLoading(true)
    const token = getToken()
    axios
      .get(`/api/v1/entra/users/${encodeURIComponent(upn)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      .then(res => setData(res.data))
      .catch(err => {
        if (err.response?.status === 503) {
          setErrKind('not_configured')
        } else {
          setErrKind('fetch_error')
        }
      })
      .finally(() => setLoading(false))
  }, [upn]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!upn) {
    return (
      <p className="text-sm text-slate-500">No UPN set — cannot look up cloud identity.</p>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading cloud identity...
      </div>
    )
  }

  if (errKind === 'not_configured') {
    return (
      <div className="rounded-md border border-border-subtle bg-app-bg/60 p-4">
        <p className="text-sm text-slate-400">
          Entra ID is not connected.{' '}
          <a href="/settings" className="text-brand-primary hover:underline">
            Go to Settings
          </a>{' '}
          to connect.
        </p>
      </div>
    )
  }

  if (errKind === 'fetch_error') {
    return (
      <div className="flex items-center gap-2 text-sm text-danger">
        <AlertCircle className="h-4 w-4 shrink-0" />
        Failed to load cloud identity data.
      </div>
    )
  }

  if (data && !data.found) {
    return (
      <p className="text-sm text-slate-500">No cloud identity found for this user.</p>
    )
  }

  if (!data) return null

  const lastSignInDisplay = data.last_sign_in
    ? formatDate(data.last_sign_in)
    : null

  return (
    <dl>
      <CloudSection title="Cloud Identity">
        <CloudField label="Entra Object ID" value={data.entra_object_id} mono />
        <CloudField
          label="Account Status"
          value={
            data.account_enabled === null || data.account_enabled === undefined ? null : (
              <span
                className={
                  data.account_enabled
                    ? 'text-success'
                    : 'text-danger'
                }
              >
                {data.account_enabled ? 'Enabled' : 'Disabled'}
              </span>
            )
          }
        />
        <CloudField label="Last Sign-in" value={lastSignInDisplay} />
        <CloudField label="Sign-in Risk" value={data.sign_in_risk_level} />
      </CloudSection>

      <CloudSection title="MFA">
        {data.mfa_methods.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {data.mfa_methods.map(m => (
              <span
                key={m}
                className="rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 text-xs text-success"
              >
                {m}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No MFA methods registered</p>
        )}
      </CloudSection>

      <CloudSection title="Licenses">
        {data.licenses.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {data.licenses.map(l => (
              <span
                key={l}
                className="rounded-full border border-brand-primary/30 bg-brand-primary/10 px-2.5 py-0.5 text-xs text-brand-primary"
              >
                {l}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No licenses assigned</p>
        )}
      </CloudSection>

      <CloudSection title={`Cloud Groups (${data.groups.length})`}>
        {data.groups.length > 0 ? (
          <ul className="space-y-1.5">
            {data.groups.map(g => (
              <li
                key={g.name}
                className="flex items-center justify-between gap-3 rounded-md border border-border-subtle/50 bg-app-bg/40 px-3 py-1.5"
              >
                <span className="text-sm text-slate-200 truncate">{g.name}</span>
                <GroupTypeBadge type={g.group_type} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No cloud group memberships</p>
        )}
      </CloudSection>
    </dl>
  )
}

// ---------------------------------------------------------------------------
// UserDetail — main export
// ---------------------------------------------------------------------------

export default function UserDetail({ userDn, onClose, onUserSelect }) {
  const { getToken } = useAuth()
  const [user, setUser]           = useState(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [activeTab, setActiveTab] = useState('general')
  const [photoError, setPhotoError] = useState(false)

  useEffect(() => {
    if (!userDn) return
    setUser(null)
    setError(null)
    setLoading(true)
    setActiveTab('general')
    setPhotoError(false)
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
      case 'cloud':            return <CloudTab upn={user.upn} getToken={getToken} />
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
            {user.photo && !photoError ? (
              <img
                src={user.photo}
                alt=""
                onError={() => setPhotoError(true)}
                className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-white/10"
              />
            ) : (
              <div className="flex h-14 w-14 shrink-0 select-none items-center justify-center rounded-full bg-brand-primary text-lg font-bold text-white">
                {getInitials(user.display_name)}
              </div>
            )}
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
