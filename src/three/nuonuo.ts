/**
 * 糯糯 —— 三花小猫角色（原创）
 * 所有几何在代码里生成，无模型文件；只有阴影/光晕共用一张运行时 CanvasTexture。
 * 约束：单 renderer、锁 30fps、无阴影、无后处理、无骨骼、无动画库。
 */
import {
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
} from 'three'
import type { Material } from 'three'

export type Mouth = 'closed' | 'smile' | 'a' | 'o' | 'e' | 'i' | 'u' | 'v'
export type Mood = 'idle' | 'happy' | 'surprised' | 'curious'
export type Action = 'nod' | 'clap' | 'jump' | 'wave' | 'shake'

export interface NuonuoHandle {
  setMouth(m: Mouth): void
  setMood(m: Mood): void
  play(a: Action): void
  setTone(tone: 1 | 2 | 3 | 4): void
  resize(): void
  dispose(): void
}

/* ------------------------------ 设计令牌 ------------------------------ */

const C_CREAM = '#FFF8F0'
const C_PEACH = '#FFD6DD'
const C_COCOA = '#6B5B57'
const C_BLUSH = '#FFB9C4'

const TONE_COLORS: Record<1 | 2 | 3 | 4, string> = {
  1: '#FFEFC4',
  2: '#C9EBDD',
  3: '#CFE1F7',
  4: '#E4DAF7',
}

/** 身体椭球半轴（几何半径 1 再缩放） */
const RX = 1.05
const RY = 0.9
const RZ = 0.94

/** 椭球正面在某个高度上的 z 值，用来贴五官 */
function surfaceZ(y: number, x = 0): number {
  const k = 1 - (x / RX) ** 2 - (y / RY) ** 2
  return RZ * Math.sqrt(Math.max(0, k))
}

const FRAME_W = 2.7
const FRAME_H = 3.2

const ACTION_DUR: Record<Action, number> = {
  nod: 0.7,
  clap: 0.9,
  jump: 0.85,
  wave: 1.1,
  shake: 0.72,
}

function noopHandle(): NuonuoHandle {
  return {
    setMouth() {},
    setMood() {},
    play() {},
    setTone() {},
    resize() {},
    dispose() {},
  }
}

/* ------------------------------ 小工具 ------------------------------ */

/** 圆形柔光贴图：白→透明，用于腮红后光晕与 blob 阴影 */
function makeRadialTexture(): CanvasTexture {
  const size = 128
  const cv = document.createElement('canvas')
  cv.width = size
  cv.height = size
  const ctx = cv.getContext('2d')
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.5, 'rgba(255,255,255,0.6)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }
  const tex = new CanvasTexture(cv)
  tex.colorSpace = SRGBColorSpace
  return tex
}

/** 云朵团子身体：球体 + 轻微凹凸 + 底粉顶米的顶点色 */
function makeBodyGeometry(): SphereGeometry {
  const geo = new SphereGeometry(1, 36, 24)
  const pos = geo.attributes.position
  const v = new Vector3()

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const len = v.length()
    if (len < 1e-5) continue
    const theta = Math.atan2(v.z, v.x)
    const phi = Math.asin(MathUtils.clamp(v.y / len, -1, 1))
    // 三个低频波叠加出「软团子」的不规则轮廓（确定性，不用随机）
    // fade 让两极保持圆润，避免出现尖角
    const fade = 1 - Math.abs(v.y / len) ** 4
    const bump =
      1 +
      fade *
        (0.05 * Math.sin(theta * 3 + 0.6) * Math.sin(phi * 2.2 + 0.3) +
          0.022 * Math.sin(theta * 5 - 1) +
          0.015 * Math.cos(phi * 3.4))
    v.multiplyScalar(bump / len)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()

  // 顶点色：三花斑纹（奶白底 + 左上橘斑 + 右上深褐斑），贴合曲面
  const colors = new Float32Array(pos.count * 3)
  const base = new Color(C_CREAM)
  const patchO = new Color('#F3B47C')
  const patchD = new Color('#6E5B52')
  const c = new Color()
  const dir = new Vector3()
  const capO = new Vector3(0.62, 0.62, 0.48).normalize()
  const capD = new Vector3(-0.7, 0.52, 0.4).normalize()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    dir.copy(v).normalize()
    const aO = Math.acos(MathUtils.clamp(dir.dot(capO), -1, 1))
    const aD = Math.acos(MathUtils.clamp(dir.dot(capD), -1, 1))
    c.copy(base)
    if (aO < 0.66) c.lerp(patchO, 1 - MathUtils.smoothstep(aO, 0.44, 0.66))
    if (aD < 0.6) c.lerp(patchD, 1 - MathUtils.smoothstep(aD, 0.38, 0.6))
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return geo
}

/** 五角星（平面徽章，便宜且不会有挤出倒角毛刺） */
function makeStarGeometry(outer = 0.14, inner = 0.062): Shape {
  const s = new Shape()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const r = i % 2 === 0 ? outer : inner
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) s.moveTo(x, y)
    else s.lineTo(x, y)
  }
  s.closePath()
  return s
}

/** ω 形嘴巴（两个小凹） */
function makeOmegaGeometry(): TubeGeometry {
  const curve = new CatmullRomCurve3([
    new Vector3(-0.085, 0.022, 0),
    new Vector3(-0.045, -0.032, 0),
    new Vector3(0, 0.02, 0),
    new Vector3(0.045, -0.032, 0),
    new Vector3(0.085, 0.022, 0),
  ])
  return new TubeGeometry(curve, 26, 0.014, 5, false)
}

/** 微笑弧线 */
function makeSmileGeometry(): TubeGeometry {
  const curve = new CatmullRomCurve3([
    new Vector3(-0.105, 0.035, 0),
    new Vector3(-0.055, -0.028, 0),
    new Vector3(0, -0.045, 0),
    new Vector3(0.055, -0.028, 0),
    new Vector3(0.105, 0.035, 0),
  ])
  return new TubeGeometry(curve, 26, 0.014, 5, false)
}

/* ------------------------------ 主体 ------------------------------ */

export function createNuonuo(
  canvas: HTMLCanvasElement,
  opts: { pixelRatioCap?: number } = {},
): NuonuoHandle {
  let created: WebGLRenderer | null = null
  try {
    created = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'low-power',
      stencil: false,
      depth: true,
    })
  } catch {
    created = null
  }
  if (!created) return noopHandle()
  const renderer = created
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.pixelRatioCap ?? 1.5))

  const scene = new Scene()
  const camera = new PerspectiveCamera(32, 1, 0.1, 30)

  /* ---------------- 灯光（软、无阴影） ---------------- */
  const hemi = new HemisphereLight(new Color('#FFFDF8'), new Color(C_PEACH), 2.4)
  const dir = new DirectionalLight(new Color('#FFFFFF'), 0.85)
  dir.position.set(2.2, 3.4, 4.2)
  scene.add(hemi, dir)

  /* ---------------- 材质 ---------------- */
  const bodyMat = new MeshLambertMaterial({ vertexColors: true })
  const eyeMat = new MeshBasicMaterial({ color: new Color(C_COCOA) })
  const hiMat = new MeshBasicMaterial({ color: new Color('#FFFFFF') })
  const mouthMat = new MeshBasicMaterial({ color: new Color(C_COCOA) })
  const blushMat = new MeshBasicMaterial({
    color: new Color(C_BLUSH),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  })

  const softTex = makeRadialTexture()

  /* ---------------- 身体 ---------------- */
  const bodyGroup = new Group()
  scene.add(bodyGroup)

  const bodyMesh = new Mesh(makeBodyGeometry(), bodyMat)
  bodyMesh.scale.set(RX, RY, RZ)
  bodyGroup.add(bodyMesh)

  // blob 阴影（一个半透明圆贴图，代替实时阴影）
  const shadow = new Mesh(
    new CircleGeometry(0.72, 24),
    new MeshBasicMaterial({
      map: softTex,
      color: new Color('#B99A93'),
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    }),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.set(0, -RY - 0.1, 0.05)
  shadow.scale.set(1, 0.5, 1)
  scene.add(shadow)

  /* ---------------- 猫耳（三角耳 + 内耳） ---------------- */
  const earMatO = new MeshLambertMaterial({ color: new Color('#F3B47C') })
  const earMatD = new MeshLambertMaterial({ color: new Color('#6E5B52') })
  const earInnerMat = new MeshLambertMaterial({ color: new Color('#FFC9CF') })
  for (const [i, x] of [-0.32, 0.32].entries()) {
    const g = new Group()
    const outer = new Mesh(new ConeGeometry(0.23, 0.56, 4, 1), i === 0 ? earMatD : earMatO)
    outer.rotation.y = Math.PI / 4
    outer.scale.set(1, 1, 0.5)
    const inner = new Mesh(new ConeGeometry(0.135, 0.4, 4, 1), earInnerMat)
    inner.rotation.y = Math.PI / 4
    inner.scale.set(1, 1, 0.32)
    inner.position.set(0, 0.03, 0.085)
    g.add(outer, inner)
    g.position.set(x * 1.15, 0.82, -0.04)
    g.rotation.z = x > 0 ? -0.34 : 0.34
    bodyGroup.add(g)
  }

  /* ---------------- 口鼻与胡须 ---------------- */
  const muzzleMat = new MeshLambertMaterial({ color: new Color('#FFFFFF') })
  const muzzle = new Mesh(new SphereGeometry(0.19, 18, 14), muzzleMat)
  muzzle.scale.set(1.28, 0.82, 0.5)
  muzzle.position.set(0, -0.2, surfaceZ(-0.2) - 0.03)
  bodyGroup.add(muzzle)

  const noseMat = new MeshLambertMaterial({ color: new Color('#EF9AA6') })
  const nose = new Mesh(new SphereGeometry(0.05, 12, 10), noseMat)
  nose.scale.set(1.15, 0.8, 0.7)
  nose.position.set(0, -0.13, surfaceZ(-0.13) + 0.055)
  bodyGroup.add(nose)

  const whiskerMat = new MeshBasicMaterial({ color: new Color('#CDB9B0') })
  for (const side of [-1, 1]) {
    for (const [k, tilt] of [-0.16, 0, 0.16].entries()) {
      const w = new Mesh(new CylinderGeometry(0.0055, 0.0055, 0.46, 4), whiskerMat)
      w.position.set(side * 0.3, -0.19 + tilt * 0.5, surfaceZ(-0.19, side * 0.3) + 0.02)
      w.rotation.z = Math.PI / 2 + (k - 1) * 0.16
      w.rotation.y = side * 0.35
      bodyGroup.add(w)
    }
  }

  /* ---------------- 眼睛（圆点 + 高光） ---------------- */
  const eyes: Group[] = []
  for (const x of [-0.3, 0.3]) {
    const g = new Group()
    const ball = new Mesh(new SphereGeometry(0.105, 16, 12), eyeMat)
    ball.scale.set(1, 1, 0.62)
    const hi = new Mesh(new SphereGeometry(0.033, 10, 8), hiMat)
    hi.position.set(0.032, 0.045, 0.055)
    g.add(ball, hi)
    g.position.set(x, 0.16, surfaceZ(0.16, x) - 0.015)
    bodyGroup.add(g)
    eyes.push(g)
  }

  /* ---------------- 腮红 ---------------- */
  for (const x of [-0.52, 0.52]) {
    const m = new Mesh(new CircleGeometry(0.15, 20), blushMat)
    // 稍微浮在表面外，避免大片被身体吞掉
    m.position.set(x, -0.08, surfaceZ(-0.08, x) + 0.03)
    m.rotation.y = x > 0 ? -0.6 : 0.6
    m.scale.set(1, 0.68, 1)
    bodyGroup.add(m)
  }

  /* ---------------- 嘴（多套几何，切换 visible） ---------------- */
  const mouthGroup = new Group()
  mouthGroup.position.set(0, -0.27, surfaceZ(-0.27) + 0.02)
  bodyGroup.add(mouthGroup)

  const mouthParts = {} as Record<Mouth, Group>

  const addMouth = (key: Mouth, build: (g: Group) => void) => {
    const g = new Group()
    build(g)
    g.visible = false
    mouthGroup.add(g)
    mouthParts[key] = g
  }

  const torus = (r: number, tube: number, sx: number, sy: number, seg = 20) => {
    const m = new Mesh(new TorusGeometry(r, tube, 6, seg), mouthMat)
    m.scale.set(sx, sy, 1)
    return m
  }

  addMouth('closed', (g) => g.add(new Mesh(makeOmegaGeometry(), mouthMat)))
  addMouth('smile', (g) => g.add(new Mesh(makeSmileGeometry(), mouthMat)))
  addMouth('a', (g) => g.add(torus(0.075, 0.021, 0.88, 1.3)))
  addMouth('o', (g) => g.add(torus(0.08, 0.023, 1, 1)))
  addMouth('e', (g) => g.add(torus(0.085, 0.021, 1.38, 0.46)))
  addMouth('i', (g) => g.add(torus(0.09, 0.019, 1.2, 0.13)))
  addMouth('u', (g) => g.add(torus(0.055, 0.019, 1, 1, 18)))
  addMouth('v', (g) => {
    g.add(torus(0.05, 0.018, 1, 1, 18))
    // ü 的两点
    for (const x of [-0.036, 0.036]) {
      const dot = new Mesh(new SphereGeometry(0.016, 8, 6), mouthMat)
      dot.position.set(x, 0.088, 0)
      g.add(dot)
    }
  })

  /* ---------------- 胸口星灯 ---------------- */
  const starGroup = new Group()
  starGroup.position.set(0, -0.62, surfaceZ(-0.62) + 0.06)
  starGroup.rotation.x = 0.5
  bodyGroup.add(starGroup)

  const toneStart = new Color(TONE_COLORS[1])
  const starMat = new MeshBasicMaterial({ color: toneStart.clone() })
  const starMesh = new Mesh(new ExtrudeGeometry(makeStarGeometry(), { depth: 0.02, bevelEnabled: false, steps: 1 }), starMat)

  const glowMat = new MeshBasicMaterial({
    map: softTex,
    color: toneStart.clone(),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  })
  const glow = new Mesh(new PlaneGeometry(0.46, 0.46), glowMat)
  glow.position.z = 0.005

  starGroup.add(glow, starMesh)

  /* ---------------- 状态 ---------------- */
  let mouth: Mouth = 'closed'
  let mouthExplicit = false

  let eyeScale = 1
  let eyeSquint = 1
  let tilt = 0

  let moodEye = 1
  let moodSquint = 1
  let moodTilt = 0

  let action: { kind: Action; t0: number } | null = null
  let toneAt = -10

  let nextBlink = 1.4
  let blinkStart = -1

  const applyMouth = (m: Mouth) => {
    for (const key of Object.keys(mouthParts) as Mouth[]) {
      mouthParts[key].visible = key === m
    }
  }
  applyMouth(mouth)

  /* ---------------- 每帧更新 ---------------- */

  function applyAction(t: number) {
    if (!action) return
    const p = (t - action.t0) / ACTION_DUR[action.kind]
    if (p >= 1) {
      action = null
      return
    }
    const fade = 1 - p

    switch (action.kind) {
      case 'nod': {
        // 低头再抬回来
        bodyGroup.rotation.x += 0.2 * Math.sin(p * Math.PI * 2) * (1 - 0.25 * p)
        bodyGroup.position.y -= 0.02 * Math.sin(p * Math.PI)
        break
      }
      case 'clap': {
        // 两次「啪」的横向挤压
        const s = Math.sin(p * Math.PI * 4) * fade
        bodyGroup.scale.set(1 + 0.07 * s, 1 - 0.06 * s, 1 + 0.03 * s)
        bodyGroup.position.y += 0.02 * Math.abs(s)
        break
      }
      case 'jump': {
        const h = Math.sin(p * Math.PI)
        bodyGroup.position.y += 0.52 * h
        // 起跳/落地压扁
        const squash = 1 - 0.12 * Math.cos(p * Math.PI * 2 + Math.PI)
        bodyGroup.scale.set(1 + (1 - squash) * 0.6, squash, 1 + (1 - squash) * 0.6)
        break
      }
      case 'wave': {
        bodyGroup.rotation.z += 0.14 * Math.sin(p * Math.PI * 6) * fade
        break
      }
      case 'shake': {
        bodyGroup.rotation.y += 0.2 * Math.sin(p * Math.PI * 8) * fade
        bodyGroup.rotation.z += 0.04 * Math.sin(p * Math.PI * 6) * fade
        break
      }
    }
  }

  function update(t: number, dt: number) {
    // 情绪量平滑过渡
    const kEye = Math.min(1, dt * 9)
    const kTilt = Math.min(1, dt * 6)
    eyeScale += (moodEye - eyeScale) * kEye
    eyeSquint += (moodSquint - eyeSquint) * kEye
    tilt += (moodTilt - tilt) * kTilt

    const breathe = Math.sin(t * 1.45)
    bodyGroup.position.set(Math.sin(t * 0.5) * 0.012, breathe * 0.028, 0)
    bodyGroup.rotation.set(0, 0, tilt + Math.sin(t * 0.62) * 0.012)
    bodyGroup.scale.set(1, 1 + breathe * 0.008, 1)

    applyAction(t)


    // 眨眼
    if (blinkStart < 0 && t > nextBlink) blinkStart = t
    let blink = 1
    if (blinkStart >= 0) {
      const p = (t - blinkStart) / 0.18
      if (p >= 1) {
        blinkStart = -1
        nextBlink = t + 2.2 + Math.random() * 3.2
      } else {
        blink = 1 - Math.sin(p * Math.PI) * 0.9
      }
    }
    const sy = eyeScale * eyeSquint * blink
    for (const g of eyes) g.scale.set(eyeScale, sy, 1)

    // 星灯呼吸 + 换色时的弹一下
    const pop = Math.max(0, 1 - Math.max(0, t - toneAt) / 0.5)
    const starPulse = 1 + Math.sin(pop * Math.PI) * 0.35 + Math.sin(t * 2.1) * 0.03
    starGroup.scale.setScalar(starPulse)
    glowMat.opacity = 0.42 + Math.sin(t * 2.1 + 1) * 0.06 + pop * 0.2

    shadow.scale.set(1 - breathe * 0.02, 0.5 - breathe * 0.02, 1)
    shadow.material.opacity = 0.22 - breathe * 0.015
  }

  /* ---------------- 尺寸 / 相机 ---------------- */
  let width = 0
  let height = 0

  function frameCamera() {
    const vFov = MathUtils.degToRad(camera.fov)
    const half = Math.tan(vFov / 2)
    const distH = FRAME_H / 2 / half
    const distW = FRAME_W / 2 / (half * Math.max(camera.aspect, 0.2))
    const dist = Math.max(distH, distW) * 1.06
    camera.position.set(0, 0.42, dist)
    camera.lookAt(0, 0.2, 0)
  }

  function applySize() {
    const host = canvas.parentElement ?? canvas
    const w = Math.max(1, Math.round(host.clientWidth || canvas.clientWidth || 1))
    const h = Math.max(1, Math.round(host.clientHeight || canvas.clientHeight || 1))
    if (w === width && h === height) return
    width = w
    height = h
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    frameCamera()
    camera.updateProjectionMatrix()
  }

  /* ---------------- 渲染循环（锁 30fps） ---------------- */
  const FRAME_MS = 1000 / 30
  let raf = 0
  let running = false
  let lastTick = 0
  let elapsed = 0
  let lost = false

  function frame(now: number) {
    if (!running) return
    raf = requestAnimationFrame(frame)
    if (lastTick === 0) lastTick = now
    const diff = now - lastTick
    if (diff < FRAME_MS) return
    lastTick = now
    const dt = Math.min(diff / 1000, 0.1)
    elapsed += dt
    update(elapsed, dt)
    renderer.render(scene, camera)
  }

  function start() {
    if (running || lost) return
    running = true
    lastTick = 0
    raf = requestAnimationFrame(frame)
  }

  function stop() {
    running = false
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }

  /* ---------------- 事件 ---------------- */
  const onLost = (e: Event) => {
    e.preventDefault()
    lost = true
    stop()
  }
  const onRestored = () => {
    lost = false
    start()
  }
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      stop()
    } else {
      lastTick = 0 // 重置时间基准，避免恢复后角色瞬移
      start()
    }
  }

  canvas.addEventListener('webglcontextlost', onLost, false)
  canvas.addEventListener('webglcontextrestored', onRestored, false)
  document.addEventListener('visibilitychange', onVisibility)

  let ro: ResizeObserver | null = null
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => applySize())
    ro.observe(canvas.parentElement ?? canvas)
  }

  applySize()
  update(0, 0)
  renderer.render(scene, camera)
  start()


  /* ---------------- 对外接口 ---------------- */
  return {
    setMouth(m: Mouth) {
      mouth = m
      mouthExplicit = true
      applyMouth(m)
    },
    setMood(m: Mood) {
      switch (m) {
        case 'happy':
          moodEye = 1.05
          moodSquint = 0.86
          moodTilt = 0.015
          break
        case 'surprised':
          moodEye = 1.3
          moodSquint = 1.12
          moodTilt = 0
          break
        case 'curious':
          moodEye = 1.1
          moodSquint = 1
          moodTilt = 0.075
          break
        default:
          moodEye = 1
          moodSquint = 1
          moodTilt = 0
      }
      // 没有显式口令型时，情绪顺带改嘴形
      if (!mouthExplicit) {
        mouth = m === 'happy' ? 'smile' : m === 'surprised' ? 'o' : 'closed'
        applyMouth(mouth)
      }
    },
    play(a: Action) {
      action = { kind: a, t0: elapsed }
    },
    setTone(tone: 1 | 2 | 3 | 4) {
      const c = new Color(TONE_COLORS[tone] ?? TONE_COLORS[1])
      starMat.color.copy(c)
      glowMat.color.copy(c)
      toneAt = elapsed
    },
    resize() {
      applySize()
      // resize 会清空绘制缓冲；无头/后台场景下渲染循环可能已停，这里补一帧
      renderer.render(scene, camera)
    },
    dispose() {
      stop()
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      document.removeEventListener('visibilitychange', onVisibility)
      ro?.disconnect()
      ro = null
      scene.traverse((obj) => {
        if (obj instanceof Mesh) {
          obj.geometry.dispose()
          const m = obj.material as Material | Material[]
          if (Array.isArray(m)) m.forEach((x) => x.dispose())
          else m.dispose()
        }
      })
      softTex.dispose()
      renderer.dispose()
    },
  }
}
