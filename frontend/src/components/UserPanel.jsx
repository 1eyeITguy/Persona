import { useState, useEffect } from 'react'
import { X, Loader2, AlertCircle } from 'lucide-react'
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
  if (!value) return '—'
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
  Enabled: 'bg-success/15 text-success border-success/20',
  Disabled: 'bg-danger/15 text-danger border-danger/20',
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
// Section + Field
// ---------------------------------------------------------------------------

function Section({ title, children }) {
  // children may include nulls from Field (no value), filter them
  const hasContent = Array.isArray(children)
    ? children.some(Boolean)
    : Boolean(children)
  if (!hasContent) return null
  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Field({ label, value }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="break-all text-sm text-slate-200">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function Skeleton() {
  return (
    <div className="animate-pulse space-y-5 p-6">
      <div className="flex items-center gap-4">
        <div className="h-14 w-14 rounded-full bg-white/10" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-40 rounded bg-white/10" />
          <div className="h-3 w-28 rounded bg-white/10" />
          <div className="h-5 w-20 rounded-full bg-white/10" />
        </div>
      </div>
      {[1, 2, 3].map(n => (
        <div key={n} className="space-y-2">
          <div className="h-3 w-20 rounded bg-white/10" />
          <div className="h-3 w-full rounded bg-white/10" />
          <div className="h-3 w-3/4 rounded bg-white/10" />
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// UserPanel
// ---------------------------------------------------------------------------

export default function UserPanel({ userDn, onClose }) {
  const { getToken } = useAuth()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!userDn) return
    setUser(null)
    setError(null)
    setLoading(true)
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

  return (
    <aside className="flex h-full w-96 shrink-0 flex-col overflow-hidden border-l border-border-subtle bg-surface">
      {/* Panel header bar */}
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <span className="text-sm font-medium text-slate-300">User Details</span>
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
        <div className="flex-1 overflow-y-auto">
          {/* Avatar + name header */}
          <div className="flex items-start gap-4 p-6 pb-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-primary text-lg font-bold text-white">
              {getInitials(user.display_name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-white">
                {user.display_name || user.sam_account_name}
              </p>
              {user.title && (
                <p className="truncate text-sm text-slate-400">{user.title}</p>
              )}
              {user.department && (
                <p className="truncate text-xs text-slate-500">{user.department}</p>
              )}
              <div className="mt-2">
                <StatusBadge status={user.account_status} />
              </div>
            </div>
          </div>

          <div className="border-t border-border-subtle" />

          {/* Attribute sections */}
          <div className="space-y-6 p-6">
            <Section title="Identity">
              <Field label="Username (sAMAccountName)" value={user.sam_account_name} />
              <Field label="User Principal Name" value={user.upn} />
              <Field label="First Name" value={user.given_name} />
              <Field label="Last Name" value={user.surname} />
            </Section>

            <Section title="Contact">
              <Field label="Email" value={user.mail} />
              <Field label="Telephone" value={user.telephone_number} />
              <Field label="Mobile" value={user.mobile} />
            </Section>

            <Section title="Organization">
              <Field label="Title" value={user.title} />
              <Field label="Department" value={user.department} />
              <Field label="Company" value={user.company} />
              <Field label="Manager" value={user.manager_display_name} />
            </Section>

            <Section title="Security">
              <Field label="Account Expires" value={formatDate(user.account_expires)} />
              <Field label="Password Last Set" value={formatDate(user.pwd_last_set)} />
              {user.lockout_time && (
                <Field label="Locked Out At" value={formatDate(user.lockout_time)} />
              )}
              <Field
                label="Failed Login Attempts"
                value={user.bad_pwd_count != null ? String(user.bad_pwd_count) : null}
              />
              {user.member_of.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">Group Memberships</span>
                  <ul className="space-y-1">
                    {user.member_of.map(g => (
                      <li key={g} className="truncate text-sm text-slate-200">
                        {g}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>
          </div>
        </div>
      )}
    </aside>
  )
}
