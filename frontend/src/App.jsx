import { useState, useRef, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet, NavLink } from 'react-router-dom'
import { Settings, Shield, LogOut, Users, Monitor, Loader2 } from 'lucide-react'
import axios from 'axios'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import { useAppConfig } from './hooks/useAppConfig.js'
import SetupWizard from './components/SetupWizard.jsx'
import LoginForm from './components/LoginForm.jsx'
import ADTree from './components/ADTree.jsx'
import UserDetail from './components/UserDetail.jsx'
import DeviceDetail from './components/DeviceDetail.jsx'
import SettingsPage from './components/SettingsPage.jsx'
import SearchBar from './components/SearchBar.jsx'
import SearchResults from './components/SearchResults.jsx'

// ---------------------------------------------------------------------------
// Loading screen
// ---------------------------------------------------------------------------

function FullScreenSpinner() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-app-bg">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-primary border-t-transparent" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Entra OAuth2 callback page
// Handles the redirect from Microsoft after the admin authenticates.
// Exchanges the authorization code for a session token, stores it in
// sessionStorage, then redirects back to the app root (/ → SetupWizard).
// ---------------------------------------------------------------------------

function EntraCallbackPage() {
  const [status, setStatus] = useState('exchanging') // 'exchanging' | 'error'
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')
    const error = params.get('error')
    const errorDescription = params.get('error_description')

    if (error) {
      setErrorMsg(errorDescription || error)
      setStatus('error')
      return
    }

    if (!code || !state) {
      setErrorMsg('Missing authorization parameters in callback URL.')
      setStatus('error')
      return
    }

    axios.post('/api/v1/entra/oauth2/exchange', { code, state })
      .then(res => {
        if (res.data.success && res.data.session_token) {
          sessionStorage.setItem('entra_session_token', res.data.session_token)
          window.location.replace('/')
        } else {
          setErrorMsg(res.data.message || 'Token exchange failed.')
          setStatus('error')
        }
      })
      .catch(err => {
        setErrorMsg(err.response?.data?.detail || 'Token exchange failed.')
        setStatus('error')
      })
  }, [])

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-app-bg px-4">
      <div className="w-full max-w-sm rounded-xl border border-border-subtle bg-surface p-8 text-center shadow-2xl">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-primary mx-auto mb-4 shadow-lg">
          <Shield className="h-7 w-7 text-white" />
        </div>
        {status === 'exchanging' ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin text-brand-primary mx-auto mb-3" />
            <p className="text-sm text-slate-400">Completing sign-in...</p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-danger mb-2">Sign-in failed</p>
            <p className="text-xs text-slate-400 mb-4">{errorMsg}</p>
            <button
              onClick={() => window.location.replace('/')}
              className="text-sm text-brand-primary hover:underline"
            >
              Return to setup
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// App shell — sidebar + header + content area
// ---------------------------------------------------------------------------

function AppShell() {
  const { user, logout } = useAuth()

  return (
    <div className="flex h-screen bg-app-bg text-slate-200">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r border-border-subtle bg-surface">
        {/* Logo */}
        <div className="flex items-center gap-2 px-5 py-5 border-b border-border-subtle">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-primary">
            <Shield className="h-4 w-4 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-white">Persona</span>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {/* AD Directory group */}
          <p className="flex items-center gap-2.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <Shield className="h-3.5 w-3.5 shrink-0" />
            AD Directory
          </p>
          <div className="ml-2 space-y-0.5">
            <NavLink
              to="/users"
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-brand-primary/20 text-brand-primary font-medium'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`
              }
            >
              <Users className="h-4 w-4 shrink-0" />
              Users
            </NavLink>
            <NavLink
              to="/devices"
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-brand-primary/20 text-brand-primary font-medium'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`
              }
            >
              <Monitor className="h-4 w-4 shrink-0" />
              Devices
            </NavLink>
          </div>
        </nav>

        {/* Gear — settings */}
        <div className="border-t border-border-subtle px-3 py-3">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-brand-primary/20 text-brand-primary font-medium'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
              }`
            }
          >
            <Settings className="h-4 w-4 shrink-0" />
            Settings
          </NavLink>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top header */}
        <header className="flex items-center justify-between border-b border-border-subtle bg-surface px-6 py-3">
          <div />
          <div className="flex items-center gap-4">
            {/* Connect to Entra — Phase 2 stub */}
            <div className="relative group">
              <button
                disabled
                className="cursor-not-allowed rounded-md bg-gradient-to-r from-brand-primary to-brand-accent px-4 py-1.5 text-sm font-medium text-white opacity-60"
              >
                Connect to Entra
              </button>
              <span className="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-700 px-2 py-1 text-xs text-slate-200 opacity-0 transition-opacity group-hover:opacity-100">
                Coming soon
              </span>
            </div>

            {/* User info + logout */}
            {user && (
              <>
                <span className="text-sm text-slate-400">{user.display_name}</span>
                <button
                  onClick={logout}
                  className="flex items-center gap-1 rounded-md px-2 py-1.5 text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-colors"
                  title="Log out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Placeholder pages (replaced by Prompts 9 & 10)
// ---------------------------------------------------------------------------

function UsersPage() {
  const [selectedUserDn, setSelectedUserDn] = useState(null)
  const [treeWidth, setTreeWidth] = useState(260)
  const containerRef = useRef(null)

  // null  = no active search (tree shown)
  // []    = search returned no results
  // [...] = search results
  const [searchResults, setSearchResults]   = useState(null)
  const [isSearchLoading, setIsSearchLoading] = useState(false)

  const isSearchActive = searchResults !== null

  function startResize(e) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = treeWidth

    function onMouseMove(e) {
      const containerWidth = containerRef.current?.getBoundingClientRect().width ?? 9999
      const raw = startWidth + (e.clientX - startX)
      setTreeWidth(Math.max(160, Math.min(containerWidth - 400, raw)))
    }

    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  function handleSearchResults(results) {
    setSearchResults(results)
    setIsSearchLoading(false)
    setSelectedUserDn(null)
  }

  function handleSearchClear() {
    setSearchResults(null)
    setIsSearchLoading(false)
    setSelectedUserDn(null)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* Full-width search bar */}
      <SearchBar
        onResults={handleSearchResults}
        onClear={handleSearchClear}
        isActive={isSearchActive}
      />

      {/* Split pane */}
      <div ref={containerRef} className="flex flex-1 overflow-hidden">

        {/* Left panel — tree or search results */}
        <div
          style={selectedUserDn ? { width: treeWidth, minWidth: treeWidth } : undefined}
          className={`flex flex-col border-r border-border-subtle ${
            selectedUserDn ? 'shrink-0' : 'flex-1'
          }`}
        >
          {/* Panel header */}
          <div className="shrink-0 border-b border-border-subtle px-4 py-3">
            <h2 className="text-sm font-medium text-slate-300">
              {isSearchActive
                ? `Results (${searchResults.length})`
                : 'Active Directory'}
            </h2>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-auto">
            {isSearchActive ? (
              <SearchResults
                results={searchResults}
                isLoading={isSearchLoading}
                selectedDn={selectedUserDn}
                onUserSelect={setSelectedUserDn}
              />
            ) : (
              <ADTree
                onUserSelect={setSelectedUserDn}
                selectedDn={selectedUserDn}
              />
            )}
          </div>
        </div>

        {/* Drag-to-resize handle */}
        {selectedUserDn && (
          <div
            onMouseDown={startResize}
            title="Drag to resize"
            className="w-1 shrink-0 cursor-col-resize select-none bg-border-subtle transition-colors hover:bg-brand-primary/50 active:bg-brand-primary/70"
          />
        )}

        {/* User detail panel */}
        {selectedUserDn && (
          <UserDetail
            userDn={selectedUserDn}
            onClose={() => setSelectedUserDn(null)}
            onUserSelect={setSelectedUserDn}
          />
        )}
      </div>
    </div>
  )
}

function DevicesPage() {
  const [selectedDn, setSelectedDn]       = useState(null)
  const [treeWidth, setTreeWidth]         = useState(260)
  const containerRef                      = useRef(null)
  const [searchResults, setSearchResults] = useState(null)
  const [isSearchLoading, setIsSearchLoading] = useState(false)
  const isSearchActive = searchResults !== null

  function startResize(e) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = treeWidth
    function onMouseMove(e) {
      const containerWidth = containerRef.current?.getBoundingClientRect().width ?? 9999
      const raw = startWidth + (e.clientX - startX)
      setTreeWidth(Math.max(160, Math.min(containerWidth - 400, raw)))
    }
    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SearchBar
        mode="devices"
        onResults={results => { setSearchResults(results); setIsSearchLoading(false); setSelectedDn(null) }}
        onClear={() => { setSearchResults(null); setIsSearchLoading(false); setSelectedDn(null) }}
        isActive={isSearchActive}
      />
      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        <div
          style={selectedDn ? { width: treeWidth, minWidth: treeWidth } : undefined}
          className={`flex flex-col border-r border-border-subtle ${selectedDn ? 'shrink-0' : 'flex-1'}`}
        >
          <div className="shrink-0 border-b border-border-subtle px-4 py-3">
            <h2 className="text-sm font-medium text-slate-300">
              {isSearchActive ? `Results (${searchResults.length})` : 'Active Directory'}
            </h2>
          </div>
          <div className="flex-1 overflow-auto">
            {isSearchActive ? (
              <SearchResults
                mode="devices"
                results={searchResults}
                isLoading={isSearchLoading}
                selectedDn={selectedDn}
                onUserSelect={setSelectedDn}
              />
            ) : (
              <ADTree
                mode="devices"
                onUserSelect={setSelectedDn}
                selectedDn={selectedDn}
              />
            )}
          </div>
        </div>
        {selectedDn && (
          <div
            onMouseDown={startResize}
            title="Drag to resize"
            className="w-1 shrink-0 cursor-col-resize select-none bg-border-subtle transition-colors hover:bg-brand-primary/50 active:bg-brand-primary/70"
          />
        )}
        {selectedDn && (
          <DeviceDetail
            deviceDn={selectedDn}
            onClose={() => setSelectedDn(null)}
          />
        )}
      </div>
    </div>
  )
}

function SettingsPagePlaceholder() {
  return <SettingsPage />
}

// ---------------------------------------------------------------------------
// Root router
// ---------------------------------------------------------------------------

function AppRoutes() {
  const { setupComplete, loading } = useAppConfig()
  const { user } = useAuth()

  // Handle OAuth2 callback regardless of setup/auth state
  if (window.location.pathname === '/entra-callback') {
    return <EntraCallbackPage />
  }

  if (loading) return <FullScreenSpinner />
  if (!setupComplete) return <SetupWizard />
  if (!user) return <LoginForm />

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/"        element={<Navigate to="/users" replace />} />
        <Route path="/users"   element={<UsersPage />} />
        <Route path="/devices" element={<DevicesPage />} />
        <Route path="/settings" element={<SettingsPagePlaceholder />} />
        <Route path="*"        element={<Navigate to="/users" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
