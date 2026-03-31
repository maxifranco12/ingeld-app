import { Link } from 'react-router-dom'

const FEATURES = [
  ['📈', 'Scanner inteligente', 'Detecta oportunidades en MERVAL, USA y crypto con criterios de analista senior'],
  ['🧠', 'IA de analista senior', 'Análisis fundamental con DCF, múltiplos y señal clara: COMPRAR / VENDER / MANTENER'],
  ['📰', 'Filtro de noticias', 'Distingue ruido de mercado de impacto real en los fundamentos del negocio'],
  ['💼', 'Portfolio en vivo', 'Seguí tu cartera con P&L en tiempo real y análisis IA de tu exposición'],
  ['🔔', 'Alertas inteligentes', 'Te avisamos cuando un activo llega a tu precio objetivo'],
  ['📄', 'Reportes PDF', 'Exportá análisis completos con diseño profesional para compartir'],
]

export function Landing() {
  return (
    <div className="landing-page">
      <section className="landing-hero">
        <div className="landing-hero-inner">
          <h1 className="landing-logo">INGELD</h1>
          <p className="landing-tagline">El asistente financiero que piensa como un analista senior</p>
          <p className="landing-subtitle">
            Análisis técnico + fundamental + IA para inversores que quieren ganar en equity global
          </p>
          <div className="landing-cta">
            <Link to="/register" className="landing-btn landing-btn--primary">
              Empezar gratis
            </Link>
            <Link to="/buscador" className="landing-btn landing-btn--ghost">
              Ver demo
            </Link>
          </div>
        </div>
      </section>

      <section className="landing-features">
        <div className="landing-section-inner">
          <h2 className="landing-section-title">Todo lo que necesitás para decidir mejor</h2>
          <div className="landing-features-grid">
            {FEATURES.map(([icon, title, desc]) => (
              <article key={title} className="feature-card">
                <div className="feature-icon">{icon}</div>
                <h3>{title}</h3>
                <p className="font-prose">{desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-pricing">
        <div className="landing-section-inner">
          <h2 className="landing-section-title">Simple y transparente</h2>
          <div className="landing-pricing-card">
            <p className="landing-price">$5 USD/mes</p>
            <ul className="landing-pricing-list font-prose">
              <li>Scanner avanzado + comparador de activos</li>
              <li>Análisis IA completo (técnico + fundamental + noticias)</li>
              <li>Alertas inteligentes y reportes PDF</li>
              <li>Historial y perfil sincronizado en la nube</li>
            </ul>
            <Link to="/register" className="landing-btn landing-btn--primary">
              Empezar ahora
            </Link>
            <p className="landing-pricing-foot font-prose">Cancelá cuando quieras</p>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-logo">INGELD</div>
        <p className="font-prose">© 2026 INGELD Financial Assistant</p>
        <p className="font-prose">
          Este servicio es informativo y no constituye asesoramiento financiero
        </p>
      </footer>
    </div>
  )
}
