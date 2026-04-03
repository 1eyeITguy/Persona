import { useState, useRef } from 'react'
import axios from 'axios'

/**
 * Manages all directory tree state: children cache, loading, errors, expansion.
 *
 * getToken — function returning the current JWT (from AuthContext).
 *
 * Children are cached by DN after the first fetch — collapsing/re-expanding
 * never re-fetches (except on explicit error-retry).
 */
export function useADTree(getToken) {
  // DN → ADNode[] children
  const [nodeMap, setNodeMap] = useState({})
  // Set of DNs currently being fetched (uses '__root__' for the initial tree load)
  const [loadingSet, setLoadingSet] = useState(new Set())
  // DN → error message string
  const [errorMap, setErrorMap] = useState({})
  // Set of expanded DNs
  const [expandedSet, setExpandedSet] = useState(new Set())
  // The base DN returned by the server on first load
  const [rootDn, setRootDn] = useState(null)

  // Keep getToken accessible in async callbacks without it being a dep
  const getTokenRef = useRef(getToken)
  getTokenRef.current = getToken

  // Tracks which DNs have already been fetched to skip cache-hits
  const fetchedRef = useRef(new Set())

  function buildHeaders() {
    const token = getTokenRef.current()
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  async function fetchRoot() {
    if (fetchedRef.current.has('__root__')) return
    fetchedRef.current.add('__root__')
    setLoadingSet(prev => new Set([...prev, '__root__']))
    try {
      const res = await axios.get('/api/v1/ad/tree', { headers: buildHeaders() })
      const { dn, children } = res.data
      setRootDn(dn)
      setNodeMap(prev => ({ ...prev, [dn]: children }))
    } catch {
      fetchedRef.current.delete('__root__')
      setErrorMap(prev => ({ ...prev, __root__: 'Failed to load directory root.' }))
    } finally {
      setLoadingSet(prev => { const s = new Set(prev); s.delete('__root__'); return s })
    }
  }

  async function fetchChildren(dn) {
    if (fetchedRef.current.has(dn)) return
    fetchedRef.current.add(dn)
    setLoadingSet(prev => new Set([...prev, dn]))
    try {
      const enc = encodeURIComponent(dn)
      const res = await axios.get(`/api/v1/ad/ou/${enc}/children`, { headers: buildHeaders() })
      setNodeMap(prev => ({ ...prev, [dn]: res.data }))
    } catch {
      fetchedRef.current.delete(dn)
      setErrorMap(prev => ({ ...prev, [dn]: 'Failed to load children.' }))
    } finally {
      setLoadingSet(prev => { const s = new Set(prev); s.delete(dn); return s })
    }
  }

  function toggleExpand(dn) {
    setExpandedSet(prev => {
      const s = new Set(prev)
      if (s.has(dn)) {
        s.delete(dn)
      } else {
        s.add(dn)
        fetchChildren(dn)
      }
      return s
    })
  }

  return { nodeMap, loadingSet, errorMap, expandedSet, rootDn, fetchRoot, toggleExpand }
}
