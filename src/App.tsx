import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { Analisis } from './pages/Analisis'
import { Buscador } from './pages/Buscador'
import { Scanner } from './pages/Scanner'
import { Favoritos } from './pages/Favoritos'
import { Configuracion } from './pages/Configuracion'
import { Activo } from './pages/Activo'

function Placeholder({ title }: { title: string }) {
  return (
    <>
      <h1 className="page-title">{title}</h1>
      <p className="page-sub">Sección en construcción.</p>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="scanner" element={<Scanner />} />
          <Route path="favoritos" element={<Favoritos />} />
          <Route path="buscador" element={<Buscador />} />
          <Route path="activo/:symbol" element={<Activo />} />
          <Route path="portfolio" element={<Placeholder title="Portfolio" />} />
          <Route path="configuracion" element={<Configuracion />} />
          <Route path="alertas" element={<Placeholder title="Alertas" />} />
          <Route path="analisis" element={<Analisis />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
