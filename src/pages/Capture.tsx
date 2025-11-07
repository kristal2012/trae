import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import '../App.css'

export default function Capture() {
  const [leftImage, setLeftImage] = useState<string | null>(null)
  const [rightImage, setRightImage] = useState<string | null>(null)
  const leftInputRef = useRef<HTMLInputElement | null>(null)
  const rightInputRef = useRef<HTMLInputElement | null>(null)
  const navigate = useNavigate()

  const onPick = (e: React.ChangeEvent<HTMLInputElement>, side: 'left' | 'right') => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : ''
      side === 'left' ? setLeftImage(url) : setRightImage(url)
    }
    reader.readAsDataURL(file)
  }

  const reset = () => {
    setLeftImage(null)
    setRightImage(null)
    if (leftInputRef.current) leftInputRef.current.value = ''
    if (rightInputRef.current) rightInputRef.current.value = ''
  }

  const analyze = () => {
    if (!leftImage || !rightImage) return
    navigate('/analise', { state: { leftImage, rightImage } })
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Shakti — Leitura de Mãos</h1>
        <p className="subtitle">Harmonia, autoconhecimento e sabedoria védica em cada linha.</p>
      </header>

      <section className="guidance">
        <h2>Orientações para Captura</h2>
        <ul>
          <li>Use boa iluminação e fundo neutro.</li>
          <li>Mantenha a mão aberta, relaxada e centralizada.</li>
          <li>Evite sombras fortes; aproxime sem desfocar.</li>
        </ul>
      </section>

      <section className="capture">
        <div className="capture-block">
          <h3>Palma Esquerda</h3>
          {!leftImage ? (
            <label className="upload">
              <input
                ref={leftInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => onPick(e, 'left')}
              />
              <span>Toque para fotografar</span>
            </label>
          ) : (
            <div className="preview">
              <img src={leftImage} alt="Palma esquerda" />
              <button className="btn" onClick={() => setLeftImage(null)}>Refazer</button>
            </div>
          )}
        </div>

        <div className="capture-block">
          <h3>Palma Direita</h3>
          {!rightImage ? (
            <label className="upload">
              <input
                ref={rightInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => onPick(e, 'right')}
              />
              <span>Toque para fotografar</span>
            </label>
          ) : (
            <div className="preview">
              <img src={rightImage} alt="Palma direita" />
              <button className="btn" onClick={() => setRightImage(null)}>Refazer</button>
            </div>
          )}
        </div>
      </section>

      <footer className="actions">
        <button className="btn secondary" onClick={reset}>Limpar</button>
        <button className="btn primary" disabled={!leftImage || !rightImage} onClick={analyze}>Analisar</button>
      </footer>
    </div>
  )
}