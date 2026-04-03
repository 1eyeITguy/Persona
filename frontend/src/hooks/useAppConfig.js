import { useState, useEffect } from 'react'
import axios from 'axios'

export function useAppConfig() {
  const [setupComplete, setSetupComplete] = useState(false)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios
      .get('/api/v1/settings/status')
      .then((res) => {
        setStatus(res.data)
        setSetupComplete(res.data.setup_complete)
      })
      .catch((err) => {
        setError(err)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  return { setupComplete, status, loading, error }
}
