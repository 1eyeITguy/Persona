import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, Loader2, AlertCircle, Cloud, ChevronUp, ChevronDown } from 'lucide-react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext.jsx'
import { getInitials } from '../utils.js'

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

function SortIcon({ field, sort }) {
  if (sort.field !== field) return <span className="w-3 inline-block" />
  return sort.dir === 'asc'
    ? <ChevronUp className="inline h-3 w-3 ml-0.5" />
    : <ChevronDown className="inline h-3 w-3 ml-0.5" />
}

export default function EntraOnlyList({ selectedUpn, onUserSelect }) {
  const { getToken } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Filters
  const [q, setQ] = useState('')
  const [department, setDepartment] = useState('')
  const [accountStatus, setAccountStatus] = useState('')
  const debouncedQ = useDebounce(q, 300)

  // Sort
  const [sort, setSort] = useState({ field: 'display_name', dir: 'asc' })

  const lastFetchRef = useRef(0)

  const fetchUsers = useCallback(() => {
    const token = getToken()
    const fetchId = ++lastFetchRef.current
    setLoading(true)
    setError(null)

    const params = {}
    if (debouncedQ) params.q = debouncedQ
    if (department) params.department = department
    if (accountStatus) params.account_status = accountStatus

    axios
      .get('/api/v1/entra/users-cloud-only', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        params,
      })
      .then(res => {
        if (fetchId === lastFetchRef.current) setUsers(res.data)
      })
      .catch(err => {
        if (fetchId === lastFetchRef.current) {
          if (err.response?.status === 503) {
            setError('entra_not_configured')
          } else {
            setError('fetch_error')
          }
        }
      })
      .finally(() => {
        if (fetchId === lastFetchRef.current) setLoading(false)
      })
  }, [debouncedQ, department, accountStatus, getToken])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  function toggleSort(field) {
    setSort(prev =>
      prev.field === field
        ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' }
    )
  }

  const sorted = [...users].sort((a, b) => {
    const av = (a[sort.field] || '').toLowerCase()
    const bv = (b[sort.field] || '').toLowerCase()
    return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
  })

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border-subtle px-4 py-3">
        <h2 className="text-sm font-medium text-slate-300">
          Entra Only{!loading && users.length > 0 ? ` (${users.length})` : ''}
        </h2>
      </div>

      {/* Filters */}
      <div className="shrink-0 border-b border-border-subtle bg-surface/50 px-4 py-3 space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search name or UPN…"
            value={q}
            onChange={e => setQ(e.target.value)}
            className="w-full rounded-md border border-border-subtle bg-app-bg py-1.5 pl-8 pr-3 text-sm text-slate-200 placeholder:text-slate-500 focus:border-brand-primary focus:outline-none"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={accountStatus}
            onChange={e => setAccountStatus(e.target.value)}
            className="flex-1 rounded-md border border-border-subtle bg-app-bg py-1.5 px-2 text-xs text-slate-300 focus:border-brand-primary focus:outline-none"
          >
            <option value="">All statuses</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
      </div>

      {/* Sort header */}
      <div className="shrink-0 grid grid-cols-[1fr_auto] gap-2 border-b border-border-subtle/50 px-4 py-1.5 text-xs text-slate-500">
        <button onClick={() => toggleSort('display_name')} className="text-left hover:text-slate-300 transition-colors">
          Name <SortIcon field="display_name" sort={sort} />
        </button>
        <button onClick={() => toggleSort('account_enabled')} className="text-right hover:text-slate-300 transition-colors">
          Status <SortIcon field="account_enabled" sort={sort} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading cloud users…
          </div>
        )}

        {!loading && error === 'entra_not_configured' && (
          <div className="p-4">
            <div className="rounded-md border border-border-subtle bg-app-bg/60 px-4 py-4">
              <div className="flex items-center gap-2 mb-2">
                <Cloud className="h-5 w-5 text-slate-500" />
                <p className="text-sm font-medium text-slate-300">Entra Not Connected</p>
              </div>
              <p className="text-sm text-slate-500">
                Connect Entra ID in{' '}
                <a href="/settings" className="text-brand-primary hover:underline">Settings</a>
                {' '}to view cloud-only users.
              </p>
            </div>
          </div>
        )}

        {!loading && error === 'fetch_error' && (
          <div className="flex items-center gap-2 p-4 text-sm text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Failed to load Entra users.
          </div>
        )}

        {!loading && !error && sorted.length === 0 && (
          <div className="p-6 text-center text-sm text-slate-500">
            No cloud-only users found.
          </div>
        )}

        {!loading && !error && sorted.map(u => {
          const isSelected = u.upn === selectedUpn
          const displayName = u.display_name || u.upn
          return (
            <button
              key={u.entra_object_id}
              onClick={() => onUserSelect(u)}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                isSelected
                  ? 'bg-brand-primary/20'
                  : 'hover:bg-white/5'
              }`}
            >
              {/* Avatar / photo */}
              {u.photo ? (
                <img
                  src={u.photo}
                  alt=""
                  className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-slate-600"
                />
              ) : (
                <div className="flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full bg-brand-primary/30 text-xs font-bold text-brand-primary">
                  {getInitials(displayName)}
                </div>
              )}

              {/* Info */}
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-medium ${isSelected ? 'text-brand-primary' : 'text-slate-200'}`}>
                  {displayName}
                </p>
                <p className="truncate text-xs text-slate-500">{u.upn}</p>
                {u.department && (
                  <p className="truncate text-xs text-slate-600">{u.department}</p>
                )}
              </div>

              {/* Status */}
              <span className={`shrink-0 text-xs ${
                u.account_enabled
                  ? 'text-success'
                  : 'text-danger'
              }`}>
                {u.account_enabled ? '● Active' : '● Disabled'}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
