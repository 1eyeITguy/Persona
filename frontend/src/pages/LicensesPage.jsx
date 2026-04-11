import { useState, useEffect, useMemo } from 'react'
import { Loader2, AlertCircle, Cloud, Search, ChevronUp, ChevronDown, Settings } from 'lucide-react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../context/AuthContext.jsx'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_STYLES = {
  Enabled:   { dot: 'bg-success',  text: 'text-success',  label: 'Active' },
  Warning:   { dot: 'bg-warning',  text: 'text-warning',  label: 'Warning' },
  Suspended: { dot: 'bg-danger',   text: 'text-danger',   label: 'Suspended' },
}

function StatusDot({ status }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.Enabled
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.text}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

/** Thin utilization bar — green → yellow → red as seats fill up. */
function UtilBar({ assigned, total }) {
  if (total === 0) return null
  const pct = Math.min((assigned / total) * 100, 100)
  const color = pct >= 100 ? 'bg-danger' : pct >= 85 ? 'bg-warning' : 'bg-success'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-slate-500">{Math.round(pct)}%</span>
    </div>
  )
}

function SortIcon({ field, sort }) {
  if (sort.field !== field) return <span className="inline-block w-3" />
  return sort.dir === 'asc'
    ? <ChevronUp className="inline h-3 w-3 ml-0.5 shrink-0" />
    : <ChevronDown className="inline h-3 w-3 ml-0.5 shrink-0" />
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LicensesPage() {
  const { getToken } = useAuth()
  const [licenses, setLicenses]       = useState(null)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [q, setQ]                     = useState('')
  const [sort, setSort]               = useState({ field: 'display_name', dir: 'asc' })
  const [showAll, setShowAll]         = useState(false)  // false = only assignable
  const [assignableIds, setAssignableIds] = useState(null)  // null while loading

  useEffect(() => {
    const token = getToken()
    const headers = token ? { Authorization: `Bearer ${token}` } : {}

    // Fetch both licenses and config in parallel
    Promise.all([
      axios.get('/api/v1/entra/licenses',        { headers }),
      axios.get('/api/v1/settings/license-config', { headers }),
    ])
      .then(([licRes, cfgRes]) => {
        // Apply custom names from config
        const cfgMap = Object.fromEntries(cfgRes.data.map(c => [c.sku_id, c]))
        const merged = licRes.data.map(l => {
          const cfg = cfgMap[l.sku_id]
          return {
            ...l,
            display_name:        cfg?.display_name || l.display_name,
            assignable:          cfg?.assignable ?? false,
            visible_on_main_page: cfg?.visible_on_main_page ?? false,
          }
        })
        setLicenses(merged)
        setAssignableIds(new Set(cfgRes.data.filter(c => c.visible_on_main_page).map(c => c.sku_id)))
      })
      .catch(err => {
        if (err.response?.status === 503) setError('not_configured')
        else setError('fetch_error')
      })
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleSort(field) {
    setSort(prev =>
      prev.field === field
        ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: field === 'display_name' ? 'asc' : 'desc' }
    )
  }

  const filtered = useMemo(() => {
    if (!licenses) return []
    const q_lower = q.toLowerCase()
    let rows = showAll
      ? licenses
      : licenses.filter(l => l.visible_on_main_page)
    if (q_lower) rows = rows.filter(l =>
      l.display_name.toLowerCase().includes(q_lower) ||
      l.sku_part_number.toLowerCase().includes(q_lower)
    )

    return [...rows].sort((a, b) => {
      let av = a[sort.field]
      let bv = b[sort.field]
      if (typeof av === 'string') {
        const cmp = av.localeCompare(bv, undefined, { sensitivity: 'base' })
        return sort.dir === 'asc' ? cmp : -cmp
      }
      return sort.dir === 'asc' ? av - bv : bv - av
    })
  }, [licenses, q, sort])

  // Summary totals
  const totals = useMemo(() => {
    if (!licenses) return null
    return licenses.reduce(
      (acc, l) => ({
        total:    acc.total    + l.total,
        assigned: acc.assigned + l.assigned,
        available:acc.available + l.available,
      }),
      { total: 0, assigned: 0, available: 0 }
    )
  }, [licenses])

  // ---------------------------------------------------------------------------
  // Render states
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading licenses…
      </div>
    )
  }

  if (error === 'not_configured') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <Cloud className="h-12 w-12 text-slate-600" />
        <div>
          <p className="text-base font-medium text-slate-300">Entra ID not connected</p>
          <p className="mt-1 text-sm text-slate-500">
            Connect Entra ID in{' '}
            <a href="/settings" className="text-brand-primary hover:underline">Settings</a>
            {' '}to view tenant license information.
          </p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-danger">
        <AlertCircle className="h-5 w-5 shrink-0" />
        Failed to load license data. Ensure the app registration has Directory.Read.All or Organization.Read.All permission.
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Main view
  // ---------------------------------------------------------------------------

  const COLS = [
    { field: 'display_name', label: 'License',    align: 'left',  w: 'flex-1' },
    { field: 'total',        label: 'Total',      align: 'right', w: 'w-20'   },
    { field: 'assigned',     label: 'Assigned',   align: 'right', w: 'w-24'   },
    { field: 'available',    label: 'Available',  align: 'right', w: 'w-24'   },
    { field: '_utilization', label: 'Utilization',align: 'left',  w: 'w-36'   },
    { field: 'capability_status', label: 'Status',align: 'left',  w: 'w-24'   },
  ]

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header bar */}
      <div className="shrink-0 border-b border-border-subtle bg-surface px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold text-slate-200">
              Tenant Licenses
              {licenses && (
                <span className="ml-2 text-sm font-normal text-slate-500">
                  {filtered.length}{!showAll && licenses.length !== filtered.length ? ` of ${licenses.length}` : ''} SKU{filtered.length !== 1 ? 's' : ''}
                </span>
              )}
            </h1>
            {/* Show all / assignable toggle */}
            {licenses && (
              <button
                onClick={() => setShowAll(v => !v)}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                  showAll
                    ? 'border-brand-primary/40 bg-brand-primary/10 text-brand-primary'
                    : 'border-border-subtle text-slate-400 hover:text-slate-200'
                }`}
              >
                {showAll ? 'All licenses' : 'Assignable only'}
              </button>
            )}
            <Link
              to="/settings"
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-brand-primary transition-colors"
              title="Configure licenses in Settings"
            >
              <Settings className="h-3 w-3" />
              Configure
            </Link>
          </div>

          {/* Search */}
          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Filter licenses…"
              value={q}
              onChange={e => setQ(e.target.value)}
              className="w-full rounded-md border border-border-subtle bg-app-bg py-1.5 pl-8 pr-3 text-sm text-slate-200 placeholder:text-slate-500 focus:border-brand-primary focus:outline-none"
            />
          </div>
        </div>

        {/* Summary cards */}
        {totals && (
          <div className="mt-3 flex gap-4">
            {[
              { label: 'Total seats',     value: totals.total.toLocaleString(),     color: 'text-slate-300' },
              { label: 'Assigned',        value: totals.assigned.toLocaleString(),  color: 'text-warning'   },
              { label: 'Available',       value: totals.available.toLocaleString(), color: 'text-success'   },
            ].map(c => (
              <div key={c.label} className="rounded-md border border-border-subtle/50 bg-app-bg/60 px-4 py-2.5">
                <p className="text-xs text-slate-500">{c.label}</p>
                <p className={`text-xl font-semibold tabular-nums ${c.color}`}>{c.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-border-subtle">
              {COLS.map(col => (
                <th
                  key={col.field}
                  onClick={() => col.field !== '_utilization' && toggleSort(col.field)}
                  className={`${col.w} px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  } ${col.field !== '_utilization' ? 'cursor-pointer select-none hover:text-slate-300' : ''}`}
                >
                  {col.label}
                  {col.field !== '_utilization' && <SortIcon field={col.field} sort={sort} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                  {q ? (
                    <>No licenses match &ldquo;{q}&rdquo;</>
                  ) : !showAll && licenses?.length > 0 ? (
                    <>
                      No licenses are marked visible on this page.{' '}
                      <Link to="/settings" className="text-brand-primary hover:underline">
                        Go to Settings → Entra → License Configuration
                      </Link>
                      {' '}to enable "Visible on main page", or{' '}
                      <button onClick={() => setShowAll(true)} className="text-brand-primary hover:underline">
                        show all {licenses.length} licenses
                      </button>.
                    </>
                  ) : 'No licenses found.'}
                </td>
              </tr>
            )}
            {filtered.map(lic => {
              const overProvisioned = lic.assigned > lic.total
              return (
                <tr
                  key={lic.sku_id}
                  className="border-b border-border-subtle/30 hover:bg-white/[0.02]"
                >
                  {/* License name */}
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-slate-200">{lic.display_name}</p>
                    <p className="text-xs text-slate-600">{lic.sku_part_number}</p>
                  </td>

                  {/* Total */}
                  <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-300">
                    {lic.total.toLocaleString()}
                  </td>

                  {/* Assigned */}
                  <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-300">
                    {lic.assigned.toLocaleString()}
                  </td>

                  {/* Available */}
                  <td className={`px-4 py-3 text-right text-sm font-medium tabular-nums ${
                    overProvisioned ? 'text-danger' : lic.available === 0 ? 'text-warning' : 'text-success'
                  }`}>
                    {overProvisioned ? `−${(lic.assigned - lic.total).toLocaleString()}` : lic.available.toLocaleString()}
                  </td>

                  {/* Utilization bar */}
                  <td className="px-4 py-3">
                    <UtilBar assigned={lic.assigned} total={lic.total} />
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    <StatusDot status={lic.capability_status} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
