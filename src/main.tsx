import React from 'react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    try { console.log('ErrorBoundary caught:', error.message) } catch {}
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, color: '#e6e6f0' }}>
          <h2>Falha ao renderizar a aplicação</h2>
          <p>Tente voltar para a página de Captura e iniciar novamente.</p>
          <p style={{ color: '#cfcfe2' }}>Detalhe: {this.state.error.message}</p>
          <a className="btn secondary" href="/">Voltar</a>
        </div>
      )
    }
    return this.props.children as React.ReactElement
  }
}

try { console.log('Boot: iniciando React root') } catch {}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
