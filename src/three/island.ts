/**
 * 拼音岛地图 —— 23 座低多边形浮岛
 * 全部用 InstancedMesh：圆台 + 灯塔 + 灯球各 1 个 draw call（分实/虚两组）。
 * 相机固定、无轨道控制；不做后处理与实时阴影。
 */
import {
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import type { Material } from 'three'

export type IslandState = 'locked' | 'current' | 'done'

export interface IslandHandle {
  setState(islands: { day: number; state: IslandState }[]): void
  resize(): void
  dispose(): void
}

const COUNT = 23

const C_CREAM = '#FFF8F0'
const C_MIST = '#D9E6F6'
const C_GHOST = '#BDB3CC'
const C_BASE_DONE = '#F0E0CE'
const C_BASE_CURRENT = '#FFF1DE'
const C_TOWER_DONE = '#F7E9DA'
const C_TOWER_CURRENT = '#FFF7EB'
const C_LAMP_LOCKED = '#A294B2'
const C_LAMP_DONE = '#FFD98A'
const C_LAMP_CURRENT = '#FFF6CE'
const C_RING = '#FFE9A8'

const FRAME_W = 14.0
const FRAME_H = 4.2
const CLOUD_COUNT = 90

function noopHandle(): IslandHandle {
  return { setState() {}, resize() {}, dispose() {} }
}

/* ------------------------------ 贴图 ------------------------------ */

/** 竖直渐变：奶油白 → 雾蓝 */
function makeBackdropTexture(): CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = 8
  cv.height = 256
  const ctx = cv.getContext('2d')
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, 256)
    g.addColorStop(0, C_CREAM)
    g.addColorStop(0.5, '#F4F7FC')
    g.addColorStop(1, C_MIST)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 8, 256)
  }
  const tex = new CanvasTexture(cv)
  tex.colorSpace = SRGBColorSpace
  return tex
}

/** 圆形柔点，给云用（不是精灵图，运行时生成） */
function makeSoftDotTexture(): CanvasTexture {
  const size = 64
  const cv = document.createElement('canvas')
  cv.width = size
  cv.height = size
  const ctx = cv.getContext('2d')
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    g.addColorStop(0, 'rgba(255,255,255,0.95)')
    g.addColorStop(0.45, 'rgba(255,255,255,0.55)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }
  const tex = new CanvasTexture(cv)
  tex.colorSpace = SRGBColorSpace
  return tex
}

/* ------------------------------ 几何 ------------------------------ */

/** 圆台岛体（7 边形，低面） */
function makeIslandGeometry(): CylinderGeometry {
  return new CylinderGeometry(0.46, 0.62, 0.22, 7)
}

/** 灯塔：车削出塔身 + 灯座外沿（顶部敞开，由灯球盖住） */
function makeTowerGeometry(): LatheGeometry {
  const profile = [
    new Vector2(0.002, 0),
    new Vector2(0.115, 0),
    new Vector2(0.082, 0.26),
    new Vector2(0.14, 0.3),
  ]
  return new LatheGeometry(profile, 6)
}

/** 蛇形排布：三行来回，形成一条可读的「路径」，同时保持一条连贯的曲线感 */
function buildLayout(): Vector3[] {
  const out: Vector3[] = []
  const rows = [
    { y: 1.02, z: 0.5, count: 8 },
    { y: 0, z: -0.45, count: 8 },
    { y: -1.02, z: 0.5, count: 7 },
  ]
  rows.forEach((row, r) => {
    for (let k = 0; k < row.count; k++) {
      const t = row.count > 1 ? k / (row.count - 1) : 0.5
      const x = -5.6 + t * 11.2
      const px = r % 2 === 0 ? x : -x
      out.push(
        new Vector3(
          px,
          row.y + Math.sin(t * Math.PI) * 0.16,
          row.z + Math.cos(px * 0.42) * 0.45,
        ),
      )
    }
  })
  return out
}

/* ------------------------------ 主体 ------------------------------ */

export function createIslandScene(
  canvas: HTMLCanvasElement,
  opts: { pixelRatioCap?: number } = {},
): IslandHandle {
  let created: WebGLRenderer | null = null
  try {
    created = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'low-power',
      stencil: false,
    })
  } catch {
    created = null
  }
  if (!created) return noopHandle()
  const renderer = created
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.pixelRatioCap ?? 1.5))

  const scene = new Scene()
  const backdrop = makeBackdropTexture()
  scene.background = backdrop

  const camera = new PerspectiveCamera(38, 1, 0.1, 60)

  /* 灯光：半球光提供柔和环境，方向光给低面一点体积感；无阴影。
     three r155+ 为物理光照单位，强度约为老写法的 π 倍 */
  const hemi = new HemisphereLight(new Color('#FFFDF8'), new Color('#E7EEF9'), 2.4)
  const dir = new DirectionalLight(new Color('#FFFFFF'), 1.5)
  dir.position.set(3, 6, 5)
  scene.add(hemi, dir)

  const layout = buildLayout()
  const positions = layout.slice(0, COUNT)
  const states: IslandState[] = new Array<IslandState>(COUNT).fill('locked')
  let currentIndex = -1

  /* ---------------- 材质 ---------------- */
  const solidBaseMat = new MeshLambertMaterial({ color: new Color('#FFFFFF') })
  const solidTowerMat = new MeshLambertMaterial({ color: new Color('#FFFFFF') })
  const ghostMat = new MeshLambertMaterial({
    color: new Color(C_GHOST),
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  })
  const lampMat = new MeshBasicMaterial({ color: new Color('#FFFFFF') })
  const lampGlowMat = new MeshBasicMaterial({
    color: new Color('#FFFFFF'),
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
  })

  /* ---------------- InstancedMesh ---------------- */
  const bases = new InstancedMesh(makeIslandGeometry(), solidBaseMat, COUNT)
  const basesGhost = new InstancedMesh(makeIslandGeometry(), ghostMat, COUNT)
  const towers = new InstancedMesh(makeTowerGeometry(), solidTowerMat, COUNT)
  const towersGhost = new InstancedMesh(makeTowerGeometry(), ghostMat, COUNT)
  const lamps = new InstancedMesh(new IcosahedronGeometry(0.085, 0), lampMat, COUNT)
  const lampGlows = new InstancedMesh(new SphereGeometry(0.19, 12, 8), lampGlowMat, COUNT)

  const instanced = [bases, basesGhost, towers, towersGhost, lamps, lampGlows]
  for (const m of instanced) {
    m.frustumCulled = false
    scene.add(m)
  }

  /* ---------------- 连接 23 座岛的航线 ---------------- */
  const pathPoints = layout.map((p) => new Vector3(p.x, p.y + 0.13, p.z))
  const pathCurve = new CatmullRomCurve3(pathPoints, false, 'catmullrom', 0.35)
  const pathMesh = new Mesh(
    new TubeGeometry(pathCurve, 180, 0.014, 4, false),
    new MeshBasicMaterial({
      color: new Color('#EDD3A0'),
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    }),
  )
  scene.add(pathMesh)

  /* ---------------- 当前岛光环 ---------------- */
  const ringGroup = new Group()
  ringGroup.visible = false
  scene.add(ringGroup)

  const ringMat = new MeshBasicMaterial({
    color: new Color(C_RING),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  })
  const haloMat = new MeshBasicMaterial({
    color: new Color(C_RING),
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
  })

  const ringFlat = new Mesh(new TorusGeometry(0.66, 0.026, 6, 30), ringMat)
  ringFlat.rotation.x = -Math.PI / 2
  ringFlat.position.y = 0.13

  const ringHalo = new Mesh(new TorusGeometry(0.34, 0.028, 6, 26), haloMat)
  ringHalo.position.set(0, 0.38, -0.04)

  ringGroup.add(ringFlat, ringHalo)

  ringGroup.add(ringFlat, ringHalo)

  /* ---------------- 云 ---------------- */
  const dotTex = makeSoftDotTexture()
  const cloudPos = new Float32Array(CLOUD_COUNT * 3)
  const cloudSpeed = new Float32Array(CLOUD_COUNT)
  for (let i = 0; i < CLOUD_COUNT; i++) {
    cloudPos[i * 3] = -12 + Math.random() * 24
    cloudPos[i * 3 + 1] = -3.2 + Math.random() * 6.4
    cloudPos[i * 3 + 2] = -3.5 + Math.random() * 6
    cloudSpeed[i] = 0.05 + Math.random() * 0.11
  }
  const cloudGeo = new BufferGeometry()
  cloudGeo.setAttribute('position', new Float32BufferAttribute(cloudPos, 3))
  const clouds = new Points(
    cloudGeo,
    new PointsMaterial({
      map: dotTex,
      size: 0.34,
      color: new Color('#FFFFFF'),
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  )
  clouds.frustumCulled = false
  scene.add(clouds)

  /* ---------------- 实例写入 ---------------- */
  const dummy = new Object3D()
  const tmpColor = new Color()

  function writeInstance(mesh: InstancedMesh, i: number, pos: Vector3, scale: number) {
    dummy.position.copy(pos)
    dummy.rotation.set(0, 0, 0)
    dummy.scale.setScalar(scale)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }

  function baseScale(state: IslandState): number {
    if (state === 'locked') return 0.92
    if (state === 'current') return 1.08
    return 1
  }

  /** 全量重建实例矩阵与颜色 */
  function rebuild() {
    currentIndex = -1
    for (let i = 0; i < COUNT; i++) {
      const p = positions[i]
      const state = states[i]
      const s = baseScale(state)
      const hidden = 0
      const solid = state !== 'locked'

      if (solid) {
        writeInstance(bases, i, p, s)
        writeInstance(basesGhost, i, p, hidden)
        writeInstance(towers, i, tmpY(p, 0.11, s), s)
        writeInstance(towersGhost, i, p, hidden)
      } else {
        writeInstance(bases, i, p, hidden)
        writeInstance(basesGhost, i, p, s)
        writeInstance(towers, i, p, hidden)
        writeInstance(towersGhost, i, tmpY(p, 0.11, s), s)
      }
      const lampScale = state === 'current' ? 1.2 : s
      writeInstance(lamps, i, tmpY(p, 0.43, s), lampScale)
      writeInstance(lampGlows, i, tmpY(p, 0.43, s), state === 'locked' ? 0 : lampScale * 1.15)

      // 岛体颜色
      if (solid) {
        tmpColor.set(state === 'current' ? C_BASE_CURRENT : C_BASE_DONE)
        bases.setColorAt(i, tmpColor)
        tmpColor.set(state === 'current' ? C_TOWER_CURRENT : C_TOWER_DONE)
        towers.setColorAt(i, tmpColor)
      }

      // 灯球 + 光晕颜色
      tmpColor.set(
        state === 'locked' ? C_LAMP_LOCKED : state === 'current' ? C_LAMP_CURRENT : C_LAMP_DONE,
      )
      lamps.setColorAt(i, tmpColor)
      lampGlows.setColorAt(i, tmpColor)

      if (state === 'current') currentIndex = i
    }

    for (const m of instanced) m.instanceMatrix.needsUpdate = true
    if (bases.instanceColor) bases.instanceColor.needsUpdate = true
    if (towers.instanceColor) towers.instanceColor.needsUpdate = true
    if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true
    if (lampGlows.instanceColor) lampGlows.instanceColor.needsUpdate = true

    if (currentIndex >= 0) {
      const p = positions[currentIndex]
      ringGroup.position.set(p.x, p.y, p.z)
      ringGroup.visible = true
    } else {
      ringGroup.visible = false
    }
  }

  /** 以岛心为基准，按缩放后的高度偏移（灯塔、灯球） */
  function tmpY(p: Vector3, dy: number, s: number): Vector3 {
    return new Vector3(p.x, p.y + dy * s, p.z)
  }

  /* ---------------- 每帧 ---------------- */
  const scratch = new Vector3()

  function update(t: number, dt: number) {
    // 云飘动
    const attr = cloudGeo.attributes.position
    for (let i = 0; i < CLOUD_COUNT; i++) {
      let x = attr.getX(i) + cloudSpeed[i] * dt
      if (x > 12.5) x -= 25
      attr.setX(i, x)
    }
    attr.needsUpdate = true

    // 当前岛呼吸
    if (currentIndex >= 0) {
      const p = positions[currentIndex]
      const bob = Math.sin(t * 1.4) * 0.045
      const s = 1.08 + Math.sin(t * 1.4) * 0.012
      const pulse = 1.2 + Math.sin(t * 2.4) * 0.16
      scratch.set(p.x, p.y + bob, p.z)
      writeInstance(bases, currentIndex, scratch, s)
      writeInstance(towers, currentIndex, tmpY(scratch, 0.11, s), s)
      writeInstance(lamps, currentIndex, tmpY(scratch, 0.43, s), pulse)
      writeInstance(lampGlows, currentIndex, tmpY(scratch, 0.43, s), pulse * 1.15)
      bases.instanceMatrix.needsUpdate = true
      towers.instanceMatrix.needsUpdate = true
      lamps.instanceMatrix.needsUpdate = true
      lampGlows.instanceMatrix.needsUpdate = true
      lampGlowMat.opacity = 0.26 + Math.sin(t * 2.4) * 0.1

      ringGroup.position.set(scratch.x, scratch.y, scratch.z)
      ringGroup.scale.setScalar(1 + Math.sin(t * 1.8) * 0.05)
      ringMat.opacity = 0.45 + Math.sin(t * 1.8) * 0.12
      haloMat.opacity = 0.2 + Math.sin(t * 1.8 + 0.9) * 0.08
    }
  }

  /* ---------------- 相机 / 尺寸 ---------------- */
  let width = 0
  let height = 0

  function frameCamera() {
    const vFov = MathUtils.degToRad(camera.fov)
    const half = Math.tan(vFov / 2)
    const distH = FRAME_H / 2 / half
    const distW = FRAME_W / 2 / (half * Math.max(camera.aspect, 0.2))
    const dist = Math.max(distH, distW) * 1.04
    // 固定 15° 左右俯视，沿弧线偏一点；不做轨道控制
    camera.position.set(0, dist * 0.27, dist * 0.94)
    camera.lookAt(0, 0.28, 0)
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

  /* ---------------- 循环（锁 30fps） ---------------- */
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
      lastTick = 0
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

  rebuild()
  applySize()
  renderer.render(scene, camera)
  start()


  /* ---------------- 对外接口 ---------------- */
  return {
    setState(list: { day: number; state: IslandState }[]) {
      states.fill('locked')
      for (const item of list) {
        const idx = Math.round(item.day) - 1
        if (idx >= 0 && idx < COUNT) states[idx] = item.state
      }
      rebuild()
      renderer.render(scene, camera)
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
        if (obj instanceof Mesh || obj instanceof Points) {
          obj.geometry.dispose()
          const m = obj.material as Material | Material[]
          if (Array.isArray(m)) m.forEach((x) => x.dispose())
          else m.dispose()
        }
      })
      for (const m of instanced) m.dispose()
      backdrop.dispose()
      dotTex.dispose()
      renderer.dispose()
    },
  }
}
