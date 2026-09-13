/* ══════════════════════════════════════════════════════════════════════════
   city/core.js —— 巴黎城市层 · 内核契约（PC = Paris City）

   职责：模块注册表 · 共享调色板与材质工厂 · 贴图缓存 · LOD 服务 · 实例池
   规矩：城市层模块只许通过 PC.mod() 注册，只许经 PC.plan 互相通信；
        禁止直接改 paris.html / engine.js / buildings/*。
        任何模块 build 抛错只丢自己那一层，页面照常出图。

   依赖：three.js（全局 THREE）、engine.js（全局 P3D.helpers）
   ══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

const H = (window.P3D && P3D.helpers) || {};
/* 兜底：engine.js 万一没先加载，内核也不能整个挂掉（会带走全部六个模块） */
const clamp = H.clamp || ((v, a, b) => v < a ? a : (v > b ? b : v));
const lerp  = H.lerp  || ((a, b, t) => a + (b - a) * t);
const TAU   = H.TAU   || Math.PI * 2;
const mulberry32 = H.mulberry32 || function(a){
  return function(){ a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296; };
};
const cv = H.cv || function(w, h){
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
};

const PC = window.PC = {
  version: '2.0',
  plan: null,          // 由 city/plan.js 填充
  _mods: {},
  _built: {},
  ctx: null
};

/* ── 全局高程基准（不可改：地标已按 street=0 摆好，河是挖下去的） ────────── */
PC.Y = { street: 0, berge: -6.6, water: -8.6, bedrock: -12.0 };

/* ── 地理投影：经纬 → 本地平面（原点=巴黎圣母院） ───────────────────────
   由现有地标坐标反解验证（埃菲尔/卢浮宫，误差 <5m）。所有真实地理数据走这里。 */
PC.LON0 = 2.34987; PC.LAT0 = 48.85300;
PC.MX = 73240; PC.MZ = 110574;
PC.geo = (lon, lat) => [ (lon - PC.LON0) * PC.MX, (lat - PC.LAT0) * PC.MZ ];
PC.ungeo = (x, z) => [ x / PC.MX + PC.LON0, z / PC.MZ + PC.LAT0 ];

/* ── 共享调色板 ───────────────────────────────────────────────────────
   全城只有这一份色。模块里禁止自己 new Color 写死一个灰——那会让六个人
   各调各的灰，拼起来像六座城市。要新色先加到这里。 */
PC.palette = {
  /* 石与墙 */
  limestone:   0xd9cfb8,   // 巴黎石灰岩（pierre de taille）主色
  limestoneDk: 0xb9ad95,   // 阴面/风化重
  limestoneLt: 0xe8dfc9,   // 洗过的新石材
  quaiStone:   0x9a9081,   // 河堤块石（长期水线，偏冷脏）
  bridgeStone: 0xa89e8c,

  /* 屋顶与金属 */
  zinc:        0x6a6f75,   // 锌板屋面——巴黎屋顶的标准色
  zincLt:      0x848a91,
  slate:       0x4a5057,   // 板岩
  chimney:     0xb08a72,   // 陶土烟囱管
  ironDk:      0x2c3230,   // 锻铁栏杆/路灯（近黑绿）
  parisGreen:  0x2f4f3e,   // 巴黎绿：Wallace泉/长椅/报刊亭/旧书摊/地铁口
  gilt:        0xd7a244,   // 镀金

  /* 地面 */
  pave:        0x76736d,   // 花岗岩弹石车行道
  asphalt:     0x565553,   // 沥青
  sidewalk:    0x8d8981,   // 人行道
  curb:        0x9c9890,   // 路缘石
  sand:        0xa89877,   // 砂土步道（杜乐丽/卢森堡）
  lawn:        0x5e7148,   // 草坪
  foliage:     0x4e6b3c,   // 树冠
  foliageLt:   0x6b8850,

  /* 水 */
  waterDeep:   0x3c4a44,   // 塞纳河深色——灰绿褐，不是蓝
  waterShallow:0x55604f,
  foam:        0xd8ded6,

  /* 店面漆色（随机抽） */
  shopPaints: [0x1e3a2e, 0x5c1f24, 0x1b2b45, 0x14161a, 0x3d2a1c, 0x4a3520],
  awnings:    [0x1e4636, 0x6d2029, 0x2a3f66, 0xc9bfa3, 0x7a4a1e, 0x30302e]
};

/* ── Canvas / 贴图工具（带缓存，避免六个模块各烤一份同样的石头） ────────── */
const TEXCACHE = {};
PC.canvas = (w, h) => (cv ? cv(w, h) : (() => {
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
})());
/* 城市层在本作里被整体 scale.z = -1（参考项目 north = +Z，本作 north = -Z）。
   几何镜像之后，贴图贴到立面上同样是左右翻转的——后果是招牌文字整行反写
   （BRASSERIE DU PONT 看起来像 ДИОЯЦ...）。在纹理入口把 canvas 水平翻一次，
   等价于给所有立面贴图做反向补偿；非文字图案翻转后无差别。 */
PC.flipX = function(c){
  const f = document.createElement('canvas'); f.width = c.width; f.height = c.height;
  const g = f.getContext('2d');
  g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(c, 0, 0);
  return f;
};
PC.texture = function(canvas, opt){
  opt = opt || {};
  const t = new THREE.CanvasTexture(PC.flipX(canvas));
  t.wrapS = t.wrapT = opt.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.anisotropy = opt.aniso === undefined ? 8 : opt.aniso;
  if (opt.repeat) t.repeat.set(opt.repeat[0], opt.repeat[1] === undefined ? opt.repeat[0] : opt.repeat[1]);
  if (opt.srgb && THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
  return t;
};
/* 缓存版：同 key 只生成一次。fn 返回 canvas 或 {canvas,opt} */
PC.cachedTex = function(key, fn, opt){
  if (TEXCACHE[key]) return TEXCACHE[key];
  const r = fn();
  const c = (r && r.canvas) ? r.canvas : r;
  return (TEXCACHE[key] = PC.texture(c, (r && r.opt) || opt));
};

/* ── 确定性随机（全城同一族） ─────────────────────────────────────────── */
PC.SEED = 20260829;
PC.rng = (salt) => mulberry32((PC.SEED ^ (salt * 2654435761)) >>> 0);
/* 位置哈希：同一坐标永远得到同一个值，模块间不用同步随机数流 */
PC.hash2 = function(x, z, salt){
  let h = Math.imul(Math.round(x * 8) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul(Math.round(z * 8) ^ 0xc2b2ae35, 0x27d4eb2f);
  h ^= Math.imul((salt | 0) + 0x165667b1, 0x9e3779b1);
  h ^= h >>> 15;
  return ((h >>> 0) % 100000) / 100000;
};

/* ── 共享材质（懒建 + 缓存）。模块用 PC.mats().xxx，不自己 new ────────── */
let MATS = null;
PC.mats = function(){
  if (MATS) return MATS;
  const P = PC.palette;
  const SC = h => new THREE.Color(h).convertSRGBToLinear();
  const std = o => new THREE.MeshStandardMaterial(o);
  MATS = {
    SC, std,
    stone:   std({color: SC(P.limestone),   roughness: .95, metalness: 0, envMapIntensity: .55}),
    stoneDk: std({color: SC(P.limestoneDk), roughness: .97, metalness: 0, envMapIntensity: .45}),
    quai:    std({color: SC(P.quaiStone),   roughness: .98, metalness: 0, envMapIntensity: .40}),
    bridge:  std({color: SC(P.bridgeStone), roughness: .94, metalness: 0, envMapIntensity: .50}),
    zinc:    std({color: SC(P.zinc),        roughness: .62, metalness: .45, envMapIntensity: .85}),
    slate:   std({color: SC(P.slate),       roughness: .80, metalness: .15, envMapIntensity: .55}),
    iron:    std({color: SC(P.ironDk),      roughness: .55, metalness: .70, envMapIntensity: .90}),
    green:   std({color: SC(P.parisGreen),  roughness: .58, metalness: .35, envMapIntensity: .80}),
    gilt:    std({color: SC(P.gilt),        roughness: .26, metalness: .95,
                  emissive: SC(0x2a1c05), emissiveIntensity: .5, envMapIntensity: 1.4}),
    lawn:    std({color: SC(P.lawn),        roughness: 1,   metalness: 0, envMapIntensity: .40}),
    foliage: std({color: SC(P.foliage),     roughness: .92, metalness: 0, envMapIntensity: .45,
                  side: THREE.DoubleSide}),
    dark:    std({color: 0x0b0d10, roughness: 1, metalness: 0}),
    glassLit:std({color: SC(0x1a1d22), roughness: .18, metalness: 0,
                  emissive: SC(0xffd9a0), emissiveIntensity: .55, envMapIntensity: 1.2})
  };
  return MATS;
};

/* ── LOD 服务 ─────────────────────────────────────────────────────────
   街道细节只在相机附近实例化。相机移动超过 minDelta 才触发重填，
   否则 8000 个 parcel 每帧重算矩阵会直接把帧率打死。 */
PC.lod = {
  R0: 340,          // 近景环：门店/桌椅/伞/栏杆
  R1: 1100,         // 中景环：曼萨屋顶/烟囱/树
  pos: null,
  _subs: [],
  _last: null,
  ring(x, z){
    if (!this.pos) return 2;
    const d = Math.hypot(x - this.pos.x, z - this.pos.z);
    return d < this.R0 ? 0 : (d < this.R1 ? 1 : 2);
  },
  /* cb(camPos) —— 相机移动超过 minDelta 米后调用（首帧必调一次） */
  onMove(cb, minDelta){ this._subs.push({cb, d: minDelta || 80, last: null}); },
  tick(camPos){
    this.pos = camPos;
    for (const s of this._subs){
      if (!s.last || s.last.distanceTo(camPos) > s.d){
        s.last = camPos.clone();
        try { s.cb(camPos); } catch(e){ console.warn('[PC.lod]', e); }
      }
    }
  }
};

/* ── 实例池 ───────────────────────────────────────────────────────────
   用法：const p = PC.pool(geo, mat, 600);
        p.reset(); ... p.push(matrix4[, color]); ... p.commit();
   commit() 只把 count 设成实际推入数，未用的实例不画。 */
PC.pool = function(geo, mat, max, opt){
  opt = opt || {};
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow    = opt.castShadow    !== false;
  mesh.receiveShadow = opt.receiveShadow !== false;
  mesh.frustumCulled = false;              // 实例分布远大于包围球，自剔除会误杀
  mesh.count = 0;
  if (opt.colors){
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  /* 逐实例风化属性 aVary = (age, grime, tint)，配合 PC.varyShader 用 */
  let varyAttr = null;
  if (opt.vary){
    varyAttr = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    varyAttr.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute('aVary', varyAttr);
  }
  let n = 0;
  const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
  return {
    mesh, max, varyAttr,
    get count(){ return n; },
    reset(){ n = 0; },
    /* prof 可传 PC.vary.of() 的档案对象，或 [age,grime,tint] 三元组 */
    push(m4, color, prof){
      if (n >= max) return false;
      mesh.setMatrixAt(n, m4);
      if (color && mesh.instanceColor) mesh.setColorAt(n, color);
      if (prof && varyAttr){
        const a = prof.age !== undefined ? prof.age : (prof[0] || 0);
        const g = prof.grime !== undefined ? prof.grime : (prof[1] || 0);
        const t = prof.tint !== undefined ? prof.tint : (prof[2] || 0);
        varyAttr.setXYZ(n, a, g, t);
      }
      n++; return true;
    },
    commit(){
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (varyAttr) varyAttr.needsUpdate = true;
      return n;
    },
    hideRest(){ for (let i = n; i < max; i++) mesh.setMatrixAt(i, HIDE); }
  };
};

/* ══════════════════════════════════════════════════════════════════════
   PC.vary —— 泛用件个体差异系统

   分工的铁律：
     · **地标（buildings/*.js）永不随机。** 圣母院只有一座，它有唯一正确答案，
       全部尺寸材质按史实定死。这一整套东西不许用在地标上。
     · **泛用件是种群。** 树、船、桌椅、遮阳篷、路灯、长椅、驳船、店面漆——
       它们没有「正确的那一个」，只有「这一批大概长什么样」。种群天然有个体差异，
       没有差异才是错的。

   随机要有结构，否则只是噪声。三条：
     1) 年龄是隐变量。褪色/粗糙/氧化/磨损/积垢由同一个 age 驱动，不是各随机各的。
        五样各自独立随机 = 塑料玩具；一个 age 统一驱动 = 岁月。
     2) 从真实色族里抽，不从色轮上抽。巴黎的遮阳篷只有那六族颜色，抽错族比不随机更假。
     3) 空间相关 + 批次相关。临河的脏、北面的苔、高处的褪；同一家店的桌椅是同一批，
        同一条街的行道树是同年栽的——同批之内仍有个体差，但均值要一致。
   ══════════════════════════════════════════════════════════════════════ */

/* 真实色族。抽色从这里抽，不许在模块里现编一个颜色数组 */
PC.families = {
  awning:    [0x1e4636, 0x6d2029, 0x2a3f66, 0xc9bfa3, 0x7a4a1e, 0x30302e], // 遮阳篷
  shopPaint: [0x1e3a2e, 0x5c1f24, 0x1b2b45, 0x14161a, 0x3d2a1c, 0x4a3520], // 店面漆木
  boatHull:  [0xe8e6e0, 0x24443a, 0x1f3350, 0x1a1c1f, 0x6d3a2a, 0x8d8b84], // 船体
  rattan:    [0xb08a4e, 0x8a6534, 0xc2a06a, 0x6f4f2c],                     // 藤编
  ironGreen: [0x2f4f3e, 0x27443a, 0x35563f, 0x2a4436],                     // 巴黎绿铸铁
  foliage:   [0x4e6b3c, 0x577449, 0x466036, 0x628050, 0x3f5a30],           // 树冠
  terracotta:[0xb08a72, 0xa87d63, 0xc09680, 0x9c7460],                     // 陶土烟囱管
  planter:   [0x3a2f26, 0x2f4034, 0x6b4a35, 0x2b2e33],                     // 花箱

  /* ── 以下三族由 shops.js 加入（只加不改上面的族） ───────────────────── */
  /* bistro 椅编条：rattan 四支之外，再加 Drucker / Gatti 两家实际在卖的
     米白、深红、墨绿、压过的天青。编条是双色斜纹交织，比布料样本色灰一档，
     这里给的已经是压过的值。 */
  rattanWeave:[0xe0d6be, 0xd3c6a8, 0xb8945c, 0xa07c46,
               0x7a3234, 0x8a5a3a, 0x33523f, 0x4e6a86],
  /* 咖啡馆桌面：白大理石 / 灰大理石 / 锌板 / 深色石。
     锌板是巴黎老 bistro 的标准台面——「zinc」这个词就是这么来的。 */
  tableTop:  [0xe4dfd2, 0xc0bbb0, 0x9b9a96, 0x74787c, 0x3c3e40],
  /* 花店桶里的花：红 / 黄 / 白 / 紫，一桶一色 */
  bloom:     [0xc8455a, 0xe8b93c, 0xefeae0, 0x8e5fa8],

  /* ── 以下五族由 water.js 加入（只加不改上面的族） ───────────────────── */
  /* 观光船船体：巴黎的游船几乎全是白的，差别在「哪一种白」——
     冷白 / 奶白 / 灰白 / 带一点海青。深色留给货驳，别混进来。 */
  boatTour:  [0xe8e6e0, 0xe2ddd2, 0xd7d9d8, 0xefeae1, 0xcfd6d6],
  /* 住家船舱室漆：奶油 / 米白 / 淡蓝灰 / 淡青，都是浅色系
     （深色舱室在河上读不出那条窗带，等于把住家船退化成一块黑） */
  boatCabin: [0xefe7d6, 0xe6ddc8, 0xdfe3e2, 0xe9e2dd, 0xd8dfda],
  /* 旧书摊 vert wagon：1900 年市政强制的车厢绿。形制法定统一，
     但各摊补漆的年份不同，深浅有差 */
  bouquiniste:[0x0a3a2e, 0x0f3d31, 0x0d3529, 0x123f34],
  /* 甲板杂物：木箱 / 油桶 / 缆盘 / 水桶的漆与锈 */
  deckJunk:  [0x6b5334, 0x4a4b46, 0x7a4a2a, 0x3a4a52, 0x8a7b5e, 0x5c2f24],
  /* 书堆：旧书摊开着的箱子里那一摞书脊 */
  bookStack: [0x8a6b42, 0x6d4a30, 0x9c8560, 0x5a3b2c, 0x7d6a4e],

  /* ── 以下七族由 terrain.js 加入（只加不改上面的族） ───────────────────
     地面材料。每一族的第 0 个就是 PC.palette 里那个名义色，也就是「标准件」；
     往后是同一种材料的别的采石批次、别的年代铺的、别的养护状态。
     色相几乎不动，只在明度和冷暖上分家——真实路面的批次差就是这么小，
     再拉开一档整座城市的地面就成了花花绿绿的马赛克。
     配 PC.vary.tail 用：多数路段抽到第 0 个，少数才抽到后面的。 */
  pave:      [0x76736d, 0x7b7871, 0x716f6b, 0x807b72, 0x6d6c69], // 车行道花岗岩弹石
  plazaStone:[0x76736d, 0x7d7a75, 0x807a6d, 0x706f6e, 0x8a857a], // 广场铺石（蓝灰花岗岩／暖砂岩）
  sidewalk:  [0x8d8981, 0x928d84, 0x878480, 0x968f83, 0x83807b], // 人行道沥青
  curbStone: [0x9c9890, 0xa19c93, 0x96938d, 0xa8a094, 0x928f8a], // 花岗岩路缘石
  gravel:    [0xa89877, 0xad9d7c, 0xa29372, 0xb2a181, 0x9e9070], // 砂砾／砂土步道
  courtyard: [0x706c64, 0x787264, 0x6a675f, 0x7e7563, 0x666158], // 内院地面
  turf:      [0x5e7148, 0x577043, 0x66784d, 0x6d7c4c, 0x536840]  // 草坪
};

/* ── 场域：位置决定的环境因子。同一坐标永远得到同一份 ────────────────── */
PC.vary = {
  field(x, z){
    let riverside = 0;
    const plan = PC.plan;
    if (plan && plan.river && plan.river.dist){
      try { const d = plan.river.dist(x, z).d; riverside = 1 - Math.min(1, d / 260); }
      catch(e){}
    }
    /* 街区「档次」：大尺度低频噪声，让城市有富有旧的分区，而不是均匀一锅粥 */
    const prestige = 0.5
      + 0.32 * Math.sin(x * 0.00061 + 1.7) * Math.cos(z * 0.00048 - 0.6)
      + 0.18 * (PC.hash2(Math.round(x / 420), Math.round(z / 420), 91) - 0.5) * 2;
    return { riverside, prestige: clamp(prestige, 0, 1) };
  },

  /* ── 个体档案 ───────────────────────────────────────────────────────
     kind  物件类别（决定老化速度：石头慢、油漆快、藤编最快）
     x,z   位置（决定场域）
     batch 批次号：同一家店的桌椅、同一条街的树传同一个 batch，
           它们会共享均值、只在个体上小幅浮动。不传就是纯个体随机。
     返回 {age,grime,wear,moss,scale,tilt,spin,pick(arr),f(salt)}         */
  of(kind, x, z, batch){
    const K = PC.vary.RATES[kind] || PC.vary.RATES._default;
    const F = PC.vary.field(x, z);
    const h = s => PC.hash2(x, z, s);
    /* 批次均值：同批共享；没有批次就退化成个体值 */
    const bh = batch === undefined || batch === null
      ? h(11)
      : PC.hash2(batch * 7.3, batch * 3.1, 11);

    /* 年龄 = 批次基龄(70%) + 个体浮动(30%)，再被「档次」拉低（好街区维护勤） */
    let age = bh * 0.7 + h(23) * 0.3;
    age = clamp(age * K.age * (1.24 - 0.48 * F.prestige), 0, 1);

    /* 污垢：年龄驱动，临河加成（水汽 + 车流），下雨面朝向在 shader 里再细分 */
    const grime = clamp(age * K.grime * (1 + 0.55 * F.riverside) * (0.75 + 0.5 * h(37)), 0, 1);
    /* 磨损：人手人脚摸得到的地方才磨，所以由 kind 决定权重 */
    const wear  = clamp(age * K.wear * (0.6 + 0.8 * h(53)), 0, 1);
    /* 苔绿：只在潮湿背阴处长，临河 + 老 + 随机 */
    const moss  = clamp((0.25 + 0.75 * F.riverside) * age * K.moss * h(71), 0, 1);

    return {
      age, grime, wear, moss,
      riverside: F.riverside, prestige: F.prestige,
      tint: h(89),                                   // 色相族内的偏移量
      scale: 1 + (h(101) - 0.5) * 2 * K.scale,       // 尺度抖动
      tilt:  (h(113) - 0.5) * 2 * K.tilt,            // 倾斜（弧度）
      spin:  h(127) * TAU,                           // 绕Y随机朝向
      /* 从数组里确定性地抽一个：同一个物件每次都抽到同一个 */
      pick(arr, salt){ return arr[Math.floor(h(salt === undefined ? 139 : salt) * arr.length) % arr.length]; },
      f(salt){ return h(salt); }
    };
  },

  /* 老化速率表：每类物件的「衰老得多快」。石头几乎不变，油漆掉得快，藤编最快 */
  RATES: {
    _default:  {age:.55, grime:.55, wear:.45, moss:.30, scale:.06, tilt:.010},
    tree:      {age:.85, grime:.20, wear:.10, moss:.10, scale:.16, tilt:.035},
    awning:    {age:.80, grime:.70, wear:.55, moss:.05, scale:.03, tilt:.004},
    chair:     {age:.90, grime:.60, wear:.85, moss:.02, scale:.04, tilt:.030},
    table:     {age:.85, grime:.65, wear:.75, moss:.02, scale:.03, tilt:.020},
    shopfront: {age:.70, grime:.60, wear:.50, moss:.08, scale:.02, tilt:.003},
    boat:      {age:.75, grime:.85, wear:.60, moss:.35, scale:.05, tilt:.012},
    barge:     {age:.90, grime:.95, wear:.80, moss:.45, scale:.06, tilt:.015},
    ironwork:  {age:.60, grime:.55, wear:.40, moss:.20, scale:.02, tilt:.006},  // 路灯/长椅/栏杆
    stone:     {age:.35, grime:.60, wear:.20, moss:.45, scale:.01, tilt:.002},
    planter:   {age:.85, grime:.75, wear:.70, moss:.30, scale:.09, tilt:.030},
    chimney:   {age:.50, grime:.80, wear:.30, moss:.15, scale:.07, tilt:.012}
  },

  /* ── 把档案作用到基色上 ────────────────────────────────────────────
     褪色 → 向「灰 + 一点冷天光」插值（阳光晒褪的方向）
     积垢 → 向暗褐灰插值（不是简单压暗，脏是有颜色的）
     族内 → 用 tint 做小幅明度/饱和抖动，让同族不同件也不一样
     out 可传一个 THREE.Color 复用，避免每帧 new                     */
  shade(base, prof, out){
    const c = out || new THREE.Color();
    c.set(base);
    const hsl = {}; c.getHSL(hsl);
    /* 族内抖动：明度 ±9%、饱和 ±14% */
    c.setHSL(hsl.h,
      clamp(hsl.s * (0.86 + prof.tint * 0.28), 0, 1),
      clamp(hsl.l * (0.91 + prof.tint * 0.18), 0, 1));
    /* 褪色 */
    const fade = prof.age * 0.42;
    c.lerp(FADE_TARGET, fade);
    /* 积垢 */
    c.lerp(GRIME_TARGET, prof.grime * 0.34);
    /* 苔绿 */
    if (prof.moss > 0.02) c.lerp(MOSS_TARGET, prof.moss * 0.30);
    return c.convertSRGBToLinear();
  },
  /* ── 长尾整形 ──────────────────────────────────────────────────────
     真实城市里绝大多数东西是标准件，少数才有个性。均匀分布的随机会让
     「每件都不一样」——那读起来还是噪声，只是换了一种噪声。
     tail(u,k)：把 [0,1) 的均匀值压向 0，留一条长尾。
       k=2.2 → 约 63% 落在前 1/3（大多数是新的/标准的），约 8% 在后 1/3（少数明显旧/怪）
     用法：prof.f(7) 拿到均匀值 → PC.vary.tail(prof.f(7), 2.4) → 再去驱动幅度         */
  tail(u, k){ return Math.pow(clamp(u, 0, 1), k === undefined ? 2.2 : k); },
  /* 反向：少数明显突出（用于「这条街上有一家店特别新」） */
  head(u, k){ return 1 - Math.pow(1 - clamp(u, 0, 1), k === undefined ? 2.2 : k); },

  /* 粗糙度也该跟着年龄走：新漆亮、旧漆哑 */
  rough(baseRough, prof){ return clamp(baseRough + prof.age * 0.28 + prof.grime * 0.14, 0, 1); },
  metal(baseMetal, prof){ return clamp(baseMetal * (1 - prof.age * 0.45), 0, 1); }
};
const FADE_TARGET  = new THREE.Color(0xc9c6bd);   // 晒褪的方向：灰白带一点冷
const GRIME_TARGET = new THREE.Color(0x4a443b);   // 积垢的方向：暗褐灰
const MOSS_TARGET  = new THREE.Color(0x5a6b3e);   // 苔绿

/* ── 逐实例风化 shader 注入 ──────────────────────────────────────────
   给用了 {vary:true} 的 InstancedMesh 材质注入 aVary=(age,grime,tint)：
     · 底部积污：靠近物件底部越脏（雨溅 + 灰尘堆积）
     · 边缘磨损：朝上的面被摸/被踩/被晒得最狠，露出底材色
     · 褪色：整体向灰白偏
   这比只改 instanceColor 多一个层次——同一件东西身上也有新有旧。       */
PC.varyShader = function(mat, opt){
  opt = opt || {};
  const wearCol = new THREE.Color(opt.wearColor || 0xb9b2a4).convertSRGBToLinear();
  const y0 = opt.y0 === undefined ? 0.0 : opt.y0;      // 物件底部的局部 y
  const y1 = opt.y1 === undefined ? 1.2 : opt.y1;      // 积污消失的高度
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = shader => {
    if (prev) prev(shader);
    shader.vertexShader =
      'attribute vec3 aVary;\nvarying vec3 vVary;\nvarying vec3 vLPos;\nvarying vec3 vLNrm;\n'
      + shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n vVary=aVary;\n vLPos=position;\n vLNrm=normal;');
    shader.fragmentShader =
      'varying vec3 vVary;\nvarying vec3 vLPos;\nvarying vec3 vLNrm;\n'
      + 'uniform vec3 uWearCol;\n'
      + 'float vHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n'
      + shader.fragmentShader.replace('#include <color_fragment>',
        '#include <color_fragment>\n'
      + ' {\n'
      + '  float age=vVary.x, grime=vVary.y;\n'
      + '  float lowness=1.0-smoothstep(' + y0.toFixed(3) + ',' + y1.toFixed(3) + ',vLPos.y);\n'
      + '  float dirt=grime*(0.30+0.70*lowness);\n'          // 底部积污
      + '  float n=vHash(floor(vLPos.xz*7.0)+vLPos.y*3.0);\n'
      + '  dirt*=0.72+0.56*n;\n'
      + '  diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(0.58,0.55,0.50),dirt*0.55);\n'
      + '  float up=max(0.0,vLNrm.y);\n'                     // 朝上的面磨得最狠
      + '  float rub=age*up*smoothstep(0.35,0.9,n);\n'
      + '  diffuseColor.rgb=mix(diffuseColor.rgb,uWearCol,rub*0.34);\n'
      + '  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(dot(diffuseColor.rgb,vec3(0.34,0.5,0.16))),age*0.16);\n'
      + ' }\n');
    shader.uniforms.uWearCol = {value: wearCol};
  };
  mat.customProgramCacheKey = () => 'vary' + (opt.key || '') + y0 + '_' + y1;
  mat.needsUpdate = true;
  return mat;
};

/* ── 几何合并（静态层用：把上千块地面拼成一个 draw call） ────────────── */
PC.merge = function(geos){
  const out = geos.filter(g => g && g.attributes && g.attributes.position);
  if (!out.length) return null;
  if (out.length === 1) return out[0];
  let vc = 0, ic = 0, hasUV = true, hasN = true;
  for (const g of out){
    vc += g.attributes.position.count;
    ic += g.index ? g.index.count : g.attributes.position.count;
    if (!g.attributes.uv) hasUV = false;
    if (!g.attributes.normal) hasN = false;
  }
  const P = new Float32Array(vc * 3), N = hasN ? new Float32Array(vc * 3) : null,
        U = hasUV ? new Float32Array(vc * 2) : null,
        I = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
  let vo = 0, io = 0;
  for (const g of out){
    const p = g.attributes.position.array, c = g.attributes.position.count;
    P.set(p, vo * 3);
    if (N) N.set(g.attributes.normal.array, vo * 3);
    if (U) U.set(g.attributes.uv.array, vo * 2);
    if (g.index){ const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) I[io + i] = gi[i] + vo; io += gi.length; }
    else { for (let i = 0; i < c; i++) I[io + i] = i + vo; io += c; }
    vo += c;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  if (N) m.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  if (U) m.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  m.setIndex(new THREE.BufferAttribute(I, 1));
  if (!N) m.computeVertexNormals();
  m.computeBoundingSphere();
  for (const g of out) g.dispose && g.dispose();
  return m;
};

/* ── 多边形工具（plan 与各模块共用，避免六份各写一遍） ─────────────────── */
PC.poly = {
  area(p){ let a = 0; for (let i = 0; i < p.length; i++){ const q = p[i], r = p[(i+1)%p.length];
    a += q[0]*r[1] - r[0]*q[1]; } return a/2; },
  centroid(p){ let x = 0, z = 0, a = 0;
    for (let i = 0; i < p.length; i++){ const q = p[i], r = p[(i+1)%p.length];
      const f = q[0]*r[1] - r[0]*q[1]; a += f; x += (q[0]+r[0])*f; z += (q[1]+r[1])*f; }
    a *= 0.5; if (Math.abs(a) < 1e-9) return [p[0][0], p[0][1]];
    return [x/(6*a), z/(6*a)]; },
  /* 逐边内缩 d（凸块可靠；凹块用于内院时先检查结果面积>0） */
  inset(p, d){
    const n = p.length, out = [];
    const A = PC.poly.area(p), s = A >= 0 ? 1 : -1;
    for (let i = 0; i < n; i++){
      const a = p[(i-1+n)%n], b = p[i], c = p[(i+1)%n];
      let n1 = [b[1]-a[1], a[0]-b[0]], n2 = [c[1]-b[1], b[0]-c[0]];
      const l1 = Math.hypot(n1[0],n1[1])||1, l2 = Math.hypot(n2[0],n2[1])||1;
      n1 = [n1[0]/l1*s, n1[1]/l1*s]; n2 = [n2[0]/l2*s, n2[1]/l2*s];
      let bx = n1[0]+n2[0], bz = n1[1]+n2[1];
      const lb = Math.hypot(bx,bz); if (lb < 1e-6) continue;
      const cosH = Math.max(0.34, lb/2);
      out.push([b[0] - bx/lb*d/cosH, b[1] - bz/lb*d/cosH]);
    }
    return out.length >= 3 ? out : null;
  },
  contains(p, x, z){
    let inside = false;
    for (let i = 0, j = p.length-1; i < p.length; j = i++){
      const a = p[i], b = p[j];
      if ((a[1] > z) !== (b[1] > z) &&
          x < (b[0]-a[0]) * (z-a[1]) / (b[1]-a[1]) + a[0]) inside = !inside;
    }
    return inside;
  },
  /* 转成 THREE.Shape（y 分量当 z 用） */
  shape(p){ const s = new THREE.Shape();
    p.forEach((q, i) => i ? s.lineTo(q[0], q[1]) : s.moveTo(q[0], q[1]));
    s.closePath(); return s; },
  /* 水平面片（y 常量），朝上 */
  flat(p, y, uvScale){
    const s = PC.poly.shape(p);
    const g = new THREE.ShapeGeometry(s);
    g.rotateX(-Math.PI/2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, y);
    /* ShapeGeometry 的 uv 是 xy 归一化；换成世界尺度平铺 */
    if (uvScale){ const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++)
        uv.setXY(i, pos.getX(i)*uvScale, pos.getZ(i)*uvScale); }
    g.computeVertexNormals();
    return g;
  }
};

/* ── 模块注册表 ───────────────────────────────────────────────────────
   def = { order:int, async build(ctx), update(ctx,dt), setVisible(v), label:'中文名' }
   order：terrain 10 · water 20 · bridges 30 · facade 40 · shops 50 · furniture 60 */
PC.mod = function(name, def){ PC._mods[name] = Object.assign({name, order: 50}, def); };
PC.has = name => !!PC._mods[name];
PC.get = name => PC._built[name];

PC.buildAll = async function(ctx){
  PC.ctx = ctx;
  ctx.PC = PC;
  ctx.plan = PC.plan;
  ctx.mats = PC.mats();
  ctx.palette = PC.palette;
  ctx.Y = PC.Y;
  const list = Object.values(PC._mods).sort((a, b) => a.order - b.order);
  const report = [];
  for (const m of list){
    const t0 = performance.now();
    try {
      if (ctx.step) ctx.step(m._pct || 0, (m.label || m.name) + ' · 构建中');
      const r = await m.build(ctx);
      PC._built[m.name] = r || true;
      report.push({mod: m.name, ms: Math.round(performance.now() - t0), ok: true});
    } catch (e){
      console.error('[PC] 模块 ' + m.name + ' 构建失败（本层跳过，页面继续）:', e);
      report.push({mod: m.name, ms: Math.round(performance.now() - t0), ok: false, err: String(e && e.message || e)});
    }
  }
  PC.report = report;
  console.log('[PC] 城市层构建报告', report);
  return report;
};

PC.update = function(dt, camPos){
  if (camPos) PC.lod.tick(camPos);
  for (const name in PC._mods){
    const m = PC._mods[name];
    if (!m.update || !PC._built[name]) continue;
    try { m.update(PC.ctx, dt); } catch(e){ /* 帧内静默，不刷屏 */ }
  }
};

PC.setVisible = function(name, v){
  const m = PC._mods[name];
  if (m && m.setVisible) { try { m.setVisible(v); } catch(e){} }
};

})();
