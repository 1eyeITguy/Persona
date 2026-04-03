import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet, NavLink } from 'react-router-dom'
import { Settings, Shield, LogOut } from 'lucide-react'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import { useAppConfig } from './hooks/useAppConfig.js'
import SetupWizard from './components/SetupWizard.jsx'
import LoginForm from './components/LoginForm.jsx'
import ADTree from './components/ADTree.jsx'
import UserPanel from './components/UserPanel.jsx'
import SettingsPage from './components/SettingsPage.jsx'

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
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-brand-primary/20 text-brand-primary font-medium'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
              }`
            }
          >
            <Shield className="h-4 w-4 shrink-0" />
            AD Directory
          </NavLink>
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

function DirectoryPage() {
  const [selectedUserDn, setSelectedUserDn] = useState(null)

  return (
    <div className="flex h-full overflow-hidden">
      {/* Tree panel — scrollable */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="border-b border-border-subtle px-4 py-3">
          <h2 className="text-sm font-medium text-slate-300">Active Directory</h2>
        </div>
        <ADTree onUserSelect={setSelectedUserDn} />
      </div>

      {/* User attribute panel — slides in alongside tree */}
      {selectedUserDn && (
        <UserPanel
          userDn={selectedUserDn}
          onClose={() => setSelectedUserDn(null)}
        />
      )}
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

  if (loading) return <FullScreenSpinner />
  if (!setupComplete) return <SetupWizard />
  if (!user) return <LoginForm />

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<DirectoryPage />} />
        <Route path="/settings" element={<SettingsPagePlaceholder />} />
        <Route path="*" element={<Navigate to="/" replace />} />
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
