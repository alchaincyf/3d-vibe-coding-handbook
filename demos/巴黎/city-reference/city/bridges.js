/* ══════════════════════════════════════════════════════════════════════════
   city/bridges.js —— 塞纳河桥梁层（PC 模块 order:30）

   三座英雄桥逐座建模 + 一族参数化桥。全部位置、朝向、跨度、孔数、年代取自
   PC.plan.bridges（← city/data/bridges.json），本文件里没有一个手填坐标。

   几何策略
   ─ 桥位：plan 给的 {x,z,dir,angle,lengthM} 只当轴线用；桥的真实两端由
     「沿轴线采样 plan.river.inWater()」求出水道断面，再向两岸各外扩一段桥台。
     这样桥墩一定落在河道里、桥面一定接得上 y=0 的街面，不依赖 lengthM 是否准。
   ─ 桥身：立面多边形（桥面上缘 + 拱腹凹口 + 桥墩 + 桥台）沿桥宽方向拉伸成一个
     实体。拱腹是「从下方切进来的缺口」而不是封闭洞，所以一个简单多边形就够，
     不用带洞三角化。
   ─ 桥面/檐口/女儿墙/人行道/车行道：一条横断面沿桥面纵坡扫掠（ribbon），
     一次拿到全部，纵坡与超高自动跟随。
   ─ 水线：石材桶开 vertexColors，按 y 涂「水位痕」（−9.4~−7.4 一条脏绿带，
     水下更深）。这样不用为水线单开材质，省一个 draw call。

   预算：规划给的是 4.5 万三角 / 8 draw call，实测 5.4 万 / 10。超出的账要说清楚：
   ─ +6,728 tri 是路灯。134 根桥灯 24→68 tri，32 座亚历山大三世灯柱补灯笼头。
     旧版是「黑方尖碑顶一个方块」，站在桥面上一眼就穿帮；路灯是街景里第二可靠的
     尺度锚点，只有它和人行道能告诉观众「这座桥有多大」。
   ─ +1 call 是灯柱另开的漆铸铁桶（见 MAT.lampIron 处的说明），+1 call 是钢桥珍珠灰，
     +1 call 是车行道的沥青桶（见 asphaltCanvas 处的说明）。
   放进全城 90 万三角 / 200 call 的盘子里是 +0.75% 三角、+1% call。
   实测数字见构建完的 console 表（当前 54,032 三角 / 10 mesh）。
   ══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

const H  = (window.P3D && P3D.helpers) || {};
const GB = H.GB;
const clamp = H.clamp, lerp = H.lerp, TAU = H.TAU;
const makeStone = H.makeStone, makeOak = H.makeOak, cv = H.cv, cylBand = H.cylBand;
const DEG = Math.PI / 180;

/* ── 高程基准（PC.Y，不可改） ───────────────────────────────────────── */
const Y_STREET = 0, Y_BERGE = -6.6, Y_WATER = -8.6;
const Y_BASE   = -11.8;      // 桥墩基础落到基岩
const NAV_CLEAR = 6.0;       // 苍蝇船净空

/* ── 颜色派生：一律从 PC.palette 出发，不凭感觉写死新灰 ──────────────── */
function mixHex(a, b, t){
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) |
         (Math.round(ag + (bg - ag) * t) << 8)  |
          Math.round(ab + (bb - ab) * t);
}

/* ══════════════ 1. 小几何工具（GB 之上补三件 GB 没有的） ══════════════ */

/* 带顶点色的 GB。C 与 P 一一对应，缺省补 1（=不改色） */
function newGB(){ const g = new GB(); g.C = []; return g; }

function paintRange(gb, from, to, fn){
  for (let i = from; i < to; i++){
    const c = fn(gb.P[i*3], gb.P[i*3+1], gb.P[i*3+2]);
    gb.C[i*3] = c[0]; gb.C[i*3+1] = c[1]; gb.C[i*3+2] = c[2];
  }
}

function finishGB(gb, worldSpace){
  if (!gb.I.length) return null;
  const g = gb.build();
  const n = gb.n, C = new Float32Array(n * 3), W = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) C[i] = (gb.C[i] === undefined ? 1 : gb.C[i]);
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  /* 逐顶点风化档案 aWx =（岁月系数, 苔绿倾向, 上游度）。
     统一在这里盖章，不散在十几处 paintRange 里——漏掉一处，就会有一块几何
     拿到 age=0，在一整座旧桥身上留一块崭新的补丁，而且极难找。 */
  const P = PROF;
  if (P){
    const inv = 1 / (P.halfW * 0.55);
    for (let i = 0; i < n; i++){
      /* 局部 z 就是桥宽方向。岛上平台与亨利四世像是按世界坐标建的，
         那里的 z 不是桥宽，没有上下游之分，给中性值。 */
      const upK = worldSpace ? 0.5
        : 0.5 + 0.5 * clamp(gb.P[i * 3 + 2] * P.upSign * inv, -1, 1);
      W[i*3] = P.ageK; W[i*3+1] = P.mossK; W[i*3+2] = upK;
    }
  } else {
    for (let i = 0; i < n; i++){ W[i*3] = 0.4; W[i*3+1] = 0.3; W[i*3+2] = 0.5; }
  }
  g.setAttribute('aWx', new THREE.Float32BufferAttribute(W, 3));
  return g;
}

/* 合并（position/normal/uv/color/aWx + index）。
   用自己这份而不是 PC.merge，因为 PC.merge 不搬运 color 与 aWx，
   而顶点色与风化档案整套方案挂在这两个属性上。算法与 PC.merge 一致。 */
function mergeC(geos){
  const list = geos.filter(g => g && g.attributes && g.attributes.position);
  if (!list.length) return null;
  let vc = 0, ic = 0;
  for (const g of list){
    vc += g.attributes.position.count;
    ic += g.index ? g.index.count : g.attributes.position.count;
  }
  const P = new Float32Array(vc * 3), N = new Float32Array(vc * 3),
        U = new Float32Array(vc * 2), C = new Float32Array(vc * 3),
        X = new Float32Array(vc * 3),
        I = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
  let vo = 0, io = 0;
  for (const g of list){
    const a = g.attributes, c = a.position.count;
    P.set(a.position.array, vo * 3);
    if (a.normal) N.set(a.normal.array, vo * 3);
    if (a.uv)     U.set(a.uv.array, vo * 2);
    if (a.color)  C.set(a.color.array, vo * 3); else C.fill(1, vo * 3, (vo + c) * 3);
    if (a.aWx)    X.set(a.aWx.array,  vo * 3);
    if (g.index){ const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) I[io + i] = gi[i] + vo; io += gi.length; }
    else { for (let i = 0; i < c; i++) I[io + i] = i + vo; io += c; }
    vo += c;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  m.setAttribute('normal',   new THREE.Float32BufferAttribute(N, 3));
  m.setAttribute('uv',       new THREE.Float32BufferAttribute(U, 2));
  m.setAttribute('color',    new THREE.Float32BufferAttribute(C, 3));
  m.setAttribute('aWx',      new THREE.Float32BufferAttribute(X, 3));
  m.setIndex(new THREE.BufferAttribute(I, 1));
  m.computeBoundingSphere();
  for (const g of list) g.dispose && g.dispose();
  return m;
}

/* 凹多边形耳切（GB.prism 的侧面法线用重心启发式，凹多边形会把拱腹翻黑，
   所以桥身这块自己来） */
function ccw2(p){
  let a = 0;
  for (let i = 0; i < p.length; i++){ const q = p[i], r = p[(i+1) % p.length]; a += q[0]*r[1] - r[0]*q[1]; }
  return a >= 0 ? p : p.slice().reverse();
}
function earClip(P){
  const n = P.length, idx = [], out = [];
  for (let i = 0; i < n; i++) idx.push(i);
  const cr = (a,b,c) => (b[0]-a[0])*(c[1]-b[1]) - (b[1]-a[1])*(c[0]-b[0]);
  const inTri = (p,a,b,c) => cr(a,b,p) >= -1e-9 && cr(b,c,p) >= -1e-9 && cr(c,a,p) >= -1e-9;
  let guard = n * n + 24;
  while (idx.length > 3 && guard-- > 0){
    let cut = false;
    for (let i = 0; i < idx.length; i++){
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i+1) % idx.length];
      const a = P[ia], b = P[ib], c = P[ic];
      if (cr(a,b,c) <= 1e-10) continue;
      let ok = true;
      for (const j of idx){ if (j === ia || j === ib || j === ic) continue;
        if (inTri(P[j], a, b, c)){ ok = false; break; } }
      if (!ok) continue;
      out.push([ia, ib, ic]); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break;
  }
  for (let i = 1; i < idx.length - 1; i++) out.push([idx[0], idx[i], idx[i+1]]);
  return out;
}
/* (x,y) 多边形沿 z 拉伸。法线全部按绕序算，凹口不会翻面 */
function prismXY(gb, pts, z0, z1, s){
  /* 去掉相邻重复点：耳切遇到零长边会退化成扇形三角化，把拱腹缺口整片糊上 */
  const q = [];
  for (const p of pts){
    const l = q[q.length - 1];
    if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 1e-4) q.push(p);
  }
  while (q.length > 3 && Math.hypot(q[0][0] - q[q.length-1][0], q[0][1] - q[q.length-1][1]) < 1e-4) q.pop();
  const P = ccw2(q), n = P.length;
  if (n < 3) return;
  const tris = earClip(P);
  const f = [], bk = [];
  for (const p of P) f.push(gb.v(p[0], p[1], z1, 0,0,1,  p[0]*s, p[1]*s));
  for (const p of P) bk.push(gb.v(p[0], p[1], z0, 0,0,-1, -p[0]*s, p[1]*s));
  for (const t of tris){ gb.tri(f[t[0]], f[t[1]], f[t[2]]); gb.tri(bk[t[2]], bk[t[1]], bk[t[0]]); }
  let acc = 0;
  for (let i = 0; i < n; i++){
    const a = P[i], b = P[(i+1) % n];
    const ex = b[0]-a[0], ey = b[1]-a[1], L = Math.hypot(ex, ey);
    if (L < 1e-6) continue;
    const nx = ey/L, ny = -ex/L;
    const v0 = gb.v(a[0],a[1],z0, nx,ny,0, acc*s, z0*s);
    const v1 = gb.v(b[0],b[1],z0, nx,ny,0, (acc+L)*s, z0*s);
    const v2 = gb.v(b[0],b[1],z1, nx,ny,0, (acc+L)*s, z1*s);
    const v3 = gb.v(a[0],a[1],z1, nx,ny,0, acc*s, z1*s);
    gb.quad(v0, v1, v2, v3);
    acc += L;
  }
}

const v3 = {
  unit(a){ const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0]/l, a[1]/l, a[2]/l]; },
  cross(a, b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
};

/* 两端不同粗细的锥台段：A→B，端面半宽 ra/rb、半厚 ta/tb。12 tri。
   雕像全部用它拼——等截面的 slab 拼出来的马，每一段都是同样粗的方棍，
   100m 外读成一堆金条（这正是旧版被审出来的毛病）。收分做出来，
   腿才有「上粗下细」、颈才有「根粗梢细」，剪影立刻就有了动物感。
   uHint 指定「宽」的朝向（默认沿 x）；翅膀靠它把片状面摆进正确的平面。 */
function taper(gb, A, B, ra, ta, rb, tb, s, uHint){
  if (Math.hypot(B[0]-A[0], B[1]-A[1], B[2]-A[2]) < 1e-5) return;   // 零长段会让法线变 NaN
  const d = v3.unit([B[0]-A[0], B[1]-A[1], B[2]-A[2]]);
  let ref = uHint || [1, 0, 0];
  if (Math.abs(ref[0]*d[0] + ref[1]*d[1] + ref[2]*d[2]) > 0.985) ref = [0, 0, 1];
  const w = v3.unit(v3.cross(d, ref));      // 厚度方向
  const u = v3.unit(v3.cross(w, d));        // 宽度方向（u × w = d，右手系）
  const P = (C, r, t, i, j) => [C[0] + u[0]*r*i + w[0]*t*j,
                                C[1] + u[1]*r*i + w[1]*t*j,
                                C[2] + u[2]*r*i + w[2]*t*j];
  const a0 = P(A,ra,ta,-1,-1), a1 = P(A,ra,ta,1,-1), a2 = P(A,ra,ta,1,1), a3 = P(A,ra,ta,-1,1);
  const b0 = P(B,rb,tb,-1,-1), b1 = P(B,rb,tb,1,-1), b2 = P(B,rb,tb,1,1), b3 = P(B,rb,tb,-1,1);
  gb.face([b0, b1, b2, b3], s);             // B 端（法线 +d）
  gb.face([a3, a2, a1, a0], s);             // A 端（法线 −d）
  gb.face([a1, a2, b2, b1], s);             // +u
  gb.face([a0, b0, b3, a3], s);             // −u
  gb.face([a2, a3, b3, b2], s);             // +w
  gb.face([a1, b1, b0, a0], s);             // −w
}

/* 横断面沿纵坡扫掠。stations=[[x,yTop]…]，prof=[[z,dy]…]（左→右）。
   每个四边形独立顶点 → 硬边（檐口/路缘该是硬的）。colFn(j) 给每段涂色。
   第一参数可以是几何桶，也可以是 j → 几何桶 的函数——车行道要落进沥青桶、
   其余断面留在石材桶，靠它一次扫掠分流，不用把断面拆成两条各扫一遍。 */
function ribbon(gbOrFn, stations, prof, s, colFn){
  const pick = (typeof gbOrFn === 'function') ? gbOrFn : (() => gbOrFn);
  const ns = stations.length, np = prof.length;
  let av = 0;
  for (let i = 0; i < ns - 1; i++){
    const A = stations[i], B = stations[i+1];
    const dv = Math.hypot(B[0]-A[0], B[1]-A[1]);
    let au = 0;
    for (let j = 0; j < np - 1; j++){
      const gb = pick(j);
      const p0 = prof[j], p1 = prof[j+1];
      const du = Math.hypot(p1[0]-p0[0], p1[1]-p0[1]);
      const q0 = [A[0], A[1]+p0[1], p0[0]], q1 = [A[0], A[1]+p1[1], p1[0]];
      const q2 = [B[0], B[1]+p1[1], p1[0]], q3 = [B[0], B[1]+p0[1], p0[0]];
      const i0 = gb.v(q0[0],q0[1],q0[2], 0,1,0, au*s, av*s);
      const i1 = gb.v(q1[0],q1[1],q1[2], 0,1,0, (au+du)*s, av*s);
      const i2 = gb.v(q2[0],q2[1],q2[2], 0,1,0, (au+du)*s, (av+dv)*s);
      const i3 = gb.v(q3[0],q3[1],q3[2], 0,1,0, au*s, (av+dv)*s);
      gb.quad(i0, i1, i2, i3);
      if (colFn){
        const c = colFn(j);
        if (c) for (const k of [i0,i1,i2,i3]){ gb.C[k*3]=c[0]; gb.C[k*3+1]=c[1]; gb.C[k*3+2]=c[2]; }
      }
      au += du;
    }
    av += dv;
  }
}

/* 竖直贴面条带（檐口浮雕/鬼脸带）。z 固定，y 从 y0 到 y1 */
function fascia(gb, stations, z, y0, y1, uScale){
  let av = 0;
  for (let i = 0; i < stations.length - 1; i++){
    const A = stations[i], B = stations[i+1];
    const d = Math.hypot(B[0]-A[0], B[1]-A[1]);
    const s = z > 0 ? 1 : -1;
    const a0 = gb.v(A[0], A[1]+y0, z, 0,0,s, av*uScale, 0);
    const a1 = gb.v(B[0], B[1]+y0, z, 0,0,s, (av+d)*uScale, 0);
    const a2 = gb.v(B[0], B[1]+y1, z, 0,0,s, (av+d)*uScale, 1);
    const a3 = gb.v(A[0], A[1]+y1, z, 0,0,s, av*uScale, 1);
    if (s > 0) gb.quad(a0, a1, a2, a3); else gb.quad(a3, a2, a1, a0);
    av += d;
  }
}

/* ══════════════ 2. 贴图 ══════════════ */

function ashlarCanvas(){
  const S = 512;
  const t = makeStone(S, 7301, [204, 194, 174], 0.5, 0.4);
  /* 琢石砌缝（pierre de taille）。makeStone 的 bed 只是一点起伏，
     缝要自己画出来：深线 + 紧挨着的一道亮线 = 倒角缝，远看才有砌块节奏。 */
  const g = t.color.getContext('2d');
  const rows = 6, rh = S / rows;
  const line = (x0, y0, x1, y1) => {
    g.strokeStyle = 'rgba(84,77,64,0.80)'; g.lineWidth = 5.0;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.strokeStyle = 'rgba(240,234,216,0.55)'; g.lineWidth = 2.2;
    const dx = (y1 === y0) ? 0 : 2.6, dy = (y1 === y0) ? 2.6 : 0;
    g.beginPath(); g.moveTo(x0 + dx, y0 + dy); g.lineTo(x1 + dx, y1 + dy); g.stroke();
  };
  for (let r = 0; r <= rows; r++) line(0, r * rh, S, r * rh);              // 皮缝
  for (let r = 0; r < rows; r++){
    const off = (r % 2) * (S / 10);
    for (let k = 0; k < 5; k++){
      const x = ((k * S / 5) + off) % S;
      line(x, r * rh + 3, x, (r + 1) * rh - 3);                            // 竖缝，逐皮错缝
    }
  }
  return t;
}

/* 沥青车行道。
   旧版为省一个 draw call，把琢石贴图按 C_ROAD 压暗当沥青用——但读者认的是
   「缝」不是「明度」：压暗之后那张 1.6 皮 × 5 竖缝的琢石图还在，桥面照旧读成
   一整片石板。全城 draw call 只用了 123（上限 200），单开一桶是划算的买卖。
   沥青的全部识别特征只有两条：细集料颗粒 + 大尺度的修补斑与轮迹，都在这里画。 */
function asphaltCanvas(P){
  const S = 256, c = cv(S, S), g = c.getContext('2d');
  const base = P.asphalt;
  const br = (base >> 16) & 255, bg = (base >> 8) & 255, bb = base & 255;
  const rnd = PC.rng(4471);
  const img = g.createImageData(S, S), d = img.data;
  /* 大尺度斑：几团低频噪声，给「补过的路面」那种不均匀 */
  const blobs = [];
  for (let i = 0; i < 14; i++) blobs.push([rnd() * S, rnd() * S, 26 + rnd() * 64, (rnd() - 0.5) * 16]);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
    let k = 0;
    for (const [bx, by, br2, amp] of blobs){
      /* 环绕距离，贴图接缝处不会出现一条突变的边 */
      let dx = Math.abs(x - bx); if (dx > S/2) dx = S - dx;
      let dy = Math.abs(y - by); if (dy > S/2) dy = S - dy;
      const t = 1 - Math.min(1, Math.hypot(dx, dy) / br2);
      k += amp * t * t;
    }
    const grain = (rnd() - 0.5) * 17;          // 细集料
    const i4 = (y * S + x) * 4;
    d[i4]   = clamp(br + k + grain, 0, 255);
    d[i4+1] = clamp(bg + k + grain, 0, 255);
    d[i4+2] = clamp(bb + k + grain * 0.9, 0, 255);
    d[i4+3] = 255;
  }
  g.putImageData(img, 0, 0);
  /* 亮集料颗粒：石子的反光点，没有它整片会像塑料布 */
  for (let i = 0; i < 900; i++){
    const x = rnd() * S, y = rnd() * S, r = 0.5 + rnd() * 0.9;
    g.fillStyle = 'rgba(198,196,190,' + (0.10 + rnd() * 0.22).toFixed(3) + ')';
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  return c;
}

/* 鬼脸浮雕带（新桥檐口的 mascaron）。高度场 → 颜色 + 法线 */
function mascaronCanvas(){
  const W = 512, Hh = 96;
  const c = cv(W, Hh), g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, W, Hh);
  /* 上下线脚 */
  g.fillStyle = '#c8c8c8'; g.fillRect(0, 4, W, 9); g.fillRect(0, Hh - 15, W, 10);
  g.fillStyle = '#5a5a5a'; g.fillRect(0, 13, W, 3); g.fillRect(0, Hh - 18, W, 3);
  /* 6 张脸，每张都不一样（新桥 381 个鬼脸没有两个相同） */
  for (let k = 0; k < 6; k++){
    const cx = (k + 0.5) * W / 6, cy = Hh * 0.53, r = 20;
    const rnd = (n) => ((Math.sin(k * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
    const gr = g.createRadialGradient(cx, cy, 2, cx, cy, r);
    gr.addColorStop(0, '#e8e8e8'); gr.addColorStop(0.62, '#b4b4b4'); gr.addColorStop(1, '#787878');
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(cx, cy, r * (0.78 + rnd(1) * 0.2), r * (0.94 + rnd(2) * 0.16), 0, 0, TAU); g.fill();
    /* 须发 */
    g.strokeStyle = '#9a9a9a'; g.lineWidth = 2.4;
    for (let i = 0; i < 9; i++){
      const a = -0.5 + i / 8 * (Math.PI + 1.0) + rnd(i) * 0.2;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7);
      g.lineTo(cx + Math.cos(a) * r * (1.10 + rnd(i + 3) * 0.28), cy + Math.sin(a) * r * (1.10 + rnd(i + 3) * 0.28));
      g.stroke();
    }
    /* 眼窝与嘴 */
    g.fillStyle = '#4e4e4e';
    g.beginPath(); g.ellipse(cx - 6.5, cy - 4, 3.2, 2.4, 0, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(cx + 6.5, cy - 4, 3.2, 2.4, 0, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(cx, cy + 8, 6.0, 3.0 + rnd(5) * 2, 0, 0, TAU); g.fill();
    g.fillStyle = '#d0d0d0';
    g.beginPath(); g.ellipse(cx, cy + 2, 2.4, 4.2, 0, 0, TAU); g.fill();   // 鼻
  }
  /* 高度场 → 法线 */
  const img = g.getImageData(0, 0, W, Hh), d = img.data;
  const hAt = (x, y) => d[((((y % Hh) + Hh) % Hh) * W + (((x % W) + W) % W)) * 4] / 255;
  const nC = cv(W, Hh), ng = nC.getContext('2d');
  const nImg = ng.createImageData(W, Hh), nd = nImg.data;
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++){
    const dx = hAt(x+1, y) - hAt(x-1, y), dy = hAt(x, y+1) - hAt(x, y-1);
    let nx = -dx * 5.0, ny = -dy * 5.0, nz = 1;
    const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
    const i = (y * W + x) * 4;
    nd[i] = (nx * .5 + .5) * 255; nd[i+1] = (ny * .5 + .5) * 255; nd[i+2] = (nz * .5 + .5) * 255; nd[i+3] = 255;
  }
  ng.putImageData(nImg, 0, 0);
  /* 颜色：把高度场压成石灰岩色调 */
  for (let i = 0; i < d.length; i += 4){
    const l = 0.55 + d[i] / 255 * 0.55;
    d[i]   = clamp(196 * l, 0, 255);
    d[i+1] = clamp(186 * l, 0, 255);
    d[i+2] = clamp(164 * l, 0, 255);
  }
  g.putImageData(img, 0, 0);
  return {color: c, normal: nC};
}

/* ══════════════ 2.5 风化：这一座桥「经历了什么」══════════════

   铁律：每一座桥都是有名字的真实构筑物。孔数、跨度、拱矢、桥面宽、雕像、
   栏杆形制、灯型、石材色族——全部由 bridges.json 定死，这一节一个都不碰。
   判据只有一条：**改的是「它是什么」还是「它经历了什么」？**
   前者不许，后者不但可以，而且不做才是错的——1607 年的新桥和 1999 年的
   桑戈尔人行桥泡在同一条河里，它们不该一样干净。

   这一节只做五件「经历」：水位痕、积垢、苔绿、锈、深浮雕藏污；外加砌块的微小色差
   （真实砌体每一块石头的产地批次都不同，明度天然差几个百分点）。
   ══════════════════════════════════════════════════════════════════ */

/* 当前正在建的这座桥的档案。build 是逐桥同步跑的，一个模块级变量就够，
   不必给十几个建模函数各多穿一层参数，也不产生任何每帧分配。 */
let PROF = null;

function bridgeProfile(b, plan, idx){
  /* ① 年代 —— 这是史实不是随机。0.62 次幂：石头头一百年脏得快，之后趋于饱和。
        新桥 1607 → ageK≈1.00；玛丽桥 1635 → 0.98；协和桥 1791 → 0.83；
        亚历山大三世 1900 → 0.62；图尔奈勒 1930 → 0.54；桑戈尔 1999 → 0.32。 */
  const yrs = clamp((2026 - (b.year || 1900)) / 420, 0, 1);
  let ageK = Math.pow(yrs, 0.62);
  /* ② 场域 —— 好街区的桥维护勤。用全城共用的那张 prestige 场，不另编一张。
        幅度只有 ±10%：维护改变的是保养程度，不是桥的年纪。 */
  const F = PC.vary.field(b.x, b.z);
  ageK = clamp(ageK * (1.10 - 0.20 * F.prestige), 0, 1);
  /* ③ 个体 —— 批次 = 桥序号，同一座桥内共享同一份档案（它就是一个批次）。
        长尾整形 k=2.4：约 63% 的桥落在前 1/3（背景），少数几座明显更旧。
        一条河上应该有一两座桥特别脏，其余是背景——均匀随机会让 24 座桥
        「每座都不一样」，那读起来还是噪声。 */
  const pr   = PC.vary.of('stone', b.x, b.z, idx);
  const tail = PC.vary.tail(pr.f(211), 2.4);
  ageK = clamp(ageK * (0.86 + 0.30 * tail), 0, 1);
  /* ④ 苔绿 —— 只长在石活与砌体桥墩上，钢桥的漆面基本不长；再叠一点个体差。
        个体那一档只给 ±28%：苔多苔少主要该由「多老、多潮、朝不朝北」决定，
        个体幅度一旦拉到几倍，1905 年的桥就可能比 1914 年的桥苔厚五倍，
        读出来是掷骰子不是规律（第一轮实测比尔阿凯姆 0.81 / 圣母桥 0.15 就是这么来的）。 */
  const stony = /stone|concrete|two-level/.test(b.kind || '');
  const mossK = clamp((stony ? 1 : 0.34) * (0.26 + 0.74 * ageK) * (0.72 + 0.56 * pr.f(233)), 0, 1);
  /* ⑤ 上游侧 —— seine.json 写明「中心线自上游（东）向下游（西），
        水流方向 = 数组正方向」，所以上游是 t 减小的那一头。
        桥的局部 +z 在世界里是 (−dz, dx)（见 build 里的 makeRotationY(angle)）。 */
  let upSign = 1;
  try {
    const d  = plan.river.dist(b.x, b.z);
    const a0 = plan.river.at(Math.max(0, d.t - 0.0015));
    const a1 = plan.river.at(Math.min(1, d.t + 0.0015));
    upSign = ((-b.dir[1]) * (a0.x - a1.x) + b.dir[0] * (a0.z - a1.z)) >= 0 ? 1 : -1;
  } catch(e){}
  return {ageK, mossK, upSign, halfW: Math.max(4, (b.deckW || 20) * 0.5)};
}

/* ── 逐片元风化 shader ────────────────────────────────────────────────
   为什么不走顶点色：桥墩立面从 −11.8 到 −7 之间只有四个角点，顶点色插出来
   的水位痕是一道 4m 高的柔和渐变，等于没有（base-neuf-pier.png 实拍，
   一条痕都读不出来）。水位痕的成败全在那条 30cm 的硬边上，只有片元做得到。
   代价：零 draw call、零三角，只是给已有的几个桶各多编译一份 shader。 */
function weather(mat, o){
  o = o || {};
  const g = v => (v === undefined ? 0 : v);
  const K = {
    key:  o.key || 'w',
    wl:   o.waterline === undefined ? 1   : o.waterline,  // 水位痕强度
    gr:   o.grime     === undefined ? 1   : o.grime,      // 积垢强度
    mo:   o.moss      === undefined ? 1   : o.moss,       // 苔绿强度
    ash:  g(o.ashlar),                                    // 砌块明度色差（峰峰值）
    au:   o.ashlarU   === undefined ? 8.0 : o.ashlarU,    // 砌块网格：竖缝数 / uv
    av:   o.ashlarV   === undefined ? 9.6 : o.ashlarV,    // 砌块网格：皮缝数 / uv
    ru:   g(o.rust),                                      // 锈蚀强度
    so:   g(o.soil),                                      // 深浮雕藏污（雕饰件专用）
    fa:   o.fade      === undefined ? 1   : o.fade,       // 年代色调（老桥更暗更灰）
    wu:   g(o.wearUp),                                    // 朝上面的踩磨/轮迹
    pt:   g(o.patch)                                      // 铺装补丁斑
  };
  const f = v => (+v).toFixed(4);
  let S = '{\n'
    + ' float ageK = vWx.x, mossK = vWx.y, upK = vWx.z;\n'
    + ' float wy = vWP.y;\n'
    + ' float dnF = max(0.0, -vWN.y);\n'                     // 朝下的面：拱腹、檐口底
    + ' float upF = max(0.0,  vWN.y);\n'                     // 朝上的面：桥面、压顶
    + ' float sdF = 1.0 - abs(vWN.y);\n'                     // 竖直面：拱肩墙、墩身
    + ' float noF = max(0.0,  vWN.z);\n'                     // 世界 +z = 正北 = 背阴面
    + ' float nz  = wF(vWP.xz * 0.42 + vWP.y * 0.27);\n';

  if (K.ash > 0){
    /* 砌块微色差：网格与琢石贴图的 6 皮 × 5 竖缝严格对齐（两者都挂在 uv 上），
       逐皮错缝。幅度是明度 ±ash/2 —— 做大了整面墙立刻成了马赛克。 */
    S += ' {\n'
      + '  float row = floor(vAsh.y * ' + f(K.av) + ');\n'
      + '  float col = floor(vAsh.x * ' + f(K.au) + ' + mod(row, 2.0) * 0.5);\n'
      + '  float b1 = wH(vec2(col, row) + 0.37), b2 = wH(vec2(col, row) + 41.7);\n'
      + '  diffuseColor.rgb *= 1.0 + ' + f(K.ash) + ' * (b1 - 0.5);\n'
      + '  diffuseColor.rgb *= mix(vec3(1.008, 0.998, 0.980), vec3(0.984, 0.997, 1.015), b2);\n'
      + ' }\n';
  }
  if (K.gr > 0){
    /* 积垢的排序是有物理依据的：拱腹（水汽 + 鸟粪）最脏，拱肩墙次之，
       栏杆最干净；上游面比下游面脏（漂浮物与浮沫都堆在迎水面）。
       全部由世界坐标 y 与法线朝向驱动，一个随机数都没有。 */
    S += ' float grm = (dnF * (0.42 + 0.58 * smoothstep(2.0, -5.5, wy))\n'
      + '            + sdF * smoothstep(1.4, -6.5, wy) * 0.52)\n'
      + '            * (0.52 + 0.80 * nz) * mix(0.78, 1.20, upK)\n'
      + '            * ' + f(K.gr) + ' * (0.30 + 0.90 * ageK);\n'
      + ' grm = clamp(grm, 0.0, 0.90);\n'
      + ' diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.40, 0.385, 0.35), grm * 0.62);\n'
      /* 竖向流痕：雨水从压顶与檐口滴下来，在墙面上冲出一条条深色的挂痕。
         哈希门槛 0.58 → 只有约 24% 的竖列出痕，其余是背景。全刷成一片才假。 */
      + ' {\n'
      + '  float hx = (abs(vWN.z) > abs(vWN.x)) ? vWP.x : vWP.z;\n'
      + '  float sk = wH(vec2(floor(hx * 1.45), 7.0));\n'
      + '  float run = sdF * smoothstep(0.58, 0.94, sk)\n'
      + '            * smoothstep(-0.4, -3.2, wy) * (1.0 - smoothstep(-5.2, -7.4, wy));\n'
      + '  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.60, 0.585, 0.55),\n'
      + '                         run * 0.46 * ' + f(K.gr) + ' * ageK);\n'
      + ' }\n';
  }
  if (K.so > 0){
    /* 深浮雕藏污 —— 只给雕饰件（新桥檐口那条鬼脸带、拱背花环）。
       上面那套积垢挂在世界坐标 y 上，对一整条同高度的浮雕带几乎不起作用：
       第一轮实拍（diag-neuf-nowater.png）里，1607 年的新桥全身都脏，
       唯独那条 381 个鬼脸的檐口带是一条崭新的米白丝带，一眼假。
       物理上正好相反——刻得越深越存得住灰，浮雕带该是全桥最黑的线脚之一。
       所以这一档不看高度只看年代：ageK 驱动，靠近上沿（被檐口挡着不淋雨）更重。 */
    S += ' diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.430, 0.412, 0.372),\n'
      + '                        clamp(ageK * ' + f(K.so) + '\n'
      + '                              * (0.62 + 0.38 * wF(vWP.xz * 0.85 + vWP.y * 1.3))\n'
      + '                              * mix(0.78, 1.0, vAsh.y), 0.0, 0.90));\n';
  }
  if (K.wl > 0){
    /* 水位痕 —— 所有石桥最真实的一个细节。常水位 −8.6，常年高水位线 −7.15。
       四层，少一层就不成立：
         ① 高水位线以下整段是「湿区」：石头长年吸水，比干区深一档、偏冷
         ② 上沿一条细的白垩水垢线（碳酸钙析出）——那条「线」全靠它立住，
            但只能是一条细线：做成一圈亮带，整座桥就成了浴缸的水垢圈
         ③ 常水位上下 ±0.8m 的藻带：绿黑，全桥最深的一条
         ④ 常年泡水段：更深更冷，几乎不反光
       上沿被水面波动磨得不齐，用世界 xz 的低频噪声抖 ±0.3m。
       一条用直尺画出来的水位线，一眼就是假的。 */
    S += ' float hiW  = -7.15 + (wF(vWP.xz * 0.55) - 0.5) * 0.62;\n'
      + ' float stan = smoothstep(hiW + 0.16, hiW - 0.60, wy);\n'
      /* 藻带必须骑在水面上：水面在 −8.6，全压到 −8.6 以下就被半透明的水刷掉了，
         等于白做。真实的藻线也正是长在「时干时湿」那一段，不是长在水里。 */
      + ' float algy = smoothstep(-7.50, -8.15, wy) * (1.0 - smoothstep(-8.75, -9.60, wy));\n'
      + ' float sunk = smoothstep(-8.90, -10.3, wy);\n'
      + ' float rim  = smoothstep(hiW + 0.20, hiW + 0.04, wy) - smoothstep(hiW + 0.04, hiW - 0.12, wy);\n'
      + ' float wI   = ' + f(K.wl) + ' * (0.44 + 0.56 * ageK);\n'
      + ' diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.60, 0.615, 0.585), stan * 0.74 * wI);\n'
      + ' diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.430, 0.412, 0.360), clamp(rim, 0.0, 1.0) * 0.15 * wI);\n'
      + ' diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.052, 0.082, 0.050), algy * (0.62 + 0.30 * nz) * wI);\n'
      + ' diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.030, 0.050, 0.046), sunk * 0.72 * wI);\n'
      + ' gWet = clamp(stan * 0.45 + algy * 0.35 + sunk, 0.0, 1.0);\n';
  }
  if (K.mo > 0){
    /* 苔绿只长在潮湿背阴处：拱脚、桥墩水线上方、朝北的面。
       门槛 0.42 → 成片而不是一层薄雾，苔本来就是一块一块长的。 */
    S += ' {\n'
      + '  float damp = smoothstep(-2.4, -6.6, wy) * (1.0 - clamp(gWet, 0.0, 1.0));\n'
      + '  float mo = mossK * damp * (0.28 + 0.72 * noF)\n'
      + '           * smoothstep(0.42, 0.86, wF(vWP.xz * 1.05 + 5.3));\n'
      + '  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.232, 0.278, 0.158),\n'
      + '                         clamp(mo, 0.0, 1.0) * 0.44 * ' + f(K.mo) + ');\n'
      + ' }\n';
  }
  if (K.ru > 0){
    /* 铁件的锈：先从螺栓/接缝渗出来，再沿重力方向拖出一条铁红的流痕。
       只有约 30% 的竖列起锈，且越靠近水汽越重——整座桥一起锈是漆没了，
       不是风化，那已经不是「它经历了什么」而是换了一座桥。 */
    S += ' {\n'
      + '  float hx = (abs(vWN.z) > abs(vWN.x)) ? vWP.x : vWP.z;\n'
      + '  float rk = wH(vec2(floor(hx * 0.85), 19.0));\n'
      + '  float rs = smoothstep(0.62, 0.97, rk) * (0.35 + 0.65 * smoothstep(3.0, -6.0, wy))\n'
      + '           * (0.45 + 0.55 * wF(vWP.xz * 0.9 + vWP.y * 0.6))\n'
      + '           * ' + f(K.ru) + ' * ageK;\n'
      + '  rs = clamp(rs, 0.0, 0.75);\n'
      + '  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.255, 0.118, 0.055), rs * 0.62);\n'
      + '  gRst = rs;\n'
      + ' }\n';
  }
  if (K.wu > 0){
    /* 朝上的面被踩/被压得发亮：人行道压顶、栏杆扶手、桥面。老桥磨得更狠 */
    S += ' diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.13, 1.12, 1.09),\n'
      + '                        upF * ageK * ' + f(K.wu) + ' * smoothstep(0.30, 0.80, wF(vWP.xz * 0.55)));\n';
  }
  if (K.pt > 0){
    /* 铺装补丁：沥青补过的那几块永远和原路面对不上色，这是路面唯一的识别特征 */
    S += ' diffuseColor.rgb *= mix(0.86, 1.12, smoothstep(0.32, 0.74, wF(vWP.xz * 0.062))) * ' + f(K.pt) + '\n'
      + '                     + (1.0 - ' + f(K.pt) + ');\n';
  }
  if (K.fa > 0){
    /* 年代色调：老桥整体更暗更灰。这不是随机，这是 400 年的煤烟与车流 */
    S += ' diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.885, 0.880, 0.862),\n'
      + '                        ageK * 0.34 * ' + f(K.fa) + ');\n';
  }
  S += '}\n';

  const ROUGH = 'roughnessFactor = clamp(roughnessFactor + 0.10 * vWx.x - 0.32 * gWet + 0.18 * gRst, 0.04, 1.0);\n';
  const METAL = 'metalnessFactor *= 1.0 - 0.62 * gRst;\n';

  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = sh => {
    if (prev) prev(sh);
    sh.vertexShader =
      'attribute vec3 aWx;\nvarying vec3 vWx;\nvarying vec3 vWP;\nvarying vec3 vWN;\nvarying vec2 vAsh;\n'
      + sh.vertexShader.replace('#include <begin_vertex>',
          '#include <begin_vertex>\n'
        + ' vWx = aWx;\n vAsh = uv;\n'
        + ' vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\n'
        + ' vWN = normalize(mat3(modelMatrix) * normal);\n');
    sh.fragmentShader =
      'varying vec3 vWx;\nvarying vec3 vWP;\nvarying vec3 vWN;\nvarying vec2 vAsh;\n'
      + 'float gWet;\nfloat gRst;\n'
      + 'float wH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n'
      + 'float wF(vec2 p){ vec2 i = floor(p), t = p - i; t = t * t * (3.0 - 2.0 * t);\n'
      + '  return mix(mix(wH(i), wH(i + vec2(1.0, 0.0)), t.x),\n'
      + '             mix(wH(i + vec2(0.0, 1.0)), wH(i + vec2(1.0, 1.0)), t.x), t.y); }\n'
      + sh.fragmentShader
          .replace('#include <color_fragment>', '#include <color_fragment>\n gWet = 0.0; gRst = 0.0;\n' + S)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + ROUGH)
          .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + METAL);
  };
  mat.customProgramCacheKey = () => 'bwx_' + K.key;
  mat.needsUpdate = true;
  return mat;
}

/* ══════════════ 3. 材质（10 个桶 = 10 个 draw call） ══════════════ */

let MAT = null, ROOT = null, GLOW = null;

/* 灯笼白天/夜里的自发光强度。白天不是 0：留一点点余温，玻璃才不是死黑板 */
const GLOW_DAY = 0.006, GLOW_NIGHT = 2.6;

function buildMats(P){
  const SC = h => new THREE.Color(h).convertSRGBToLinear();
  const st = ashlarCanvas();
  const T = (canvas, rep, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb && THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
    if (rep) t.repeat.set(rep[0], rep[1]);
    return t;
  };
  const ms = mascaronCanvas();
  const oak = makeOak ? makeOak(256, 5511) : null;

  /* 派生色：全部从 palette 出发 */
  const steelC  = mixHex(P.ironDk, P.zincLt, 0.46);        // 桥梁钢：比锻铁浅、带锌灰
  const bronzeC = mixHex(P.parisGreen, P.ironDk, 0.42);    // 青铜带铜绿
  const woodC   = mixHex(P.chimney, P.limestoneDk, 0.42);  // 艺术桥木铺装
  const lampC   = mixHex(P.ironDk, P.zincLt, 0.22);        // 灯柱：上过漆的铸铁，比桥梁钢暗
  const glassC  = mixHex(P.ironDk, P.slate, 0.55);         // 灯笼玻璃：白天是块冷调暗玻璃
  /* 亚历山大三世桥的拱是「漆过的钢」不是「裸金属」——1998 年大修恢复的原色是
     珍珠灰（gris perle）。用 iron 那种 metalness .72 的暗金属去做，它整天在
     反天空，远看就是一片会透光的灰蓝镜片，读不出是结构件。 */
  const pearlC  = mixHex(P.limestoneDk, P.slate, 0.62);

  MAT = {
    stone: new THREE.MeshStandardMaterial({
      map: T(st.color, [1.6,1.6], true), normalMap: T(st.normal, [1.6,1.6]), roughnessMap: T(st.rough, [1.6,1.6]),
      normalScale: new THREE.Vector2(0.5, 0.5),
      color: 0xffffff, roughness: 0.96, metalness: 0, envMapIntensity: 0.78, vertexColors: true
    }),
    iron: new THREE.MeshStandardMaterial({
      color: SC(steelC), roughness: 0.52, metalness: 0.72, envMapIntensity: 0.95, vertexColors: true
    }),
    /* 灯柱单开一桶（+1 draw call）。原因：桥梁钢是 metalness .72 的裸金属，
       灯罩那两块斜面正对太阳时会打出一块死白的高光（第一轮截图实拍到）。
       灯柱在现实里是「上过漆的铸铁」——低金属度、粗糙，本来就不该有镜面。 */
    lampIron: new THREE.MeshStandardMaterial({
      color: SC(lampC), roughness: 0.78, metalness: 0.14, envMapIntensity: 0.38, vertexColors: true
    }),
    steel: new THREE.MeshStandardMaterial({
      color: SC(pearlC), roughness: 0.56, metalness: 0.18, envMapIntensity: 0.70, vertexColors: true
    }),
    /* 沥青车行道单开一桶（+1 draw call）。理由见 asphaltCanvas 的注释 */
    asphalt: new THREE.MeshStandardMaterial({
      map: T(asphaltCanvas(P), [1, 1], true),
      color: 0xffffff, roughness: 0.93, metalness: 0, envMapIntensity: 0.30, vertexColors: true
    }),
    bronze: new THREE.MeshStandardMaterial({
      color: SC(bronzeC), roughness: 0.46, metalness: 0.78, envMapIntensity: 0.9, vertexColors: true
    }),
    /* 鎏金：metalness 从 .96 降到 .62、emissive 从 .45 降到 .30。
       接近纯金属时颜色几乎全来自环境反射——正对相机的那些面反的是地面，
       整只飞马会变成褐色；而 emissive 拉满又把亮暗一起抬平，成一块没有
       起伏的黄色。留一半漫反射，金色才在明暗里立得住 */
    gilt: new THREE.MeshStandardMaterial({
      color: SC(P.gilt), roughness: 0.40, metalness: 0.42, envMapIntensity: 0.85,
      emissive: SC(0x2a1c05), emissiveIntensity: 0.30, vertexColors: true
    }),
    wood: new THREE.MeshStandardMaterial({
      map: oak ? T(oak, [3,3], true) : null, color: oak ? 0xffffff : SC(woodC),
      roughness: 0.88, metalness: 0, envMapIntensity: 0.35, vertexColors: true
    }),
    frieze: new THREE.MeshStandardMaterial({
      map: T(ms.color, [1,1], true), normalMap: T(ms.normal, [1,1]),
      normalScale: new THREE.Vector2(1.6, 1.6),
      color: 0xffffff, roughness: 0.95, metalness: 0, envMapIntensity: 0.5, vertexColors: true
    }),
    /* 灯笼玻璃。emissiveIntensity 的初值必须是白天值：update() 每帧会按时刻改写它，
       但第一帧之前（以及任何不驱动 update 的宿主里）用的就是这个初值——旧的 0.9
       会把白天的灯笼整块糊成暖棕色方块 */
    glow: new THREE.MeshStandardMaterial({
      color: SC(glassC), roughness: 0.26, metalness: 0.05, envMapIntensity: 0.85,
      emissive: SC(0xffcf92), emissiveIntensity: GLOW_DAY, vertexColors: true
    })
  };
  /* 风化注入。各桶的参数差别就是「这类材料会经历什么」：
     石活会长苔会积垢会留水位痕；漆过的铁会锈但不长苔；
     亚历山大三世的珍珠灰钢是 1998 年整体大修恢复的原色（本文件上面已注明），
     所以它只带很轻的积垢、几乎不锈——这是史实，不是我给它开后门。
     鎏金（MAT.gilt）与灯笼玻璃（MAT.glow）一律不碰：飞马必须一眼是金的。 */
  weather(MAT.stone,    {key:'stone', waterline:1.00, grime:1.00, moss:1.00, ashlar:0.115, rust:0,    fade:1.00, wearUp:0.30});
  weather(MAT.frieze,   {key:'frieze',waterline:0,    grime:1.00, moss:0.35, ashlar:0,     rust:0,    fade:1.00, soil:1.05});
  /* 铁栏杆的扶手被手摸、被靠、被撞：朝上的面磨出金属亮边。老桥磨得更狠 */
  weather(MAT.iron,     {key:'iron',  waterline:0.55, grime:0.70, moss:0.20, ashlar:0,     rust:0.85, fade:1.00, wearUp:0.26});
  weather(MAT.lampIron, {key:'lamp',  waterline:0,    grime:0.45, moss:0,    ashlar:0,     rust:0.35, fade:0.80, wearUp:0.18});
  weather(MAT.steel,    {key:'steel', waterline:0.35, grime:0.42, moss:0.10, ashlar:0,     rust:0.16, fade:0.45});
  weather(MAT.asphalt,  {key:'asph',  waterline:0,    grime:0.25, moss:0,    ashlar:0,     rust:0,    fade:0.55, wearUp:0.22, patch:0.85});
  GLOW = MAT.glow;
  return MAT;
}

/* 顶点着色：只剩「越靠下越暗」这一档近似 AO。全部石活共用。
   水位痕从这里搬去片元了（见 weather()）：桥墩立面从 −11.8 到 −7 之间只有
   四个角点，顶点色插出来是一道 4m 高的柔和渐变，base-neuf-pier.png 实拍
   一条痕都读不出来。水位痕的成败全在那条 30cm 的硬边上。 */
function stoneTint(x, y, z){
  const k = 1 - clamp((0.6 - y) / 34, 0, 1) * 0.12;
  return [k, k, k];
}
const C_IRON_DK = [0.44, 0.46, 0.45]; // 铸铁件（路灯/栏杆）比桥梁钢暗
const C_PLAIN = [1, 1, 1];

/* ══════════════ 4. 沿轴线求河道断面 ══════════════ */

function sampleWater(plan, ox, oz, dx, dz, sA, sB, step){
  const out = []; let cur = null;
  for (let s = sA; s <= sB; s += step){
    const wet = plan.river.inWater(ox + dx * s, oz + dz * s);
    if (wet){ if (!cur) cur = [s, s]; else cur[1] = s; }
    else if (cur){ out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.filter(sp => sp[1] - sp[0] > 4);
}

/* 从桥心往两头走，走到「真正的对岸」为止（连续 26m 干地）。
   固定窗口不行：叙利桥的南汊起点在 −231m，落在任何按 lengthM 定的窗口之外；
   而窗口一旦放大到 400m，塞纳河转弯处又会把下一段河面也扫进来。 */
function crossRange(plan, b){
  const [dx, dz] = b.dir;
  const maxSp = b.crosses === 'both-arms' ? 2 : 1;
  const ext = [0, 0];
  for (let i = 0; i < 2; i++){
    const sign = i ? 1 : -1;
    let dry = 0, last = 0, found = 0, saw = false;
    for (let s = 0; s <= 430; s += 0.75){
      if (plan.river.inWater(b.x + dx * sign * s, b.z + dz * sign * s)){ dry = 0; last = s; saw = true; }
      else {
        dry += 0.75;
        if (dry > 26){
          if (saw){ found++; saw = false; if (found >= maxSp) break; }
          else if (s > 120) break;
        }
      }
    }
    ext[i] = Math.max(25, last + 20);
  }
  return [-ext[0], ext[1]];
}

/* ══════════════ 5. 拱曲线 ══════════════ */
/* circular=true → 圆弧扁拱（钢拱/近代扁拱）；否则椭圆拱（法式 anse de panier）。
   把扁拱做成半圆拱是这类模型最常见的错，所以这里由 riseRatio 严格决定形状。 */
function archCurve(x0, x1, ySpring, rise, seg, circular){
  const span = x1 - x0, xm = (x0 + x1) / 2, a = span / 2, pts = [];
  const R = circular ? (a * a + rise * rise) / (2 * rise) : 0;
  for (let i = 0; i <= seg; i++){
    const x = x0 + span * i / seg, u = (x - xm) / a;
    const y = circular
      ? ySpring + Math.sqrt(Math.max(0, R * R - (u * a) * (u * a))) - (R - rise)
      : ySpring + rise * Math.sqrt(Math.max(0, 1 - u * u));
    pts.push([x, y]);
  }
  return pts;
}

/* ══════════════ 6. 参数化桥族 ══════════════ */

/* 断面：檐口 + 女儿墙/栏杆座 + 人行道 + 车行道。左→右，法线自动朝外 */
function deckProfile(W, parapet, sw){
  const h = W / 2, ov = 0.52;
  const p = [];
  p.push([-h + 0.10, -1.05]);              // 檐口底（封住外挑下面）
  p.push([-h - ov,   -0.72]);              // 檐口滴水斜面
  p.push([-h - 0.26, -0.16]);
  if (parapet === 'solid'){
    p.push([-h - 0.34,  1.16]);
    p.push([-h + 0.22,  1.16]);
    p.push([-h + 0.22,  0.12]);
  } else if (parapet === 'balustrade'){
    p.push([-h - 0.26,  0.30]);            // 栏杆座（栏杆柱另建）
    p.push([-h + 0.28,  0.30]);
    p.push([-h + 0.28,  0.12]);
  } else {                                  // iron-rail：檐口上直接是人行道
    p.push([-h - 0.26,  0.12]);
  }
  p.push([-h + sw,  0.12]);
  p.push([-h + sw, -0.10]);
  p.push([ h - sw, -0.10]);                 // 车行道
  p.push([ h - sw,  0.12]);
  if (parapet === 'solid'){
    p.push([ h - 0.22,  0.12]);
    p.push([ h - 0.22,  1.16]);
    p.push([ h + 0.34,  1.16]);
  } else if (parapet === 'balustrade'){
    p.push([ h - 0.28,  0.12]);
    p.push([ h - 0.28,  0.30]);
    p.push([ h + 0.26,  0.30]);
  } else {
    p.push([ h + 0.26,  0.12]);
  }
  p.push([ h + 0.26, -0.16]);
  p.push([ h + ov,   -0.72]);
  p.push([ h - 0.10, -1.05]);
  return p;
}
/* 车行道在断面里的段号（用来涂沥青色） */
function roadSegIndex(prof, W, sw){
  const h = W / 2;
  for (let j = 0; j < prof.length - 1; j++)
    if (Math.abs(prof[j][0] - (-h + sw)) < 1e-6 && Math.abs(prof[j+1][0] - (h - sw)) < 1e-6) return j;
  return -1;
}

/* 分水尖（上下游各一）。pointed=尖头（17 世纪以前），否则半圆 */
function cutwater(gb, xm, pw, zEdge, side, yLo, yHi, nose, pointed){
  const z = zEdge * side, sgn = side;
  const pts = [];
  if (pointed){
    pts.push([xm - pw / 2, z], [xm + pw / 2, z], [xm, z + nose * sgn]);
  } else {
    const n = 5;
    for (let i = 0; i <= n; i++){
      const a = Math.PI * i / n;
      pts.push([xm - Math.cos(a) * pw / 2, z + Math.sin(a) * nose * sgn]);
    }
  }
  gb.prism(pts, 1, yLo, yHi, 0.25);
  /* 尖顶斜帽。绕序按 (x,z) 的有向面积定——照写会有一半的帽子法线朝下，翻黑 */
  let ar = 0;
  for (let i = 0; i < pts.length; i++){
    const a = pts[i], b = pts[(i+1) % pts.length];
    ar += a[0] * b[1] - b[0] * a[1];
  }
  const flip = ar > 0;
  const apex = [xm, yHi + (pointed ? 1.5 : 1.15), z + nose * sgn * (pointed ? 0.35 : 0.42)];
  for (let i = 0; i < pts.length - 1; i++){
    const a = pts[i], b = pts[i+1];
    const A = [a[0], yHi, a[1]], B = [b[0], yHi, b[1]];
    gb.face(flip ? B : A, flip ? A : B, apex, null, 0.25);
  }
}

/* 拱石环（archivolt）：贴在两侧立面上、外凸的一圈。
   UV 让 v 沿弧长走，石材贴图的皮缝就变成径向的拱石缝 */
function archivolt(gb, arc, zHalf, depth, ring){
  for (const side of [-1, 1]){
    const z0 = zHalf * side, z1 = (zHalf + depth) * side;
    let acc = 0;
    for (let i = 0; i < arc.length - 1; i++){
      const a = arc[i], b = arc[i+1];
      const ex = b[0]-a[0], ey = b[1]-a[1], L = Math.hypot(ex, ey) || 1;
      const nx = -ey/L, ny = ex/L;                 // 径向外法线（拱腹朝下时指向拱背）
      const s = ny >= 0 ? 1 : -1;
      const a1 = [a[0] + nx*ring*s, a[1] + ny*ring*s], b1 = [b[0] + nx*ring*s, b[1] + ny*ring*s];
      const uv = 0.155;
      /* 正面 */
      const f0 = gb.v(a[0], a[1], z1, 0,0,side, 0, acc*uv);
      const f1 = gb.v(b[0], b[1], z1, 0,0,side, 0, (acc+L)*uv);
      const f2 = gb.v(b1[0], b1[1], z1, 0,0,side, ring*uv, (acc+L)*uv);
      const f3 = gb.v(a1[0], a1[1], z1, 0,0,side, ring*uv, acc*uv);
      if (side > 0) gb.quad(f0, f1, f2, f3); else gb.quad(f3, f2, f1, f0);
      /* 外缘 */
      const e0 = gb.v(a1[0], a1[1], z0, nx*s, ny*s, 0, 0, acc*uv);
      const e1 = gb.v(b1[0], b1[1], z0, nx*s, ny*s, 0, 0, (acc+L)*uv);
      const e2 = gb.v(b1[0], b1[1], z1, nx*s, ny*s, 0, depth*uv, (acc+L)*uv);
      const e3 = gb.v(a1[0], a1[1], z1, nx*s, ny*s, 0, depth*uv, acc*uv);
      if (side > 0) gb.quad(e0, e1, e2, e3); else gb.quad(e3, e2, e1, e0);
      acc += L;
    }
  }
}

/* 轴对齐方锥台。为什么不直接用 cyl(seg=4)：cyl 的顶点固定落在 0°/90°/180°/270°，
   四棱柱迎面永远是一条棱，站在桥面上看就成了一根方尖碑。这个版本把四个面正对
   桥轴与桥宽，柱础和灯笼才读得出「铸铁件」而不是「黑色石碑」。
   8 tri（cap=true 时 10）。half0/half1 是底/顶的半边长，不是外接圆半径 */
function frustum(gb, cx, y0, cz, half0, half1, h, s, cap){
  const y1 = y0 + h;
  /* 从上往下看取顺时针，法线才朝外（face 按 u×v 定法线，不会替你纠正） */
  const A = [[-1,-1], [-1,1], [1,1], [1,-1]];
  for (let i = 0; i < 4; i++){
    const a = A[i], b = A[(i + 1) % 4];
    gb.face([cx + a[0]*half0, y0, cz + a[1]*half0],
            [cx + b[0]*half0, y0, cz + b[1]*half0],
            [cx + b[0]*half1, y1, cz + b[1]*half1],
            [cx + a[0]*half1, y1, cz + a[1]*half1], s);
  }
  if (cap && half1 > 0.004){
    gb.face([cx - half1, y1, cz + half1], [cx + half1, y1, cz + half1],
            [cx + half1, y1, cz - half1], [cx - half1, y1, cz - half1], s);
  }
}

/* 灯笼头：灯座裙 + 四面玻璃 + 攒尖灯罩 + 顶尖。y 是灯座裙底面的高度。
   总高 1.20s；玻璃 0.33s 见方 × 0.54s 高（在「0.6m 立方以内」这条线内）。
   灯罩下沿 0.200 出檐压住玻璃 0.165——这一圈檐口是「这是一盏灯不是一个方块」的
   全部依据，省掉它，不管远近都会退回成一坨。34 tri（其中 8 tri 进 glow 桶） */
function lanternHead(gb, gGlow, x, y, z, s, rNeck){
  frustum(gb,    x, y,            z, rNeck,     0.176 * s, 0.24 * s, 0.5, false);  // 灯座裙
  frustum(gGlow, x, y + 0.24 * s, z, 0.165 * s, 0.150 * s, 0.54 * s, 0.5, false);  // 四面玻璃
  frustum(gb,    x, y + 0.78 * s, z, 0.200 * s, 0.034 * s, 0.27 * s, 0.5, true);   // 攒尖灯罩
  frustum(gb,    x, y + 1.05 * s, z, 0.044 * s, 0.011 * s, 0.15 * s, 0.5, false);  // 顶尖
}

/* 铸铁路灯（巴黎桥上的标准型 candélabre）：柱础 + 座盘线脚 + 八棱柱身 + 灯笼头。
   总高 4.51m —— 街面上第二可靠的尺度锚点。参照物是 deckProfile 里 1.04m 高的实心
   女儿墙，比值 4.3。路灯本来就该比栏杆高出三个人头，这个比例是对的，不是失真。
   柱身收分 Ø0.216→Ø0.140，旧版是 Ø0.36 的四棱柱，粗一倍且迎面是棱，所以读成方尖碑。
   68 tri/根（旧版 24）。多出来的全花在人眼真能读到的三处：八棱柱身、柱脚线脚
   （柱子是「立」在桥面上不是「插」进去的）、灯笼檐口 */
function lamp(gb, gGlow, x, z, y, scale){
  const s = scale || 1;
  frustum(gb, x, y,            z, 0.250 * s, 0.192 * s, 0.32 * s, 0.5, false);  // 柱础
  frustum(gb, x, y + 0.32 * s, z, 0.196 * s, 0.150 * s, 0.15 * s, 0.5, true);   // 座盘线脚
  gb.cyl(x, y + 1.89 * s, z, 0.108 * s, 0.070 * s, 2.88 * s, 8, 0.5, false);    // 八棱柱身
  lanternHead(gb, gGlow, x, y + 3.31 * s, z, s, 0.078 * s);
}

/* 铁栏杆：立柱 + 上下横杆 */
function ironRail(gb, stations, z, yTop, hRail, pitch){
  for (let i = 0; i < stations.length - 1; i++){
    const A = stations[i], B = stations[i+1];
    const L = B[0] - A[0];
    const n = Math.max(1, Math.round(L / pitch));
    for (let k = 0; k < n; k++){
      const t = k / n, x = A[0] + L * t, y = A[1] + (B[1] - A[1]) * t;
      gb.cyl(x, y + yTop + hRail / 2, z, 0.075, 0.055, hRail, 4, 0.5, false);
    }
  }
  /* 横杆：上下两条 */
  for (const hy of [hRail * 0.97, 0.08]){
    for (let i = 0; i < stations.length - 1; i++){
      const A = stations[i], B = stations[i+1];
      gb.box((A[0]+B[0])/2, (A[1]+B[1])/2 + yTop + hy, z,
             Math.abs(B[0]-A[0]) + 0.02, hy > 0.1 ? 0.11 : 0.14, 0.11, 0.5);
    }
  }
}

/* 石栏杆的宝瓶柱 */
function balusters(gb, stations, z, yBase, pitch){
  for (let i = 0; i < stations.length - 1; i++){
    const A = stations[i], B = stations[i+1];
    const L = B[0] - A[0], n = Math.max(1, Math.round(L / pitch));
    for (let k = 0; k < n; k++){
      const t = (k + 0.5) / n, x = A[0] + L * t, y = A[1] + (B[1]-A[1]) * t + yBase;
      gb.cyl(x, y + 0.34, z, 0.16, 0.09, 0.68, 4, 0.4, false);
    }
  }
  /* 压顶扶手 */
  for (let i = 0; i < stations.length - 1; i++){
    const A = stations[i], B = stations[i+1];
    gb.box((A[0]+B[0])/2, (A[1]+B[1])/2 + yBase + 0.80, z, Math.abs(B[0]-A[0]) + 0.02, 0.24, 0.72, 0.4);
  }
}

/* ══════════════ 7. 一段桥（一条轴线上的一跨群） ══════════════
   sg = {ox,oz,dx,dz, sA,sB, arcs:[{x0,x1,ySpring,rise,circular}],
         yA,yB, deckW, parapet, kind, lampPitch, pointedNose, frieze} */

function buildSegment(sg, G, b){
  const {sA, sB, deckW, parapet} = sg;
  const h = deckW / 2, bodyH = h - 0.14;
  const len = sB - sA;
  const camb = clamp(len * 0.008, 0.25, 1.5) * (sg.camber === undefined ? 1 : sg.camber);
  const deckY = (x) => {
    const u = clamp((x - sA) / Math.max(1, len), 0, 1);
    return sg.yA + (sg.yB - sg.yA) * u + camb * Math.sin(Math.PI * u);
  };
  const bodyTop = (x) => deckY(x) - 1.05;

  const nSt = clamp(Math.round(len / 24), 4, 10);
  const stations = [];
  for (let i = 0; i <= nSt; i++){ const x = sA + len * i / nSt; stations.push([x, deckY(x)]); }

  /* ── 7.1 桥身立面 ───────────────────────────────────────────── */
  if (sg.kind !== 'girder'){
    const top = [], bot = [];
    for (const st of stations) top.push([st[0], bodyTop(st[0])]);

    const arcs = sg.arcs;
    const deepA = arcs.length ? arcs[0].x0 - sg.abut : sA;
    const deepB = arcs.length ? arcs[arcs.length-1].x1 + sg.abut : sB;
    const yLand = -2.4;
    bot.push([sA, yLand]);
    if (arcs.length){
      bot.push([deepA, yLand], [deepA, Y_BASE]);
      for (const a of arcs){
        bot.push([a.x0, Y_BASE], [a.x0, a.ySpring]);
        const arc = archCurve(a.x0, a.x1, a.ySpring, a.rise, a.seg, a.circular);
        for (const p of arc) bot.push(p);
        bot.push([a.x1, a.ySpring], [a.x1, Y_BASE]);
      }
      bot.push([deepB, Y_BASE], [deepB, yLand]);
    }
    bot.push([sB, yLand]);

    const poly = [];
    poly.push([sA, yLand], [sA, bodyTop(sA)]);
    for (const p of top) poly.push(p);
    poly.push([sB, bodyTop(sB)], [sB, yLand]);
    for (let i = bot.length - 1; i >= 0; i--) poly.push(bot[i]);
    /* 去掉相邻重复点 */
    const clean = [];
    for (const p of poly){
      const q = clean[clean.length-1];
      if (!q || Math.hypot(p[0]-q[0], p[1]-q[1]) > 1e-4) clean.push(p);
    }
    const bodyGB = sg.kind === 'steel' ? G.iron : G.stone;
    const i0 = bodyGB.n;
    prismXY(bodyGB, clean, -bodyH, bodyH, 0.25);
    paintRange(bodyGB, i0, bodyGB.n, stoneTint);

    /* 拱石环 */
    if (sg.kind !== 'steel' && !sg.steelRings){
      for (const a of arcs){
        const arc = archCurve(a.x0, a.x1, a.ySpring, a.rise, Math.max(8, a.seg), a.circular);
        const j0 = G.stone.n;
        archivolt(G.stone, arc, bodyH, 0.34, 0.95);
        paintRange(G.stone, j0, G.stone.n, stoneTint);
      }
    } else {
      /* 钢拱：外露拱肋 + 敞肩立柱 */
      for (const a of arcs){
        const arc = archCurve(a.x0, a.x1, a.ySpring, a.rise, Math.max(10, a.seg), true);
        const j0 = G.iron.n;
        archivolt(G.iron, arc, bodyH, 0.45, 0.95);
        paintRange(G.iron, j0, G.iron.n, () => C_PLAIN);
      }
    }

    /* 桥墩分水尖 */
    for (let i = 0; i < arcs.length - 1; i++){
      const xm = (arcs[i].x1 + arcs[i+1].x0) / 2, pw = arcs[i+1].x0 - arcs[i].x1;
      if (pw < 1.2) continue;
      const yHi = Math.min(arcs[i].ySpring, arcs[i+1].ySpring) + 0.9;
      for (const side of [-1, 1]){
        const k0 = G.stone.n;
        cutwater(G.stone, xm, pw * 0.96, bodyH, side, Y_BASE, yHi, pw * 0.85, sg.pointedNose);
        paintRange(G.stone, k0, G.stone.n, stoneTint);
      }
    }
  } else {
    /* 钢箱梁：无拱，一道梁 + 河中支墩 */
    const gy0 = deckY(sA) - 2.5;      /* 梁底 ≥ 水面 +6.2m，苍蝇船过得去 */
    const gb = G.iron; const i0 = gb.n;
    for (let i = 0; i < stations.length - 1; i++){
      const A = stations[i], B = stations[i+1];
      gb.box((A[0]+B[0])/2, (A[1]+B[1])/2 - 1.60, 0, B[0]-A[0] + 0.02, 1.5, deckW - 1.4, 0.3);
    }
    paintRange(gb, i0, gb.n, () => C_PLAIN);
    for (let i = 0; i < sg.arcs.length - 1; i++){
      const xm = (sg.arcs[i].x1 + sg.arcs[i+1].x0) / 2;
      const k0 = G.stone.n;
      G.stone.box(xm, (Y_BASE + gy0) / 2, 0, 5.0, gy0 - Y_BASE, deckW - 3.0, 0.25);
      for (const side of [-1, 1]) cutwater(G.stone, xm, 4.6, (deckW-3.0)/2, side, Y_BASE, gy0 - 0.4, 3.4, false);
      paintRange(G.stone, k0, G.stone.n, stoneTint);
    }
    /* 两端桥台 */
    for (const [xa, xb] of [[sA, sA + sg.abut], [sB - sg.abut, sB]]){
      const k0 = G.stone.n;
      G.stone.box((xa+xb)/2, (Y_BASE + gy0) / 2, 0, xb - xa, gy0 - Y_BASE, deckW - 0.4, 0.25);
      paintRange(G.stone, k0, G.stone.n, stoneTint);
    }
  }

  /* ── 7.2 桥面/檐口/女儿墙 ─────────────────────────────────── */
  const sw = clamp(deckW * 0.16, 1.6, 4.6);
  const prof = deckProfile(deckW, parapet, sw);
  const rIdx = roadSegIndex(prof, deckW, sw);
  const deckGB = sg.deckWood ? G.wood : G.stone;
  /* 车行道分流到沥青桶（艺术桥的木铺装除外，它整条桥面就是木的） */
  const roadGB = sg.deckWood ? deckGB : G.asphalt;
  const d0 = deckGB.n, a0 = G.asphalt.n;
  ribbon((j) => (j === rIdx ? roadGB : deckGB), stations, prof, 0.25,
         (j) => (j === rIdx ? C_PLAIN : null));
  paintRange(G.asphalt, a0, G.asphalt.n, () => C_PLAIN);
  if (!sg.deckWood){
    /* 先按水位痕涂一遍，再把车行道压暗（顺序不能反） */
    for (let i = d0; i < deckGB.n; i++){
      if (deckGB.C[i*3] === undefined){
        const c = stoneTint(deckGB.P[i*3], deckGB.P[i*3+1], deckGB.P[i*3+2]);
        deckGB.C[i*3] = c[0]; deckGB.C[i*3+1] = c[1]; deckGB.C[i*3+2] = c[2];
      }
    }
  }

  /* 栏杆 */
  if (parapet === 'iron-rail'){
    const k0 = G.iron.n;
    const rp = Math.max(4.2, len / 55);
    for (const side of [-1, 1]) ironRail(G.iron, stations, side * (h - 0.16), 0.12, 1.12, rp);
    paintRange(G.iron, k0, G.iron.n, () => C_IRON_DK);
  } else if (parapet === 'balustrade'){
    const k0 = G.stone.n;
    for (const side of [-1, 1]) balusters(G.stone, stations, side * (h - 0.02), 0.30, sg.balPitch || 1.85);
    paintRange(G.stone, k0, G.stone.n, stoneTint);
  }

  /* 鬼脸浮雕带（只有新桥用） */
  if (sg.frieze){
    const k0 = G.frieze.n;
    for (const side of [-1, 1]) fascia(G.frieze, stations, side * (h + 0.56), -1.02, -0.20, 0.145);
    paintRange(G.frieze, k0, G.frieze.n, () => C_PLAIN);
  }

  /* ── 7.3 路灯 ───────────────────────────────────────────────── */
  const pitch = sg.lampPitch || 44;
  const nL = Math.max(2, Math.round(len / pitch));
  for (let i = 0; i <= nL; i++){
    const x = sA + len * i / nL;
    if (x < sA + 3 || x > sB - 3) continue;
    for (const side of [-1, 1]){
      const k0 = G.lampIron.n, g0 = G.glow.n;
      lamp(G.lampIron, G.glow, x, side * (h - (parapet === 'iron-rail' ? 0.95 : 0.85)),
           deckY(x) + 0.12, sg.lampScale || 1);
      /* lampIron 的基色已经是漆铸铁本色，不再压 C_IRON_DK——那会把柱子压成纯黑剪影 */
      paintRange(G.lampIron, k0, G.lampIron.n, () => C_PLAIN);
      paintRange(G.glow, g0, G.glow.n, () => C_PLAIN);
    }
  }
}

/* ══════════════ 8. 桥段规划：把 plan 数据算成 segments ══════════════ */

function planArcs(x0, x1, n, riseRatio, spansData, kind){
  const W = x1 - x0;
  let widths;
  if (spansData && spansData.length === n){
    const tot = spansData.reduce((a, c) => a + (c || 0), 0);
    widths = spansData.map(v => (v || tot / n));
  } else {
    widths = new Array(n).fill(1);
  }
  const sum = widths.reduce((a, c) => a + c, 0);
  let pier = n > 1 ? clamp((W - sum * (W / sum) * 0.86) / (n - 1), 2.2, 8.5) : 0;
  if (n > 1) pier = clamp(W / n * 0.16, 2.2, 8.5);
  const avail = W - pier * (n - 1);
  const arcs = [];
  let x = x0;
  for (let i = 0; i < n; i++){
    const w = avail * widths[i] / sum;
    /* 拱矢：受两条硬约束——① 拱背不能顶穿桥面 ② 起拱线不能沉到水下太多 */
    const crownMax = -1.35;                       // 桥面结构下缘（近似）
    let rise = riseRatio * w;
    rise = Math.min(rise, crownMax - (Y_WATER + 0.4));
    rise = clamp(rise, 1.1, 14);
    const ySpring = Math.max(Y_WATER + 0.35, crownMax - rise);
    arcs.push({x0: x, x1: x + w, ySpring, rise: crownMax - ySpring,
               seg: clamp(Math.round(w / 5.5), 6, 10),
               circular: riseRatio <= 0.20 || kind === 'steel'});
    x += w + pier;
  }
  return arcs;
}

function rot(dx, dz, a){
  const c = Math.cos(a), s = Math.sin(a);
  return [dx * c - dz * s, dx * s + dz * c];
}

/* 三座 both-arms 桥的孔数分法（来自 bridges.json 的 detail/spans） */
const ARM_SPLIT = {
  'pont-neuf':          {wide: 7, narrow: 5},
  'pont-de-bir-hakeim': {wide: 3, narrow: 3},
  'pont-de-sully':      {wide: 3, narrow: 3}
};

function makeSegments(b, plan){
  const [dx, dz] = b.dir, L = b.lengthM;
  const rg = crossRange(plan, b);
  const raw = sampleWater(plan, b.x, b.z, dx, dz, rg[0], rg[1], 0.75);
  const spans = raw.length ? raw : [[-(b._armW || 80) / 2, (b._armW || 80) / 2]];

  const kind = b.kind === 'steel-girder' || b.kind === 'steel-beam' ? 'girder'
             : (b.kind === 'steel-arch' ? 'steel' : 'stone');
  const parapet = b.parapet === 'balustrade' ? 'balustrade'
                : (b.parapet === 'iron-rail' ? 'iron-rail' : 'solid');
  const pointed = b.kind === 'stone-arch' && b.year < 1800;
  const base = {deckW: b.deckW, parapet, kind, pointedNose: pointed,
                lampPitch: b.lengthM > 150 ? 46 : 36,
                yA: Y_STREET, yB: Y_STREET};

  /* 单段 */
  if (!(b.crosses === 'both-arms' && spans.length >= 2)){
    const wa = spans[0][0], wb = spans[spans.length-1][1];
    const abut = clamp((wb - wa) * 0.11, 8, 20);
    const sd = Array.isArray(b.spans) ? b.spans : null;
    const arcs = kind === 'girder'
      ? planArcs(wa, wb, Math.max(1, b.arches), 0.12, sd, kind)
      : planArcs(wa, wb, Math.max(1, b.arches), b.riseRatio || 0.18, sd, kind);
    return [Object.assign({}, base, {
      ox: b.x, oz: b.z, dx, dz, angle: b.angle,
      sA: wa - abut - 12, sB: wb + abut + 12, abut, arcs
    })];
  }

  /* 两汊：以岛为折点，各成一段（新桥在西岱岛西端确实折了一个角） */
  const gapA = spans[0][1], gapB = spans[1][0];
  const mid = (gapA + gapB) / 2, half = (gapB - gapA) / 2;
  const O = [b.x + dx * mid, b.z + dz * mid];
  const bend = (b.id === 'pont-neuf') ? 3.2 * DEG : 0;
  const split = ARM_SPLIT[b.id];
  const wide = (spans[1][1]-spans[1][0]) >= (spans[0][1]-spans[0][0]) ? 1 : 0;

  const segs = [];
  for (const k of [0, 1]){
    const outSign = k === 0 ? -1 : 1;
    const [adx, adz] = rot(dx * outSign, dz * outSign, outSign * bend);
    /* 沿本臂自己的轴重新找水道，折角后不会踏空 */
    const sp = sampleWater(plan, O[0], O[1], adx, adz, 2, half + 260, 0.75);
    const arm = sp.length ? sp[0] : [half, half + (spans[k][1]-spans[k][0])];
    const abut = clamp((arm[1]-arm[0]) * 0.12, 9, 20);
    let n = b.arches;
    if (split) n = (k === wide) ? split.wide : split.narrow;
    else n = Math.max(1, Math.round(b.arches * (arm[1]-arm[0]) /
             ((spans[0][1]-spans[0][0]) + (spans[1][1]-spans[1][0]))));
    const sd = (b.spans && !Array.isArray(b.spans))
      ? (k === wide ? (b.spans.grandBras || b.spans.south) : (b.spans.petitBras || b.spans.north))
      : null;
    segs.push(Object.assign({}, base, {
      arm: k,                       // 两汊桥的臂号：上层高架靠它避开岛上重叠段
      ox: O[0], oz: O[1], dx: adx, dz: adz, angle: Math.atan2(-adz, adx),
      sA: -half - 6, sB: arm[1] + abut + 12, abut,
      arcs: planArcs(arm[0], arm[1], Math.max(1, n), b.riseRatio || 0.2,
                     (sd && sd.length === n) ? sd : null, kind),
      yA: 0.55, yB: Y_STREET, camber: 0.7
    }));
  }
  segs.island = {x: O[0], z: O[1], half};
  return segs;
}

/* ══════════════ 9. 英雄桥 ══════════════ */

/* ── 亚历山大三世桥柱顶的鎏金群像「名誉女神勒住珀伽索斯」 ────────────────
   四组是这座桥最出名的部分，硬指标只有一条：100m 外必须读出「一匹金色的马
   + 一个人形」。不要求写实，要求剪影对。

   旧版全是等截面的方块杆，翼是两片平放的板，成品在 chk2-alexandre.png 里
   读成「几根随意插着的金条」。换成收分锥台之后，把五件事做对：
     ① 马身前高后低、前腿抬起折回——腾起的姿态，不是站着的四脚兽
     ② 颈从鬃甲斜立上去、头在颈梢再折向前：这条折线是「马」的第一读点
     ③ 翼从肩起分三节后掠、越梢越窄；翼展只比体长略长，长过头柱顶就成了
        两片板压着一只小动物
     ④ 尾从臀甩向后下方，给剪影一条收尾
     ⑤ 女神整个人站在马的近侧，头必须高过马背，一臂勒缰、一臂把棕榈枝举过头顶

   36 段锥台 + 1 块底座 = 444 tri／组，四组 1,776 tri（上限 2,400）。
   px/pz 是柱心、gy 是柱头顶面；F=±1 决定马头朝桥外的哪一头。F=−1 时整组绕
   Y 轴转 180°（a 与 c 一起翻号），所以是纯旋转不是镜像，面的绕序不会翻。 */
function renommeePegase(gb, px, gy, pz, F){
  const S = 0.92, aOff = -0.10;                 // 总尺度：全长收进 4.3m 的柱头
  const T = (a, y, c) => [px + F * (a + aOff) * S, gy + y * S, pz + F * c * S];
  const U = [F, 0, 0];                          // 锥台「宽」的朝向 = 局部前后轴
  const seg = (A, B, ra, ta, rb, tb) =>
    taper(gb, T(A[0], A[1], A[2]), T(B[0], B[1], B[2]),
          ra * S, ta * S, rb * S, tb * S, 0.5, U);

  gb.box(px + F * aOff * S, gy + 0.19 * S, pz, 3.9 * S, 0.38 * S, 2.9 * S, 0.4);  // 铜底座

  /* 后腿：踏在底座上，是全组唯一的支点 */
  for (const c of [-0.46, 0.46]){
    seg([-1.20, 2.25, c], [-1.48, 1.32, c * 1.08], 0.30, 0.28, 0.19, 0.18);
    seg([-1.48, 1.32, c * 1.08], [-1.30, 0.60, c * 1.08], 0.17, 0.16, 0.12, 0.12);
    seg([-1.30, 0.60, c * 1.08], [-1.28, 0.36, c * 1.08], 0.15, 0.14, 0.15, 0.14);
  }
  /* 前腿：前臂前伸、腕折回下垂——「扬起」全靠这个折角，直着伸出去只是根棍 */
  for (const c of [-0.42, 0.42]){
    seg([1.15, 2.80, c], [1.95, 2.20, c * 1.10], 0.28, 0.26, 0.18, 0.17);
    seg([1.95, 2.20, c * 1.10], [1.72, 1.42, c * 1.10], 0.17, 0.16, 0.12, 0.12);
    seg([1.72, 1.42, c * 1.10], [1.86, 1.18, c * 1.10], 0.14, 0.13, 0.14, 0.13);
  }
  /* 躯干：臀 → 腹 → 胸，前高后低 */
  seg([-1.55, 2.05, 0], [-0.20, 2.42, 0], 0.56, 0.52, 0.70, 0.62);
  seg([-0.20, 2.42, 0], [ 1.20, 2.78, 0], 0.70, 0.62, 0.66, 0.58);
  seg([ 1.20, 2.78, 0], [ 1.62, 2.86, 0], 0.60, 0.52, 0.44, 0.40);
  /* 颈 → 头 → 耳；鬃沿颈的后上缘贴一片薄鳍 */
  seg([1.35, 3.05, 0], [2.02, 4.30, 0], 0.52, 0.44, 0.30, 0.27);
  seg([2.02, 4.30, 0], [2.60, 4.02, 0], 0.30, 0.26, 0.17, 0.15);
  for (const c of [-0.13, 0.13]) seg([2.00, 4.44, c], [1.94, 4.76, c * 1.15], 0.07, 0.06, 0.03, 0.03);
  seg([1.09, 3.19, 0], [1.76, 4.44, 0], 0.24, 0.10, 0.14, 0.07);
  /* 尾：甩向后下方。做成「前后宽、横向薄」的一片——等截面的圆棍挂在臀后面，
     从侧面看和一条后腿分不出来（第一版实拍到的就是这个） */
  seg([-1.70, 2.32, 0], [-2.16, 1.75, 0], 0.30, 0.14, 0.22, 0.10);
  seg([-2.16, 1.75, 0], [-2.34, 1.00, 0], 0.22, 0.10, 0.10, 0.05);
  /* 双翼：从肩后起向后上方展开，三节，越梢越窄。ra/rb 是弦长的一半，
     ta/tb 是板厚——uHint 把翼面摆进「翼展 × 前后」那个平面，翼才是片不是棍。
     弦长必须克制：第一版给到半弦 0.82（弦 1.64 / 翼展 3.4 ≈ 0.48），两只翼直接
     把马身和头整个盖住，柱顶只剩四片金板。真马翼的弦展比约 0.3，照这个来。 */
  for (const sz of [-1, 1]){
    seg([ 0.05, 3.20, sz * 0.52], [-0.22, 4.45, sz * 0.98], 0.40, 0.12, 0.48, 0.10);
    seg([-0.22, 4.45, sz * 0.98], [-0.68, 5.60, sz * 1.42], 0.48, 0.10, 0.42, 0.08);
    seg([-0.68, 5.60, sz * 1.42], [-1.26, 6.45, sz * 1.80], 0.42, 0.08, 0.15, 0.05);
  }
  /* 名誉女神：站在马的近侧偏前——站在翼的后掠轨迹之外，不然她整个人被翼吞掉。
     人形的读点是三个尺度的对比：裙摆宽 → 腰收 → 肩再张开 → 脖子掐一下 → 头。
     少掉脖子那一掐，她就是一块从地上立起来的板（八向环拍里实拍到的就是这个）。
     她还必须够高：头顶 4.24 比马背 2.86 高出 1.38，纯侧面时头才不会陷进马背与
     翼根之间那一团里——上一版给到 3.66，正侧视直接看不见人。
     站位取马的前肩外侧而不是马身旁：正侧面看过去她整个人衬在天上，
     不会陷进马身那一大块金色里；伸出去的那只手正好够到马头上的辔头，
     「勒住珀伽索斯」这层意思也顺带成立了。 */
  seg([1.15, 0.38, 1.42], [1.21, 2.02, 1.38], 0.52, 0.48, 0.34, 0.32);   // 长袍：下宽上收
  seg([1.21, 2.02, 1.38], [1.11, 3.32, 1.36], 0.34, 0.32, 0.42, 0.36);   // 腰 → 肩：再张开
  seg([1.11, 3.28, 0.96], [1.11, 3.28, 1.76], 0.28, 0.24, 0.28, 0.24);   // 肩
  seg([1.11, 3.32, 1.36], [1.10, 3.60, 1.36], 0.15, 0.15, 0.14, 0.14);   // 颈
  seg([1.10, 3.60, 1.36], [1.07, 4.24, 1.36], 0.25, 0.24, 0.20, 0.19);   // 头
  seg([1.25, 3.16, 1.18], [2.17, 3.30, 0.74], 0.16, 0.15, 0.10, 0.10);   // 勒缰的臂
  seg([1.17, 3.20, 1.58], [1.60, 4.50, 1.72], 0.16, 0.15, 0.11, 0.11);   // 举起的臂
  seg([1.60, 4.50, 1.72], [2.17, 5.42, 1.82], 0.28, 0.06, 0.10, 0.04);   // 棕榈枝
  seg([0.97, 3.10, 1.52], [0.27, 1.40, 1.66], 0.32, 0.10, 0.26, 0.07);   // 披风
}

/* ── 9.1 亚历山大三世桥（1900）──────────────────────────────────
   107.5m 单跨钢拱、拱矢比 1/17（≈6.3m）。这个「几乎看不出弧度」的
   比例就是它的技术奇观本身：荣军院金顶到香榭丽舍的视线轴不能被挡。
   把它做成半圆拱，这座桥就白做了。 */
function buildAlexandreIII(b, seg, G){
  const h = b.deckW / 2;                       // 20m
  const arc0 = seg.arcs[0];
  const x0 = arc0.x0, x1 = arc0.x1, span = x1 - x0;
  const rise = span / 17;                      // 硬锁 1/17
  const ySpring = -7.3, yCrown = ySpring + rise;
  const arc = archCurve(x0, x1, ySpring, rise, 17, true);

  const deckY = (x) => {
    const u = clamp((x - seg.sA) / (seg.sB - seg.sA), 0, 1);
    return 0.72 * Math.sin(Math.PI * u);        // 极缓的纵坡，看得见荣军院
  };
  const nSt = 16, stations = [];
  for (let i = 0; i <= nSt; i++){ const x = seg.sA + (seg.sB - seg.sA) * i / nSt; stations.push([x, deckY(x)]); }

  /* 桥台：44m 宽 × 30m 厚，各开两条石砌隧道给下层河岸走
     （不开这两个洞，桥台就是两坨笨重的方块） */
  for (const [xa, xb] of [[seg.sA, x0], [x1, seg.sB]]){
    const k0 = G.stone.n;
    /* 隧道以下的实体基座 */
    G.stone.box((xa+xb)/2, (Y_BASE + Y_BERGE - 0.2)/2, 0, xb - xa, (Y_BERGE - 0.2) - Y_BASE, 44, 0.22);
    /* 隧道以上：两个拱洞（洞口朝 ±Z，即沿河方向），用 x-y 立面拉伸 */
    const tunH = 4.6, tunW = 7.0, yF = Y_BERGE - 0.2;
    const cx = (xa + xb) / 2;
    const poly = [];
    poly.push([xa, yF], [xa, deckY(xa) - 1.05]);
    for (let i = 1; i < 6; i++){ const x = xa + (xb-xa)*i/6; poly.push([x, deckY(x) - 1.05]); }
    poly.push([xb, deckY(xb) - 1.05], [xb, yF]);
    /* 从下方切两个拱腹缺口 */
    const bot = [];
    const t0 = cx - tunW - 3.5, t1 = cx - 3.5, t2 = cx + 3.5, t3 = cx + tunW + 3.5;
    bot.push([xa, yF]);
    for (const [a, bx] of [[t0, t1], [t2, t3]]){
      bot.push([a, yF], [a, yF + 2.4]);
      const cu = archCurve(a, bx, yF + 2.4, tunH - 2.4, 8, false);
      for (let i = 1; i < cu.length - 1; i++) bot.push(cu[i]);
      bot.push([bx, yF + 2.4], [bx, yF]);
    }
    bot.push([xb, yF]);
    const full = poly.concat(bot.slice().reverse());
    prismXY(G.stone, full, -22, 22, 0.22);
    paintRange(G.stone, k0, G.stone.n, stoneTint);
  }

  /* ── 钢拱 ──────────────────────────────────────────────────────
     成败只有一条标准：从对岸看，桥面以下必须是「实的」。
     原来只排 5 道 1m 见方的拱肋、拱肩全空，107m 跨度下整道拱在远景里
     只剩一根发丝，还能透出背景色——被审成「投在虚空里的阴影」，没冤枉。
     真桥这里本来就是实的：两片带腹板的箱形主梁沿拱背走，把桥面下缘与
     拱背之间那块月牙形拱肩整个封死，只有拱腹以下才是空的。照这个来。
     截面高按 Récipon 那批照片的比例给：拱顶 2.35m、拱脚 3.9m。 */
  const xmA = (x0 + x1) / 2, aHalf = span / 2;
  const Rarc = (aHalf * aHalf + rise * rise) / (2 * rise);
  const archY = (x) => {                                  // 拱轴线
    const d = clamp(x - xmA, -aHalf, aHalf);
    return ySpring + Math.sqrt(Math.max(0, Rarc * Rarc - d * d)) - (Rarc - rise);
  };
  const archH  = (x) => { const u = clamp((x - xmA) / aHalf, -1, 1); return 2.35 + 1.55 * u * u; };
  const soffit = (x) => archY(x) - archH(x) / 2;          // 拱腹（拱的下缘）
  const undeck = (x) => deckY(x) - 1.02;                  // 桥面结构下缘

  const NF = 24, fz1 = h - 0.85, fz0 = fz1 - 1.5;         // 主梁外皮 z=19.15，腹板厚 1.5m
  const bandPoly = (yTop, yBot) => {
    const up = [], dn = [];
    for (let i = 0; i <= NF; i++){
      const x = x0 + span * i / NF;
      up.push([x, yTop(x)]); dn.push([x, yBot(x)]);
    }
    return up.concat(dn.reverse());
  };
  {
    const k0 = G.steel.n;
    /* 主梁（拱肩实腹 + 拱肋合一）：上缘贴桥面下缘，下缘就是拱腹 */
    const web = bandPoly(undeck, soffit);
    prismXY(G.steel, web,  fz0,  fz1, 0.22);
    prismXY(G.steel, web, -fz1, -fz0, 0.22);
    /* 腹板压暗一档：这一面 107m 长的板子和亮线脚拉开，才有「凹进去」的读感 */
    paintRange(G.steel, k0, G.steel.n, (x, y, z) => {
      const c = stoneTint(x, y, z);
      return [c[0] * 0.86, c[1] * 0.86, c[2] * 0.87];
    });
    /* 上下两道通长线脚，各外挑 0.4m。107m 的一整面光板没有横向阴影线，
       在太阳底下会曝成一张白纸；这两条线是它读成「梁」的最低成本 */
    const k1 = G.steel.n;
    const mold = bandPoly(x => soffit(x) + 0.72, x => soffit(x) - 0.14);
    prismXY(G.steel, mold,  fz1,  fz1 + 0.40, 0.3);
    prismXY(G.steel, mold, -fz1 - 0.40, -fz1, 0.3);
    const cor = bandPoly(x => undeck(x) + 0.04, x => undeck(x) - 0.52);
    prismXY(G.steel, cor,  fz1,  fz1 + 0.40, 0.3);
    prismXY(G.steel, cor, -fz1 - 0.40, -fz1, 0.3);
    paintRange(G.steel, k1, G.steel.n, () => C_PLAIN);
  }
  /* 拱肋分格：主梁外皮上的竖向肋，每 ~9m 一道。没有它，那面 107m 长的
     腹板就是一整块光板，读不出这是拼接起来的钢结构 */
  {
    const k0 = G.steel.n;
    for (let i = 2; i <= NF - 2; i += 2){
      const x = x0 + span * i / NF;
      const yT = undeck(x) - 0.46, yB = soffit(x) + 0.70;
      if (yT - yB < 0.55) continue;
      for (const side of [-1, 1])
        G.steel.box(x, (yT + yB) / 2, side * (fz1 + 0.21), 1.15, yT - yB, 0.42, 0.4);
    }
    /* 竖肋压暗：这个距离上分格靠明暗差读，不靠 0.4m 的凸出量 */
    paintRange(G.steel, k0, G.steel.n, () => [0.78, 0.77, 0.75]);
  }
  /* 两片主梁之间的内拱肋 + 横撑。
     真桥是 15 道钢拱肋并排，肋间留空——旧版只排 4 道内肋（加两片主梁共 6 道），
     肋宽 1.25 而间距 8.7m，从桥下斜看过去是「几根粗管子」，从更斜的角度几道肋
     互相错开，糊成一整块板，整座桥就退回成石拱桥了。按真桥补到 15 道：
     两片外主梁 + 13 道内肋，间距 2.83m、肋厚 0.95m，肋间留 1.88m 的净空。
     单道的细分从 17 段降到 9 段把预算找回来（这道拱矢比只有 1/17，
     9 段和 17 段的轮廓差在 100m 外读不出来）。 */
  const N_RIB = 13, RIB_HALF = 17.0;
  const ribZ = [];
  for (let i = 0; i < N_RIB; i++) ribZ.push(-RIB_HALF + 2 * RIB_HALF * i / (N_RIB - 1));
  const ribArc = archCurve(x0, x1, ySpring, rise, 9, true);
  for (const rz of ribZ){
    const k0 = G.steel.n;
    for (let i = 0; i < ribArc.length - 1; i++){
      const a = ribArc[i], c = ribArc[i+1];
      const ex = c[0]-a[0], ey = c[1]-a[1], L = Math.hypot(ex, ey) || 1;
      const nx = -ey/L, ny = ex/L;
      const w = 1.25;
      const A0 = [a[0] - nx*w*0.45, a[1] - ny*w*0.45], A1 = [a[0] + nx*w*0.55, a[1] + ny*w*0.55];
      const B0 = [c[0] - nx*w*0.45, c[1] - ny*w*0.45], B1 = [c[0] + nx*w*0.55, c[1] + ny*w*0.55];
      const hw = 0.475;                     // 肋厚 0.95m —— 间距 2.83 减去它，肋间净空 1.88m
      /* 四个面 */
      G.steel.face([A0[0],A0[1],rz+hw],[B0[0],B0[1],rz+hw],[B1[0],B1[1],rz+hw],[A1[0],A1[1],rz+hw], 0.4);
      G.steel.face([A1[0],A1[1],rz-hw],[B1[0],B1[1],rz-hw],[B0[0],B0[1],rz-hw],[A0[0],A0[1],rz-hw], 0.4);
      G.steel.face([A1[0],A1[1],rz+hw],[B1[0],B1[1],rz+hw],[B1[0],B1[1],rz-hw],[A1[0],A1[1],rz-hw], 0.4);
      G.steel.face([A0[0],A0[1],rz-hw],[B0[0],B0[1],rz-hw],[B0[0],B0[1],rz+hw],[A0[0],A0[1],rz+hw], 0.4);
    }
    paintRange(G.steel, k0, G.steel.n, () => C_PLAIN);
  }
  {
    const k0 = G.steel.n;
    /* 横撑：拱腹下面每三节一道通长横杆，低角度看过去这层才不是空的 */
    for (let i = 2; i < arc.length - 2; i += 3)
      G.steel.box(arc[i][0], arc[i][1] - 0.55, 0, 0.6, 0.46, 2 * RIB_HALF + 1.2, 0.4);
    /* 敞肩立柱：拱背 → 桥面下缘。只落在每隔三道的肋上——13 道全上是 91 根柱子，
       既超预算又把好不容易腾出来的肋间空隙重新填满 */
    const colZ = ribZ.filter((_, i) => i % 3 === 0);
    for (let i = 2; i < arc.length - 2; i += 2){
      const p = arc[i], yb = p[1] + 0.6, yt = deckY(p[0]) - 1.1;
      if (yt - yb < 0.4) continue;
      for (const rz of colZ) G.steel.box(p[0], (yb + yt) / 2, rz, 0.82, yt - yb, 0.82, 0.4);
    }
    paintRange(G.steel, k0, G.steel.n, () => C_PLAIN);
  }

  /* 桥面 + 石栏杆 */
  const sw = 5.2, prof = deckProfile(b.deckW, 'balustrade', sw);
  const rIdx = roadSegIndex(prof, b.deckW, sw);
  const d0 = G.stone.n, a0 = G.asphalt.n;
  ribbon((j) => (j === rIdx ? G.asphalt : G.stone), stations, prof, 0.25,
         (j) => (j === rIdx ? C_PLAIN : null));
  paintRange(G.asphalt, a0, G.asphalt.n, () => C_PLAIN);
  for (let i = d0; i < G.stone.n; i++) if (G.stone.C[i*3] === undefined){
    const c = stoneTint(G.stone.P[i*3], G.stone.P[i*3+1], G.stone.P[i*3+2]);
    G.stone.C[i*3]=c[0]; G.stone.C[i*3+1]=c[1]; G.stone.C[i*3+2]=c[2];
  }
  {
    const k0 = G.stone.n;
    for (const side of [-1, 1]) balusters(G.stone, stations, side * (h - 0.02), 0.30, 1.7);
    paintRange(G.stone, k0, G.stone.n, stoneTint);
  }

  /* 拱背花环与面具（沿檐口一列鎏金小饰） */
  {
    const k0 = G.bronze.n;
    for (let i = 1; i < 14; i++){
      const x = seg.sA + (seg.sB - seg.sA) * i / 14;
      for (const side of [-1, 1])
        G.bronze.box(x, deckY(x) - 0.66, side * (h + 0.56), 0.8, 0.30, 0.13, 0.5);
    }
    paintRange(G.bronze, k0, G.bronze.n, () => C_PLAIN);
  }

  /* 四座 17m 立柱（pylône）+ 柱顶鎏金「名誉女神勒住珀伽索斯」 */
  for (const px of [x0 - 3.0, x1 + 3.0]) for (const pz of [-h + 1.6, h - 1.6]){
    const fwd = px < xmA ? -1 : 1;                        // 马头朝桥外
    const k0 = G.stone.n;
    G.stone.box(px, 1.4, pz, 7.0, 2.8, 7.0, 0.3);            // 柱脚（内含法国史寓意群像的座）
    G.stone.box(px, 3.2, pz, 5.8, 1.0, 5.8, 0.3);
    G.stone.cyl(px, 11.4, pz, 2.45, 2.05, 15.4, 4, 0.3, false); // 柱身 17m 到顶
    G.stone.box(px, 19.4, pz, 5.2, 0.7, 5.2, 0.3);            // 柱头
    G.stone.box(px, 20.1, pz, 4.3, 0.7, 4.3, 0.3);
    paintRange(G.stone, k0, G.stone.n, stoneTint);
    const g0 = G.gilt.n;
    renommeePegase(G.gilt, px, 20.45, pz, fwd);
    paintRange(G.gilt, g0, G.gilt.n, () => C_PLAIN);
  }

  /* 拱顶上下游各一块锤揲铜浮雕（涅瓦河仙女 / 塞纳河仙女） */
  {
    const g0 = G.bronze.n, xm = (x0 + x1) / 2;
    for (const side of [-1, 1]){
      G.bronze.box(xm, deckY(xm) - 0.72, side * (h + 0.62), 7.2, 1.5, 0.26, 0.4);
      G.bronze.box(xm, deckY(xm) - 0.72, side * (h + 0.78), 2.6, 1.9, 0.22, 0.4);
    }
    paintRange(G.bronze, g0, G.bronze.n, () => C_PLAIN);
  }

  /* 32 座新艺术青铜灯柱 */
  {
    const k0 = G.bronze.n, g0 = G.glow.n;
    for (let i = 0; i < 16; i++){
      const x = seg.sA + 6 + (seg.sB - seg.sA - 12) * i / 15;
      for (const side of [-1, 1]){
        const z = side * (h - 1.0), y = deckY(x) + 0.42;
        G.bronze.box(x, y + 0.3, z, 0.9, 0.6, 0.9, 0.5);
        G.bronze.cyl(x, y + 2.2, z, 0.22, 0.13, 3.2, 6, 0.5, false);
        G.bronze.box(x, y + 3.86, z, 0.72, 0.22, 0.3, 0.5);         // 弯臂
        /* 和石桥灯柱共用同一颗灯笼头：全城的灯必须是同一族，只许差在尺寸 */
        lanternHead(G.bronze, G.glow, x, y + 3.95, z, 1.06, 0.085);
        G.bronze.box(x, y + 1.1, z, 0.62, 0.5, 0.62, 0.5);          // 小天使托座
      }
    }
    paintRange(G.bronze, k0, G.bronze.n, () => C_PLAIN);
    paintRange(G.glow, g0, G.glow.n, () => C_PLAIN);
  }

  /* 四个桥头「孩童牵狮」青铜群像 */
  {
    const k0 = G.bronze.n;
    for (const px of [seg.sA + 4.5, seg.sB - 4.5]) for (const pz of [-h + 7.5, h - 7.5]){
      G.bronze.box(px, 1.1, pz, 3.0, 2.2, 1.8, 0.4);
      G.bronze.box(px, 2.9, pz, 2.4, 1.4, 1.1, 0.4);
      G.bronze.box(px - 1.0, 3.4, pz, 0.9, 0.9, 0.85, 0.4);
      G.bronze.box(px + 1.1, 3.3, pz, 0.5, 1.7, 0.5, 0.4);
    }
    paintRange(G.bronze, k0, G.bronze.n, () => C_PLAIN);
  }

  return {rise, span, yCrown};
}

/* ── 9.2 新桥（1578–1607）────────────────────────────────────────
   12 孔 = 大汊 7 + 小汊 5，两段在西岱岛西端折一个角。
   每个桥墩上方向外挑出半圆凸台（corbeille），这是它的第一识别特征。 */
function pontNeufExtras(b, seg, G, isWide){
  const h = b.deckW / 2;
  const len = seg.sB - seg.sA;
  const camb = clamp(len * 0.008, 0.25, 1.5) * 0.7;
  const deckY = (x) => {
    const u = clamp((x - seg.sA) / Math.max(1, len), 0, 1);
    return seg.yA + (seg.yB - seg.yA) * u + camb * Math.sin(Math.PI * u);
  };
  /* 半圆凸台：每墩两侧各一，台上一圈半圆石凳。
     只挑在桥墩顶上——两端的桥台和岛上 terre-plein 历史上从来没有凸台，
     多挑那两个会把全桥凑成 28 个，而 12 孔的新桥只有 6+4=10 个墩，
     数量 = 桥墩数 × 2 侧 = 20（1775 年 Soufflot 在凸台上设计的正是
     「vingt nouvelles boutiques sur les hémicycles」）。 */
  const xs = [];
  for (let i = 0; i < seg.arcs.length - 1; i++) xs.push((seg.arcs[i].x1 + seg.arcs[i+1].x0) / 2);
  /* 守住这条不变式：凸台位置必须落在首末拱的起拱点之间。
     一旦有人再往 xs 里补两个端点，它们会落到桥台/岛上平台上，这里就会报警 */
  const inA = seg.arcs[0].x0, inB = seg.arcs[seg.arcs.length-1].x1;
  if (xs.length !== seg.arcs.length - 1 || xs.some(x => x <= inA || x >= inB))
    console.warn('[bridges] 新桥凸台只许挑在桥墩顶上：' + xs.length +
                 ' 个 / 应为 ' + (seg.arcs.length - 1) + ' 个墩');
  for (const x of xs){
    for (const side of [-1, 1]){
      /* 用 cylBand 做真半圆——用轴对齐 box 拼弧线会拼成一段楼梯 */
      const k0 = G.stone.n, R = 2.75, z = side * (h + 0.22), y = deckY(x);
      const a0 = side > 0 ? 0 : Math.PI, a1 = side > 0 ? Math.PI : TAU;
      cylBand(G.stone, x, z, 0, R * 0.66, a0, a1, y - 1.95, y - 1.00, 4, 0.3, true);  // 牛腿托座
      cylBand(G.stone, x, z, 0, R,        a0, a1, y - 1.00, y + 0.16, 7, 0.3, true);  // 台面
      cylBand(G.stone, x, z, R - 0.46, R, a0, a1, y + 0.16, y + 1.16, 7, 0.3, true);  // 半圆栏板
      cylBand(G.stone, x, z, R - 1.05, R - 0.46, a0, a1, y + 0.16, y + 0.62, 4, 0.3, true); // 石凳
      paintRange(G.stone, k0, G.stone.n, stoneTint);
    }
  }
}

/* 亨利四世骑马像（西岱岛 terre-plein 上）
   实物总高约 11m：花岗岩基座「宽底座 + 瘦柱身 + 檐帽」约 6m，
   1818 年 Lemot 重铸的铜像从马蹄到帽顶约 4.7m。基座这一段上一轮已经按实物
   配好了（0.25 → 6.27，净 6.02m），这轮不动；铜像原来是 12 个轴对齐方块，
   在 t-bridges-1.png 里读成一团十字形的暗块——问题在剪影，所以照
   renommeePegase 的做法换成收分锥台，把马腿/颈头折线/宽檐帽/前伸的持杖臂
   四件事分出来。铜像净高 4.66m，总高 10.68m。 */
function henriIV(gWorld, gS, x, z, ang){
  const k0 = gS.n;
  gS.box(x, 0.85, z, 7.4, 1.20, 5.2, 0.3);        // 底座（顶面 0.30 之上再压 0.25 进平台）
  gS.box(x, 1.75, z, 6.2, 0.60, 4.4, 0.3);        // 台阶
  gS.box(x, 3.75, z, 4.4, 3.40, 3.2, 0.3);        // 柱身 dé
  gS.box(x, 5.72, z, 5.4, 0.54, 4.1, 0.3);        // 檐帽
  gS.box(x, 6.13, z, 4.7, 0.28, 3.5, 0.3);        // 顶板
  paintRange(gS, k0, gS.n, stoneTint);

  const g0 = gWorld.n, y0 = 6.27, S = 0.90;        // y0 = 马蹄着座标高
  const cos = Math.cos(ang), sin = Math.sin(ang);
  /* 局部 (a 向前, y 向上, c 横向) → 世界。ang 是绕 Y 的旋转，纯旋转不翻绕序 */
  const T = (a, y, c) => [x + (a * cos - c * sin) * S, y0 + y * S, z + (a * sin + c * cos) * S];
  const U = [cos, 0, sin];                         // 锥台「宽」的朝向 = 局部前后轴
  const seg = (A, B, ra, ta, rb, tb) =>
    taper(gWorld, T(A[0], A[1], A[2]), T(B[0], B[1], B[2]),
          ra * S, ta * S, rb * S, tb * S, 0.4, U);

  /* 马：四腿着地在走，近侧前腿抬一点。腿分上下两节收分，是「腿」不是「柱」 */
  for (const c of [-0.52, 0.52]){
    seg([-1.10, 2.05, c], [-1.40, 1.10, c], 0.30, 0.28, 0.19, 0.18);   // 后大腿
    seg([-1.40, 1.10, c], [-1.28, 0.14, c], 0.18, 0.17, 0.13, 0.13);   // 后小腿到蹄
  }
  seg([ 1.18, 2.15, -0.50], [ 1.32, 1.12, -0.50], 0.27, 0.25, 0.17, 0.16);
  seg([ 1.32, 1.12, -0.50], [ 1.28, 0.14, -0.50], 0.16, 0.16, 0.13, 0.13);
  seg([ 1.18, 2.15,  0.50], [ 1.78, 1.55,  0.50], 0.27, 0.25, 0.17, 0.16);   // 近侧前腿抬起
  seg([ 1.78, 1.55,  0.50], [ 1.62, 0.92,  0.50], 0.16, 0.16, 0.13, 0.13);
  /* 躯干 */
  seg([-1.62, 1.95, 0], [-0.30, 2.16, 0], 0.58, 0.54, 0.74, 0.64);
  seg([-0.30, 2.16, 0], [ 1.22, 2.22, 0], 0.74, 0.64, 0.66, 0.58);
  seg([ 1.22, 2.22, 0], [ 1.58, 2.20, 0], 0.60, 0.52, 0.44, 0.40);
  /* 颈 → 头 → 耳；鬃贴颈后上缘。这条折线是「马」而不是「一根横杆」的读点 */
  seg([1.38, 2.60, 0], [2.02, 3.72, 0], 0.50, 0.42, 0.29, 0.26);
  seg([2.02, 3.72, 0], [2.58, 3.42, 0], 0.29, 0.26, 0.17, 0.15);
  for (const c of [-0.13, 0.13]) seg([2.00, 3.86, c], [1.94, 4.14, c], 0.07, 0.06, 0.03, 0.03);
  seg([1.14, 2.76, 0], [1.78, 3.88, 0], 0.22, 0.10, 0.13, 0.07);
  /* 尾：甩向后下方 */
  seg([-1.76, 2.20, 0], [-2.06, 1.42, 0], 0.22, 0.19, 0.16, 0.13);
  seg([-2.06, 1.42, 0], [-2.14, 0.62, 0], 0.16, 0.13, 0.08, 0.07);
  /* 骑者：坐姿，大腿前伸、小腿垂下踩镫 */
  seg([-0.18, 2.90, 0], [ 0.38, 2.72, 0], 0.44, 0.62, 0.40, 0.58);          // 鞍
  for (const c of [-0.52, 0.52]){
    seg([-0.10, 2.98, c], [0.72, 2.66, c * 1.12], 0.21, 0.19, 0.17, 0.16);  // 大腿
    seg([ 0.72, 2.66, c * 1.12], [0.66, 1.86, c * 1.12], 0.16, 0.15, 0.12, 0.12); // 小腿到靴
  }
  seg([-0.16, 2.86, 0], [-0.02, 4.06, 0], 0.44, 0.38, 0.38, 0.33);          // 躯干
  seg([-0.02, 4.14, 0], [ 0.00, 4.60, 0], 0.21, 0.20, 0.18, 0.17);          // 头
  seg([ 0.00, 4.60, 0], [ 0.00, 4.78, 0], 0.62, 0.58, 0.52, 0.48);          // 宽檐帽的帽檐
  seg([ 0.00, 4.78, 0], [-0.06, 5.18, 0], 0.24, 0.23, 0.20, 0.19);          // 帽冠
  seg([ 0.10, 3.86, -0.42], [ 1.18, 3.42, -0.50], 0.16, 0.15, 0.11, 0.11);  // 前伸持杖的臂
  seg([ 1.18, 3.42, -0.50], [ 2.02, 3.06, -0.55], 0.07, 0.07, 0.05, 0.05);  // 元帅杖
  seg([ 0.06, 3.84,  0.42], [ 0.92, 3.20,  0.42], 0.16, 0.15, 0.11, 0.11);  // 勒缰的臂
  seg([-0.30, 3.95, 0], [-0.90, 2.30, 0], 0.44, 0.13, 0.30, 0.09);          // 披风
  paintRange(gWorld, g0, gWorld.n, () => C_PLAIN);
}

/* ── 9.3 比尔阿凯姆桥（1905）─────────────────────────────────────
   双层：下层车行 + 人行，上层地铁 6 号线高架（Viaduc de Passy），
   由成对铸铁柱廊撑起。柱距按 237m 扣掉岛上砌体拱段后均分（数据里注明是估算）。 */
function birHakeimUpper(b, seg, G){
  const h = b.deckW / 2;
  const yUp = 7.6;                       // 上层地铁面
  /* 上层高架的起止由下层石桥钳制，不再直接用 seg.sA/sB：
     ① 原来首尾两根柱子被 `x < sA+1 / x > sB-1` 的守卫 continue 掉，
        上层板两端各留一跨 10.6m 悬挑，凌空断在空中；
     ② 两汊桥的两段各自从 sA=−half−6 起，在岛上重叠一整段，
        柱列在那里被叠了两遍（左半边柱子密度肉眼可见地比右半边高）。
     所以两汊段一律从岛心 0 起算，各管自己那半边。 */
  const uA = (seg.arm === undefined) ? seg.sA + 1.6 : 0;
  const uB = seg.sB - 1.6;
  const len = uB - uA;
  if (len < 12) return;
  const pitch = 10.6;                     // bridges.json：柱距约 6m（数据自己标了是估算）
  const n = Math.max(2, Math.round(len / pitch));
  const zc = 4.6;                        // 中央人行道两侧的柱列
  const k0 = G.iron.n, g0 = G.glow.n;
  for (let i = 0; i <= n; i++){
    if (i === 0 && seg.arm === 1) continue;   // 岛心那根由 arm 0 出，别叠两根
    const x = uA + len * i / n;
    for (const side of [-1, 1]){
      /* 成对铸铁柱 */
      for (const d of [-0.62, 0.62])
        G.iron.cyl(x + d, yUp / 2 + 0.3, side * zc, 0.32, 0.24, yUp - 0.6, 4, 0.4, false);
      G.iron.box(x, 0.55, side * zc, 2.3, 1.0, 1.5, 0.4);            // 柱脚兼柱头
      /* 柱间弧形托架（两段折线近似） */
      if (i < n){
        const x2 = uA + len * (i+1) / n;
        G.iron.box((x + x2) / 2, yUp - 1.35, side * zc, x2 - x, 0.42, 0.52, 0.4);
      }
    }
  }
  /* 端部门架横梁：板端坐在柱顶上，收头不再是一刀切的悬挑 */
  for (const ux of [uA, uB]){
    if (ux === 0 && seg.arm === 1) continue;
    G.iron.box(ux, yUp - 1.05, 0, 1.10, 0.52, 2 * zc + 1.3, 0.4);
  }
  /* 上层桥面（地铁高架）+ 侧向格构梁 */
  const nSt = clamp(Math.round(len / 15), 4, 16), st = [];
  for (let i = 0; i <= nSt; i++) st.push([uA + len * i / nSt, yUp]);
  const up = [[-zc - 1.9, -0.9], [-zc - 1.9, 0], [zc + 1.9, 0], [zc + 1.9, -0.9], [-zc - 1.9, -0.9]];
  ribbon(G.iron, st, up, 0.3, null);
  for (const side of [-1, 1]){
    for (let i = 0; i < st.length - 1; i++){
      const A = st[i], B = st[i+1];
      G.iron.box((A[0]+B[0])/2, yUp + 0.85, side * (zc + 1.85), B[0]-A[0], 1.7, 0.22, 0.35);
    }
  }
  /* 两条钢轨 */
  for (const rz of [-1.5, 1.5]){
    for (let i = 0; i < st.length - 1; i++){
      const A = st[i], B = st[i+1];
      G.iron.box((A[0]+B[0])/2, yUp + 0.14, rz, B[0]-A[0], 0.16, 0.5, 0.35);
    }
  }
  paintRange(G.iron, k0, G.iron.n, () => C_PLAIN);
  paintRange(G.glow, g0, G.glow.n, () => C_PLAIN);
  /* 桥墩上的雕像群与方尖碑式立柱 */
  {
    const s0 = G.stone.n, b0 = G.bronze.n;
    for (const i of [0, seg.arcs.length - 1]){
      const a = seg.arcs[i], xm = i === 0 ? a.x0 : a.x1;
      for (const side of [-1, 1]){
        G.stone.box(xm, 1.4, side * (h + 1.4), 3.2, 2.8, 3.2, 0.3);
        G.stone.cyl(xm, 4.6, side * (h + 1.4), 1.1, 0.55, 3.6, 4, 0.3, false);
        G.bronze.box(xm, 4.0, side * (h + 1.4), 1.1, 2.4, 0.9, 0.4);
        G.bronze.box(xm, 5.5, side * (h + 1.4), 0.62, 0.62, 0.62, 0.4);
      }
    }
    paintRange(G.stone, s0, G.stone.n, stoneTint);
    paintRange(G.bronze, b0, G.bronze.n, () => C_PLAIN);
  }
}

/* ══════════════ 10. 模块 ══════════════ */

const CAMS = [
  {n: '全景 · 塞纳河桥列',    p: [560, 980, -980],    t: [-2500, -6, 1020],  fov: 46},
  {n: '河面低空 · 新桥大汊',  p: [-448, -3.2, 362],   t: [-648, -1, 476],    fov: 50},
  {n: '桥面人视角 · 新桥',    p: [-601, 3.0, 498],    t: [-552, 2.2, 566],   fov: 60},
  {n: '桥特写 · 亚历山大三世', p: [-2472, 13, 1178],  t: [-2660, -2.4, 1200], fov: 38},
  {n: '西岱岛桥群鸟瞰',       p: [-520, 210, -60],    t: [-140, -6, 260],    fov: 46},
  {n: '新桥凸台近景',         p: [-578, 1.6, 472],    t: [-600, 0.4, 487],   fov: 50},
  {n: '黄昏 · 比尔阿凯姆',    p: [-4768, 44, 188],    t: [-4571, 2, 312],    fov: 42},
  {n: '桥墩水线剖面 · 新桥',  p: [-576, -5.2, 470],   t: [-606, -6.6, 491],  fov: 46},
  {n: '亚历山大三世 · 正面',  p: [-2678, 21, 1042],   t: [-2650, 6, 1250],   fov: 40},
  {n: '新桥全貌 · 大小两段与折角', p: [-425, 355, 845], t: [-670, -3, 375],  fov: 40}
];

function installCams(ctx){
  /* 只在「单独跑 bridges」时接管机位：测试台的 8 个预设是在 plan 之前写的，
     全部落在离河 400m 开外的陆地上，对不准桥。和别人拼跑时不干预。 */
  const M = window.__MODS;
  if (!(M && M.length === 1 && M[0] === 'bridges')) return;

  /* 顺手把测试台的阴影框放大。测试台的太阳把 ±420m 的阴影框挂在它自己的
     cam.target 上，而本模块的机位指向 500~1000m 外的桥——桥有一半落在框外。
     three.js 对框外的片元一律判为「受光」，框内正常算阴影，于是同一排桥塔
     一半米白一半近黑，看起来像材质出了 bug。放大到能罩住整座桥，同时把
     阴影图加密到 4096 补回精度。只在「单跑 bridges」时改，拼跑与 paris.html
     走各自的自适应阴影框，这里够不着。 */
  ctx.scene.traverse((o) => {
    if (!o.isDirectionalLight || !o.castShadow) return;
    const sc = o.shadow.camera;
    sc.left = -1700; sc.right = 1700; sc.top = 1700; sc.bottom = -1700;
    sc.far = Math.max(sc.far, 5600);
    sc.updateProjectionMatrix();
    o.shadow.mapSize.set(4096, 4096);
    o.shadow.normalBias = 1.1;
    if (o.shadow.map){ o.shadow.map.dispose(); o.shadow.map = null; }
  });

  const label = document.getElementById('h-cam');
  addEventListener('keydown', (e) => {
    const i = parseInt(e.key, 10);
    if (isNaN(i) || !CAMS[i]) return;
    const c = CAMS[i];
    ctx.camera.fov = c.fov; ctx.camera.updateProjectionMatrix();
    ctx.camera.position.set(c.p[0], c.p[1], c.p[2]);
    ctx.camera.lookAt(c.t[0], c.t[1], c.t[2]);
    if (label) label.textContent = i + ' ' + c.n;
  });
}

PC.mod('bridges', {
  order: 30,
  label: '桥梁',

  async build(ctx){
    const {THREE: T3, scene, plan, palette, step, raf} = ctx;
    if (!plan || !plan.bridges) throw new Error('PC.plan.bridges 缺失');
    buildMats(palette);

    ROOT = new THREE.Group(); ROOT.name = 'bridges';
    scene.add(ROOT);

    /* 每种材质一个几何桶 → 最后合并成一个 mesh */
    const BUCKET = {stone: [], asphalt: [], iron: [], lampIron: [], steel: [], bronze: [], gilt: [], wood: [], frieze: [], glow: []};
    const stat = [];

    let done = 0;
    for (let bi = 0; bi < plan.bridges.length; bi++){
      const b = plan.bridges[bi];
      /* 这一座桥的岁月档案。形制不动，只决定它「经历了什么」。
         必须在任何 finishGB 之前设好——盖章在那里发生。 */
      PROF = bridgeProfile(b, plan, bi);
      const segs = makeSegments(b, plan);
      let tri = 0;

      for (let si = 0; si < segs.length; si++){
        const sg = segs[si];
        const G = {stone: newGB(), asphalt: newGB(), iron: newGB(), lampIron: newGB(), steel: newGB(),
                   bronze: newGB(), gilt: newGB(), wood: newGB(), frieze: newGB(), glow: newGB()};

        if (b.id === 'pont-alexandre-iii'){
          sg.parapet = 'balustrade';
          buildAlexandreIII(b, sg, G);
        } else {
          if (b.id === 'pont-neuf'){ sg.frieze = true; sg.lampPitch = 34; sg.pointedNose = true; }
          if (b.id === 'pont-des-arts'){ sg.deckWood = true; sg.parapet = 'iron-rail'; }
          if (b.id === 'pont-de-bir-hakeim'){ sg.parapet = 'iron-rail'; sg.lampPitch = 46; sg.steelRings = true; }
          buildSegment(sg, G, b);
          if (b.id === 'pont-neuf') pontNeufExtras(b, sg, G, si === 1);
          if (b.id === 'pont-de-bir-hakeim') birHakeimUpper(b, sg, G);
        }

        /* 局部 → 世界（绕 Y 转 angle 后 +X 与 dir 对齐；y 不变，顶点色可以先涂） */
        const M = new THREE.Matrix4()
          .makeTranslation(sg.ox, 0, sg.oz)
          .multiply(new THREE.Matrix4().makeRotationY(sg.angle));
        for (const k in G){
          const g = finishGB(G[k]);
          if (!g) continue;
          g.applyMatrix4(M);
          tri += g.index.count / 3;
          BUCKET[k].push(g);
        }
      }

      /* 岛上 terre-plein 与亨利四世像（世界坐标，不跟臂的折角走） */
      if (segs.island && b.id === 'pont-neuf'){
        const gS = newGB(), gB = newGB();
        const {x, z, half} = segs.island;
        const [dx, dz] = b.dir, px = -dz, pz = dx, w = b.deckW / 2 + 5;
        /* (沿轴 a, 横向 c) → 世界。aOut=侧边端点，aTip=中线尖端，ww=半宽 */
        const mk = (aOut, aTip, ww) => {
          const P = [];
          for (const [a, c] of [[-aOut, -ww], [aOut, -ww], [aTip, 0], [aOut, ww], [-aOut, ww], [-aTip, 0]])
            P.push([x + dx*a + px*c, z + dz*a + pz*c]);
          return P;
        };
        const k0 = gS.n;
        /* 西岱岛西端的石砌堤岸平台。它不是桥的一跨——底下是 Square du Vert-Galant
           的实土，本来就没有拱券，「中段没有拱」是这座桥的事实不是漏做。
           真正要修的是三件：
           ① 挡墙原来只砌到 −6.6，底面悬在水面 −8.6 之上 2m，相机一低就看穿；
           ② 两段桥身的桥台从平台底下探出一截，成了两块悬空的深色方块；
           ③ 32m 宽、7m 高的一面净墙没有任何横竖线脚，读起来像水坝。 */
        gS.prism(mk(half + 4, half + 9, w - 0.9), 1, Y_BASE, Y_BERGE + 0.3, 0.25);      // 水下护基：与挡墙同长，横向收 0.9m 留一道退台线
        gS.prism(mk(half + 4, half + 9, w), 1, Y_BERGE, 0.30, 0.25);                    // 挡墙主体
        gS.prism(mk(half + 4.4, half + 9.5, w + 0.42), 1, -1.05, 0.30, 0.25);           // 压顶线脚：外挑 0.42m，给墙一道横向阴影线
        /* 扶壁 contreforts：给墙一段一段的竖向节奏。做两级收分（下厚上薄），
           不然正午顺光下只是一条比周围深一点的色带，读不出体积。 */
        const nBut = Math.max(3, Math.round(half * 2 / 11));
        for (let i = 0; i <= nBut; i++){
          const a = -half - 2 + (2 * half + 4) * i / nBut;
          for (const c of [-w, w]){
            const sg2 = Math.sign(c) || 1;
            const put = (halfLen, out, y0, y1) => {
              const cOut = c + out * sg2, rect = [];
              for (const [da, cc] of [[-halfLen, c], [halfLen, c], [halfLen, cOut], [-halfLen, cOut]])
                rect.push([x + dx*(a+da) + px*cc, z + dz*(a+da) + pz*cc]);
              gS.prism(rect, 1, y0, y1, 0.25);
            };
            put(2.05, 1.55, Y_BERGE - 1.6, -3.9);   // 下段：厚
            put(1.55, 1.05, -3.9, -1.15);           // 上段：收一级，收分线接住压顶
          }
        }
        paintRange(gS, k0, gS.n, stoneTint);
        henriIV(gB, gS, x, z, Math.atan2(-dz, dx));
        for (const [k, g] of [['stone', gS], ['bronze', gB]]){
          /* 这两件是按世界坐标建的，局部 z 不是桥宽方向，没有上下游之分 */
          const geo = finishGB(g, true);
          if (geo){ tri += geo.index.count / 3; BUCKET[k].push(geo); }
        }
      }

      /* 桥面实长：两汊桥的两段都从岛心 O 起算、朝相反方向走，端到端 = sB₀ + sB₁ */
      const deckLen = segs.length === 2 && segs.island
        ? segs[0].sB + segs[1].sB
        : segs.reduce((a, s) => a + (s.sB - s.sA), 0);
      stat.push({桥: b.name, 年代: b.year, 形制: b.kind, 孔: b.arches,
                 段: segs.length, 三角: Math.round(tri),
                 岁月: +PROF.ageK.toFixed(3), 苔: +PROF.mossK.toFixed(3), 上游侧: PROF.upSign,
                 桥面长: Math.round(deckLen), 实长: b.lengthM});
      done++;
      if (done % 4 === 0){ if (step) step(0, '桥梁 · ' + b.name); await raf(); }
    }

    /* 合并成 mesh */
    let calls = 0, tris = 0;
    for (const k in BUCKET){
      const g = mergeC(BUCKET[k]);
      if (!g) continue;
      const m = new THREE.Mesh(g, MAT[k]);
      m.name = 'bridges.' + k;
      /* 只让承重的两桶投影：装饰件投影收益低、每个 mesh 一次阴影 pass */
      m.castShadow = (k === 'stone' || k === 'iron' || k === 'steel');
      m.receiveShadow = (k === 'stone' || k === 'asphalt' || k === 'iron' || k === 'steel' || k === 'wood');
      m.frustumCulled = false;
      ROOT.add(m);
      calls++; tris += g.index.count / 3;
    }

    console.log('[bridges] 共 ' + plan.bridges.length + ' 座 · 合并后 ' + calls +
                ' 个 mesh · ' + Math.round(tris).toLocaleString('en-US') + ' 三角');
    if (console.table) console.table(stat);
    PC._mods.bridges.stat = stat;      // 自校验用：逐桥三角数
    try { installCams(ctx); } catch(e){ console.warn('[bridges] 机位接管跳过', e); }
    return ROOT;
  },

  update(ctx, dt){
    /* 天黑点灯：一条材质的 emissive，零几何开销 */
    if (!GLOW || !ctx || !ctx.SUN) return;
    const h = ctx.SUN.hour;
    const night = clamp((h < 12 ? (8.0 - h) : (h - 17.2)) / 1.6, 0, 1);
    GLOW.emissiveIntensity = GLOW_DAY + night * GLOW_NIGHT;
  },

  setVisible(v){ if (ROOT) ROOT.visible = v; }
});

})();
