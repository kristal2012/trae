import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { detectPalmLines } from '../lib/lineDetection'
import type { DetectedLine } from '../lib/lineDetection'
import { interpretHand, config, resetConfig, applyConfig } from '../lib/interpretation'
import type { Rules } from '../lib/interpretation'
import '../App.css'
import rulesJson from '../data/base_vedica.json'

function drawImageToCanvas(src: string, canvas: HTMLCanvasElement) {
  return new Promise<ImageData>((resolve) => {
    const img = new Image()
    img.onload = () => {
      const maxW = 600
      const scale = Math.min(1, maxW / img.width)
      canvas.width = Math.floor(img.width * scale)
      canvas.height = Math.floor(img.height * scale)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
      resolve(data)
    }
    img.src = src
  })
}

function drawZones(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const leftBand = width * 0.33
  const rightBand = width * 0.67
  const topBand = height * 0.25
  const bottomBand = height * 0.75
  // Sol (topo)
  ctx.fillStyle = 'rgba(255, 255, 0, 0.08)'
  ctx.fillRect(0, 0, width, topBand)
  // Inferior (base)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.03)'
  ctx.fillRect(0, bottomBand, width, height - bottomBand)
  // Júpiter (esquerda)
  ctx.fillStyle = 'rgba(100, 200, 255, 0.06)'
  ctx.fillRect(0, topBand, leftBand, bottomBand - topBand)
  // Mercúrio (direita)
  ctx.fillStyle = 'rgba(255, 100, 200, 0.06)'
  ctx.fillRect(rightBand, topBand, width - rightBand, bottomBand - topBand)
  // Saturno (centro)
  ctx.fillStyle = 'rgba(200, 255, 150, 0.05)'
  ctx.fillRect(leftBand, topBand, rightBand - leftBand, bottomBand - topBand)
  // Vênus (base do polegar)
  const venusRight = width * 0.6
  const venusTop = height * 0.6
  ctx.fillStyle = 'rgba(255, 180, 120, 0.05)'
  ctx.fillRect(venusRight, venusTop, width - venusRight, height - venusTop)
  // grades e rótulos
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(leftBand, 0); ctx.lineTo(leftBand, height)
  ctx.moveTo(rightBand, 0); ctx.lineTo(rightBand, height)
  ctx.moveTo(0, topBand); ctx.lineTo(width, topBand)
  ctx.moveTo(0, bottomBand); ctx.lineTo(width, bottomBand)
  ctx.stroke()
  ctx.fillStyle = 'rgba(220,220,240,0.7)'
  ctx.font = '10px system-ui'
  ctx.fillText('SOL', 6, 12)
  ctx.fillText('JÚPITER', 6, topBand + 12)
  ctx.fillText('SATURNO', leftBand + 6, topBand + 12)
  ctx.fillText('MERCÚRIO', rightBand + 6, topBand + 12)
  ctx.fillText('VÊNUS', venusRight + 6, venusTop + 12)
}

function segmentAngleNearEnd(points: { x: number; y: number }[], near: 'start' | 'end', sample = 12) {
  if (points.length < 2) return 0
  const idxs = near === 'start'
    ? Array.from({ length: Math.min(sample, points.length - 1) }, (_, i) => i)
    : Array.from({ length: Math.min(sample, points.length - 1) }, (_, i) => points.length - 2 - i)
  const angles = idxs.map((i) => Math.atan2(points[i + 1].y - points[i].y, points[i + 1].x - points[i].x))
  let sx = 0, sy = 0
  for (const a of angles) { sx += Math.cos(a); sy += Math.sin(a) }
  return Math.atan2(sy / Math.max(angles.length, 1e-6), sx / Math.max(angles.length, 1e-6))
}

function leftRightEnds(points: { x: number; y: number }[]) {
  const left = points.reduce((a, b) => (a.x < b.x ? a : b))
  const right = points.reduce((a, b) => (a.x > b.x ? a : b))
  return { left, right }
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color: string) {
  const len = 20
  const x2 = x + Math.cos(angle) * len
  const y2 = y + Math.sin(angle) * len
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  // ponta
  const headLen = 6
  const a1 = angle + Math.PI * 0.75
  const a2 = angle - Math.PI * 0.75
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 + Math.cos(a1) * headLen, y2 + Math.sin(a1) * headLen)
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 + Math.cos(a2) * headLen, y2 + Math.sin(a2) * headLen)
  ctx.stroke()
}

function overlayLines(ctx: CanvasRenderingContext2D, lines: DetectedLine[]) {
  const color: Record<string, string> = {
    vida: '#f5d76e',
    cabeca: '#b089f7',
    coracao: '#e66bd3',
    destino: '#6bb9f0',
  }
  ctx.lineWidth = 2
  for (const l of lines) {
    const c = l.label ? color[l.label] : '#ffffff'
    ctx.strokeStyle = c
    ctx.beginPath()
    for (let i = 0; i < l.points.length; i++) {
      const p = l.points[i]
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    }
    ctx.stroke()
    if (l.label) {
      ctx.fillStyle = c
      ctx.font = 'bold 12px system-ui'
      ctx.fillText(l.label.toUpperCase(), l.bbox.x, l.bbox.y - 4)
      const { left, right } = leftRightEnds(l.points)
      const angR = segmentAngleNearEnd(l.points, 'end', 12)
      const angL = segmentAngleNearEnd(l.points, 'start', 12)
      drawArrow(ctx, right.x, right.y, angR, c)
      drawArrow(ctx, left.x, left.y, angL, c)
    }
  }
}

export default function Analyze() {
  const loc = useLocation() as { state?: { leftImage?: string; rightImage?: string } }
  const [state, setState] = useState<{ left?: string; right?: string }>({})
  const leftRef = useRef<HTMLCanvasElement | null>(null)
  const rightRef = useRef<HTMLCanvasElement | null>(null)
  const [summary, setSummary] = useState<string>('')
  const [narrative, setNarrative] = useState<string>('')
  const [rulesData, setRulesData] = useState<Rules | null>(rulesJson as Rules)
  const [cfgVersion, setCfgVersion] = useState(0)
  const [profiles, setProfiles] = useState<Record<string, any>>({})
  const [activeProfileName, setActiveProfileName] = useState<string | null>(null)
  const [selectedProfile, setSelectedProfile] = useState<string>('')
  const [savedSnapshot, setSavedSnapshot] = useState<any | null>(null)

  function cloneConfig() {
    return JSON.parse(JSON.stringify(config))
  }
  function isEqualConfig(a: any, b: any) {
    if (!a || !b) return false
    const keys = Object.keys(config as any)
    return keys.every((k) => a[k] === b[k])
  }

  useEffect(() => {
    // Carregar regras védicas via import estático (mais confiável em mobile/túnel)
    try {
      setRulesData(rulesJson as Rules)
    } catch {
      setRulesData(null)
    }
  }, [])

  useEffect(() => {
    // Carregar perfis nomeados
    const rawProfiles = localStorage.getItem('lineProfiles')
    if (rawProfiles) {
      try {
        const p = JSON.parse(rawProfiles)
        if (p && typeof p === 'object') {
          setProfiles(p)
          const names = Object.keys(p)
          if (names.length && !selectedProfile) setSelectedProfile(names[0])
        }
      } catch {}
    }
    // Carregar perfil padrão, se existir
    const rawDefault = localStorage.getItem('lineConfig')
    if (rawDefault) {
      try {
        const saved = JSON.parse(rawDefault)
        applyConfig(saved)
        setSavedSnapshot(saved)
        setActiveProfileName('padrão')
        setCfgVersion((v) => v + 1)
      } catch {}
    }
  }, [])

  useEffect(() => {
    const s = loc.state || (window as any).__analysis_state__ || {}
    setState({ left: s.leftImage, right: s.rightImage })
  }, [loc.state])

  useEffect(() => {
    async function run() {
      if (!state.left || !state.right) return
      if (!leftRef.current || !rightRef.current) return
      if (!rulesData) return

      const leftData = await drawImageToCanvas(state.left, leftRef.current)
      const rightData = await drawImageToCanvas(state.right, rightRef.current)
      const leftCtx = leftRef.current.getContext('2d')!
      const rightCtx = rightRef.current.getContext('2d')!
      // zonas primeiro
      drawZones(leftCtx, leftRef.current.width, leftRef.current.height)
      drawZones(rightCtx, rightRef.current.width, rightRef.current.height)
      const leftLines = detectPalmLines(leftData)
      const rightLines = detectPalmLines(rightData)
      overlayLines(leftCtx, leftLines)
      overlayLines(rightCtx, rightLines)

      const labelsLeft = leftLines.map((l) => l.label).filter(Boolean)
      const labelsRight = rightLines.map((l) => l.label).filter(Boolean)
      const found = new Set([ ...labelsLeft as string[], ...labelsRight as string[] ])
      setSummary(`Linhas detectadas: ${Array.from(found).map((s) => s!.toUpperCase()).join(', ') || 'Nenhuma com confiança suficiente'}`)

      // Interpretação narrativa (mão esquerda e direita)
      const leftNarr = interpretHand(leftLines, rulesData as any, leftRef.current.width, leftRef.current.height)
      const rightNarr = interpretHand(rightLines, rulesData as any, rightRef.current.width, rightRef.current.height)
      setNarrative(`Esquerda: ${leftNarr}\nDireita: ${rightNarr}`)
    }
    run()
  }, [state, rulesData, cfgVersion])

  return (
    <div className="app">
      <header className="header">
        <h1>Análise das Linhas</h1>
        <p className="subtitle">Detecção heurística das linhas principais com sobreposição visual e interpretação narrativa.</p>
      </header>

      <section className="capture" style={{ alignItems: 'start' }}>
        <div className="capture-block">
          <h3>Palma Esquerda</h3>
          <canvas ref={leftRef} />
        </div>
        <div className="capture-block">
          <h3>Palma Direita</h3>
          <canvas ref={rightRef} />
        </div>
      </section>

      <section className="guidance">
        <h3>Controles de Limiar</h3>
        {/* Indicador de perfil ativo */}
        <div style={{ marginBottom: 8, color: '#cfcfe2' }}>
          Perfil ativo: {activeProfileName || '—'}{' '}
          {savedSnapshot ? (isEqualConfig(config, savedSnapshot) ? '(salvo)' : '(modificado)') : '(não salvo)'}
        </div>
        <div className="controls" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(280px, 1fr))', gap: 12 }}>
          <label>
            Sep. mínima de feixes (°): {config.BRANCH_MIN_SEP_DEG}
            <input type="range" min={20} max={90} step={1}
              value={config.BRANCH_MIN_SEP_DEG}
              onChange={(e) => { config.BRANCH_MIN_SEP_DEG = Number(e.target.value); setCfgVersion(v => v + 1) }} />
          </label>
          <label>
            Pontos mínimos por feixe: {config.BRANCH_MIN_CLUSTER}
            <input type="range" min={2} max={12} step={1}
              value={config.BRANCH_MIN_CLUSTER}
              onChange={(e) => { config.BRANCH_MIN_CLUSTER = Number(e.target.value); setCfgVersion(v => v + 1) }} />
          </label>
          <label>
            Sensibilidade bifurcação: {config.BIFURCATION_SENSITIVITY.toFixed(1)}
            <input type="range" min={0.5} max={2.0} step={0.1}
              value={config.BIFURCATION_SENSITIVITY}
              onChange={(e) => { config.BIFURCATION_SENSITIVITY = Number(e.target.value); setCfgVersion(v => v + 1) }} />
          </label>
          <label>
            Robustez (mag): {config.MAG_ROBUST_RATIO.toFixed(2)}
            <input type="range" min={1.0} max={2.5} step={0.05}
              value={config.MAG_ROBUST_RATIO}
              onChange={(e) => { config.MAG_ROBUST_RATIO = Number(e.target.value); setCfgVersion(v => v + 1) }} />
          </label>
          <label>
            Palidez (mag): {config.MAG_PALE_RATIO.toFixed(2)}
            <input type="range" min={0.5} max={1.2} step={0.05}
              value={config.MAG_PALE_RATIO}
              onChange={(e) => { config.MAG_PALE_RATIO = Number(e.target.value); setCfgVersion(v => v + 1) }} />
          </label>
          <label>
            Robustez (esp.): {config.THICKNESS_ROBUST_RATIO.toFixed(2)}
            <input type="range" min={1.0} max={2.0} step={0.05}
              value={config.THICKNESS_ROBUST_RATIO}
              onChange={(e) => { config.THICKNESS_ROBUST_RATIO = Number(e.target.value); setCfgVersion(v => v + 1) }} />
          </label>
          <label>
            Palidez (esp.): {config.THICKNESS_PALE_RATIO.toFixed(2)}
            <input type="range" min={0.3} max={1.0} step={0.05}
              value={config.THICKNESS_PALE_RATIO}
              onChange={(e) => { config.THICKNESS_PALE_RATIO = Number(e.target.value); setCfgVersion(v => v + 1) }} />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            onClick={() => {
              try {
                localStorage.setItem('lineConfig', JSON.stringify(config))
                setSavedSnapshot(cloneConfig())
                setActiveProfileName('padrão')
              } catch {}
            }}
          >Salvar padrão</button>
          <button
            onClick={() => {
              try {
                localStorage.removeItem('lineConfig')
                if (activeProfileName === 'padrão') {
                  setActiveProfileName(null)
                  setSavedSnapshot(null)
                }
              } catch {}
            }}
          >Limpar perfil padrão</button>
          <button
            onClick={() => {
              resetConfig()
              setCfgVersion((v) => v + 1)
            }}
          >Resetar para padrão</button>
          <button
            disabled={!savedSnapshot}
            onClick={() => {
              if (!savedSnapshot) return
              applyConfig(savedSnapshot)
              setCfgVersion((v) => v + 1)
            }}
          >Reverter alterações</button>
        </div>
        {/* Perfis nomeados */}
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr auto auto auto', gap: 8 }}>
          <input
            placeholder="Nome do perfil"
            value={selectedProfile}
            onChange={(e) => setSelectedProfile(e.target.value)}
            style={{ padding: 6 }}
          />
          <select
            value={selectedProfile}
            onChange={(e) => setSelectedProfile(e.target.value)}
            style={{ padding: 6 }}
          >
            <option value="">(selecione perfil)</option>
            {Object.keys(profiles).map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <button
            onClick={() => {
              const name = selectedProfile.trim()
              if (!name) return
              const next = { ...profiles, [name]: cloneConfig() }
              setProfiles(next)
              try { localStorage.setItem('lineProfiles', JSON.stringify(next)) } catch {}
              setActiveProfileName(name)
              setSavedSnapshot(cloneConfig())
            }}
          >Salvar como</button>
          <button
            onClick={() => {
              const name = selectedProfile.trim()
              if (!name || !profiles[name]) return
              applyConfig(profiles[name])
              setActiveProfileName(name)
              setSavedSnapshot(JSON.parse(JSON.stringify(profiles[name])))
              setCfgVersion((v) => v + 1)
            }}
          >Carregar perfil</button>
          <button
            onClick={() => {
              const name = selectedProfile.trim()
              if (!name || !profiles[name]) return
              const next = { ...profiles }
              delete next[name]
              setProfiles(next)
              try { localStorage.setItem('lineProfiles', JSON.stringify(next)) } catch {}
              if (activeProfileName === name) {
                setActiveProfileName(null)
                setSavedSnapshot(null)
              }
            }}
          >Excluir perfil</button>
        </div>
      </section>
      <section className="guidance">
        <h3>Interpretação</h3>
        <pre style={{ whiteSpace: 'pre-wrap', color: '#cfcfe2' }}>{narrative}</pre>
      </section>

      <footer className="actions">
        <div style={{ color: '#cfcfe2' }}>{summary}</div>
        <a className="btn secondary" href="/">Voltar</a>
      </footer>
    </div>
  )
}
