import { Routes, Route, Link } from 'react-router-dom'
import Capture from './pages/Capture'
import Analyze from './pages/Analyze'
import './App.css'

export default function App() {
  return (
    <div className="app">
      <nav style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
        <Link to="/" className="btn secondary">Captura</Link>
        <Link to="/analise" className="btn secondary">Análise</Link>
        <span style={{ marginLeft: 'auto', color: '#cfcfe2' }}>Shakti</span>
      </nav>
      <Routes>
        <Route path="/" element={<Capture />} />
        <Route path="/analise" element={<Analyze />} />
      </Routes>
    </div>
  )
}
