import { create } from 'zustand'

interface AuthState {
  token: string | null
  setToken: (token: string) => void
  clearToken: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('auth_token'),
  setToken: (token) => {
    localStorage.setItem('auth_token', token)
    set({ token })
  },
  clearToken: () => {
    localStorage.removeItem('auth_token')
    set({ token: null })
  },
}))
