import { useState, useEffect } from 'react'
import { X, Loader2, AlertCircle, Monitor } from 'lucide-react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext.jsx'
import { getInitials, formatDate } from '../utils.js'
import { EntraDeviceCard, CloudGroupsList, LicenseCardList } from './UserDetail.jsx'
import DeviceOffboardModal from './DeviceOffboardModal.jsx'

// ---------------------------------------------------------------------------
// Shared helpers (local to this component)
// ---------------------------------------------------------------------------

function Field({ label, value, mono = false }) {
  const display = value === null || value === undefined || value === '' ? null : String(value)
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-x-4 border-b border-border-subtle/40 py-2 last:border-0">
      <dt className="self-start pt-px text-xs text-slate-500">{label}</dt>
      <dd className={`break-all text-sm ${mono ? 'font-mono text-xs text-slate-300' : 'text-slate-200'}`}>
        {display ?? <span className="text-slate-600">—</span>}
      </dd>
    </div>
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

const GROUP_TYPE_STYLES = {
  Security:     'bg-slate-500/20 text-slate-300 border-slate-500/30',
  M365:         'bg-blue-500/20 text-blue-300 border-blue-500/30',
  Dynamic:      'bg-purple-500/20 text-purple-300 border-purple-500/30',
  Distribution: 'bg-slate-600/20 text-slate-400 border-slate-600/30',
}

function GroupTypeBadge({ type }) {
  const cls = GROUP_TYPE_STYLES[type] ?? GROUP_TYPE_STYLES.Distribution
  return (
    <span className={`ml-2 inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {type}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'identity',  label: 'Identity' },
  { id: 'auth-methods', label: 'Authentication Methods' },
  { id: 'licenses',  label: 'Licenses' },
  { id: 'contact',   label: 'Contact' },
  { id: 'member-of', label: 'Member Of' },
  { id: 'devices',   label: 'Devices' },
]

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function Skeleton() {
  return (
    <div className="animate-pulse space-y-5 p-5">
      <div className="flex items-center gap-4">
        <div className="h-14 w-14 rounded-full bg-white/10" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-44 rounded bg-white/10" />
          <div className="h-3 w-32 rounded bg-white/10" />
          <div className="h-5 w-20 rounded-full bg-white/10" />
        </div>
      </div>
      <div className="flex gap-1">
        {[72, 64, 80].map((w, i) => <div key={i} className="h-7 rounded bg-white/10" style={{ width: w }} />)}
      </div>
      {[1, 2, 3, 4].map(n => (
        <div key={n} className="grid grid-cols-[10rem_1fr] gap-4">
          <div className="h-3 rounded bg-white/10" />
          <div className="h-3 rounded bg-white/10" />
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Detail panel for a cloud-only Entra user.
 * `user` prop: { upn, entra_object_id, display_name, ... }
 */
export default function EntraUserDetailPanel({ user: selectedUser, onClose }) {
  const { getToken } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('identity')
  const [photoError, setPhotoError] = useState(false)
  const [photo, setPhoto] = useState(null)
  const [devices, setDevices] = useState(null)
  const [devicesLoading, setDevicesLoading] = useState(false)
  const [devicesError, setDevicesError] = useState(null)
  const [selectedDeviceIds, setSelectedDeviceIds] = useState(new Set())
  const [offboardOpen, setOffboardOpen] = useState(false)

  useEffect(() => {
    if (!selectedUser?.upn) return
    setData(null)
    setError(null)
    setLoading(true)
    setActiveTab('identity')
    setPhotoError(false)
    setPhoto(null)

    const token = getToken()
    const headers = token ? { Authorization: `Bearer ${token}` } : {}

    // Fetch Entra cloud user data (reuses existing /users/{upn} endpoint)
    axios
      .get(`/api/v1/entra/users/${encodeURIComponent(selectedUser.upn)}`, { headers })
      .then(res => {
        setData(res.data)
        // Fetch photo separately using object ID
        const objectId = res.data.entra_object_id || selectedUser.entra_object_id
        if (objectId) {
          axios
            .get(`/api/v1/entra/users/${encodeURIComponent(objectId)}/photo`, {
              headers,
              responseType: 'blob',
            })
            .then(photoRes => {
              const url = URL.createObjectURL(photoRes.data)
              setPhoto(url)
            })
            .catch(() => {}) // No photo is fine
        }
      })
      .catch(err => {
        if (err.response?.status === 503) setError('not_configured')
        else setError('fetch_error')
      })
      .finally(() => setLoading(false))
  }, [selectedUser?.upn]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lazy-load devices when that tab is first opened
  useEffect(() => {
    if (activeTab !== 'devices') return
    const objectId = data?.entra_object_id || selectedUser?.entra_object_id
    if (!objectId || devices !== null) return  // already fetched or no ID yet
    setDevicesLoading(true)
    setDevicesError(null)
    const token = getToken()
    axios
      .get(`/api/v1/entra/users/${encodeURIComponent(objectId)}/devices`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      .then(res => setDevices(res.data))
      .catch(err => {
        if (err.response?.status === 503) setDevicesError('entra_not_configured')
        else setDevicesError('fetch_error')
      })
      .finally(() => setDevicesLoading(false))
  }, [activeTab, data, selectedUser, devices]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset devices and selection when user changes
  useEffect(() => {
    setDevices(null)
    setDevicesError(null)
    setSelectedDeviceIds(new Set())
    setOffboardOpen(false)
  }, [selectedUser?.upn])

  if (!selectedUser) return null

  const displayName = selectedUser.display_name || selectedUser.upn

  function renderTab() {
    if (!data) return null
    switch (activeTab) {
      case 'identity':
        return (
          <div>
            <SectionHeading>Account Identifiers</SectionHeading>
            <dl>
              <Field label="User Principal Name" value={data.entra_object_id ? selectedUser.upn : null} mono />
              <Field label="Entra Object ID"      value={data.entra_object_id} mono />
              <Field label="Last Sign-in"         value={formatDate(data.last_sign_in)} />
              <Field label="Account Status" value={
                data.account_enabled === null ? null :
                data.account_enabled ? 'Enabled' : 'Disabled'
              } />
            </dl>
          </div>
        )

      case 'auth-methods': {
        const methods    = data.mfa_methods ?? []
        const defaultMfa = data.default_mfa_method
        if (!methods.length) {
          return (
            <div className="rounded-md border border-warning/20 bg-warning/5 px-4 py-3">
              <p className="text-sm text-warning">No authentication methods registered.</p>
              <p className="mt-1 text-xs text-slate-500">This account may be at higher risk.</p>
            </div>
          )
        }
        return (
          <div className="space-y-5">
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
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-subtle">
                  <th className="pb-2 pr-8 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Authentication method</th>
                  <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Detail</th>
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

      case 'licenses':
        return (
          <LicenseCardList
            entraObjectId={data.entra_object_id || selectedUser.entra_object_id}
            assignedLicenses={data.licenses ?? []}
          />
        )

      case 'contact':
        return (
          <dl>
            <Field label="Email" value={selectedUser.mail} />
            <Field label="Department" value={selectedUser.department} />
            <Field label="Title" value={selectedUser.title} />
          </dl>
        )

      case 'member-of':
        return <CloudGroupsList groups={data.groups ?? []} />

      case 'devices':
        if (devicesLoading) {
          return (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading devices...
            </div>
          )
        }
        if (devicesError === 'entra_not_configured') {
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
        if (devicesError) {
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
                Requires DeviceManagementManagedDevices.Read.All and/or Device.Read.All on the app registration.
              </p>
            </div>
          )
        }
        return (
          <div className="space-y-3">
            {selectedDeviceIds.size > 0 && (
              <div className="flex items-center justify-between rounded-md border border-danger/30 bg-danger/5 px-3 py-2">
                <span className="text-xs text-slate-400">
                  {selectedDeviceIds.size} device{selectedDeviceIds.size !== 1 ? 's' : ''} selected
                </span>
                <button
                  onClick={() => setOffboardOpen(true)}
                  className="flex items-center gap-1.5 rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-white hover:bg-danger/80 transition-colors"
                >
                  Offboard {selectedDeviceIds.size > 1 ? `${selectedDeviceIds.size} Devices` : 'Device'}
                </button>
              </div>
            )}
            <ul className="space-y-2">
              {devices.map(d => (
                <EntraDeviceCard
                  key={d.device_id}
                  device={d}
                  selectable
                  selected={selectedDeviceIds.has(d.device_id)}
                  onToggle={(id) => setSelectedDeviceIds(prev => {
                    const next = new Set(prev)
                    next.has(id) ? next.delete(id) : next.add(id)
                    return next
                  })}
                />
              ))}
            </ul>
            {offboardOpen && selectedDeviceIds.size > 0 && (
              <DeviceOffboardModal
                devices={devices.filter(d => selectedDeviceIds.has(d.device_id))}
                getToken={getToken}
                onClose={() => setOffboardOpen(false)}
                onComplete={() => {
                  setOffboardOpen(false)
                  setSelectedDeviceIds(new Set())
                  setDevices(null)  // force re-fetch on next tab open
                }}
              />
            )}
          </div>
        )

      default: return null
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden border-l border-border-subtle bg-surface">
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-5 py-3">
        <span className="text-sm font-medium text-slate-400">Cloud User Properties</span>
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
          {error === 'not_configured'
            ? 'Entra is not configured. Go to Settings to connect.'
            : 'Failed to load user details.'}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Header */}
          <div className="flex shrink-0 items-center gap-4 border-b border-border-subtle px-5 py-4">
            {photo && !photoError ? (
              <img
                src={photo}
                alt=""
                onError={() => setPhotoError(true)}
                className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-white/10"
              />
            ) : (
              <div className="flex h-14 w-14 shrink-0 select-none items-center justify-center rounded-full bg-brand-primary text-lg font-bold text-white">
                {getInitials(displayName)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-white">{displayName}</p>
              {(selectedUser.title || selectedUser.department) && (
                <p className="truncate text-sm text-slate-400">
                  {[selectedUser.title, selectedUser.department].filter(Boolean).join(' — ')}
                </p>
              )}
              <div className="mt-1.5 flex gap-1.5">
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                  selectedUser.account_enabled
                    ? 'bg-success/15 text-success border-success/20'
                    : 'bg-danger/15 text-danger border-danger/20'
                }`}>
                  {selectedUser.account_enabled ? 'Active' : 'Disabled'}
                </span>
                <span className="inline-flex items-center rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-300">
                  Cloud Only
                </span>
              </div>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex shrink-0 overflow-x-auto border-b border-border-subtle scrollbar-none">
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

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-5">
            {data ? renderTab() : (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
