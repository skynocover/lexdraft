import { Routes, Route, Navigate } from 'react-router'
import { useAuthStore } from './stores/useAuthStore'
import { TokenLogin } from './pages/TokenLogin'
import { CaseList } from './pages/CaseList'
import { CaseCreate } from './pages/CaseCreate'
import { CaseWorkspace } from './pages/CaseWorkspace'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token)
  if (!token) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<TokenLogin />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <CaseList />
          </ProtectedRoute>
        }
      />
      <Route
        path="/cases/new"
        element={
          <ProtectedRoute>
            <CaseCreate />
          </ProtectedRoute>
        }
      />
      <Route
        path="/cases/:caseId"
        element={
          <ProtectedRoute>
            <CaseWorkspace />
          </ProtectedRoute>
        }
      />
    </Routes>
  )
}
