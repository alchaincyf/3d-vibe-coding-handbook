/* ══════════════════════════════════════════════════════════════════════════
   city/plan.js —— 巴黎城市平面 · 整个城市层的唯一数据源

   契约：window.PCPlan.generate(seed) -> plan
   下游 terrain / water / bridges / facade / shops / furniture 六个模块**只读**它。

   三条自我约束：
   ① 零 THREE 依赖，零 PC 依赖 —— 纯数据 + 纯函数，可以直接 node 跑着测：
        node -e "global.window={};require('./city/plan.js');
                 console.log(JSON.stringify(window.PCPlan.generate(20260829).stats))"
   ② 真实地理数据内联在文件末尾的 DATA 常量里。file:// 协议下 fetch 必然失败，
      而 test.html 只同步加载 plan.js 这一个脚本，所以只能内联，不能读 json。
      **DATA 是从 city/data/*.json 机器生成的，不要手改**；要改改那边再重新内联。
   ③ 多边形 / 随机 / 投影这几个工具在 core.js 的 PC 里也有一份。这里重写是因为
      ① 的约束（PC 依赖 THREE 才有完整功能），两边算法一致，常数完全对齐。

   坐标：x 东、z 北，米制，原点=巴黎圣母院。街面 y=0，下层河岸 −6.6，水面 −8.6。
   ══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

/* ═══════════════════ 0. 常量与基础工具 ═══════════════════ */

/* 地理投影：与 PC.geo 同一组常数，不许各写各的 */
const LON0 = 2.34987, LAT0 = 48.85300, MX = 73240, MZ = 110574;
const geo = (lon, lat) => [(lon - LON0) * MX, (lat - LAT0) * MZ];

/* 高程基准（与 PC.Y 一致，不可改） */
const Y = {street: 0, berge: -6.6, water: -8.6, bedrock: -12.0};

const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const TAN12 = Math.tan(12 * Math.PI / 180);

/* 位置哈希：同一坐标永远得到同一个值，与生成顺序无关。
   这是全文件唯一的随机源——不用顺序 rng，改了算法也不会让整城重新洗牌。 */
let SEED = 20260829;
function hp(x, z, salt){
  let h = Math.imul((Math.round(x * 4) | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul((Math.round(z * 4) | 0) ^ 0xc2b2ae35, 0x27d4eb2f);
  h ^= Math.imul(((salt | 0) + (SEED | 0)) ^ 0x165667b1, 0x9e3779b1);
  h ^= h >>> 15; h = Math.imul(h, 0x2545f491); h ^= h >>> 13;
  return ((h >>> 0) % 1000003) / 1000003;
}

/* ═══════════════════ 1. 多边形工具 ═══════════════════
   约定：多边形一律逆时针（area>0）。边 i 指 p[i]→p[i+1]。
   带 meta 的多边形写成 {p:[[x,z]…], e:[边元数据…]}，e[i] 描述边 i 临的是哪条街。
   —— 这是本文件最关键的一个设计：街道信息由「切出这条边的那一刀」直接继承，
      所以后面分地块时不用再去反查「这条边临哪条路」。 */

function polyArea(p){
  let a = 0;
  for (let i = 0, n = p.length; i < n; i++){ const q = p[i], r = p[(i + 1) % n]; a += q[0] * r[1] - r[0] * q[1]; }
  return a / 2;
}
function polyCentroid(p){
  let x = 0, z = 0, a = 0;
  for (let i = 0, n = p.length; i < n; i++){
    const q = p[i], r = p[(i + 1) % n], f = q[0] * r[1] - r[0] * q[1];
    a += f; x += (q[0] + r[0]) * f; z += (q[1] + r[1]) * f;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9){
    let sx = 0, sz = 0; for (const q of p){ sx += q[0]; sz += q[1]; }
    return [sx / p.length, sz / p.length];
  }
  return [x / (6 * a), z / (6 * a)];
}
function polyBBox(p){
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const q of p){ if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0];
                      if (q[1] < z0) z0 = q[1]; if (q[1] > z1) z1 = q[1]; }
  return [x0, z0, x1, z1];
}
function pointIn(p, x, z){
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++){
    const a = p[i], b = p[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function ccw(p){ return polyArea(p) < 0 ? p.slice().reverse() : p; }

/* 逐边内缩 d。凸多边形可靠；这里所有街廓都是半平面裁出来的，天然凸。 */
function inset(p, d){
  const n = p.length, out = [];
  const s = polyArea(p) >= 0 ? 1 : -1;
  for (let i = 0; i < n; i++){
    const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
    let n1 = [b[1] - a[1], a[0] - b[0]], n2 = [c[1] - b[1], b[0] - c[0]];
    const l1 = Math.hypot(n1[0], n1[1]) || 1, l2 = Math.hypot(n2[0], n2[1]) || 1;
    n1 = [n1[0] / l1 * s, n1[1] / l1 * s]; n2 = [n2[0] / l2 * s, n2[1] / l2 * s];
    const bx = n1[0] + n2[0], bz = n1[1] + n2[1], lb = Math.hypot(bx, bz);
    if (lb < 1e-6) continue;
    const cosH = Math.max(0.34, lb / 2);
    out.push([b[0] - bx / lb * d / cosH, b[1] - bz / lb * d / cosH]);
  }
  if (out.length < 3) return null;
  return polyArea(out) > 0 ? out : null;
}

/* 内切半径的近似：重心到各边直线的最小距离。凸多边形上够准。 */
function inradius(p, c){
  let m = Infinity;
  for (let i = 0, n = p.length; i < n; i++){
    const a = p[i], b = p[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    const d = Math.abs((c[0] - a[0]) * dz - (c[1] - a[1]) * dx) / L;
    if (d < m) m = d;
  }
  return m;
}

/* 半平面裁剪（Sutherland–Hodgman），保留 n·p <= c 的一侧，并沿途搬运边元数据。
   新切出来的那条边挂 cutMeta —— 这就是「街道信息随刀走」。 */
function clipHP(poly, nx, nz, c, cutMeta){
  const P = poly.p, E = poly.e, n = P.length;
  const oP = [], oE = [];
  for (let i = 0; i < n; i++){
    const a = P[i], b = P[(i + 1) % n], m = E[i];
    const da = nx * a[0] + nz * a[1] - c, db = nx * b[0] + nz * b[1] - c;
    const ain = da <= 0, bin = db <= 0;
    if (ain){
      oP.push(a); oE.push(m);
      if (!bin){
        const t = da / (da - db);
        oP.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); oE.push(cutMeta);
      }
    } else if (bin){
      const t = da / (da - db);
      oP.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); oE.push(m);
    }
  }
  if (oP.length < 3) return null;
  /* 清掉裁剪产生的重合点 */
  const P2 = [], E2 = [];
  for (let i = 0; i < oP.length; i++){
    const j = (i + 1) % oP.length;
    if (Math.hypot(oP[j][0] - oP[i][0], oP[j][1] - oP[i][1]) < 0.25) continue;
    P2.push(oP[i]); E2.push(oE[i]);
  }
  return P2.length >= 3 ? {p: P2, e: E2} : null;
}

/* 凸多边形 A 减去凸多边形 B —— 精确分解成若干凸片。
   给广场/公园/地标挖洞用：A ∩ (第 j 条边外) ∩ (前 j−1 条边内)。 */
function convexDiff(A, B, minArea){
  const nb = B.length, out = [];
  const N = [], C = [];
  for (let j = 0; j < nb; j++){
    const a = B[j], b = B[(j + 1) % nb];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    N.push([dz / L, -dx / L]);            /* 逆时针多边形的外法线 */
    C.push((dz / L) * a[0] + (-dx / L) * a[1]);
  }
  let cur = A;
  for (let j = 0; j < nb && cur; j++){
    /* 本片 = cur 在第 j 条边之外的部分 */
    const outside = clipHP(cur, -N[j][0], -N[j][1], -C[j], A.e[0]);
    if (outside && Math.abs(polyArea(outside.p)) >= minArea) out.push(outside);
    /* 余下继续往里剥 */
    cur = clipHP(cur, N[j][0], N[j][1], C[j], A.e[0]);
    if (cur && Math.abs(polyArea(cur.p)) < 1) cur = null;
  }
  return cur ? out : [A];   /* cur 变空 = A 完全在 B 外，原样退回 */
}

/* 把 poly 夹回 host 内部（host 逆时针凸）。inset 在尖角处会外飞，靠这个兜底。 */
function clipToPoly(poly, host, margin){
  let cur = {p: poly, e: poly.map(() => null)};
  for (let i = 0, n = host.length; i < n && cur; i++){
    const a = host[i], b = host[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    const nx = dz / L, nz = -dx / L;
    cur = clipHP(cur, nx, nz, nx * a[0] + nz * a[1] - (margin || 0), null);
  }
  return cur ? cur.p : null;
}

/* 凸包（Andrew monotone chain） */
function hull(pts){
  const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return P;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of P){ while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = P.length - 1; i >= 0; i--){ const q = P[i];
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return ccw(lo.concat(up));
}

/* 简易均匀网格空间索引。dist() 和「地块是否临广场」都靠它，别做全表扫描。 */
function grid(items, cell, pad){
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const it of items){ const b = it.bb;
    if (b[0] < x0) x0 = b[0]; if (b[1] < z0) z0 = b[1];
    if (b[2] > x1) x1 = b[2]; if (b[3] > z1) z1 = b[3]; }
  pad = pad || 0; x0 -= pad; z0 -= pad; x1 += pad; z1 += pad;
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell)), nz = Math.max(1, Math.ceil((z1 - z0) / cell));
  const cells = new Array(nx * nz);
  for (const it of items){
    const b = it.bb;
    const i0 = clamp(Math.floor((b[0] - pad - x0) / cell), 0, nx - 1), i1 = clamp(Math.floor((b[2] + pad - x0) / cell), 0, nx - 1);
    const j0 = clamp(Math.floor((b[1] - pad - z0) / cell), 0, nz - 1), j1 = clamp(Math.floor((b[3] + pad - z0) / cell), 0, nz - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++){
      const k = j * nx + i; (cells[k] || (cells[k] = [])).push(it);
    }
  }
  /* 去重用自增令牌，不能用 sink 数组本身当标记——sink 是复用的同一个对象，
     拿它当标记会让第二次以后的查询全部返回空。（踩过一次，别改回去） */
  let tok = 0;
  return {
    query(bb, sink){
      sink.length = 0; tok++;
      const i0 = clamp(Math.floor((bb[0] - x0) / cell), 0, nx - 1), i1 = clamp(Math.floor((bb[2] - x0) / cell), 0, nx - 1);
      const j0 = clamp(Math.floor((bb[1] - z0) / cell), 0, nz - 1), j1 = clamp(Math.floor((bb[3] - z0) / cell), 0, nz - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++){
        const arr = cells[j * nx + i]; if (!arr) continue;
        for (const it of arr) if (it._mk !== tok) { it._mk = tok; sink.push(it); }
      }
      return sink;
    }
  };
}

/* ═══════════════════ 2. 地形（蒙马特高地） ═══════════════════
   全城街面是一张 y=0 的平面，只有蒙马特这一座山。这是个明确的取舍，
   口径写在下面——免得后面有人拿绝对海拔来量，量出一个「矮了 40 米」的结论。

   一、真实数据（NGF 海拔，2026-08-29 核）
     · 巴黎自然最高点 130.53 m：圣皮埃尔教堂旁 Calvaire 墓地内的自然地面
       （fr.wikipedia《Point culminant de Paris》）
     · 圣皮埃尔教堂门口水准点 n°70055 记 128.163 m，同处人行道 128.21 m
     · 塞纳河巴黎段正常壅水位 26.92 m，奥斯特利茨桥水尺零点 25.90 m
     · Copernicus DEM 90m 采样（api.open-meteo.com/v1/elevation）：
       山顶 129 · 圣心堂前庭 129 · 皮加勒广场 69 · 罗什舒阿尔大道 78 ·
       克利希广场 70 · 奥德内街 65 · 拉梅街 74 · 圣母院 38 · 铁塔 36

   二、两个参照系不一样，本项目取的是第二个
     ① 绝对海拔差：本文件水面 −8.6 对应 26.9 NGF，反推街面 0 ≈ 35.5 NGF，
        于是山顶「应该」是 +95。但这个数只在整座城市带着真实起伏时才成立——
        北边那一整片高地（皮加勒到克利希的街道本身已经在 65–78 NGF）也得跟着抬。
     ② 山体相对自己山脚的局部高差：129 − (65…78) ≈ 51…64 m。
        全城压平成 y=0 之后，只有这个数是自洽的。
     h=55 落在 ①② 的第二个区间里（偏区间下沿），不是 0.58 倍的艺术压缩，
     是「平原城市 + 单峰」这个模型下的正确量级。

   三、代价，摆在明面上
     圣心堂穹顶在本模型里是 55+84=139（离水面 147.6）；真实是山顶 130 + 穹顶 83.3
     ≈ 213 NGF（离水面 ≈186）。所以远景里它比真巴黎矮 ~38 m，与铁塔的高度关系偏小。
     修法是补出整片北部高地，不是把这一座山单独拔高——单独拔到 95 会让
     蒙马特变成 800 m 半径的锥子，勒皮克街的坡度直接翻倍，反而更不像。
     街廓已经支持随地形起伏（§8 里 block.y0 / parcel.y0 都是 terrainY 算的），补高地是数据活，
     归 Phase 3（OSM 精化）一起做。

   四、⚠️ 跨文件契约（改 h 之前先读这段）
     paris.html 的 CITY 表把圣心堂硬编码为 base=55，本表 h 必须与它逐字相等，
     否则教堂要么埋进山里要么悬空。plan.landmarks[].base 这边已经是 terrainY
     算出来的正确值；等 paris.html 那行改成从 PC.plan 取基高，这个契约才解除。

   山顶留一小块平台（rTop），真实的蒙马特山顶就是平的，教堂建在平台上。
   其余全城为 0 —— 六座地标都是按街面 0 摆好的，别给它们脚下加坡。 */
const BUTTE_H = 55;          /* 改这个数必须同步改 paris.html CITY 里圣心堂的 base */
const HILLS = [
  {name: '蒙马特高地', nameFr: 'Butte Montmartre', x: -500, z: 3750,
   h: BUTTE_H, r: 800, rTop: 130,
   /* 以下是口径元数据，terrain.js 不读它，是给审查、README 和后续 Phase 3 用的 */
   datum: 'local-relief',            // 高度口径：局部高差，不是绝对海拔差
   summitNGF: 130.53,                // 真实山顶海拔
   footNGF: [65, 78],                // 真实山脚一圈的街道海拔
   streetDatumNGF: 35.5,             // 本项目 y=0 对应的海拔（由水面 −8.6 = 26.9 NGF 反推）
   hRealRelief: [51, 64],            // 按局部高差算的真值区间 —— h 应落在这里
   hRealAbsolute: 95,                // 按绝对海拔差算的值（本模型不采用，见上文二①）
   note: '高度取「山顶−山脚」的局部高差（真实 51–64 m），不取绝对海拔差（95 m）：' +
         '全城街面压平为 y=0 时只有前者自洽。与 paris.html 里圣心堂的 base 硬绑定，两处必须同改。'}
];
function terrainY(x, z){
  let y = 0;
  for (const H of HILLS){
    const d = Math.hypot(x - H.x, z - H.z);
    if (d >= H.r) continue;
    const t = clamp((H.r - d) / (H.r - H.rTop), 0, 1);
    y += H.h * t * t * (3 - 2 * t);
  }
  return y;
}

/* ═══════════════════ 3. 塞纳河 ═══════════════════ */

function catmull(P, sub){
  const out = [], n = P.length;
  for (let i = 0; i < n - 1; i++){
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n - 1, i + 2)];
    for (let k = 0; k < sub; k++){
      const t = k / sub, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
      ]);
    }
  }
  out.push(P[n - 1].slice());
  return out;
}
function resample(P, step){
  const out = [P[0].slice()];
  let cur = P[0].slice(), i = 1, rem = step;
  while (i < P.length){
    const dx = P[i][0] - cur[0], dz = P[i][1] - cur[1], d = Math.hypot(dx, dz);
    if (d < rem){ rem -= d; cur = P[i].slice(); i++; }
    else { const t = rem / d; cur = [cur[0] + dx * t, cur[1] + dz * t]; out.push(cur.slice()); rem = step; }
  }
  const last = P[P.length - 1], tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.4) out.push(last.slice());
  return out;
}

/* 射线 c + s·n 与线段 ab 的交点参数 s（u∈[0,1] 才算命中），无交返回 NaN */
function raySeg(cx, cz, nx, nz, ax, az, bx, bz){
  const dx = bx - ax, dz = bz - az;
  const den = nx * dz - nz * dx;
  if (Math.abs(den) < 1e-12) return NaN;
  const ex = ax - cx, ez = az - cz;
  const u = (ex * nz - ez * nx) / den;
  if (u < 0 || u > 1) return NaN;
  return (ex * dz - ez * dx) / den;
}

function buildRiver(D){
  const raw = D.seine.centerline.map(p => geo(p[0], p[1]));
  const pts = resample(catmull(raw, 10), 25);
  const N = pts.length;

  /* 累积弧长 */
  const cum = new Float64Array(N);
  for (let i = 1; i < N; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const len = cum[N - 1];

  /* 切向 / 左法线。数组正方向 = 上游→下游（东→西），
     左法线 n=(−tz, tx)：向西流时指向南，正是 rive gauche。side=+1 左岸（南），−1 右岸（北）。 */
  const tx = new Float64Array(N), tz = new Float64Array(N);
  for (let i = 0; i < N; i++){
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    tx[i] = dx / L; tz[i] = dz / L;
  }

  /* 河宽：seine.json 的 width 与原始 centerline 逐点对应，按归一化弧长映射到重采样点。
     注意口径——这个 w 是「岸到岸、含岛」的断面宽，西岱岛段 300–400m 是对的。 */
  const rawCum = [0];
  for (let i = 1; i < raw.length; i++) rawCum.push(rawCum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const rawLen = rawCum[raw.length - 1];
  const W = new Float64Array(N);
  for (let i = 0; i < N; i++){
    const u = (cum[i] / len) * rawLen;
    let k = 1; while (k < raw.length - 1 && rawCum[k] < u) k++;
    const t = (u - rawCum[k - 1]) / Math.max(1e-6, rawCum[k] - rawCum[k - 1]);
    W[i] = D.seine.width[k - 1][2] * (1 - t) + D.seine.width[k][2] * t;
  }

  /* 空间索引：每格记下最近的样点序号，查询时只扫它 ±16 个。
     dist() 会被调几万次，全表扫 280 个点是 8 倍的浪费。 */
  const bb = polyBBox(pts);
  const GX0 = bb[0] - 2600, GZ0 = bb[1] - 2600, GX1 = bb[2] + 2600, GZ1 = bb[3] + 2600;
  const CELL = 150;
  const gnx = Math.ceil((GX1 - GX0) / CELL), gnz = Math.ceil((GZ1 - GZ0) / CELL);
  const near = new Int32Array(gnx * gnz);
  for (let j = 0; j < gnz; j++) for (let i = 0; i < gnx; i++){
    const cx = GX0 + (i + 0.5) * CELL, cz = GZ0 + (j + 0.5) * CELL;
    let bi = 0, bd = Infinity;
    for (let k = 0; k < N; k++){
      const d = (pts[k][0] - cx) * (pts[k][0] - cx) + (pts[k][1] - cz) * (pts[k][1] - cz);
      if (d < bd){ bd = d; bi = k; }
    }
    near[j * gnx + i] = bi;
  }

  function scanRange(x, z, k0, k1){
    let bd = Infinity, bi = 0, bt = 0;
    for (let k = k0; k < k1; k++){
      const a = pts[k], b = pts[k + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
      let t = ((x - a[0]) * dx + (z - a[1]) * dz) / L2; t = t < 0 ? 0 : (t > 1 ? 1 : t);
      const px = a[0] + dx * t, pz = a[1] + dz * t;
      const d = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d < bd){ bd = d; bi = k; bt = t; }
    }
    return [bd, bi, bt];
  }

  const tmp = [];
  function dist(x, z){
    let r = null;
    if (x >= GX0 && x < GX1 && z >= GZ0 && z < GZ1){
      const i = ((x - GX0) / CELL) | 0, j = ((z - GZ0) / CELL) | 0;
      const s = near[j * gnx + i];
      r = scanRange(x, z, Math.max(0, s - 22), Math.min(N - 1, s + 22));
    }
    /* 抽稀全局兜底：格心的最近段与格内点的最近段在河道拐弯处可能差几十个序号，
       只信窗口会漏（第一轮实测最大偏 70m）。多花 ~35 次点测换一个精确解。 */
    let bi = 0, bd = Infinity;
    for (let k = 0; k < N; k += 5){
      const d = (pts[k][0] - x) * (pts[k][0] - x) + (pts[k][1] - z) * (pts[k][1] - z);
      if (d < bd){ bd = d; bi = k; }
    }
    const r2 = scanRange(x, z, Math.max(0, bi - 12), Math.min(N - 1, bi + 12));
    if (!r || r2[0] < r[0]) r = r2;
    const k = r[1], t = r[2];
    const s = cum[k] + t * (cum[k + 1] - cum[k]);
    const nx = -(tz[k] * (1 - t) + tz[k + 1] * t), nz = (tx[k] * (1 - t) + tx[k + 1] * t);
    const cx = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t, cz = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t;
    const side = ((x - cx) * nx + (z - cz) * nz) >= 0 ? 1 : -1;
    tmp.d = Math.sqrt(r[0]); tmp.t = s / len; tmp.side = side;
    tmp.w = W[k] + (W[k + 1] - W[k]) * t;
    return {d: tmp.d, t: tmp.t, side: side, w: tmp.w};
  }

  function at(t){
    const s = clamp(t, 0, 1) * len;
    let lo = 0, hi = N - 1;
    while (lo < hi - 1){ const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const f = (s - cum[lo]) / Math.max(1e-6, cum[lo + 1] - cum[lo]);
    const x = pts[lo][0] + (pts[lo + 1][0] - pts[lo][0]) * f;
    const z = pts[lo][1] + (pts[lo + 1][1] - pts[lo][1]) * f;
    const TX = tx[lo] + (tx[lo + 1] - tx[lo]) * f, TZ = tz[lo] + (tz[lo + 1] - tz[lo]) * f;
    const L = Math.hypot(TX, TZ) || 1;
    return {x: x, z: z, tx: TX / L, tz: TZ / L, nx: -TZ / L, nz: TX / L,
            w: W[lo] + (W[lo + 1] - W[lo]) * f};
  }

  /* ── 真实岸线断面 ──
     seine.json 的 width 是「含岛的岸到岸」断面宽，两岛段读数 300–400m 是对的，
     但拿它当水面宽会把岸推到离中线 200m 的地方——那里其实早已是陆地。
     所以逐样点沿法线去打真实岸线（quays[].path，OSM 岸线）求交，
     再打岛的轮廓求出岛在该断面占掉的那一段。水面 = 岸到岸减去岛。 */
  const BL = new Float64Array(N), BR = new Float64Array(N);
  const IL = new Float64Array(N), IR = new Float64Array(N);
  const islePolys = [];
  for (const k in D.seine.islands){
    const pp = D.seine.islands[k].map(v => geo(v[0], v[1]));
    islePolys.push({p: pp, bb: polyBBox(pp)});
  }
  {
    const bs = [];
    for (const q of D.seine.quays){
      if (q.side === 'island') continue;
      const pp = q.path.map(v => geo(v[0], v[1]));
      for (let i = 0; i < pp.length - 1; i++) bs.push([pp[i], pp[i + 1]]);
    }
    const isl = [];
    for (const k in D.seine.islands){
      const pp = D.seine.islands[k].map(v => geo(v[0], v[1]));
      for (let i = 0; i < pp.length; i++) isl.push([pp[i], pp[(i + 1) % pp.length]]);
    }
    for (let i = 0; i < N; i++){
      const cx = pts[i][0], cz = pts[i][1], nx = -tz[i], nz = tx[i], lim = W[i] / 2 + 40;
      let bl = W[i] / 2, br = -W[i] / 2;
      for (const sg of bs){
        const s0 = raySeg(cx, cz, nx, nz, sg[0][0], sg[0][1], sg[1][0], sg[1][1]);
        if (!(s0 === s0) || Math.abs(s0) > lim) continue;
        if (s0 > 0){ if (s0 < bl) bl = s0; } else if (s0 > br) br = s0;
      }
      BL[i] = bl; BR[i] = br;
      let a = Infinity, b = -Infinity;
      for (const sg of isl){
        const s0 = raySeg(cx, cz, nx, nz, sg[0][0], sg[0][1], sg[1][0], sg[1][1]);
        if (!(s0 === s0) || s0 < br || s0 > bl) continue;
        if (s0 < a) a = s0; if (s0 > b) b = s0;
      }
      IR[i] = (a === Infinity) ? NaN : a; IL[i] = (b === -Infinity) ? NaN : b;
    }
  }
  function station(t){ const s = clamp(t, 0, 1) * len;
    let lo = 0, hi = N - 1;
    while (lo < hi - 1){ const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    return lo; }
  /* 某点是不是在水里：夹在真实两岸之间，且不落在岛的那一段上 */
  function inWater(x, z){
    for (const ip of islePolys){                       /* 岛上一律是陆地 */
      if (x < ip.bb[0] || x > ip.bb[2] || z < ip.bb[1] || z > ip.bb[3]) continue;
      if (pointIn(ip.p, x, z)) return false;
    }
    const d = dist(x, z);
    const a = at(d.t);
    const sOff = (x - a.x) * a.nx + (z - a.z) * a.nz;
    const i = station(d.t);
    return sOff <= BL[i] && sOff >= BR[i];
  }
  /* 该断面的真实岸线偏移：bl 左岸(+)、br 右岸(−)、isl 岛占掉的那一段 */
  function banks(t){ const i = station(t);
    return {bl: BL[i], br: BR[i], wWater: BL[i] - BR[i],
            isl: (IR[i] === IR[i]) ? [IR[i], IL[i]] : null}; }

  return {pts: pts, len: len, at: at, dist: dist, inWater: inWater, banks: banks,
          widths: Array.prototype.slice.call(W),
          bankL: Array.prototype.slice.call(BL), bankR: Array.prototype.slice.call(BR),
          note: 'at().w 是含岛的岸到岸断面宽（两岛段 300–400m 属正常，seine.json 口径）；' +
                '要真实水面用 banks(t) 或 inWater(x,z)，别拿 w/2 当岸。' +
                'side=+1 左岸(南)，−1 右岸(北)'};
}

/* ═══════════════════ 4. 立面高度：奥斯曼法令查表 ═══════════════════
   楼高不是随机数，是街宽的函数（1884 法令表）。同一条街共享同一个 H，
   所以「全街檐口对齐」是由构造保证的，不是事后对齐出来的。 */
function corniceH(w, klass){
  if (klass === 'quai') return 20;      /* quai 有效宽度含河道，一律吃满 20 */
  if (w < 7.80) return 12;
  if (w < 9.75) return 15;
  if (w < 20.00) return 18;
  return 20;
}
/* 层高配平表（haussmann.md §2，逐套精确凑满 H） */
const LEVELS = {
  20: {corniche: 0.95, balcony: [2, 5], rail: [3, 4], rows: [
        {n: 'RDC', y: 0, h: 4.10}, {n: 'entresol', y: 4.10, h: 2.55}, {n: '2e', y: 6.65, h: 3.55},
        {n: '3e', y: 10.20, h: 3.20}, {n: '4e', y: 13.40, h: 2.95}, {n: '5e', y: 16.35, h: 2.70}]},
  18: {corniche: 0.90, balcony: [2, 5], rail: [3, 4], rows: [
        {n: 'RDC', y: 0, h: 3.80}, {n: 'entresol', y: 3.80, h: 2.20}, {n: '2e', y: 6.00, h: 3.20},
        {n: '3e', y: 9.20, h: 2.95}, {n: '4e', y: 12.15, h: 2.60}, {n: '5e', y: 14.75, h: 2.35}]},
  15: {corniche: 0.80, balcony: [1], rail: [2, 3, 4], rows: [
        {n: 'RDC', y: 0, h: 3.70}, {n: '1er', y: 3.70, h: 2.95}, {n: '2e', y: 6.65, h: 2.75},
        {n: '3e', y: 9.40, h: 2.55}, {n: '4e', y: 11.95, h: 2.25}]},
  12: {corniche: 0.70, balcony: [], rail: [1, 2, 3], rows: [
        {n: 'RDC', y: 0, h: 3.40}, {n: '1er', y: 3.40, h: 2.75}, {n: '2e', y: 6.15, h: 2.65},
        {n: '3e', y: 8.80, h: 2.50}]}
};
const H_STEPDOWN = {20: 18, 18: 15, 15: 12, 12: 12};

/* ═══════════════════ 5. 业态 ═══════════════════ */
/* 抽样权重（不是最终占比）。「同街不连开两家」这条规则会系统性地压掉出现最频繁的
   业态——直接填目标比例跑出来咖啡馆只有 6.1%。所以这里是**反解过的**权重，
   跑完全城才落回 brief 的基准盘：住宅62/咖啡8/面包4/烟草3/药房2/书店2/花店2/其他17。 */
const USE_BASE = [
  ['residential', 0.600], ['shop', 0.145], ['cafe', 0.108], ['boulangerie', 0.046],
  ['tabac', 0.035], ['pharmacie', 0.023], ['librairie', 0.022], ['fleuriste', 0.023]
];
/* 这几个业态在一条街上不许连着出现，隔至少 2 个地块 */
const UNIQUE_USES = {cafe: 1, boulangerie: 1, tabac: 1, pharmacie: 1, librairie: 1, fleuriste: 1};

function pickUse(klass, chamfer, nearPlace, r, recent){
  let m = 1;
  if (klass === 'boulevard' || klass === 'avenue') m *= 2.2;
  else if (klass === 'ruelle') m *= 0.55;
  else if (klass === 'rue') m *= 0.78;
  if (klass === 'quai') m *= 1.5;
  if (nearPlace) m *= 1.8;
  if (chamfer) m *= 3.0;
  m = Math.min(m, 10);

  let tot = 0;
  const w = new Array(USE_BASE.length);
  for (let i = 0; i < USE_BASE.length; i++){
    w[i] = USE_BASE[i][0] === 'residential' ? USE_BASE[i][1] : USE_BASE[i][1] * m;
    tot += w[i];
  }
  for (let tries = 0; tries < 4; tries++){
    let x = ((r * 7919 + tries * 2749) % 1000) / 1000 * tot, pick = 'residential';
    for (let i = 0; i < w.length; i++){ x -= w[i]; if (x <= 0){ pick = USE_BASE[i][0]; break; } }
    if (!UNIQUE_USES[pick] || recent.indexOf(pick) < 0) return pick;
  }
  return (r * 100 | 0) % 2 ? 'shop' : 'residential';
}

/* ═══════════════════ 6. 主干道 / 河岸 / 广场 → 切割候选线 ═══════════════════ */

const KLASS_W = {'river-bank': 6.0, quai: 4.2, boulevard: 3.4, avenue: 3.2,
                 'rue-majeure': 2.2, rue: 1.0, ruelle: 0.9};

function makeCandidate(a, b, meta, retNeg, retPos){
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
  if (L < 1e-3) return null;
  return {
    ax: a[0], az: a[1], dx: dx / L, dz: dz / L, len: L,
    nx: dz / L, nz: -dx / L, c: (dz / L) * a[0] + (-dx / L) * a[1],
    retNeg: retNeg, retPos: retPos, meta: meta,
    bb: [Math.min(a[0], b[0]) - 4, Math.min(a[1], b[1]) - 4, Math.max(a[0], b[0]) + 4, Math.max(a[1], b[1]) + 4]
  };
}

/* ═══════════════════ 7. 递归二分切分 ═══════════════════ */

function chordOf(poly, nx, nz, c, ax, az, dx, dz){
  let t0 = Infinity, t1 = -Infinity, hits = 0;
  const P = poly.p, n = P.length;
  for (let i = 0; i < n; i++){
    const a = P[i], b = P[(i + 1) % n];
    const da = nx * a[0] + nz * a[1] - c, db = nx * b[0] + nz * b[1] - c;
    if ((da > 0) === (db > 0)) continue;
    const s = da / (da - db);
    const px = a[0] + (b[0] - a[0]) * s, pz = a[1] + (b[1] - a[1]) * s;
    const t = (px - ax) * dx + (pz - az) * dz;
    if (t < t0) t0 = t; if (t > t1) t1 = t; hits++;
  }
  return hits >= 2 ? [t0, t1] : null;
}

/* ═══════════════════ 8. 生成 ═══════════════════ */

function generate(seed){
  SEED = (seed === undefined || seed === null) ? 20260829 : (seed | 0);
  const T0 = (typeof performance !== 'undefined' && performance.now) ? performance.now()
           : (typeof process !== 'undefined' ? Number(process.hrtime.bigint() / 1000n) / 1000 : Date.now());
  const D = DATA;

  /* ── 8.1 河 ── */
  const river = buildRiver(D);

  /* ── 8.2 岛 ── */
  const ISL_KEY = {cite: '西岱岛', saintLouis: '圣路易岛', cygnes: '天鹅岛'};
  const islands = [];
  for (const k in D.seine.islands){
    const poly = ccw(D.seine.islands[k].map(p => geo(p[0], p[1])));
    islands.push({key: k, name: (D.seine.islandMeta[k] || {}).nameZh || ISL_KEY[k] || k,
                  nameFr: (D.seine.islandMeta[k] || {}).name || '',
                  poly: poly, area: Math.abs(polyArea(poly)), bb: polyBBox(poly),
                  note: (D.seine.islandMeta[k] || {}).note || ''});
  }

  /* ── 8.3 河岸 quay ── */
  const quays = D.seine.quays.map(q => {
    const pts = q.path.map(p => geo(p[0], p[1]));
    let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return {side: q.side, sideN: q.side === 'left' ? 1 : (q.side === 'right' ? -1 : 0),
            name: q.nameZh, nameFr: q.name, pts: pts, len: L,
            hasBerge: q.hasBerge, wallH: q.wallH, bergeW: q.bergeW, bergeName: q.bergeName || null};
  });
  const ramps = D.seine.ramps.map(r => {
    const p = geo(r.lon, r.lat);
    const dd = river.dist(p[0], p[1]);
    return {x: p[0], z: p[1], t: dd.t, side: r.side, sideN: r.side === 'left' ? 1 : -1,
            kind: r.kind, name: r.name};
  });

  /* ── 8.4 广场与公园 ── */
  const places = D.places.map(pl => {
    const poly = ccw(pl.poly.map(p => geo(p[0], p[1])));
    const hl = hull(poly);
    return {name: pl.name, nameFr: pl.nameFr, kind: pl.kind, paving: pl.paving,
            poly: poly, hull: hl, bb: polyBBox(poly), center: polyCentroid(poly),
            area: Math.abs(polyArea(poly)), features: pl.features || []};
  });
  const placeGrid = grid(places, 420, 90);

  /* ── 8.5 地标避让 ──
     半径是「别在这儿长房子」的净空半径，不是建筑尺寸。places.json 里的
     卡鲁塞尔/星形/圣母院前广场/战神广场/圣心堂前庭 已经覆盖了大部分，这里只补圆。 */
  const LM = [
    {id: 'notre-dame', name: '巴黎圣母院', pos: [0, 0], r: 115, h: 96},
    {id: 'sainte-chapelle', name: '圣礼拜堂', pos: [-360, 270], r: 75, h: 75},
    {id: 'louvre', name: '卢浮宫', pos: [-1030, 890], r: 280, h: 28},
    {id: 'arc-triomphe', name: '凯旋门', pos: [-4030, 2315], r: 110, h: 50},
    {id: 'eiffel', name: '埃菲尔铁塔', pos: [-4060, 600], r: 195, h: 324},
    {id: 'sacre-coeur', name: '圣心堂', pos: [-500, 3750], r: 145, h: 84}
  ];
  const landmarks = LM.map(l => {
    const oct = [];
    for (let i = 0; i < 8; i++){
      const a = i / 8 * Math.PI * 2 + Math.PI / 8;
      oct.push([l.pos[0] + Math.cos(a) * l.r / Math.cos(Math.PI / 8),
                l.pos[1] + Math.sin(a) * l.r / Math.cos(Math.PI / 8)]);
    }
    return {id: l.id, name: l.name, pos: l.pos, r: l.r, h: l.h,
            base: terrainY(l.pos[0], l.pos[1]), poly: ccw(oct), bb: polyBBox(oct)};
  });

  /* ── 8.6 主干道 ── */
  const roads = [], streets = [];
  let roadId = 0;
  const cands = [];
  for (const s of D.streets){
    const pts = s.pts.map(p => geo(p[0], p[1]));
    const id = roadId++;
    const meta = {id: id, klass: s.klass, w: s.widthM, name: s.name, nameFr: s.nameFr, real: true};
    streets.push({id: id, name: s.name, nameFr: s.nameFr, klass: s.klass, w: s.widthM, pts: pts});
    for (let i = 0; i < pts.length - 1; i++){
      roads.push({a: pts[i], b: pts[i + 1], w: s.widthM, klass: s.klass, name: s.name, id: id, real: true});
      const c = makeCandidate(pts[i], pts[i + 1], meta, s.widthM / 2, s.widthM / 2);
      if (c) cands.push(c);
    }
  }

  /* 河岸线也是切割线，而且优先级最高：陆地一侧退让出 quai 街，水一侧不退。 */
  for (const q of quays){
    const meta = {id: roadId++, klass: 'quai', w: q.side === 'island' ? 14 : 22,
                  name: q.name, nameFr: q.nameFr, real: true, bank: true};
    const back = q.side === 'island' ? 14 : 22;
    for (let i = 0; i < q.pts.length - 1; i++){
      const a = q.pts[i], b = q.pts[i + 1];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 30) continue;
      const c = makeCandidate(a, b, meta, 0, 0);
      if (!c) continue;
      /* 判断哪一侧是水：河中心在法线的正侧还是负侧 */
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      const dd = river.dist(mx, mz);
      const cp = river.at(dd.t);
      const toWater = (cp.x - mx) * c.nx + (cp.z - mz) * c.nz;
      if (toWater >= 0){ c.retPos = 0; c.retNeg = back; } else { c.retPos = back; c.retNeg = 0; }
      c.meta = meta; c.prio = 'river-bank';
      cands.push(c);
    }
  }

  /* 广场/公园/地标的长边也是切割线，让街廓贴着它们的边界收口 */
  function edgeCands(poly, meta, minLen, back){
    const c0 = polyCentroid(poly);
    for (let i = 0, n = poly.length; i < n; i++){
      const a = poly[i], b = poly[(i + 1) % n];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < minLen) continue;
      const c = makeCandidate(a, b, meta, 0, 0);
      if (!c) continue;
      const inSide = (c0[0] - a[0]) * c.nx + (c0[1] - a[1]) * c.nz;
      if (inSide >= 0){ c.retPos = 0; c.retNeg = back; } else { c.retPos = back; c.retNeg = 0; }
      cands.push(c);
    }
  }
  for (const pl of places)
    edgeCands(pl.poly, {id: roadId++, klass: 'rue', w: 13, name: pl.name, real: false, place: true}, 65, 9);
  for (const lm of landmarks)
    edgeCands(lm.poly, {id: roadId++, klass: 'rue', w: 13, name: lm.name, real: false, place: true}, 40, 8);

  const candGrid = grid(cands, 420, 0);

  /* ── 8.7 城市边界 ──
     围出「读起来还是巴黎」的那一块：西到夏乐宫/铁塔，北到蒙马特，
     东到巴士底，南到蒙帕纳斯。凸包保证后面所有子块都是凸的。 */
  const BOUND = hull([
    [-4880, 1020], [-4680, 60], [-3450, -880], [-2350, -1180], [-150, -1180],
    [860, -700], [1130, 420], [800, 1560], [380, 3020], [-380, 4160],
    [-2180, 3480], [-4180, 2760], [-4920, 1820]
  ]);
  const cityBB = polyBBox(BOUND);

  /* ── 8.8 递归二分 ── */
  const CORE = [-1200, 700];       /* 密度中心：卢浮宫—圣母院之间 */
  /* 街廓目标面积：核心区小（中世纪肌理），外围大（奥斯曼新区街廓本来就大）。
     ±22% 抖动来自位置哈希，与生成顺序无关。 */
  function targetArea(cx, cz){
    const d = Math.hypot(cx - CORE[0], cz - CORE[1]);
    const base = d < 1800 ? 14000 : (d < 3200 ? 19000 : 29000);
    return base * (0.85 + 0.36 * hp(cx, cz, 11));
  }
  function targetW(klass, d){
    let b = (klass === 'boulevard' || klass === 'avenue') ? 18
          : klass === 'quai' ? 19 : klass === 'rue-majeure' ? 16 : 14;
    b *= d < 1800 ? 1.0 : (d < 3200 ? 1.12 : 1.30);
    return Math.min(b, 22);
  }

  const sink = [];
  function findCut(poly, c, area, realOnly, minHalf){
    const bb = polyBBox(poly.p);
    const list = candGrid.query(bb, sink);
    let best = null, bestScore = 0;
    /* 沿各方向的极值，用来判断这一刀切不切得动 */
    for (const cd of list){
      if (realOnly && !cd.meta.real) continue;
      if (cd.bb[0] > bb[2] || cd.bb[2] < bb[0] || cd.bb[1] > bb[3] || cd.bb[3] < bb[1]) continue;
      const ch = chordOf(poly, cd.nx, cd.nz, cd.c, cd.ax, cd.az, cd.dx, cd.dz);
      if (!ch) continue;
      const chLen = ch[1] - ch[0];
      if (chLen < 45) continue;
      /* 这条线在多边形里的那一段，必须大部分被真实路段本身覆盖 */
      const ov = Math.min(ch[1], cd.len) - Math.max(ch[0], 0);
      if (ov < chLen * 0.5) continue;
      /* 两半都要留得住 */
      let e0 = Infinity, e1 = -Infinity;
      for (const q of poly.p){ const v = cd.nx * q[0] + cd.nz * q[1]; if (v < e0) e0 = v; if (v > e1) e1 = v; }
      const lo = cd.c - cd.retNeg, hi = cd.c + cd.retPos;
      if (lo - e0 < 22 || e1 - hi < 22) continue;
      if (minHalf){
        const fL = (lo - e0) / (e1 - e0), fR = (e1 - hi) / (e1 - e0);
        if (area * Math.min(fL, fR) < minHalf) continue;
      }
      const bal = 1 - Math.abs(cd.c - (e0 + e1) / 2) / Math.max(1e-6, (e1 - e0) / 2);
      const kw = cd.prio ? KLASS_W[cd.prio] : (cd.meta.place ? 2.0 : (KLASS_W[cd.meta.klass] || 1));
      const sc = kw * (0.35 + 0.65 * bal) * (1 + 0.25 * Math.min(1, chLen / 300));
      if (sc > bestScore){ bestScore = sc; best = cd; }
    }
    return best;
  }

  /* 程序化切线：过重心、法线取多边形长轴（即切线横切长边），±6° 抖动 */
  function axisCut(poly, c, depth, turn){
    let sxx = 0, sxz = 0, szz = 0;
    for (const q of poly.p){ const dx = q[0] - c[0], dz = q[1] - c[1]; sxx += dx * dx; sxz += dx * dz; szz += dz * dz; }
    let th = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    th += (hp(c[0], c[1], 21) - 0.5) * (16 * Math.PI / 180);   /* ±8° 抖动 → 出三角形和五边形 */
    if (turn) th += Math.PI / 2;
    const nx = Math.cos(th), nz = Math.sin(th);
    let e0 = Infinity, e1 = -Infinity;
    for (const q of poly.p){ const v = nx * q[0] + nz * q[1]; if (v < e0) e0 = v; if (v > e1) e1 = v; }
    const mid = (e0 + e1) / 2 + (hp(c[0], c[1], 33) - 0.5) * (e1 - e0) * 0.16;
    const w = cutRoadW(depth, c[0], c[1]);
    return {nx: nx, nz: nz, c: mid, retNeg: w / 2, retPos: w / 2,
            dx: -nz, dz: nx, ax: c[0], az: c[1],
            meta: {id: roadId++, klass: w >= 20 ? 'rue-majeure' : (w >= 10 ? 'rue' : 'ruelle'),
                   w: w, name: null, real: false}};
  }

  /* 次级街网的街宽。这个函数决定全城天际线——楼高是街宽的函数（1884 法令），
     街宽全给成 12–18m 的话整城就只剩一种 6 层楼，一眼假。
     所以：切得越早的街越宽（先切的是骨架），核心区（西岱/玛莱/拉丁区）整体收窄，
     那里本来就是中世纪肌理，4–5 层。 */
  function cutRoadW(depth, cx, cz){
    const r = hp(cx, cz, 43);
    let w;
    if (depth <= 2)      w = 22 + r * 10;     /* 次级大道 22–32 → H=20 */
    else if (depth <= 4) w = 15 + r * 6;      /* 次干道 15–21 → H=18/20 */
    else if (depth <= 6) w = 11.5 + r * 4;    /* 街 11.5–15.5 → H=18 */
    else                 w = 9.5 + r * 3;     /* 巷 9.5–12.5 → H=18 */
    if (Math.hypot(cx - CORE[0], cz - CORE[1]) < 1400) w *= 0.80;   /* 中世纪核心整体收窄 */
    return Math.max(7.0, Math.round(w * 10) / 10);
  }

  /* 落在河里 / 落在广场里 / 落在地标里 —— 直接扔掉，不再往下切。
     注意河宽 w 是含岛的断面宽，所以「在 w/2 以内」也包括两座岛——
     岛上是要长房子的（圣路易岛整个是 17 世纪规划的住宅街区），先排除掉再判水。 */
  const tmpArr = [], tmpArr2 = [];
  function onIsland(x, z){
    for (const il of islands){
      if (x < il.bb[0] || x > il.bb[2] || z < il.bb[1] || z > il.bb[3]) continue;
      if (pointIn(il.poly, x, z)) return true;
    }
    return false;
  }
  function killed(poly, c){
    const dd = river.dist(c[0], c[1]);
    if (dd.d < dd.w / 2 + 3 && river.inWater(c[0], c[1])){
      let inW = 1, n = 1;
      for (const q of poly.p){
        const sx = c[0] + (q[0] - c[0]) * 0.62, sz = c[1] + (q[1] - c[1]) * 0.62;
        n++; if (river.inWater(sx, sz)) inW++;
      }
      if (inW / n > 0.55) return true;
    }
    /* 地标必须和河、广场一样按**采样占比**判，不能只看重心：
       递归早期的多边形有几十万平米，重心偶然落进圣心堂那个 145m 的圈里，
       整个蒙马特就没了。实测这一条误杀了全城 1.73km²（蒙马特一区就 0.69km²）。
       部分重叠交给出街廓前的 convexDiff 精确挖，这里只负责整块落在里面的情况。 */
    for (const lm of landmarks){
      if (Math.hypot(c[0] - lm.pos[0], c[1] - lm.pos[1]) >= lm.r) continue;
      let inL = 1, n = 1;
      for (const q of poly.p){
        const sx = c[0] + (q[0] - c[0]) * 0.62, sz = c[1] + (q[1] - c[1]) * 0.62; n++;
        if (Math.hypot(sx - lm.pos[0], sz - lm.pos[1]) < lm.r) inL++;
      }
      if (inL / n > 0.55) return true;
    }
    const bb = polyBBox(poly.p);
    const near = placeGrid.query(bb, tmpArr);
    for (const pl of near){
      if (!pointIn(pl.poly, c[0], c[1])) continue;
      let inP = 1, n = 1;
      for (const q of poly.p){
        const sx = c[0] + (q[0] - c[0]) * 0.62, sz = c[1] + (q[1] - c[1]) * 0.62;
        n++; if (pointIn(pl.poly, sx, sz)) inP++;
      }
      if (inP / n > 0.55) return true;
    }
    return false;
  }

  const raw = [];
  const MIN_EMIT = 1600;      /* 比这个还小就不留（巴黎确实有小三角块，但再小就成缝了） */
  const MIN_PIECE = 4600;     /* 但**不许主动切出**比这更小的块——切碎才是街廓变假的根因 */

  /* 真切一刀试试。切碎了就退回不切——这一条比任何评分函数都管用。 */
  function tryCut(poly, cut, A, bal){
    const L = clipHP(poly, cut.nx, cut.nz, cut.c - cut.retNeg, cut.meta);
    const R = clipHP(poly, -cut.nx, -cut.nz, -(cut.c + cut.retPos), cut.meta);
    if (!L || !R) return null;
    const aL = Math.abs(polyArea(L.p)), aR = Math.abs(polyArea(R.p));
    if (Math.min(aL, aR) < MIN_PIECE) return null;
    if (Math.min(aL, aR) < A * bal) return null;
    return [L, R];
  }
  function split(poly, depth){
    const A = Math.abs(polyArea(poly.p));
    if (A < MIN_EMIT || depth > 22) return;
    const c = polyCentroid(poly.p);
    if (killed(poly, c)) return;

    const tgt = targetArea(c[0], c[1]);
    const over = A > tgt;
    let cut = findCut(poly, c, A, !over, over ? 0 : 2600);
    let halves = cut ? tryCut(poly, cut, A, 0.22) : null;
    if (!halves && over){
      /* 退让阶梯：长轴横切 → 转 90° → 放宽均衡度。超标两倍还切不动的块必须切开，
         否则会留下 8 万平米的巨块（第一轮实测出现过 4 个）。 */
      const far = A > tgt * 2;
      cut = axisCut(poly, c, depth, 0);           halves = tryCut(poly, cut, A, 0.22);
      if (!halves){ cut = axisCut(poly, c, depth, 1); halves = tryCut(poly, cut, A, 0.22); }
      if (!halves && far){ cut = axisCut(poly, c, depth, 0); halves = tryCut(poly, cut, A, 0.10); }
      if (!halves && far){ cut = axisCut(poly, c, depth, 1); halves = tryCut(poly, cut, A, 0.10); }
    }
    if (!halves){ raw.push(poly); return; }

    /* 确认这一刀真的用上了，才把它登记成一条街——terrain.js 要按 roads 铺路面 */
    if (!cut.meta.real && !cut.meta.place){
      const ch = chordOf(poly, cut.nx, cut.nz, cut.c, cut.ax, cut.az, cut.dx, cut.dz);
      if (ch) roads.push({a: [cut.ax + cut.dx * ch[0], cut.az + cut.dz * ch[0]],
                          b: [cut.ax + cut.dx * ch[1], cut.az + cut.dz * ch[1]],
                          w: cut.meta.w, klass: cut.meta.klass, name: null, id: cut.meta.id, real: false});
    }
    split(halves[0], depth + 1);
    split(halves[1], depth + 1);
  }
  const bMeta = {id: roadId++, klass: 'rue', w: 14, name: null, real: false};
  split({p: BOUND, e: BOUND.map(() => bMeta)}, 0);

  /* ── 8.9 出街廓前的最后一刀：把广场/公园/地标从街廓里挖干净 ── */
  const cut0 = [];
  for (const b of raw){
    let pieces = [b];
    /* 先按真实岸线切一刀。killed() 只处理「整块都在水里」，
       半边探进小汊的街廓（圣母院南边那块就是）它拦不住，得在这儿切掉。 */
    {
      let wet = false;
      for (const q of b.p) if (river.inWater(q[0], q[1])){ wet = true; break; }
      if (wet){
        const bc = polyCentroid(b.p), dd = river.dist(bc[0], bc[1]);
        const a0 = river.at(dd.t), bk = river.banks(dd.t);
        const off = (bc[0] - a0.x) * a0.nx + (bc[1] - a0.z) * a0.nz;
        const QUAI = 12;                       /* 岸线之外再退出 quai 街的宽度 */
        const na = a0.nx * a0.x + a0.nz * a0.z;
        const clipped = (off >= 0)
          ? clipHP(b, -a0.nx, -a0.nz, -(na + bk.bl + QUAI), b.e[0])
          : clipHP(b,  a0.nx,  a0.nz,  (na + bk.br - QUAI), b.e[0]);
        if (!clipped || Math.abs(polyArea(clipped.p)) < MIN_EMIT) continue;
        pieces = [clipped];
      }
    }
    const bb = polyBBox(pieces[0].p);
    const near = placeGrid.query(bb, tmpArr).slice();
    for (const lm of landmarks)
      if (!(lm.bb[0] > bb[2] || lm.bb[2] < bb[0] || lm.bb[1] > bb[3] || lm.bb[3] < bb[1])) near.push(lm);
    for (const ob of near){
      const oh = ob.hull || ob.poly;
      const nxt = [];
      for (const q of pieces){
        const qb = polyBBox(q.p);
        const ob2 = ob.bb;
        if (ob2[0] > qb[2] || ob2[2] < qb[0] || ob2[1] > qb[3] || ob2[3] < qb[1]){ nxt.push(q); continue; }
        for (const pc of convexDiff(q, oh, MIN_EMIT)) nxt.push(pc);
      }
      pieces = nxt;
      if (pieces.length > 14) break;
    }
    for (const q of pieces){
      if (Math.abs(polyArea(q.p)) < MIN_EMIT) continue;
      const qc = polyCentroid(q.p);
      /* 太瘦的条子留不住一栋楼（进深会被夹到 5m），扔掉 */
      if (inradius(q.p, qc) < 7) continue;
      /* 压着河汊的街廓：顶点可能全在陆上（一头在岛上、一头在对岸），
         肚子却横跨小汊。所以按**面积**采样，不是朝顶点打射线——
         射线采样会把中间那段水稀释掉，实测 33% 刚好从 35% 的门槛下溜过去。
         只对靠河的街廓做，别为了 1300 个内陆街廓白跑几万次 inWater。 */
      const dq = river.dist(qc[0], qc[1]);
      if (dq.d < dq.w / 2 + 150){
        const qb = polyBBox(q.p);
        let wn = 0, wt = 0;
        for (let gi = 0; gi < 6; gi++) for (let gj = 0; gj < 6; gj++){
          const sx = qb[0] + (qb[2] - qb[0]) * (gi + 0.5) / 6;
          const sz = qb[1] + (qb[3] - qb[1]) * (gj + 0.5) / 6;
          if (!pointIn(q.p, sx, sz)) continue;
          wt++; if (river.inWater(sx, sz)) wn++;
        }
        if (wt >= 4 && wn / wt > 0.22) continue;
      }
      cut0.push(q);
    }
  }

  /* ── 8.10 街廓 → 内院 + 地块 ── */
  const blocks = [];
  let parcelCount = 0, chamferCount = 0;

  for (const B of cut0){
    let P = B.p, E = B.e;
    if (polyArea(P) < 0){ P = P.slice().reverse(); const E2 = []; for (let i = E.length - 1; i >= 0; i--) E2.push(E[(i + 1) % E.length]); E = E2; }
    /* ── 转角切角 pan coupé ──
       两条街相交、内角 <140° 时削角。关键是把切角**并进街廓轮廓本身**，
       而不是当成额外地块贴在原轮廓上——后者会让切角地块的朝街法线指回街廓里
       （第一轮实测 11% 的地块中招）。并进去之后，下面只需沿一条多边形走一圈。 */
    {
      const n0 = P.length;
      const trimS = new Float64Array(n0), trimE = new Float64Array(n0);
      const chW = new Float64Array(n0);
      for (let i = 0; i < n0; i++){
        const pv = P[(i - 1 + n0) % n0], v = P[i], nv = P[(i + 1) % n0];
        const ux = v[0] - pv[0], uz = v[1] - pv[1], vx = nv[0] - v[0], vz = nv[1] - v[1];
        const lu = Math.hypot(ux, uz), lv2 = Math.hypot(vx, vz);
        if (lu < 20 || lv2 < 20) continue;           /* 边太短，切完剩不下地块 */
        const interior = Math.PI - Math.acos(clamp((ux * vx + uz * vz) / (lu * lv2), -1, 1));
        if (interior >= 140 * Math.PI / 180) continue;
        const kP = E[(i - 1 + n0) % n0], kN = E[i];
        const big = kP.klass === 'boulevard' || kP.klass === 'avenue' ||
                    kN.klass === 'boulevard' || kN.klass === 'avenue';
        const cw = big ? 6.4 : 4.8;                  /* 1 个开间（窄街）/ 2 个（大道） */
        const t = cw / (2 * Math.sin(Math.max(0.35, interior / 2)));
        if (t > lu * 0.35 || t > lv2 * 0.35) continue;
        trimE[(i - 1 + n0) % n0] = t; trimS[i] = t; chW[i] = cw;
      }
      const P2 = [], E2 = [];
      for (let i = 0; i < n0; i++){
        const pv = P[(i - 1 + n0) % n0], v = P[i], nv = P[(i + 1) % n0];
        if (chW[i]){
          const lu = Math.hypot(v[0] - pv[0], v[1] - pv[1]) || 1;
          const lv2 = Math.hypot(nv[0] - v[0], nv[1] - v[1]) || 1;
          const t = trimS[i], kP = E[(i - 1 + n0) % n0], kN = E[i];
          /* 两侧檐口不同时取高的那个，切角面上留一道竖向错台（haussmann §10：不许抹平） */
          const hi = corniceH(kP.w, kP.klass) >= corniceH(kN.w, kN.klass) ? kP : kN;
          P2.push([v[0] - (v[0] - pv[0]) / lu * t, v[1] - (v[1] - pv[1]) / lu * t]);
          E2.push({id: hi.id, klass: hi.klass, w: hi.w, name: hi.name,
                   real: hi.real, place: hi.place, chamfer: chW[i]});
          P2.push([v[0] + (nv[0] - v[0]) / lv2 * t, v[1] + (nv[1] - v[1]) / lv2 * t]);
          E2.push(E[i]);
          chamferCount++;
        } else { P2.push(v); E2.push(E[i]); }
      }
      P = P2; E = E2;
    }

    const A = Math.abs(polyArea(P));
    const c = polyCentroid(P);
    const bb = polyBBox(P);
    const dCore = Math.hypot(c[0] - CORE[0], c[1] - CORE[1]);
    const gy = terrainY(c[0], c[1]);

    /* 进深与内院 —— 这两个是**不同的数**，第一轮把它们绑在一起是错的。

       depth = 临街楼的进深，12–17.5m（brief 与 haussmann 一致，facade.js 建曼萨屋顶要用它）。
       courtInset = 内院的内缩量，由「内院占街廓面积 18–30%，中位 22%」反解（haussmann §12）。

       为什么不能相等：一个 100m 见方的街廓，按 15m 进深一圈围下来，中间空 70m 见方
       ＝ 街廓的 49%，是文档上限的一倍半，从空中看整座城市就是一片空心画框
       （第一轮实测就是这个样子）。真实巴黎的大街廓内部不是空的，是临街楼加后部披屋，
       真正的天井只占两成。所以内院按比例反解，临街楼进深照旧。
       内缩后再夹回街廓内：尖角处 inset 会外飞，不夹会出现跑到街廓外面的内院。 */
    const ir = inradius(P, c);
    let depth = clamp(Math.sqrt(A) / 7.2, 11.5, 17.5);
    if (ir < depth + 2.5) depth = Math.max(9, Math.min(depth, ir * 0.82));
    const courtFrac = 0.18 + 0.12 * hp(c[0], c[1], 13);
    let courtInset = 0, court = null;
    {
      /* 闭式解只对方块成立，三角形和长条街廓按同一内缩量会缩掉太多
         （第一轮中位数掉到 15.7%）。所以直接对内缩量二分，逼到目标面积比。 */
      const want = courtFrac * A;
      let lo = depth + 1.5, hi = Math.max(lo, ir - 2.0), best = null, bestD = 0;
      const tryInset = d => {
        let ct = inset(P, d);
        if (ct) ct = clipToPoly(ct, P, 2.0);
        const ar = ct ? Math.abs(polyArea(ct)) : 0;
        return ar >= 200 ? {ct: ct, ar: ar} : null;
      };
      const at0 = tryInset(lo);
      if (at0){
        best = at0; bestD = lo;
        if (at0.ar > want){
          for (let it = 0; it < 7; it++){
            const mid = (lo + hi) / 2, r = tryInset(mid);
            if (r && r.ar > want){ best = r; bestD = mid; lo = mid; }
            else hi = mid;
          }
        }
        court = best.ct; courtInset = bestD;
      }
    }

    /* 临不临广场（业态权重要用） */
    let nearPl = null;
    for (const pl of placeGrid.query([bb[0] - 70, bb[1] - 70, bb[2] + 70, bb[3] + 70], tmpArr)){
      if (pl.kind === 'cemetery') continue;
      nearPl = pl.name; break;
    }

    /* ── 沿街切地块 ──
       blockRecent 按「本街廓 × 这条街」记最近两家，保证沿一条街廓边走过去
       不会连开两家咖啡馆；跨街廓不互锁（那是隔了一条街的事，锁上会把商业率打没）。 */
    const parcels = [];
    const runs = [];        /* 「临街墙段」——见文件末尾 block.runs 的说明 */
    const blockRecent = {};
    for (let i = 0, np = P.length; i < np; i++){
      const a = P[i], b = P[(i + 1) % np], m = E[i];
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      if (L < 2) continue;
      const ux = dx / L, uz = dz / L;
      const nx = uz, nz = -ux;                       /* 逆时针多边形 → 朝街外法线 */
      let Hh = corniceH(m.w, m.klass);
      if (gy > 16) Hh = H_STEPDOWN[Hh];              /* 蒙马特山上降一档 */
      const lvT = LEVELS[Hh];
      const sw = m.klass === 'quai' ? clamp(m.w * 0.28, 2.4, 7.0) : clamp(m.w * 0.235, 1.5, 6.5);
      const recent = blockRecent[m.id] || (blockRecent[m.id] = []);

      const runFrom = parcels.length;
      if (m.chamfer){                                /* 切角边整条就是一个地块 */
        const cx = (a[0] + b[0]) / 2, cz2 = (a[1] + b[1]) / 2;
        const use = pickUse(m.klass, true, !!nearPl, hp(cx, cz2, 71), recent);
        if (UNIQUE_USES[use]){ recent.push(use); if (recent.length > 2) recent.shift(); }
        const pc = mkParcel(a, b, nx, nz, m.chamfer <= 5.2 ? 1 : 2, L,
                            Math.min(depth, 14), Hh, lvT, sw, m, use, m.chamfer, cx, cz2);
        pc.edge = i; pc.ie = 0; pc.ne = 1;
        parcels.push(pc); parcelCount++;
        runs.push({edge: i, a: a, b: b, n: [nx, nz], len: L, chamfer: m.chamfer,
                   klass: m.klass, roadId: m.id, roadName: m.name, roadW: m.w,
                   H: Hh, hCorniche: Hh, hRoof: pc.hRoof, depth: pc.depth,
                   sidewalkW: sw, from: runFrom, to: parcels.length});
        continue;
      }
      if (L < 9.0) continue;                         /* 放不下 3 个开间，留给铺装 */

      const tw = targetW(m.klass, dCore);
      const totalBays = Math.max(3, Math.round(L / 3.2));
      let cnt = clamp(Math.round(L / tw), Math.ceil(totalBays / 6.8), Math.floor(totalBays / 3));
      if (cnt < 1) cnt = 1;
      const base = Math.floor(totalBays / cnt);
      let rest = totalBays - base * cnt;
      const bys = new Array(cnt).fill(base);
      for (let k = 0; k < cnt && rest > 0; k++){ bys[k]++; rest--; }
      /* 抖一抖，别让一条边上全是等宽；上下界 3–7 开间 = 9.6–22.4m 面宽 */
      for (let k = 0; k + 1 < cnt; k++){
        const r = hp(a[0] + ux * (k * 20), a[1] + uz * (k * 20), 51);
        if (r > 0.66 && bys[k] > 3 && bys[k + 1] < 7){ bys[k]--; bys[k + 1]++; }
        else if (r < 0.28 && bys[k + 1] > 3 && bys[k] < 7){ bys[k]++; bys[k + 1]--; }
      }
      let acc = 0;
      for (let k = 0; k < cnt; k++){
        const segL = L * bys[k] / totalBays;
        const p0 = [a[0] + ux * acc, a[1] + uz * acc];
        const p1 = [a[0] + ux * (acc + segL), a[1] + uz * (acc + segL)];
        acc += segL;
        const mx = (p0[0] + p1[0]) / 2, mz = (p0[1] + p1[1]) / 2;
        /* 开间数按**实际**面宽定，保证步距落在法令区间 2.90–3.80（haussmann §3）。
           先按 3.2 名义分配、再按实际长度定开间，两头都对得上。 */
        const lo = Math.ceil(segL / 3.80), hiB = Math.floor(segL / 2.90);
        const bays = hiB >= lo ? clamp(Math.round(segL / 3.2), lo, hiB)
                               : Math.max(1, Math.round(segL / 3.2));
        let np2 = false;
        if (nearPl){
          for (const pl of placeGrid.query([mx - 40, mz - 40, mx + 40, mz + 40], tmpArr2))
            if (pointIn(pl.poly, mx + nx * 26, mz + nz * 26)){ np2 = true; break; }
        }
        const use = pickUse(m.klass, false, np2, hp(mx, mz, 61), recent);
        if (UNIQUE_USES[use]){ recent.push(use); if (recent.length > 2) recent.shift(); }
        const pc = mkParcel(p0, p1, nx, nz, bays, segL, depth, Hh, lvT, sw, m, use, false, mx, mz);
        pc.edge = i; pc.ie = k; pc.ne = cnt;
        parcels.push(pc); parcelCount++;
      }
      if (parcels.length > runFrom){
        const f = parcels[runFrom], t = parcels[parcels.length - 1];
        runs.push({edge: i, a: f.seg[0], b: t.seg[1], n: [nx, nz],
                   len: Math.hypot(t.seg[1][0] - f.seg[0][0], t.seg[1][1] - f.seg[0][1]),
                   chamfer: 0, klass: m.klass, roadId: m.id, roadName: m.name, roadW: m.w,
                   H: Hh, hCorniche: Hh, hRoof: f.hRoof, depth: f.depth,
                   sidewalkW: sw, from: runFrom, to: parcels.length});
      }
    }

    blocks.push({
      poly: P, court: court, courtInset: courtInset, courtArea: court ? Math.abs(polyArea(court)) : 0,
      area: A, centroid: c, bb: bb, y0: gy,
      depth: depth, place: nearPl, parcels: parcels, runs: runs,
      klasses: E.map(x => x.klass)
    });
  }

  function mkParcel(p0, p1, nx, nz, bays, segL, dep, Hh, lv, sw, m, use, chamfer, mx, mz){
    const hB = Math.min(4.80, Math.max(0.8, (dep - 3.0) / 2));
    const terr = Math.max(0.6, dep / 2 - hB);
    const gy2 = terrainY(mx, mz);
    return {
      seg: [p0, p1], n: [nx, nz],
      /* w = 实际临街面宽（几何按它建就严丝合缝地铺满街廓边）；
         wq = 量化到 3.2m 开间的名义面宽；bays = 开间数，pitch = w/bays 保证落在
         法令区间 2.90–3.80。贴图按 bays 排就不会拉伸窗律。 */
      w: segL, wq: bays * 3.2, segLen: segL, pitch: segL / bays, bays: bays, depth: dep,
      floors: lv.rows.length, H: Hh, hCorniche: Hh, hRoof: Hh + hB + TAN12 * terr,
      hBrisis: hB, chamfer: chamfer, sidewalkW: sw,
      roadClass: m.klass, roadId: m.id, roadName: m.name, roadW: m.w,
      frontsPlace: !!m.place,
      use: use, y0: gy2,
      variant: {
        facadeId: (hp(mx, mz, 81) * 8) | 0,
        balconyRows: lv.balcony, railRows: lv.rail,
        dormers: Math.max(1, Math.round(bays * (0.5 + 0.4 * hp(mx, mz, 91)))),
        paint: (hp(mx, mz, 101) * 6) | 0,
        awning: (hp(mx, mz, 111) * 6) | 0,
        stoneTone: (hp(mx, mz, 121) * 4) | 0,
        seed: (hp(mx, mz, 131) * 1e6) | 0
      }
    };
  }

  /* ── 8.11 路网收口 ──
     streets.json 里的街不一定都被用成了切割线（子块切到够小就不再切了），
     没被用上的那几条会直接从街廓中间穿过去——terrain.js 照着 roads 铺路面，
     就会把马路铺到楼里。所以最后统一裁一遍：
     ① 落在任何街廓内部的路段一律切掉；② 伸出城市边界太远的尾巴也切掉。
     裁完的 roads 才是这份平面真正的路网；streets 保留未裁的地理原线供查证。 */
  {
    const outer = inset(BOUND, -220) || BOUND;
    const bIdx = blocks.map((b, i) => ({bb: b.bb, i: i}));
    const bg = bIdx.length ? grid(bIdx, 320, 0) : null;
    const sink2 = [];
    /* 线段 [0,L] 落在凸多边形内的参数区间；无交返回 null */
    function insideSpan(P, ax, az, ux, uz, L){
      let t0 = 0, t1 = L;
      for (let i = 0, n = P.length; i < n; i++){
        const a = P[i], b = P[(i + 1) % n];
        const ex = b[0] - a[0], ez = b[1] - a[1], el = Math.hypot(ex, ez) || 1;
        const nx = ez / el, nz = -ex / el;
        const den = nx * ux + nz * uz, num = (nx * a[0] + nz * a[1]) - (nx * ax + nz * az);
        if (Math.abs(den) < 1e-9){ if (num < 0) return null; continue; }
        const t = num / den;
        if (den > 0){ if (t < t1) t1 = t; } else if (t > t0) t0 = t;
        if (t0 >= t1) return null;
      }
      return [t0, t1];
    }
    const kept = [];
    for (const r of roads){
      const ax = r.a[0], az = r.a[1];
      const dx = r.b[0] - ax, dz = r.b[1] - az, L = Math.hypot(dx, dz);
      if (L < 6) continue;
      const ux = dx / L, uz = dz / L;
      const inB = insideSpan(outer, ax, az, ux, uz, L);
      if (!inB) continue;
      let free = [[Math.max(0, inB[0]), Math.min(L, inB[1])]];
      if (bg){
        const bb = [Math.min(r.a[0], r.b[0]) - 1, Math.min(r.a[1], r.b[1]) - 1,
                    Math.max(r.a[0], r.b[0]) + 1, Math.max(r.a[1], r.b[1]) + 1];
        for (const it of bg.query(bb, sink2)){
          const sp = insideSpan(blocks[it.i].poly, ax, az, ux, uz, L);
          if (!sp || sp[1] - sp[0] < 0.5) continue;
          const nf = [];
          for (const f of free){
            if (sp[1] <= f[0] || sp[0] >= f[1]){ nf.push(f); continue; }
            if (sp[0] > f[0]) nf.push([f[0], sp[0]]);
            if (sp[1] < f[1]) nf.push([sp[1], f[1]]);
          }
          free = nf;
          if (!free.length) break;
        }
      }
      for (const f of free){
        if (f[1] - f[0] < 12) continue;
        kept.push({a: [ax + ux * f[0], az + uz * f[0]], b: [ax + ux * f[1], az + uz * f[1]],
                   w: r.w, klass: r.klass, name: r.name, id: r.id, real: r.real});
      }
    }
    roads.length = 0;
    for (const r of kept) roads.push(r);
  }

  /* ── 8.12 桥 ── */
  const bridges = D.bridges.map(b => {
    const p = geo(b.lon, b.lat);
    const dd = river.dist(p[0], p[1]);
    const az = b.azimuthDeg * Math.PI / 180;
    const dx = Math.sin(az), dz = Math.cos(az);            /* 桥的长轴方向（0°=正北，90°=正东） */
    const half = (b.lengthM || 100) / 2;
    const o = {};
    for (const k in b) o[k] = b[k];
    o.x = p[0]; o.z = p[1]; o.t = dd.t; o.riverW = dd.w;
    o.dir = [dx, dz];
    o.perp = [dz, -dx];
    /* THREE 里沿 +X 建模、绕 Y 转 angle 后即与 dir 对齐 */
    o.angle = Math.atan2(-dz, dx);
    o.endA = [p[0] - dx * half, p[1] - dz * half];
    o.endB = [p[0] + dx * half, p[1] + dz * half];
    return o;
  });

  /* ── 8.13 统计 ── */
  const T1 = (typeof performance !== 'undefined' && performance.now) ? performance.now()
           : (typeof process !== 'undefined' ? Number(process.hrtime.bigint() / 1000n) / 1000 : Date.now());
  let vtot = 0, aTot = 0, wTot = 0, wN = 0;
  const useCount = {};
  for (const b of blocks){
    vtot += b.poly.length; aTot += b.area;
    for (const p of b.parcels){
      useCount[p.use] = (useCount[p.use] || 0) + 1;
      if (!p.chamfer){ wTot += p.w; wN++; }
    }
  }
  /* 全城建成用地占多少，以及 LOD1 环（1100m）里平均会命中多少 parcel。
     这个数是 facade.js 的真实预算依据，比总数有用。 */
  const lod1Frac = Math.min(1, Math.PI * 1100 * 1100 / Math.max(1, aTot));
  const stats = {
    blocks: blocks.length,
    parcels: parcelCount,
    chamfers: chamferCount,
    roads: roads.length,
    realRoads: roads.filter(r => r.real).length,
    places: places.length,
    bridges: bridges.length,
    riverLen: Math.round(river.len),
    riverPts: river.pts.length,
    courts: blocks.filter(b => b.court).length,
    builtAreaKm2: +(aTot / 1e6).toFixed(2),
    avgBlockArea: Math.round(aTot / Math.max(1, blocks.length)),
    avgParcelW: +(wTot / Math.max(1, wN)).toFixed(2),
    useMix: useCount,
    ms: Math.round((T1 - T0) * 10) / 10,
    /* 给下游做预算参考。LOD2 必须按街廓合并，逐 parcel 出盒子会直接超预算。 */
    /* 这两行是实测值，不是估算：本平面在 test.html 里分别用两种方式建过一遍全城。 */
    tris_measured: {
      perBlockRing: 161000,      /* 按 blocks 挤出环体 + 曼萨帽：161k tri / 8 draw call / 120fps */
      perParcelPrism: 806000     /* 逐 parcel 出棱柱 + 曼萨：806k tri / 16 draw call —— 单这一层就吃掉全城预算 */
    },
    tris_estimate: {
      lod2_blocks: Math.round(vtot * 10 + blocks.length * 16),
      lod1_parcels: Math.round(parcelCount * lod1Frac),
      note: 'LOD2 必须按 block.poly + block.court 合并成一圈挤出体（实测全城 161k tri / 8 call）；' +
            '逐 parcel 建几何实测 806k tri，只能留给 LOD1/LOD0 环内的 ' +
            Math.round(parcelCount * lod1Frac) + ' 个。' +
            '屋顶请按 block.runs 分段合并，不要逐 parcel 出曼萨——那会让屋面变成锯齿。'
    }
  };

  return {
    seed: SEED, version: '1.0',
    Y: Y, geo: geo, bbox: cityBB, boundary: BOUND,
    terrainY: terrainY, hills: HILLS,
    river: river, quays: quays, ramps: ramps, islands: islands,
    roads: roads, streets: streets,
    blocks: blocks, places: places, bridges: bridges, landmarks: landmarks,
    levelTables: LEVELS, corniceH: corniceH,
    stats: stats
  };
}

window.PCPlan = {generate: generate, terrainY: terrainY, geo: geo, Y: Y, levelTables: LEVELS, version: '1.0'};

/* ══════════════════════════════════════════════════════════════════════════
   数据区 —— 由 city/data/{seine,streets,places,bridges}.json 机器内联，勿手改。
   为什么内联：file:// 协议下 fetch 必然失败，而 test.html 只同步加载 plan.js
   这一个脚本，没有第二个位置可以放数据。
   ══════════════════════════════════════════════════════════════════════════ */
const DATA = {"seine":{"centerline":[[2.36256,48.84763],[2.36139,48.84857],[2.36002,48.84973],[2.35891,48.85049],[2.35769,48.85116],[2.35635,48.8517],[2.35498,48.85216],[2.35364,48.85261],[2.35169,48.85329],[2.34988,48.85401],[2.34809,48.85469],[2.34616,48.85534],[2.34482,48.85582],[2.34348,48.85637],[2.34211,48.85695],[2.34071,48.85752],[2.33923,48.85799],[2.33769,48.85837],[2.33613,48.85869],[2.33458,48.85899],[2.33307,48.85931],[2.33163,48.85966],[2.32957,48.86025],[2.32756,48.86093],[2.32618,48.8614],[2.32475,48.86186],[2.32327,48.86231],[2.32178,48.86275],[2.32027,48.86319],[2.31873,48.86352],[2.31714,48.8637],[2.31552,48.86373],[2.31388,48.86369],[2.31224,48.86364],[2.3106,48.86362],[2.30897,48.8636],[2.30733,48.86358],[2.30569,48.86355],[2.30405,48.86353],[2.30242,48.86349],[2.3008,48.86339],[2.29921,48.86317],[2.29767,48.86283],[2.2962,48.86236],[2.29487,48.86176],[2.29364,48.86106],[2.29252,48.86027],[2.29144,48.85946],[2.29039,48.85863],[2.28942,48.85775],[2.28852,48.85684],[2.28761,48.85594],[2.28663,48.85506],[2.28556,48.85424],[2.28448,48.85346],[2.28304,48.85242],[2.28198,48.85165],[2.28185,48.85156]],"width":[[2.36256,48.84763,150],[2.36139,48.84857,150],[2.36002,48.84973,223],[2.35891,48.85049,302],[2.35769,48.85116,347],[2.35635,48.8517,349],[2.35498,48.85216,352],[2.35364,48.85261,363],[2.35169,48.85329,385],[2.34988,48.85401,397],[2.34809,48.85469,394],[2.34616,48.85534,391],[2.34482,48.85582,373],[2.34348,48.85637,332],[2.34211,48.85695,278],[2.34071,48.85752,223],[2.33923,48.85799,176],[2.33769,48.85837,142],[2.33613,48.85869,130],[2.33458,48.85899,125],[2.33307,48.85931,125],[2.33163,48.85966,122],[2.32957,48.86025,121],[2.32756,48.86093,110],[2.32618,48.8614,105],[2.32475,48.86186,106],[2.32327,48.86231,113],[2.32178,48.86275,124],[2.32027,48.86319,134],[2.31873,48.86352,131],[2.31714,48.8637,124],[2.31552,48.86373,113],[2.31388,48.86369,109],[2.31224,48.86364,112],[2.3106,48.86362,115],[2.30897,48.8636,114],[2.30733,48.86358,112],[2.30569,48.86355,111],[2.30405,48.86353,112],[2.30242,48.86349,114],[2.3008,48.86339,115],[2.29921,48.86317,111],[2.29767,48.86283,108],[2.2962,48.86236,116],[2.29487,48.86176,122],[2.29364,48.86106,122],[2.29252,48.86027,117],[2.29144,48.85946,114],[2.29039,48.85863,105],[2.28942,48.85775,113],[2.28852,48.85684,144],[2.28761,48.85594,179],[2.28663,48.85506,197],[2.28556,48.85424,197],[2.28448,48.85346,194],[2.28304,48.85242,189],[2.28198,48.85165,187],[2.28185,48.85156,186]],"islands":{"cite":[[2.35263,48.85161],[2.35267,48.85166],[2.35242,48.85212],[2.35222,48.85325],[2.35207,48.85368],[2.35189,48.854],[2.3513,48.85461],[2.35082,48.85493],[2.35079,48.85491],[2.3505,48.85504],[2.35047,48.85509],[2.34964,48.85543],[2.34818,48.85577],[2.3472,48.85609],[2.34633,48.85632],[2.34544,48.85662],[2.34395,48.85693],[2.34312,48.85702],[2.34308,48.85706],[2.34169,48.8573],[2.34122,48.85729],[2.33936,48.85779],[2.33931,48.85778],[2.33932,48.85773],[2.34022,48.85728],[2.34093,48.85686],[2.34303,48.85507],[2.34385,48.85469],[2.34383,48.85467],[2.34525,48.85408],[2.34659,48.85361],[2.34688,48.85345],[2.34718,48.85337],[2.3485,48.85276],[2.34973,48.8523],[2.35182,48.85176]],"saintLouis":[[2.35303,48.85377],[2.35296,48.85368],[2.3532,48.85267],[2.35331,48.85248],[2.35354,48.85223],[2.35348,48.8522],[2.35355,48.85212],[2.3535,48.8521],[2.35391,48.8516],[2.35526,48.85123],[2.3554,48.85126],[2.3563,48.85091],[2.35917,48.84998],[2.35977,48.84971],[2.36029,48.84943],[2.36037,48.84944],[2.3601,48.85027],[2.3601,48.85061],[2.36021,48.85108],[2.35981,48.85151],[2.35931,48.85176],[2.35869,48.852],[2.354,48.85356],[2.35319,48.85379]],"cygnes":[[2.28766,48.85581],[2.28087,48.851],[2.28007,48.85048],[2.27963,48.85016],[2.27953,48.85002],[2.27958,48.84992],[2.27975,48.84993],[2.27992,48.85],[2.28077,48.85057],[2.28111,48.85089],[2.28787,48.85564],[2.28796,48.85579],[2.28787,48.85585]]},"islandMeta":{"cite":{"name":"Île de la Cité","nameZh":"西岱岛","perimeterM":2471,"note":"西端尖角为 Square du Vert-Galant，标高低于街面约 6m；东端尖角为圣母院后方的 Square Jean-XXIII／Île-de-France"},"saintLouis":{"name":"Île Saint-Louis","nameZh":"圣路易岛","perimeterM":1586,"note":"17 世纪一次性规划的棋盘街区，四面均有下层河岸步道"},"cygnes":{"name":"Île aux Cygnes","nameZh":"天鹅岛","perimeterM":1782,"note":"1827 年人工堤岛，宽仅约 11m；北端尖角承托比尔阿凯姆桥中央桥墩，立有 La France renaissante 骑马像"}},"quays":[{"side":"right","name":"Avenue de New York","nameZh":"纽约大道河岸","path":[[2.3014,48.86403],[2.30121,48.86405],[2.30088,48.86401],[2.29892,48.86369],[2.29744,48.86336],[2.29535,48.86268],[2.29429,48.8624],[2.29377,48.86211],[2.29321,48.8615],[2.2926,48.86103],[2.2923,48.86091],[2.2912,48.86013],[2.28978,48.85889]],"hasBerge":true,"wallH":6.6,"bergeW":14,"bergeName":"Port Debilly"},{"side":"right","name":"Cours Albert-Iᵉʳ","nameZh":"阿尔贝一世大道河岸","path":[[2.31331,48.86416],[2.31157,48.86411],[2.30903,48.86412],[2.30331,48.864],[2.30198,48.86404]],"hasBerge":true,"wallH":6.6,"bergeW":20,"bergeName":"Port de la Conférence"},{"side":"right","name":"Cours la Reine","nameZh":"王后林荫道河岸","path":[[2.32025,48.86386],[2.31869,48.86436],[2.31837,48.8644],[2.3155,48.8642],[2.31157,48.86411],[2.31024,48.86414]],"hasBerge":true,"wallH":6.6,"bergeW":22,"bergeName":"Port des Champs-Élysées"},{"side":"right","name":"Quai des Tuileries","nameZh":"杜乐丽码头","path":[[2.32519,48.86225],[2.31978,48.86402]],"hasBerge":true,"wallH":6.6,"bergeW":18,"bergeName":"Port de la Concorde"},{"side":"right","name":"Quai Aimé Césaire","nameZh":"艾梅·塞泽尔码头","path":[[2.33015,48.86061],[2.32994,48.86072],[2.32493,48.86234]],"hasBerge":true,"wallH":6.6,"bergeW":12,"bergeName":"Voie Georges-Pompidou（隧道段）"},{"side":"right","name":"Quai François Mitterrand","nameZh":"密特朗码头","path":[[2.33958,48.85878],[2.33847,48.85892],[2.33781,48.85907],[2.33648,48.8592],[2.33524,48.85943],[2.33342,48.8598],[2.33241,48.86007],[2.33194,48.86011],[2.33189,48.86016],[2.33144,48.86023],[2.33076,48.86042],[2.33044,48.86056],[2.33036,48.86054],[2.33015,48.86061],[2.32994,48.86072]],"hasBerge":true,"wallH":6.6,"bergeW":12,"bergeName":"Port du Louvre"},{"side":"right","name":"Quai du Louvre","nameZh":"卢浮宫码头","path":[[2.3425,48.85824],[2.33958,48.85878]],"hasBerge":true,"wallH":6.6,"bergeW":12,"bergeName":"Port du Louvre"},{"side":"right","name":"Quai de la Mégisserie","nameZh":"梅吉斯里码头","path":[[2.34718,48.85696],[2.34211,48.85832]],"hasBerge":true,"wallH":6.6,"bergeW":10,"bergeName":"Parc Rives de Seine 右岸段"},{"side":"right","name":"Quai de Gesvres","nameZh":"热夫尔码头","path":[[2.35066,48.85585],[2.34896,48.85645],[2.3468,48.85707]],"hasBerge":true,"wallH":6.6,"bergeW":10,"bergeName":"Parc Rives de Seine 右岸段"},{"side":"right","name":"Quai de l'Hôtel de Ville","nameZh":"市政厅码头","path":[[2.35768,48.85301],[2.35565,48.85374],[2.35423,48.8543],[2.35416,48.85429],[2.35243,48.85498],[2.35097,48.85574],[2.35066,48.85585]],"hasBerge":true,"wallH":6.6,"bergeW":12,"bergeName":"Parc Rives de Seine 右岸段"},{"side":"right","name":"Quai des Célestins","nameZh":"塞莱斯坦码头","path":[[2.36106,48.85006],[2.36093,48.85058],[2.36089,48.85153],[2.36053,48.85195],[2.35768,48.85301]],"hasBerge":true,"wallH":6.6,"bergeW":12,"bergeName":"Parc Rives de Seine 右岸段"},{"side":"right","name":"Quai Henri IV","nameZh":"亨利四世码头","path":[[2.36133,48.84944],[2.36103,48.85016],[2.36093,48.85078]],"hasBerge":true,"wallH":6.6,"bergeW":16,"bergeName":"Port Henri IV"},{"side":"left","name":"Quai de Grenelle","nameZh":"格勒奈勒码头","path":[[2.28554,48.85292],[2.28062,48.84945]],"hasBerge":true,"wallH":6.6,"bergeW":14,"bergeName":"Port de Grenelle"},{"side":"left","name":"Quai Jacques Chirac","nameZh":"雅克·希拉克码头","path":[[2.29741,48.86228],[2.29579,48.86165],[2.29465,48.86101],[2.29295,48.85985],[2.29281,48.85956],[2.29241,48.8593],[2.29206,48.85921],[2.29014,48.85777],[2.28954,48.85704],[2.28901,48.85575],[2.28881,48.85543],[2.28823,48.85483]],"hasBerge":true,"wallH":6.6,"bergeW":16,"bergeName":"Port de Suffren"},{"side":"left","name":"Quai Branly","nameZh":"布朗利码头","path":[[2.30151,48.86297],[2.30019,48.8629],[2.29928,48.86279],[2.29886,48.86271],[2.29694,48.86212]],"hasBerge":true,"wallH":6.6,"bergeW":26,"bergeName":"Port de la Bourdonnais"},{"side":"left","name":"Quai d'Orsay","nameZh":"奥赛码头","path":[[2.31994,48.86262],[2.31804,48.86321],[2.31733,48.86326],[2.31159,48.86313],[2.31054,48.86307],[2.30953,48.86312],[2.30208,48.86299]],"hasBerge":true,"wallH":6.6,"bergeW":20,"bergeName":"Berges de Seine 左岸段（2013 步行化）"},{"side":"left","name":"Quai Anatole France","nameZh":"阿纳托尔·法朗士码头","path":[[2.32468,48.86136],[2.32209,48.86214],[2.32146,48.86219],[2.31987,48.86264]],"hasBerge":true,"wallH":6.6,"bergeW":20,"bergeName":"Berges de Seine 左岸段（2013 步行化）"},{"side":"left","name":"Quai Valéry Giscard d'Estaing","nameZh":"德斯坦码头","path":[[2.32969,48.85965],[2.32948,48.85971],[2.32929,48.85967],[2.32912,48.85972],[2.32806,48.86013],[2.32662,48.86077],[2.32443,48.86144]],"hasBerge":true,"wallH":6.6,"bergeW":10,"bergeName":null},{"side":"left","name":"Quai Voltaire","nameZh":"伏尔泰码头","path":[[2.33288,48.85877],[2.33114,48.85916],[2.33004,48.85951],[2.32975,48.85953],[2.32969,48.85965],[2.32948,48.85971],[2.32929,48.85967],[2.32912,48.85972]],"hasBerge":true,"wallH":6.6,"bergeW":8,"bergeName":null},{"side":"left","name":"Quai Malaquais","nameZh":"马拉盖码头","path":[[2.33633,48.85807],[2.33556,48.85824],[2.33509,48.85823],[2.33386,48.85851]],"hasBerge":true,"wallH":6.6,"bergeW":8,"bergeName":null},{"side":"left","name":"Quai de Conti","nameZh":"孔蒂码头","path":[[2.34081,48.85624],[2.33829,48.85758],[2.33793,48.85772],[2.33633,48.85807]],"hasBerge":true,"wallH":6.6,"bergeW":8,"bergeName":null},{"side":"left","name":"Quai des Grands Augustins","nameZh":"大奥古斯丁码头","path":[[2.34451,48.85384],[2.34251,48.85479],[2.34081,48.85624],[2.3405,48.85642]],"hasBerge":true,"wallH":6.6,"bergeW":8,"bergeName":null},{"side":"left","name":"Quai Saint-Michel","nameZh":"圣米歇尔码头","path":[[2.34707,48.85313],[2.3448,48.85375],[2.34423,48.85396]],"hasBerge":false,"wallH":8.6,"bergeW":0,"bergeName":null},{"side":"left","name":"Quai de Montebello","nameZh":"蒙特贝洛码头","path":[[2.35006,48.85183],[2.34848,48.85243],[2.34707,48.85313],[2.34675,48.85323]],"hasBerge":true,"wallH":6.6,"bergeW":14,"bergeName":"Port de Montebello"},{"side":"left","name":"Quai de la Tournelle","nameZh":"图尔奈勒码头","path":[[2.35737,48.8496],[2.35542,48.85021],[2.35467,48.85053],[2.35286,48.8511],[2.35161,48.85136]],"hasBerge":true,"wallH":6.6,"bergeW":18,"bergeName":"Port de la Tournelle"},{"side":"left","name":"Quai Saint-Bernard","nameZh":"圣贝尔纳码头","path":[[2.35938,48.84877],[2.35885,48.84912],[2.35737,48.8496]],"hasBerge":true,"wallH":6.6,"bergeW":24,"bergeName":"Port Saint-Bernard"},{"side":"island","name":"Quai de l'Horloge","nameZh":"钟楼码头","path":[[2.34669,48.85622],[2.34544,48.85662],[2.34494,48.85674],[2.34395,48.85693],[2.34312,48.85702],[2.34169,48.8573],[2.34128,48.85729]],"hasBerge":false,"wallH":8.6,"bergeW":0,"bergeName":null},{"side":"island","name":"Quai de la Corse - Pasquale Paoli","nameZh":"科西嘉码头","path":[[2.3505,48.85504],[2.34964,48.85543],[2.34818,48.85577],[2.34632,48.85632]],"hasBerge":false,"wallH":8.6,"bergeW":0,"bergeName":null},{"side":"island","name":"Quai aux Fleurs","nameZh":"花市码头","path":[[2.35222,48.85325],[2.35189,48.854],[2.35136,48.85454],[2.35079,48.85491],[2.35016,48.85519]],"hasBerge":false,"wallH":8.6,"bergeW":0,"bergeName":null},{"side":"island","name":"Quai des Orfèvres","nameZh":"金银匠码头","path":[[2.34503,48.85417],[2.34296,48.85512],[2.34117,48.85668],[2.34122,48.85729]],"hasBerge":false,"wallH":8.6,"bergeW":0,"bergeName":null},{"side":"island","name":"Quai du Marché Neuf - Maurice Grimaud","nameZh":"新市场码头","path":[[2.34718,48.85337],[2.34464,48.85434]],"hasBerge":false,"wallH":8.6,"bergeW":0,"bergeName":null},{"side":"island","name":"Quai de l'Archevêché","nameZh":"主教府码头","path":[[2.35238,48.8523],[2.35229,48.85279],[2.35148,48.85186]],"hasBerge":true,"wallH":6.6,"bergeW":6,"bergeName":"岛南岸下层小平台"},{"side":"island","name":"Quai de Bourbon","nameZh":"波旁码头","path":[[2.35537,48.85309],[2.354,48.85356],[2.3531,48.85308],[2.35307,48.85319],[2.35325,48.85377],[2.3531,48.85379],[2.35296,48.85366]],"hasBerge":true,"wallH":6.6,"bergeW":6,"bergeName":"岛岸下层步道"},{"side":"island","name":"Quai d'Anjou","nameZh":"安茹码头","path":[[2.3601,48.85061],[2.36019,48.85102],[2.36004,48.85128],[2.35981,48.85151],[2.35869,48.852]],"hasBerge":true,"wallH":6.6,"bergeW":6,"bergeName":"岛岸下层步道"},{"side":"island","name":"Quai d'Orléans","nameZh":"奥尔良码头","path":[[2.35612,48.85099],[2.3554,48.85126],[2.35529,48.85123],[2.35394,48.85158],[2.35366,48.85186],[2.35354,48.85223],[2.3532,48.85267]],"hasBerge":true,"wallH":6.6,"bergeW":6,"bergeName":"岛岸下层步道"},{"side":"island","name":"Quai de Béthune","nameZh":"贝蒂讷码头","path":[[2.35917,48.84998],[2.35612,48.85099]],"hasBerge":true,"wallH":6.6,"bergeW":6,"bergeName":"岛岸下层步道"}],"ramps":[{"lon":2.29893,"lat":48.86373,"name":"Rampe du Port Debilly","side":"right","kind":"vehicle"},{"lon":2.30205,"lat":48.86406,"name":"Rampe du Port de la Conférence","side":"right","kind":"vehicle"},{"lon":2.3186,"lat":48.8646,"name":"Rampe du Port des Champs-Élysées","side":"right","kind":"vehicle"},{"lon":2.32462,"lat":48.86249,"name":"Rampe du Port de la Concorde（隧道口）","side":"right","kind":"vehicle"},{"lon":2.33009,"lat":48.8607,"name":"Rampe du Port du Louvre","side":"right","kind":"pedestrian"},{"lon":2.34029,"lat":48.85873,"name":"Rampe du Port du Louvre（东端）","side":"right","kind":"pedestrian"},{"lon":2.34712,"lat":48.85723,"name":"Descente Quai de la Mégisserie／Châtelet","side":"right","kind":"pedestrian"},{"lon":2.35782,"lat":48.85333,"name":"Descente Quai des Célestins","side":"right","kind":"pedestrian"},{"lon":2.36177,"lat":48.84899,"name":"Rampe du Port Henri IV","side":"right","kind":"vehicle"},{"lon":2.28856,"lat":48.85483,"name":"Rampe du Port de Suffren","side":"left","kind":"vehicle"},{"lon":2.29285,"lat":48.85955,"name":"Rampe du Port de la Bourdonnais（西端）","side":"left","kind":"vehicle"},{"lon":2.30103,"lat":48.86283,"name":"Rampe du Port de la Bourdonnais（东端）","side":"left","kind":"pedestrian"},{"lon":2.32419,"lat":48.86111,"name":"Descente Quai Anatole France／Orsay","side":"left","kind":"pedestrian"},{"lon":2.34702,"lat":48.85312,"name":"Rampe du Port de Montebello","side":"left","kind":"vehicle"},{"lon":2.3513,"lat":48.8514,"name":"Rampe du Port de la Tournelle","side":"left","kind":"vehicle"},{"lon":2.35895,"lat":48.84897,"name":"Rampe du Port Saint-Bernard","side":"left","kind":"vehicle"}]},"streets":[{"name":"纽约大道河岸","nameFr":"Avenue de New York","klass":"quai","widthM":30,"pts":[[2.301366,48.864455],[2.296657,48.863432],[2.293862,48.862547],[2.287898,48.857933]]},{"name":"阿尔贝一世滨河路","nameFr":"Cours Albert-Iᵉʳ","klass":"quai","widthM":30,"pts":[[2.31032,48.864911],[2.302025,48.864736]]},{"name":"王后大道","nameFr":"Cours la Reine","klass":"quai","widthM":34,"pts":[[2.310342,48.864611],[2.318096,48.864768],[2.320106,48.864069]]},{"name":"杜乐丽河岸","nameFr":"Quai des Tuileries","klass":"quai","widthM":26,"pts":[[2.320106,48.864069],[2.325013,48.862507]]},{"name":"密特朗河岸","nameFr":"Quai François Mitterrand","klass":"quai","widthM":26,"pts":[[2.330072,48.860897],[2.330737,48.860673],[2.336568,48.859383],[2.339848,48.85899]]},{"name":"杂货商河岸","nameFr":"Quai de la Mégisserie","klass":"quai","widthM":24,"pts":[[2.342464,48.858483],[2.347116,48.857233]]},{"name":"热夫尔河岸","nameFr":"Quai de Gesvres","klass":"quai","widthM":24,"pts":[[2.347116,48.857233],[2.348955,48.856717],[2.350705,48.85607]]},{"name":"市政厅河岸","nameFr":"Quai de l'Hôtel de Ville","klass":"quai","widthM":24,"pts":[[2.350705,48.85607],[2.355514,48.854151],[2.357816,48.853333]]},{"name":"塞莱斯坦河岸","nameFr":"Quai des Célestins","klass":"quai","widthM":26,"pts":[[2.357816,48.853333],[2.360586,48.852319],[2.36231,48.851313]]},{"name":"亨利四世河岸","nameFr":"Quai Henri IV","klass":"quai","widthM":28,"pts":[[2.361431,48.850828],[2.361456,48.849852],[2.361641,48.849486],[2.364654,48.84745],[2.365342,48.846796]]},{"name":"希拉克河岸","nameFr":"Quai Jacques Chirac","klass":"quai","widthM":30,"pts":[[2.297603,48.861721],[2.295983,48.86098],[2.291704,48.858077],[2.290719,48.857304],[2.290126,48.856625],[2.289455,48.855137],[2.288881,48.854607]]},{"name":"布朗利河岸","nameFr":"Quai Branly","klass":"quai","widthM":30,"pts":[[2.301607,48.862426],[2.299684,48.862241],[2.297603,48.861721]]},{"name":"奥赛河岸","nameFr":"Quai d'Orsay","klass":"quai","widthM":28,"pts":[[2.301945,48.862439],[2.30318,48.862397],[2.309661,48.862545],[2.310639,48.862599],[2.311856,48.862816],[2.31764,48.862908],[2.318346,48.862836],[2.319833,48.8624]]},{"name":"阿纳托尔法朗士河岸","nameFr":"Quai Anatole France","klass":"quai","widthM":26,"pts":[[2.324193,48.861115],[2.319833,48.8624]]},{"name":"伏尔泰河岸","nameFr":"Quai Voltaire","klass":"quai","widthM":22,"pts":[[2.333267,48.858266],[2.329285,48.859551]]},{"name":"马拉盖河岸","nameFr":"Quai Malaquais","klass":"quai","widthM":22,"pts":[[2.336228,48.857875],[2.335116,48.857824],[2.333267,48.858266]]},{"name":"孔蒂河岸","nameFr":"Quai de Conti","klass":"quai","widthM":22,"pts":[[2.340402,48.856131],[2.338093,48.857461],[2.336228,48.857875]]},{"name":"大奥古斯丁河岸","nameFr":"Quai des Grands Augustins","klass":"quai","widthM":22,"pts":[[2.34434,48.853768],[2.342539,48.854621],[2.340402,48.856131]]},{"name":"圣米歇尔河岸","nameFr":"Quai Saint-Michel","klass":"quai","widthM":24,"pts":[[2.346801,48.853073],[2.34434,48.853768]]},{"name":"蒙特贝罗河岸","nameFr":"Quai de Montebello","klass":"quai","widthM":24,"pts":[[2.350421,48.851434],[2.348238,48.852349],[2.346801,48.853073]]},{"name":"图尔奈勒河岸","nameFr":"Quai de la Tournelle","klass":"quai","widthM":24,"pts":[[2.356758,48.849412],[2.350421,48.851434]]},{"name":"圣贝尔纳河岸","nameFr":"Quai Saint-Bernard","klass":"quai","widthM":28,"pts":[[2.356758,48.849412],[2.357574,48.849117],[2.363985,48.844782],[2.364541,48.843989]]},{"name":"钟楼河岸","nameFr":"Quai de l'Horloge","klass":"quai","widthM":14,"pts":[[2.346481,48.856198],[2.345395,48.856573],[2.343929,48.85687],[2.341357,48.857137]]},{"name":"金银匠河岸","nameFr":"Quai des Orfèvres","klass":"quai","widthM":14,"pts":[[2.341186,48.856958],[2.343383,48.855024],[2.34492,48.854336]]},{"name":"科西嘉河岸","nameFr":"Quai de la Corse - Pasquale Paoli","klass":"quai","widthM":16,"pts":[[2.350262,48.855065],[2.346481,48.856198]]},{"name":"花市河岸","nameFr":"Quai aux Fleurs","klass":"quai","widthM":14,"pts":[[2.352207,48.852646],[2.352092,48.853314],[2.35182,48.85395],[2.351208,48.854557],[2.350262,48.855065]]},{"name":"新市场河岸","nameFr":"Quai du Marché Neuf - Maurice Grimaud","klass":"quai","widthM":16,"pts":[[2.34492,48.854336],[2.347114,48.853592]]},{"name":"波旁河岸","nameFr":"Quai de Bourbon","klass":"quai","widthM":12,"pts":[[2.353286,48.852956],[2.353165,48.853428],[2.353312,48.853603],[2.357063,48.852444]]},{"name":"安茹河岸","nameFr":"Quai d'Anjou","klass":"quai","widthM":12,"pts":[[2.360034,48.850587],[2.360088,48.851039],[2.359716,48.851451],[2.357063,48.852444]]},{"name":"奥尔良河岸","nameFr":"Quai d'Orléans","klass":"quai","widthM":12,"pts":[[2.353322,48.852774],[2.353383,48.852502],[2.354141,48.851641],[2.355918,48.851138]]},{"name":"贝蒂讷河岸","nameFr":"Quai de Béthune","klass":"quai","widthM":12,"pts":[[2.355918,48.851138],[2.358999,48.850094]]},{"name":"里沃利街","nameFr":"Rue de Rivoli","klass":"boulevard","widthM":24,"pts":[[2.361677,48.855095],[2.351514,48.857472],[2.325159,48.866052],[2.32382,48.866437]]},{"name":"圣安托万街","nameFr":"Rue Saint-Antoine","klass":"rue-majeure","widthM":20,"pts":[[2.361677,48.855095],[2.363595,48.854356],[2.365676,48.853742],[2.368596,48.853253]]},{"name":"圣奥诺雷街","nameFr":"Rue Saint-Honoré","klass":"rue-majeure","widthM":11,"pts":[[2.323268,48.868383],[2.327086,48.867184],[2.328583,48.866615],[2.335643,48.863127],[2.341097,48.861711],[2.345038,48.861041],[2.34577,48.860705]]},{"name":"圣奥诺雷城郊街","nameFr":"Rue du Faubourg Saint-Honoré","klass":"rue-majeure","widthM":13,"pts":[[2.298074,48.877786],[2.300326,48.877146],[2.30523,48.875027],[2.305963,48.874817],[2.306449,48.874544],[2.30845,48.873827],[2.310176,48.873027],[2.312245,48.872318],[2.316122,48.8712],[2.319406,48.869476],[2.321021,48.868957],[2.323268,48.868383]]},{"name":"圣安托万城郊街","nameFr":"Rue du Faubourg Saint-Antoine","klass":"rue-majeure","widthM":20,"pts":[[2.385059,48.850018],[2.384202,48.850167],[2.380066,48.850483],[2.378518,48.850724],[2.37202,48.852399],[2.370286,48.853277],[2.369718,48.853297]]},{"name":"亨利四世大道","nameFr":"Boulevard Henri IV","klass":"boulevard","widthM":40,"pts":[[2.358931,48.850071],[2.368356,48.852862]]},{"name":"里昂街","nameFr":"Rue de Lyon","klass":"avenue","widthM":26,"pts":[[2.372597,48.845749],[2.372314,48.845954],[2.37085,48.849231],[2.370944,48.849498]]},{"name":"蒂雷讷街","nameFr":"Rue de Turenne","klass":"rue-majeure","widthM":12,"pts":[[2.362949,48.8546],[2.364406,48.856633],[2.36468,48.864649]]},{"name":"圣殿街","nameFr":"Rue du Temple","klass":"rue-majeure","widthM":10,"pts":[[2.352354,48.857283],[2.353018,48.857993],[2.354341,48.859858],[2.355111,48.860617],[2.356876,48.861857],[2.359059,48.864196],[2.359704,48.86468],[2.361496,48.86641],[2.361986,48.866734],[2.361904,48.866841],[2.363318,48.867383]]},{"name":"博堡街","nameFr":"Rue Beaubourg","klass":"rue-majeure","widthM":20,"pts":[[2.355632,48.865556],[2.355659,48.865224],[2.352985,48.860287]]},{"name":"塞瓦斯托波尔大道","nameFr":"Boulevard de Sébastopol","klass":"boulevard","widthM":30,"pts":[[2.347777,48.857724],[2.354298,48.869319]]},{"name":"斯特拉斯堡大道","nameFr":"Boulevard de Strasbourg","klass":"boulevard","widthM":30,"pts":[[2.354298,48.869319],[2.357174,48.874491],[2.358265,48.87615]]},{"name":"宫殿大道","nameFr":"Boulevard du Palais","klass":"boulevard","widthM":30,"pts":[[2.344848,48.854267],[2.345746,48.855138],[2.346481,48.856198]]},{"name":"圣米歇尔大道","nameFr":"Boulevard Saint-Michel","klass":"boulevard","widthM":30,"pts":[[2.337314,48.840929],[2.340982,48.847566],[2.342644,48.850308],[2.344131,48.853393]]},{"name":"圣雅克街","nameFr":"Rue Saint-Jacques","klass":"rue-majeure","widthM":12,"pts":[[2.346278,48.852176],[2.343453,48.847077],[2.341375,48.843009],[2.341132,48.841093],[2.33971,48.838888]]},{"name":"圣德尼街","nameFr":"Rue Saint-Denis","klass":"rue-majeure","widthM":10,"pts":[[2.347573,48.85876],[2.349369,48.862167],[2.350033,48.863718],[2.350347,48.865133],[2.351314,48.866834],[2.35261,48.869679]]},{"name":"圣马丁街","nameFr":"Rue Saint-Martin","klass":"rue-majeure","widthM":10,"pts":[[2.348955,48.856717],[2.349211,48.857162],[2.349437,48.857268],[2.349623,48.858094],[2.350458,48.859355],[2.353362,48.864854],[2.35376,48.866012],[2.355516,48.868887]]},{"name":"雷奥米尔街","nameFr":"Rue Réaumur","klass":"boulevard","widthM":22,"pts":[[2.341904,48.868537],[2.359704,48.86468]]},{"name":"蒂尔比戈街","nameFr":"Rue de Turbigo","klass":"avenue","widthM":20,"pts":[[2.345802,48.862975],[2.346124,48.863243],[2.361904,48.866841]]},{"name":"艾蒂安马塞尔街","nameFr":"Rue Étienne Marcel","klass":"rue-majeure","widthM":18,"pts":[[2.341488,48.865679],[2.350966,48.863402]]},{"name":"圣日耳曼大道","nameFr":"Boulevard Saint-Germain","klass":"boulevard","widthM":32,"pts":[[2.318985,48.862525],[2.319656,48.862175],[2.324598,48.856972],[2.325749,48.856141],[2.327678,48.855275],[2.330474,48.854476],[2.350367,48.849645],[2.356321,48.849385],[2.357225,48.849252]]},{"name":"雷恩街","nameFr":"Rue de Rennes","klass":"boulevard","widthM":26,"pts":[[2.332981,48.853622],[2.327183,48.847266],[2.324166,48.844173]]},{"name":"蒙帕纳斯大道","nameFr":"Boulevard du Montparnasse","klass":"boulevard","widthM":40,"pts":[[2.316599,48.846818],[2.319701,48.845251],[2.336759,48.839687]]},{"name":"拉斯帕伊大道","nameFr":"Boulevard Raspail","klass":"boulevard","widthM":30,"pts":[[2.325376,48.856395],[2.329484,48.841949],[2.329737,48.841595],[2.330843,48.838609]]},{"name":"皇家港大道","nameFr":"Boulevard de Port-Royal","klass":"boulevard","widthM":35,"pts":[[2.336759,48.839687],[2.340475,48.838725]]},{"name":"沃日拉尔街","nameFr":"Rue de Vaugirard","klass":"rue-majeure","widthM":15,"pts":[[2.299045,48.838588],[2.300343,48.83921],[2.301997,48.839786],[2.304779,48.84053],[2.317083,48.844286],[2.320183,48.845085],[2.326646,48.84698],[2.326866,48.846944],[2.326989,48.847067],[2.327422,48.8472],[2.332575,48.848664],[2.335455,48.849237],[2.337003,48.849297],[2.338094,48.849236],[2.338694,48.849066],[2.339161,48.849075],[2.340392,48.848882],[2.341755,48.848836]]},{"name":"塞夫尔街","nameFr":"Rue de Sèvres","klass":"rue-majeure","widthM":15,"pts":[[2.329755,48.852058],[2.327261,48.85165],[2.32663,48.851266],[2.32414,48.850234],[2.319081,48.847737],[2.316599,48.846818],[2.310688,48.844999]]},{"name":"巴克街","nameFr":"Rue du Bac","klass":"rue-majeure","widthM":12,"pts":[[2.32414,48.850234],[2.32355,48.851698],[2.323944,48.854291],[2.325506,48.855908],[2.327526,48.857008],[2.329285,48.859551]]},{"name":"荣军院大道","nameFr":"Boulevard des Invalides","klass":"boulevard","widthM":40,"pts":[[2.315147,48.857945],[2.314386,48.850821],[2.316599,48.846818]]},{"name":"苏弗洛街","nameFr":"Rue Soufflot","klass":"avenue","widthM":30,"pts":[[2.340855,48.847333],[2.344494,48.846546]]},{"name":"学校街","nameFr":"Rue des Écoles","klass":"rue-majeure","widthM":20,"pts":[[2.342644,48.850308],[2.343738,48.8499],[2.352712,48.847477]]},{"name":"蒙日街","nameFr":"Rue Monge","klass":"avenue","widthM":20,"pts":[[2.350733,48.838588],[2.351847,48.840766],[2.352409,48.844476],[2.351635,48.846604],[2.349179,48.849775]]},{"name":"穆浮达街","nameFr":"Rue Mouffetard","klass":"rue-majeure","widthM":8,"pts":[[2.349167,48.845002],[2.349759,48.842415],[2.349632,48.841101],[2.349778,48.839775],[2.349956,48.83936]]},{"name":"絮弗伦大道","nameFr":"Avenue de Suffren","klass":"avenue","widthM":40,"pts":[[2.309595,48.845729],[2.290987,48.857492]]},{"name":"布尔多内大道","nameFr":"Avenue de la Bourdonnais","klass":"avenue","widthM":30,"pts":[[2.295619,48.860542],[2.305447,48.854272]]},{"name":"博斯凯大道","nameFr":"Avenue Bosquet","klass":"avenue","widthM":30,"pts":[[2.305816,48.854466],[2.305486,48.854709],[2.30484,48.856],[2.302107,48.861697],[2.301945,48.862439]]},{"name":"拉莫特皮凯大道","nameFr":"Avenue de la Motte-Picquet","klass":"avenue","widthM":30,"pts":[[2.311165,48.858118],[2.305816,48.854466]]},{"name":"拉普大道","nameFr":"Avenue Rapp","klass":"avenue","widthM":26,"pts":[[2.301449,48.861849],[2.300208,48.857864]]},{"name":"香榭丽舍大道","nameFr":"Avenue des Champs-Élysées","klass":"avenue","widthM":70,"pts":[[2.295887,48.873506],[2.319097,48.866121],[2.320853,48.865639]]},{"name":"大军团大道","nameFr":"Avenue de la Grande Armée","klass":"avenue","widthM":70,"pts":[[2.284435,48.877147],[2.294197,48.874046]]},{"name":"福煦大道","nameFr":"Avenue Foch","klass":"avenue","widthM":120,"pts":[[2.275658,48.871707],[2.294116,48.873741]]},{"name":"马尔索大道","nameFr":"Avenue Marceau","klass":"avenue","widthM":40,"pts":[[2.299866,48.864993],[2.299866,48.865456],[2.298916,48.86853],[2.297505,48.870945],[2.295565,48.873262]]},{"name":"耶拿大道","nameFr":"Avenue d'Iéna","klass":"avenue","widthM":40,"pts":[[2.291971,48.862922],[2.294018,48.864897],[2.295714,48.867921],[2.295734,48.869633],[2.295154,48.873166]]},{"name":"克莱贝尔大道","nameFr":"Avenue Kléber","klass":"avenue","widthM":40,"pts":[[2.287518,48.863415],[2.294643,48.873225]]},{"name":"维克多雨果大道","nameFr":"Avenue Victor Hugo","klass":"avenue","widthM":40,"pts":[[2.275033,48.865295],[2.294246,48.873455]]},{"name":"卡诺大道","nameFr":"Avenue Carnot","klass":"avenue","widthM":30,"pts":[[2.292186,48.877102],[2.294511,48.874296]]},{"name":"麦克马洪大道","nameFr":"Avenue Mac-Mahon","klass":"avenue","widthM":30,"pts":[[2.294221,48.878646],[2.294914,48.874404]]},{"name":"瓦格拉姆大道","nameFr":"Avenue de Wagram","klass":"avenue","widthM":36,"pts":[[2.295444,48.874337],[2.297719,48.877456],[2.298074,48.877786],[2.298599,48.878686],[2.303398,48.885205],[2.30465,48.886992]]},{"name":"奥什大道","nameFr":"Avenue Hoche","klass":"avenue","widthM":36,"pts":[[2.295856,48.874114],[2.305185,48.878006]]},{"name":"弗里德兰大道","nameFr":"Avenue de Friedland","klass":"avenue","widthM":36,"pts":[[2.295974,48.873832],[2.305323,48.874923]]},{"name":"蒙田大道","nameFr":"Avenue Montaigne","klass":"avenue","widthM":26,"pts":[[2.309919,48.868882],[2.301917,48.864737]]},{"name":"乔治五世大道","nameFr":"Avenue George V","klass":"avenue","widthM":30,"pts":[[2.301731,48.864725],[2.301453,48.865083],[2.300921,48.871908]]},{"name":"奥斯曼大道","nameFr":"Boulevard Haussmann","klass":"boulevard","widthM":30,"pts":[[2.340053,48.871998],[2.320497,48.874651],[2.320039,48.874648],[2.319879,48.874852],[2.319253,48.8748],[2.315794,48.875301],[2.30657,48.87495],[2.305963,48.874817],[2.305206,48.874781]]},{"name":"歌剧院大道","nameFr":"Avenue de l'Opéra","klass":"avenue","widthM":30,"pts":[[2.332552,48.870076],[2.335154,48.864021]]},{"name":"和平街","nameFr":"Rue de la Paix","klass":"avenue","widthM":22,"pts":[[2.330271,48.868317],[2.332229,48.870208]]},{"name":"卡斯蒂利奥内街","nameFr":"Rue de Castiglione","klass":"avenue","widthM":22,"pts":[[2.327307,48.865352],[2.328583,48.866615]]},{"name":"皇家街","nameFr":"Rue Royale","klass":"avenue","widthM":26,"pts":[[2.323897,48.869255],[2.321985,48.866669]]},{"name":"拉斐特街","nameFr":"Rue La Fayette","klass":"boulevard","widthM":22,"pts":[[2.333449,48.873111],[2.369862,48.882655]]},{"name":"马真塔大道","nameFr":"Boulevard de Magenta","klass":"boulevard","widthM":30,"pts":[[2.349578,48.883508],[2.355942,48.876492],[2.362995,48.868467]]},{"name":"马德莱娜大道","nameFr":"Boulevard de la Madeleine","klass":"boulevard","widthM":35,"pts":[[2.324978,48.869359],[2.327822,48.869899]]},{"name":"嘉布遣大道","nameFr":"Boulevard des Capucines","klass":"boulevard","widthM":35,"pts":[[2.334164,48.870969],[2.328232,48.869959]]},{"name":"意大利人大道","nameFr":"Boulevard des Italiens","klass":"boulevard","widthM":35,"pts":[[2.334164,48.870969],[2.340018,48.871923]]},{"name":"蒙马特大道","nameFr":"Boulevard Montmartre","klass":"boulevard","widthM":35,"pts":[[2.343068,48.871482],[2.340018,48.871923]]},{"name":"普瓦松尼埃大道","nameFr":"Boulevard Poissonnière","klass":"boulevard","widthM":35,"pts":[[2.34791,48.870676],[2.343068,48.871482]]},{"name":"好消息大道","nameFr":"Boulevard de Bonne Nouvelle","klass":"boulevard","widthM":35,"pts":[[2.35261,48.869679],[2.34791,48.870676]]},{"name":"圣德尼大道","nameFr":"Boulevard Saint-Denis","klass":"boulevard","widthM":35,"pts":[[2.355751,48.868974],[2.35261,48.869679]]},{"name":"圣马丁大道","nameFr":"Boulevard Saint-Martin","klass":"boulevard","widthM":35,"pts":[[2.362358,48.867949],[2.355751,48.868974]]},{"name":"圣殿大道","nameFr":"Boulevard du Temple","klass":"boulevard","widthM":35,"pts":[[2.36674,48.863103],[2.3648,48.866314]]},{"name":"博马舍大道","nameFr":"Boulevard Beaumarchais","klass":"boulevard","widthM":35,"pts":[[2.367295,48.860823],[2.36906,48.853553]]},{"name":"马尔泽布大道","nameFr":"Boulevard Malesherbes","klass":"boulevard","widthM":30,"pts":[[2.323443,48.869699],[2.323234,48.870135],[2.319814,48.874922],[2.305019,48.887017],[2.304658,48.887189]]},{"name":"库尔塞勒大道","nameFr":"Boulevard de Courcelles","klass":"boulevard","widthM":30,"pts":[[2.298508,48.878323],[2.29895,48.878253],[2.308573,48.880325],[2.315337,48.881183],[2.316583,48.881256]]},{"name":"圣拉扎尔街","nameFr":"Rue Saint-Lazare","klass":"rue-majeure","widthM":16,"pts":[[2.324278,48.87525],[2.330192,48.87599],[2.332462,48.876363],[2.332347,48.876706],[2.332798,48.876839],[2.334207,48.876918],[2.337024,48.87671],[2.338157,48.876853],[2.339227,48.87677]]},{"name":"克利希大道","nameFr":"Boulevard de Clichy","klass":"boulevard","widthM":36,"pts":[[2.339641,48.882168],[2.337226,48.882561],[2.332959,48.883838],[2.329498,48.884677],[2.328005,48.883762],[2.327493,48.883669]]},{"name":"罗什舒阿尔大道","nameFr":"Boulevard Marguerite de Rochechouart","klass":"boulevard","widthM":36,"pts":[[2.339665,48.881906],[2.347203,48.88335],[2.349507,48.883608]]},{"name":"巴尔贝斯大道","nameFr":"Boulevard Barbès","klass":"boulevard","widthM":30,"pts":[[2.349491,48.883724],[2.349604,48.89157]]},{"name":"科兰古街","nameFr":"Rue Caulaincourt","klass":"avenue","widthM":20,"pts":[[2.342943,48.889792],[2.335085,48.889439],[2.334748,48.889212],[2.332683,48.886642],[2.329697,48.884715]]},{"name":"勒皮克街","nameFr":"Rue Lepic","klass":"rue-majeure","widthM":10,"pts":[[2.33279,48.883876],[2.334791,48.885827],[2.333805,48.886552],[2.333912,48.887119],[2.334362,48.887648],[2.33469,48.887702],[2.335845,48.887383],[2.337493,48.887227],[2.338568,48.886753]]},{"name":"富兰布尔乔亚街","nameFr":"Rue des Francs Bourgeois","klass":"rue-majeure","widthM":12,"pts":[[2.356888,48.860069],[2.358762,48.858684],[2.360432,48.857817],[2.361821,48.857228],[2.364966,48.856307]]},{"name":"伏尔泰大道","nameFr":"Boulevard Voltaire","klass":"boulevard","widthM":35,"pts":[[2.385321,48.854701],[2.365142,48.866725]]},{"name":"克利希街","nameFr":"Rue de Clichy","klass":"rue-majeure","widthM":15,"pts":[[2.330841,48.876834],[2.329365,48.879351],[2.327508,48.883389]]},{"name":"殉道者街","nameFr":"Rue des Martyrs","klass":"rue-majeure","widthM":10,"pts":[[2.339227,48.87677],[2.339879,48.879086],[2.340417,48.880332],[2.339665,48.881906],[2.339766,48.88467]]},{"name":"阿贝斯街","nameFr":"Rue des Abbesses","klass":"rue-majeure","widthM":10,"pts":[[2.334791,48.885827],[2.336065,48.885448],[2.337729,48.884765],[2.338656,48.884132],[2.339721,48.883697]]},{"name":"波拿巴街","nameFr":"Rue Bonaparte","klass":"rue-majeure","widthM":12,"pts":[[2.332761,48.848708],[2.332699,48.850198],[2.333342,48.853795],[2.33394,48.855505],[2.335355,48.857725]]},{"name":"格勒内尔街","nameFr":"Rue de Grenelle","klass":"rue-majeure","widthM":12,"pts":[[2.330029,48.852268],[2.32782,48.853695],[2.324571,48.855013],[2.32259,48.856012],[2.318113,48.857408],[2.316558,48.857776],[2.3147,48.85804],[2.314335,48.858255],[2.313887,48.858352],[2.313437,48.858388],[2.311165,48.858118],[2.306814,48.857877],[2.305941,48.857694],[2.304449,48.857188],[2.302443,48.85615]]},{"name":"圣多明我街","nameFr":"Rue Saint-Dominique","klass":"rue-majeure","widthM":12,"pts":[[2.30043,48.857754],[2.303905,48.858939],[2.30656,48.859529],[2.310179,48.859938],[2.314827,48.859966],[2.316982,48.859923],[2.318246,48.859783],[2.321693,48.858598],[2.323896,48.857698]]},{"name":"大学街","nameFr":"Rue de l'Université","klass":"rue-majeure","widthM":12,"pts":[[2.295976,48.859508],[2.296512,48.859858],[2.298543,48.860511],[2.302205,48.861157],[2.311494,48.861119],[2.319893,48.86066],[2.331672,48.856315]]},{"name":"医院大道","nameFr":"Boulevard de l'Hôpital","klass":"boulevard","widthM":35,"pts":[[2.364463,48.843761],[2.364363,48.843434],[2.36076,48.838552]]},{"name":"天文台大道","nameFr":"Avenue de l'Observatoire","klass":"avenue","widthM":40,"pts":[[2.336495,48.844289],[2.336273,48.841096],[2.336113,48.841035],[2.336165,48.840252]]},{"name":"布勒特伊大道","nameFr":"Avenue de Breteuil","klass":"avenue","widthM":70,"pts":[[2.310978,48.84537],[2.311187,48.846928],[2.312057,48.847671],[2.312697,48.853194]]},{"name":"卢浮街","nameFr":"Rue du Louvre","klass":"avenue","widthM":20,"pts":[[2.343955,48.867328],[2.343803,48.866672],[2.340821,48.860913]]},{"name":"黎塞留街","nameFr":"Rue de Richelieu","klass":"rue-majeure","widthM":12,"pts":[[2.340053,48.871998],[2.338684,48.869163],[2.335518,48.863223]]},{"name":"九月四日街","nameFr":"Rue du Quatre Septembre","klass":"avenue","widthM":20,"pts":[[2.332229,48.870208],[2.332715,48.870299],[2.340094,48.8689]]},{"name":"沙托丹街","nameFr":"Rue de Châteaudun","klass":"avenue","widthM":20,"pts":[[2.332462,48.876363],[2.343144,48.87566]]},{"name":"丘吉尔大道","nameFr":"Avenue Winston Churchill","klass":"avenue","widthM":40,"pts":[[2.313963,48.867754],[2.313707,48.864995]]},{"name":"加布里埃尔大道","nameFr":"Avenue Gabriel","klass":"avenue","widthM":26,"pts":[[2.320355,48.867095],[2.316464,48.868352],[2.31519,48.86837],[2.314619,48.868834],[2.314754,48.86904],[2.311932,48.869929]]}],"places":[{"name":"杜乐丽花园","nameFr":"Jardin des Tuileries","kind":"garden","paving":"parterre","poly":[[2.321599,48.863916],[2.321629,48.86399],[2.32255,48.865173],[2.322568,48.865166],[2.323318,48.866163],[2.323351,48.866189],[2.323667,48.866267],[2.32409,48.866134],[2.324147,48.866205],[2.331772,48.863739],[2.330931,48.862585],[2.330811,48.862622],[2.330535,48.862247],[2.330641,48.862216],[2.330023,48.861362],[2.329992,48.861301],[2.330102,48.861266],[2.329959,48.861069],[2.321648,48.86377]],"features":["中央八角大水池与圆形水池各一","南北两列修剪成方块的椴树","法式规则式花坛与砂砾主轴","卢浮宫—方尖碑—凯旋门历史轴线的起点"]},{"name":"卡鲁塞尔广场","nameFr":"Place du Carrousel","kind":"place","paving":"gravel","poly":[[2.330493,48.861163],[2.330797,48.861061],[2.332011,48.860773],[2.332118,48.860875],[2.332915,48.860689],[2.332938,48.860664],[2.332861,48.86051],[2.333093,48.860456],[2.333131,48.860478],[2.33321,48.860459],[2.333258,48.860427],[2.333702,48.860321],[2.333739,48.860333],[2.333845,48.860309],[2.333854,48.860276],[2.334112,48.860219],[2.335361,48.862358],[2.335186,48.862417],[2.335144,48.862401],[2.335053,48.862427],[2.335014,48.862471],[2.333645,48.862912],[2.33359,48.862843],[2.332064,48.863326]],"features":["卡鲁塞尔凯旋门居中","被卢浮宫三面围合","玻璃金字塔在东侧庭院","砂砾与石板混铺"]},{"name":"协和广场","nameFr":"Place de la Concorde","kind":"place","paving":"sett","poly":[[2.318846,48.864721],[2.319307,48.865195],[2.32077,48.867167],[2.323526,48.866417],[2.321629,48.86399],[2.32155,48.863812]],"features":["卢克索方尖碑居中","南北两座海神喷泉","八尊法国城市女神像守角","八公顷无遮挡的巨大空场"]},{"name":"香榭丽舍花园","nameFr":"Jardins des Champs-Élysées","kind":"park","paving":"gravel","poly":[[2.313986,48.866279],[2.314096,48.867033],[2.314368,48.867132],[2.314552,48.867269],[2.314667,48.867266],[2.314745,48.86735],[2.314823,48.867349],[2.315908,48.866996],[2.315681,48.866631],[2.315628,48.866304],[2.315545,48.866365],[2.315451,48.866362],[2.314775,48.866577],[2.314777,48.866594],[2.314595,48.866628],[2.314459,48.866593],[2.314448,48.866496],[2.314483,48.866477],[2.314447,48.866173],[2.314078,48.866203]],"features":["大道两侧的英式林荫园","大皇宫与小皇宫夹峙","砂砾小径与铸铁围栏"]},{"name":"马里尼方园","nameFr":"Carré Marigny","kind":"garden","paving":"gravel","poly":[[2.311011,48.869363],[2.312003,48.869857],[2.312564,48.869681],[2.312648,48.869542],[2.314591,48.868918],[2.313926,48.868004],[2.313838,48.867937],[2.311112,48.868801],[2.311103,48.868828],[2.311198,48.868967],[2.311189,48.869103],[2.311243,48.869108],[2.311152,48.869294]],"features":["集邮市场的老摊位","规整的栗树方阵","马里尼剧场在北"]},{"name":"星形广场","nameFr":"Place Charles de Gaulle","kind":"place","paving":"radial","poly":[[2.293426,48.873765],[2.293466,48.873527],[2.293585,48.873302],[2.293777,48.873099],[2.294032,48.87293],[2.294338,48.872803],[2.294678,48.872724],[2.295037,48.872698],[2.295395,48.872724],[2.295736,48.872803],[2.296041,48.87293],[2.296297,48.873099],[2.296489,48.873302],[2.296608,48.873527],[2.296648,48.873765],[2.296608,48.874002],[2.296489,48.874228],[2.296297,48.87443],[2.296041,48.874599],[2.295736,48.874726],[2.295395,48.874805],[2.295037,48.874832],[2.294678,48.874805],[2.294338,48.874726],[2.294032,48.874599],[2.293777,48.87443],[2.293585,48.874228],[2.293466,48.874002]],"features":["凯旋门居正中","十二条大道等角放射","直径约240m的圆形环岛","铺装呈放射星形"]},{"name":"战神广场","nameFr":"Champ de Mars","kind":"park","paving":"lawn","poly":[[2.291871,48.857714],[2.295279,48.86008],[2.296874,48.859016],[2.296375,48.858687],[2.298448,48.857368],[2.299798,48.857586],[2.300088,48.85741],[2.29982,48.856503],[2.303791,48.853945],[2.303649,48.853839],[2.303604,48.853868],[2.303333,48.853691],[2.303781,48.853401],[2.303725,48.853362],[2.30364,48.853418],[2.303054,48.853036],[2.30309,48.853012],[2.302242,48.852464],[2.302254,48.852339],[2.302077,48.852317],[2.301738,48.852536],[2.301302,48.852246],[2.297522,48.854646],[2.296095,48.854435],[2.295569,48.854788],[2.295818,48.855786],[2.293855,48.85705],[2.293387,48.856741]],"features":["自铁塔向东南延伸的长条大草坪","中央草毯两侧对称林荫带","尽端是军事学院","原为练兵场，故无高差"]},{"name":"特罗卡德罗花园","nameFr":"Jardins du Trocadéro","kind":"garden","paving":"lawn","poly":[[2.286069,48.860428],[2.287699,48.859933],[2.287633,48.859835],[2.287658,48.859787],[2.287761,48.85976],[2.288925,48.858982],[2.288982,48.858993],[2.290372,48.860011],[2.289925,48.860295],[2.29033,48.860568],[2.29057,48.860573],[2.29078,48.860654],[2.290892,48.860793],[2.290883,48.86094],[2.29112,48.861105],[2.29123,48.861086],[2.291326,48.861118],[2.291376,48.861232],[2.291652,48.861042],[2.292959,48.862105],[2.29216,48.862629],[2.291769,48.862656],[2.291654,48.862886],[2.291458,48.863076],[2.290581,48.863636],[2.290481,48.863635],[2.28872,48.863156],[2.286827,48.861862],[2.286778,48.861782],[2.286756,48.861453]],"features":["瓦西大水池与斜射的炮式喷泉","自夏乐宫向塞纳河下跌的缓坡草坪","正对铁塔的观景轴"]},{"name":"荣军院前草坪","nameFr":"Esplanade des Invalides","kind":"esplanade","paving":"lawn","poly":[[2.311291,48.858594],[2.31132,48.858575],[2.314574,48.85841],[2.314877,48.86086],[2.314835,48.861377],[2.314351,48.862729],[2.311809,48.862673],[2.311647,48.86185]],"features":["四块规整大草坪","正对亚历山大三世桥的轴线","两侧椴树列与砂砾边道","长约500m的开阔前庭"]},{"name":"卢森堡公园","nameFr":"Jardin du Luxembourg","kind":"garden","paving":"parterre","poly":[[2.33246,48.844955],[2.332674,48.848315],[2.332901,48.84834],[2.332934,48.848676],[2.334917,48.849064],[2.334898,48.848663],[2.335756,48.848652],[2.335734,48.848908],[2.336239,48.848923],[2.336177,48.84833],[2.336398,48.847927],[2.336595,48.847847],[2.337916,48.847814],[2.33828,48.848055],[2.338343,48.849067],[2.338856,48.848816],[2.340119,48.847376],[2.340245,48.8467],[2.339823,48.845884],[2.338787,48.846075],[2.338626,48.845962],[2.338601,48.845774],[2.338467,48.845777],[2.337725,48.845338],[2.337636,48.84436],[2.337371,48.844477],[2.336715,48.844489],[2.336571,48.844388],[2.332962,48.844474]],"features":["中央八角水池与下沉式花坛","卢森堡宫在北端","成片栗树林荫与可搬动的绿铁椅","美第奇喷泉藏在东侧树荫里"]},{"name":"皇宫花园","nameFr":"Jardin du Palais Royal","kind":"garden","paving":"gravel","poly":[[2.336716,48.864173],[2.337709,48.866106],[2.338919,48.865817],[2.337889,48.863906]],"features":["三面拱廊完全围合","中央圆形喷泉","双列修剪椴树","前庭是布伦的黑白条纹柱阵"]},{"name":"旺多姆广场","nameFr":"Place Vendôme","kind":"place","paving":"sett","poly":[[2.328318,48.867374],[2.328795,48.867824],[2.329137,48.868194],[2.329369,48.868226],[2.329415,48.868231],[2.330501,48.867755],[2.330559,48.867573],[2.330081,48.86712],[2.329738,48.86675],[2.32946,48.866715],[2.328375,48.867191]],"features":["切角八角形","中央旺多姆铜柱","芒萨尔设计的统一立面","珠宝店与丽兹酒店在拱廊下"]},{"name":"孚日广场","nameFr":"Place des Vosges","kind":"place","paving":"gravel","poly":[[2.36451,48.855254],[2.364905,48.856266],[2.364966,48.856307],[2.366563,48.856048],[2.366585,48.855995],[2.366199,48.854997],[2.366147,48.854961],[2.366035,48.854951],[2.364619,48.855188],[2.364557,48.855206]],"features":["正方形约140m见方","四周红砖与石材相间的拱廊","统一的蓝灰石板坡屋顶","巴黎最古老的规划广场"]},{"name":"路易十三方园","nameFr":"Square Louis-XIII","kind":"garden","paving":"lawn","poly":[[2.364632,48.85531],[2.364698,48.855237],[2.365334,48.855129],[2.36534,48.855146],[2.365377,48.85514],[2.365372,48.855122],[2.36601,48.855013],[2.366121,48.855057],[2.366455,48.855933],[2.36639,48.856005],[2.365074,48.856219],[2.364965,48.856177],[2.364803,48.855755],[2.364825,48.855751],[2.364794,48.855734]],"features":["孚日广场正中的方形绿地","路易十三骑马像居中","四角各一座喷泉","四排修剪椴树"]},{"name":"市政厅广场","nameFr":"Place de l'Hôtel de Ville","kind":"esplanade","paving":"sett","poly":[[2.350553,48.855713],[2.351672,48.855713],[2.351672,48.857115],[2.350553,48.857115]],"features":["市政厅新文艺复兴立面正对","完全无车的大铺装场","历史上的沙滩广场","冬季搭溜冰场"]},{"name":"圣母院前广场","nameFr":"Parvis Notre-Dame - Place Jean-Paul II","kind":"esplanade","paving":"sett","poly":[[2.347412,48.853487],[2.347562,48.853563],[2.347769,48.853841],[2.347836,48.853857],[2.34882,48.85355],[2.348873,48.853627],[2.349095,48.853559],[2.349134,48.853604],[2.349139,48.85357],[2.349282,48.85352],[2.348915,48.853073],[2.348687,48.85269],[2.348428,48.852795],[2.348568,48.852976],[2.348564,48.853057],[2.348445,48.852961],[2.348462,48.853037],[2.348168,48.853042],[2.347789,48.853197],[2.347632,48.853361],[2.347567,48.853361],[2.347593,48.85329],[2.347545,48.853307],[2.347541,48.853399]],"features":["法国公路零公里点嵌在地面","地下是考古地穴博物馆","正对大教堂西立面与双塔","铺装用石线画出中世纪街道旧迹"]},{"name":"让二十三世广场","nameFr":"Square Jean XXIII","kind":"garden","paving":"gravel","poly":[[2.348687,48.85269],[2.349884,48.852254],[2.351556,48.851849],[2.351994,48.852558],[2.351966,48.852623],[2.351901,48.852664],[2.351065,48.852906],[2.35061,48.852273],[2.34991,48.852454],[2.348815,48.852867]],"features":["圣母院东端后的长条花园","看飞扶壁的最佳位置","中央新哥特式圣母喷泉","两侧椴树夹道"]},{"name":"共和国广场东段","nameFr":"Esplanade André Tollet","kind":"esplanade","paving":"sett","poly":[[2.362602,48.867977],[2.362625,48.868057],[2.36286,48.868224],[2.363672,48.867745],[2.363957,48.867934],[2.364626,48.867534],[2.364355,48.867333],[2.365139,48.866878],[2.364878,48.866694],[2.364791,48.866681],[2.364723,48.866695]],"features":["共和国广场东半幅的步行铺装","与西半幅连成一整片无车场地"]},{"name":"共和国广场","nameFr":"Place de la République","kind":"place","paving":"sett","poly":[[2.362358,48.867949],[2.363742,48.867116],[2.364809,48.86653],[2.364943,48.86658],[2.365486,48.866977],[2.365439,48.867103],[2.36316,48.868453],[2.362995,48.868467]],"features":["共和国铜像立于高台","大片无车的花岗岩铺装","七条大道汇入","北侧一排成年梧桐"]},{"name":"巴士底广场","nameFr":"Place de la Bastille","kind":"place","paving":"sett","poly":[[2.367941,48.852074],[2.368048,48.852053],[2.368069,48.8521],[2.368146,48.852084],[2.368178,48.852159],[2.368132,48.852237],[2.368231,48.85227],[2.368583,48.85215],[2.368593,48.852109],[2.36867,48.852288],[2.368835,48.852257],[2.368789,48.852055],[2.369163,48.851981],[2.369084,48.851809],[2.36923,48.851779],[2.369391,48.852173],[2.369267,48.852454],[2.369268,48.852586],[2.369534,48.853212],[2.369519,48.853291],[2.369434,48.853363],[2.3691,48.853438],[2.368935,48.853407],[2.36884,48.853348],[2.368659,48.85297],[2.368118,48.852466]],"features":["七月圆柱居中，顶上金色自由精灵","地面用石线标出旧巴士底狱轮廓","歌剧院在东南角","阿森纳港从南侧接入"]},{"name":"圣心堂前阶梯花园","nameFr":"Square Louise Michel","kind":"garden","paving":"lawn","poly":[[2.342633,48.885622],[2.342655,48.885722],[2.342899,48.885807],[2.343579,48.885846],[2.343742,48.885878],[2.343888,48.885951],[2.344024,48.886106],[2.344896,48.886317],[2.34488,48.886254],[2.344928,48.886221],[2.34495,48.886246],[2.345007,48.886239],[2.344954,48.885881],[2.344899,48.885856],[2.344902,48.885805],[2.344145,48.885142],[2.344077,48.884524],[2.344026,48.884475],[2.342781,48.884406]],"features":["正对圣心堂的对称大台阶","逐级跌落的坡地草坪与水阶","西侧是缆索铁道","全巴黎最陡的城市花园之一"]},{"name":"植物园","nameFr":"Jardin des Plantes","kind":"garden","paving":"parterre","poly":[[2.355103,48.843744],[2.355148,48.843828],[2.355397,48.843958],[2.357079,48.84481],[2.357115,48.844797],[2.357814,48.845159],[2.357832,48.84519],[2.35804,48.8453],[2.360884,48.846751],[2.361111,48.846598],[2.361095,48.846556],[2.36119,48.846491],[2.361263,48.846496],[2.363863,48.844743],[2.363771,48.844437],[2.363811,48.8442],[2.363978,48.84394],[2.36428,48.843722],[2.363959,48.843284],[2.356443,48.841344],[2.356108,48.841328],[2.356022,48.841367]],"features":["长条形轴线花坛贯通全园","自然史博物馆大厅收束东端","螺旋迷宫小丘与老温室","北侧临塞纳河"]},{"name":"蒙梭公园","nameFr":"Parc Monceau","kind":"park","paving":"lawn","poly":[[2.305629,48.879515],[2.306228,48.878719],[2.306248,48.878632],[2.306161,48.878551],[2.306345,48.878357],[2.306501,48.878411],[2.306607,48.878404],[2.307022,48.878211],[2.307125,48.878187],[2.309558,48.878289],[2.309673,48.878265],[2.309772,48.878163],[2.310024,48.878223],[2.309991,48.878316],[2.31006,48.878406],[2.311994,48.879334],[2.311994,48.879523],[2.312056,48.879581],[2.312154,48.879613],[2.312012,48.879844],[2.311909,48.879877],[2.311849,48.879939],[2.311673,48.88058],[2.309173,48.880274],[2.309128,48.880309],[2.309064,48.880313],[2.309011,48.88029],[2.308999,48.880237]],"features":["英式风景园的曲径与草坡","科林斯柱廊半环着椭圆水池","金黑相间的铸铁栅栏与转门","四周是第八区的豪宅"]},{"name":"蒙马特公墓","nameFr":"Cimetière de Montmartre","kind":"cemetery","paving":"gravel","poly":[[2.327592,48.888308],[2.328765,48.887254],[2.328442,48.887076],[2.329052,48.886751],[2.329362,48.88652],[2.328992,48.886223],[2.330307,48.885616],[2.330681,48.885503],[2.330785,48.885435],[2.331014,48.885392],[2.33187,48.885141],[2.331992,48.885307],[2.331924,48.88533],[2.332383,48.885948],[2.332948,48.886248],[2.333051,48.886376],[2.332731,48.886486],[2.332505,48.886437],[2.332352,48.886532],[2.332401,48.886781],[2.331726,48.888723],[2.329291,48.890003],[2.3288,48.88975],[2.328329,48.889229]],"features":["整体下沉在废弃采石场里","科兰古桥从上方横跨","密集的家族墓庐与小教堂","高大的栗树遮蔽"]},{"name":"夏特莱广场","nameFr":"Place du Châtelet","kind":"place","paving":"sett","poly":[[2.347026,48.857446],[2.347176,48.857714],[2.347229,48.857753],[2.347336,48.857763],[2.347571,48.857689],[2.347595,48.857603],[2.347473,48.857383],[2.347383,48.857316],[2.347276,48.857289],[2.347095,48.857337],[2.347048,48.857368]],"features":["棕榈喷泉与狮身像居中","两座对称剧院东西夹峙","塞纳河与里沃利街在此交会"]},{"name":"圣米歇尔广场","nameFr":"Place Saint-Michel","kind":"place","paving":"sett","poly":[[2.343498,48.8533],[2.343609,48.853213],[2.343678,48.853254],[2.343771,48.853258],[2.343802,48.853233],[2.343794,48.853202],[2.343903,48.853163],[2.344028,48.853419],[2.344018,48.853464],[2.343945,48.853503],[2.343874,48.853498]],"features":["圣米歇尔屠龙喷泉贴着山墙","拉丁区的门户","楔形的小三角场地"]},{"name":"太子广场","nameFr":"Place Dauphine","kind":"place","paving":"gravel","poly":[[2.34181,48.856851],[2.34289,48.856668],[2.343193,48.856564],[2.342825,48.856102],[2.342511,48.856224]],"features":["等腰三角形，尖端指向新桥","砂砾地面与老栗树","两侧是路易十三时期的砖石联排"]},{"name":"圣雅克塔方园","nameFr":"Square de la Tour Saint-Jacques","kind":"garden","paving":"lawn","poly":[[2.348055,48.85784],[2.348097,48.857769],[2.349118,48.857489],[2.349246,48.857528],[2.349466,48.857926],[2.349416,48.858015],[2.348425,48.858337],[2.348316,48.858309]],"features":["孤立的火焰哥特式钟塔居中","巴黎第一座英式公共方园","四周下沉一层的草坪"]},{"name":"玛德莱娜广场","nameFr":"Place de la Madeleine","kind":"place","paving":"sett","poly":[[2.323447,48.869877],[2.32348,48.869951],[2.323744,48.870044],[2.324292,48.870797],[2.32441,48.870896],[2.324229,48.870631],[2.324272,48.870616],[2.32447,48.870892],[2.324514,48.870909],[2.325393,48.870639],[2.325491,48.870586],[2.325522,48.870536],[2.32551,48.870463],[2.324965,48.869717],[2.325032,48.869488],[2.324988,48.869433],[2.324897,48.8694],[2.324238,48.869283],[2.324021,48.869284],[2.323934,48.869309],[2.32386,48.869336],[2.323716,48.869461]],"features":["玛德莱娜教堂的科林斯列柱环廊","四周是高档食品店","花市摊位沿东侧排开"]},{"name":"歌剧院广场","nameFr":"Place de l'Opéra","kind":"place","paving":"sett","poly":[[2.33185,48.871073],[2.332229,48.870208],[2.332552,48.870076],[2.332715,48.870299],[2.332342,48.871156]],"features":["加尼耶歌剧院正立面收束轴线","七条街在此汇聚","统一高度的奥斯曼檐口线"]},{"name":"特罗卡德罗广场","nameFr":"Place du Trocadéro et du 11 Novembre","kind":"place","paving":"radial","poly":[[2.286241,48.862922],[2.286296,48.862879],[2.286428,48.862635],[2.286691,48.86246],[2.286713,48.862417],[2.287052,48.862211],[2.28815,48.862961],[2.287993,48.863191],[2.287962,48.863301],[2.287689,48.863443],[2.287468,48.863524],[2.287026,48.863542],[2.286821,48.863524],[2.286779,48.863478],[2.286654,48.863429],[2.286571,48.863427],[2.28648,48.863352],[2.286487,48.863323],[2.286376,48.863199],[2.286298,48.863175],[2.286279,48.863092],[2.286312,48.863059],[2.286259,48.863012]],"features":["半圆形，夏乐宫两翼环抱","六条大道放射","福煦骑马像居中"]},{"name":"圣叙尔皮斯广场","nameFr":"Place Saint-Sulpice","kind":"place","paving":"sett","poly":[[2.332896,48.850637],[2.332977,48.851085],[2.333065,48.851162],[2.333228,48.851183],[2.333233,48.85114],[2.334007,48.851214],[2.334114,48.850673],[2.333784,48.850648],[2.333758,48.8506],[2.333667,48.850585],[2.33366,48.850625],[2.332986,48.850569],[2.332923,48.850586]],"features":["四主教喷泉居中","教堂双塔一高一低不对称","四角种成排的栗树"]},{"name":"胜利广场","nameFr":"Place des Victoires","kind":"place","paving":"sett","poly":[[2.34084,48.865716],[2.340878,48.865635],[2.340961,48.865567],[2.341048,48.865533],[2.341191,48.865519],[2.341349,48.865553],[2.341445,48.865616],[2.341497,48.865763],[2.34145,48.865851],[2.341376,48.865907],[2.341269,48.865944],[2.34112,48.865951],[2.341014,48.865928],[2.340908,48.865869],[2.340844,48.865772]],"features":["正圆形，路易十四骑马像居中","统一的弧形立面与拱廊","六条街切入圆周"]},{"name":"圣殿方园","nameFr":"Square du Temple- Elie Wiesel","kind":"garden","paving":"lawn","poly":[[2.359878,48.864676],[2.360263,48.865054],[2.361618,48.864363],[2.361629,48.864318],[2.361116,48.863865],[2.361047,48.863863]],"features":["英式小园，假山瀑布与池塘","第三区区政厅在东","老圣殿骑士团用地"]},{"name":"曼德拉花园","nameFr":"Jardin Nelson Mandela","kind":"park","paving":"lawn","poly":[[2.342299,48.863505],[2.342943,48.863423],[2.342827,48.863129],[2.343151,48.863034],[2.343299,48.862847],[2.343262,48.862653],[2.343101,48.862551],[2.343161,48.862473],[2.343501,48.862396],[2.343342,48.86231],[2.343179,48.862315],[2.342546,48.862544],[2.342389,48.862324],[2.345178,48.861654],[2.34529,48.861749],[2.345288,48.861626],[2.345993,48.861489],[2.346675,48.862699],[2.345708,48.862924],[2.345754,48.862825],[2.345631,48.862788],[2.34551,48.862916],[2.34558,48.862938],[2.345415,48.863005],[2.344291,48.86327],[2.344208,48.863219],[2.344158,48.863276],[2.342716,48.863608],[2.342469,48.863756]],"features":["列阿勒旧市场原址上的大草坪","论坛的波浪顶棚在北","圣厄斯塔什教堂收束东端"]},{"name":"阿森纳花园","nameFr":"Jardin de l'Arsenal","kind":"park","paving":"lawn","poly":[[2.366976,48.847476],[2.367261,48.848803],[2.368041,48.850597],[2.368,48.850675],[2.367939,48.850687],[2.367955,48.850729],[2.368018,48.850716],[2.3682,48.850958],[2.368993,48.851836],[2.369082,48.851804],[2.367162,48.847564],[2.367133,48.847501]],"features":["巴士底港游艇泊位两侧的带状花园","低于街面一层","爬藤棚架与长椅"]},{"name":"蒂诺罗西花园","nameFr":"Jardin Tino Rossi - Musée de la Sculpture en Plein Air","kind":"park","paving":"lawn","poly":[[2.357655,48.849228],[2.358248,48.848843],[2.358343,48.848906],[2.35878,48.848612],[2.358664,48.848535],[2.358812,48.848436],[2.358929,48.848511],[2.359104,48.848388],[2.359006,48.848327],[2.359175,48.848218],[2.35927,48.848281],[2.361465,48.846802],[2.361326,48.846713],[2.362841,48.845709],[2.362973,48.845789],[2.363517,48.845411],[2.363819,48.845573],[2.363091,48.846122],[2.363074,48.846179],[2.36183,48.84721],[2.358849,48.849116],[2.357887,48.849426]],"features":["塞纳河左岸的露天雕塑园","沿河的下沉式圆形石阶剧场","夏夜的露天舞池"]},{"name":"吕泰斯竞技场方园","nameFr":"Square des Arènes de Lutèce et Capitan","kind":"garden","paving":"gravel","poly":[[2.352357,48.845469],[2.352648,48.845515],[2.353057,48.845765],[2.353208,48.845661],[2.353238,48.845686],[2.353567,48.845456],[2.353955,48.845686],[2.354115,48.845467],[2.354334,48.845318],[2.354243,48.845261],[2.354497,48.845275],[2.354502,48.84524],[2.354251,48.845218],[2.354279,48.84511],[2.353902,48.845068],[2.353797,48.845028],[2.353366,48.844455],[2.353334,48.844467],[2.353165,48.844408],[2.352963,48.84441],[2.352639,48.844494],[2.352631,48.844478],[2.352558,48.844495],[2.352569,48.844887]],"features":["高卢罗马圆形竞技场遗址","椭圆砂砾场地与石阶看台","藏在街廓内部，从街上看不见"]},{"name":"荣军院总管花园","nameFr":"Jardin de l'Intendant","kind":"garden","paving":"parterre","poly":[[2.309892,48.854283],[2.309966,48.854896],[2.311933,48.854793],[2.311854,48.854052],[2.310035,48.85415],[2.31004,48.854188],[2.309953,48.854222]],"features":["荣军院南侧的对称小花园","修剪成锥形的紫杉","正对金顶教堂"]},{"name":"巴蒂尼奥勒方园","nameFr":"Square des Batignolles","kind":"park","paving":"lawn","poly":[[2.315106,48.88767],[2.31659,48.886587],[2.317574,48.887314],[2.31579,48.888375]],"features":["英式曲池与小岩洞","大树成荫的坡地","第十七区的社区绿心"]},{"name":"帖特尔广场","nameFr":"Place du Tertre","kind":"place","paving":"sett","poly":[[2.340474,48.886333],[2.340542,48.886322],[2.340558,48.886357],[2.34097,48.8863],[2.341115,48.88668],[2.340659,48.886776],[2.340584,48.886654]],"features":["画家的画架密布中央","四周餐馆的遮阳篷","蒙马特山顶最平的一块地"]},{"name":"皮加勒广场","nameFr":"Place Pigalle","kind":"place","paving":"sett","poly":[[2.336957,48.882344],[2.336986,48.88232],[2.336981,48.882203],[2.337023,48.882105],[2.33714,48.882031],[2.337305,48.88201],[2.337489,48.882063],[2.337631,48.882207],[2.337719,48.882243],[2.337916,48.882438],[2.337226,48.882561],[2.337093,48.882514]],"features":["克利希与罗什舒阿尔两条大道在此转折","中央小喷泉","夜间灯箱最密的一段"]},{"name":"白色广场","nameFr":"Place Blanche","kind":"place","paving":"sett","poly":[[2.332228,48.883784],[2.33226,48.883724],[2.332598,48.883635],[2.332676,48.883689],[2.33279,48.883876],[2.332344,48.883996]],"features":["红磨坊风车在北侧","旧石膏车经过此地故名","克利希大道上的节点"]},{"name":"克利希广场","nameFr":"Place de Clichy","kind":"place","paving":"sett","poly":[[2.326631,48.883316],[2.327354,48.883368],[2.327242,48.883437],[2.3272,48.883562],[2.327227,48.883616],[2.327362,48.883666],[2.327493,48.883669],[2.32759,48.883618],[2.327644,48.883549],[2.327646,48.883445],[2.327508,48.883389],[2.326804,48.88327],[2.326738,48.88342]],"features":["莫恩西元帅纪念碑居中","五条大道汇聚的大环岛"]},{"name":"索邦广场","nameFr":"Place de la Sorbonne","kind":"place","paving":"sett","poly":[[2.341736,48.848623],[2.342008,48.848556],[2.342026,48.848587],[2.342086,48.848572],[2.342068,48.848541],[2.342094,48.848569],[2.342175,48.848549],[2.342171,48.848515],[2.342187,48.848546],[2.342292,48.848521],[2.342273,48.84849],[2.342416,48.848454],[2.342433,48.848485],[2.342496,48.848469],[2.342478,48.848438],[2.342723,48.848376],[2.342886,48.84868],[2.341915,48.848914]],"features":["索邦教堂穹顶正对","中央长条水池与两排椴树","两侧全是咖啡馆露台"]},{"name":"莫贝广场","nameFr":"Place Maubert","kind":"place","paving":"sett","poly":[[2.348256,48.85022],[2.348284,48.850273],[2.348448,48.850323],[2.348491,48.850444],[2.348557,48.850441],[2.34874,48.850203],[2.348796,48.850169],[2.348797,48.850134],[2.348731,48.850104]],"features":["每周三次的露天市场","中世纪街道在此收口","拉丁区最有烟火气的一角"]},{"name":"对垒广场","nameFr":"Place de la Contrescarpe","kind":"place","paving":"sett","poly":[[2.349254,48.844507],[2.349271,48.844405],[2.349357,48.844368],[2.349474,48.844365],[2.349583,48.844433],[2.349577,48.844524],[2.34947,48.844584],[2.349329,48.844571]],"features":["圆形小场，中央一圈树池","穆浮达街的北端起点","四周咖啡馆座位挤满人行道"]},{"name":"圣心堂前庭","nameFr":"Parvis du Sacré-Cœur","kind":"esplanade","paving":"sett","poly":[[2.342538,48.886302],[2.342753,48.886311],[2.342794,48.886264],[2.342913,48.886258],[2.342952,48.886229],[2.34322,48.886243],[2.34325,48.886276],[2.343368,48.886291],[2.343395,48.886338],[2.343637,48.88635],[2.343579,48.886178],[2.343466,48.886115],[2.342731,48.88607],[2.342558,48.886135]],"features":["圣心堂西立面前的观景平台","全巴黎最高的城市阳台","石栏杆下就是路易丝米歇尔花园"]},{"name":"爱丽舍方园","nameFr":"Carré de l'Élysée","kind":"garden","paving":"gravel","poly":[[2.314056,48.867917],[2.314567,48.868642],[2.314643,48.86866],[2.314719,48.868628],[2.314899,48.868453],[2.3152,48.868318],[2.315467,48.868279],[2.3165,48.868288],[2.318266,48.867728],[2.318029,48.867494],[2.317678,48.867354],[2.317563,48.866749],[2.31413,48.86784]],"features":["爱丽舍宫南侧的规整林园","砂砾小径与修剪树墙"]},{"name":"圆点方园","nameFr":"Carré du Rond-Point","kind":"garden","paving":"gravel","poly":[[2.310237,48.868702],[2.3103,48.868748],[2.310403,48.868753],[2.312261,48.868163],[2.311966,48.867758],[2.311893,48.867771],[2.311579,48.867343],[2.311611,48.867309],[2.311523,48.867231],[2.311437,48.867188],[2.310377,48.866911],[2.310312,48.866942]],"features":["香榭丽舍圆点广场四角的绿块","成排的悬铃木"]},{"name":"大使花园","nameFr":"Jardin des Ambassadeurs - Line Renaud","kind":"garden","paving":"gravel","poly":[[2.317563,48.866749],[2.317678,48.867354],[2.318029,48.867494],[2.318266,48.867728],[2.320069,48.867148],[2.320266,48.867021],[2.32033,48.866946],[2.320185,48.866734],[2.320224,48.866721],[2.320374,48.866912],[2.320445,48.866843],[2.320452,48.866784],[2.320039,48.866192],[2.319901,48.866223],[2.319883,48.866245],[2.320006,48.866424],[2.319967,48.866438],[2.319839,48.866265],[2.31985,48.866208],[2.319999,48.866152],[2.319901,48.866006]],"features":["协和广场东北侧的林荫园","老式音乐亭与栗树"]},{"name":"新法兰西花园","nameFr":"Jardin de la Nouvelle-France","kind":"garden","paving":"lawn","poly":[[2.310535,48.865564],[2.310747,48.865566],[2.310758,48.865537],[2.311078,48.865543],[2.311088,48.865572],[2.311208,48.865576],[2.311201,48.86574],[2.311229,48.86575],[2.311921,48.865715],[2.311876,48.865328],[2.311848,48.86533],[2.311836,48.865229],[2.311915,48.865186],[2.311927,48.865035],[2.310585,48.864993],[2.310562,48.865021]],"features":["下沉在阿尔玛坡地里的小谷地","瀑布与小溪","一段十九世纪的铸铁人行桥"]},{"name":"国家档案馆花园","nameFr":"Jardin des Archives-Nationales","kind":"garden","paving":"parterre","poly":[[2.357756,48.860005],[2.358067,48.860273],[2.358553,48.860019],[2.358647,48.860101],[2.35845,48.8602],[2.35871,48.860428],[2.358904,48.860334],[2.359239,48.860605],[2.359309,48.860569],[2.359174,48.860453],[2.359122,48.860449],[2.359138,48.860397],[2.359084,48.860341],[2.359701,48.860037],[2.359189,48.859624],[2.358898,48.859777],[2.358541,48.859482],[2.358624,48.859438],[2.35852,48.859358],[2.358129,48.859628],[2.358245,48.859694],[2.358205,48.859741],[2.35798,48.859891],[2.357937,48.859873]],"features":["苏比斯府邸的规整后花园","藏在马雷街廓深处","几何黄杨模纹"]},{"name":"马可波罗花园","nameFr":"Jardin des Grands-Explorateurs Marco Polo et Robert Cavelier-de-la-Salle","kind":"garden","paving":"lawn","poly":[[2.336392,48.841278],[2.33651,48.840985],[2.33661,48.840904],[2.33673,48.840866],[2.336868,48.84086],[2.337014,48.840898],[2.33712,48.840976],[2.337275,48.84126],[2.33735,48.842435],[2.336474,48.842456]],"features":["卢森堡公园向南延伸的长条轴线","卡尔波的四洲喷泉","两侧成列的悬铃木","轴线尽端是天文台"]}],"bridges":[{"id":"pont-de-bir-hakeim","name":"比尔阿凯姆桥","nameFr":"Pont de Bir-Hakeim","lon":2.28746,"lat":48.85582,"year":1905,"kind":"two-level","lengthM":237,"deckW":24.7,"arches":6,"riseRatio":0.24,"parapet":"iron-rail","lamps":"cast-iron","pedestrian":false,"hero":true,"material":"steel-on-masonry-piers","spans":{"grandBras":[30,54,30],"petitBras":[24,42,24]},"detail":{"structure":"两座各自独立的结构，在天鹅岛（Île aux Cygnes）北端相接。每半座都是「两个半拱 + 一个中央拱」的钢制敞肩上承拱，落在块石桥墩（starlings）上。","lowerDeck":"下层：中央 12m 为人行道（2023 年命名为 promenade Jean-Paul-Belmondo），两侧机动车道，人车共用。","upperDeck":"上层：Viaduc de Passy 高架，承载**巴黎地铁 6 号线**。上层水平，下层车行道从左岸向右岸下坡，两层间距沿桥不等。","colonnade":"上层高架由成对的金属（铸铁）柱廊支承，仅在天鹅岛处改为一座砌体拱。柱距约 6m —— **估算值**，未找到一手来源；建模时按 237m 总长扣掉岛上砌体拱段后均分即可。","islandPier":"天鹅岛上的中央砌体拱两侧有四座纪念性石雕高浮雕：上游 La Science 与 Le Travail（Jules-Félix Coutan）、下游 L'Électricité 与 Le Commerce（Jean-Antoine Injalbert）。","statues":"石桥墩上另有两组 Gustave Michel 的铸铁雕像群，题材为 nautes（塞纳河船工）与 forgerons（铁匠）。","riverStatue":"天鹅岛北端尖角立 La France renaissante（Holger Wederkinch，1930，丹麦侨民捐赠）骑马像，就在桥下——这是从桥上看铁塔那张经典构图里的前景。","cycle":"自行车道从上层高架下方穿过。","view":"桥面正对埃菲尔铁塔，是全巴黎最上镜的桥之一（《盗梦空间》《巴黎最后的探戈》均取景于此）。"},"builder":"Louis Biette（工程）· Daydé & Pillé（施工）· Jean-Camille Formigé（装饰）","heritage":"1986 年列入历史古迹名录（inscrit MH）","src":"fr/en Wikipedia「Pont de Bir-Hakeim」：长 237m、宽 24.7m、1903–1905、跨径 30/54/30 与 24/42/24、地铁 6 号线、四座石雕作者","est":["riseRatio","detail.colonnade 柱距 6m","lamps"],"crosses":"both-arms","azimuthDeg":147.6,"osmExtentM":243,"_armW":98},{"id":"pont-diena","name":"耶拿桥","nameFr":"Pont d'Iéna","lon":2.29208,"lat":48.85982,"year":1814,"kind":"stone-arch","lengthM":155,"deckW":35,"arches":5,"riseRatio":0.22,"parapet":"solid","lamps":"cast-iron","pedestrian":false,"hero":false,"material":"stone","features":["5 孔等跨圆弧拱，每孔 28m","桥台四角立帝国鹰浮雕（François-Frédéric Lemot 设计，Jean-François Mouret 雕刻）","桥头四组骑马像：高卢武士、罗马武士、阿拉伯武士、希腊武士（1853 加建）","正对埃菲尔铁塔与夏乐宫的城市轴线，1937 年由 14m 加宽到 35m"],"src":"fr Wikipedia：长 155m、宽 35m（1935 年起）、1808–1814、5 孔各 28m、帝国鹰","est":["riseRatio","deckW 的 35m 为加宽后现值","lamps"],"crosses":"bank-to-bank","azimuthDeg":133.3,"osmExtentM":156,"_armW":130},{"id":"passerelle-debilly","name":"德比伊人行桥","nameFr":"Passerelle Debilly","lon":2.29693,"lat":48.86256,"year":1900,"kind":"steel-arch","lengthM":120,"deckW":8,"arches":3,"riseRatio":0.2,"parapet":"iron-rail","lamps":"art-nouveau","pedestrian":true,"hero":false,"material":"steel","features":["三跨，中跨为 75m 中承式钢拱（tablier intermédiaire），拱矢 15m，铰点在桥面下 6.40m","1900 年世博会为串联两岸展馆而建的「临时」桥，一直留到今天","新艺术风格铁栏与陶砖桥台","工程师 Résal / Alby / Lion，施工 Daydé & Pillé（与比尔阿凯姆桥同一家）"],"src":"planete-tp / AFGC：总长 120m、宽 8m、中跨 75m、拱矢 15m。注：fr Wikipedia 信息框写 160m，与工程资料不符，本文件取 120m","est":["lamps"],"conflict":"长度 120m（工程资料）vs 160m（fr Wikipedia 信息框），取前者","crosses":"bank-to-bank","azimuthDeg":152.2,"osmExtentM":140,"_armW":105},{"id":"pont-de-lalma","name":"阿尔玛桥","nameFr":"Pont de l'Alma","lon":2.30178,"lat":48.86358,"year":1974,"kind":"steel-girder","lengthM":153,"deckW":42,"arches":2,"riseRatio":0,"parapet":"solid","lamps":"modern","pedestrian":false,"hero":false,"material":"steel","spans":[110,31.5],"features":["现桥 1970–1974 重建：两跨连续钢箱梁（110m + 31.5m），河中只剩一座桥墩","1856 年的原桥是三孔砌体拱，墩鼻上有四尊 6m 高士兵像；重建时只保留了 Zouave（轻步兵，Georges Diébolt 作），仍立在上游侧仅存的那座桥墩脚下","巴黎人用 Zouave 的水位当涨水标尺：水淹到脚是可通航警戒，淹到大腿就是大水","1997 年戴安娜王妃车祸即发生在桥下的阿尔玛隧道"],"src":"fr Wikipedia + planete-tp：长 153m、宽 42m、1970–1974 重建、两跨 110m 与 31.5m、仅存 Zouave 像","est":["lamps"],"note":"桥型不是拱——是钢箱梁。建模不要套石拱族。","crosses":"bank-to-bank","azimuthDeg":177.3,"osmExtentM":142,"_armW":116},{"id":"pont-des-invalides","name":"荣军院桥","nameFr":"Pont des Invalides","lon":2.31034,"lat":48.86357,"year":1856,"kind":"stone-arch","lengthM":152,"deckW":18,"arches":4,"riseRatio":0.13,"parapet":"solid","lamps":"cast-iron","pedestrian":false,"hero":false,"material":"stone","features":["巴黎净空最低的桥——拱背最扁，涨水时最先封航","4 孔不等跨砌体拱","中央桥墩上下游各有一组胜利女神浮雕：上游「陆上胜利」（Victor Vilain）、下游「海上胜利」（Georges Diébolt）","中央拱装有净空传感器，实时显示可通航高度"],"src":"fr/en Wikipedia：长 152m、宽 18m、1854–1856、4 孔、「巴黎最低的桥」","est":["riseRatio","lamps"],"crosses":"bank-to-bank","azimuthDeg":178.2,"osmExtentM":148,"_armW":118},{"id":"pont-alexandre-iii","name":"亚历山大三世桥","nameFr":"Pont Alexandre-III","lon":2.31363,"lat":48.86384,"year":1900,"kind":"steel-arch","lengthM":160,"deckW":40,"arches":1,"riseRatio":0.0588,"parapet":"balustrade","lamps":"art-nouveau","pedestrian":false,"hero":true,"material":"cast-steel","detail":{"arch":"单跨 107.50m 三铰钢拱（acier moulé），中间无任何河中支点。拱矢比 1/17 → 拱矢约 6.3m，这是「几乎看不出弧度」的关键，全桥观感极扁。","abutments":"为抵抗超扁拱的巨大水平推力，两端是极厚重的桥台：宽 44m、厚 30m，下有当时罕见的巨型混凝土基础。桥台上各开两条石砌隧道供下层河岸通行——建模时这两个洞不能省，它是桥台不显笨重的原因。","pylons":"四座立柱（pylônes），石砌柱身高 17m，柱顶各立一组镀金青铜「Renommée（声誉女神）勒住珀伽索斯」：右岸上游 La Renommée des Arts、右岸下游 La Renommée des Sciences（均 Emmanuel Frémiet）；左岸上游 La Renommée au combat（Pierre Granet）、左岸下游 Pégase tenu par la Renommée de la Guerre（Léopold Steiner，1899 去世后由 Gantzlin 完成）。**四座立柱的基础与桥体分离，纯装饰，不受力。**","pylonBase":"四座柱脚各有一组法国史寓意雕像：右岸上游「中世纪的法国」（Alfred Lenoir）、左岸上游「文艺复兴的法国」（Jules Coutan）、左岸下游「路易十四时期的法国」（Laurent Marqueste）、右岸下游「现代法国」（Gustave Michel）。","nymphs":"拱顶中央上下游各一块锤揲铜浮雕（Georges Récipon）：上游（协和桥方向）Nymphes de la Neva 携俄罗斯国徽，下游（阿尔玛方向）Nymphes de la Seine 携巴黎市徽。","lamps":"**32 座青铜灯柱（candélabres）**，Lacarrière 厂制造（同厂做过加尼叶歌剧院的大吊灯）。新艺术造型，灯柱基座有 Henri-Désiré Gauquié 的小天使（Amours）托举。","lions":"四个桥头各有一组「孩童牵狮」青铜群像：左岸 Jules Dalou、右岸 Georges Gardet。","others":"另有 Léopold Morice 与 André Massoulle 的四组「持鱼与贝的精灵」；桥面沿拱背有一列面具与花环，节奏与连接立柱一致。","color":"历史上换过多次颜色（灰 → 绿褐 → 珍珠灰），1998 年唯一一次大修时恢复原色。","constraint":"设计硬约束：桥面必须够平，使人从香榭丽舍能完整看见荣军院金顶——这是它做成超扁拱的原因，不是审美偏好。"},"src":"fr Wikipedia「Pont Alexandre-III」：总长 160m、主跨 107.50m、拱矢比 1/17、32 座青铜灯柱、桥台 44×30m；en Wikipedia：柱身 17m、拱矢约 6m。宽度 fr 正文写 45m、信息框写 30m、规划文件定 40m（原拟 50m），本文件取 40m","est":["deckW（40m，三个来源不一致，见 conflict）"],"conflict":"桥宽：40m（1895 年定案，最常引用）/ 45m（fr Wikipedia 正文）/ 30m（fr Wikipedia 信息框）。取 40m。","heritage":"1975 年列为历史古迹（classé MH）；1991 年随「巴黎塞纳河沿岸」列入世界遗产","crosses":"bank-to-bank","azimuthDeg":6.7,"osmExtentM":156,"_armW":109},{"id":"pont-de-la-concorde","name":"协和桥","nameFr":"Pont de la Concorde","lon":2.31959,"lat":48.86338,"year":1791,"kind":"stone-arch","lengthM":153,"deckW":34,"arches":5,"riseRatio":0.15,"parapet":"balustrade","lamps":"cast-iron","pedestrian":false,"hero":false,"material":"stone + reinforced concrete","features":["5 孔砌体扁拱，跨径 25–31m 不等","工程师 Jean-Rodolphe Perronet 的收官之作，扁拱与细桥墩是他的签名","**用拆毁巴士底狱的石头砌成**——1789 年后建成，寓意「人民踩着旧政权过河」","1930–1932 年加宽一倍（从 14.6m 到 34m），加宽部分用钢筋混凝土，外贴石材找平，两侧看不出","1810 年代曾在桥上立 12 尊白色大理石大臣／将领／海军将领像，因太重被路易-菲利普移往凡尔赛"],"src":"fr Wikipedia：长 153m、宽 34m、1787–1791 与 1930–1932；en Wikipedia / Britannica：5 孔，跨径 25–31m","est":["riseRatio","lamps"],"crosses":"bank-to-bank","azimuthDeg":27.2,"osmExtentM":155,"_armW":134},{"id":"passerelle-leopold-sedar-senghor","name":"桑戈尔人行桥","nameFr":"Passerelle Léopold-Sédar-Senghor","lon":2.32469,"lat":48.86179,"year":1999,"kind":"steel-arch","lengthM":106,"deckW":15,"arches":1,"riseRatio":0.12,"parapet":"iron-rail","lamps":"modern","pedestrian":true,"hero":false,"material":"steel + wood deck","features":["单跨 106m 钢拱，无河中桥墩","双层步道：上层从堤岸街面直接过，下层接下层河岸，两层在桥中央交汇","桥面铺非洲重蚁木（azobé）","建筑师 Marc Mimram，获 1999 年 Équerre d'Argent 奖","旧名 Passerelle Solférino，2006 年改现名","连接杜乐丽花园与奥赛博物馆"],"src":"fr/en Wikipedia：长 106m、宽 15m、1997–1999、单拱、Marc Mimram","est":["riseRatio","lamps"],"crosses":"bank-to-bank","azimuthDeg":25.6,"osmExtentM":141,"_armW":106},{"id":"pont-royal","name":"皇家桥","nameFr":"Pont Royal","lon":2.32992,"lat":48.86013,"year":1689,"kind":"stone-arch","lengthM":110,"deckW":17,"arches":5,"riseRatio":0.24,"parapet":"solid","lamps":"cast-iron","pedestrian":false,"hero":false,"material":"stone","spans":[20.8,22.42,23.4,22.42,20.8],"features":["巴黎第三老的桥（次于新桥、玛丽桥）","5 孔：中孔 72 法尺（23.40m），中间孔 69 法尺（22.42m），边孔 64 法尺（约 20.8m）","路易十四出资，Jules Hardouin-Mansart 设计、François Romain 修士施工","桥墩厚度与孔径之比取 1/5——这是当时能让拱一个接一个拆架而不失稳的比例","左岸桥台侧刻有水位标尺"],"src":"fr Wikipedia：长 110m、宽 17m、1685–1689、5 travées 及各孔法尺跨径","est":["riseRatio","lamps","spans 中边孔 20.8m 由 64 法尺换算"],"crosses":"bank-to-bank","azimuthDeg":26.1,"osmExtentM":131,"_armW":110},{"id":"pont-du-carrousel","name":"卡鲁塞尔桥","nameFr":"Pont du Carrousel","lon":2.33279,"lat":48.85912,"year":1939,"kind":"concrete-arch","lengthM":168,"deckW":33,"arches":3,"riseRatio":0.11,"parapet":"solid","lamps":"telescopic","pedestrian":false,"hero":false,"material":"reinforced concrete","spans":[47.85,47.85,47.85],"features":["3 孔各 47.85m 钢筋混凝土扁拱，外贴石材","**伸缩式路灯**：Raymond Subes 1946 年设计，白天灯头在 13m，入夜升到 20m。机构不久后损坏，1999 年修复——夜景里这是这座桥唯一的识别点","桥头四角有 Louis Petitot 的四尊寓意坐像（工业、丰饶、塞纳河、巴黎城），从 1834 年的旧桥移过来的"],"src":"fr Wikipedia：长 168m、宽 33m、1935–1939、3 孔各 47.85m、Subes 伸缩灯 13m→20m","est":["riseRatio"],"crosses":"bank-to-bank","azimuthDeg":20.7,"osmExtentM":145,"_armW":120},{"id":"pont-des-arts","name":"艺术桥","nameFr":"Pont des Arts","lon":2.33757,"lat":48.85846,"year":1984,"kind":"steel-arch","lengthM":155,"deckW":11,"arches":7,"riseRatio":0.12,"parapet":"iron-rail","lamps":"cast-iron","pedestrian":true,"hero":false,"material":"steel (1984) — 原 1804 年版为铸铁","features":["巴黎第一座金属桥（1801–1804，9 孔铸铁）。1979 年被驳船撞塌两跨，1981–1984 按 Louis Arretche 方案重建","重建时把孔数从 9 减到 7，**为的是让桥墩与下游新桥的桥墩对齐**——建模时这条对位关系要保住","纯步行桥，木板桥面，正对法兰西学院穹顶","2008 年起被「爱情锁」压垮栏杆，2015 年市政府拆锁换玻璃板"],"src":"fr Wikipedia：长 155m、宽 11m、1981–1984 重建、7 孔（原 9 孔）、与新桥对孔","est":["riseRatio","lamps"],"crosses":"bank-to-bank","azimuthDeg":18.6,"osmExtentM":151,"_armW":140},{"id":"pont-neuf","name":"新桥","nameFr":"Pont Neuf","lon":2.34139,"lat":48.85717,"year":1607,"kind":"stone-arch","lengthM":232,"deckW":22,"arches":12,"riseRatio":0.28,"parapet":"solid","lamps":"cast-iron","pedestrian":false,"hero":true,"material":"stone","detail":{"split":"**孔数怎么分：12 孔 = 北段（大汊 Grand Bras，接右岸）7 孔 + 南段（小汊 Petit Bras，接左岸）5 孔。** 两段不在一条直线上，在西岱岛西端的 terre-plein 处折一个角——这个折角是新桥最容易被建模漏掉的特征。原设计是北 8 南 4，1579 年夏改成 7 和 5；南边四个桥墩和左岸桥台当时已经砌好，加第五孔只能把岛上平台从 28.5 toises 缩到约 19 toises。","corbeilles":"**每个桥墩上方、桥面两侧各挑出一个半圆形凸台（corbeille / demi-lune）**，供行人避让马车。数量 = 桥墩数 × 2 侧。17 世纪凸台上盖过小铺子，19 世纪清空，只剩石凳。这是新桥的第一识别特征，比拱更重要。","mascarons":"沿檐口雕 **381 个鬼脸（mascarons）**，每个都不一样，题材是森林与田野神祇、萨梯、林神。原作长期被误归于 Germain Pilon（Henri Sauval 17 世纪的讹传）。1851–1854 年整桥重建时换成 19 世纪雕刻家的复刻（Maindron、Lavigne、Barye、Fontenelle 等；Fontenelle 一人做了 61 个，在右岸到西岱岛之间的上游侧）。原件 6 个在卡纳瓦莱博物馆，8 个在埃库昂文艺复兴博物馆。**注意：常见说法「384 个」与 fr/en Wikipedia 的 381 不符，本文件取 381。**","statue":"西岱岛上两个桥台之间的 terre-plein 上立亨利四世骑马像。初版 1614 年（Giambologna 起稿、Pietro Tacca 完成），1792 年被熔铸成炮；现存这尊是 1818 年 Lemot 按旧模重铸的，铜料来自被熔掉的德赛（Desaix）像。","arches":"拱形不是原样：1848–1855 年为降低桥面坡度，把接近半圆的拱改成了椭圆形（扁拱），同时降低了人行道与墩面、拱肩、檐口。所以今天看到的是扁椭圆拱，不是文艺复兴的半圆拱。","firsts":"巴黎第一座完整跨越塞纳河的石桥、第一座桥上不盖房子的桥、第一座有人行道的桥。名字里的「新」指的就是这三件事。","caves":"最初的设计要在桥上盖房，所以桥墩里和拱下挖了地窖，地下通道相连；亨利四世改主意不盖房后地窖留了下来，后来被封死。","vertGalant":"桥建成时刚好擦过西岱岛当时的西端；此后淤沙加上石砌堤岸把岛又向西延长了一截，就是今天桥下的 Square du Vert-Galant。"},"src":"fr/en Wikipedia + structurae：长 232m（structurae）、宽 22m（structurae）、1578–1607、7+5=12 孔、381 个 mascarons、亨利四世像 1818 年重铸","est":["riseRatio"],"conflict":"长度：232m（structurae / en Wikipedia）vs 238m（fr Wikipedia）。宽度：22m（structurae）vs 20m（fr Wikipedia 信息框）。本文件取 structurae 值。","heritage":"1889 年列为历史古迹（classé MH）；1991 年列入世界遗产","crosses":"both-arms","azimuthDeg":29.2,"osmExtentM":274,"_armW":66},{"id":"pont-saint-michel","name":"圣米歇尔桥","nameFr":"Pont Saint-Michel","lon":2.3446,"lat":48.85407,"year":1857,"kind":"stone-arch","lengthM":62,"deckW":30,"arches":3,"riseRatio":0.2,"parapet":"solid","lamps":"cast-iron","pedestrian":false,"hero":false,"material":"stone","features":["3 孔半圆拱（plein cintre）","拱肩上刻拿破仑三世的花押「N」加帝国鹰的圆徽——第二帝国桥梁的标准签名","接圣米歇尔广场，宽度（30m）几乎等于长度（62m）的一半，观感是「宽而短」"],"src":"fr Wikipedia「Pont Saint-Michel (Paris)」：长 62m、宽 30m、1857、三孔半圆拱","est":["riseRatio","lamps"],"crosses":"left-to-cite","azimuthDeg":35.3,"osmExtentM":59,"_armW":51},{"id":"pont-au-change","name":"兑换桥","nameFr":"Pont au Change","lon":2.34679,"lat":48.8567,"year":1860,"kind":"stone-arch","lengthM":103,"deckW":30,"arches":3,"riseRatio":0.16,"parapet":"solid","lamps":"cast-iron","pedestrian":false,"hero":false,"material":"stone","features":["3 孔各 31m 椭圆砌体拱","与圣米歇尔桥同一批（第二帝国），拱肩同样刻拿破仑三世的「N」圆徽","连接夏特雷广场与古监狱／司法宫","桥名来自中世纪桥上的兑换钱币商铺"],"src":"fr Wikipedia：长 103m、宽 30m、1858–1860；en Wikipedia：3 孔椭圆拱各 31m","est":["riseRatio","lamps"],"crosses":"right-to-cite","azimuthDeg":23.6,"osmExtentM":105,"_armW":90},{"id":"petit-pont","name":"小桥","nameFr":"Petit-Pont – Cardinal-Lustiger","lon":2.34695,"lat":48.85331,"year":1853,"kind":"stone-arch","lengthM":38,"deckW":20,"arches":1,"riseRatio":0.18,"parapet":"solid","lamps":"cast-iron","pedestrian":false,"hero":false,"material":"stone","features":["单孔，净跨 31–32m，磨石与水泥砂浆砌筑，Lagalisserie 与 Darcel 设计","巴黎最短的跨河桥","此处自高卢-罗马时代就有桥，被冲毁／烧毁重建至少 13 次","2013 年加名 Cardinal-Lustiger"],"src":"fr/en Wikipedia：1853、单孔、净跨 31–32m、宽 20m","est":["riseRatio","lamps"],"conflict":"长度：fr Wikipedia 信息框写 32m，正文写 38m。取 38m —— OSM 桥体几何主轴跨度实测 39m，支持 38m 这一侧。","crosses":"left-to-cite","azimuthDeg":20.5,"osmExtentM":39,"_armW":26},{"id":"pont-au-double","name":"双币桥","nameFr":"Pont au Double","lon":2.34844,"lat":48.85259,"year":1883,"kind":"steel-arch","lengthM":45,"deckW":20,"arches":1,"riseRatio":0.15,"parapet":"iron-rail","lamps":"cast-iron","pedestrian":true,"hero":false,"material":"cast iron","features":["单孔铸铁拱","桥名来自 17 世纪过桥费——两枚「双币（double tournois）」","原桥（1634）上盖着主宫医院（Hôtel-Dieu）的病房，是巴黎最后一座「桥上有房」的桥","正对圣母院南立面与蒙特贝洛码头，是拍圣母院的经典机位"],"src":"fr Wikipedia：长 45m、宽 20m、1881–1883、铸铁、单孔","est":["riseRatio","lamps","pedestrian（现为步行为主，机动车禁行）"],"crosses":"left-to-cite","azimuthDeg":26.1,"osmExtentM":37,"_armW":32},{"id":"pont-notre-dame","name":"圣母桥","nameFr":"Pont Notre-Dame","lon":2.3486,"lat":48.85618,"year":1914,"kind":"steel-arch","lengthM":105,"deckW":20,"arches":3,"riseRatio":0.13,"parapet":"solid","lamps":"cast-iron","pedestrian":false,"hero":false,"material":"steel центральная arch + stone side arches","spans":[null,59.51,null],"features":["桥址自古罗马就有桥，是巴黎「最古老」的桥位（但结构全新）","1853 年的石桥原有 5 孔，1910–1914 年拆掉中间三孔改成**一孔 59.51m 的钢拱**，两边留石拱，成了今天的 3 孔","改建原因：原来孔太小太密，船撞桥不断，得名「魔鬼桥 pont du Diable」","边孔被加宽、边墩加固以承接更大的拱推力"],"src":"fr Wikipedia：长 105m、宽 20m、现状 1910–1914、中孔钢拱 portée 59.51m、原 5 孔改 3 孔","est":["riseRatio","lamps","spans 两边孔跨径未查到"],"crosses":"right-to-cite","azimuthDeg":20.8,"osmExtentM":109,"_armW":91},{"id":"pont-darcole","name":"阿尔科勒桥","nameFr":"Pont d'Arcole","lon":2.35074,"lat":48.85573,"year":1856,"kind":"steel-arch","lengthM":80,"deckW":20,"arches":1,"riseRatio":0.1,"parapet":"iron-rail","lamps":"cast-iron","pedestrian":false,"hero":false,"material":"wrought iron","features":["**巴黎第一座铁桥**，也是第一座在河中不设桥墩的桥：单跨 80m 熟铁拱，两端落在石桥台上","工程师 Alphonse Oudry，1856 年建成（1828 年的初版是悬索人行桥）","连接市政厅与西岱岛，桥面极扁"],"src":"fr Wikipedia：单孔 80m 熟铁拱、宽 20m、1854–1856、Alphonse Oudry","est":["riseRatio","lamps"],"crosses":"right-to-cite","azimuthDeg":25.7,"osmExtentM":91,"_armW":82},{"id":"pont-de-larcheveche","name":"主教府桥","nameFr":"Pont de l'Archevêché","lon":2.35154,"lat":48.85151,"year":1828,"kind":"stone-arch","lengthM":68,"deckW":11,"arches":3,"riseRatio":0.18,"parapet":"solid","lamps":"cast-iron","pedestrian":false,"hero":false,"material":"stone","spans":[15,17,15],"features":["**巴黎最窄的通车桥**（11m）","3 孔砌体拱，净跨 15 / 17 / 15m","接圣母院后方的 Square de l'Île-de-France，是看圣母院飞扶壁的最佳角度","2010 年代「爱情锁」从艺术桥转移到这里，2015 年后被清理"],"src":"fr Wikipedia：长 68m、宽 11m、1828、三孔 15/17/15m","est":["riseRatio","lamps"],"crosses":"left-to-cite","azimuthDeg":22.7,"osmExtentM":68,"_armW":48},{"id":"pont-saint-louis","name":"圣路易桥","nameFr":"Pont Saint-Louis","lon":2.35277,"lat":48.85277,"year":1970,"kind":"steel-beam","lengthM":67,"deckW":16,"arches":1,"riseRatio":0,"parapet":"iron-rail","lamps":"modern","pedestrian":true,"hero":false,"material":"steel","features":["连接西岱岛与圣路易岛的唯一一座桥，纯步行","单跨 67m 钢梁，无拱、无墩，极简","同一位置换过 7 座桥（木桥、悬索桥、铁桥），是巴黎换桥最勤的桥位","街头艺人常年驻场，是两岛之间的社交客厅"],"src":"fr Wikipedia：长 67m、宽 16m、1969–1970、钢梁桥、单跨 64m（前一版）","note":"**它在两岛之间，走向与河轴近乎平行**：实测方位 71.6°，邻近各桥都在 20–33°。按「垂直于河轴」摆会歪掉约 45°，必须用 azimuthDeg。","est":["riseRatio","lamps"],"crosses":"cite-to-saintlouis","azimuthDeg":71.6,"osmExtentM":71,"_armW":110},{"id":"pont-louis-philippe","name":"路易-菲利普桥","nameFr":"Pont Louis-Philippe","lon":2.35443,"lat":48.85384,"year":1862,"kind":"stone-arch","lengthM":100,"deckW":15.2,"arches":3,"riseRatio":0.16,"parapet":"solid","lamps":"cast-iron","pedestrian":false,"hero":false,"material":"stone","features":["3 孔椭圆砌体拱","1995 年整体照原样更换了风化严重的石栏杆，除此之外自 1862 年未改动","连接圣路易岛（波旁码头）与右岸圣热尔韦街区"],"src":"fr Wikipedia：长 100m、宽 15.2m、1860–1862；en Wikipedia：3 孔椭圆石拱","est":["riseRatio","lamps"],"crosses":"right-to-saintlouis","azimuthDeg":32.9,"osmExtentM":99,"_armW":77},{"id":"pont-de-la-tournelle","name":"图尔奈勒桥","nameFr":"Pont de la Tournelle","lon":2.35545,"lat":48.85062,"year":1930,"kind":"concrete-arch","lengthM":122,"deckW":23,"arches":3,"riseRatio":0.12,"parapet":"solid","lamps":"art-deco","pedestrian":false,"hero":false,"material":"reinforced concrete","features":["一大中孔 + 两小边孔的钢筋混凝土固端拱（arc encastré），装饰艺术风格","**左岸桥头立一座近 15m 高、船首形的方尖塔柱，柱顶是保护巴黎的圣女热纳维耶芙像**（Paul Landowski，1928，40 吨 Souppes 石整块雕成）——这是全桥的视觉锚点，比桥本身醒目","雕像朝向东（上游）而非西，是当年建筑师与雕塑家争执后由市政当局裁定的；Landowski 因此没参加通桥典礼","与玛丽桥同一轴线，一南一北把圣路易岛接到两岸"],"src":"fr Wikipedia：长 122m、宽 23m、1928–1930、钢筋混凝土、一大孔两小孔、Landowski 圣女像与约 15m 塔柱","est":["riseRatio","lamps"],"crosses":"left-to-saintlouis","azimuthDeg":30.6,"osmExtentM":119,"_armW":100},{"id":"pont-marie","name":"玛丽桥","nameFr":"Pont Marie","lon":2.35742,"lat":48.85287,"year":1635,"kind":"stone-arch","lengthM":92,"deckW":22,"arches":5,"riseRatio":0.3,"parapet":"solid","lamps":"cast-iron","pedestrian":false,"hero":false,"material":"stone","features":["巴黎第二老的桥（1614–1635）","**5 孔，每一孔都不一样**，净跨在 14–18m 之间——建模不要做成等跨","**分水尖（avant-becs）上方各有一个壁龛，从建成起就一直空着**，原打算放雕像，四百年没放","桥墩与拱头、拱顶檐口用 Cliquard 石，其余用 Verselay 石","1658 年洪水冲垮两孔连同其上的 20 幢房子，55 人遇难；此后桥上不再盖房"],"src":"fr Wikipedia：长 92m、宽 22m、1614–1635、5 孔各不相同、净跨 14–18m、分水尖空壁龛","est":["riseRatio","lamps"],"crosses":"right-to-saintlouis","azimuthDeg":29.2,"osmExtentM":92,"_armW":68},{"id":"pont-de-sully","name":"叙利桥","nameFr":"Pont de Sully","lon":2.36027,"lat":48.85047,"year":1876,"kind":"steel-arch","lengthM":256,"deckW":20,"arches":6,"riseRatio":0.15,"parapet":"iron-rail","lamps":"cast-iron","pedestrian":false,"hero":false,"material":"cast iron + masonry","spans":{"south":[46,49,46],"north":[15,46,15]},"features":["**其实是两座桥**，在圣路易岛东端相接，共同承载亨利四世大道；两段不共线，在岛上折一个角","南段（长 159m）三孔铸铁拱：46 / 49 / 46m","北段跨小汊：中央一孔 46m 铸铁拱 + 两侧各一孔 15m 砌体拱","桥上是看圣母院后殿与飞扶壁的最佳直线视角"],"src":"fr Wikipedia：长 256m、宽 20m、1874–1876、铸铁与砌体、南段 159m 三孔 46/49/46、北段 46m 加两孔 15m","est":["riseRatio","lamps"],"crosses":"both-arms","azimuthDeg":65.6,"osmExtentM":347,"_armW":79}]};

})();
