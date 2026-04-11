import { useState } from 'react'
import { Search, X, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext.jsx'
import { useFilterOptions } from '../hooks/useFilterOptions.js'

// ---------------------------------------------------------------------------
// Reusable select
// ---------------------------------------------------------------------------

function FilterSelect({ label, value, onChange, options, placeholder = 'Any' }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-slate-500">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="rounded-md border border-border-subtle bg-surface px-2.5 py-1.5 text-sm text-slate-200 focus:border-brand-primary focus:outline-none"
      >
        <option value="">{placeholder}</option>
        {options.map(opt =>
          typeof opt === 'string' ? (
            <option key={opt} value={opt}>{opt}</option>
          ) : (
            <option key={opt.dn} value={opt.dn}>{opt.name}</option>
          )
        )}
      </select>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Initial form states
// ---------------------------------------------------------------------------

const USER_FORM = {
  q: '', department: '', office: '', accountStatus: '',
  mustChangePwd: false, accountExpiry: '', groupDn: '', lastLogon: '', ouDn: '',
}

const DEVICE_FORM = {
  q: '', operatingSystem: '', accountStatus: '', lastLogon: '', ouDn: '',
}

// ---------------------------------------------------------------------------
// SearchBar
// ---------------------------------------------------------------------------

export default function SearchBar({ onResults, onClear, isActive, mode = 'users' }) {
  const { getToken } = useAuth()
  // synced/ad-only use the same filter options as users
  const filterMode = mode === 'devices' ? 'devices' : 'users'
  const { options }  = useFilterOptions(getToken, filterMode)

  const isDevices = mode === 'devices'
  const initialForm = isDevices ? DEVICE_FORM : USER_FORM
  const [form, setForm]         = useState(initialForm)
  const [showMore, setShowMore] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSearch(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const params = {}
      if (form.q.trim()) params.q = form.q.trim()

      if (isDevices) {
        if (form.operatingSystem) params.operating_system = form.operatingSystem
        if (form.accountStatus)   params.account_status   = form.accountStatus
        if (form.lastLogon)       params.last_logon        = form.lastLogon
        if (form.ouDn)            params.ou_dn             = form.ouDn
      } else {
        if (form.department)    params.department           = form.department
        if (form.office)        params.office               = form.office
        if (form.accountStatus) params.account_status       = form.accountStatus
        if (form.mustChangePwd) params.must_change_password = true
        if (form.accountExpiry) params.account_expiry       = form.accountExpiry
        if (form.groupDn)       params.group_dn             = form.groupDn
        if (form.lastLogon)     params.last_logon           = form.lastLogon
        if (form.ouDn)          params.ou_dn                = form.ouDn
        // Sync filter — limits results to synced or AD-only users
        if (mode === 'synced')   params.sync_filter = 'synced'
        if (mode === 'ad-only')  params.sync_filter = 'ad-only'
      }

      const endpoint = isDevices ? '/api/v1/ad/device-search' : '/api/v1/ad/search'
      const token    = getToken()
      const res = await axios.get(endpoint, {
        params,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      onResults(res.data)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  function handleClear() {
    setForm(initialForm)
    setError(null)
    onClear()
  }

  const moreActive = !isDevices &&
    (form.mustChangePwd || form.accountExpiry || form.groupDn || form.lastLogon || form.ouDn)

  const moreCount = [form.mustChangePwd, form.accountExpiry, form.groupDn, form.lastLogon, form.ouDn]
    .filter(Boolean).length

  return (
    <div className="shrink-0 border-b border-border-subtle bg-surface">
      <form onSubmit={handleSearch} className="px-5 py-3 space-y-2.5">

        {/* ── Core filter row ── */}
        <div className="flex flex-wrap items-end gap-3">

          {/* Name / username / hostname */}
          <div className="flex flex-col gap-1 flex-1 min-w-48">
            <label className="text-xs font-medium text-slate-500">
              {isDevices ? 'Name or hostname' : 'Name or username'}
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={form.q}
                onChange={e => set('q', e.target.value)}
                placeholder="Search…"
                className="w-full rounded-md border border-border-subtle bg-app-bg py-1.5 pl-8 pr-3 text-sm text-slate-200 placeholder-slate-600 focus:border-brand-primary focus:outline-none"
              />
            </div>
          </div>

          {/* Users-only core filters */}
          {!isDevices && (
            <>
              <FilterSelect
                label="Department"
                value={form.department}
                onChange={v => set('department', v)}
                options={options.departments ?? []}
              />
              <FilterSelect
                label="Office"
                value={form.office}
                onChange={v => set('office', v)}
                options={options.offices ?? []}
              />
            </>
          )}

          {/* Devices-only core filters */}
          {isDevices && (
            <>
              <FilterSelect
                label="Operating system"
                value={form.operatingSystem}
                onChange={v => set('operatingSystem', v)}
                options={options.operating_systems ?? []}
              />
              <FilterSelect
                label="Last logon"
                value={form.lastLogon}
                onChange={v => set('lastLogon', v)}
                options={[
                  { dn: 'never', name: 'Never logged on'     },
                  { dn: '30',    name: 'Inactive > 30 days'  },
                  { dn: '90',    name: 'Inactive > 90 days'  },
                  { dn: '180',   name: 'Inactive > 180 days' },
                ]}
              />
              <FilterSelect
                label="OU scope"
                value={form.ouDn}
                onChange={v => set('ouDn', v)}
                options={options.ous ?? []}
                placeholder="Entire directory"
              />
            </>
          )}

          {/* Shared: account status */}
          <FilterSelect
            label="Account status"
            value={form.accountStatus}
            onChange={v => set('accountStatus', v)}
            options={
              isDevices
                ? [{ dn: 'enabled', name: 'Enabled' }, { dn: 'disabled', name: 'Disabled' }]
                : [
                    { dn: 'enabled',  name: 'Enabled'    },
                    { dn: 'disabled', name: 'Disabled'   },
                    { dn: 'locked',   name: 'Locked out' },
                  ]
            }
          />

          {/* Spacer */}
          <div className="flex-1" />

          {/* More filters toggle (users only) */}
          {!isDevices && (
            <button
              type="button"
              onClick={() => setShowMore(v => !v)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                showMore || moreActive
                  ? 'bg-brand-primary/20 text-brand-primary'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
              }`}
            >
              {showMore ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              More filters
              {moreActive && !showMore && (
                <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand-primary text-[10px] text-white">
                  {moreCount}
                </span>
              )}
            </button>
          )}

          {/* Clear */}
          {isActive && (
            <button
              type="button"
              onClick={handleClear}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          )}

          {/* Search */}
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md bg-brand-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-primary/80 disabled:opacity-60 transition-colors"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Search
          </button>
        </div>

        {/* ── Expanded more filters (users only) ── */}
        {!isDevices && showMore && (
          <div className="flex flex-wrap items-end gap-3 pt-1 border-t border-border-subtle">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">Password</label>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border-subtle bg-app-bg px-3 py-1.5 text-sm text-slate-300 hover:border-slate-600">
                <input
                  type="checkbox"
                  checked={form.mustChangePwd}
                  onChange={e => set('mustChangePwd', e.target.checked)}
                  className="accent-brand-primary"
                />
                Must change at next logon
              </label>
            </div>

            <FilterSelect
              label="Account expiry"
              value={form.accountExpiry}
              onChange={v => set('accountExpiry', v)}
              options={[
                { dn: 'never',   name: 'Never expires'            },
                { dn: 'expired', name: 'Already expired'          },
                { dn: 'soon',    name: 'Expires within 30 days'   },
              ]}
            />

            <FilterSelect
              label="Group membership"
              value={form.groupDn}
              onChange={v => set('groupDn', v)}
              options={options.groups ?? []}
              placeholder="Any group"
            />

            <FilterSelect
              label="Last logon"
              value={form.lastLogon}
              onChange={v => set('lastLogon', v)}
              options={[
                { dn: 'never', name: 'Never logged on'     },
                { dn: '30',    name: 'Inactive > 30 days'  },
                { dn: '90',    name: 'Inactive > 90 days'  },
                { dn: '180',   name: 'Inactive > 180 days' },
              ]}
            />

            <FilterSelect
              label="OU scope"
              value={form.ouDn}
              onChange={v => set('ouDn', v)}
              options={options.ous ?? []}
              placeholder="Entire directory"
            />
          </div>
        )}

        {/* ── Error ── */}
        {error && <p className="text-xs text-danger">{error}</p>}
      </form>
    </div>
  )
}
