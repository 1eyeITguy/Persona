import { useState, useEffect, useRef } from 'react'
import axios from 'axios'

/**
 * Fetches filter option data once on mount and caches the result.
 *
 * getToken — function returning the current JWT (from AuthContext).
 * mode     — "users" fetches /ad/filter-options (departments, offices, groups, ous)
 *            "devices" fetches /ad/device-filter-options (operating_systems, ous)
 */

const EMPTY_USERS   = { departments: [], offices: [], groups: [], ous: [] }
const EMPTY_DEVICES = { operating_systems: [], ous: [] }

export function useFilterOptions(getToken, mode = 'users') {
  const empty = mode === 'devices' ? EMPTY_DEVICES : EMPTY_USERS
  const [options, setOptions] = useState(empty)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const getTokenRef = useRef(getToken)
  getTokenRef.current = getToken

  useEffect(() => {
    const token = getTokenRef.current()
    const url   = mode === 'devices'
      ? '/api/v1/ad/device-filter-options'
      : '/api/v1/ad/filter-options'

    axios
      .get(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(res => setOptions(res.data))
      .catch(() => setError('Failed to load filter options'))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { options, loading, error }
}
