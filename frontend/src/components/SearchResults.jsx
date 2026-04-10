import { Loader2, Search } from 'lucide-react'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function statusChip(status) {
  if (status === 'Disabled')   return 'text-slate-400 bg-slate-400/10'
  if (status === 'Locked Out') return 'text-warning  bg-warning/10'
  return 'text-success bg-success/10'
}

// ---------------------------------------------------------------------------
// SearchResults
// ---------------------------------------------------------------------------

export default function SearchResults({ results, isLoading, selectedDn, onUserSelect, mode = 'users' }) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Searching…
      </div>
    )
  }

  if (!results || results.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-slate-500">
        <Search className="h-8 w-8" />
        <p className="text-sm">No users matched your search</p>
      </div>
    )
  }

  return (
    <div className="min-w-max py-2 pr-4">
      {results.map(user => {
        const isSelected = user.dn === selectedDn
        const label      = mode === 'devices'
          ? (user.name || user.dns_hostname || user.dn)
          : (user.display_name || user.sam_account_name)
        const subtitle   = mode === 'devices'
          ? [user.operating_system, user.dns_hostname].filter(Boolean).join(' · ')
          : [user.department, user.office].filter(Boolean).join(' · ')

        return (
          <div
            key={user.dn}
            onClick={() => onUserSelect(user.dn)}
            className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors ${
              isSelected ? 'bg-brand-primary/20' : 'hover:bg-white/5'
            }`}
          >
            {/* Avatar */}
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                isSelected
                  ? 'bg-brand-primary text-white'
                  : 'bg-brand-primary/20 text-brand-primary'
              }`}
            >
              {getInitials(label)}
            </div>

            {/* Name + subtitle */}
            <div className="min-w-0 flex-1">
              <p
                className={`whitespace-nowrap text-sm font-medium ${
                  isSelected ? 'text-brand-primary' : 'text-slate-200'
                }`}
              >
                {label}
              </p>
              {subtitle && (
                <p className="whitespace-nowrap text-xs text-slate-500">{subtitle}</p>
              )}
            </div>

            {/* Status badge */}
            <span
              className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${statusChip(
                user.account_status
              )}`}
            >
              {user.account_status}
            </span>
          </div>
        )
      })}
    </div>
  )
}
