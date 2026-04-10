import { useState, useEffect, useMemo } from 'react'
import { X, Loader2, AlertCircle, Monitor, Search } from 'lucide-react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext.jsx'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(value) {
  if (!value) return null
  if (value === 'Never') return 'Never'
  try {
    return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return value
  }
}

// ---------------------------------------------------------------------------
// Shared display components (mirror UserDetail conventions)
// ---------------------------------------------------------------------------

const STATUS_STYLES = {
  Enabled:  'bg-success/15 text-success border-success/20',
  Disabled: 'bg-danger/15  text-danger  border-danger/20',
}

function StatusBadge({ status }) {
  const cls = STATUS_STYLES[status] ?? 'bg-slate-500/15 text-slate-400 border-slate-500/20'
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  )
}

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

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'general',          label: 'General'          },
  { id: 'os',               label: 'Operating System' },
  { id: 'member-of',        label: 'Member Of'        },
  { id: 'object',           label: 'Object'           },
  { id: 'attribute-editor', label: 'Attribute Editor' },
]

// ---------------------------------------------------------------------------
// Tab: General
// ---------------------------------------------------------------------------

function GeneralTab({ computer }) {
  return (
    <dl>
      <Field label="Computer name"    value={computer.name} />
      <Field label="DNS hostname"     value={computer.dns_hostname} />
      <Field label="SAM account name" value={computer.sam_account_name} />
      <Field label="Description"      value={computer.description} />
      <Field label="Location"         value={computer.location} />
      <Field label="Managed by"       value={computer.managed_by_display_name} />
      <Field label="Last logon"       value={formatDate(computer.last_logon)} />
      <Field label="Password last set" value={formatDate(computer.pwd_last_set)} />
      <Field label="Bad password count" value={computer.bad_pwd_count} />

      {computer.uac_flags && Object.keys(computer.uac_flags).length > 0 && (
        <>
          <SectionHeading>Account options</SectionHeading>
          <div className="space-y-0.5">
            {Object.entries(computer.uac_flags).map(([label, checked]) => (
              <FlagField key={label} label={label} checked={checked} />
            ))}
          </div>
        </>
      )}
    </dl>
  )
}

// ---------------------------------------------------------------------------
// Tab: Operating System
// ---------------------------------------------------------------------------

function OSTab({ computer }) {
  if (!computer.operating_system && !computer.operating_system_version) {
    return <p className="text-sm text-slate-500">No operating system information recorded.</p>
  }
  return (
    <dl>
      <Field label="Operating system"      value={computer.operating_system} />
      <Field label="Version"               value={computer.operating_system_version} />
      <Field label="Service pack"          value={computer.operating_system_service_pack} />
    </dl>
  )
}

// ---------------------------------------------------------------------------
// Tab: Member Of
// ---------------------------------------------------------------------------

function MemberOfTab({ computer }) {
  if (!computer.member_of?.length) {
    return <p className="text-sm text-slate-500">Not a member of any groups.</p>
  }
  const sorted = [...computer.member_of].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
  return (
    <ul className="space-y-2">
      {sorted.map(group => (
        <li key={group.dn} className="rounded-md border border-border-subtle bg-app-bg/60 px-3 py-2.5">
          <p className="text-sm font-medium text-slate-200">{group.name}</p>
          <p className="mt-0.5 break-all font-mono text-xs text-slate-500">{group.dn}</p>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Tab: Object
// ---------------------------------------------------------------------------

function ObjectTab({ computer }) {
  return (
    <dl>
      <Field label="Distinguished name" value={computer.dn}           mono />
      <Field label="Object SID"         value={computer.object_sid}   mono />
      <Field label="Object GUID"        value={computer.object_guid}  mono />
      <Field label="Primary group ID"   value={computer.primary_group_id} />
      <Field label="USN created"        value={computer.usn_created} />
      <Field label="USN changed"        value={computer.usn_changed} />
      <Field label="When created"       value={formatDate(computer.when_created)} />
      <Field label="When changed"       value={formatDate(computer.when_changed)} />
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
                  : <span className="italic text-slate-600">not set</span>}
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
        </div>
      </div>
      <div className="flex gap-1">
        {[80, 120, 72, 60, 100].map((w, i) => (
          <div key={i} className="h-7 rounded bg-white/10" style={{ width: w }} />
        ))}
      </div>
      {[1, 2, 3, 4, 5].map(n => (
        <div key={n} className="grid grid-cols-[11rem_1fr] gap-4">
          <div className="h-3 rounded bg-white/10" />
          <div className="h-3 rounded bg-white/10" />
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// DeviceDetail — main export
// ---------------------------------------------------------------------------

export default function DeviceDetail({ deviceDn, onClose }) {
  const { getToken } = useAuth()
  const [computer, setComputer]   = useState(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [activeTab, setActiveTab] = useState('general')

  useEffect(() => {
    if (!deviceDn) return
    setComputer(null)
    setError(null)
    setLoading(true)
    setActiveTab('general')
    const token = getToken()
    axios
      .get(`/api/v1/ad/computer/${encodeURIComponent(deviceDn)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      .then(res => setComputer(res.data))
      .catch(() => setError('Failed to load device details.'))
      .finally(() => setLoading(false))
  }, [deviceDn]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!deviceDn) return null

  function renderTabContent() {
    if (!computer) return null
    switch (activeTab) {
      case 'general':          return <GeneralTab computer={computer} />
      case 'os':               return <OSTab computer={computer} />
      case 'member-of':        return <MemberOfTab computer={computer} />
      case 'object':           return <ObjectTab computer={computer} />
      case 'attribute-editor': return <AttributeEditorTab rawAttributes={computer.raw_attributes} />
      default:                 return null
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden border-l border-border-subtle bg-surface">

      {/* ── Top bar ── */}
      <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-5 py-3">
        <span className="text-sm font-medium text-slate-400">Computer Properties</span>
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

      {computer && !loading && (
        <>
          {/* ── Identity header ── */}
          <div className="flex shrink-0 items-center gap-4 border-b border-border-subtle px-5 py-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-primary/20">
              <Monitor className="h-7 w-7 text-brand-primary" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-white">{computer.name}</p>
              {computer.operating_system && (
                <p className="truncate text-sm text-slate-400">{computer.operating_system}</p>
              )}
              <div className="mt-1.5">
                <StatusBadge status={computer.account_status} />
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
