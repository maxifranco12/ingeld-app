import { useNavigate } from 'react-router-dom'

export function PageBackButton() {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className="page-back"
      onClick={() => navigate(-1)}
    >
      ← Volver
    </button>
  )
}
