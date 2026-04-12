import { useState } from 'react'
import { AlertTriangle, X, Loader2, CheckCircle2, XCircle, MinusCircle } from 'lucide-react'
import axios from 'axios'

// ---------------------------------------------------------------------------
// Service label map
// ---------------------------------------------------------------------------
const SERVICE_LABELS = {
  intune:    'Intune',
  autopilot: 'Autopilot',
  entra:     'Entra ID',
  ad:        'Active Directory',
}

// ---------------------------------------------------------------------------
// DeviceOffboardModal
//
// Props:
//   devices    — array of EntraDevice objects (already filtered to selected corporate devices)
//   getToken   — function returning the current JWT string
//   onClose    — called on cancel (only in confirm phase)
//   onComplete — called after offboard finishes, receives DeviceOffboardResult.items
// ---------------------------------------------------------------------------
export default function DeviceOffboardModal({ devices, getToken, onClose, onComplete }) {
  const [phase, setPhase] = useState('confirm')   // 'confirm' | 'progress' | 'done'
  const [error, setError] = useState(null)
  const [results, setResults] = useState(null)

  // Per-device, per-service selections.
  // Initialized from device presence flags; AD defaults to unchecked.
  const [selections, setSelections] = useState(() =>
    Object.fromEntries(
      devices.map(d => [
        d.device_id,
        {
          remove_from_intune:    d.in_intune    ?? false,
          remove_from_autopilot: d.in_autopilot ?? false,
          remove_from_entra:     d.in_entra     ?? false,
          remove_from_ad:        false,
        },
      ])
    )
  )

  function toggleService(deviceId, service) {
    setSelections(prev => ({
      ...prev,
      [deviceId]: {
        ...prev[deviceId],
        [service]: !prev[deviceId][service],
      },
    }))
  }

  // True if at least one service is selected across all devices
  const hasAnySelected = devices.some(d =>
    Object.values(selections[d.device_id] ?? {}).some(Boolean)
  )

  async function handleConfirm() {
    setPhase('progress')
    setError(null)

    const payload = {
      devices: devices.map(d => ({
        device_id:             d.device_id,
        intune_device_id:      d.intune_device_id ?? null,
        entra_device_id:       d.entra_device_id  ?? null,
        serial_number:         d.serial_number    ?? null,
        display_name:          d.display_name     ?? null,
        ...selections[d.device_id],
      })),
    }

    try {
      const token = getToken()
      const res = await axios.post('/api/v1/entra/devices/offboard', payload, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      setResults(res.data.items)
      setPhase('done')
    } catch (err) {
      setError(err.response?.data?.detail || 'Offboard request failed. Check network and permissions.')
      setPhase('confirm')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={phase === 'confirm' ? onClose : undefined}
    >
      <div
        className="flex w-[500px] max-h-[80vh] flex-col rounded-lg border border-border-subtle bg-surface shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-200">
            {phase === 'done' ? 'Offboard Results' : 'Offboard Device' + (devices.length > 1 ? 's' : '')}
          </h2>
          {phase !== 'progress' && (
            <button
              onClick={phase === 'confirm' ? onClose : () => onComplete(results)}
              className="rounded p-1 text-slate-500 hover:text-slate-300"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {phase === 'confirm' && (
            <>
              {/* Warning banner */}
              <div className="flex items-start gap-3 rounded-md border border-warning/30 bg-warning/10 px-4 py-3">
                <AlertTriangle className="h-4 w-4 shrink-0 text-warning mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-warning">This action is irreversible.</p>
                  <p className="text-xs text-slate-400">
                    Removing a device from Entra ID also permanently deletes any stored BitLocker
                    recovery keys for that device.
                  </p>
                </div>
              </div>

              {error && (
                <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
                  {error}
                </div>
              )}

              {/* Per-device selections */}
              <div className="space-y-4">
                {devices.map(d => {
                  const sel = selections[d.device_id]
                  return (
                    <div key={d.device_id} className="rounded-md border border-border-subtle bg-app-bg/60 px-4 py-3 space-y-2">
                      <p className="text-sm font-medium text-slate-200 truncate">
                        {d.display_name || d.device_id}
                      </p>
                      <div className="space-y-1.5">
                        {/* Intune */}
                        <ServiceCheckbox
                          label="Remove from Intune"
                          checked={sel.remove_from_intune}
                          disabled={!d.in_intune}
                          onChange={() => toggleService(d.device_id, 'remove_from_intune')}
                          notPresent={!d.in_intune}
                        />
                        {/* Autopilot */}
                        <ServiceCheckbox
                          label="Remove from Autopilot"
                          checked={sel.remove_from_autopilot}
                          disabled={!d.in_autopilot}
                          onChange={() => toggleService(d.device_id, 'remove_from_autopilot')}
                          notPresent={!d.in_autopilot}
                        />
                        {/* Entra ID */}
                        <ServiceCheckbox
                          label="Remove from Entra ID"
                          checked={sel.remove_from_entra}
                          disabled={!d.in_entra}
                          onChange={() => toggleService(d.device_id, 'remove_from_entra')}
                          notPresent={!d.in_entra}
                        />
                        {/* AD — always shown, unchecked by default */}
                        <ServiceCheckbox
                          label="Disable Active Directory computer object"
                          checked={sel.remove_from_ad}
                          disabled={false}
                          onChange={() => toggleService(d.device_id, 'remove_from_ad')}
                          notPresent={false}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {phase === 'progress' && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-brand-primary" />
              <p className="text-sm text-slate-400">Offboarding device{devices.length > 1 ? 's' : ''}…</p>
              <p className="text-xs text-slate-600">This may take a moment. Do not close this window.</p>
            </div>
          )}

          {phase === 'done' && results && (
            <div className="space-y-4">
              {results.map(item => (
                <div key={item.device_id} className="rounded-md border border-border-subtle bg-app-bg/60 px-4 py-3 space-y-2">
                  <p className="text-sm font-medium text-slate-200 truncate">
                    {item.display_name || item.device_id}
                  </p>
                  <div className="space-y-1">
                    {item.results.map(r => (
                      <ResultRow key={r.service} result={r} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-end gap-3 border-t border-border-subtle px-5 py-4">
          {phase === 'confirm' && (
            <>
              <button
                onClick={onClose}
                className="rounded-md border border-border-subtle px-4 py-2 text-sm text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!hasAnySelected}
                className="rounded-md bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Offboard {devices.length > 1 ? `${devices.length} Devices` : 'Device'}
              </button>
            </>
          )}
          {phase === 'done' && (
            <button
              onClick={() => onComplete(results)}
              className="rounded-md border border-border-subtle px-4 py-2 text-sm text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ServiceCheckbox — a labeled checkbox for a single service
// ---------------------------------------------------------------------------
function ServiceCheckbox({ label, checked, disabled, onChange, notPresent }) {
  return (
    <label className={`flex items-center gap-2.5 cursor-pointer ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="accent-danger"
      />
      <span className="text-xs text-slate-300">{label}</span>
      {notPresent && (
        <span className="text-[10px] text-slate-600 italic">not enrolled</span>
      )}
    </label>
  )
}

// ---------------------------------------------------------------------------
// ResultRow — shows per-service offboard outcome
// ---------------------------------------------------------------------------
function ResultRow({ result }) {
  const label = SERVICE_LABELS[result.service] ?? result.service

  if (!result.attempted) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-600">
        <MinusCircle className="h-3.5 w-3.5 shrink-0" />
        <span className="w-28 shrink-0">{label}</span>
        <span className="italic">{result.error ?? 'not enrolled / skipped'}</span>
      </div>
    )
  }

  if (result.success) {
    return (
      <div className="flex items-center gap-2 text-xs text-success">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span className="w-28 shrink-0">{label}</span>
        <span className="text-slate-500">removed</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 text-xs text-danger">
      <XCircle className="h-3.5 w-3.5 shrink-0" />
      <span className="w-28 shrink-0">{label}</span>
      <span className="text-slate-400 truncate">{result.error ?? 'failed'}</span>
    </div>
  )
}
