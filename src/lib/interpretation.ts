import type { DetectedLine } from './lineDetection'

export type Rules = {
  linhas: {
    coracao: Record<string, string>
    cabeca: Record<string, string>
    vida: Record<string, string>
    destino: Record<string, string>
  }
}

// Configuração de sensibilidade para bifurcação
export const defaultConfig = {
  BRANCH_MIN_SEP_DEG: 45,
  BRANCH_MIN_CLUSTER: 4,
  BIFURCATION_SENSITIVITY: 1.0,
  MAG_ROBUST_RATIO: 1.3,
  MAG_PALE_RATIO: 0.95,
  THICKNESS_ROBUST_RATIO: 1.2,
  THICKNESS_PALE_RATIO: 0.8,
};
export const config = { ...defaultConfig };
export function resetConfig() {
  Object.assign(config, defaultConfig);
}
export function applyConfig(partial: Partial<typeof defaultConfig>) {
  Object.assign(config, partial);
}


function lineLengthApprox(points: { x: number; y: number }[]): number {
  let len = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    len += Math.hypot(dx, dy)
  }
  return len
}

function leftRightEnds(points: { x: number; y: number }[]): {
  left: { x: number; y: number }
  right: { x: number; y: number }
} {
  const left = points.reduce((a, b) => (a.x < b.x ? a : b))
  const right = points.reduce((a, b) => (a.x > b.x ? a : b))
  return { left, right }
}

function rotatePoint(p: { x: number; y: number }, angleRad: number, center: { x: number; y: number }) {
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)
  const dx = p.x - center.x
  const dy = p.y - center.y
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
}

function bboxOfPoints(points: { x: number; y: number }[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
}

function computeWeightedMeanAngle(lines: DetectedLine[]): number {
  if (!lines.length) return 0
  // usar peso por comprimento para estimativa estável
  let sx = 0,
    sy = 0,
    wsum = 0
  for (const l of lines) {
    const pts = l.points
    if (!pts || pts.length < 2) continue
    let len = 0
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x
      const dy = pts[i].y - pts[i - 1].y
      len += Math.hypot(dx, dy)
    }
    const first = pts[0]
    const last = pts[pts.length - 1]
    const a = Math.atan2(last.y - first.y, last.x - first.x)
    sx += Math.cos(a) * len
    sy += Math.sin(a) * len
    wsum += len
  }
  return Math.atan2(sy / Math.max(wsum, 1e-6), sx / Math.max(wsum, 1e-6))
}

function chooseRotationAngle(lines: DetectedLine[]): number {
  const destino = lines.find((l) => l.label === 'destino')
  if (destino && destino.points.length >= 2) {
    const pts = destino.points
    const first = pts[0]
    const last = pts[pts.length - 1]
    // queremos destino mais vertical => remover seu ângulo
    const ang = Math.atan2(last.y - first.y, last.x - first.x)
    return ang
  }
  return computeWeightedMeanAngle(lines)
}

function normalizeRotation(lines: DetectedLine[], canvasW: number, canvasH: number): {
  lines: DetectedLine[]
  rotation: number
} {
  const allPoints = lines.flatMap((l) => l.points)
  const box = bboxOfPoints(allPoints)
  const rotation = chooseRotationAngle(lines)
  const center = { x: box.cx || canvasW / 2, y: box.cy || canvasH / 2 }
  const rotLines = lines.map((l) => ({
    ...l,
    points: l.points.map((p) => rotatePoint(p, -rotation, center)),
  }))
  return { lines: rotLines, rotation }
}

function segmentAngleNearEnd(points: { x: number; y: number }[], near: 'start' | 'end', sample = 12) {
  if (points.length < 2) return 0
  const idxs =
    near === 'start'
      ? Array.from({ length: Math.min(sample, points.length - 1) }, (_, i) => i)
      : Array.from({ length: Math.min(sample, points.length - 1) }, (_, i) => points.length - 2 - i)
  const angles = idxs.map((i) => Math.atan2(points[i + 1].y - points[i].y, points[i + 1].x - points[i].x))
  // média circular
  let sx = 0,
    sy = 0
  for (const a of angles) {
    sx += Math.cos(a)
    sy += Math.sin(a)
  }
  return Math.atan2(sy / Math.max(angles.length, 1e-6), sx / Math.max(angles.length, 1e-6))
}

function hasBranchNearEnd(points: { x: number; y: number }[], near: 'start' | 'end'): boolean {
  if (points.length < 6) return false
  const idxs =
    near === 'start'
      ? Array.from({ length: Math.min(40, points.length - 1) }, (_, i) => i)
      : Array.from({ length: Math.min(40, points.length - 1) }, (_, i) => points.length - 2 - i)
  const angles = idxs.map((i) => Math.atan2(points[i + 1].y - points[i].y, points[i + 1].x - points[i].x))
  if (angles.length < config.BRANCH_MIN_CLUSTER * 2) return false
  let c1 = Math.min(...angles)
  let c2 = Math.max(...angles)
  for (let iter = 0; iter < 8; iter++) {
    const g1: number[] = []
    const g2: number[] = []
    for (const a of angles) {
      const d1 = Math.abs(a - c1)
      const d2 = Math.abs(a - c2)
      if (d1 < d2) g1.push(a)
      else g2.push(a)
    }
    if (!g1.length || !g2.length) break
    c1 = g1.reduce((s, a) => s + a, 0) / g1.length
    c2 = g2.reduce((s, a) => s + a, 0) / g2.length
  }
  const sep = Math.abs(c1 - c2) * (180 / Math.PI)
  const g1Count = angles.filter((a) => Math.abs(a - c1) < Math.abs(a - c2)).length
  const g2Count = angles.length - g1Count
  const okClusters = g1Count >= config.BRANCH_MIN_CLUSTER && g2Count >= config.BRANCH_MIN_CLUSTER
  return okClusters && sep >= config.BRANCH_MIN_SEP_DEG * config.BIFURCATION_SENSITIVITY
}

function mountOfPoint(p: { x: number; y: number }, canvasW: number, canvasH: number): 'jupiter' | 'saturno' | 'mercurio' | 'venus' | 'sol' | 'inferior' {
  const leftBand = canvasW * 0.33
  const rightBand = canvasW * 0.67
  const topBand = canvasH * 0.25
  const bottomBand = canvasH * 0.75
  if (p.y <= topBand) return 'sol'
  if (p.y >= bottomBand) return 'inferior'
  if (p.x <= leftBand) return 'jupiter'
  if (p.x >= rightBand) return 'mercurio'
  const venusRight = canvasW * 0.6
  const venusTop = canvasH * 0.6
  if (p.x > venusRight && p.y > venusTop) return 'venus'
  return 'saturno'
}

function evalStrength(l?: DetectedLine): 'robusta' | 'palida' | null {
  if (!l) return null
  const avgMag = l.avgMag ?? 0
  const magRef = l.magRef ?? 1
  const thickness = l.thickness ?? 1
  const magRatio = avgMag / Math.max(magRef, 1e-6)
  const thickRatio = thickness
  if (magRatio >= config.MAG_ROBUST_RATIO || thickRatio >= config.THICKNESS_ROBUST_RATIO) return 'robusta'
  if (magRatio <= config.MAG_PALE_RATIO || thickRatio <= config.THICKNESS_PALE_RATIO) return 'palida'
  return null
}

function pushPresenceAbsence(out: string[], rules: Rules, label: 'coracao' | 'cabeca' | 'vida' | 'destino', l?: DetectedLine) {
  if (l) {
    const t = rules.linhas[label]?.['presenca']
    if (t) out.push(t)
  } else {
    const t = rules.linhas[label]?.['ausencia']
    if (t) out.push(t)
  }
}

function pushLengthKind(out: string[], rules: Record<string, string> | undefined, len: number, ref: number) {
  if (!rules) return
  const ratio = len / Math.max(ref, 1e-6)
  if (ratio >= 0.6 && rules['longa']) out.push(rules['longa'])
  else if (ratio <= 0.45 && rules['curta']) out.push(rules['curta'])
}

export function interpretHand(lines: DetectedLine[], rules: Rules, canvasW: number, canvasH: number): string {
  const { lines: normLines } = normalizeRotation(lines, canvasW, canvasH)
  const out: string[] = []
  const pushIf = (ok: boolean, text?: string) => { if (ok && text) out.push(text) }
  const getLine = (label: string) => normLines.find((l) => l.label === label)

  const coracao = getLine('coracao')
  const cabeca = getLine('cabeca')
  const vida = getLine('vida')
  const destino = getLine('destino')

  const coracaoEnds = coracao ? leftRightEnds(coracao.points) : null
  const cabecaEnds = cabeca ? leftRightEnds(cabeca.points) : null
  const destinoEnds = destino ? leftRightEnds(destino.points) : null

  const pushStrength = (l: DetectedLine | undefined) => {
    const s = evalStrength(l)
    if (!s || !l?.label) return
    const txt = rules.linhas[l.label]?.[s]
    if (txt) out.push(txt)
  }

  // Presença/Ausência geral
  pushPresenceAbsence(out, rules, 'coracao', coracao)
  pushPresenceAbsence(out, rules, 'cabeca', cabeca)
  pushPresenceAbsence(out, rules, 'vida', vida)
  pushPresenceAbsence(out, rules, 'destino', destino)

  // Coração
  if (coracao) {
    pushStrength(coracao)
    const lenC = lineLengthApprox(coracao.points)
    pushLengthKind(out, rules.linhas.coracao, lenC, canvasW)
    if (coracaoEnds) {
      const end = coracaoEnds.right
      const mountEnd = mountOfPoint(end, canvasW, canvasH)
      const dir = segmentAngleNearEnd(coracao.points, 'end')
      const upTilt = dir > 0
      pushIf(upTilt, rules.linhas.coracao['ascendente'])
      pushIf(!upTilt, rules.linhas.coracao['descendente'])
      const towardsTopRight = dir < Math.PI / 4 && dir > -Math.PI / 4
      const bifurcada = hasBranchNearEnd(coracao.points, 'end')
      pushIf(mountEnd === 'jupiter' && towardsTopRight && bifurcada, rules.linhas.coracao['bifurcada_para_jupiter'])
      const towardsUp = Math.abs(dir - Math.PI / 2) < Math.PI / 6
      pushIf(mountEnd === 'saturno' && towardsUp, rules.linhas.coracao['termina_em_saturno'])
    }
    const startMount = coracaoEnds ? mountOfPoint(coracaoEnds.left, canvasW, canvasH) : null
    pushIf(startMount === 'mercurio', rules.linhas.coracao['origem_em_mercurio'])
  }

  // Cabeça
  if (cabeca) {
    pushStrength(cabeca)
    const lenH = lineLengthApprox(cabeca.points)
    pushLengthKind(out, rules.linhas.cabeca, lenH, canvasW)
    const angStart = segmentAngleNearEnd(cabeca.points, 'start')
    const angEnd = segmentAngleNearEnd(cabeca.points, 'end')
    const meanAng = Math.atan2(Math.sin(angStart) + Math.sin(angEnd), Math.cos(angStart) + Math.cos(angEnd))
    const deg = Math.abs(meanAng * 180 / Math.PI)
    const isDiag = !(deg < 30 || deg > 150) && !(deg > 60 && deg < 120)
    pushIf(isDiag, rules.linhas.cabeca['diagonal'])
    if (cabecaEnds) {
      const end = cabecaEnds.right
      const mountEnd = mountOfPoint(end, canvasW, canvasH)
      const bifurcada = hasBranchNearEnd(cabeca.points, 'end')
      pushIf(mountEnd === 'jupiter' && bifurcada, rules.linhas.cabeca['ramificada'])
      pushIf(mountEnd === 'jupiter', rules.linhas.cabeca['termina_em_jupiter'])
      pushIf(mountEnd === 'saturno', rules.linhas.cabeca['termina_em_saturno'])
      pushIf(mountEnd === 'mercurio', rules.linhas.cabeca['termina_em_mercurio'])
    }
  }

  // Vida
  if (vida) {
    pushStrength(vida)
    const lenV = lineLengthApprox(vida.points)
    pushLengthKind(out, rules.linhas.vida, lenV, Math.max(canvasW, canvasH))
    const startMount = vida.points.length ? mountOfPoint(vida.points[0], canvasW, canvasH) : null
    pushIf(startMount === 'venus', rules.linhas.vida['origem_em_venus'])
  }

  // Destino
  if (destino) {
    pushStrength(destino)
    const lenD = lineLengthApprox(destino.points)
    pushLengthKind(out, rules.linhas.destino, lenD, canvasH)
    if (destinoEnds) {
      const dir = segmentAngleNearEnd(destino.points, 'start')
      const moreVertical = Math.abs(dir - Math.PI / 2) < Math.PI / 6 || Math.abs(dir + Math.PI / 2) < Math.PI / 6
      pushIf(moreVertical, rules.linhas.destino['vertical'])
      const bifurcada = hasBranchNearEnd(destino.points, 'end')
      pushIf(bifurcada, rules.linhas.destino['ramificada'])
      const end = destinoEnds.right
      const mountEnd = mountOfPoint(end, canvasW, canvasH)
      pushIf(mountEnd === 'jupiter', rules.linhas.destino['termina_em_jupiter'])
      pushIf(mountEnd === 'saturno', rules.linhas.destino['termina_em_saturno'])
      pushIf(mountEnd === 'mercurio', rules.linhas.destino['termina_em_mercurio'])
    }
  }

  return out.join(' ')
}
