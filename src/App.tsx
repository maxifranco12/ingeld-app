import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { AdminOnly, ProtectedRoute } from './components/ProtectedRoute'
import { useAuth } from './context/AuthContext'
import { Dashboard } from './pages/Dashboard'
import { Analisis } from './pages/Analisis'
import { Buscador } from './pages/Buscador'
import { Scanner } from './pages/Scanner'
import { Favoritos } from './pages/Favoritos'
import { Configuracion } from './pages/Configuracion'
import { Activo } from './pages/Activo'
import { Portfolio } from './pages/Portfolio'
import { Alertas } from './pages/Alertas'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import { ForgotPassword } from './pages/ForgotPassword'
import { Perfil } from './pages/Perfil'
import { Landing } from './pages/Landing'
import { Comparador } from './pages/Comparador'
import { Historial } from './pages/Historial'
import { Metas } from './pages/Metas'
import { NetWorth } from './pages/NetWorth'
import PortfoliosIA from './pages/PortfoliosIA'

function RootRoute() {
  const { isAuthenticated, loading } = useAuth()
  if (loading) return <Landing />
  return isAuthenticated ? <Navigate to="/panel" replace /> : <Landing />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootRoute />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />

        <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Layout />}>
            <Route path="panel" element={<Dashboard />} />
            <Route path="buscador" element={<Buscador />} />
            <Route path="scanner" element={<Scanner />} />
            <Route path="favoritos" element={<Favoritos />} />
            <Route path="activo/:symbol" element={<Activo />} />
            <Route path="portfolio" element={<Portfolio />} />
            <Route path="configuracion" element={<Configuracion />} />
            <Route path="alertas" element={<Alertas />} />
            <Route path="analisis" element={<Analisis />} />
            <Route path="perfil" element={<Perfil />} />
            <Route path="comparador" element={<Comparador />} />
            <Route path="historial" element={<Historial />} />
            <Route path="metas" element={<Metas />} />
            <Route path="networth" element={<NetWorth />} />
            <Route path="portfolios-ia" element={<PortfoliosIA />} />
            <Route path="admin" element={<AdminOnly />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
