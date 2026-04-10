import { useState, useEffect, useRef } from 'react'
import axios from 'axios'

/**
 * Fetches /api/v1/ad/filter-options once and caches the result.
 *
 * getToken — function returning the current JWT (from AuthContext).
 *
 * Returns { options, loading, error }
 *   options.departments : string[]
 *   options.offices     : string[]
 *   options.groups      : { name, dn }[]
 *   options.ous         : { name, dn }[]
 */

const EMPTY = { departments: [], offices: [], groups: [], ous: [] }

export function useFilterOptions(getToken) {
  const [options, setOptions] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const getTokenRef = useRef(getToken)
  getTokenRef.current = getToken

  useEffect(() => {
    const token = getTokenRef.current()
    axios
      .get('/api/v1/ad/filter-options', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      .then(res => setOptions(res.data))
      .catch(() => setError('Failed to load filter options'))
      .finally(() => setLoading(false))
  }, [])

  return { options, loading, error }
}
