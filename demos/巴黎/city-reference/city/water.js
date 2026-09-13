/* ══════════════════════════════════════════════════════════════════════════
   city/water.js —— 塞纳河：水面 shader · 河堤 quai · 船

   三块内容：
   A 水面   自定义 ShaderMaterial。三层滚动程序法线 + Fresnel 天空反射 +
            太阳镜面波瓣（碎金光带）+ 岸边泡沫带。颜色取 PC.palette 的灰绿褐，
            不是加勒比蓝——塞纳河是不透明的浑水。
   B 河堤   渠化河道的垂直块石挡墙、下层步道 berge、挡墙上的拱形储藏洞口、
            系缆桩与系船铁环、斜坡车道 rampe 与石阶、石栏杆、
            以及压在栏杆上的旧书摊绿箱 bouquinistes。
   C 船     苍蝇船 8 + 小游艇 2 沿河双向巡航（过桥时对准桥孔中心），
            驳船 20 成簇泊岸 + 货驳 2 缓速航行，航行船拖 V 形泡沫尾迹。

   D 个体差异（§0.5）
            河上的泛用件是**种群**不是模板：船、系缆桩、旧书摊绿箱、甲板杂物，
            一件一个样。年龄是隐变量——漆褪、锈重、粗糙度、苔、甲板堆多少东西，
            五样由同一个 age 驱动；抽色从 PC.families 的真实色族里抽；
            用 PC.vary.tail 整形成「多数中等、少数极新或极破」。
            具名构筑物（每一座码头挡墙）形制一点不动，只加「它经历了什么」：
            水线浸渍、背阴段的苔、桥底下的积垢。

   一切位置来自 PC.plan（river / quays / ramps / islands / bridges），本文件不发明坐标。
   高程基准：街面 0 · 下层河岸 −6.6 · 水面 −8.6（PC.Y，不可改）。

   预算与实测见文件末尾的 PC.get('water').budget。
   ══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

const H = (window.P3D && P3D.helpers) || {};
const {GB, clamp, lerp, TAU, mulberry32, makeNoise} = H;

/* ── 颜色派生工具：全部从 PC.palette 出发，不凭感觉写死一个灰 ────────────── */
function chan(h){ return [(h >> 16) & 255, (h >> 8) & 255, h & 255]; }
function hex(r, g, b){ return (Math.round(clamp(r,0,255)) << 16) | (Math.round(clamp(g,0,255)) << 8) | Math.round(clamp(b,0,255)); }
function shade(h, k){ const c = chan(h); return hex(c[0]*k, c[1]*k, c[2]*k); }
function mixHex(a, b, t){ const p = chan(a), q = chan(b);
  return hex(lerp(p[0],q[0],t), lerp(p[1],q[1],t), lerp(p[2],q[2],t)); }

/* ══════════════════ 0.5 个体差异：谁可以变，怎么变 ══════════════════
   河上有两类东西，规矩完全不同：

   · **具名构筑物**（每一座码头挡墙、每一座桥）——形制是唯一正确答案，
     尺寸、砌法、栏杆高度一点不许动。但「它经历了什么」可以也应该有：
     常水位那条水线、背阴段的苔、桥底下的积垢。判据只有一条：
     改的是「它是什么」（不许）还是「它经历了什么」（应该）。

   · **泛用件**（船、系缆桩、旧书摊绿箱、甲板杂物）——它们是种群，
     没有「正确的那一条船」，只有「河上这一批大概长什么样」。种群天然有个体差。

   两条把随机变成岁月的规矩，下面所有函数都守着：
     ① 年龄是隐变量。漆色褪、粗糙度、锈、苔、磨损，五样由同一个 age 驱动，
        不是各随机各的——五样独立随机出来的是塑料玩具。
     ② 长尾。均匀随机会让「每条船都不一样」，读起来还是噪声。用 PC.vary.tail
        整形成「大多数中等、少数特别新或特别破」，一段河岸上才有一两条扎眼的。 */

/* 把长尾整形后的「状态」写回档案。k 越大越集中在「新/标准」那一端。
   返回一份新档案（pick/f 仍指向原来那份位置哈希，所以依旧是确定性的）。 */
function condition(prof, k){
  /* tail(u,2.4)：约 63% 落在前 1/3。底 0.26 是因为塞纳河上没有全新的船，
     常年泡在浑水里，出厂第二年就有水线。 */
  let c = 0.26 + 0.66 * PC.vary.tail(prof.f(61), k === undefined ? 2.4 : k);
  if (prof.f(67) > 0.92) c *= 0.34;                 // 少数派：刚上过漆
  c = clamp(c, 0, 1);
  const o = Object.assign({}, prof);
  o.age   = c;
  o.grime = clamp(prof.grime * (0.45 + 1.30 * c), 0, 1);
  o.wear  = clamp(prof.wear  * (0.45 + 1.30 * c), 0, 1);
  o.moss  = clamp(prof.moss  * (0.35 + 1.45 * c), 0, 1);
  return o;
}

/* 具名构筑物的风化乘子。返回 [r,g,b]，直接喂给 MB.W。
   两支：干墙（上层）与浸水段（水线上下），后者苔与污都加倍。 */
function quayWeather(x, z, batch, brg){
  const p = PC.vary.of('stone', x, z, batch);
  /* RATES.stone 的基准是「一块干燥的石头」——石头老得慢，这是对的，别去改它。
     但河堤是全城最湿的一面墙：常年浸水、桥面排水往下冲、船机油、鸽子。
     直接用 p.grime 只有 0.13–0.23，一条 700m 的墙前后只差 2% 明度，等于没做。
     所以：age 定这条码头的基调（同一条是同一次砌的，同龄），
     空间哈希拉开跨与跨的差距——而且要**平滑**：90m 一块大patch + 26m 的细纹。
     纯逐跨随机会做出棋盘格，那是噪声不是污渍。 */
  const lvl = clamp(0.25 + p.age * 1.9, 0, 1);
  const sm = (a, b, s) => PC.hash2(Math.round(x / a), Math.round(z / a), s) * 0.68
                        + PC.hash2(Math.round(x / b), Math.round(z / b), s + 4) * 0.32;
  let g = clamp(lvl * (0.45 + 1.05 * sm(90, 26, 37)), 0, 1);
  let m = clamp(lvl * (0.10 + 1.25 * sm(120, 34, 71)) * (0.35 + 0.85 * p.riverside), 0, 1);
  /* 桥底下与桥台：终年不见直射光、桥面排水全往下冲，是全河最脏的几十米 */
  if (brg) for (let i = 0; i < brg.length; i++){
    const d = Math.hypot(brg[i].x - x, brg[i].z - z);
    if (d < 95){ const k = 1 - d / 95; g = clamp(g + k * 0.45, 0, 1); m = clamp(m + k * 0.32, 0, 1); }
  }
  const dry = [(1 - g * 0.22) * (1 - m * 0.10),
               (1 - g * 0.19) * (1 + m * 0.06),
               (1 - g * 0.27) * (1 - m * 0.18)];
  const gw = clamp(g * 1.25 + 0.12, 0, 1), mw = clamp(m * 1.75 + 0.16, 0, 1);
  const wet = [(1 - gw * 0.30) * (1 - mw * 0.20),
               (1 - gw * 0.25) * (1 + mw * 0.07),
               (1 - gw * 0.36) * (1 - mw * 0.32)];
  /* 水线不是一条尺子画出来的直线：涨水退水、朝向、遮挡，让污渍的上沿一段高一段低。
     墙的分带高度是几何定死的（形制不许动），能动的是「这一跨的污算到第几带」。 */
  const wetTop = PC.Y.water + 2.2 + (PC.hash2(x, z, 83) - 0.42) * 3.4;
  return {dry, wet, wetTop};
}

/* ══════════════════ 0. 尺寸常量（有出处的都标了出处） ══════════════════ */
const C = {
  /* 水面网格 */
  waterStep:   15,     // 纵向 15m 一段（任务书）
  waterCols:   6,      // 每条水道 6 段；断面恒定三条水道 → 全断面 18 段
  bankBite:    1.0,    // 水面向陆地多伸 1m，塞进挡墙脚下，防缝
  isleBite:    6.0,    // 水面向岛下多伸 6m：岛岸墙脚与岛尖都靠它盖住

  /* 河堤 */
  bergeMin:    5,  bergeMax: 16,     // 下层步道宽度夹紧（plan 的 bergeW 是估值，8–26）
  bergeIsleMax: 8,
  bedY:        -11.4,                // 挡墙脚，埋在水下看不见
  parapetH:    0.95, parapetT: 0.42, // 上层石栏杆（mur bahut）
  capW:        1.6,                  // 栏杆内侧压顶条，盖住与 terrain 的缝
  bayMax:      28,                   // 墙面单跨最长（超过就分段，跟着岸线走）
  revet:       0.85,                 // 水线到步道那 2m 的收分（斜坡石 revêtement）

  /* 拱形储藏洞口（真实位置未采集，seine.json 注明「按 20–30m 程序化排布即可」）。
     开口 2.90m 宽 / 券顶离步道 3.50m —— 真实 quai 的储藏拱洞就是这个量级，
     原来的 1.6m 宽在贴脸机位上读不出「洞」，只剩一道竖缝。 */
  nicheStep:   52, nicheHW: 1.45, nicheSill: 0.10, nicheSpring: 2.05, nicheDepth: 1.25,
  nicheSeg:    5,

  /* 斜坡车道 / 石阶 */
  rampLen:     48, rampW: 6.5,       // 6.6m 落差 / 48m ≈ 13.7%，与实景陡度相当
  stairRun:    0.40, stairRise: 0.30, stairW: 2.6,

  /* 旧书摊 bouquinistes（streetlife.md §11，法定规格） */
  bqLen: 2.00, bqDepth: 0.75, bqHiRiver: 0.60, bqHiStreet: 0.35,
  bqGap: 0.20, bqStall: 8.60,        // 一摊 4 箱、箱间 0.20、总长 8.60
  bqFill: 0.46,                      // 占位率——落到全城 ≈900 只箱，与实况一致

  /* 船 */
  mouche: {L: 38.0, B: 6.0, free: 1.05, canopy: 2.15, rail: 0.85},  // 苍蝇船
  vedetteScale: 0.58,                                              // 小游艇 ≈22m
  peniche: {L: 38.5, B: 5.05, free: 1.55, hold: 0.55},             // Freycinet 标准
  mouchSpeed: 4.0, cargoSpeed: 2.4,
  laneMinW: 34,                      // 汊窄于此就不走（小汊只有 27m，游船实际走大汊）
  tMin: 0.035, tMax: 0.962,

  /* 数量：河长 7.0km。9 条游船是每 780m 一条，等于「一眼望去空无一船」。
     10 条游船 + 18 条成组泊船 + 2 条货驳 ≈ 每 230m 一条，常见机位里能同时收进 2–4 条。 */
  nTour: 10, nVedette: 2,            // 其中 2 条是小游艇
  nMoored: 20, nCargo: 2,
  tourWarp: 0.085,                   // >0：把游船往市中心那段压密（两端稀）
  berthStep: 46,                     // 泊位间距：38.5m 船身 + 7.5m 空档 = 连着停
  groupMin: 3, groupMax: 5,          // 一簇 3–5 条
  groupSep: 255,                     // 簇与簇至少隔这么远
  nHomeMax: 9, nBarMax: 4,           // 池上限（住家船/餐吧不会超过这个数，多留就是白占三角）
  bridgeKeep: 46,                    // 桥墩底下不泊船

  /* 尾迹 */
  wakeSeg: 16, wakeStep: 8.0,        // 16 段 × 8m = 128m，比船身长三倍
  gateArc: 240                       // 距桥多少米开始往桥孔中心偏（越长越舒缓）
};

/* vert wagon 车厢绿：1900 年市政强制的旧书摊漆色。
   RAL Design 170 20 20 的两个公开换算 #003527 / #133E35 取中值（streetlife.md §11）。
   PC.palette.parisGreen 是为渲染亮化过的版本，从河上看会跳出来，所以压深。
   四支深浅收在 PC.families.bouquiniste 里——法定的是「这个绿」，不是「这一桶漆」，
   各摊补漆的年份不同，同一条岸上本来就有深有浅。 */

/* ══════════════════ 1. 带顶点色的几何构建器 ══════════════════
   GB 不管顶点色，而挡墙需要「洞口内壁暗、水线处发绿发黑」这两层调制。
   包一层：col() 之后新增的顶点都吃这个色，build 时再叠一遍按高度的水线调制。 */
class MB {
  /* W 是「这一段构筑物经历了什么」的乘子（积垢 / 苔绿 / 水线浸渍），
     由调用方按世界坐标逐跨换掉。形制不变、只改风化——所以它挂在 col() 上，
     三十来处 col() 调用一行都不用动。 */
  constructor(){ this.g = new GB(); this.C = []; this.cur = [1, 1, 1]; this.W = [1, 1, 1]; }
  col(r, g, b){ this.raw = [r, g, b];
    this.cur = [r * this.W[0], g * this.W[1], b * this.W[2]]; return this; }
  /* 换了 W 之后原样重刷一遍当前色（挡墙分带时用：同一面墙、水线上下不同风化） */
  recol(){ const c = this.raw || [1,1,1]; return this.col(c[0], c[1], c[2]); }
  _sync(){ const need = this.g.n * 3;
    while (this.C.length < need){ this.C.push(this.cur[0], this.cur[1], this.cur[2]); } }
  face(pts, s){ this.g.face(pts, s); this._sync(); return this; }
  box(cx, cy, cz, sx, sy, sz, s){ this.g.box(cx, cy, cz, sx, sy, sz, s); this._sync(); return this; }
  cyl(cx, cy, cz, r0, r1, h, seg, s, caps){
    this.g.cyl(cx, cy, cz, r0, r1, h, seg, s, caps); this._sync(); return this; }
  /* 自带 uv 的四边形，法线强制朝 out 方向。
     为什么不能用 GB.face 来砌堤墙：它把 uv 原点放在每一块面自己的第一个顶点上，
     再拿这块面的第一条边当 u 轴。于是每一跨墙的石缝都从 0 重新起算——跨长 28m、
     贴图一格 4.4m，永远对不齐，跨与跨之间就是一道硬竖缝，两侧明度也各不相同，
     整条河岸读起来像补丁拼的。更糟的是绕序一被纠正，u/v 会整体互换，
     砌层从横的变成竖的（实测左岸整段砌层是竖着的）。
     堤墙是一条几百米长的连续砌体，uv 必须由沿岸弧长/进深/高程统一给出。 */
  quadT(p0, p1, p2, p3, out, t0, t1, t2, t3){
    const ux = p1[0]-p0[0], uy = p1[1]-p0[1], uz = p1[2]-p0[2];
    const vx = p3[0]-p0[0], vy = p3[1]-p0[1], vz = p3[2]-p0[2];
    let nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
    const L = Math.hypot(nx, ny, nz);
    if (!(L > 1e-9)) return this;                     // 退化面（跨长 0 / 高度 0）直接丢
    nx /= L; ny /= L; nz /= L;
    let P = [p0, p1, p2, p3], T = [t0, t1, t2, t3];
    if (nx*out[0] + ny*out[1] + nz*out[2] < 0){
      nx = -nx; ny = -ny; nz = -nz;
      P = [p0, p3, p2, p1]; T = [t0, t3, t2, t1];     // 翻绕序，uv 跟着走，不互换轴
    }
    const id = [];
    for (let i = 0; i < 4; i++)
      id.push(this.g.v(P[i][0], P[i][1], P[i][2], nx, ny, nz, T[i][0], T[i][1]));
    this.g.quad(id[0], id[1], id[2], id[3]);
    this._sync();
    return this;
  }
  get tris(){ return this.g.I.length / 3; }
  /* waterTint(y) —— 水线调制：越靠近水面越脏越绿越暗 */
  build(waterTint){
    const geo = this.g.build();
    const pos = geo.attributes.position, n = pos.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++){
      const k = waterTint(pos.getY(i));
      arr[i*3]   = (this.C[i*3]     || 1) * k[0];
      arr[i*3+1] = (this.C[i*3+1]   || 1) * k[1];
      arr[i*3+2] = (this.C[i*3+2]   || 1) * k[2];
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  }
}

/* ══════════════════ 2. 程序贴图 ══════════════════ */

/* 2.1 可平铺水面法线：三层不同拉伸比的梯度噪声，rg = 坡度，b = 高度（给泡沫用）
   makeNoise(seed,P) 的场以 P 为周期，所以取样跨度必须是 P 的整数倍才无缝。 */
function makeRippleCanvas(size){
  const c = PC.canvas(size, size), g = c.getContext('2d');
  const img = g.createImageData(size, size), d = img.data;
  const n1 = makeNoise(7331, 8), n2 = makeNoise(9173, 16), n3 = makeNoise(2617, 16);
  const Hf = new Float32Array(size * size);
  for (let y = 0; y < size; y++){
    const v = y / size;
    for (let x = 0; x < size; x++){
      const u = x / size;
      /* 三层：大浪沿 u 拉长 2:1，中浪，细波纹 */
      Hf[y*size + x] = n1(u*8, v*16) * 0.62 + n2(u*32, v*16) * 0.26 + n3(u*48, v*32) * 0.12;
    }
  }
  const STR = 3.4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++){
    const xp = (x+1) % size, xm = (x+size-1) % size, yp = (y+1) % size, ym = (y+size-1) % size;
    const dx = (Hf[y*size+xp] - Hf[y*size+xm]) * 0.5;
    const dy = (Hf[yp*size+x] - Hf[ym*size+x]) * 0.5;
    const i = (y*size + x) * 4;
    d[i]   = clamp(dx * STR * 127 + 128, 0, 255);
    d[i+1] = clamp(dy * STR * 127 + 128, 0, 255);
    d[i+2] = clamp((Hf[y*size+x] * 0.9 + 0.5) * 255, 0, 255);
    d[i+3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/* 2.2 河堤块石：一张 4.4m × 4.4m 可平铺单元（8 皮，皮高 0.55m），出 albedo + normal
   缝要看得见——这是「渠化河道」最主要的近景信息。 */
let QUAI_TEX = null;
function quaiTextures(){
  if (QUAI_TEX) return QUAI_TEX;
  const S = 512, COURSES = 8, ch = S / COURSES;
  const rnd = mulberry32(51823);
  const id = new Int32Array(S * S), tone = [];
  let cur = 0;
  for (let r = 0; r < COURSES; r++){
    const y0 = r * ch, y1 = (r + 1) * ch;
    let x = -Math.round(rnd() * 110);
    while (x < S){
      const w = Math.round(78 + rnd() * 74);          // 1.1–1.9m 长的块石
      /* 块间明度抖动别拉太开——±17% 会让墙读成拼贴的大格子，砌体感反而没了 */
      tone.push(0.90 + rnd() * 0.17);
      for (let y = y0; y < y1; y++)
        for (let k = 0; k < w; k++){ const px = ((x + k) % S + S) % S; id[y*S + px] = cur; }
      x += w; cur++;
    }
  }
  /* 缝距场：到最近异号像素的距离（3px 内），做凹缝 */
  const Hf = new Float32Array(S * S);
  const fine = makeNoise(4409, 64);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
    const me = id[y*S + x];
    let dmin = 9;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++){
      const yy = (y + dy + S) % S, xx = (x + dx + S) % S;
      if (id[yy*S + xx] !== me){ const dd = Math.hypot(dx, dy); if (dd < dmin) dmin = dd; }
    }
    const joint = clamp(1 - dmin / 2.6, 0, 1);        // 1=缝心
    Hf[y*S + x] = 1 - joint * 0.88 + fine(x/S*64, y/S*64) * 0.10;
  }
  const base = chan(PC.palette.quaiStone);
  const cA = PC.canvas(S, S), gA = cA.getContext('2d');
  const cN = PC.canvas(S, S), gN = cN.getContext('2d');
  const iA = gA.createImageData(S, S), iN = gN.createImageData(S, S);
  const NSTR = 2.6;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
    const i = (y*S + x) * 4, h = Hf[y*S + x], t = tone[id[y*S + x]] || 1;
    const k = t * (0.60 + 0.40 * h);
    iA.data[i] = base[0]*k; iA.data[i+1] = base[1]*k; iA.data[i+2] = base[2]*k; iA.data[i+3] = 255;
    const xp = (x+1)%S, xm = (x+S-1)%S, yp = (y+1)%S, ym = (y+S-1)%S;
    const dx = (Hf[y*S+xp] - Hf[y*S+xm]) * 0.5, dy = (Hf[yp*S+x] - Hf[ym*S+x]) * 0.5;
    iN.data[i]   = clamp(-dx * NSTR * 127 + 128, 0, 255);
    iN.data[i+1] = clamp(-dy * NSTR * 127 + 128, 0, 255);
    iN.data[i+2] = 235; iN.data[i+3] = 255;
  }
  gA.putImageData(iA, 0, 0); gN.putImageData(iN, 0, 0);
  const map = PC.texture(cA, {repeat: [1, 1], srgb: true, aniso: 8});
  const nrm = PC.texture(cN, {repeat: [1, 1], aniso: 8});
  return (QUAI_TEX = {map, nrm, tile: 4.4});
}

/* ══════════════════ 3. 水面 shader ══════════════════ */
/* 水面接阴影：桥和船不在水上投影，近景看船就是一张贴纸。
   ShaderMaterial 想吃 shadow map，要三样东西齐：uniforms 里并进 UniformsLib.lights、
   材质 lights:true、以及顶点着色器里给 shadowmap_vertex 备好它要的两个变量
   （worldPosition、transformedNormal）。水面是一张水平面，法线恒为 +Y。 */
const WATER_VS = `
attribute float aShore;
varying vec3 vWorld;
varying float vShore;
varying vec2 vRiver;
#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
void main(){
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorld = worldPosition.xyz;
  vShore = aShore;
  vRiver = uv;
  vec3 objectNormal = vec3(0.0, 1.0, 0.0);
  vec3 transformedNormal = normalize(normalMatrix * objectNormal);
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
  #include <shadowmap_vertex>
}`;

const WATER_FS = `
uniform float uTime;
uniform vec3  uSun;         // 归一化太阳方向
uniform vec3  uSunCol;
uniform float uSpecK;       // 低太阳时把高光推上去
uniform vec3  uDeep, uShallow, uFoam;
uniform sampler2D uNrm;
uniform sampler2D uEnv;     // 等距柱状天空（scene.background）
uniform float uEnvOn;
uniform sampler2D uRefl;    // 平面反射 RT（只装贴着水的那几层，天空仍走 uEnv）
uniform mat4  uReflMat;     // bias · P · V（镜像相机），把世界点投回 RT 的 uv
uniform float uReflOn;
varying vec3 vWorld;
varying float vShore;
varying vec2 vRiver;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <shadowmap_pars_fragment>

vec3 s2l(vec3 c){ return c * c * (c * 0.305306011 + 0.682171111) + c * 0.012522878; }
vec2 slope(vec2 uv){ return texture2D(uNrm, uv).rg * 2.0 - 1.0; }
float hgt(vec2 uv){ return texture2D(uNrm, uv).b; }

void main(){
  vec3 V = normalize(cameraPosition - vWorld);
  float t = uTime;

  /* ── 三层滚动法线：不同尺度 / 方向 / 速度 ──
     前两层挂世界坐标（稳定不拉伸），第三层挂河道坐标（顺流方向随河弯） */
  vec2 w = vWorld.xz;
  vec2 s1 = slope(w * 0.0115 + vec2(-0.0062, 0.0021) * t) * 1.00;
  vec2 s2 = slope(w * 0.0430 + vec2( 0.0128,-0.0086) * t) * 0.52;
  /* 第三层也挂世界坐标。挂过河道坐标（vRiver）——顺流方向更好看，
     但两幅半带在中线相接处 uv 的屏幕导数不连续，GPU 会跳一级 mip，
     整条河中线上就出现一道发暗的接缝。世界坐标没有这个问题。 */
  vec2 s3 = slope(w * 0.1450 + vec2( 0.0180,-0.0125) * t) * 0.30;
  vec2 sl  = s1 + s2 + s3;
  vec2 slF = s2 * 1.5 + s3 * 2.3;        // 细法线：专管碎金
  vec2 slG = s3 * 4.2;                   // 极细：专管闪点

  vec3 N  = normalize(vec3(-sl.x  * 0.80, 1.0, -sl.y  * 0.80));
  vec3 Nf = normalize(vec3(-slF.x * 1.10, 1.0, -slF.y * 1.10));
  vec3 Ng = normalize(vec3(-slG.x * 1.35, 1.0, -slG.y * 1.35));

  /* ── 深浅水色：塞纳河是不透明的灰绿褐，靠岸略浅略浑 ──
     水体本色在线性空间里很暗（0x3c4a44 ≈ 0.05），不提亮的话画面会被天空反射
     整个吃掉，水就变成加勒比蓝。这里把本色抬起来，让「浑」压得住「映」。 */
  float shoreT = smoothstep(0.0, 34.0, vShore);
  float silt   = hgt(w * 0.0032 + vec2(0.0009, 0.0) * t);
  vec3 base = mix(s2l(uShallow), s2l(uDeep), shoreT) * (0.86 + 0.34 * silt) * 1.34;

  /* 近岸暗带：8.6m 高的挡墙把天光挡掉大半，紧贴墙脚那条水本来就该是全河最深的一条。
     原来从中线到墙脚一个亮度，读起来就是一层薄荷绿涂料。 */
  float wallOcc = mix(0.52, 1.0, smoothstep(0.0, 30.0, vShore));

  /* ── 阴影：桥腹、船体、堤墙投在水上的那块暗 ──
     水是镜面加浑体，影里的水不会变黑，只是「少了直射那一份」——所以影响的是
     太阳侧的漫射提亮和整条碎金光带，天光与倒影照给。 */
  float shadow = 1.0;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    DirectionalLightShadow dsh = directionalLightShadows[ 0 ];
    shadow = getShadow( directionalShadowMap[ 0 ], dsh.shadowMapSize, dsh.shadowBias,
                        dsh.shadowRadius, vDirectionalShadowCoord[ 0 ] );
  #endif

  /* 天光漫射 + 一点太阳侧的提亮（浑水的次表面） */
  float sunUp = smoothstep(-0.02, 0.14, uSun.y);
  vec3 amb = vec3(0.62 + 0.38 * sunUp);
  base *= amb * (0.84 + 0.34 * max(dot(N, normalize(uSun)), 0.0) * shadow) * wallOcc
        * mix(0.74, 1.0, shadow);

  /* ── Fresnel：掠射反天空，正视是深水色 ── */
  float ndv = max(dot(N, V), 0.0);
  float F = 0.022 + 0.978 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N);
  R.y = max(R.y, 0.015);
  vec2 euv = vec2(atan(R.z, R.x) * 0.15915494 + 0.5, asin(clamp(R.y, -1.0, 1.0)) * 0.31830989 + 0.5);
  /* uEnv 是本模块自己烤的低分辨率等距柱状天空，且关掉了 mipmap。
     直接采 scene.background 会在「反射方位角 = ±180°」那条线上炸出一道暗缝：
     atan() 在那里跳变，屏幕导数瞬间变成整张图宽，GPU 掉到最粗一级 mip。
     实测那道缝会沿河心一路铺到天际线。 */
  vec3 sky = mix(vec3(0.30, 0.33, 0.34), s2l(texture2D(uEnv, euv).rgb), uEnvOn);
  /* 反射被浑水染一层灰绿并压暗——不做这一步，倒影会比真实的塞纳河干净得多，
     掠射角下整条河会读成一面白亮的镜子 */
  sky *= vec3(0.37, 0.40, 0.34) * wallOcc;   // 墙脚那条水连天空都被墙挡掉

  /* ── 平面反射：把岸墙、桥体、船体真正映进水里 ──
     uRefl 是镜像相机烤的一张 1/2.5 分辨率 RT，只装贴着水的那几层，alpha=覆盖率；
     没覆盖到的地方（天空、画面外）退回上面那张等距柱状天空。
     为什么不做 SSR：低机位下要反射的恰恰是屏幕上根本没被画出来的墙身，
     屏幕空间里没有那份数据，SSR 只会给出一片拉丝。 */
  vec3 env = sky;
  if (uReflOn > 0.5){
    vec4 rp = uReflMat * vec4(vWorld, 1.0);
    if (rp.w > 0.0001){
      vec2 ruv = rp.xy / rp.w;
      /* 涟漪扰动按距离收敛：远处一个像素装着几十道波，抖大了倒影会碎成噪点 */
      ruv += sl * (0.034 / (1.0 + length(cameraPosition - vWorld) * 0.012));
      vec2 ein = step(vec2(0.0), ruv) * step(ruv, vec2(1.0));
      vec4 rc = texture2D(uRefl, ruv);
      /* 倒影同样被浑水染一层灰绿压暗，但留得比天空亮些——
         不然被阳光照亮的堤墙映下来还是看不见 */
      env = mix(sky, rc.rgb * vec3(0.72, 0.74, 0.63), clamp(rc.a, 0.0, 1.0) * ein.x * ein.y);
    }
  }

  vec3 col = mix(base, env, F * 0.66);

  /* ── 太阳镜面波瓣：碎金光带。三层叠加——
     锐高光给日盘倒影，中频给碎金，极细给闪点。法线扰动把它们打碎成一片。 ── */
  vec3 L = normalize(uSun);
  vec3 Hv = normalize(L + V);
  float sp1 = pow(max(dot(N,  Hv), 0.0), 380.0) * 4.2;
  float sp2 = pow(max(dot(Nf, Hv), 0.0),  70.0) * 1.35;
  float sp3 = pow(max(dot(Nf, Hv), 0.0),  14.0) * 0.07;
  float sp4 = pow(max(dot(Ng, Hv), 0.0), 760.0) * 26.0;
  /* 碎金的真正来源：远处一个像素里装着几十道波，法线贴图 mip 一平均，
     高光就糊成一条连续的银带。这里补一层「按屏幕尺度定格的闪点」——
     格子随距离等比放大，保证在画面上永远是 2–3px 的颗粒，不会糊掉也不会闪烁。 */
  float dcam = length(cameraPosition - vWorld);
  float cell = max(0.34, dcam * 0.0026);
  vec2 gp = w / cell, gc = floor(gp);
  float gl0 = fract(sin(dot(gc, vec2(12.9898, 78.233))) * 43758.5453);
  float gl1 = fract(sin(dot(gc + 0.5, vec2(39.3468, 11.135))) * 24634.6345);
  float dotk = smoothstep(0.55, 0.10, length(fract(gp) - 0.5));   // 圆点，不要方格
  float glit = step(0.72, gl0) * (0.40 + 0.60 * gl1) * dotk;
  /* 不是「另加一层闪点」，而是拿闪点场去调制整条高光带：
     光带的形状仍由 Blinn-Phong 决定，但被打成一片碎点，这才是碎金的样子。 */
  float grain = 0.55 + 1.30 * glit;
  /* 碎金光带整条吃阴影：桥影里那一段水必须是没有高光的，不然影子读不出来 */
  col += uSunCol * (sp1 + sp2 + sp3 + sp4) * grain * sunUp * uSpecK * shadow;

  /* ── 岸边泡沫带：窄一条、碎一点，不要拉出一圈雪线 ── */
  float fw = 1.0 - smoothstep(0.0, 3.0, vShore);
  float rip = hgt(w * 0.30 + vec2(0.052, -0.034) * t) * 0.65
            + hgt(w * 0.11 + vec2(-0.021, 0.017) * t) * 0.45;
  /* 泡沫也吃 wallOcc：墙脚是背光的，那条线不该比水面本身还白 */
  float foam = smoothstep(0.52, 1.02, fw * (0.34 + 1.05 * rip));
  col = mix(col, s2l(uFoam) * (0.40 + 0.42 * sunUp) * wallOcc, foam * 0.34);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/* ══════════════════ 4. 模块状态 ══════════════════ */
let ROOT = null, waterMat = null, waterMesh = null;
let boats = [], tourPool = null, glassPool = null, penPool = null,
    homePool = null, barPool = null, awnPool = null, bulbPool = null,
    clutBoxPool = null, clutCylPool = null, wake = null, wakeGeo = null;
let moorPool = null, moorSpots = null;
const BUDGET = {};
let TIME = 0;

/* ── 反射天空：本模块自备一张 256×128、无 mipmap、横向 Repeat 的等距柱状图 ──
   为什么不直接用 scene.background / scene.environment：
   ① background 是 1024² CanvasTexture，默认 ClampToEdge + 开 mipmap。水面 shader 用
      atan() 反解方位角，在 ±180° 那条线上 uv 跳变，屏幕导数被算成整张图宽，
      GPU 掉到最粗一级 mip —— 实测会沿河心拉出一道贯穿到天际线的暗缝。
   ② environment 是 PMREM 的 cubeUV 打包图，裸 sampler2D 采不了。
   低分辨率反而更对：粗糙水面本来就该反射一个糊掉的天空。 */
const REFL = {tex: null, dir: [0, 0, 0], t: -1e9};
function refreshReflSky(ctx, d){
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  const dot = d[0]*REFL.dir[0] + d[1]*REFL.dir[1] + d[2]*REFL.dir[2];
  if (REFL.tex && dot > 0.99997) return;
  if (REFL.tex && now - REFL.t < 0.35) return;   // 时刻连续变化时限流，别每帧重烤
  const c = H.makeSky(256, 128, d);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  const old = REFL.tex;
  REFL.tex = t; REFL.dir = [d[0], d[1], d[2]]; REFL.t = now;
  if (old) old.dispose();
}

/* ══════════════════ 4.5 平面反射（岸墙 / 桥 / 船映进水里） ══════════════════
   水面是一张严格的水平面（y = PC.Y.water），planar reflection 是最省的正解：
   主相机对水面取镜像 → 只把「贴着水的那几层」渲进一张 1/2.5 分辨率的 RT →
   水面 shader 用同一台镜像相机的投影矩阵把它投回来。

   四处非默认设置，每处都是有原因的：
   ① 只开 RFL_LAYER 这一层，走 camera.layers 过滤。岸墙 1 个 mesh、船 5 个池、
      桥 1 组——不是全城重画一遍，多出来的是十几个 draw call，不是一倍。
   ② 渲染 RT 时关掉 toneMapping。RT 的 outputEncoding 本来就是线性的，
      色调映射若留着，水面 shader 末尾那一遍 tonemapping_fragment 会做第二次，
      倒影会被压成一片灰。
   ③ 挂一块 y ≥ 水面 的裁剪面。挡墙从 −11.4 一路砌上来，水下那截若进了倒影，
      会顶在倒影的最上沿——看起来就是墙在水里长出了第二段。
   ④ 关 shadowMap.autoUpdate。用主渲染上一帧烤好的 shadow map，不多烤一遍。 */
const RFL_LAYER = 9;
const RFL = {rt: null, cam: null, mat: null, bias: null, plane: null,
             v: null, up: null, tgt: null, size: null, cc: null,
             w: 0, h: 0, dead: false, tagN: 0, passes: 0};
function reflInit(THREE){
  RFL.cam = new THREE.PerspectiveCamera();
  RFL.cam.layers.set(RFL_LAYER);
  RFL.mat  = new THREE.Matrix4();
  RFL.bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5,  0, 0.5, 0, 0.5,
                                     0, 0, 0.5, 0.5,  0, 0, 0, 1);
  RFL.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PC.Y.water);
  RFL.v = new THREE.Vector3(); RFL.up = new THREE.Vector3(); RFL.tgt = new THREE.Vector3();
  RFL.size = new THREE.Vector2(); RFL.cc = new THREE.Color();
}
/* 打层：只置 layer 位，layer 0 原样保留，主渲染与别的模块一行都不受影响。
   跑两次是因为 paris.html 的太阳灯建在 buildAll 之后——灯不在反射相机的
   层里，反射 pass 会渲出一片全黑。 */
function reflTag(ctx){
  if (RFL.tagN > 1) return;
  RFL.tagN++;
  const mark = o => o && o.traverse(c => {
    if (c.isMesh || c.isLight) c.layers.enable(RFL_LAYER); });
  if (ROOT) for (const c of ROOT.children) if (c !== waterMesh && c !== wake) mark(c);
  const sc = ctx.scene;
  if (!sc) return;
  mark(sc.getObjectByName('bridges'));                        // 审查要求：桥体也要有倒影
  sc.traverse(o => { if (o.isLight) o.layers.enable(RFL_LAYER); });
}
function reflRender(ctx){
  const {THREE, renderer, camera, scene} = ctx;
  if (RFL.dead || !renderer || !camera || !scene) return false;
  const Y = PC.Y.water;
  /* 相机在水下、或高到俯瞰全城时不做：前者物理上没这一层，
     后者视线近乎垂直、倒影里只剩天空，不值一次 pass。 */
  if (camera.position.y < Y + 1.0 || camera.position.y > 900) return false;
  try {
    if (!RFL.cam) reflInit(THREE);
    renderer.getDrawingBufferSize(RFL.size);
    const w = Math.round(clamp(RFL.size.x * 0.50, 360, 1000));
    const h = Math.max(180, Math.round(w * RFL.size.y / Math.max(1, RFL.size.x)));
    if (!RFL.rt || RFL.w !== w || RFL.h !== h){
      if (RFL.rt) RFL.rt.dispose();
      RFL.rt = new THREE.WebGLRenderTarget(w, h, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat, type: THREE.HalfFloatType,
        depthBuffer: true, stencilBuffer: false, generateMipmaps: false
      });
      RFL.w = w; RFL.h = h;
    }
    /* 镜像相机：位置 / 视线 / up 全对 y=水面 取镜像，再用 lookAt 组回一个右手系。
       出来的图是左右翻的——正好被同一台相机的投影矩阵在采样时翻回去
       （THREE.Reflector 的老办法，省一次显式的 handedness 翻转）。 */
    const rc = RFL.cam;
    rc.fov = camera.fov; rc.aspect = w / h;
    rc.near = camera.near; rc.far = camera.far;
    rc.updateProjectionMatrix();
    rc.position.set(camera.position.x, 2 * Y - camera.position.y, camera.position.z);
    RFL.v.set(0, 0, -1).applyQuaternion(camera.quaternion);
    RFL.tgt.set(camera.position.x + RFL.v.x * 200,
                2 * Y - (camera.position.y + RFL.v.y * 200),
                camera.position.z + RFL.v.z * 200);
    RFL.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    rc.up.set(RFL.up.x, -RFL.up.y, RFL.up.z);
    rc.lookAt(RFL.tgt);
    rc.updateMatrixWorld();
    RFL.mat.copy(RFL.bias).multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);

    const oTone = renderer.toneMapping, oClip = renderer.clippingPlanes,
          oAuto = renderer.shadowMap.autoUpdate, oNeed = renderer.shadowMap.needsUpdate,
          oBg = scene.background, oAlpha = renderer.getClearAlpha();
    renderer.getClearColor(RFL.cc);
    try {
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.clippingPlanes = [RFL.plane];
      renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
      scene.background = null;                 // RT 里只要物体，天空仍走 shader 里那张图
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(RFL.rt);
      renderer.render(scene, rc);
    } finally {
      renderer.setRenderTarget(null);
      renderer.toneMapping = oTone;
      renderer.clippingPlanes = oClip;
      renderer.shadowMap.autoUpdate = oAuto; renderer.shadowMap.needsUpdate = oNeed;
      scene.background = oBg;
      renderer.setClearColor(RFL.cc, oAlpha);
    }
    RFL.passes++;
    return true;
  } catch(e){
    RFL.dead = true;
    console.warn('[water] 平面反射不可用，回落到只反天空：', e);
    return false;
  }
}

/* ══════════════════ 5. 水面构建 ══════════════════ */
function buildWaterSurface(ctx){
  const {THREE, scene, plan} = ctx, Y = PC.Y, riv = plan.river;
  const NS = Math.max(8, Math.round(riv.len / C.waterStep)) + 1;

  /* 逐站取真实岸线断面。banks() 是按 25m 站号返回的分段常量，
     而且岛的求交在岛尖处会漏拍（实测 t≈0.14 一站从 −105 跳到 −22），
     所以先中值滤波去毛刺，再做一次箱式平滑。 */
  const br = new Float64Array(NS), bl = new Float64Array(NS),
        ir = new Float64Array(NS), il = new Float64Array(NS);
  for (let i = 0; i < NS; i++){
    const b = riv.banks(i / (NS - 1));
    br[i] = b.br; bl[i] = b.bl;
    ir[i] = b.isl ? b.isl[0] : 0; il[i] = b.isl ? b.isl[1] : 0;
  }
  const med5 = a => { const o = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++){ const s = [];
      for (let k = -2; k <= 2; k++) s.push(a[clamp(i+k, 0, a.length-1)]);
      s.sort((p, q) => p - q); o[i] = s[2]; } return o; };
  const box5 = a => { const o = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++){ let s = 0;
      for (let k = -2; k <= 2; k++) s += a[clamp(i+k, 0, a.length-1)];
      o[i] = s / 5; } return o; };
  const R = box5(box5(med5(br))), Lb = box5(box5(med5(bl)));

  /* 岛的挖除不用 banks().isl —— 那是沿断面射线打岛轮廓求交，
     在岛尖处射线几乎与岸线相切，交点会飞出去几十米，结果水面从岛尖两侧
     整片退开，露出一圈悬空的岛岸墙（全景图上是两个「箭头」）。
     改成从两岸各自往河心步进、拿真实岛多边形做点包含测试，第一次踩到岛就是水边。 */
  const isles = (plan.islands || []).filter(o => o && o.poly && o.poly.length > 2)
    .map(o => ({p: o.poly, bb: o.bb}));
  const inIsle = (x, z) => {
    for (const s of isles){
      const b = s.bb;
      if (x < b[0] - 1 || x > b[2] + 1 || z < b[1] - 1 || z > b[3] + 1) continue;
      if (PC.poly.contains(s.p, x, z)) return true;
    }
    return false;
  };
  /* 逐站沿断面扫一遍，得到这一段河的全部「水区间」。
     两岛并存的断面会扫出三段：大汊 / 圣路易汊 / 小汊 ——
     只按「一个岛」建模的话，西岱岛与圣路易岛之间那条 Bras Saint-Louis 会整条消失。 */
  const MSTEP = 3;
  const RAW = [];                       // 每站 {lo, hi, sp}，sp 是未加咬合量的真实水区间
  for (let i = 0; i < NS; i++){
    const a = riv.at(i / (NS - 1));
    const lo = R[i] + 1, hi = Lb[i] - 1;
    let sp = [];
    let open = lo, inside = false;
    for (let off = lo; off <= hi; off += MSTEP){
      const ins = inIsle(a.x + a.nx * off, a.z + a.nz * off);
      if (ins && !inside){ if (off - open > 6) sp.push([open, off]); inside = true; }
      else if (!ins && inside){ open = off; inside = false; }
    }
    if (!inside && hi - open > 6) sp.push([open, hi]);
    if (!sp.length) sp.push([lo, hi]);
    /* 三段以上（断面斜切两岛的交汇处偶发）：留头尾，中间取最宽的一段 */
    if (sp.length > 3){
      let k = 1, w = -1;
      for (let j = 1; j < sp.length - 1; j++){
        const q = sp[j][1] - sp[j][0]; if (q > w){ w = q; k = j; }
      }
      sp = [sp[0], sp[k], sp[sp.length - 1]];
    }
    RAW.push({lo, hi, sp});
  }

  /* ── 断面 → 恒定三条水道 ─────────────────────────────────────────────
     旧实现按「右幅 + 左幅 + 若干中汊」拼条带，条带随分汊数出现和消失；
     出现／消失的那一站，前后两条带的边缘对不上，岛尖处就被撕出楔形空洞
     （实测西岱岛与圣路易岛交汇的 t≈0.126 与 t≈0.140 各有一处，最宽 100m 以上）。
     改法：每一站永远是三条水道（右汊 / 中汊 / 左汊）＋两条「岛缝」，
     没有岛的地方岛缝退化成一个点、宽度为零。条带数恒定 → 站与站之间永远连得上，
     被挖掉的只有岛的真实断面；它在相邻两站之间同样是线性内插，
     于是自己收成一个楔形，正好贴着岛尖。 */
  const GAP1 = new Array(NS).fill(null), GAP2 = new Array(NS).fill(null);
  const lastG = [null, null];
  for (let i = 0; i < NS; i++){
    const sp = RAW[i].sp, gaps = [];
    for (let k = 0; k < sp.length - 1; k++) gaps.push([sp[k][1], sp[k+1][0]]);
    if (gaps.length >= 2){ GAP1[i] = gaps[0]; GAP2[i] = gaps[1]; }
    else if (gaps.length === 1){
      /* 只剩一条缝：按与上一站的重叠量认领槽位。认错槽位会把中汊整条挖成空洞，
         所以宁可用「重叠优先、其次比中线距离」这条稳的判据。 */
      const g = gaps[0];
      const score = h => {
        if (!h) return -1e9;
        const o = Math.min(g[1], h[1]) - Math.max(g[0], h[0]);
        return o > 0 ? o : -Math.abs((g[0] + g[1]) / 2 - (h[0] + h[1]) / 2);
      };
      if (score(lastG[1]) > score(lastG[0])) GAP2[i] = g; else GAP1[i] = g;
    }
    if (GAP1[i]) lastG[0] = GAP1[i];
    if (GAP2[i]) lastG[1] = GAP2[i];
  }
  /* 退化岛缝的落点：紧邻站有真岛就贴着那条缝的中线收口（楔形正好落进岛尖里），
     否则按三等分摊开。宽度为零，所以这只影响列的疏密，不影响水面外形。 */
  const seamAt = (arr, i, dflt) => {
    if (i > 0 && arr[i-1]) return (arr[i-1][0] + arr[i-1][1]) / 2;
    if (i < NS - 1 && arr[i+1]) return (arr[i+1][0] + arr[i+1][1]) / 2;
    return dflt;
  };
  const CH = [];                        // 每站三条水道 [[a,b],[a,b],[a,b]]（已含咬合量）
  for (let i = 0; i < NS; i++){
    const lo = RAW[i].lo, hi = RAW[i].hi;
    const g1 = GAP1[i], g2 = GAP2[i];
    const p1 = g1 ? 0 : seamAt(GAP1, i, lerp(lo, hi, 1/3));
    const p2 = g2 ? 0 : seamAt(GAP2, i, lerp(lo, hi, 2/3));
    let a1 = g1 ? g1[0] : p1, b1 = g1 ? g1[1] : p1;
    let a2 = g2 ? g2[0] : p2, b2 = g2 ? g2[1] : p2;
    /* 缝必须落在断面里且不交叉，否则水道会翻面 */
    a1 = clamp(a1, lo, hi); b1 = clamp(b1, a1, hi);
    a2 = clamp(a2, b1, hi); b2 = clamp(b2, a2, hi);
    /* 靠岛的那一端往岛底下伸 isleBite，靠岸的那一端往陆地伸 bankBite，都是为了不露缝 */
    const c0 = [lo - C.bankBite, a1 + (g1 ? C.isleBite : 0)];
    const c1 = [b1 - (g1 ? C.isleBite : 0), a2 + (g2 ? C.isleBite : 0)];
    const c2 = [b2 - (g2 ? C.isleBite : 0), hi + C.bankBite];
    /* 岛比两侧咬合量还窄时会被咬穿，把水道压成一个点，别让它翻面 */
    if (c0[1] < c0[0]) c0[1] = c0[0];
    if (c2[0] > c2[1]) c2[0] = c2[1];
    if (c1[1] < c1[0]){ const m = (c1[0] + c1[1]) / 2; c1[0] = c1[1] = m; }
    CH.push([c0, c1, c2]);
  }

  const pos = [], uv = [], shore = [], idx = [];
  const NL = C.waterCols;               // 每条水道的横向段数
  const NV = 3 * (NL + 1);              // 每站顶点数（水道之间不共点：中间隔着岛）
  for (let i = 0; i < NS; i++){
    const t = i / (NS - 1), a = riv.at(t), arc = t * riv.len, sp = RAW[i].sp;
    for (let c = 0; c < 3; c++){
      const ch = CH[i][c];
      for (let j = 0; j <= NL; j++){
        const off = lerp(ch[0], ch[1], j / NL);
        pos.push(a.x + a.nx * off, Y.water, a.z + a.nz * off);
        uv.push(off, arc);
        /* 离岸距离：到最近一条真实水边的距离。水里是「往内的深度」，岛底下（水面
           为了不露缝多伸进去的那一截）是「往外的深度」，两边都随距离增长——
           所以泡沫只在真实岸线两侧那一条窄带里起，塞进岛下的部分不会整片泛白。 */
        let d = -1e9;
        for (const s of sp){ const q = Math.min(off - s[0], s[1] - off); if (q > d) d = q; }
        shore.push(Math.abs(d));
      }
    }
  }
  for (let i = 0; i < NS - 1; i++){
    const r0 = i * NV, r1 = (i + 1) * NV;
    for (let c = 0; c < 3; c++){
      const o = c * (NL + 1);
      for (let j = 0; j < NL; j++){
        const a0 = r0 + o + j, b0 = r1 + o + j;
        idx.push(a0, a0 + 1, b0 + 1, a0, b0 + 1, b0);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv',       new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aShore',   new THREE.Float32BufferAttribute(shore, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();

  const nrm = PC.cachedTex('water-ripple', () => makeRippleCanvas(512));
  nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;

  const P = PC.palette;
  const toV3 = h => { const c = chan(h); return new THREE.Vector3(c[0]/255, c[1]/255, c[2]/255); };
  /* lights 那一份是为了 shadow map：directionalLightShadows / directionalShadowMap /
     directionalShadowMatrix 都在里面，缺一个都编译不过。merge 会做深拷贝，
     不会污染 THREE.UniformsLib 本体。 */
  const uni = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, THREE.UniformsLib.lights]);
  uni.uTime    = {value: 0};
  uni.uSun     = {value: new THREE.Vector3(0.78, 0.62, -0.10)};
  uni.uSunCol  = {value: new THREE.Vector3(1, 0.95, 0.87)};
  uni.uSpecK   = {value: 1};
  uni.uDeep    = {value: toV3(P.waterDeep)};
  uni.uShallow = {value: toV3(P.waterShallow)};
  uni.uFoam    = {value: toV3(P.foam)};
  uni.uNrm     = {value: nrm};
  uni.uEnv     = {value: nrm};
  uni.uEnvOn   = {value: 0};
  uni.uRefl    = {value: nrm};                     // 占位，第一帧起换成反射 RT
  uni.uReflMat = {value: new THREE.Matrix4()};
  uni.uReflOn  = {value: 0};

  waterMat = new THREE.ShaderMaterial({
    uniforms: uni, vertexShader: WATER_VS, fragmentShader: WATER_FS,
    fog: true, lights: true, side: THREE.DoubleSide
  });
  waterMesh = new THREE.Mesh(g, waterMat);
  waterMesh.frustumCulled = false;     // 长 7km 的带，包围球没有剔除意义
  waterMesh.castShadow = false;
  waterMesh.receiveShadow = true;      // 影子由 shader 里自己采（见 WATER_FS 的 shadow）
  waterMesh.renderOrder = -1;
  ROOT.add(waterMesh);
  BUDGET.waterTris = idx.length / 3;
  return {NS};
}

/* ══════════════════ 6. 河堤 ══════════════════ */

/* 6.1 沿折线做等距重采样，带内插的内陆法线与斜接系数
   sgn = +1/−1：内陆在行进方向的左手侧还是右手侧。整条折线共用一个符号，
   所以哪怕岸线拐过 90°（塞纳河在圣路易岛那一带就是），法线也不会中途翻面——
   翻一次，那一段墙的正反面就掉过来，整段变黑。 */
function makePath(pts, sgn){
  const n = pts.length;
  /* 逐段法线：一律取「行进方向的左手侧」再乘符号 */
  const segN = [];
  for (let i = 0; i < n - 1; i++){
    const dx = pts[i+1][0] - pts[i][0], dz = pts[i+1][1] - pts[i][1];
    const L = Math.hypot(dx, dz) || 1;
    segN.push([(-dz / L) * sgn, (dx / L) * sgn]);
  }
  /* 顶点法线 = 相邻段法线平均；斜接系数补上转角处的收缩 */
  const vN = [], vM = [];
  for (let i = 0; i < n; i++){
    const a = segN[Math.max(0, i - 1)], b = segN[Math.min(segN.length - 1, i)];
    let nx = a[0] + b[0], nz = a[1] + b[1];
    const L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L;
    vN.push([nx, nz]);
    vM.push(1 / Math.max(0.55, nx * b[0] + nz * b[1]));
  }
  /* 4m 重采样 */
  const X = [], Z = [], NX = [], NZ = [], M = [];
  const STEP = 4;
  let acc = 0, i = 0, cx = pts[0][0], cz = pts[0][1], cf = 0;
  X.push(cx); Z.push(cz); NX.push(vN[0][0]); NZ.push(vN[0][1]); M.push(vM[0]);
  while (i < n - 1){
    const ax = pts[i][0], az = pts[i][1], bx = pts[i+1][0], bz = pts[i+1][1];
    const segL = Math.hypot(bx - ax, bz - az) || 1;
    let rem = segL * (1 - cf);
    if (rem < STEP){ cf = 0; i++; acc += rem; continue; }
    cf += STEP / segL;
    const px = lerp(ax, bx, cf), pz = lerp(az, bz, cf);
    let nx = lerp(vN[i][0], vN[i+1][0], cf), nz = lerp(vN[i][1], vN[i+1][1], cf);
    const L = Math.hypot(nx, nz) || 1;
    X.push(px); Z.push(pz); NX.push(nx / L); NZ.push(nz / L);
    M.push(lerp(vM[i], vM[i+1], cf));
    acc += STEP;
  }
  const len = (X.length - 1) * STEP;
  return {
    len,
    at(s, o){
      const f = clamp(s, 0, len) / STEP, k = Math.min(X.length - 2, Math.floor(f)), g = f - k;
      o.x = lerp(X[k], X[k+1], g); o.z = lerp(Z[k], Z[k+1], g);
      let nx = lerp(NX[k], NX[k+1], g), nz = lerp(NZ[k], NZ[k+1], g);
      const L = Math.hypot(nx, nz) || 1; o.nx = nx / L; o.nz = nz / L;
      o.m = lerp(M[k], M[k+1], g);
      return o;
    }
  };
}
/* 把 (弧长 s, 内陆偏移 u, 高 y) 变成世界点 */
function P3(path, s, u, y, tmp){ path.at(s, tmp);
  return [tmp.x + tmp.nx * u * tmp.m, y, tmp.z + tmp.nz * u * tmp.m]; }

/* 石作 uv 的三套取法。全线共用「沿岸弧长 s / 内陆进深 u / 高程 y」这一组坐标，
   所以石缝跨跨连续、砌层永远是横的，一条河岸读成一条河岸而不是一排补丁。 */
const UV_WALL  = c => [c[0], c[2]];   // 顺岸立面：沿岸 × 高
const UV_DECK  = c => [c[0], c[1]];   // 水平面：沿岸 × 进深
const UV_CROSS = c => [c[1], c[2]];   // 横断面：进深 × 高
/* 用 (s,u,y) 描述四角的一块石作面。uvs 是上面三个取法之一，或直接给四对未缩放 uv */
function quadQ(mb, path, tmp, S, out, uvs, a, b, c, d){
  const q = [a, b, c, d], P = [], T = [];
  for (let i = 0; i < 4; i++){
    P.push(P3(path, q[i][0], q[i][1], q[i][2], tmp));
    const w = typeof uvs === 'function' ? uvs(q[i]) : uvs[i];
    T.push([w[0] * S, w[1] * S]);
  }
  mb.quadT(P[0], P[1], P[2], P[3], out, T[0], T[1], T[2], T[3]);
}

function buildQuays(ctx){
  const {THREE, plan} = ctx, Y = PC.Y, riv = plan.river;
  const tex = quaiTextures(), S = 1 / tex.tile;
  const mb = new MB();
  const tmp = {};

  /* ── 6.a 收集每条 quay 的下层步道宽度 ── */
  const QS = [];
  for (const q of plan.quays){
    if (q.pts.length < 2) continue;
    const isle = q.side === 'island';
    const bw = q.hasBerge
      ? clamp(q.bergeW || 8, C.bergeMin, isle ? C.bergeIsleMax : C.bergeMax) : 0;
    /* sup = 坡道占位（旧书摊与系缆件让开整条坡道）
       gap = 石栏杆断开区间（只在坡道口那十来米，墙身本身不断） */
    QS.push({q, isle, bwNom: bw, pts: q.pts.slice(), sup: [], gap: [],
             bwHead: null, bwTail: null});
  }

  /* ── 6.b 接头 ──
     plan 里同岸相邻两条 quay 的端点常常差 20–40m（OSM 的岸线是一条一条画的，
     各画各的），步道宽度也各不相同（8 / 0 / 14 这种跳法）。各建各的结果就是
     接头处一道能看穿的竖缝，外加一级硬台阶——实测左岸大奥古斯丁↔圣米歇尔
     ↔蒙特贝洛 那两处就是这么来的。
     这里做两件事：① 缺口由编号靠前的那条伸过去补上，于是两段共用同一个端点；
     ② 两段都有下层步道时，宽度各自向中值渐变，接头处宽度相等，台阶消失。
     一边压根没有步道（圣米歇尔码头）就不渐变——那是真实差异，靠端头回墙收口。 */
  const LINK_MAX = 60;                        // 超过这个距离就不是同一条岸，别乱接
  const ends = [];
  QS.forEach((Q, i) => {
    ends.push({i, head: true,  p: Q.pts[0]});
    ends.push({i, head: false, p: Q.pts[Q.pts.length - 1]});
  });
  const link = ends.map((ea, a) => {
    let best = null;
    for (let b = 0; b < ends.length; b++){
      const eb = ends[b];
      if (eb.i === ea.i || QS[eb.i].q.side !== QS[ea.i].q.side) continue;
      const d = Math.hypot(ea.p[0] - eb.p[0], ea.p[1] - eb.p[1]);
      if (d <= LINK_MAX && (!best || d < best.d)) best = {d, b};
    }
    return best;
  });
  for (let a = 0; a < ends.length; a++){
    if (!link[a]) continue;
    const A = QS[ends[a].i], B = QS[ends[link[a].b].i];
    if (A.bwNom <= 0 || B.bwNom <= 0 || Math.abs(A.bwNom - B.bwNom) > 14) continue;
    const mid = (A.bwNom + B.bwNom) / 2;
    if (ends[a].head) A.bwHead = mid; else A.bwTail = mid;
  }
  for (let a = 0; a < ends.length; a++){
    const L = link[a];
    if (!L || L.d < 1.0) continue;
    const ea = ends[a], eb = ends[L.b];
    if (ea.i > eb.i) continue;                // 一条缝只让一边补，两边都补就打架
    if (ea.head) QS[ea.i].pts.unshift([eb.p[0], eb.p[1]]);
    else QS[ea.i].pts.push([eb.p[0], eb.p[1]]);
  }

  /* ── 6.c 路径与步道宽度函数 ── */
  const BLEND = 34, sm01 = t => t * t * (3 - 2 * t);
  for (const Q of QS){
    /* 水在哪一侧：拿 inWater 直接投票，比「朝河心」可靠——岛的河心在岛里。
       每段都取「行进方向左手侧」的法线，所以票数是一个能贯穿全线的符号。 */
    const pts = Q.pts;
    let vote = 0;
    for (let i = 0; i < pts.length - 1; i++){
      const mx = (pts[i][0] + pts[i+1][0]) / 2, mz = (pts[i][1] + pts[i+1][1]) / 2;
      const dx = pts[i+1][0] - pts[i][0], dz = pts[i+1][1] - pts[i][1];
      const L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L;
      for (const d of [9, 26]){
        if (riv.inWater(mx + nx*d, mz + nz*d)) vote--;
        if (riv.inWater(mx - nx*d, mz - nz*d)) vote++;
      }
    }
    if (vote === 0){       /* 兜底：陆岸朝河心是水，岛岸反过来 */
      const mx = pts[0][0], mz = pts[0][1];
      const cp = riv.at(riv.dist(mx, mz).t);
      const dx = pts[1][0] - pts[0][0], dz = pts[1][1] - pts[0][1];
      const L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L;
      const toC = (cp.x - mx) * nx + (cp.z - mz) * nz;
      vote = (Q.q.side === 'island' ? 1 : -1) * (toC >= 0 ? 1 : -1);
    }
    Q.path = makePath(pts, Math.sign(vote) || 1);
    const len = Q.path.len, w0 = Q.bwNom;
    Q.bwAt = s => {
      if (Q.bwHead !== null && s < BLEND) return lerp(Q.bwHead, w0, sm01(clamp(s / BLEND, 0, 1)));
      if (Q.bwTail !== null && s > len - BLEND)
        return lerp(Q.bwTail, w0, sm01(clamp((len - s) / BLEND, 0, 1)));
      return w0;
    };
  }

  /* ── 坡道与石阶：先占位（抑制区间），再建 ── */
  const ramps = [];
  for (const r of plan.ramps){
    let best = null;
    for (const Q of QS){
      if (Q.q.side !== r.side) continue;
      if (!Q.bwNom) continue;
      const st = 6;
      for (let s = 0; s <= Q.path.len; s += st){
        Q.path.at(s, tmp);
        const d = Math.hypot(tmp.x - r.x, tmp.z - r.z);
        if (!best || d < best.d) best = {d, Q, s};
      }
    }
    if (!best || best.d > 260) continue;
    const veh = r.kind === 'vehicle';
    const L = veh ? C.rampLen : (Y.street - Y.berge) / C.stairRise * C.stairRun;
    const s0 = clamp(best.s - L / 2, 2, best.Q.path.len - L - 2);
    if (s0 < 2 || L + 4 > best.Q.path.len) continue;
    best.Q.sup.push([s0 - 1.5, s0 + L + 1.5]);
    /* 石栏杆只在坡道口断开，不是整条坡道都断。
       坡道是贴着挡墙、铺在下层步道上的，墙在它背后照旧站着；
       原来按整条 51m 抑制，从河上看就是河堤被切掉一大段。
       断开长度取「坡面还高于街面 −0.95m」的那一截，车正好能拐进去。 */
    best.Q.gap.push([s0 - 2.0, s0 + Math.max(7, L * 0.30)]);
    ramps.push({Q: best.Q, s0, L, veh, name: r.name});
  }

  /* 水线调制的三个折点。挡墙立面必须在这些高度上打断顶点——
     一整面 11.4m 高的墙如果只有上下两排顶点，「水线发绿发暗」就会被线性插值
     一路抹到墙顶，于是没有下层步道的那几段（圣米歇尔码头、西岱岛北岸）整段发灰，
     跟隔壁有步道、只有底下 2m 发暗的段拼在一起，看着就是换了块石头。 */
  const BRK = [Y.water + 0.25, Y.water + 2.0, Y.water + 4.2];
  const waterTint = y => {
    if (y <= BRK[0]) return [0.70, 0.75, 0.64];                 // 水下 / 常年浸水
    if (y <= BRK[1]){                                           // 水线苔痕
      const t = (y - BRK[0]) / (BRK[1] - BRK[0]);
      return [lerp(0.70,0.90,t), lerp(0.75,0.92,t), lerp(0.64,0.85,t)];
    }
    if (y <= BRK[2]){                                           // 往上收干净
      const t = (y - BRK[1]) / (BRK[2] - BRK[1]);
      return [lerp(0.90,1,t), lerp(0.92,1,t), lerp(0.85,0.99,t)];
    }
    return [1, 1, 0.99];
  };

  /* ── 挡墙 + 下层步道 + 拱洞 + 栏杆 ── */
  /* 桥位表：桥底下那几十米是全河最脏的一段（终年背光 + 桥面排水往下冲）。
     这是「这段墙经历了什么」，不是「这段墙是什么」，所以可以变。 */
  const brgW = (plan.bridges || []).map(b => ({x: b.x, z: b.z}));
  let niches = 0, bays = 0, caps = 0, qIdx = 0;
  for (const Q of QS){
    const path = Q.path, len = path.len, bwAt = Q.bwAt;
    qIdx++;
    if (len < 12) continue;
    /* 逐跨的风化档案。batch = 这条码头——同一条码头是同一次砌的、同龄，
       所以整条偏脏或偏净是一致的，跨与跨之间只有个体小差。 */
    let WE = {dry: [1,1,1], wet: [1,1,1], wetTop: Y.water + 2.2};
    const supped = s => Q.sup.some(iv => s > iv[0] && s < iv[1]);
    const opened = s => Q.gap.some(iv => s > iv[0] && s < iv[1]);
    /* 一片顺岸立面：在水线折点上分带，别让「发绿」被插值抹上墙顶。
       给了 uLo 就是收分面（斜坡石）：u 从底下的 uLo 线性收到顶上的 u。 */
    const wall = (s0, s1, u0, u1, y0, y1, out, uLo0, uLo1) => {
      const ys = [y0];
      for (const y of BRK) if (y > y0 + 0.05 && y < y1 - 0.05) ys.push(y);
      ys.push(y1);
      const dy = Math.max(1e-6, y1 - y0);
      const uu = (u, uLo, y) => uLo === undefined ? u : lerp(uLo, u, clamp((y - y0) / dy, 0, 1));
      for (let k = 0; k < ys.length - 1; k++){
        /* 水线以下那两带吃「浸水」乘子（苔厚污重），往上收成干墙。
           分带本来就是为了不让水线被插值抹到墙顶，风化也照这条线分。 */
        mb.W = (ys[k] + ys[k+1]) / 2 < WE.wetTop ? WE.wet : WE.dry;
        mb.recol();
        quadQ(mb, path, tmp, S, out, UV_WALL,
          [s0, uu(u0, uLo0, ys[k]),   ys[k]],   [s1, uu(u1, uLo1, ys[k]),   ys[k]],
          [s1, uu(u1, uLo1, ys[k+1]), ys[k+1]], [s0, uu(u0, uLo0, ys[k+1]), ys[k+1]]);
      }
      mb.W = WE.dry; mb.recol();
    };

    /* 断点表：跨长上限 + 拱洞两侧 + 抑制区间边界 + 步道渐变段加密 */
    const marks = [0, len];
    for (let s = C.bayMax; s < len; s += C.bayMax) marks.push(s);
    if (Q.bwHead !== null) for (let k = 1; k < 5; k++) marks.push(k * 8);
    if (Q.bwTail !== null) for (let k = 1; k < 5; k++) marks.push(len - k * 8);
    const nichePos = [];
    if (Q.bwNom > 0){
      for (let s = C.nicheStep * 0.6; s < len - C.nicheStep * 0.4; s += C.nicheStep){
        if (supped(s)) continue;
        nichePos.push(s);
        marks.push(s - C.nicheHW, s + C.nicheHW);
      }
    }
    for (const iv of Q.gap) marks.push(iv[0], iv[1]);
    marks.sort((a, b) => a - b);

    for (let k = 0; k < marks.length - 1; k++){
      const s0 = marks[k], s1 = marks[k+1];
      if (s1 - s0 < 0.05 || s0 < -0.01 || s1 > len + 0.01) continue;
      const mid = (s0 + s1) / 2;
      const inNiche = nichePos.some(p => mid > p - C.nicheHW && mid < p + C.nicheHW);
      const w0 = bwAt(s0), w1 = bwAt(s1);
      const A = {}, B = {};
      path.at(s0, A); path.at(s1, B);
      const out = [-(A.nx + B.nx) / 2, 0, -(A.nz + B.nz) / 2];   // 朝水
      const topLo = Q.bwNom > 0 ? Y.berge : Y.street;
      const yBat = Y.water + 0.30;
      WE = quayWeather((A.x + B.x) / 2, (A.z + B.z) / 2, qIdx, brgW);

      /* 临水那一面：拱洞和坡道都只是「上层墙」上的开口，它们脚下这一段实体
         不能跟着一起没掉。这三样原来共用同一个 if，于是每个拱洞、每条坡道底下
         都在水面以上留了 2m 高的豁口，从河面机位看得见河堤被掏空。 */
      bays++;
      mb.W = WE.wet; mb.col(1, 1, 1);
      wall(s0, s1, -C.revet, -C.revet, C.bedY, yBat, out);          // 水下直墙，略外挑
      /* 水线到步道那 2m：斜坡石 revêtement，往岸上收分。
         原来这里是一片竖直墙面，法线水平朝河、整天照不到直射光，
         在下层步道机位上就读成一条纯黑无纹理的带（审查 t-water-cu-3 指的就是它）。
         收成斜面之后它朝天，接得到天光，也才是真实 berge 水边的做法。
         再压一档色：这一段常年浸水，比上面的干墙深一点才对，不然斜面朝天反而最亮。 */
      mb.col(0.86, 0.90, 0.84);
      wall(s0, s1, 0, 0, yBat, topLo, out, -C.revet, -C.revet);
      mb.col(1, 1, 1);
      if (Q.bwNom > 0){
        /* 下层步道面 */
        mb.col(0.90, 0.90, 0.88);
        quadQ(mb, path, tmp, S, [0,1,0], UV_DECK,
          [s0, 0, Y.berge], [s1, 0, Y.berge], [s1, w1, Y.berge], [s0, w0, Y.berge]);
        /* 上层挡墙——只有拱洞那一跨让开，坡道背后的墙照旧站着 */
        if (!inNiche){
          mb.col(1, 1, 1);
          wall(s0, s1, w0, w1, Y.berge, Y.street, out);
        }
      }
      /* 栏杆（石护栏 mur bahut）——洞口段照常压过去，只在坡道口那十来米断开 */
      if (!opened(mid)){
        const p0 = w0 + C.parapetT, p1 = w1 + C.parapetT, yT = Y.street + C.parapetH;
        const inw = [(A.nx + B.nx) / 2, 0, (A.nz + B.nz) / 2];
        mb.col(1.04, 1.03, 1.00);
        quadQ(mb, path, tmp, S, out, UV_WALL,
          [s0, w0, Y.street], [s1, w1, Y.street], [s1, w1, yT], [s0, w0, yT]);
        quadQ(mb, path, tmp, S, [0,1,0], UV_DECK,
          [s0, w0, yT], [s1, w1, yT], [s1, p1, yT], [s0, p0, yT]);
        quadQ(mb, path, tmp, S, inw, UV_WALL,
          [s0, p0, Y.street], [s1, p1, Y.street], [s1, p1, yT], [s0, p0, yT]);
        /* 压顶条，盖住与 terrain 地面的接缝 */
        mb.col(0.94, 0.93, 0.91);
        quadQ(mb, path, tmp, S, [0,1,0], UV_DECK,
          [s0, p0, Y.street], [s1, p1, Y.street],
          [s1, p1 + C.capW, Y.street], [s0, p0 + C.capW, Y.street]);
      }
    }

    /* ── 端头回墙：把这一段砌体的横断面封上 ──
       同岸相邻两条 quay 的端点对不齐、步道宽度也不同，不封就是一道能看穿的竖缝。
       接得严丝合缝的地方，两片回墙重合且互相背对，落在实体内部，看不见。 */
    for (const e of [0, 1]){
      const s = e ? len : 0, w = bwAt(s), uo = w + C.parapetT + C.capW;
      const A = {}, B = {};
      path.at(Math.max(0, s - 1), A); path.at(Math.min(len, s + 1), B);
      let tx = B.x - A.x, tz = B.z - A.z;
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const dir = e ? [tx, 0, tz] : [-tx, 0, -tz];
      const yT = Y.street + C.parapetH;
      WE = quayWeather(A.x, A.z, qIdx, brgW);
      mb.W = WE.dry; mb.col(0.97, 0.96, 0.94);
      /* 临水那条边跟着收分面走：墙脚在 −revet、步道口在 0，回墙得是个梯形，
         照旧按矩形封的话水线附近会漏出一条 0.85m 宽的缝 */
      quadQ(mb, path, tmp, S, dir, UV_CROSS,
        [s, -C.revet, C.bedY], [s, uo, C.bedY], [s, uo, Y.berge], [s, 0, Y.berge]);
      const uIn = Q.bwNom > 0 ? w : 0;
      quadQ(mb, path, tmp, S, dir, UV_CROSS,
        [s, uIn, Y.berge], [s, uo, Y.berge], [s, uo, yT], [s, uIn, yT]);
      caps++;
    }

    /* 拱形储藏洞口 */
    for (const s of nichePos){
      niches++;
      const bw = bwAt(s);
      const hw = C.nicheHW, dep = C.nicheDepth;
      const ySill = Y.berge + C.nicheSill, ySpr = Y.berge + C.nicheSpring;
      const sA = s - hw, sB = s + hw;
      const A = {}, B = {};
      path.at(sA, A); path.at(sB, B);
      const out = [-(A.nx + B.nx) / 2, 0, -(A.nz + B.nz) / 2];
      const TL = Math.hypot(B.x - A.x, B.z - A.z) || 1;
      const TT = [(B.x - A.x) / TL, 0, (B.z - A.z) / TL];   // 沿岸单位切向
      /* 拱洞口是排水与常年阴影所在，比同段干墙更脏一档——洞越老，洞口那圈污渍越明显 */
      WE = quayWeather((A.x + B.x) / 2, (A.z + B.z) / 2, qIdx, brgW);
      const NW = [WE.dry[0] * 0.94, WE.dry[1] * 0.95, WE.dry[2] * 0.92];
      /* 洞口以下的墙 */
      mb.W = NW; mb.col(1, 1, 1);
      quadQ(mb, path, tmp, S, out, UV_WALL,
        [sA, bw, Y.berge], [sB, bw, Y.berge], [sB, bw, ySill], [sA, bw, ySill]);
      /* 门槛面 */
      mb.col(0.86, 0.85, 0.83);
      quadQ(mb, path, tmp, S, [0,1,0], UV_DECK,
        [sA, bw, ySill], [sB, bw, ySill], [sB, bw + dep, ySill], [sA, bw + dep, ySill]);
      /* 洞内：后壁 + 两侧壁 + 拱腹 */
      mb.col(0.40, 0.39, 0.38);
      quadQ(mb, path, tmp, S, out, UV_WALL,
        [sA, bw + dep, ySill], [sB, bw + dep, ySill], [sB, bw + dep, ySpr], [sA, bw + dep, ySpr]);
      quadQ(mb, path, tmp, S, TT, UV_CROSS,
        [sA, bw, ySill], [sA, bw + dep, ySill], [sA, bw + dep, ySpr], [sA, bw, ySpr]);
      quadQ(mb, path, tmp, S, [-TT[0], 0, -TT[2]], UV_CROSS,
        [sB, bw, ySill], [sB, bw + dep, ySill], [sB, bw + dep, ySpr], [sB, bw, ySpr]);
      const NG = C.nicheSeg;
      for (let k = 0; k < NG; k++){
        const a0 = Math.PI * k / NG, a1 = Math.PI * (k + 1) / NG;
        const x0 = s - hw * Math.cos(a0), y0 = ySpr + hw * Math.sin(a0);
        const x1 = s - hw * Math.cos(a1), y1 = ySpr + hw * Math.sin(a1);
        /* 后壁上的拱区 */
        mb.col(0.40, 0.39, 0.38);
        quadQ(mb, path, tmp, S, out, UV_WALL,
          [x0, bw + dep, ySpr], [x1, bw + dep, ySpr], [x1, bw + dep, y1], [x0, bw + dep, y0]);
        /* 拱腹：法线指向拱心 (s, ySpr)；uv 沿拱的弧长走，免得在拱顶退化 */
        const mx = (x0 + x1) / 2 - s, my = (y0 + y1) / 2 - ySpr;
        const ml = Math.hypot(mx, my) || 1;
        const c0 = s + hw * a0, c1 = s + hw * a1;
        mb.col(0.48, 0.47, 0.45);
        quadQ(mb, path, tmp, S, [-TT[0] * mx / ml, -my / ml, -TT[2] * mx / ml],
          [[c0, bw], [c1, bw], [c1, bw + dep], [c0, bw + dep]],
          [x0, bw, y0], [x1, bw, y1], [x1, bw + dep, y1], [x0, bw + dep, y0]);
        /* 拱上的墙面（拱肩） */
        mb.col(1, 1, 1);
        quadQ(mb, path, tmp, S, out, UV_WALL,
          [x0, bw, y0], [x1, bw, y1], [x1, bw, Y.street], [x0, bw, Y.street]);
      }
    }
  }

  /* ── 坡道 rampe 与石阶 ── */
  for (const R of ramps){
    const path = R.Q.path, s0 = R.s0, L = R.L, bw = R.Q.bwAt(s0 + L / 2);
    /* 贴着挡墙往水侧铺，但不许越过水线 */
    const w = Math.min(R.veh ? C.rampW : C.stairW, bw - 0.6);
    if (w < 1.6) continue;
    const uOut = bw, uIn = bw - w;
    const A = {}, B = {};
    path.at(s0, A); path.at(s0 + L, B);
    const out = [-(A.nx + B.nx) / 2, 0, -(A.nz + B.nz) / 2];
    /* 坡道与石阶是被踩被开的：磨得亮，但缝里积垢也重。用它自己那一段的档案 */
    mb.W = quayWeather(A.x, A.z, 500 + ramps.indexOf(R), brgW).dry;
    if (R.veh){
      mb.col(0.88, 0.87, 0.85);
      /* 斜面 */
      quadQ(mb, path, tmp, S, [0,1,0], UV_DECK,
        [s0, uIn, Y.street], [s0 + L, uIn, Y.berge], [s0 + L, uOut, Y.berge], [s0, uOut, Y.street]);
      /* 水侧挡边（斜面下的墙） */
      mb.col(1, 1, 1);
      const NSEG = 8;
      for (let k = 0; k < NSEG; k++){
        const sa = s0 + L * k / NSEG, sb = s0 + L * (k + 1) / NSEG;
        const ya = lerp(Y.street, Y.berge, k / NSEG), yb = lerp(Y.street, Y.berge, (k + 1) / NSEG);
        quadQ(mb, path, tmp, S, out, UV_WALL,
          [sa, uIn, Y.berge], [sb, uIn, Y.berge], [sb, uIn, yb], [sa, uIn, ya]);
        /* 矮护栏 */
        mb.col(1.02, 1.01, 0.99);
        quadQ(mb, path, tmp, S, out, UV_WALL,
          [sa, uIn, ya], [sb, uIn, yb], [sb, uIn, yb + 0.75], [sa, uIn, ya + 0.75]);
        mb.col(1, 1, 1);
      }
    } else {
      const n = Math.round((Y.street - Y.berge) / C.stairRise);
      const TL = Math.hypot(B.x - A.x, B.z - A.z) || 1;
      const TT = [(B.x - A.x) / TL, 0, (B.z - A.z) / TL];
      for (let k = 0; k < n; k++){
        const sa = s0 + k * C.stairRun, sb = sa + C.stairRun;
        const y = Y.street - k * C.stairRise;
        mb.col(0.94, 0.93, 0.91);                                               /* 踏面 */
        quadQ(mb, path, tmp, S, [0,1,0], UV_DECK,
          [sa, uIn, y], [sb, uIn, y], [sb, uOut, y], [sa, uOut, y]);
        mb.col(0.84, 0.83, 0.81);                                               /* 踢面 */
        quadQ(mb, path, tmp, S, TT, UV_CROSS,
          [sb, uIn, y - C.stairRise], [sb, uOut, y - C.stairRise], [sb, uOut, y], [sb, uIn, y]);
        mb.col(1, 1, 1);                                                        /* 水侧梯帮 */
        quadQ(mb, path, tmp, S, out, UV_WALL,
          [sa, uIn, Y.berge], [sb, uIn, Y.berge], [sb, uIn, y], [sa, uIn, y]);
      }
    }
  }

  /* ── 合并成一个 draw call ── */
  const geo = mb.build(waterTint);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: tex.map, normalMap: tex.nrm,
    normalScale: new THREE.Vector2(1.0, 1.0),
    roughness: 0.94, metalness: 0, vertexColors: true, envMapIntensity: 0.78
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  ROOT.add(mesh);
  BUDGET.quaiTris = geo.index.count / 3;
  BUDGET.niches = niches; BUDGET.bays = bays; BUDGET.caps = caps;
  return QS;
}

/* ══════════════════ 7. 旧书摊绿箱 ══════════════════
   压在上层石栏杆顶上，不落地（streetlife.md §11）。只在两段指定河岸。 */
const BQ_RIGHT = ['塞莱斯坦码头', '市政厅码头', '热夫尔码头', '梅吉斯里码头', '卢浮宫码头'];
const BQ_LEFT  = ['图尔奈勒码头', '蒙特贝洛码头', '圣米歇尔码头', '大奥古斯丁码头',
                  '孔蒂码头', '马拉盖码头', '伏尔泰码头'];
/* 关着的箱：临河 0.60 高、临街 0.35 高的楔形，顶面朝街倾斜 18.4°。
   尺寸是 1900 年市政法定的，一只一只全一样——这条不许变。
   变的是漆：各摊补漆的年份不同，vert wagon 有深浅；老的褪成灰绿，新的发亮。 */
function bqClosedGeom(){
  const gb = new GB(), hw = C.bqLen / 2, hd = C.bqDepth / 2;
  gb.prism([[-hd, 0], [hd, 0], [hd, C.bqHiStreet], [-hd, C.bqHiRiver]], 0, -hw, hw, 1.6);
  return gb.build();
}
/* 开着的箱：同一只箱，盖子朝河侧翻起来撑着。
   形制没变（还是那只法定的箱），变的是「这一摊今天开着门」。 */
function bqOpenGeom(){
  const gb = new GB(), hw = C.bqLen / 2, hd = C.bqDepth / 2;
  gb.prism([[-hd, 0], [hd, 0], [hd, C.bqHiStreet], [-hd, C.bqHiRiver]], 0, -hw, hw, 1.6);
  /* 盖板：铰在临河那条棱上，往河面方向掀起 110°，厚 5cm */
  const th = 0.05, dep = C.bqDepth;
  const ca = Math.cos(1.92), sa = Math.sin(1.92);      // 110°
  const z0 = -hd, y0 = C.bqHiRiver;
  const nz = -sa * th, ny = -ca * th;                  // 板厚方向
  gb.prism([[z0, y0], [z0 + ca * dep, y0 + sa * dep],
            [z0 + ca * dep + nz, y0 + sa * dep + ny], [z0 + nz, y0 + ny]],
           0, -hw, hw, 1.6);
  return gb.build();
}
function buildBouquinistes(ctx, QS){
  const {THREE} = ctx, Y = PC.Y;
  const matBox = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.72, metalness: 0.12, envMapIntensity: 0.90
  });
  /* 逐实例风化：箱底那圈雨溅积灰 + 顶面被手和雨磨出的底漆。
     同一只箱身上也有新有旧，只改 instanceColor 做不到这一层。 */
  /* wearColor 要贴着漆色选：磨掉一层车厢绿露出来的是底漆和锈木，不是浅灰绿。
     选浅了，shader 的斑点噪声在 2m 的箱子上会读成数码噪点而不是磨损。 */
  PC.varyShader(matBox, {y0: 0.0, y1: 0.62, wearColor: 0x3d4a3f, key: 'bq'});
  const matBook = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.94, metalness: 0, envMapIntensity: 0.6
  });
  const bookGeo = (() => { const g = new GB(); g.box(0, 0, 0, 1, 1, 1, 1.0); return g.build(); })();

  const closed = [], open = [], books = [];
  let stall = 0;
  for (const Q of QS){
    const nm = Q.q.name;
    const on = BQ_RIGHT.indexOf(nm) >= 0 || BQ_LEFT.indexOf(nm) >= 0;
    if (!on) continue;
    const path = Q.path, tmp = {};
    for (let s = 6; s < path.len - C.bqStall - 6; s += C.bqStall + 1.4){
      if (Q.sup.some(iv => s > iv[0] - 4 && s < iv[1] + 4)) continue;
      if (PC.hash2(s, Q.q.len, 41) > C.bqFill) continue;      // 占位率
      stall++;
      path.at(s, tmp);
      /* 摊位档案：一摊的四只箱是同一个摊主同一年漆的，所以族色由摊位定，
         族内的褪色深浅才由每只箱自己定（batch 就是干这个用的）。 */
      const sp0 = PC.vary.of('planter', tmp.x, tmp.z, stall);
      const fam = sp0.pick(PC.families.bouquiniste, 5);
      /* 开着的摊是少数派：整摊一起开，不会一只开一只关 */
      const isOpen = sp0.f(73) > 0.71;
      /* 「一摊四箱」只是上限，实际有不少摊只摆三箱、极少数只剩两箱。
         少这一箱，整排的节奏就不是等差数列了。 */
      const hb = sp0.f(53);
      const nb = hb < 0.09 ? 2 : (hb < 0.38 ? 3 : 4);
      for (let b = 0; b < nb; b++){
        const sb = s + b * (C.bqLen + C.bqGap) + C.bqLen / 2;
        path.at(sb, tmp);
        /* 箱心落在栏杆中线上，进深方向 = 内陆法线 */
        const u = Q.bwAt(sb) + C.parapetT / 2;
        const bx = tmp.x + tmp.nx * u * tmp.m, bz = tmp.z + tmp.nz * u * tmp.m;
        /* 绕 Y 转 a 时 +Z→(sin a, cos a)：让箱子的进深方向对上内陆法线 */
        const ang = Math.atan2(tmp.nx, tmp.nz);
        /* 绿箱每几年就补一次漆（市政规定的颜色，摊主自己刷），所以整体比船新得多：
           age 压到 0.55 档。不压的话 shade() 的褪色会把 vert wagon 洗成灰青，
           一整排读起来像塑料箱（实测 r1cu-D）。 */
        const pb = condition(PC.vary.of('planter', bx, bz, stall), 3.0);
        pb.age *= 0.45; pb.grime *= 0.78;
        const rec = {x: bx, z: bz, ang, prof: pb, fam};
        (isOpen ? open : closed).push(rec);
        if (isOpen){
          /* 开着的箱里码两摞书。书不吃箱子的绿——单独一池，自己的暖色 */
          const nk = pb.f(79) < 0.35 ? 1 : 2;
          for (let k = 0; k < nk; k++)
            books.push({box: rec, k, prof: PC.vary.of('_default', bx + k * 3.7, bz, stall)});
        }
      }
    }
  }

  const mk = (geo, list, mat) => PC.pool(geo, mat, Math.max(1, list.length),
                                         {castShadow: false, receiveShadow: true,
                                          colors: true, vary: mat === matBox});
  const poolC = mk(bqClosedGeom(), closed, matBox);
  const poolO = mk(bqOpenGeom(),   open,   matBox);
  const poolB = PC.pool(bookGeo, matBook, Math.max(1, books.length),
                        {castShadow: false, receiveShadow: true, colors: true});
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
  const col = new THREE.Color();
  const fill = (pool, list) => {
    for (const sp of list){
      e.set(0, sp.ang, 0); q.setFromEuler(e);
      p.set(sp.x, Y.street + C.parapetH, sp.z);
      m.compose(p, q, sc);
      pool.push(m, PC.vary.shade(sp.fam, sp.prof, col), sp.prof);
    }
    pool.commit();
  };
  fill(poolC, closed); fill(poolO, open);
  for (const bk of books){
    const sp = bk.box, f = bk.prof;
    /* 书堆码在箱顶那个斜面上：沿箱长错开，高矮各不同 */
    const lx = (bk.k ? 0.44 : -0.46) + (f.f(5) - 0.5) * 0.20;
    const h  = 0.16 + f.f(13) * 0.17;
    const lz = -0.06 + (f.f(17) - 0.5) * 0.12;
    e.set(0, sp.ang, 0); q.setFromEuler(e);
    const ca = Math.cos(sp.ang), sa2 = Math.sin(sp.ang);
    /* 局部 (lx 沿箱长 = 局部 +X，lz 沿进深 = 局部 +Z) → 世界 */
    p.set(sp.x + lx * ca + lz * sa2,
          Y.street + C.parapetH + 0.50 + h / 2,
          sp.z - lx * sa2 + lz * ca);
    sc.set(0.78 + f.f(23) * 0.22, h, 0.50 + f.f(29) * 0.16);
    m.compose(p, q, sc);
    poolB.push(m, PC.vary.shade(f.pick(PC.families.bookStack, 31), f, col));
    sc.set(1, 1, 1);
  }
  poolB.commit();
  ROOT.add(poolC.mesh, poolO.mesh, poolB.mesh);
  BUDGET.bouquinistes = closed.length + open.length;
  BUDGET.trisBouquiniste = [poolC, poolO, poolB]
    .reduce((s, p) => s + p.count * (p.mesh.geometry.index.count / 3), 0);
  BUDGET.bqOpen = open.length;
  BUDGET.bqStalls = stall;
  BUDGET.bqBooks = books.length;
  return BUDGET.bouquinistes;
}

/* ══════════════════ 8. 系缆桩 + 系船铁环（近景 LOD 实例） ══════════════════ */
function buildMoorings(ctx, QS){
  const {THREE} = ctx, Y = PC.Y;
  const gb = new GB();
  /* 单元局部系：原点在下层步道面，+Z 指向挡墙（墙面固定在 z=1.2） */
  gb.cyl(0, 0.30, 0, 0.175, 0.235, 0.60, 8, 0.5, true);      // 系缆桩（上大下小，自带桩帽形）
  gb.box(0, 1.34, 1.16, 0.30, 0.30, 0.09, 0.5);              // 墙上锚板
  gb.torus(0, 1.19, 1.05, 0.155, 0.033, 2, 8, 3, 0.5);       // 铁环
  const geo = gb.build();
  /* 铸铁件的形制是市政标准件，一只一只全一样——不许变。
     变的是它在河边站了多少年：氧化到什么程度、有没有船天天在这儿系缆把它蹭亮。
     材质必须克隆——PC.mats().iron 是全城共用的，注一次 shader 就把别人也改了。 */
  const mat = PC.mats().iron.clone();
  PC.varyShader(mat, {y0: 0.0, y1: 0.85, wearColor: 0x8d8478, key: 'moor'});

  const col = new THREE.Color();
  moorSpots = [];
  let qi = 0;
  for (const Q of QS){
    qi++;
    if (!Q.bwNom || Q.bwNom < 3.5) continue;
    const path = Q.path, tmp = {};
    /* 间距名义 24m，但实际是按泊位排的，不是等差数列——给 ±2.6m 的位置抖动，
       另有约 8% 的位置本来就没装（拱洞口、坡道边）。 */
    for (let s = 14; s < path.len - 10; s += 24){
      if (Q.sup.some(iv => s > iv[0] - 3 && s < iv[1] + 3)) continue;
      const hs = PC.hash2(s, Q.q.len, 59);
      if (hs > 0.92) continue;
      const sj = clamp(s + (PC.hash2(s, Q.q.len, 61) - 0.5) * 5.2, 6, path.len - 6);
      const u = Q.bwAt(sj) - 1.2;
      path.at(sj, tmp);
      /* 单元局部 +Z 指向挡墙，所以角度按 +Z→内陆法线 解 */
      moorSpots.push({x: tmp.x + tmp.nx * u * tmp.m, z: tmp.z + tmp.nz * u * tmp.m,
                      ang: Math.atan2(tmp.nx, tmp.nz), qi});
    }
  }
  /* 泊船处的桩天天被缆绳磨，露出亮铁；没船的那些锈到发暗发绿 */
  for (const sp of moorSpots){
    let used = 0;
    for (const b of boats){
      if (b.moving) continue;
      const d = Math.hypot(b.x - sp.x, b.z - sp.z);
      if (d < 70) used = Math.max(used, 1 - d / 70);
    }
    const pr = condition(PC.vary.of('ironwork', sp.x, sp.z, sp.qi), 2.2);
    /* 磨亮 = 年龄照旧（桩还是那么老），但表面被蹭掉一层锈 */
    pr.grime = clamp(pr.grime * (1 - used * 0.72), 0, 1);
    pr.moss  = clamp(pr.moss  * (1 - used * 0.85), 0, 1);
    sp.prof = pr;
    sp.col = PC.vary.shade(PC.palette.ironDk, pr, col).clone();
    /* 常被摩擦的桩偏亮偏冷，锈死的那些偏暖偏暗 */
    sp.col.multiplyScalar(0.86 + used * 0.55 - pr.grime * 0.18);
  }
  moorPool = PC.pool(geo, mat, 64, {castShadow: false, receiveShadow: false,
                                    colors: true, vary: true});
  ROOT.add(moorPool.mesh);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
  PC.lod.onMove(cam => {
    moorPool.reset();
    for (const sp of moorSpots){
      if (Math.hypot(sp.x - cam.x, sp.z - cam.z) > 240) continue;
      e.set(0, sp.ang, 0); q.setFromEuler(e); p.set(sp.x, Y.berge, sp.z);
      m.compose(p, q, sc);
      if (!moorPool.push(m, sp.col, sp.prof)) break;
    }
    moorPool.hideRest(); moorPool.commit();
  }, 90);
  BUDGET.moorSpots = moorSpots.length;
}

/* ══════════════════ 9. 船 ══════════════════ */

/* 按高度刷顶点色。船只用一个 instanceColor 染整条船会把驾驶室也染黑，
   所以把「哪儿深哪儿浅」写进几何，instanceColor 只负责这条船的整体色。
   顶点色可以大于 1——驾驶室要在深色船体的基础上被拉回亮色。 */
function paintByY(geo, fn){
  const pos = geo.attributes.position, n = pos.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++){
    const k = fn(pos.getY(i));
    a[i*3] = k[0]; a[i*3+1] = k[1]; a[i*3+2] = k[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

/* 9.1 游船（苍蝇船 / 小游艇）
   剪影是这条船唯一的识别物——60m 外看不见座椅也看不见栏杆，只看得见
   「一条低平的白船 + 一条贯通全长的深色玻璃带 + 玻璃带上面那层白顶」。
   所以三件事按重要性排：① 船首要尖（旧版 sin^0.34 在第一站就已经有 47% 船宽，
   艏艉一样钝，读成一块板）② 玻璃带要读得出（旧版 opacity .42 的浅色玻璃在
   白船体上等于没有）③ 顶棚白顶要出挑，压出玻璃带的阴影。 */
const TOUR_BND = [0, 0.22, 0.55, C.mouche.free];      // 舷侧的吃水线分带
function tourGeoms(){
  const D = C.mouche, hull = new GB(), glass = new GB();
  const NS = 14, hb = D.B / 2;
  /* 艏尖艉方：**+X 是船头**（updateBoats 里绕 Y 转 ang 后局部 +X 对上航向，
     写反了整条船就是倒着开的）。艏部 30% 抛物线收到 0.10 半宽，中段满宽，
     艉部 12% 微收。真实苍蝇船就是这个平面形——尖艏、长平行中体、方艉。 */
  const halfW = u => {
    u = clamp(u, 0, 1);
    if (u > 0.70) return hb * (0.10 + 0.90 * Math.pow((1 - u) / 0.30, 0.62));
    if (u < 0.12) return hb * (1 - 0.28 * (0.12 - u) / 0.12);
    return hb;
  };
  const xs = i => (-D.L / 2) + D.L * (i / NS);
  const yD = D.free, yK = -0.95;                       // 甲板 / 龙骨
  for (let i = 0; i < NS; i++){
    const u0 = i / NS, u1 = (i + 1) / NS;
    const w0 = halfW(u0), w1 = halfW(u1), x0 = xs(i), x1 = xs(i + 1);
    const k0 = w0 * 0.55, k1 = w1 * 0.55;
    for (const s of [1, -1]){
      /* 舷侧按吃水线切三带。顶点色只能落在顶点上——不切开，「水线那圈污」
         就会被从甲板一路线性插值抹平，白船体上等于没有。 */
      for (let k = 0; k < 3; k++)
        hull.face([[x0, TOUR_BND[k], s*w0], [x1, TOUR_BND[k], s*w1],
                   [x1, TOUR_BND[k+1], s*w1], [x0, TOUR_BND[k+1], s*w0]], 0.5);
      hull.face([[x0, yK, s*k0], [x1, yK, s*k1], [x1, 0, s*w1], [x0, 0, s*w0]], 0.5);   // 水下
    }
    hull.face([[x0, yK, -k0], [x1, yK, -k1], [x1, yK, k1], [x0, yK, k0]], 0.5);         // 船底
    hull.face([[x0, yD, -w0], [x1, yD, -w1], [x1, yD, w1], [x0, yD, w0]], 0.5);         // 主甲板
  }
  /* 玻璃顶棚：从艉一路到艏部 0.30L 处（艏部留出开敞前甲板）。艏端一块当风挡。 */
  const cX0 = -D.L / 2 + 1.2, cX1 = D.L / 2 - D.L * 0.20;
  const cL = cX1 - cX0, cCx = (cX0 + cX1) / 2, cW = D.B - 1.05;
  const y0 = yD + 0.34, y1 = yD + D.canopy;
  glass.box(cCx - 0.9, (y0 + y1) / 2, 0, cL - 1.8, y1 - y0, cW, 0.4);
  glass.box(cX1 - 0.45, (y0 + y1) / 2 + 0.06, 0, 1.1, y1 - y0 - 0.22, cW - 0.55, 0.4);  // 风挡
  /* 白色窗框：上下两道通长横梁 + 竖向中梃。没有它，玻璃带在剪影里是一条空洞。 */
  hull.box(cCx, y0 - 0.06, 0, cL, 0.20, cW + 0.10, 0.5);                 // 下横梁（窗台线）
  hull.box(cCx, y1 + 0.04, 0, cL, 0.16, cW + 0.10, 0.5);                 // 上横梁
  const MUL = 6;
  for (let k = 0; k <= MUL; k++){
    const x = cX0 + (cL) * (k / MUL);
    hull.box(x, (y0 + y1) / 2, 0, 0.13, y1 - y0, cW + 0.06, 0.5);
  }
  /* 顶棚上的露天甲板（出挑 0.22m，压出玻璃带的阴影）+ 栏杆 + 成排座椅 */
  hull.box(cCx, y1 + 0.20, 0, cL + 0.44, 0.14, cW + 0.44, 0.5);
  const rY = y1 + 0.27 + D.rail / 2;
  hull.box(cCx, rY, cW / 2, cL, 0.10, 0.07, 0.5);
  hull.box(cCx, rY, -cW / 2, cL, 0.10, 0.07, 0.5);
  hull.box(cX1, rY, 0, 0.10, 0.10, cW, 0.5);
  hull.box(cX0, rY, 0, 0.10, 0.10, cW, 0.5);
  const rows = 6;                                              // 成排座椅
  for (let r = 0; r < rows; r++){
    const x = cX0 + 1.8 + r * ((cL - 3.6) / (rows - 1));
    hull.box(x, y1 + 0.57, 0, 0.42, 0.10, cW - 0.9, 0.5);        // 坐面
    hull.box(x - 0.20, y1 + 0.81, 0, 0.08, 0.38, cW - 0.9, 0.5); // 靠背
  }
  /* 艏部露天前甲板的矮栏 + 桅杆：给尖艏一个可读的收头 */
  hull.box(D.L / 2 - D.L * 0.10, yD + 0.42, 0, D.L * 0.16, 0.07, 0.07, 0.5);
  hull.box(cX1 + 1.0, yD + 1.5, 0, 0.12, 3.0, 0.12, 0.5);
  /* 艉部驾驶台（压在上层甲板后端） */
  hull.box(cX0 + 1.4, y1 + 0.90, 0, 2.6, 1.25, cW - 1.6, 0.5);
  /* 水线以下压暗，白船体才不会糊成一块白；水线往上那 0.6m 是水垢带，
     越靠水越绿越脏——一条天天在浑水里跑的船，这圈是它最像真船的地方。
     这里给的是**比值**：instanceColor 才是这条船的船体色，顶点色只说
     「同一条船身上哪儿深哪儿浅」。 */
  const hg = paintByY(hull.build(), y =>
      y < -0.02      ? [0.30, 0.32, 0.33]
    : y < 0.10       ? [0.60, 0.61, 0.56]
    : y < 0.30       ? [0.78, 0.79, 0.76]
    : y < 0.60       ? [0.91, 0.92, 0.90]
    : y < yD + 0.05  ? [0.96, 0.96, 0.95]
    : [1, 1, 1]);
  return {hull: hg, glass: glass.build()};
}

/* 住家船的材质色是白的，顶点色给的就是真实反照率，所以要做一次 sRGB→线性；
   驳船那条链走的是 paintByY（乘在已经是线性的材质色上），两者不要混用。 */
const L1 = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const RGB = h => { const c = chan(h); return [L1(c[0]/255), L1(c[1]/255), L1(c[2]/255)]; };

/* 9.2 驳船 péniche（Freycinet 38.5 × 5.05）：平底货舱 + 尾部驾驶室 + 烟囱
   驾驶室拆成「墙 / 窗带 / 顶盖」三段，是为了让顶点色能在 y 上切出一条深色窗带——
   一个整块的箱子只有上下两排顶点，切不出中间那条线，60m 外就只是一个白疙瘩。 */
const PEN_BND = [0, 0.30, 0.78, C.peniche.free];      // 驳船舷侧的吃水线分带
function penicheGeom(){
  const D = C.peniche, gb = new GB();
  const NS = 12, hb = D.B / 2;
  const halfW = u => hb * clamp(Math.pow(Math.sin(Math.PI * clamp(u, 0.001, 0.999)), 0.16), 0.25, 1);
  const xs = i => (-D.L / 2) + D.L * (i / NS);
  const yD = D.free, yK = -1.25;
  for (let i = 0; i < NS; i++){
    const u0 = i / NS, u1 = (i + 1) / NS;
    const w0 = halfW(u0), w1 = halfW(u1), x0 = xs(i), x1 = xs(i + 1);
    for (const s of [1, -1]){
      /* 舷侧切三带：吃水线那圈锈是驳船最要紧的一笔，不切开就插值抹没了 */
      for (let k = 0; k < 3; k++)
        gb.face([[x0, PEN_BND[k], s*w0], [x1, PEN_BND[k], s*w1],
                 [x1, PEN_BND[k+1], s*w1], [x0, PEN_BND[k+1], s*w0]], 0.5);
      gb.face([[x0, yK, s*w0*0.86], [x1, yK, s*w1*0.86], [x1, 0, s*w1], [x0, 0, s*w0]], 0.5);
    }
    gb.face([[x0, yK, -w0*0.86], [x1, yK, -w1*0.86], [x1, yK, w1*0.86], [x0, yK, w0*0.86]], 0.5);
    gb.face([[x0, yD, -w0], [x1, yD, -w1], [x1, yD, w1], [x0, yD, w0]], 0.5);
  }
  /* 货舱口围板 coaming（略高出甲板，别和甲板面共面） */
  gb.box(2.0, yD + D.hold / 2, 0, D.L * 0.52, D.hold, D.B - 2.3, 0.5);
  /* 尾部驾驶室：墙 0.02–1.38 / 窗带 1.42–2.10 / 顶盖 2.14–2.46（相对甲板） */
  const wx = -D.L / 2 + 3.6, wW = D.B - 1.3;
  gb.box(wx, yD + 0.70, 0, 4.6, 1.36, wW, 0.5);
  gb.box(wx, yD + 1.76, 0, 4.68, 0.68, wW + 0.06, 0.5);
  gb.box(wx, yD + 2.30, 0, 4.9, 0.32, wW + 0.30, 0.5);
  gb.cyl(-D.L / 2 + 2.0, yD + 3.05, 0.9, 0.17, 0.17, 1.6, 6, 0.5, true);   // 烟囱
  /* 舷边护栏 */
  for (const s of [1, -1]) gb.box(2.0, yD + 0.55, s * (hb - 0.15), D.L * 0.66, 0.07, 0.07, 0.5);
  /* 船体本身深（instanceColor 给的就是深色），驾驶室与舱盖靠顶点色拉回来。
     吃水线那 0.8m 是锈带：偏暖、压深——铁壳驳船泡在浑水里，这一圈永远最先烂。 */
  return paintByY(gb.build(), y =>
      y < 0.02        ? [0.86, 0.80, 0.74]
    : y < 0.40        ? [0.74, 0.60, 0.46]
    : y < 0.90        ? [0.88, 0.79, 0.68]
    : y < yD + 0.08   ? [1, 1, 1]
    : y < yD + 0.70   ? [1.15, 1.15, 1.10]
    : (y > yD + 1.40 && y < yD + 2.12) ? [0.55, 0.60, 0.64]     // 驾驶室窗带
    : [2.4, 2.4, 2.3]);
}

/* 9.3 住家船甲板件：长舱室（带窗带）/ 锌顶 / 花箱绿植 / 自行车 / 晾衣绳
   颜色不按坐标反推（第一版那样写，花箱和舱室在 x 上重叠，一半花箱被刷成奶油色），
   改成建到哪儿刷到哪儿——MB.col() 之后新增的顶点就吃那个色。
   材质色是白的，所以这里给的就是真实反照率（RGB() 已做 sRGB→线性）。
   平面分区（船长 38.5，x∈[−19.25, 19.25]）：
     艉 −18.0…−13.4 是底船自带的驾驶室，别占；
     −13…−5 尾甲板（自行车 + 晾衣绳）；−4…14 长舱室；15…18 艏甲板花箱。 */
/* 舱壁的参考色：顶点色全部按它取比值，instanceColor 才是这条船实际的舱室漆。
   为什么用比值不用绝对色——住家船的舱室是这条船最大一块面，不同的船漆得不一样
   （奶油/米白/淡蓝灰/淡青，PC.families.boatCabin）。用比值，一个池就够，
   花箱与晾衣绳会跟着舱漆漂一点点，而那点漂移读起来正好也是「这条船的调子」。 */
function homeGeom(){
  const D = C.peniche, yD = D.free + 0.05, mb = new MB();
  const P = PC.palette;
  const REF = RGB(mixHex(P.limestoneLt, 0xffffff, 0.30));
  const rel = h => { const c = RGB(h); return [c[0]/REF[0], c[1]/REF[1], c[2]/REF[2]]; };
  const CAB = [1, 1, 1];                                    // 舱壁 = instanceColor 本身
  const WIN = rel(0x141a1e);
  const ZN  = rel(P.zinc);
  const POT = rel(P.chimney);
  const GRN = rel(P.foliage), GRN2 = rel(P.foliageLt);
  const IRN = rel(P.ironDk);
  const CLOTH = rel(mixHex(P.limestoneLt, 0xffffff, 0.6));
  const cx = 5.0, cL = 18.0, cW = D.B - 1.9;                // 舱室 x∈[−4, 14]
  /* 长舱室：墙 / 窗带 / 挑檐锌顶 */
  mb.col(CAB[0], CAB[1], CAB[2]).box(cx, yD + 0.70, 0, cL, 1.32, cW, 0.5);
  mb.col(WIN[0], WIN[1], WIN[2]).box(cx, yD + 1.58, 0, cL - 1.6, 0.42, cW + 0.06, 0.5);
  mb.col(CAB[0], CAB[1], CAB[2]).box(cx, yD + 1.58, 0, cL, 0.42, cW - 0.04, 0.5);   // 窗带两端的舱壁
  mb.col(ZN[0], ZN[1], ZN[2]).box(cx, yD + 1.90, 0, cL + 0.40, 0.20, cW + 0.45, 0.5);
  mb.col(POT[0], POT[1], POT[2]).cyl(cx - cL / 2 + 1.4, yD + 2.70, 0, 0.15, 0.15, 1.5, 6, 0.5, true);
  /* 舷侧花箱（贴着舱室外的窄边甲板） + 艏甲板花箱 */
  const zSide = D.B / 2 - 0.70;
  const spots = [[-1.0, 1], [3.0, -1], [7.0, 1], [11.0, -1], [16.2, 1], [17.4, -1]];
  for (const [x, s] of spots){
    mb.col(POT[0], POT[1], POT[2]).box(x, yD + 0.28, s * zSide, 0.85, 0.55, 0.62, 0.5);
    mb.col(GRN[0], GRN[1], GRN[2]).box(x, yD + 0.85, s * zSide, 0.72, 0.62, 0.52, 0.5);
  }
  /* 屋顶盆栽 */
  mb.col(GRN2[0], GRN2[1], GRN2[2]);
  for (let i = 0; i < 3; i++) mb.box(cx - 5 + i * 5, yD + 2.32, -0.5 + i * 0.5, 0.62, 0.60, 0.58, 0.5);
  /* 尾甲板：自行车 + 晾衣绳 */
  mb.col(IRN[0], IRN[1], IRN[2]);
  mb.box(-11.6, yD + 0.55, 1.1, 1.7, 0.08, 0.55, 0.5);
  mb.box(-12.3, yD + 0.34, 1.1, 0.62, 0.62, 0.06, 0.5);
  mb.box(-10.9, yD + 0.34, 1.1, 0.62, 0.62, 0.06, 0.5);
  mb.box(-12.4, yD + 1.10, -1.4, 0.06, 2.2, 0.06, 0.5);
  mb.box(-5.6, yD + 1.10, -1.4, 0.06, 2.2, 0.06, 0.5);
  mb.box(-9.0, yD + 2.05, -1.4, 6.8, 0.03, 0.03, 0.5);
  mb.col(CLOTH[0], CLOTH[1], CLOTH[2]);
  for (let i = 0; i < 3; i++) mb.box(-11.2 + i * 2.2, yD + 1.72, -1.4, 0.55, 0.66, 0.02, 0.5);
  return mb.build(() => [1, 1, 1]);
}

/* 9.4 水上餐吧甲板件：棚柱 + 桌椅（棚布拆到 awnGeom，串灯拆到 bulbGeom）
   为什么把棚布单拆一池：遮阳棚是这条船上唯一的大色块，要能一船一色地抽
   （PC.families.awning）。合在一起用 instanceColor 的话，柱子和桌椅会跟着
   一起变成墨绿或酒红——一顶奶油色的棚配一套奶油色的椅，那是样板间不是餐吧。 */
function awnGeom(){
  const gb = new GB(), D = C.peniche, yD = D.free + 0.05;
  const L = 16, W = D.B - 1.1;
  gb.box(0, yD + 2.55, 0, L, 0.12, W, 0.5);                          // 棚顶
  gb.box(0, yD + 2.44, W / 2, L, 0.30, 0.06, 0.5);                   // 棚檐（扇贝边简化）
  return gb.build();
}
function barGeom(){
  const gb = new GB(), D = C.peniche, yD = D.free + 0.05;
  const L = 16, W = D.B - 1.1;
  for (const s of [1, -1]) for (let i = 0; i < 4; i++)                // 棚柱
    gb.box(-L / 2 + i * (L / 3), yD + 1.25, s * W / 2, 0.09, 2.5, 0.09, 0.5);
  for (let i = 0; i < 4; i++){
    const x = -L / 2 + 2.0 + i * 4.0;
    gb.box(x, yD + 0.36, 0, 0.14, 0.72, 0.14, 0.5);                  // 圆桌（柱脚）
    gb.cyl(x, yD + 0.74, 0, 0.42, 0.42, 0.05, 8, 0.5, true);         // 桌面
    for (const s of [1, -1]) gb.box(x, yD + 0.24, s * 0.85, 0.42, 0.48, 0.42, 0.5);  // 椅
  }
  return gb.build();
}

/* 9.4b 串灯：单独一池自发光材质。白天是一串暖色小点，18:30 之后它是
   整条河上唯一会亮的东西——为这一条多开一个 draw call 值。 */
function bulbGeom(){
  const gb = new GB(), D = C.peniche, yD = D.free + 0.05;
  const L = 16, W = D.B - 1.1;
  /* 只串朝河那一侧：另一侧贴着岸墙，永远看不到，白花 130 个三角 */
  for (let i = 0; i < 11; i++)
    gb.box(-L / 2 + i * (L / 10), yD + 2.40 - Math.sin(i / 10 * Math.PI) * 0.20, W / 2 - 0.08,
           0.11, 0.15, 0.11, 0.5);
  return gb.build();
}

/* 9.4c 甲板杂物 ──────────────────────────────────────────────────────
   这一项比船体色更能制造个体感：五条同色驳船并排，只要一条堆着砂砾、
   一条码着木箱和油桶、一条摆着盆栽和水桶，它们就不再是一个模子印的。
   两池就够：方件（木箱 / 托盘 / 砂堆 / 灌木）与圆件（油桶 / 缆盘 / 水桶）——
   都用单位几何，尺寸交给实例矩阵的 scale，一池能演好几样东西。 */
function clutBoxGeom(){ const g = new GB(); g.box(0, 0.5, 0, 1, 1, 1, 1.2); return g.build(); }
function clutCylGeom(){ const g = new GB(); g.cyl(0, 0.5, 0, 0.5, 0.5, 1, 8, 1.2, true); return g.build(); }
/* 空位表：Freycinet 驳船的甲板布局是标准的，能放东西的就那么几块地方——
   艏部开敞甲板与艉部驾驶室前面那一小片。住家船的舷侧被花箱占了，往中间收。 */
const DECK_SLOTS_HOME = [[15.2, 0.1], [16.7, 0.7], [17.9, -0.5], [15.8, -0.9],
                         [-9.4, 0.2], [-10.6, -0.6], [-7.3, 0.5], [-8.4, -0.9]];
const DECK_SLOTS_WORK = [[15.4, 0.0], [16.9, 1.1], [17.8, -1.1], [14.2, -0.8],
                         [-9.6, 1.1], [-11.4, -1.0], [-12.5, 0.6], [-10.4, -0.1]];
/* 一条船摆几件、摆什么。长尾：多数船甲板上只有两三件，少数堆得满满当当。 */
function deckItems(prof, variant){
  const D = C.peniche, yD = D.free;
  const slots = variant === 'home' ? DECK_SLOTS_HOME : DECK_SLOTS_WORK;
  const n = 2 + Math.floor(PC.vary.head(prof.f(131), 1.8) * 3.6);      // 2–5 件
  const st = Math.floor(prof.f(133) * slots.length);
  const out = [];
  for (let i = 0; i < n; i++){
    const sl = slots[(st + i) % slots.length];
    const u = prof.f(149 + i * 11);
    let t = 0, sx = 0.9, sy = 0.6, sz = 0.7, fam = PC.families.deckJunk;
    if (variant === 'home'){
      if (u < 0.40){ t = 0; sx = 0.72; sy = 0.66; sz = 0.64; fam = PC.families.foliage; }
      else if (u < 0.74){ t = 0; sx = 0.86; sy = 0.54; sz = 0.70; }
      else { t = 1; sx = 0.48; sy = 0.58; sz = 0.48; }                 // 水桶
    } else if (variant === 'cargo'){
      if (u < 0.44){ t = 1; sx = 0.60; sy = 0.90; sz = 0.60; }         // 油桶
      else if (u < 0.72){ t = 0; sx = 1.10; sy = 0.76; sz = 0.92; }    // 木箱
      else { t = 1; sx = 1.00; sy = 0.20; sz = 1.00; }                 // 缆盘
    } else {
      if (u < 0.45){ t = 0; sx = 0.80; sy = 0.72; sz = 0.72; fam = PC.families.foliage; }
      else if (u < 0.78){ t = 0; sx = 0.92; sy = 0.50; sz = 0.74; }
      else { t = 1; sx = 0.54; sy = 0.66; sz = 0.54; }
    }
    const k = 0.86 + prof.f(157 + i * 7) * 0.30;
    out.push({t, x: sl[0], y: yD, z: sl[1], sx, sy, sz,
              spin: prof.f(163 + i * 5) * TAU,
              hex: fam[Math.floor(prof.f(167 + i * 3) * fam.length) % fam.length], k});
  }
  /* 货驳按吃水分装载状态：多数装着砂砾（舱口那一大堆），少数空舱高高浮着 */
  if (variant === 'cargo' && prof.f(151) > 0.34)
    out.push({t: 0, load: true, x: 2.0, y: yD + C.peniche.hold - 0.06, z: 0,
              sx: C.peniche.L * 0.50, sy: 0.34 + prof.f(153) * 0.42, sz: C.peniche.B - 2.9,
              spin: 0, hex: PC.palette.sand, k: 0.88 + prof.f(155) * 0.22});
  return out;
}

/* 驳船船体从 PC.families.boatHull 抽，但要避开两端：
   纯白留给观光船（卖票的船要好看）；近黑那一支直接抽会连带把驾驶室染黑——
   驾驶室的浅色是靠顶点色在船体色上「乘」出来的，底色太深就乘不出白，
   所以近黑按 PC.palette.zinc 提一档。它仍是一条黑船，只是提得起白。 */
const PEN_HULL = [1, 2, 3, 4, 5];       // 深绿 / 藏蓝 / 近黑 / 锈红 / 灰
function penHull(k){
  const F = PC.families.boatHull, h = F[PEN_HULL[k % PEN_HULL.length]];
  return h === F[3] ? mixHex(h, PC.palette.zinc, 0.55) : h;
}
/* 每一支船漆的目标亮度（线性）。族色定色相，这张表定「在这套曝光下深到什么程度」。
   为什么要这一步：族色是 sRGB 描述值，直接转线性会掉到 0.02–0.06，
   在河上读出来是一条黑影，船身整个消失、只剩驾驶室浮在水面（实测 r1cu-C）。
   0.10–0.24 是旧版那个能读出船身的档，保留它，只把色相换成真实船漆。 */
const PEN_LUM = [0.125, 0.115, 0.105, 0.155, 0.230];
function hullLift(col, target){
  const l = col.r * 0.2126 + col.g * 0.7152 + col.b * 0.0722;
  return col.multiplyScalar(target / Math.max(1e-4, l));
}
/* 给一条驳船「上装」：船体漆 / 舱室漆 / 棚布 / 甲板杂物。
   四样全由同一份档案驱动——漆褪到什么程度、锈多重、甲板上堆多少东西，
   是同一件事（这条船有多老、主人多上心）的四个侧面，不是四次独立随机。 */
function dressBarge(b, cbuf){
  const pr = b.prof, v = b.variant;
  const hk = Math.floor(pr.f(171) * PEN_HULL.length) % PEN_HULL.length;
  /* 老船的漆更暗更哑（褪 + 积垢），但仍在能读出船身的那一档里 */
  b.hull = hullLift(PC.vary.shade(penHull(hk), pr, cbuf).clone(),
                    PEN_LUM[hk] * (1 - pr.age * 0.24));
  if (v === 'home')
    b.cabin = PC.vary.shade(pr.pick(PC.families.boatCabin, 173), pr, cbuf).clone();
  if (v === 'bar'){
    /* 遮阳篷抽前五支：族里最后那支近黑是给店铺雨篷的，挂到水上餐吧上
       只剩一副骨架，晚上更是什么都没有（实测 r5-w7-dusk）。
       再往白里提 22%：这是晒了几个夏天的帆布，不是刚染出来的布样。 */
    b.awn = PC.vary.shade(
      mixHex(PC.families.awning[Math.floor(pr.f(177) * 5) % 5], 0xffffff, 0.22), pr, cbuf).clone();
    b.lit = pr.f(179) > 0.24;            // 少数餐吧没挂串灯
  }
  b.deck = deckItems(pr, v);
  /* 吃水跟着载荷走：舱里堆着砂砾的货驳压得深，空舱的高高浮着。
     一排驳船里有高有低，比五条一样高的船更像一条在干活的河。
     0.42m 是 Freycinet 空载与满载吃水差的量级，别再深了——再深驾驶室要进水。 */
  const load = b.deck.reduce((s, it) => s + (it.load ? it.sy : 0), 0);
  b.draft = clamp(load * 0.52 + pr.age * 0.10, 0, 0.42);
  const e = new THREE.Euler(), q = new THREE.Quaternion(),
        p = new THREE.Vector3(), s = new THREE.Vector3();
  for (const it of b.deck){
    e.set(0, it.spin, 0); q.setFromEuler(e);
    p.set(it.x, it.y, it.z); s.set(it.sx, it.sy, it.sz);
    it.m = new THREE.Matrix4().compose(p, q, s);
    it.col = PC.vary.shade(it.hex, pr, cbuf).clone().multiplyScalar(it.k);
  }
}

/* 9.5 航道：把 t 映射到一条不撞岛的横向偏移 */
function buildLanes(riv){
  const N = 300, cR = new Float64Array(N), cL = new Float64Array(N);
  for (let i = 0; i < N; i++){
    const b = riv.banks(i / (N - 1));
    let r, l;
    if (b.isl && Math.abs(b.isl[1] - b.isl[0]) > 6){
      const wR = b.isl[0] - b.br, wL = b.bl - b.isl[1];
      r = (b.br + b.isl[0]) / 2; l = (b.isl[1] + b.bl) / 2;
      if (wR < C.laneMinW) r = l;          // 小汊走不了，改走大汊
      if (wL < C.laneMinW) l = r;
    } else {
      const half = Math.min(15, (b.bl - b.br) * 0.15);
      r = -half; l = half;
    }
    cR[i] = r; cL[i] = l;
  }
  const smooth = a => { let x = a;
    for (let p = 0; p < 6; p++){ const o = new Float64Array(x.length);
      for (let i = 0; i < x.length; i++){ let s = 0, c = 0;
        for (let k = -3; k <= 3; k++){ const j = clamp(i+k, 0, x.length-1); s += x[j]; c++; }
        o[i] = s / c; } x = o; }
    return x; };
  const SR = smooth(cR), SL = smooth(cL);
  return function lane(t, ch){
    const f = clamp(t, 0, 1) * (N - 1), k = Math.min(N - 2, Math.floor(f)), g = f - k;
    return ch < 0 ? lerp(SR[k], SR[k+1], g) : lerp(SL[k], SL[k+1], g);
  };
}

/* 9.5b 桥孔避让
   已知问题：航道只保证走在河汊中心，桥墩在哪它不管，于是船直接穿墩而过。
   plan.bridges 只给了 x/z/t/跨数/桥长/方位角——没有逐墩坐标，也不需要：
   把桥长按跨数等分，每一跨的中点就是那一孔的中心，投到河法线上就是一个横向偏移。
   再拿 river.banks(t) 把落在陆地和岛上的那些「孔」筛掉（新桥 232m 跨着西岱岛，
   12 孔里有一半压根在岛上），剩下的才是真的能走船的桥孔。 */
function buildGates(riv, bridges, lane){
  const gates = [];
  for (const b of (bridges || [])){
    const arches = Math.max(1, b.arches | 0);
    const a = riv.at(b.t), bk = riv.banks(b.t);
    const d = b.dir || [1, 0];
    const dn = d[0] * a.nx + d[1] * a.nz;               // 桥轴在河法线上的投影
    if (Math.abs(dn) < 0.25) continue;                  // 桥几乎顺着河，这套等分没意义
    const offC = (b.x - a.x) * a.nx + (b.z - a.z) * a.nz;
    const half = (b.lengthM || 100) / 2;
    const span = 2 * half / arches;
    const offs = [];
    for (let i = 0; i < arches; i++){
      const off = offC + (-half + (i + 0.5) * span) * dn;
      if (off > bk.bl - 10 || off < bk.br + 10) continue;              // 落在岸上
      if (bk.isl && off > bk.isl[0] - 10 && off < bk.isl[1] + 10) continue;   // 落在岛上
      offs.push(off);
    }
    if (!offs.length) continue;
    /* ── 光把船横挪到孔中心还不够 ──
       船是 38m 的刚体，桥孔净宽只有 19–22m。塞纳河在新桥、艺术桥这些地方
       和桥面并不垂直，船若仍顺着河道方向斜着穿，艏艉会甩到隔壁墩上
       （实测新桥右汊 0.9m、艺术桥 0.3m —— 等于穿墩）。
       真实的开法是过桥前把船摆正、垂直于桥面穿孔、过了再拐回航道。
       做法：给这一段航道一个斜率 k，让「中线 + 法线×偏移」这条路径的切线
       正好指向桥面法向。α/β 是桥面法向在河道 (切向, 法向) 基里的分量。 */
    const dperpX = -d[1], dperpZ = d[0];
    let al = dperpX * a.tx + dperpZ * a.tz, be = dperpX * a.nx + dperpZ * a.nz;
    if (al < 0){ al = -al; be = -be; }                 // 取顺流那一支
    const k = Math.abs(al) < 0.25 ? 0 : clamp(be / al, -0.62, 0.62);
    /* 「走哪一孔」在建表时就替每条航道定死。
       原来每帧拿当前航道偏移去找最近的孔，可航道偏移是随 t 慢慢漂的：
       只要它漂到两个孔的正中间（艺术桥右汊恰好如此，孔在 −6.7 和 −28.8，
       航道在 −17 上下），选中的孔就会来回跳，船一帧里横移二十米，
       艏艉扫到墩上。参照点改成**桥位处**那个固定的航道偏移，答案就只有一个。 */
    const pick = {};
    for (const ch of [-1, 1]){
      const ref = lane(b.t, ch);
      let c = null, d = 1e9;
      for (const o of offs){ const dd = Math.abs(o - ref); if (dd < d && dd <= 58){ d = dd; c = o; } }
      pick[ch] = c;
    }
    if (pick[-1] === null && pick[1] === null) continue;
    gates.push({t: b.t, offs: offs, pick: pick, k: k, halfSpan: Math.abs(span * dn) / 2});
  }
  return gates;
}
/* 把名义航道偏移 off 拉到最近那个桥孔中心。
   参照量用的是**未修正的**航道偏移，所以「走哪一孔」在整个过桥过程里是同一个
   答案，不会走到一半改主意。
   两件事必须同时成立，缺一条都会撞墩：
   ① 权重曲线在桥心处的**导数必须为零**。用 (1−arc/L)^n 这种在桥心导数最大的
      曲线，最后十几米横向偏移变化最快 —— 航向是由路径差分求的，于是船
      恰好在桥孔里横过来 48°，艏艉直接甩到隔壁墩上（实测新桥右汊 0.9m）。
      改成 smoothstep：两端导数都为零，最陡的地方落在离桥 120m 的空水面上。
   ② 多桥同时在射程内要按权重求平均，不能「谁权重高听谁的」——圣母院那一带
      小桥/双币桥/阿尔科勒桥彼此只隔 140m，取胜者会在两桥中间瞬间换目标。
      混合权重取 w⁴（本桥 1、140m 外的邻桥只剩 0.02），过渡量取 max(w)。 */
function gateAdjust(gates, riv, t, ch, off){
  let sw = 0, st = 0, maxW = 0;
  for (const g of gates){
    const arc = Math.abs(t - g.t) * riv.len;
    if (arc > C.gateArc) continue;
    const c = g.pick[ch];
    if (c === null || c === undefined) continue;   // 这座桥不跨这条航道
    /* ds 是带符号的弧长：目标偏移沿 k 斜着走，路径切线才会转到桥面法向上 */
    const ds = (t - g.t) * riv.len;
    const tgt = c + clamp(ds * g.k, -g.halfSpan * 1.6, g.halfSpan * 1.6);
    const u = arc / C.gateArc;
    const w = 1 - u * u * (3 - 2 * u);        // smoothstep 的补，两端导数为 0
    const mw = w * w * w * w;
    sw += mw; st += mw * tgt;
    if (w > maxW) maxW = w;
  }
  if (!(sw > 1e-6)) return off;
  return lerp(off, st / sw, Math.min(1, maxW));
}

/* 9.6 岸线碰撞：把全部挡墙的**最外那条棱**（水下直墙，u = −revet）按 3m 采样进
   一张 24m 网格哈希，泊船摆位时就地查一次。全城约六千个点，建表 <2ms。 */
function buildWallGrid(QS){
  const cell = 24, g = new Map(), tmp = {};
  for (const Q of QS){
    const path = Q.path;
    for (let s = 0; s <= path.len; s += 3){
      const p = P3(path, s, -C.revet, 0, tmp);
      const k = Math.floor(p[0] / cell) * 100003 + Math.floor(p[2] / cell);
      let a = g.get(k); if (!a) g.set(k, a = []);
      a.push(p[0], p[2]);
    }
  }
  return {cell, g};
}
/* 船当成一个 2hl × 2hb 的盒子（d=艏艉向，n=朝水的侧向）。
   返回 near = 贴岸那侧被墙吃进来多少米，far = 河心那侧被顶了多少米。 */
function wallPush(WG, cx, cz, dx, dz, nx, nz, hl, hb){
  const R = hl + hb + 2, cell = WG.cell;
  let near = 0, far = 0;
  const i0 = Math.floor((cx - R) / cell), i1 = Math.floor((cx + R) / cell);
  const j0 = Math.floor((cz - R) / cell), j1 = Math.floor((cz + R) / cell);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++){
    const a = WG.g.get(i * 100003 + j);
    if (!a) continue;
    for (let k = 0; k < a.length; k += 2){
      const ex = a[k] - cx, ez = a[k+1] - cz;
      if (Math.abs(ex * dx + ez * dz) > hl) continue;
      const v = ex * nx + ez * nz;
      if (v <= -hb || v >= hb) continue;
      if (v <= 0){ const p = hb + v; if (p > near) near = p; }
      else       { const p = hb - v; if (p > far)  far  = p; }
    }
  }
  return {near, far};
}

let laneAt = null, GATES = null;
function buildBoats(ctx, QS){
  const {THREE, plan} = ctx, Y = PC.Y, riv = plan.river;
  laneAt = buildLanes(riv);
  GATES = buildGates(riv, plan.bridges, laneAt);

  const M = PC.mats(), SC = M.SC;
  const tg = tourGeoms();
  /* 材质色一律白：这条船到底是什么颜色，由 instanceColor 说了算。
     顶点色只负责「同一条船身上哪儿深哪儿浅」（吃水线、窗带、舱盖）。 */
  const matHull  = M.std({color: 0xffffff,
                          roughness: 0.42, metalness: 0.06, envMapIntensity: 0.9, vertexColors: true});
  /* 玻璃：压深压实。旧版是「亮玻璃 + 0.42 不透明度」，贴在白船体上等于没有；
     观光船在河上真正读得出的就是舷侧那条深色玻璃带。 */
  const matGlass = M.std({color: SC(shade(PC.palette.slate, 0.78)), roughness: 0.09, metalness: 0.42,
                          transparent: true, opacity: 0.74, envMapIntensity: 1.8});
  const matPen   = M.std({color: 0xffffff, roughness: 0.68, metalness: 0.22,
                          envMapIntensity: 0.8, vertexColors: true});
  const matHome  = M.std({color: 0xffffff, roughness: 0.85, metalness: 0.05,
                          envMapIntensity: 0.6, vertexColors: true});
  const matAwn   = M.std({color: 0xffffff, roughness: 0.78, metalness: 0.03,
                          envMapIntensity: 0.6, side: THREE.DoubleSide});
  const matClut  = M.std({color: 0xffffff, roughness: 0.88, metalness: 0.04, envMapIntensity: 0.55});
  /* 逐实例风化：底部积污 + 朝上的面磨损。y0/y1 各自对准自己的吃水线／甲板，
     所以同一条船身上也有新有旧——这一层只改 instanceColor 是做不出来的。 */
  PC.varyShader(matHull, {y0: -0.10, y1: 0.80, wearColor: 0xdcd8cc, key: 'tour'});
  PC.varyShader(matPen,  {y0: -0.20, y1: 1.35, wearColor: 0x9a8470, key: 'pen'});
  PC.varyShader(matHome, {y0: C.peniche.free, y1: C.peniche.free + 1.6,
                          wearColor: 0xd2cbba, key: 'home'});

  const NT = C.nTour, NP = C.nMoored + C.nCargo;
  tourPool  = PC.pool(tg.hull,  matHull,  NT, {castShadow: true,  receiveShadow: false,
                                               colors: true, vary: true});
  glassPool = PC.pool(tg.glass, matGlass, NT, {castShadow: false, receiveShadow: false});
  penPool   = PC.pool(penicheGeom(), matPen, NP, {castShadow: true, receiveShadow: false,
                                                  colors: true, vary: true});
  homePool  = PC.pool(homeGeom(), matHome, C.nHomeMax,
                      {castShadow: true, receiveShadow: false, colors: true, vary: true});
  barPool   = PC.pool(barGeom(), M.std({color: SC(mixHex(PC.palette.shopPaints[3], 0xffffff, 0.22)),
                        roughness: 0.6, metalness: 0.1, envMapIntensity: 0.7}), C.nBarMax,
                      {castShadow: true, receiveShadow: false});
  awnPool   = PC.pool(awnGeom(), matAwn, C.nBarMax,
                      {castShadow: true, receiveShadow: false, colors: true});
  bulbPool  = PC.pool(bulbGeom(), M.std({color: SC(0xffe0a8), roughness: 0.4, metalness: 0,
                        emissive: SC(0xffb864), emissiveIntensity: 1.15, envMapIntensity: 0.4}),
                      C.nBarMax, {castShadow: false, receiveShadow: false});
  /* 甲板杂物：22 条泊船／货驳 × 最多 6 件 */
  const CLUT = (C.nMoored + C.nCargo) * 6;
  clutBoxPool = PC.pool(clutBoxGeom(), matClut, CLUT, {castShadow: true, receiveShadow: false, colors: true});
  clutCylPool = PC.pool(clutCylGeom(), matClut, CLUT, {castShadow: true, receiveShadow: false, colors: true});
  ROOT.add(tourPool.mesh, glassPool.mesh, penPool.mesh, homePool.mesh,
           barPool.mesh, awnPool.mesh, bulbPool.mesh, clutBoxPool.mesh, clutCylPool.mesh);

  boats = [];
  /* 游船 ×10（其中 2 条小游艇）：沿河双向巡航。
     t 上做一次 warp，把船往市中心那段压密——两端（叙利桥外 / 铁塔以西）
     本来就没人开游船，均匀撒等于把一半的船浪费在没人看的地方。 */
  const warp = u => clamp(u + C.tourWarp * Math.sin(TAU * u), 0, 1);
  const HOME = {};                       // 建档用的「母港」位置（船在动，档案不能跟着变）
  const cbuf = new THREE.Color();
  for (let i = 0; i < NT; i++){
    const vede = i >= NT - C.nVedette;
    const u = warp((i + 0.5) / NT + (PC.hash2(i, 7, 5) - 0.5) * 0.022);
    const t0 = C.tMin + (C.tMax - C.tMin) * u;
    /* 船公司：十条游船分属三家，同一家是同年下水、同一套漆——所以 batch 取船队号。
       同队之内仍有个体差（有的刚进过坞，有的一年没洗），批间的均值差才是主要的。 */
    const fleet = i % 3;
    boatXZ(riv, t0, i % 2 ? -1 : 1, HOME);
    const pr = condition(PC.vary.of('boat', HOME.x, HOME.z, fleet), 2.6);
    /* 观光船是拿来卖票的，天天洗——比货驳干净一大截，所以再压一档 */
    pr.age *= 0.62; pr.grime *= 0.55; pr.moss *= 0.35;
    boats.push({kind: 'tour', scale: vede ? C.vedetteScale : 1,
      t: t0,
      dir: i % 2 ? 1 : -1, ch: i % 2 ? -1 : 1,
      speed: (vede ? C.mouchSpeed * 1.25 : C.mouchSpeed) * (0.9 + PC.hash2(i, 3, 11) * 0.24),
      moving: true, rev: 1, phase: i * 1.7,
      prof: pr,
      hull: PC.vary.shade(PC.families.boatTour[fleet % PC.families.boatTour.length], pr, cbuf).clone()});
  }
  /* 货驳 ×2：缓速航行 */
  for (let i = 0; i < C.nCargo; i++){
    const t0 = 0.24 + i * 0.34;
    boatXZ(riv, t0, i ? 1 : -1, HOME);
    const pr = condition(PC.vary.of('barge', HOME.x, HOME.z), 2.0);
    const b = {kind: 'pen', variant: 'cargo', scale: 1,
      t: t0, dir: i ? 1 : -1, ch: i ? 1 : -1,
      speed: C.cargoSpeed, moving: true, rev: 1, phase: i * 2.4, prof: pr};
    dressBarge(b, cbuf);
    boats.push(b);
  }
  /* 驳船 ×18：泊在岸边不动。
     ── 为什么改成成组 ──
     旧写法在全城候选泊位里随机挑 14 个、彼此至少隔 130m。结果是「每 130m 一条
     孤船」，而真实巴黎的河岸驳船是**连着停的**：一段岸空着，另一段挤四五条，
     舷靠舷，中间隔七八米。所以先沿每条岸扫出连续可泊的**泊位链**，
     再在链上取一段连号的 3–5 个泊位当一簇，簇与簇之间隔开 300m。
     ── 摆位前对岸线做一次碰撞退让 ──
     旧写法拿 plan.quays 折线**某一段**的方向当船的朝向，再横推半个船宽。
     船是 38.5m 的刚体，岸是弯的：一段折线在船长范围内能拐好几度，
     两头就插进挡墙里去了（t-water-cu-6 左下那条餐吧驳船）。
     现在改成：朝向取挡墙那条重采样路径在 ±半船长处的弦向（船怎么靠，弦就怎么走），
     再拿全部岸墙采样点做一次侧向侵入检测，不够就往河心退，退不出来就放弃这个泊位。 */
  const WG = buildWallGrid(QS);
  const HL = C.peniche.L / 2 + 0.6;         // 半船长 + 余量
  const HB = C.peniche.B / 2 + 1.1;         // 半船宽 + 靠帮余量
  const OFF0 = C.revet + C.peniche.B / 2 + 1.9;   // 名义靠帮距（从墙最外那条棱起算）
  const brg = plan.bridges || [];
  const chains = [];                      // 每条 = 沿同一段岸连续可泊的泊位序列
  const A = {}, B = {}, M0 = {};
  for (const Q of QS){
    if (Q.isle || !Q.bwNom || !Q.q.hasBerge || Q.path.len < 220) continue;
    const path = Q.path;
    let cur = [];
    for (let s = 60; s < path.len - 60; s += C.berthStep){
      path.at(s, M0);
      path.at(clamp(s - HL, 0, path.len), A);
      path.at(clamp(s + HL, 0, path.len), B);
      let dx = B.x - A.x, dz = B.z - A.z;
      const L = Math.hypot(dx, dz);
      let ok = L >= 1;
      let cx = 0, cz = 0, ang = 0;
      if (ok){
        dx /= L; dz /= L;
        const ox = -M0.nx, oz = -M0.nz;                     // 内陆法线取反 = 朝水
        cx = M0.x + ox * OFF0; cz = M0.z + oz * OFF0;
        /* 桥墩底下不泊船 */
        if (brg.some(b => Math.hypot(b.x - cx, b.z - cz) < C.bridgeKeep)) ok = false;
        if (ok){
          /* 侧向法线取朝水那一支——退让只许往河心走，不许往墙里走。
             翻了法线就把船整个掉头（ang + π），这样**局部 +Z 永远朝河**，
             串灯、遮阳棚檐、甲板绿植才不会有一半贴在挡墙上看不见。 */
          let nx = -dz, nz = dx, flip = false;
          if (nx * ox + nz * oz < 0){ nx = -nx; nz = -nz; flip = true; }
          let push = 0;
          for (let it = 0; it < 3; it++){
            const pen = wallPush(WG, cx + nx * push, cz + nz * push, dx, dz, nx, nz, HL, HB);
            if (pen.far > 0.01){ ok = false; break; }       // 河心一侧也顶住了：这段太窄
            if (pen.near < 0.02) break;
            push += pen.near;
            if (push > 5.5){ ok = false; break; }           // 要退这么多，说明岸弯得离谱
          }
          if (ok){
            cx += nx * push; cz += nz * push;
            /* 第二道闸：船的四角必须都落在 river.inWater 里。
               上面那道闸问的是「有没有撞上挡墙几何」，这道问的是「在不在河里」——
               两者的数据源不同（挡墙走 plan.quays 的重采样路径，inWater 走 OSM 岸线
               断面），岸线拐急的地方两者能差出几米，只过第一道闸就会出现
               「驳船停在码头石板上」（实测叙利桥外那一簇 5 条里 4 条如此）。 */
            const hl2 = C.peniche.L / 2 - 1, hb2 = C.peniche.B / 2;
            for (const sa of [-1, 0, 1]) for (const sb of [-1, 1]){
              if (!riv.inWater(cx + dx * hl2 * sa + nx * hb2 * sb,
                               cz + dz * hl2 * sa + nz * hb2 * sb)){ ok = false; break; }
            }
            if (ok) ang = Math.atan2(-dz, dx) + (flip ? Math.PI : 0);
          }
        }
      }
      if (!ok){ if (cur.length >= C.groupMin) chains.push(cur); cur = []; continue; }
      cur.push({x: cx, z: cz, ang: ang, side: Q.q.side});
    }
    if (cur.length >= C.groupMin) chains.push(cur);
  }
  /* 在链上截连号的一段当一簇。链按哈希打乱，保证每次刷新落在同样的岸段上。 */
  chains.forEach((c, i) => { c.sort = PC.hash2(c[0].x, c[0].z, 31); });
  chains.sort((a, b) => a.sort - b.sort);
  const groups = [];
  let placed = 0;
  for (const ch of chains){
    if (placed >= C.nMoored) break;
    const h = PC.hash2(ch[0].x, ch[0].z, 37);
    const n = Math.min(C.groupMin + Math.floor(h * (C.groupMax - C.groupMin + 1)),
                       ch.length, C.nMoored - placed);
    if (n < 2) continue;
    const st = Math.floor(PC.hash2(ch[0].z, ch[0].x, 41) * (ch.length - n + 1));
    const run = ch.slice(st, st + n);
    const c0 = run[Math.floor(n / 2)];
    if (groups.some(g => Math.hypot(g.c.x - c0.x, g.c.z - c0.z) < C.groupSep)) continue;
    groups.push({c: c0, run: run});
    placed += n;
  }
  /* 一簇里的变体：真实河岸是一排住家船里夹一两条货驳，餐吧一簇最多一条。
     所以变体按簇给，不按船给——按船随机会变成「住家、餐吧、货驳」轮着排的样品陈列。 */
  let barLeft = C.nBarMax, homeLeft = C.nHomeMax, gi = 0, mooredN = 0;
  for (const g of groups){
    const h = PC.hash2(g.c.x, g.c.z, 43);
    const dom = h < 0.62 ? 'home' : 'cargo';
    g.run.forEach((p, k) => {
      let v = dom;
      if (k === (gi % g.run.length) && barLeft > 0 && h > 0.22){ v = 'bar'; barLeft--; }
      else if (PC.hash2(p.x, p.z, 47) > 0.78) v = dom === 'home' ? 'cargo' : 'home';
      if (v === 'home'){ if (homeLeft > 0) homeLeft--; else v = 'cargo'; }   // 池上限兜底
      /* 泊船是一船一个主人：不给 batch，个体档案各自独立。
         （游船才是成队的——那才该共享 batch。） */
      const pr = condition(PC.vary.of('barge', p.x, p.z), v === 'home' ? 2.8 : 2.0);
      const b = {kind: 'pen', variant: v, moving: false,
                 x: p.x, z: p.z, ang: p.ang, phase: (gi * 3 + k) * 0.9, prof: pr};
      dressBarge(b, cbuf);
      boats.push(b);
      mooredN++;
    });
    gi++;
  }
  BUDGET.mooredGroups = groups.length;
  BUDGET.moored = mooredN;

  /* ══ 尾迹 ══
     旧实现记一条「每 7m 一个点」的历史轨迹，靠 live=(轨迹点数−2)/3 淡入。
     4m/s 下攒够 5 个点要 9 秒——四张验收截图都在这 9 秒里拍的，所以「做了尾迹」
     和「一条尾迹都看不见」同时成立。改成解析式：船在 t 上，尾迹第 k 站就是
     t − dir·k·8m/riverLen 那个位置，第一帧就是完整的。掉头时用 rev 淡入，
     免得航迹瞬间翻到船头前面去。
     形体也重做：一条等宽白带读不出 V。每站 6 个顶点——两条亮的发散波臂 +
     中间偏暗的搅动带 + 两侧渐隐到 0 的外缘。 */
  const movers = boats.filter(b => b.moving).length;
  const SEG = C.wakeSeg, VPS = 6;
  const vcount = movers * (SEG + 1) * VPS;
  wakeGeo = new THREE.BufferGeometry();
  wakeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vcount * 3), 3));
  wakeGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vcount * 4), 4));
  const wi = [];
  for (let b = 0; b < movers; b++){
    const o = b * (SEG + 1) * VPS;
    for (let k = 0; k < SEG; k++){
      const a = o + k * VPS, c = a + VPS;
      for (let j = 0; j < VPS - 1; j++) wi.push(a + j, a + j + 1, c + j + 1, a + j, c + j + 1, c + j);
    }
  }
  wakeGeo.setIndex(wi);
  wake = new THREE.Mesh(wakeGeo, new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, vertexColors: true, depthWrite: false,
    depthTest: true, side: THREE.DoubleSide, toneMapped: false
  }));
  wake.frustumCulled = false; wake.renderOrder = 6;
  ROOT.add(wake);
  BUDGET.boats = boats.length;
  BUDGET.wakeSeg = SEG;
  BUDGET.wakeTris = movers * SEG * (VPS - 1) * 2;

  /* 桥下净空自检：船顶不得高于最低桥腹 */
  const topH = C.mouche.free + C.mouche.canopy + C.mouche.rail + 0.2;
  BUDGET.boatTopAboveWater = +topH.toFixed(2);
  BUDGET.minClearance = +(Math.abs(Y.water) - 1.2 - topH).toFixed(2);   // 桥面 0、板厚约 1.2m
}

/* ══════════════════ 10. 每帧更新 ══════════════════ */
/* 航道上某一点的世界坐标（已含桥孔避让）。船位、航向差分、尾迹每一站都走这里，
   所以尾迹永远贴着船真正走过的那条线，过桥时一起拐进桥孔。 */
const P0 = {}, P1 = {}, P2 = {};
function boatXZ(riv, t, ch, o){
  const a = riv.at(t);
  const raw = laneAt(t, ch);
  const off = GATES && GATES.length ? gateAdjust(GATES, riv, t, ch, raw) : raw;
  o.x = a.x + a.nx * off; o.z = a.z + a.nz * off;
  o.tx = a.tx; o.tz = a.tz; o.nx = a.nx; o.nz = a.nz;
  return o;
}
/* 尾迹横断面：外缘 → 发散波臂 → 搅动带 → 波臂 → 外缘。
   一条等宽白带读不出 V，两条亮臂才读得出。亮臂要窄（从 ±1 到 ±0.34 之间起一道脊），
   摊太宽就变成一片没有形状的雾——旧参数（±0.52 起、峰值 0.5）在 9:00 的碎金
   光带上直接消失，这一版把峰值提到 0.86、衰减指数从 1.35 压到 0.85。 */
const WAKE_LAT  = [-1, -0.68, -0.34, 0.34, 0.68, 1];
const WAKE_ARM  = [0, 1, 0.22, 0.22, 1, 0];
const WAKE_BOIL = [0, 0.60, 1, 1, 0.60, 0];

const _s = {};
function updateBoats(ctx, dt){
  const {THREE, plan} = ctx, Y = PC.Y, riv = plan.river;
  if (!laneAt) return;
  const m = _s.m || (_s.m = new THREE.Matrix4());
  const qt = _s.q || (_s.q = new THREE.Quaternion());
  const eu = _s.e || (_s.e = new THREE.Euler());
  const pv = _s.p || (_s.p = new THREE.Vector3());
  const sv = _s.s || (_s.s = new THREE.Vector3());
  const mm = _s.mm || (_s.mm = new THREE.Matrix4());

  tourPool.reset(); glassPool.reset(); penPool.reset();
  homePool.reset(); barPool.reset(); awnPool.reset(); bulbPool.reset();
  clutBoxPool.reset(); clutCylPool.reset();
  const wpos = wakeGeo.attributes.position.array, wcol = wakeGeo.attributes.color.array;
  const SEG = BUDGET.wakeSeg, VPS = 6;
  const dT = 7 / riv.len;                      // 求航向用的差分步长（±7m 弧长）
  let wIdx = 0;

  for (const b of boats){
    let x, z, ang, roll;
    if (b.moving){
      b.t += b.dir * b.speed / riv.len * dt;
      if (b.t > C.tMax){ b.t = C.tMax; b.dir = -1; b.rev = 0; }
      if (b.t < C.tMin){ b.t = C.tMin; b.dir = 1; b.rev = 0; }
      b.rev = Math.min(1, (b.rev === undefined ? 1 : b.rev) + dt / 5);
      boatXZ(riv, b.t, b.ch, P0);
      x = P0.x; z = P0.z;
      /* 航向由前后各 7m 两点的弦给，不再直接取河道切线——
         过桥时船要横向挪进桥孔，只跟切线的话船会「横着平移」，
         看得出来是在滑不是在开。 */
      boatXZ(riv, clamp(b.t - dT * b.dir, 0, 1), b.ch, P1);
      boatXZ(riv, clamp(b.t + dT * b.dir, 0, 1), b.ch, P2);
      let hx = P2.x - P1.x, hz = P2.z - P1.z;
      if (Math.hypot(hx, hz) < 1e-4){ hx = P0.tx * b.dir; hz = P0.tz * b.dir; }
      ang = Math.atan2(-hz, hx);
      roll = Math.sin(TIME * 0.9 + b.phase) * 0.010;
    } else {
      x = b.x; z = b.z; ang = b.ang;
      roll = Math.sin(TIME * 0.55 + b.phase) * 0.006;
    }
    /* 本帧解算出来的世界位姿留在船对象上：自校验脚本要靠它把相机摆到船的侧后方，
       否则外面只能拿河道中线当参照——中线在西岱岛那一段是从岛上穿过去的，
       照着它摆相机会摆进楼里。 */
    b.wx = x; b.wz = z; b.wang = ang;
    const bob = Math.sin(TIME * 0.75 + b.phase * 1.3) * 0.055;
    eu.set(roll * 0.6, ang, roll); qt.setFromEuler(eu);
    pv.set(x, Y.water + bob - (b.draft || 0), z);

    if (b.kind === 'tour'){
      sv.set(b.scale, b.scale, b.scale);
      m.compose(pv, qt, sv);
      tourPool.push(m, b.hull, b.prof); glassPool.push(m);
    } else {
      sv.set(1, 1, 1);
      m.compose(pv, qt, sv);
      /* 船体色与风化档案都是建船时定死的（位置哈希），这里只是把它推进池——
         相机走开再走回来，同一条船一定还是同一条船。 */
      penPool.push(m, b.hull, b.prof);
      if (b.variant === 'home') homePool.push(m, b.cabin, b.prof);
      else if (b.variant === 'bar'){
        barPool.push(m); awnPool.push(m, b.awn);
        if (b.lit) bulbPool.push(m);
      }
      /* 甲板杂物跟着船一起起伏横摇：用本帧的船位姿左乘物件的局部矩阵。
         mm 复用，局部矩阵建船时就算好了——update() 里零分配。 */
      if (b.deck) for (let i = 0; i < b.deck.length; i++){
        const it = b.deck[i];
        mm.multiplyMatrices(m, it.m);
        (it.t ? clutCylPool : clutBoxPool).push(mm, it.col);
      }
    }

    /* ── 尾迹（解析式：第 k 站 = 船 k·8m 之前待过的地方） ── */
    if (b.moving){
      const base = wIdx * (SEG + 1) * VPS;
      const beam = b.kind === 'tour' ? C.mouche.B * b.scale : C.peniche.B;
      const halfL = (b.kind === 'tour' ? C.mouche.L * b.scale : C.peniche.L) / 2;
      const live = clamp(b.rev === undefined ? 1 : b.rev, 0, 1);
      const back = C.wakeStep / riv.len;
      for (let k = 0; k <= SEG; k++){
        /* k=0 落在船尾，不落在船中 */
        const tk = clamp(b.t - b.dir * (halfL / riv.len + k * back), 0, 1);
        boatXZ(riv, tk, b.ch, P0);
        const nx = P0.nx, nz = P0.nz;
        /* 宽度：船尾从半个船宽起，往后按 ~8° 张开（张太开就不像航迹像扇面） */
        const hw = beam * 0.55 + k * C.wakeStep * 0.115;
        const tail = Math.pow(1 - k / SEG, 1.0);
        const boil = Math.exp(-k * 0.46);                    // 螺旋桨那团白水
        for (let j = 0; j < VPS; j++){
          const a = (WAKE_LAT[j]) * hw;
          const al = clamp(live * (tail * WAKE_ARM[j] * 0.68 + boil * WAKE_BOIL[j] * 0.88), 0, 0.90);
          const o = (base + k * VPS + j) * 3, o4 = (base + k * VPS + j) * 4;
          wpos[o] = P0.x + nx * a; wpos[o+1] = Y.water + 0.16; wpos[o+2] = P0.z + nz * a;
          wcol[o4] = 1; wcol[o4+1] = 1; wcol[o4+2] = 1; wcol[o4+3] = al;
        }
      }
      wIdx++;
    }
  }
  tourPool.commit(); glassPool.commit(); penPool.commit();
  homePool.commit(); barPool.commit(); awnPool.commit(); bulbPool.commit();
  clutBoxPool.commit(); clutCylPool.commit();
  wakeGeo.attributes.position.needsUpdate = true;
  wakeGeo.attributes.color.needsUpdate = true;
}

/* ══════════════════ 11. 模块注册 ══════════════════ */
PC.mod('water', {
  order: 20,
  label: '塞纳河 · 水面/河堤/船',

  async build(ctx){
    const {THREE, scene, plan, step, raf} = ctx;
    if (!plan || !plan.river) throw new Error('PC.plan.river 缺失，water 无从下手');
    ROOT = new THREE.Group(); ROOT.name = 'city-water';
    scene.add(ROOT);

    if (step) step(8, '塞纳河 · 水面');
    await raf();
    buildWaterSurface(ctx);

    if (step) step(12, '塞纳河 · 河堤挡墙');
    await raf();
    const QS = buildQuays(ctx);

    if (step) step(16, '塞纳河 · 旧书摊');
    await raf();
    buildBouquinistes(ctx, QS);

    if (step) step(18, '塞纳河 · 船');
    await raf();
    buildBoats(ctx, QS);

    /* 系缆件必须排在船之后：哪个桩天天被缆绳磨得发亮，得先知道船停在哪 */
    if (step) step(19, '塞纳河 · 系缆');
    await raf();
    buildMoorings(ctx, QS);

    reflInit(THREE);

    /* 实测三角数（1600×1000、city/test.html?m=water）：
       水面 16.7k + 河堤石作 31.5k = 48.2k
       个体差异这一轮的增量（同机位实测，base → 现在）：
         全帧 +12k 三角 / +5 draw call。分别是：船体舷侧按吃水线切三带（+3.2k）、
         旧书摊开着的箱与书堆（+5.4k）、甲板杂物（+1.6k）、餐吧棚布单独一池（+0.1k）。
         逐实例的颜色与风化（instanceColor / aVary）不增 draw call，是免费的。
       （石作比初版的 25.7k 多出来的 5.8k 是两笔：挡墙立面按水线折点分带，
         以及每段端头补的回墙——前者去掉了「整段发灰」，后者堵上了接头的竖缝）
       旧书摊 8.0k + 系缆件 5.6k（LOD 上限）= 13.6k —— 这两项不在「河面+堤」那条预算里
       船 ≈17.4k（本轮预算 18k，未超；从 11.5k 涨上来的是船数 25→32、
         苍蝇船的窗框与艉台、住家船的长舱室、以及重做的 6 顶点尾迹带）
       全模块 ≈67–70k / 10–11 draw call（另加 1 次阴影 pass） */
    /* 11 → 16：多出来的五个池全是为了「泛用件不能长一个样」。
       instanceColor 是免费的（不增 draw call），另开池才增，所以只在
       「颜色乘不出来」的地方才开：旧书摊开着的箱（形不同）、书堆（暖色乘不出）、
       餐吧棚布（不能把柱子桌椅一起染）、甲板方件与圆件。 */
    BUDGET.drawCalls = 16;
    /* 平面反射另算一趟 pass：只渲 RFL_LAYER 那几层（岸墙 1 + 船 5 + 旧书摊/系缆 2 + 桥 1 组），
       分辨率 0.50×，且相机在水下或高过 900m 时整趟跳过。
       renderer.info 每次 render() 自清零，HUD 读到的是主渲染那一趟，与修前同口径。 */
    BUDGET.reflScale = 0.50;
    BUDGET.trisMooringMax = 64 * 88;
    /* 逐池实测，不再手抄常数——几何一改这行就跟着变 */
    BUDGET.trisBoats = [tourPool, glassPool, penPool, homePool, barPool, awnPool, bulbPool,
                        clutBoxPool, clutCylPool]
      .reduce((s, p) => s + p.max * (p.mesh.geometry.index.count / 3), 0) + (BUDGET.wakeTris || 0);
    console.log('[water] 预算实测', BUDGET);
    /* refl 暴露出去只为一件事：性能审查要能就地把反射 pass 关掉对比帧率
       （PC.get('water').refl.dead = true）。运行时不读它。
       boats() 给自校验脚本用：截图时要能问出「这条船在哪、朝哪、在不在动」。 */
    return {root: ROOT, budget: BUDGET, refl: RFL,
            boats: () => boats, gates: () => GATES};
  },

  update(ctx, dt){
    TIME += dt;
    if (waterMat){
      const u = waterMat.uniforms, d = ctx.SUN && ctx.SUN.dir;
      u.uTime.value = TIME;
      if (d){
        const L = Math.hypot(d[0], d[1], d[2]) || 1;
        u.uSun.value.set(d[0]/L, d[1]/L, d[2]/L);
        /* 太阳越低越金：黄昏那条碎金光带的颜色由这里决定 */
        const warm = clamp(Math.max(0, d[1]) / 0.82, 0, 1);
        u.uSunCol.value.set(1.0, lerp(0.60, 0.95, warm), lerp(0.24, 0.86, warm));
        u.uSpecK.value = 1.0 + (1 - warm) * 1.35;
      }
      if (d) refreshReflSky(ctx, d);
      u.uEnvOn.value = REFL.tex ? 1 : 0;
      if (REFL.tex) u.uEnv.value = REFL.tex;
    }
    /* 船先摆到本帧的位置，倒影里才不会慢半拍 */
    if (boats.length) updateBoats(ctx, dt);
    if (waterMat){
      const u = waterMat.uniforms;
      reflTag(ctx);
      const ok = reflRender(ctx);
      u.uReflOn.value = ok ? 1 : 0;
      if (ok){ u.uRefl.value = RFL.rt.texture; u.uReflMat.value.copy(RFL.mat); }
    }
  },

  setVisible(v){ if (ROOT) ROOT.visible = v; }
});

})();
