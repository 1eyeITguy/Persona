import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { Shield, Loader2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'

/* global __APP_VERSION__ */

const CHARS = '01アイウエオカキクケコ23456789ABCDEF#$%'

function MatrixRain() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const fontSize = 13
    let drops = []

    function init() {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      const cols = Math.floor(canvas.width / fontSize)
      drops = Array.from({ length: cols }, () => Math.random() * -(canvas.height / fontSize))
    }

    init()
    window.addEventListener('resize', init)

    function draw() {
      // Slow fade — creates the trailing glow effect
      ctx.fillStyle = 'rgba(15, 17, 23, 0.055)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      ctx.font = `${fontSize}px monospace`

      for (let i = 0; i < drops.length; i++) {
        const char = CHARS[Math.floor(Math.random() * CHARS.length)]
        const x = i * fontSize
        const y = drops[i] * fontSize

        // Head of the stream — brighter accent purple
        ctx.fillStyle = 'rgba(124, 58, 237, 0.75)'
        ctx.fillText(char, x, y)

        // Advance drop; reset randomly at bottom
        drops[i] += 0.4
        if (y > canvas.height && Math.random() > 0.978) {
          drops[i] = 0
        }
      }
    }

    const id = setInterval(draw, 55)
    return () => {
      clearInterval(id)
      window.removeEventListener('resize', init)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ opacity: 0.45 }}
    />
  )
}

function Logo() {
  return (
    <div className="flex flex-col items-center mb-8 gap-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-primary shadow-lg">
        <Shield className="h-7 w-7 text-white" />
      </div>
      <span className="text-2xl font-bold tracking-tight text-white">Persona</span>
      <span className="text-xs text-slate-500">v{__APP_VERSION__}</span>
    </div>
  )
}

export default function LoginForm() {
  const { login } = useAuth()
  const navigate = useNavigate()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await axios.post('/api/v1/auth/login', { username, password })
      login(res.data.access_token, res.data.user)
      navigate('/', { replace: true })
    } catch (err) {
      const status = err.response?.status
      if (status === 429) {
        setError('Too many failed attempts. Try again in 15 minutes.')
      } else if (status === 503) {
        setError('Setup is not complete. Please contact your administrator.')
      } else {
        // Never expose credential detail — always generic
        setError('Invalid username or password.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-app-bg px-4">
      <MatrixRain />
      <div className="relative z-10 w-full max-w-sm">
        <Logo />

        <div className="rounded-xl border border-border-subtle bg-surface p-8 shadow-2xl">
          <h1 className="mb-1 text-lg font-semibold text-white">Sign in</h1>
          <p className="mb-6 text-sm text-slate-400">
            Use your Windows username (e.g. first.last), or the local admin account
          </p>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium text-slate-300 mb-1"
              >
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                className="w-full rounded-md border border-border-subtle bg-app-bg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-slate-300 mb-1"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="w-full rounded-md border border-border-subtle bg-app-bg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
              />
            </div>

            {error && (
              <div className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-brand-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-primary/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Sign in
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
