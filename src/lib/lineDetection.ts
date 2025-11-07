export type PalmLabel = 'vida' | 'cabeca' | 'coracao' | 'destino'

export interface DetectedLine {
  points: Array<{ x: number; y: number }>
  angle: number // radians, 0 = horizontal
  score: number // relative strength/length
  label?: PalmLabel
  bbox: { x: number; y: number; w: number; h: number }
  avgMag?: number // média da magnitude do gradiente ao longo do componente
  magRef?: number // referência global de magnitude (threshold usado)
  thickness?: number // espessura aproximada: pontos por unidade de eixo maior
}

// Configuração ajustável da detecção
export const lineConfigDefault = {
  EDGES_PERCENTILE: 0.85, // top 15% edges por padrão
  MIN_COMPONENT_SIZE: 100, // descartar ruído abaixo disto
  CONTRAST_STRETCH: true,
  CONTRAST_GAMMA: 0.9,
}
export const lineConfig = { ...lineConfigDefault }
export function resetLineConfig() { Object.assign(lineConfig, lineConfigDefault) }
export function applyLineConfig(partial: Partial<typeof lineConfigDefault>) { Object.assign(lineConfig, partial) }

function toGrayscale(img: ImageData): Float32Array {
  const { data, width, height } = img
  const gray = new Float32Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    gray[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  }
  if (!lineConfig.CONTRAST_STRETCH) return gray
  // normalizar contraste simples + gamma
  let min = Infinity, max = -Infinity
  for (let i = 0; i < gray.length; i++) { const v = gray[i]; if (v < min) min = v; if (v > max) max = v }
  const range = Math.max(max - min, 1e-6)
  const gamma = Math.max(lineConfig.CONTRAST_GAMMA, 0.1)
  for (let i = 0; i < gray.length; i++) {
    let n = (gray[i] - min) / range
    n = Math.pow(Math.min(Math.max(n, 0), 1), gamma)
    gray[i] = n
  }
  return gray
}

function sobel(gray: Float32Array, width: number, height: number) {
  const gx = new Float32Array(width * height)
  const gy = new Float32Array(width * height)
  const mag = new Float32Array(width * height)
  const kx = [-1, 0, 1, -2, 0, 2, -1, 0, 1]
  const ky = [-1, -2, -1, 0, 0, 0, 1, 2, 1]
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let sx = 0, sy = 0
      let idx = 0
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const v = gray[(y + j) * width + (x + i)]
          sx += v * kx[idx]
          sy += v * ky[idx]
          idx++
        }
      }
      const p = y * width + x
      gx[p] = sx
      gy[p] = sy
      mag[p] = Math.hypot(sx, sy)
    }
  }
  return { gx, gy, mag }
}

function thresholdByPercentile(mag: Float32Array, percentile: number) {
  const arr = Array.from(mag)
  arr.sort((a, b) => a - b)
  const idx = Math.floor(arr.length * percentile)
  return arr[idx]
}

function binaryMask(mag: Float32Array, width: number, height: number, thr: number) {
  const mask = new Uint8Array(width * height)
  for (let i = 0; i < mask.length; i++) mask[i] = mag[i] >= thr ? 1 : 0
  return mask
}

function neighbors(p: number, width: number, height: number) {
  const x = p % width
  const y = Math.floor(p / width)
  const res: number[] = []
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      if (i === 0 && j === 0) continue
      const nx = x + i, ny = y + j
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) res.push(ny * width + nx)
    }
  }
  return res
}

function components(mask: Uint8Array, width: number, height: number) {
  const visited = new Uint8Array(mask.length)
  const groups: number[][] = []
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p] || visited[p]) continue
    const stack = [p]
    visited[p] = 1
    const comp: number[] = []
    while (stack.length) {
      const cur = stack.pop()!
      comp.push(cur)
      for (const n of neighbors(cur, width, height)) {
        if (mask[n] && !visited[n]) { visited[n] = 1; stack.push(n) }
      }
    }
    if (comp.length > lineConfig.MIN_COMPONENT_SIZE) groups.push(comp) // ignore tiny noise
  }
  return groups
}

function computeBBox(points: number[], width: number) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    const x = p % width
    const y = Math.floor(p / width)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

function principalAngle(points: number[], width: number) {
  // PCA via covariance of x,y
  let mx = 0, my = 0
  for (const p of points) { mx += p % width; my += Math.floor(p / width) }
  mx /= points.length; my /= points.length
  let sxx = 0, syy = 0, sxy = 0
  for (const p of points) {
    const x = p % width - mx
    const y = Math.floor(p / width) - my
    sxx += x * x; syy += y * y; sxy += x * y
  }
  const tr = sxx + syy
  const det = sxx * syy - sxy * sxy
  const lambda = (tr + Math.sqrt(Math.max(0, tr * tr - 4 * det))) / 2
  const vx = sxy
  const vy = lambda - sxx
  const angle = Math.atan2(vy, vx) // angle of major axis (in image coords)
  return angle
}

export function detectPalmLines(img: ImageData): DetectedLine[] {
  const { width, height } = img
  const gray = toGrayscale(img)
  const { mag } = sobel(gray, width, height)
  const thr = thresholdByPercentile(mag, lineConfig.EDGES_PERCENTILE) // ajustável
  const mask = binaryMask(mag, width, height, thr)
  const comps = components(mask, width, height)

  const lines: DetectedLine[] = comps.map((comp) => {
    const bbox = computeBBox(comp, width)
    const angle = principalAngle(comp, width) // radians
    const points = comp.map((p) => ({ x: p % width, y: Math.floor(p / width) }))
    const score = Math.max(bbox.w, bbox.h) / Math.min(width, height)
    // métricas adicionais
    let sumMag = 0
    for (const p of comp) sumMag += mag[p]
    const avgMag = sumMag / comp.length
    const thickness = comp.length / Math.max(1, Math.max(bbox.w, bbox.h))
    return { points, angle, score, bbox, avgMag, magRef: thr, thickness }
  })

  // classify heuristically
  const classify = (line: DetectedLine): PalmLabel | undefined => {
    const cy = line.bbox.y + line.bbox.h / 2
    const cx = line.bbox.x + line.bbox.w / 2
    const normY = cy / height
    const normX = cx / width
    const deg = Math.abs((line.angle * 180) / Math.PI)
    const isHoriz = deg < 30 || deg > 150
    const isVert = deg > 60 && deg < 120
    const isDiag = !isHoriz && !isVert
    const len = Math.max(line.bbox.w, line.bbox.h)

    if (isHoriz && normY >= 0.2 && normY <= 0.4 && len > 0.35 * width) return 'coracao'
    if ((isHoriz || isDiag) && normY >= 0.4 && normY <= 0.6 && len > 0.35 * width) return 'cabeca'
    if (isVert && normX >= 0.4 && normX <= 0.6 && len > 0.4 * height) return 'destino'
    if (isDiag && normX >= 0.2 && normX <= 0.45 && len > 0.35 * Math.max(width, height)) return 'vida'
    return undefined
  }

  const labeled = lines.map((l) => ({ ...l, label: classify(l) }))

  // choose best per label
  const best: Record<PalmLabel, DetectedLine | null> = {
    vida: null, cabeca: null, coracao: null, destino: null,
  }
  for (const l of labeled) {
    if (!l.label) continue
    const cur = best[l.label]
    if (!cur || l.score > cur.score) best[l.label] = l
  }

  return Object.values(best).filter(Boolean) as DetectedLine[]
}