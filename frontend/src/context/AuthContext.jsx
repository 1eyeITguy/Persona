import { createContext, useContext, useState } from 'react'

// Token is kept in a module-level variable — NOT localStorage or sessionStorage.
// This means it's cleared on page refresh, which is intentional: help desk tools
// should require re-authentication after the browser is closed or refreshed.
let _token = null

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)

  function login(token, userData) {
    _token = token
    setUser(userData)
  }

  function logout() {
    _token = null
    setUser(null)
  }

  function getToken() {
    return _token
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, getToken }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
