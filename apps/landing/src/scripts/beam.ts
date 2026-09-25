// The hero's light beam: providers → guard (splash) → safe fill, looping every ~3.4 s.
// A narrow bright window slides along an SVG path by moving the gradient's x1/x2.

type State = 'p1' | 'splash' | 'p2' | 'idle'

export function startBeam(): void {
  const get = <T extends Element>(id: string) => {
    const el = document.getElementById(id)
    if (!el) throw new Error(`#${id} missing`)
    return el as unknown as T
  }
  const pipeline = get<HTMLElement>('pipeline')
  const nodeStack = get<HTMLElement>('node-stack')
  const nodeX = get<HTMLElement>('node-x')
  const nodeShield = get<HTMLElement>('node-shield')
  const glow = get<SVGPathElement>('beam-glow')
  const core = get<SVGPathElement>('beam-core')
  const grad = get<SVGLinearGradientElement>('beam-gradient')
  const splash = get<HTMLElement>('splash')

  let startX = 0
  let endX = 0
  const layout = () => {
    const p = pipeline.getBoundingClientRect()
    const center = (el: HTMLElement): [number, number] => {
      const r = el.getBoundingClientRect()
      return [r.left + r.width / 2 - p.left, r.top + r.height / 2 - p.top]
    }
    const [sx, sy] = center(nodeStack)
    const [mx, my] = center(nodeX)
    const [ex, ey] = center(nodeShield)
    const d = `M ${sx},${sy} L ${mx},${my} L ${ex},${ey}`
    glow.setAttribute('d', d)
    core.setAttribute('d', d)
    startX = sx
    endX = ex
  }
  const setBeam = (pct: number) => {
    const c = startX + (endX - startX) * pct
    const half = (endX - startX) * 0.05
    grad.setAttribute('x1', `${c - half}px`)
    grad.setAttribute('x2', `${c + half}px`)
    grad.setAttribute('y1', '0')
    grad.setAttribute('y2', '0')
  }
  const showBeam = (on: boolean) => {
    glow.style.opacity = on ? '0.6' : '0'
    core.style.opacity = on ? '1' : '0'
  }

  layout()
  addEventListener('resize', layout)
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setBeam(0.5)

  let state: State = 'p1'
  let since = performance.now()
  const tick = (now: number) => {
    const t = now - since
    if (state === 'p1') {
      const k = Math.min(t / 800, 1)
      setBeam(k * 0.5)
      nodeStack.classList.toggle('active', k < 0.4)
      if (k >= 1) { state = 'splash'; since = now; showBeam(false); splash.classList.add('animate') }
    } else if (state === 'splash') {
      if (t >= 800) { state = 'p2'; since = now; splash.classList.remove('animate'); showBeam(true) }
    } else if (state === 'p2') {
      const k = Math.min(t / 800, 1)
      setBeam(0.5 + k * 0.5)
      nodeShield.classList.toggle('active', k > 0.6)
      if (k >= 1) { nodeShield.classList.remove('active'); state = 'idle'; since = now }
    } else if (t >= 1000) {
      state = 'p1'
      since = now
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
