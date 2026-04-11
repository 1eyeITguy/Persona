/* global __APP_VERSION__ */
import { BrowserRouter, Routes, Route, Navigate, Outlet, NavLink } from 'react-router-dom'
import { Settings, Shield, LogOut, Users, UserX, Cloud, Tag } from 'lucide-react'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import { useAppConfig } from './hooks/useAppConfig.js'
import SetupWizard from './components/SetupWizard.jsx'
import LoginForm from './components/LoginForm.jsx'
import SettingsPage from './components/SettingsPage.jsx'
import SyncedUsersPage from './pages/SyncedUsersPage.jsx'
import AdOnlyUsersPage from './pages/AdOnlyUsersPage.jsx'
import EntraOnlyPage from './pages/EntraOnlyPage.jsx'
import LicensesPage from './pages/LicensesPage.jsx'

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
  const { status } = useAppConfig()
  const entraConfigured = status?.entra_configured ?? false

  return (
    <div className="flex h-screen bg-app-bg text-slate-200">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r border-border-subtle bg-surface">
        {/* Logo */}
        <div className="flex items-center gap-2 px-5 py-5 border-b border-border-subtle">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-primary">
            <Shield className="h-4 w-4 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-semibold tracking-tight text-white">Persona</span>
            <span className="text-[10px] text-slate-500 leading-none">v{__APP_VERSION__}</span>
          </div>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {/* Identity group */}
          <p className="flex items-center gap-2.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <Shield className="h-3.5 w-3.5 shrink-0" />
            Identity
          </p>
          <div className="ml-2 space-y-0.5">
            <NavLink
              to="/identity/synced"
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-brand-primary/20 text-brand-primary font-medium'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`
              }
            >
              <Users className="h-4 w-4 shrink-0" />
              Synced Users
            </NavLink>
            <NavLink
              to="/identity/ad-only"
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-brand-primary/20 text-brand-primary font-medium'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`
              }
            >
              <UserX className="h-4 w-4 shrink-0" />
              AD Only
            </NavLink>
            <NavLink
              to="/identity/entra"
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-brand-primary/20 text-brand-primary font-medium'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`
              }
            >
              <Cloud className="h-4 w-4 shrink-0" />
              Entra Only
            </NavLink>
          </div>

          {/* Licenses — only when Entra is connected */}
          {entraConfigured && (
            <>
              <p className="mt-4 flex items-center gap-2.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <Tag className="h-3.5 w-3.5 shrink-0" />
                Licenses
              </p>
              <div className="ml-2 space-y-0.5">
                <NavLink
                  to="/licenses"
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                      isActive
                        ? 'bg-brand-primary/20 text-brand-primary font-medium'
                        : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                    }`
                  }
                >
                  <Tag className="h-4 w-4 shrink-0" />
                  Tenant Licenses
                </NavLink>
              </div>
            </>
          )}
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
        <Route path="/"                  element={<Navigate to="/identity/synced" replace />} />
        <Route path="/identity/synced"   element={<SyncedUsersPage />} />
        <Route path="/identity/ad-only"  element={<AdOnlyUsersPage />} />
        <Route path="/identity/entra"    element={<EntraOnlyPage />} />
        <Route path="/licenses"            element={<LicensesPage />} />
        <Route path="/settings"          element={<SettingsPage />} />
        {/* Legacy redirects */}
        <Route path="/users"             element={<Navigate to="/identity/synced" replace />} />
        <Route path="/devices"           element={<Navigate to="/identity/synced" replace />} />
        <Route path="*"                  element={<Navigate to="/identity/synced" replace />} />
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
