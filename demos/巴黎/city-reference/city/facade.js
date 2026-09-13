/* ══════════════════════════════════════════════════════════════════════════
   city/facade.js —— 奥斯曼街区（周边式街廓 + 立面贴图系统 + 曼萨屋顶 + 烟囱林）

   这一层负责把「106m 灰盒子」换成一座真的巴黎：一条檐口线、两条贯通阳台线、
   一片带烟囱的锌灰坡顶。规格全部照 city/data/haussmann.md，位置全部读 PC.plan。

   核心技术决策（三条，任何一条破了都会当场超预算或者变形）：

   ① 立面走贴图，不走几何。程序烤一张 2048² 图集（albedo/normal/roughness），
      横向切 10 条：H=20 三套、H=18 三套、H=15 两套、H=12 一套、内院素面一套。
      每条竖直方向按 plan.levelTables 的标高区间逐层画（RDC/entresol/noble/3e/4e/5e/檐口），
      **一条 = 一个开间 3.20m**，横向靠 fract() 在片元着色器里重复。
      重复的接缝落在窗间墙正中（那里是一片平石材），所以看不出来。
      面宽已被 plan 量化到开间整数倍，uv.x 直接取 parcel.bays，窗律不会被拉伸。

   ② 几何按街廓成环生成，不是逐 parcel 出棱柱。
      plan.stats.tris_measured 实测：逐 parcel 出棱柱全城 806k 三角，单这一层就吃光预算。
      这里的做法是：**墙按 parcel 出（每块一片 quad，保证每栋楼有自己的变体和石材色阶），
      檐口/屋顶/内院墙按街廓边出（保证同一条街檐口零误差对齐、屋面在转角正确斜接）**。
      屋顶用 block.poly 的四层等距内缩环（brisis 顶 / 屋脊 / 内 brisis 顶 / 内院沿），
      顶点一一对应，转角天然斜接，不会出现锯齿或裂缝。
      相邻两条街限高不同的转角，补一片沿角平分线的山墙（haussmann §10：错台不许抹平）。

   ③ 烟囱与天窗走实例池，按 PC.lod 分环填充。
      近环（<420m）出完整 souche（砌体座 + 一排陶土管），中环（<1100m）只出砌体座剪影。
      这是「宁可密不要疏」和三角预算之间唯一的解。

   实测（本层，非全场）：静态几何 222,700 三角 / 16 draw call（7 个 2600m 分片 ×
        墙+屋顶，再加天际线锚点的石作与屋面各一片），实例池 148,320 / 3 call
        （近烟囱 620×116 · 远剪影 5000×10 · 天窗 1200×22），LOD0 ≈1,800 / 3 call。
        合计 ≈37.3 万三角 / 22 call。
   ══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

const TAU = Math.PI * 2;
const ZTILE = 3.44;                      // 锌屋面贴图一格 = 8 条 tasseau（3.44m），屋面与亭顶共用
/* 一簇烟囱的陶土管：3–8 根。几何按满编 8 根烤**一件**，实际根数由顶点着色器收
   （多出来的管子塌成一条线，不出像素）。砌体座的长度跟着一起缩——三根管顶着
   一条八根管的座，鸟瞰整片屋顶就是一排缺牙。
   这三个数与 souche.onBeforeCompile 里的着色器共用，改一个就得三个一起动，
   所以做成常量往字符串里插，不写字面量。 */
const POT_MAX = 8, POT_PITCH = 0.26, SOUCHE_LEN = 0.30 + POT_PITCH * POT_MAX;
const D2R = Math.PI / 180;
const TAN12 = Math.tan(12 * D2R);
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/* ── 图集布局 ───────────────────────────────────────────────────────────
   10 条竖带 × 204.8px。前 9 条是临街立面，最后 1 条是内院素面（haussmann §12：
   内院不用 pierre de taille，用抹灰、无线脚、无阳台、窗更小更密）。
   第一轮只有 8 条、且 20/18 各只有两套，结果是一条 300m 的街上窗律、阳台位、
   底层黑玻璃带完全重复（审查评语原话「一栋楼复制了一千遍」）。
   这里把主力限高 20/18 各扩到 3 套、15 扩到 2 套，并且让「套」真的不一样——
   不只是换窗框颜色，而是粗琢范围/窗楣/百叶/托檐石间距一起变。 */
const ATLAS = 2048, COLS = 10, COLW = ATLAS / COLS;   // 204.8
const COL_OF_H  = {20: 0, 18: 3, 15: 6, 12: 8};       // 竖带起始列
const NVAR_OF_H = {20: 3, 18: 3, 15: 2, 12: 1};       // 每档限高的变体数
const COL_COURT = 9;

/* 石材色：ravalement（每 10 年洗一次立面，各家周期错开）产生的明度档。
   全部由 PC.palette 派生，色相锁在 38°–46°（haussmann §6.1）。
   stoneTones 的 5 档是**构件用色**（檐口/窗台/托座/踢脚），索引含义被下游依赖，不许动顺序。 */
function stoneTones(P){
  const c = h => new THREE.Color(h);
  const lt = c(P.limestoneLt), md = c(P.limestone), dk = c(P.limestoneDk);
  const fresh = lt.clone().lerp(new THREE.Color(1, 1, 1), 0.16);   // 刚洗完 ≈ #EDE4CE
  const aged  = md.clone().lerp(dk, 0.55);                          // 8–10 年 ≈ #C2B7A0
  return [fresh, lt, md, aged, dk];
}
/* ravalement 明度档（**整栋楼的墙色**，与上面的构件色分开）：7 档，只走明度，
   色相不动——七个人各调各的米白，一条街拼起来就会花。

   第三轮实测（截图 r1-2-street / r1-2b-street）：整条 300m 的街读成一片均值米白，
   一栋刚洗过的白房子都看不出来。查下来不是随机没做，是**档与档之间的明度差太小**。
   原来七档里前四档全挤在 232→217 这 6% 的范围里（lt / md.lerp(lt,.4) / md 三者几乎同色），
   而 soil 的实际取值又几乎全落在索引 1.5–3.0，于是整座城市只用到了那 6%。
   这里改成**等步长的一条梯子**：上半段 fresh→limestone、下半段 limestone→filthy。
   两端的绝对色仍然全部由 palette 的三个石灰岩色派生，积垢方向沿用 core.js 的
   GRIME_TARGET（0x4a443b），没有新编颜色。

   梯子为什么**不对称**（往上只留一点余量、往下走到近黑）：
   用 PIL 扫 r2p-A-elev.png 的立面像素行量过——9:00 直射光下墙面已经落在 sRGB 174–184，
   那一段 ACES + sRGB 编码的压缩率约 3.1 倍：材质上 ±17% 的差别到屏幕上只剩 ±5%，
   而 230 以上直接被削平。所以「让它更白」这条路是堵死的，一栋刚洗过的房子在画面里
   不可能比邻居更亮。真实巴黎看到的其实也正是这个：洗过的那栋是**正常的石灰岩色**，
   扎眼的是旁边几十年没排上队、已经黑掉的那几栋。于是往下拉到 lerp 0.55
   （屏幕上 184 → 121，一眼就是两栋楼），往上只留一点余量给黄昏和背阴面。 */
function ravTones(P){
  const c = h => new THREE.Color(h);
  const lt = c(P.limestoneLt), md = c(P.limestone), dk = c(P.limestoneDk);
  const fresh  = lt.clone().lerp(new THREE.Color(1, 1, 1), 0.42);  // 今年刚做完 ravalement
  const filthy = dk.clone().lerp(c(0x4a443b), 0.55);               // 几十年没排上队的那几栋
  const out = [];
  for (let i = 0; i < 3; i++) out.push(fresh.clone().lerp(md, i / 3));   // 0-2 洗过
  for (let i = 0; i < 4; i++) out.push(md.clone().lerp(filthy, i / 3));  // 3 标准 · 4-6 积垢
  return out;
}
/* 锌板包浆 4 档 + 板岩。全部由 palette.zinc / zincLt / slate 派生，
   HSL 饱和度一律 <8%——巴黎鸟瞰的核心印象是「均质的锌灰屋面」，
   屋面一旦上饱和色，从空中就变成彩色小镇（审查评语点名的那种）。
   前四档是一条**年龄带**（新 → 偏新 → 标准 → 老），屋面在它们之间连续插值；
   第五档板岩是「另一种材料」不是「更老」，只能整片抽，不能插值经过。

   第三轮修的两件事：
   ① 原来的第四档是「积灰偏暖」（往 limestoneDk 走），明度 118，比第二档的标准锌 106
      还**亮**——一条本来该单调下行的年龄带在末端拐了个头，屋面越老反而越亮。
   ② 四档只覆盖 121→93 这一段，从 1400m 高空看整片屋顶就是一张没有肌理的灰纸
      （截图 r1-3-city）。现在拉到 130→82，1.6 倍的明度比，鸟瞰才分得出新旧。
   ③ 四档的**步长必须均匀**。中间两档如果只差 8 个明度，而 zAge 的取值又集中在
      那两档之间，等于白搭——和 ravTones 踩的是同一个坑。130/114/98/82 是等差的。 */
function zincTones(P){
  const c = h => new THREE.Color(h);
  const z = c(P.zinc), zl = c(P.zincLt), sl = c(P.slate);
  return [
    z.clone().lerp(zl, 0.92),                          // 近年换过的新锌板，亮灰带蓝
    z.clone().lerp(zl, 0.30),                          // 偏新
    z.clone().lerp(sl, 0.25),                           // 标准（palette.zinc 就在这一档附近）
    z.clone().lerp(sl, 0.75),                           // 老锌，暗哑偏蓝
    sl.clone().lerp(c(0x3c4147), 0.35)                  // 板岩瓦（老楼、教堂、山墙面）
  ];
}
/* 「排场街」：只有这几级街道的切角上才配转角亭顶 */
const GRAND_KLASS = {boulevard: 1, avenue: 1, 'rue-majeure': 1, quai: 1};
/* 图集统一画在这个基准色上，顶点色再乘上「本栋 ÷ 基准」的比值。
   0.90 是压掉一档：直射光 + ACES 下 limestone 原色会白到没有石头味。 */
function paintBase(P){ return stoneTones(P)[2].clone().multiplyScalar(0.90); }
const hex = c => '#' + c.getHexString();

/* ══════════════════ 1. 立面图集 ══════════════════
   三张画布同步画：albedo（sRGB）/ normal / roughness。
   normal 只刻三样：窗洞凹陷、窗台出挑、束带出挑（haussmann §8）。 */
function bakeAtlas(P){
  const A = PC.canvas(ATLAS, ATLAS), N = PC.canvas(ATLAS, ATLAS), R = PC.canvas(ATLAS, ATLAS);
  const a = A.getContext('2d'), n = N.getContext('2d'), r = R.getContext('2d');
  const TONES = stoneTones(P);

  n.fillStyle = '#8080ff'; n.fillRect(0, 0, ATLAS, ATLAS);
  r.fillStyle = '#f2f2f2'; r.fillRect(0, 0, ATLAS, ATLAS);   // 石材 roughness .95

  const IRON = '#' + new THREE.Color(P.ironDk).getHexString();
  const GLASS = '#2b3138', GLASS_HI = '#4b555f';

  /* 变体风格表。「换个窗框颜色」不算变体——340m 外根本看不见窗框。
     真正拉开距离的是这四样：粗琢到哪一层、有没有百叶、窗楣做不做拱心石、
     托檐石多密。这四样都是**横向带状**的，不会破坏「竖带=一个开间」的 fract 循环。 */
  const VSTYLE = [
    /* v0 帝政标准型：深灰绿窗框 · 粗琢到 entresol 顶 · noble 层拱心石 · 托檐石 0.60 */
    {frame: '#3a423c', boss: 2, agrafe: 1, modil: 0.60, dw: 0.00, shutter: 0},
    /* v1 洗白型：象牙白窗框 · 只 RDC 粗琢 · 无拱心石 · 托檐石密 · 上层带百叶 */
    {frame: '#e4ded0', boss: 1, agrafe: 0, modil: 0.46, dw: 0.06, shutter: 1},
    /* v2 老街平砌型：暖褐窗框 · 不做粗琢 · 窗更窄 · 托檐石疏 · 全楼百叶 */
    {frame: '#5b4b3a', boss: 0, agrafe: 0, modil: 0.80, dw: -0.08, shutter: 2}
  ];
  /* 竖带定义（列序必须与 COL_OF_H / NVAR_OF_H 对齐）：0-2=H20 · 3-5=H18 · 6-7=H15 · 8=H12 · 9=内院 */
  const STRIPS = [
    {H: 20, v: 0}, {H: 20, v: 1}, {H: 20, v: 2},
    {H: 18, v: 0}, {H: 18, v: 1}, {H: 18, v: 2},
    {H: 15, v: 0}, {H: 15, v: 2},
    {H: 12, v: 1},
    {H: 18, v: 0, court: true}
  ];

  for (let ci = 0; ci < COLS; ci++){
    const S = STRIPS[ci];
    const lv = PC.plan.levelTables[S.H];
    const x0 = ci * COLW, PPMX = COLW / 3.20, PPMY = ATLAS / S.H;
    const MX = m => x0 + m * PPMX;                 // 米 → 带内 x
    const MY = m => ATLAS - m * PPMY;              // 米（离地）→ 画布 y（下为地面）
    /* 图集统一画在**基准色阶** TONES[2] 上，ravalement 的 5 档明度由顶点色带。
       两边都上色会把石材乘两次，整条街立刻掉进「灰混凝土」（haussmann §6.1 色相纪律）。 */
    const BASE = paintBase(P);
    const wall = S.court ? BASE.clone().lerp(new THREE.Color(0.72, 0.69, 0.63), 0.45) : BASE;
    const VS = VSTYLE[S.v] || VSTYLE[0];
    const frameCol = VS.frame;

    /* 底色 + 砌缝（缝进 roughness 不进 normal，haussmann §6.2） */
    a.fillStyle = hex(wall); a.fillRect(x0, 0, COLW, ATLAS);
    if (!S.court){
      const assise = 0.32 * PPMY;
      r.fillStyle = 'rgba(255,255,255,0.10)';
      for (let y = ATLAS; y > 0; y -= assise) r.fillRect(x0, y | 0, COLW, 1);
      a.fillStyle = 'rgba(0,0,0,0.045)';
      for (let y = ATLAS; y > 0; y -= assise) a.fillRect(x0, y | 0, COLW, 1);
    }

    /* 注意：这一条竖带 = **一个开间**，横向是靠 fract() 循环的。
       所以任何画在带边上的竖向元素（雨水立管痕、转角壁柱）都会每 3.2m 重复一次，
       整栋楼变成条纹布——第一轮实测就是这样。竖向脏污只能做成整带均匀的弱渐变。 */
    {
      const g = a.createLinearGradient(0, MY(S.H), 0, MY(0));
      g.addColorStop(0, 'rgba(120,112,94,0.20)'); g.addColorStop(0.5, 'rgba(120,112,94,0.07)');
      g.addColorStop(1, 'rgba(120,112,94,0.0)');
      a.fillStyle = g; a.fillRect(x0, 0, COLW, ATLAS);
    }

    /* ── 逐层 ── */
    const rows = lv.rows;
    for (let k = 0; k < rows.length; k++){
      const row = rows[k], y = row.y, h = row.h;
      const isRDC = k === 0;
      const isEntre = row.n === 'entresol';
      const balcony = lv.balcony.indexOf(k) >= 0 && !S.court;
      const rail = lv.rail.indexOf(k) >= 0 && !S.court;

      if (isRDC){
        drawRDC(k, row);
        continue;
      }
      /* 窗规格（haussmann §4）：越往上越矮越方 */
      let ww, wh, sill;
      if (isEntre){ ww = 1.15; wh = 1.35; sill = 0.95; }
      else if (balcony){ ww = k <= 2 ? 1.35 : 1.25; wh = k <= 2 ? 2.45 : 1.85; sill = 0.0; }
      else { ww = 1.30 - k * 0.01; wh = clamp(h - 0.95, 1.55, 2.15); sill = 0.90; }
      if (!S.court && !isEntre) ww += VS.dw;
      if (S.court){ ww = 0.95; wh = clamp(h - 1.15, 1.10, 1.55); sill = 1.00; }
      const wy = y + sill;
      window_(MX(1.60 - ww / 2), MY(wy + wh), ww * PPMX, wh * PPMY,
              isEntre ? 2 : (balcony && k <= 2 ? 3 : 1));
      /* 百叶 persiennes：折起来贴在窗洞两侧的两片木板。
         这是奥斯曼立面在 100–300m 距离上最容易被眼睛读到的「这栋不一样」，
         比窗框颜色有效得多——v2 全楼都有，v1 只有 3 层以上。 */
      if (!S.court && !isEntre && (VS.shutter === 2 || (VS.shutter === 1 && k >= 3)))
        shutters(MX(1.60 - ww / 2), MY(wy + wh), ww * PPMX, wh * PPMY);

      /* 束带 bandeau（haussmann §7）：楼板标高上一道贯通线脚 */
      if (!S.court && (balcony || isEntre)) bandeau(y, balcony ? 0.22 : 0.28);
      /* 单窗小栏杆 garde-corps */
      if (rail) railBand(MX(1.60 - (ww + 0.10) / 2), MY(wy + 0.95), (ww + 0.10) * PPMX, 0.95 * PPMY, 0.7);
      /* 贯通阳台：整条街面贯通，画满整格才能跨 parcel 连成一条线 */
      if (balcony) balconyBand(y);
    }
    cornice(S.H, lv.corniche);

    /* ── 绘制子程序（闭包，用到上面的 x0/PPM/S） ── */
    function window_(px, py, pw, ph, kind){
      /* kind: 1 普通窗 2 entresol 矮方窗 3 落地窗（porte-fenêtre） */
      const d = Math.max(2, 0.20 * PPMX * 0.5);
      /* 洞口内衬 */
      a.fillStyle = '#191c1f'; a.fillRect(px, py, pw, ph);
      /* 玻璃 + 反光渐变 */
      const g = a.createLinearGradient(px, py, px + pw, py + ph);
      g.addColorStop(0, GLASS_HI); g.addColorStop(0.45, GLASS); g.addColorStop(1, '#1e2429');
      a.fillStyle = g; a.fillRect(px + d, py + d, pw - 2 * d, ph - 2 * d);
      /* 木框 petit bois：双开 + 每扇 3 格 */
      a.strokeStyle = frameCol; a.lineWidth = Math.max(1.2, 0.045 * PPMX);
      a.beginPath();
      a.moveTo(px + pw / 2, py + d); a.lineTo(px + pw / 2, py + ph - d);
      const nb = kind === 2 ? 2 : 3;
      for (let i = 1; i < nb; i++){ const yy = py + d + (ph - 2 * d) * i / nb;
        a.moveTo(px + d, yy); a.lineTo(px + pw - d, yy); }
      a.stroke();
      a.strokeRect(px + d * 0.5, py + d * 0.5, pw - d, ph - d);
      /* 石窗台 appui：比洞口两侧各宽 0.08，出挑 0.12 */
      const sw = 0.08 * PPMX, st = 0.13 * PPMY;
      a.fillStyle = hex(TONES[1]); a.fillRect(px - sw, py + ph, pw + 2 * sw, st);
      a.fillStyle = 'rgba(90,84,70,0.5)'; a.fillRect(px - sw, py + ph + st, pw + 2 * sw, st * 0.6);
      /* 窗楣：noble 层带拱心石 agrafe（只有做这套线脚的变体才有） */
      if (kind === 3 && VS.agrafe){
        a.fillStyle = hex(TONES[1]);
        a.fillRect(MX(1.60) - 0.19 * PPMX, py - 0.40 * PPMY, 0.38 * PPMX, 0.44 * PPMY);
      }
      a.fillStyle = 'rgba(255,255,255,0.10)'; a.fillRect(px - sw * 0.6, py - st * 0.5, pw + 1.2 * sw, st * 0.5);

      /* roughness：玻璃 .18 */
      r.fillStyle = '#2e2e2e'; r.fillRect(px + d, py + d, pw - 2 * d, ph - 2 * d);
      /* normal：洞口四周的凹陷（左右上下四条侧壁） */
      recess(px, py, pw, ph, Math.max(2, d));
      n.fillStyle = '#80c0ff'; n.fillRect(px - sw, py + ph, pw + 2 * sw, Math.max(2, st * 0.7));
    }
    /* 折起来的百叶：窗洞两侧各一片，木色比墙深两档，中间刻两道板缝 */
    function shutters(px, py, pw, ph){
      const sw = Math.max(2.5, pw * 0.19);
      const woodA = 'rgba(74,80,72,0.86)', woodB = 'rgba(52,57,52,0.86)';
      for (const [bx, tone] of [[px - sw * 0.86, woodA], [px + pw - sw * 0.14, woodB]]){
        a.fillStyle = tone; a.fillRect(bx, py + ph * 0.02, sw, ph * 0.96);
        a.fillStyle = 'rgba(255,255,255,0.10)'; a.fillRect(bx, py + ph * 0.02, Math.max(1, sw * 0.28), ph * 0.96);
        a.fillStyle = 'rgba(18,20,18,0.45)'; a.fillRect(bx + sw - 1, py + ph * 0.02, 1.4, ph * 0.96);
      }
      r.fillStyle = '#a0a0a0';
      r.fillRect(px - sw * 0.86, py + ph * 0.02, sw, ph * 0.96);
      r.fillRect(px + pw - sw * 0.14, py + ph * 0.02, sw, ph * 0.96);
    }
    function recess(px, py, pw, ph, d){
      n.fillStyle = '#e880ff'; n.fillRect(px, py, d, ph);            // 左侧壁朝 +x
      n.fillStyle = '#1880ff'; n.fillRect(px + pw - d, py, d, ph);   // 右侧壁朝 −x
      n.fillStyle = '#8018ff'; n.fillRect(px, py, pw, d);            // 上侧壁朝 −y（画布上=世界上）
      n.fillStyle = '#80e8ff'; n.fillRect(px, py + ph - d, pw, d);   // 下侧壁朝 +y
    }
    function bandeau(ym, hm){
      const py = MY(ym + hm), ph = hm * PPMY;
      a.fillStyle = hex(TONES[1]); a.fillRect(x0, py, COLW, ph);
      a.fillStyle = 'rgba(78,72,60,0.42)'; a.fillRect(x0, py + ph, COLW, Math.max(1, ph * 0.35));
      n.fillStyle = '#8018ff'; n.fillRect(x0, py, COLW, 3);
      n.fillStyle = '#80e8ff'; n.fillRect(x0, py + ph - 3, COLW, 3);
    }
    function balconyBand(ym){
      /* 石板 0.18 + 栏杆 1.00（haussmann §5.1），整格贯通。
         这两道横线是 §14 检查清单第 10 条点名的四样东西之一——340m 外要还认得出来，
         所以板下的阴影线要压得够黑，否则一进 LOD1 就消失。 */
      const sy = MY(ym), st = 0.18 * PPMY;
      a.fillStyle = hex(TONES[0]); a.fillRect(x0, sy - st, COLW, st);
      a.fillStyle = 'rgba(46,42,34,0.72)'; a.fillRect(x0, sy, COLW, Math.max(2, st * 0.8));
      railBand(x0, MY(ym + 1.00), COLW, 1.00 * PPMY, 1.0);
      /* 托座 console：每个窗间墙下一个 */
      a.fillStyle = hex(TONES[3]);
      a.fillRect(x0 - 0.14 * PPMX, sy, 0.28 * PPMX, 0.45 * PPMY);
      a.fillRect(x0 + COLW - 0.14 * PPMX, sy, 0.28 * PPMX, 0.45 * PPMY);
      n.fillStyle = '#80e8ff'; n.fillRect(x0, sy - st, COLW, 3);
    }
    function railBand(px, py, pw, ph, dens){
      /* 铸铁栏杆：竖杆中心距 0.125，0.35–0.65 段鼓腹（barreaux ventrus） */
      /* haussmann §5.3：远景必须简化成一条**实心带**——1px 宽的镂空竖杆会闪成噪点。
         所以底子先压一层半透明铁色，竖杆只负责在上面留出节奏。 */
      const pitch = 0.125 * PPMX;
      a.save(); a.beginPath(); a.rect(px, py, pw, ph); a.clip();
      a.fillStyle = 'rgba(26,30,29,0.74)'; a.fillRect(px, py, pw, ph);
      a.fillStyle = IRON;
      for (let bx = px; bx < px + pw; bx += pitch){
        const bw = Math.max(2.0, 0.022 * PPMX);
        a.fillRect(bx, py, bw, ph);
        a.fillRect(bx - bw * 0.55, py + ph * 0.35, bw * 2.1, ph * 0.30);   // 鼓腹
      }
      a.fillRect(px, py, pw, Math.max(1.4, 0.05 * PPMY));                  // 上横带
      a.fillRect(px, py + ph * 0.50, pw, Math.max(1.2, 0.035 * PPMY));     // 中带
      a.fillRect(px, py + ph - Math.max(1.4, 0.05 * PPMY), pw, Math.max(1.4, 0.05 * PPMY));
      if (dens > 0.9){  // 中带上方一排棕叶饰
        a.globalAlpha = 0.75;
        for (let bx = px + pitch; bx < px + pw; bx += pitch * 2)
          a.fillRect(bx - pitch * 0.35, py + ph * 0.22, pitch * 0.7, ph * 0.12);
        a.globalAlpha = 1;
      }
      a.restore();
      r.fillStyle = '#8c8c8c'; r.fillRect(px, py, pw, ph);                 // 铁件 roughness .55
    }
    function drawRDC(k, row){
      const h = row.h;
      const commercial = !S.court && (S.H >= 18);
      if (S.court){
        a.fillStyle = 'rgba(0,0,0,0.10)'; a.fillRect(x0, MY(h), COLW, h * PPMY);
        window_(MX(1.60 - 0.45), MY(1.0 + 1.5), 0.90 * PPMX, 1.5 * PPMY, 1);
        return;
      }
      /* 底层石材粗琢 bossage：做到哪一层由变体决定（0=不做 / 1=到 RDC 顶 / 2=到 entresol 顶） */
      const bosH = VS.boss === 0 ? 0
                 : (VS.boss === 2 && S.H >= 18 ? rows[1].y + rows[1].h : h);
      if (bosH > 0){
        a.fillStyle = hex(TONES[3]); a.fillRect(x0, MY(bosH), COLW, bosH * PPMY);
        const assise = 0.32 * PPMY;
        for (let y = MY(0); y > MY(bosH); y -= assise){
          a.fillStyle = 'rgba(255,255,255,0.055)'; a.fillRect(x0, y - assise + 2, COLW, assise - 3);
          a.fillStyle = 'rgba(50,45,36,0.30)'; a.fillRect(x0, y - 2, COLW, 2);
        }
      }
      if (commercial){
        /* 店面：石踢脚 0.35 + 木框玻璃 + 招牌带 0.35 */
        const sgH = 0.35, top = h - 0.75, base = 0.35;
        a.fillStyle = '#1a1d1a'; a.fillRect(x0 + 0.10 * PPMX, MY(top), COLW - 0.20 * PPMX, (top - base) * PPMY);
        /* 橱窗玻璃别给太低的 roughness：0.18 会把整条街的天空反成一排蓝板子，
           近景（街道人视角）尤其明显。橱窗玻璃后面有货架和暗店堂，实际反射远没那么干净。 */
        const g = a.createLinearGradient(x0, MY(top), x0, MY(base));
        g.addColorStop(0, '#333a3e'); g.addColorStop(0.45, '#1d2225'); g.addColorStop(1, '#262b2d');
        a.fillStyle = g; a.fillRect(x0 + 0.24 * PPMX, MY(top - 0.16), COLW - 0.48 * PPMX, (top - base - 0.32) * PPMY);
        r.fillStyle = '#6b6b6b'; r.fillRect(x0 + 0.24 * PPMX, MY(top - 0.16), COLW - 0.48 * PPMX, (top - base - 0.32) * PPMY);
        a.fillStyle = '#' + new THREE.Color(P.shopPaints[(ci + 2) % P.shopPaints.length]).getHexString();
        a.fillRect(x0 + 0.10 * PPMX, MY(top), COLW - 0.20 * PPMX, 0.16 * PPMY);
        a.fillRect(x0 + 0.10 * PPMX, MY(base + 0.16), COLW - 0.20 * PPMX, 0.16 * PPMY);
        a.fillRect(x0 + 0.10 * PPMX, MY(top), 0.18 * PPMX, (top - base) * PPMY);
        a.fillRect(x0 + COLW - 0.28 * PPMX, MY(top), 0.18 * PPMX, (top - base) * PPMY);
        a.fillStyle = hex(TONES[4]); a.fillRect(x0, MY(base), COLW, base * PPMY);
        /* 招牌带：深色底 + 金色衬线字的抽象笔画 */
        a.fillStyle = '#171a18'; a.fillRect(x0, MY(h - 0.30), COLW, sgH * PPMY);
        a.fillStyle = '#' + new THREE.Color(P.gilt).getHexString();
        for (let i = 0; i < 7; i++)
          a.fillRect(x0 + COLW * (0.16 + i * 0.10), MY(h - 0.44), COLW * 0.045, sgH * PPMY * 0.42);
        recess(x0 + 0.10 * PPMX, MY(top), COLW - 0.20 * PPMX, (top - base) * PPMY, 4);
      } else {
        /* 老街窄型：住宅底层高窗 + 铸铁护栏 */
        window_(MX(1.60 - 0.65), MY(0.90 + 2.40), 1.30 * PPMX, 2.40 * PPMY, 1);
        railBand(MX(1.60 - 0.70), MY(0.90 + 0.95), 1.40 * PPMX, 0.95 * PPMY, 0.7);
        a.fillStyle = hex(TONES[4]); a.fillRect(x0, MY(0.35), COLW, 0.35 * PPMY);
      }
    }
    function cornice(H, cH){
      /* 主檐口：这一段贴图只负责颜色，真正的出挑阴影由几何提供 */
      const py = MY(H), ph = cH * PPMY;
      a.fillStyle = hex(TONES[0]); a.fillRect(x0, py, COLW, ph);
      a.fillStyle = 'rgba(255,255,255,0.12)'; a.fillRect(x0, py, COLW, ph * 0.30);
      /* 托檐石 modillons：间距按变体走（密的一档在 200m 外读成一条实影，疏的读成点线） */
      a.fillStyle = hex(TONES[3]);
      for (let bx = x0 + 0.10 * PPMX; bx < x0 + COLW; bx += VS.modil * PPMX)
        a.fillRect(bx, py + ph * 0.62, 0.16 * PPMX, ph * 0.38);
      a.fillStyle = 'rgba(58,53,43,0.55)'; a.fillRect(x0, py + ph, COLW, Math.max(2, ph * 0.28));
      n.fillStyle = '#8018ff'; n.fillRect(x0, py, COLW, 4);
      n.fillStyle = '#80e8ff'; n.fillRect(x0, py + ph - 4, COLW, 4);
    }
  }

  /* 全图叠一层细噪声（脏与不匀），用小噪声画布放大铺，避免逐像素 */
  const nz = PC.canvas(128, 128), nc = nz.getContext('2d');
  const img = nc.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++){
    const v = 118 + ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 44;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v | 0; img.data[i * 4 + 3] = 255;
  }
  nc.putImageData(img, 0, 0);
  a.globalCompositeOperation = 'overlay'; a.globalAlpha = 0.09;
  a.drawImage(nz, 0, 0, ATLAS, ATLAS);
  a.globalAlpha = 1; a.globalCompositeOperation = 'source-over';

  return {
    map: PC.texture(A, {clamp: true, srgb: true, aniso: 16}),
    normalMap: PC.texture(N, {clamp: true, aniso: 8}),
    roughnessMap: PC.texture(R, {clamp: true, aniso: 8})
  };
}

/* ══════════════════ 2. 锌屋面贴图 ══════════════════
   couverture à tasseaux：顺坡的木条盖缝凸线，中心距 0.43m。
   这些平行凸线是巴黎屋顶最强的中景纹理（haussmann §9.2）。 */
function bakeZinc(P){
  const S = 512, TILE = ZTILE;           // 一格 = 8 条 tasseau
  const A = PC.canvas(S, S), N = PC.canvas(S, S);
  const a = A.getContext('2d'), n = N.getContext('2d');
  const base = new THREE.Color(P.zinc);
  a.fillStyle = hex(base); a.fillRect(0, 0, S, S);
  /* 包浆斑驳。用 PC.rng 不用 Math.random：这张图每次开页都要重烤一遍，
     Math.random 会让同一个机位两次刷新出两张不一样的屋顶（确定性回归会直接抓到）。 */
  const rnd = PC.rng(9137);
  for (let i = 0; i < 220; i++){
    const x = rnd() * S, y = rnd() * S, rr = 6 + rnd() * 34;
    a.fillStyle = 'rgba(' + (rnd() > .5 ? '150,156,163' : '78,84,90') + ',0.05)';
    a.beginPath(); a.arc(x, y, rr, 0, TAU); a.fill();
  }
  n.fillStyle = '#8080ff'; n.fillRect(0, 0, S, S);
  const pitch = S / 8;
  for (let i = 0; i < 8; i++){
    const x = i * pitch;
    a.fillStyle = '#' + new THREE.Color(P.zincLt).getHexString();
    a.fillRect(x - 2, 0, 4, S);
    a.fillStyle = 'rgba(48,53,58,0.55)'; a.fillRect(x + 2, 0, 3, S);
    n.fillStyle = '#e880ff'; n.fillRect(x - 3, 0, 3, S);
    n.fillStyle = '#1880ff'; n.fillRect(x, 0, 3, S);
  }
  /* 横向搭接：每 2.2m 一道 */
  const lap = S * 2.2 / TILE;
  for (let y = 0; y < S; y += lap){
    a.fillStyle = 'rgba(40,45,50,0.35)'; a.fillRect(0, y, S, 2);
    a.fillStyle = 'rgba(160,166,172,0.22)'; a.fillRect(0, y + 2, S, 2);
    n.fillStyle = '#8018ff'; n.fillRect(0, y, S, 2);
  }
  return {
    map: PC.texture(A, {srgb: true, aniso: 8}),
    normalMap: PC.texture(N, {aniso: 8}),
    tile: TILE
  };
}

/* 锻铁栏杆的镂空贴图（LOD0 用 alphaTest 平面代替上千根竖杆几何） */
function bakeRail(P){
  const W = 128, H = 96, c = PC.canvas(W, H), g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.fillStyle = hex(new THREE.Color(P.ironDk));
  const pitch = W / 10;
  for (let i = 0; i < 10; i++){
    const x = i * pitch + pitch * 0.5;
    g.fillRect(x - 1.5, 0, 3, H);
    g.fillRect(x - 3.5, H * 0.34, 7, H * 0.30);          // 鼓腹
  }
  g.fillRect(0, 0, W, 5); g.fillRect(0, H * 0.48, W, 4); g.fillRect(0, H - 5, W, 5);
  const t = PC.texture(c, {srgb: true, aniso: 4});
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/* ══════════════════ 3. 几何缓冲 ══════════════════
   直接往扁平数组里推四边形，最后一次成 BufferGeometry。
   不逐块 new BufferGeometry 再 merge——41000 个 parcel 那样会先把内存打爆。 */
function Buf(withCol){
  return {p: [], nn: [], uv: [], cl: [], ac: [], ix: [], v: 0, withCol: withCol};
}
const _e1 = [0, 0, 0], _e2 = [0, 0, 0], _nr = [0, 0, 0];
/* q0..q3 = [x,y,z]，按环序给；uv = [u0,v0,u1,v1,u2,v2,u3,v3]；面朝向 want=[x,y,z]
   tint 可以是一个 Color（整片一色），也可以是四个 Color 的数组（逐角给色）。
   逐角是屋面「檐沟一侧脏、屋脊一侧净」的唯一实现路径——脏污本来就是个梯度，
   拆成两片 quad 去做会白白多一倍三角，而顶点色插值是免费的。
   flip 只改索引顺序、不改顶点顺序，所以第 i 个角永远还是 pts[i]。 */
function quad(B, q0, q1, q2, q3, uv, tint, acol, want){
  for (let i = 0; i < 3; i++){ _e1[i] = q1[i] - q0[i]; _e2[i] = q3[i] - q0[i]; }
  _nr[0] = _e1[1] * _e2[2] - _e1[2] * _e2[1];
  _nr[1] = _e1[2] * _e2[0] - _e1[0] * _e2[2];
  _nr[2] = _e1[0] * _e2[1] - _e1[1] * _e2[0];
  let L = Math.hypot(_nr[0], _nr[1], _nr[2]);
  if (L < 1e-9) return;
  _nr[0] /= L; _nr[1] /= L; _nr[2] /= L;
  let flip = false;
  if (want && (_nr[0] * want[0] + _nr[1] * want[1] + _nr[2] * want[2]) < 0){
    flip = true; _nr[0] = -_nr[0]; _nr[1] = -_nr[1]; _nr[2] = -_nr[2];
  }
  const v = B.v, pts = [q0, q1, q2, q3];
  const t4 = (tint && tint.length !== undefined) ? tint : null;
  for (let i = 0; i < 4; i++){
    B.p.push(pts[i][0], pts[i][1], pts[i][2]);
    B.nn.push(_nr[0], _nr[1], _nr[2]);
    B.uv.push(uv[i * 2], uv[i * 2 + 1]);
    if (B.withCol){ const t = t4 ? t4[i] : tint;
      B.cl.push(t.r, t.g, t.b); B.ac.push(acol); }
  }
  if (flip) B.ix.push(v, v + 2, v + 1, v, v + 3, v + 2);
  else      B.ix.push(v, v + 1, v + 2, v, v + 2, v + 3);
  B.v += 4;
}
/* 三顶点面。攒尖顶/山花/尖顶全是三角形，用 quad 塞两个重合点会白搭一半索引——
   全城两千多个亭顶，那一半就是三万个空三角。 */
function tri(B, q0, q1, q2, uv, tint, acol, want){
  for (let i = 0; i < 3; i++){ _e1[i] = q1[i] - q0[i]; _e2[i] = q2[i] - q0[i]; }
  _nr[0] = _e1[1] * _e2[2] - _e1[2] * _e2[1];
  _nr[1] = _e1[2] * _e2[0] - _e1[0] * _e2[2];
  _nr[2] = _e1[0] * _e2[1] - _e1[1] * _e2[0];
  const L = Math.hypot(_nr[0], _nr[1], _nr[2]);
  if (L < 1e-9) return;
  _nr[0] /= L; _nr[1] /= L; _nr[2] /= L;
  let flip = false;
  if (want && (_nr[0] * want[0] + _nr[1] * want[1] + _nr[2] * want[2]) < 0){
    flip = true; _nr[0] = -_nr[0]; _nr[1] = -_nr[1]; _nr[2] = -_nr[2];
  }
  const v = B.v, pts = [q0, q1, q2];
  for (let i = 0; i < 3; i++){
    B.p.push(pts[i][0], pts[i][1], pts[i][2]);
    B.nn.push(_nr[0], _nr[1], _nr[2]);
    B.uv.push(uv[i * 2], uv[i * 2 + 1]);
    if (B.withCol){ B.cl.push(tint.r, tint.g, tint.b); B.ac.push(acol); }
  }
  if (flip) B.ix.push(v, v + 2, v + 1); else B.ix.push(v, v + 1, v + 2);
  B.v += 3;
}
function bufToGeo(B){
  if (!B.v) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nn, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
  if (B.withCol){
    g.setAttribute('color', new THREE.Float32BufferAttribute(B.cl, 3));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(B.ac, 1));
  }
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(B.ix), 1));
  g.computeBoundingSphere();
  return g;
}

/* 转角亭顶：八角鼓座 + 攒尖，写进屋面缓冲（走同一张锌贴图，零新增 draw call）。
   24 个三角形一座，全城约 830 座 ≈ 2 万三角——买一条不再是直尺的天际线，很便宜。
   只长在大道/林荫道/主街/滨河路的切角上：小巷转角本来就不做这个排场，
   而且第一轮不分街道等级地长了 2200 座，光这一项就吃掉 7 万三角。 */
function pavilion(B, cx, cy, cz, r, h, tSide, tTop){
  const SEG = 8, hd = r * 0.55, ap = [cx, cy + hd + h, cz];
  const px = [], pz = [];
  for (let i = 0; i <= SEG; i++){
    const t = i / SEG * TAU;
    px.push(cx + Math.cos(t) * r); pz.push(cz + Math.sin(t) * r);
  }
  const uStep = (TAU * r / SEG) / ZTILE, vD = hd / ZTILE, vC = Math.hypot(h, r) / ZTILE;
  for (let i = 0; i < SEG; i++){
    const u0 = i * uStep, u1 = (i + 1) * uStep;
    const ox = (px[i] + px[i + 1]) / 2 - cx, oz = (pz[i] + pz[i + 1]) / 2 - cz;
    /* 鼓座 */
    quad(B, [px[i], cy, pz[i]], [px[i + 1], cy, pz[i + 1]],
            [px[i + 1], cy + hd, pz[i + 1]], [px[i], cy + hd, pz[i]],
         [u0, 0, u1, 0, u1, vD, u0, vD], tSide, 0, [ox, 0, oz]);
    /* 坡面 */
    tri(B, [px[i], cy + hd, pz[i]], [px[i + 1], cy + hd, pz[i + 1]], ap,
        [u0, vD, u1, vD, (u0 + u1) / 2, vD + vC], tTop, 0, [ox, r, oz]);
  }
}

/* 逐边等距内缩，**顶点数恒定**（不丢点），保证四层环顶点一一对应。
   core.js 的 PC.poly.inset 会在退化处丢点，屋顶要的是严格对应，所以这里自己写一份。 */
function insetN(p, d){
  const n = p.length, out = new Array(n);
  const s = PC.poly.area(p) >= 0 ? 1 : -1;
  for (let i = 0; i < n; i++){
    const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
    let n1x = b[1] - a[1], n1z = a[0] - b[0], n2x = c[1] - b[1], n2z = b[0] - c[0];
    const l1 = Math.hypot(n1x, n1z) || 1, l2 = Math.hypot(n2x, n2z) || 1;
    n1x = n1x / l1 * s; n1z = n1z / l1 * s; n2x = n2x / l2 * s; n2z = n2z / l2 * s;
    let bx = n1x + n2x, bz = n1z + n2z;
    const lb = Math.hypot(bx, bz);
    if (lb < 1e-6){ out[i] = [b[0], b[1]]; continue; }
    const cosH = Math.max(0.34, lb / 2);
    out[i] = [b[0] - bx / lb * d / cosH, b[1] - bz / lb * d / cosH];
  }
  return out;
}
/* 一条边有没有被「吃穿」：内缩后它掉了个头。
   这是 straight skeleton 的 edge event，也是屋面飞白三角的唯一来源——
   短边（转角切角 pan coupé、街廓端头）先于长边消失，naive miter 不会删它，
   而是把它翻过来，环就成了蝴蝶结。 */
function edgeFlipped(P, r, i, j){
  const ox = P[j][0] - P[i][0], oz = P[j][1] - P[i][1];
  const rx = r[j][0] - r[i][0], rz = r[j][1] - r[i][1];
  return (ox * rx + oz * rz) < 0;
}
/* 把被吃穿的边就地收成一个点（edge event 的廉价近似）。
   **顶点数一个都不能少**——四层环一一对应是屋面转角不裂缝的前提，
   所以不是删点，是让这条边的两个端点重合：它生成的四边形自然退化，quad() 会跳过。
   收完一条可能牵连相邻边，所以最多迭代 4 轮。 */
function healRing(P, r){
  const n = P.length;
  for (let pass = 0; pass < 4; pass++){
    let hit = false;
    for (let i = 0; i < n; i++){
      const j = (i + 1) % n;
      if (!edgeFlipped(P, r, i, j)) continue;
      const mx = (r[i][0] + r[j][0]) / 2, mz = (r[i][1] + r[j][1]) / 2;
      r[i] = [mx, mz]; r[j] = [mx, mz];
      hit = true;
    }
    if (!hit) break;
  }
  return r;
}
/* 安全环：内缩量一旦逼近真实内切圆，insetN 会折成蝴蝶结——屋面就会飞出几片白三角，
   烟囱也会跟着飘到街上（第一轮机位 7 实拍到的那一撮）。
   凸性判据（重心到边的最小距离）对细长三角形是高估的，所以这里不靠它，直接验结果。
   顺序：先 healRing 消掉被吃穿的边（这一步救回绝大多数街廓，屋面深度不用缩），
   救不回来的（面积塌了 / 朝向翻了 / 顶点跑到原多边形外）才整环收成重心
   （屋顶自然变成攒尖顶，小街廓上这也对）。
   面积判据必须用**带符号比值**：只写 area(r) < 25，遇到顺时针的街廓会全城误判。 */
function safeRing(P, d, cen){
  const r = healRing(P, insetN(P, d));
  const aP = PC.poly.area(P), aR = PC.poly.area(r);
  let bad = !(aR * aP > 0) || Math.abs(aR) < 25;
  if (!bad) for (const v of r) if (!PC.poly.contains(P, v[0], v[1])){ bad = true; break; }
  if (!bad) for (let i = 0, n = r.length; i < n; i++)
    if (edgeFlipped(P, r, i, (i + 1) % n)){ bad = true; break; }
  if (!bad) return r;
  const o = new Array(P.length);
  for (let i = 0; i < P.length; i++) o[i] = [cen[0], cen[1]];
  o.collapsed = true;
  return o;
}
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

/* ══════════════════ 4. 模块 ══════════════════ */
let ROOT = null, POOLS = null, SITES = null, GRID = null, LOD0 = null;

PC.mod('facade', {
order: 40,
label: '奥斯曼街区',

async build(ctx){
  const {THREE: T, scene, plan, palette: P, step, raf} = ctx;
  if (!plan || !plan.blocks || !plan.blocks.length) throw new Error('plan.blocks 为空');

  ROOT = new T.Group(); ROOT.name = 'facade'; scene.add(ROOT);

  /* ── 4.1 贴图与材质 ── */
  step(0, '奥斯曼街区 · 烘焙立面图集'); await raf();
  const atlas = bakeAtlas(P);
  await raf();
  const zinc = bakeZinc(P);
  const TONES = stoneTones(P);
  const SC = c => c.clone().convertSRGBToLinear();

  const facadeMat = new T.MeshStandardMaterial({
    map: atlas.map, normalMap: atlas.normalMap, roughnessMap: atlas.roughnessMap,
    normalScale: new T.Vector2(1.05, 1.05),
    roughness: 1.0, metalness: 0.0, vertexColors: true, envMapIntensity: 0.45
  });
  /* 图集横向 10 条，每条 = 一个开间。开间重复必须在**片元**里做：
     在顶点里 fract 会被插值抹平（整片墙只剩一个开间的颜色）。
     所以把原始 uv 与竖带号透传成 varying，进片元再折回条内。 */
  facadeMat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <uv_pars_vertex>', '#include <uv_pars_vertex>\nattribute float aCol; varying vec2 vUvRaw; varying float vColV;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvUvRaw=uv;vColV=aCol;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <uv_pars_fragment>', '#include <uv_pars_fragment>\nvarying vec2 vUvRaw; varying float vColV; vec2 atlasUv;')
      .replace('void main() {', 'void main() { atlasUv=vec2((vColV+fract(vUvRaw.x))*' + (1/COLS).toFixed(8) + ',clamp(vUvRaw.y,0.0005,0.9995));');
    for (const [chunk, variable] of [['map_fragment','vMapUv'],['normal_fragment_maps','vNormalMapUv'],['roughnessmap_fragment','vRoughnessMapUv']]) {
      sh.fragmentShader=sh.fragmentShader.replace('#include <'+chunk+'>',T.ShaderChunk[chunk].replaceAll(variable,'atlasUv'));
    }
  };

  /* PC.mats().zinc 是 roughness .62 / metalness .45 / env .85——那组值对**竖直**的锌面对，
     但曼萨屋顶的 terrasson 是朝天的，同一组值下会把整片天空反上来，从空中看变成一片白。
     所以这里压 metalness 与 env，颜色仍然是 palette.zinc（贴图里已经上过）。 */
  /* 屋面必须双面。相机贴着 15m 高度飞过城市时一定会穿进街廓内部（机位 7 就正好落在
     一个街廓里），单面屋顶从下面看被背面剔除掉，天空直接透过来，坐在屋脊上的烟囱和
     角亭就变成一排「悬空漂在天上」的方块——审查报告 t-facade-7 的 blocker 就是这个。
     双面不多一个三角形、不多一个 draw call；背面朝下、天光照不到，自然是暗的屋顶内面。 */
  const roofMat = new T.MeshStandardMaterial({
    map: zinc.map, normalMap: zinc.normalMap,
    normalScale: new T.Vector2(0.8, 0.8),
    color: 0xffffff, roughness: 0.70, metalness: 0.26,
    side: T.DoubleSide,
    vertexColors: true, envMapIntensity: 0.50
  });
  const souche = new T.MeshStandardMaterial({vertexColors: true, roughness: 0.92, metalness: 0.0,
                                             envMapIntensity: 0.35});
  /* 逐实例改**几何**：管子根数 3–8（砌体座跟着缩）+ 戴不戴风帽。
     另一条路是多开几个池分别装 3 根 / 5 根 / 8 根，那要多几个 draw call——
     全场只剩 3–4 个额度，不值得花在这里。顶点着色器里收管子是零 draw call 的。
     aVary.z 打包两件事：低 4 位是根数（3–8），第 5 位是风帽标志（+16）。 */
  souche.onBeforeCompile = sh => {
    sh.vertexShader = 'attribute vec3 aPot;\n' + sh.vertexShader
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n'
      + ' {\n'
      + '  float nP = mod(aVary.z, 16.0);\n'
      + '  float cowl = step(16.0, aVary.z);\n'
      + '  if (aPot.x < 0.5) { transformed.x *= (0.30 + ' + POT_PITCH.toFixed(3)
      +      ' * nP) / ' + SOUCHE_LEN.toFixed(3) + '; }\n'
      + '  else if (aPot.x > nP + 0.5) { transformed.x = aPot.y; transformed.z = 0.0; }\n'
      + '  else {\n'
      + '   if (cowl > 0.5 && aPot.z > 0.5) {\n'
      + '    transformed.x = aPot.y + (transformed.x - aPot.y) * 1.9;\n'
      + '    transformed.z *= 1.9;\n'
      + '    transformed.y += 0.035;\n'
      + '   }\n'
      /* 留下的 nP 根管重新对中：满编时管排中心在 0，收掉尾巴后要整排右移回去 */
      + '   transformed.x += ' + (POT_PITCH / 2).toFixed(3)
      +      ' * (' + (POT_MAX + 1).toFixed(1) + ' - nP);\n'
      + '  }\n'
      + ' }\n');
  };
  /* 再叠一层逐实例风化：座底积污（雨溅）、朝上的面被烟炱糊住、整体随龄褪色。
     磨损色故意给成暗色——烟囱朝上的那几个面越老越黑，不是越老越白。 */
  PC.varyShader(souche, {y0: 0.05, y1: 1.55, wearColor: 0x413a33, key: 'souche'});
  /* 栏杆与阳台石板都改成顶点色驱动：材质色留白，逐栋的锻铁氧化度 / 洗墙年份
     由几何顶点带。这两片本来就在同一个 draw call 里，逐栋上色不多花一分钱。 */
  const railMat = new T.MeshStandardMaterial({map: bakeRail(P), transparent: false, alphaTest: 0.45,
    side: T.DoubleSide, color: 0xffffff, vertexColors: true, roughness: 0.55, metalness: 0.55});

  /* ── 4.2 静态几何（按 2600m 分片，7 片） ── */
  step(0, '奥斯曼街区 · 生成街廓'); await raf();
  const CS = 2600, BB = plan.bbox;
  const chunks = {};
  const chunkOf = (x, z) => {
    const k = (((x - BB[0]) / CS) | 0) + '_' + (((z - BB[1]) / CS) | 0);
    return chunks[k] || (chunks[k] = {w: Buf(true), r: Buf(true)});
  };

  const sites = [];       /* 烟囱 / 天窗的候选点，LOD 填池时用 */
  const CH_SOUCHE = SC(new T.Color(0xb0a794));       // souche 抹灰（石灰岩族更灰更脏）
  const CH_SOOTY  = SC(new T.Color(0x9a9081));       // 背阴/水痕的一侧
  /* 顶点色是**相对基准贴图色的比值**，不是绝对色——贴图已经上过一次色了 */
  const ratio = (c, base) => new T.Color(c.r / base.r, c.g / base.g, c.b / base.b);
  /* 原地版：热路径上每块地块都要算一次，不能每次 new 一个 Color */
  const ratioInto = (c, base, out) => out.setRGB(c.r / base.r, c.g / base.g, c.b / base.b);
  const STONE_BASE = SC(paintBase(P)), ZINC_BASE = SC(new T.Color(P.zinc));
  const RAV = ravTones(P);
  const WHITE = new T.Color(1, 1, 1);
  const T_CORNICE = ratio(SC(TONES[0]), STONE_BASE);
  const T_GABLE = ratio(SC(TONES[3]), STONE_BASE);
  const MOSS_LIN = SC(new T.Color(0x5a6b3e));

  /* ══ 洗墙年份：普通街区立面差异的主维度 ══════════════════════════════
     1859 年的巴黎立面本来就是同一种石头、同一套线脚、同一条檐口线——真正把一条街
     拉开的不是形制，是**上次 ravalement 是哪一年**（1962 马尔罗法之后强制十年一洗，
     各家各排各的队）。洗过的是明亮的暖米黄，几十年没排上队的是灰黑的积垢色。

     第二轮的写法是 `hash2(s0)*7|0`：七档均匀抽，没有批次、没有场域、没有长尾。
     结果是整条街读成一片均值米白——每栋都不一样，但每栋都一样地不一样，
     那还是噪声，只是换了一种噪声。这里换成三项相加：
       ① 街道批次——同一条街的洗墙是同期做的（PC.vary 里 batch 占 70% 权重）
       ② 个体长尾——同一条街上总有一两栋刚洗完的白房子、一两栋几十年没排上队的
       ③ 场域——临河水汽车流脏得快；好街区维护勤（prestige 已折进 prof.age）
     档位**连续**插值，不再量化：量化成 7 档后 300m 的街上仍会读出「隔两栋一个同色」。 */
  const AGE_MAX = PC.vary.RATES.stone.age * 1.24;      // prof.age 的理论上限
  /* 长尾偏移：把均匀值折成「中间厚、两端稀」的带符号量。
     u 在 [0,1) 均匀 → |2u−1| 在 [0,1) 均匀 → 取 2.3 次幂压向 0，再带回符号。
     实测占比：|dev|<0.33 占 63%（这一批的标准件），|dev|>0.60 占 20%，
     |dev|>0.80 占 9.4%（一条街上扎眼的那一两栋）。 */
  function tailDev(u){
    const t = u * 2 - 1;
    return PC.vary.tail(t < 0 ? -t : t, 2.3) * (t < 0 ? -1 : 1);
  }
  /* soil = 批次均值 + 个体长尾。
     批次（这条街上次集体洗墙是哪一年，由 prof.age 带，age 里已经含 70% 的 roadId 分量
     和 prestige 场域）定这条街的**基调**，个体长尾定谁比邻居白、谁比邻居黑。

     第二轮的配比是 0.46×age + 0.44×(0.5+dev/2)，个体分量的有效摆幅只有 ±0.11，
     叠上原来那条挤在一起的 7 档色带，最终一条街的明度差不到 4%——等于没做。
     现在个体摆幅给到 ±0.52：63% 的楼落在街道基调 ±0.17 内（还是「一条街一个调」），
     9.4% 甩出 ±0.42，跨过三档色——屏幕上就是那栋洗过的和那栋黑掉的。 */
  function ravSoil(prof){
    return clamp(0.34 + 0.32 * clamp(prof.age / AGE_MAX, 0, 1)
               + 0.52 * tailDev(prof.f(7))
               + 0.15 * prof.riverside, 0, 1);
  }
  const _rc = new T.Color(), _rt = new T.Color();
  /* soil 0=今年刚洗完 → 1=几十年的积垢；north=朝北背阴（压暗 + 更容易长苔）。
     这一份出的是**绝对线性色**，远景的 ravTint（走图集，要的是比值）与近景的
     LOD0.ravAbs（没有图集打底，要的是绝对色）都从这里派生——两处各写一遍
     就一定会在某次调色时分叉，相机推过 340m 时整栋楼换一次色。 */
  function ravColor(soil, moss, north, out){
    const t = clamp(soil, 0, 1) * (RAV.length - 1);
    const i = Math.min(RAV.length - 2, t | 0);
    out.copy(RAV[i]).lerp(RAV[i + 1], t - i).convertSRGBToLinear();
    /* 朝北背阴：压暗一档，再垫一层薄苔。moss 在内陆几乎恒为 0（core.js 的
       moss 公式里 riverside 权重占 0.75），所以这里给一个不依赖 moss 的地板值，
       否则「北立面发青」这条只在临河那一圈成立，城里全看不到。 */
    if (north){ out.multiplyScalar(0.93); out.lerp(MOSS_LIN, 0.05 + moss * 0.30); }
    else if (moss > 0.02) out.lerp(MOSS_LIN, moss * 0.16);
    return out;
  }
  function ravTint(soil, moss, north, out){
    return ratioInto(ravColor(soil, moss, north, _rc), STONE_BASE, out);
  }

  /* ══ 锌屋面：包浆年份 ═══════════════════════════════════════════════
     ZP 的前四档是一条等步长的年龄带（新锌亮灰带蓝 → 偏新 → 标准 → 老锌暗哑），
     第五档是板岩，属于「它是另一种材料」不是「它更老」，所以单独少量抽。
     批次 = 街廓（一个街廓的屋面常常同期翻修），个体 = 街廓的每一条边——
     转角处两片屋面换色是真实航拍里到处都是的分户缝，不是接缝 bug。 */
  const ZP_LIN = zincTones(P).map(c => SC(c));
  const _zc = new T.Color();
  /* age 0=刚换的亮锌 → 1=几十年的老锌；slate=改用板岩瓦 */
  function zincCol(age, slate, mul, out){
    if (slate) _zc.copy(ZP_LIN[4]);
    else { const u = clamp(age, 0, 1) * 3, i = Math.min(2, u | 0);
           _zc.copy(ZP_LIN[i]).lerp(ZP_LIN[i + 1], u - i); }
    if (mul !== 1) _zc.multiplyScalar(mul);
    return ratioInto(_zc, ZINC_BASE, out);
  }
  /* 屋面一条边要四个颜色对象（檐口脏 / 屋脊净 × 坡面 / terrasson），全部复用 */
  const _zB = new T.Color(), _zBd = new T.Color(), _zT = new T.Color(), _zTd = new T.Color();
  const _zqA = [_zBd, _zBd, _zB, _zB];      // 外 brisis：檐沟一侧脏，brisis 顶净
  const _zqB = [_zB, _zB, _zBd, _zBd];      // 内 brisis：反过来
  const _ztA = [_zT, _zT, _zTd, _zTd];      // terrasson 上行：屋脊一侧脏（烟囱烟炱）
  const _ztB = [_zTd, _zTd, _zT, _zT];      // terrasson 下行：反过来

  /* ══ 烟囱：陶土管色族 ═══════════════════════════════════════════════
     souche 的几何是**一件**（近环 620 座共用一个 geometry），所以颜色差异只能走
     instanceColor——它乘在烘焙好的顶点色上，不增加一个 draw call。
     一个乘数同时作用在砌体座和陶土管上，这不是妥协：烟炱不挑材料，
     一座被熏黑的烟囱是连座带管一起黑的。 */
  const TERRA = PC.families.terracotta;
  const CH_BASE = SC(new T.Color(P.chimney));
  const CH_AGE_MAX = PC.vary.RATES.chimney.age * 1.24;
  const SOOT_LIN = SC(new T.Color(0x4a443b));       // core.js 的积垢方向色，不另编一个黑
  const _chc = new T.Color();
  /* 第二轮直接用 PC.vary.shade：它的褪色/积垢幅度是给桌椅遮阳篷调的（fade .42、
     grime .34），落到 chimney 这一类身上净效果只有 ±8%，一片屋顶上的烟囱全是
     同一个米白块（截图 r1-1b-roofclose / r1-2b-street）。
     烟囱的主导变量不是「褪色」是**烟熏**——常年烧壁炉的老烟道会黑到看不出陶土，
     刚砌的偏橙红。所以单独拉一条 soot 轴，同样用长尾整形：
     约 63% 落在 soot 0.42±0.13（背景里那片暖灰），各约 4.7% 甩到近黑和纯橙红两端。
     soot 走平方再乘，是为了让「大多数只是轻微发暗、少数才真的黑」——
     线性的话中位数就已经脏得看不出陶土色了。
     一个乘数同时作用在砌体座和陶土管上：烟炱不挑材料，一座被熏黑的烟囱是连座带管
     一起黑的。 */
  function chimneyTint(prof, out){
    const soot = clamp(0.22 + 0.50 * clamp(prof.age / CH_AGE_MAX, 0, 1)
                     + 0.40 * tailDev(prof.f(163)), 0, 1);
    _chc.set(prof.pick(TERRA, 149)).convertSRGBToLinear();
    _chc.lerp(SOOT_LIN, soot * soot * 0.90);
    return ratioInto(_chc, CH_BASE, out);
  }

  let nb = 0;
  for (const b of plan.blocks){
    const B = chunkOf(b.centroid[0], b.centroid[1]);
    buildBlock(b, B.w, B.r, nb);
    if ((++nb % 220) === 0){ step(0, '奥斯曼街区 · 街廓 ' + nb + '/' + plan.blocks.length); await raf(); }
  }

  function buildBlock(b, W, R, bid){
    const Pg = b.poly, n = Pg.length;
    if (n < 3) return;
    const cen = b.centroid, ir = inradius(Pg, cen);
    /* 街廓绕向：plan 的约定是逆时针（实测 1382 个全部 area>0），但朝外法线是整层楼
       「哪一面是正面」的唯一依据——一旦哪天 plan 吐出一个顺时针环，这一片墙的正面
       就会翻进内院，从街上直接看穿到街廓里侧（审查员在 plan 预览图上抓到的正是这个像）。
       所以不假设绕向，就地取符号；面全部单面渲染，不靠 DoubleSide 兜底。 */
    const wind = PC.poly.area(Pg) >= 0 ? 1 : -1;
    if (ir < 3.0) return;
    /* 建筑带宽 = 到内院的距离（plan 已按「内院占街廓 18–30%」反解好） */
    let band = b.court ? b.courtInset : Math.min(b.depth * 1.55, ir * 0.90);
    band = Math.min(band, ir * 0.94);
    if (band < 5.5) band = Math.min(5.5, ir * 0.94);
    /* brisis 垂直上升高度：haussmann §9.1，terrasson 至少留 3m */
    const hB = clamp(Math.min(4.80, (band - 3.0) / 2), 1.2, 4.80);
    const rr = hB + TAN12 * Math.max(0, band / 2 - hB);   // 屋脊比檐口高多少

    const R1 = safeRing(Pg, hB, cen), R2 = safeRing(Pg, band / 2, cen),
          R3 = safeRing(Pg, band - hB, cen), R4 = safeRing(Pg, band, cen);

    const runByEdge = {};
    let hSum = 0;
    for (const r of b.runs){ runByEdge[r.edge] = r; hSum += r.H; }
    const hAvg = b.runs.length ? hSum / b.runs.length : 18;

    let yFloor = Infinity;
    for (const q of b.parcels) if (q.y0 < yFloor) yFloor = q.y0;
    if (!isFinite(yFloor)) yFloor = b.y0;
    const yBot = yFloor - 1.6;

    const courtTint = WHITE;      // 内院条已经画成抹灰色，顶点色保持中性
    const courtCol = COL_COURT;
    /* 街廓这一批屋面的「上次翻修距今」：批次分量在这里定，个体分量逐边再抽 */
    const bRoof = PC.vary.of('stone', cen[0], cen[1], bid);
    const bRoofAge = clamp(bRoof.age / AGE_MAX, 0, 1);

    for (let i = 0; i < n; i++){
      const a = Pg[i], c = Pg[(i + 1) % n];
      const dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz);
      if (L < 0.8) continue;
      const ux = dx / L, uz = dz / L, nx = uz * wind, nz = -ux * wind;   // 朝街外（绕向已归一）
      const run = runByEdge[i];
      const H = run ? run.H : hAvg;
      const cH = plan.levelTables[H] ? plan.levelTables[H].corniche : 0.9;
      const yE = b.y0 + H;                                    // 檐口顶（同街同高，构造保证）
      const e = clamp(cH * 0.80, 0.50, 0.90);                 // 檐口出挑（§7：<0.5 就读成贴皮盒子）
      const wantOut = [nx, 0, nz];

      /* 墙：逐 parcel 一片，每栋楼一个变体 + 一个石材色阶 */
      const vTop = (H - cH) / H, vBot = (yBot - b.y0) / H;
      if (run){
        const north = nz > 0.3;
        let vPrev = -1;
        for (let k = run.from; k < run.to; k++){
          const q = b.parcels[k];
          if (!q) continue;
          const s0 = q.seg[0], s1 = q.seg[1];
          const c0 = COL_OF_H[H] !== undefined ? COL_OF_H[H] : COL_OF_H[18];
          const nv = NVAR_OF_H[H] || 1;
          /* 图集变体（粗琢范围/拱心石/百叶/托檐石密度）本来就是 hash 抽的，
             但沿一条边走过去连着两栋抽到同一套的概率是 1/3——300m 的街上就会
             出现成对的「双胞胎」。这里只加一条反重复：撞上就旋一格。
             旋转量恒定、迭代顺序恒定，所以仍然是确定性的。 */
          let vi = q.variant.facadeId % nv;
          if (nv > 1 && vi === vPrev) vi = (vi + 1) % nv;
          vPrev = vi;
          const col = c0 + vi;
          /* 洗墙年份：批次=这条街（run.roadId），个体=长尾，场域=临河/街区档次 */
          const prof = PC.vary.of('stone', s0[0], s0[1], run.roadId);
          const soil = ravSoil(prof);
          q._fsoil = soil; q._fmoss = prof.moss; q._fnorth = north;
          const tint = ravTint(soil, prof.moss, north, _rt);
          quad(W, [s0[0], yBot, s0[1]], [s1[0], yBot, s1[1]],
                  [s1[0], b.y0 + H - cH, s1[1]], [s0[0], b.y0 + H - cH, s0[1]],
               [0, vBot, q.bays, vBot, q.bays, vTop, 0, vTop], tint, col, wantOut);
        }
      } else {
        /* 太短放不下地块的边（全城 107 条）：补一片素墙，别留洞 */
        const bays = Math.max(1, Math.round(L / 3.2));
        quad(W, [a[0], yBot, a[1]], [c[0], yBot, c[1]],
                [c[0], b.y0 + H - cH, c[1]], [a[0], b.y0 + H - cH, a[1]],
             [0, vBot, bays, vBot, bays, vTop, 0, vTop], courtTint, courtCol, wantOut);
      }

      /* 檐口：整条边一片斜出挑（真正卖巴黎的是它投下的那道横向阴影） */
      const runBays = Math.max(1, Math.round(L / 3.2));
      const cTint = T_CORNICE;
      const cCol = (COL_OF_H[H] !== undefined ? COL_OF_H[H] : COL_OF_H[18]);
      quad(W, [a[0], b.y0 + H - cH, a[1]], [c[0], b.y0 + H - cH, c[1]],
              [c[0] + nx * e, yE, c[1] + nz * e], [a[0] + nx * e, yE, a[1] + nz * e],
           [0, vTop, runBays, vTop, runBays, 1, 0, 1], cTint, cCol, [nx, 0.55, nz]);

      /* 内院墙：素面抹灰，无线脚无阳台（haussmann §12） */
      const i2 = (i + 1) % n;
      quad(W, [R4[i2][0], yBot, R4[i2][1]], [R4[i][0], yBot, R4[i][1]],
              [R4[i][0], yE, R4[i][1]], [R4[i2][0], yE, R4[i2][1]],
           [0, vBot, runBays, vBot, runBays, 1, 0, 1], courtTint, courtCol, [-nx, 0, -nz]);

      /* 屋顶四段：brisis 45° → terrasson 12° ↗ 屋脊 ↘ terrasson → 内 brisis */
      /* 本条边的锌板包浆：批次（街廓，同期翻修）55% + 个体（这一条边）45%，
         再叠临河。转角上两片屋面换色是真实航拍里到处都是的分户缝，不是接缝 bug。
         朝向仍然按 0 朝阳 / 1 常规 / 2 北向背阴选明暗；terrasson 朝天，天光已经
         把它抬得很亮，贴图侧要压暗一档，否则从 340m 俯瞰整片屋顶会糊成白高原。 */
      const eMx = (a[0] + c[0]) / 2, eMz = (a[1] + c[1]) / 2;
      const eh = s => PC.hash2(eMx, eMz, s);
      /* 与墙面同构：批次（街廓，同期翻修）定基调 + 个体长尾定谁跳出来。
         第二轮个体摆幅只有 ±0.11，四档色带又只覆盖 121→93，鸟瞰整片屋顶
         读成一张没有肌理的灰纸（截图 r1-3-city）。这里给到 ±0.42。 */
      let zAge = clamp(0.26 + 0.32 * bRoofAge + 0.50 * tailDev(eh(43))
                     + 0.10 * bRoof.riverside, 0, 1);
      /* 约 5.5% 是近年刚换过的亮锌屋面。鸟瞰时整片屋顶海之所以「活」，
         靠的就是这一两块反光的新板——全城均质地老，看起来就是一张灰纸。 */
      const zFresh = eh(59) > 0.945;
      if (zFresh) zAge = eh(61) * 0.05;
      const zSlate = !zFresh && eh(67) > 0.90;                  // 约 9% 改盖板岩瓦
      const sunny = nx > 0.25;                                  // 朝东南受光坡更亮
      const face = sunny ? 1.09 : (nz > 0.3 ? 0.87 : 1.0);
      zincCol(zAge, zSlate, face, _zB);
      /* 檐沟一侧常年积水积灰，比屋脊暗一档，越老差得越多 */
      zincCol(zAge, zSlate, face * (0.94 - 0.15 * zAge), _zBd);
      zincCol(zAge, zSlate, 0.90, _zT);
      zincCol(zAge, zSlate, 0.90 * (0.95 - 0.13 * zAge), _zTd);
      const S = zinc.tile;
      const uL = L / S;
      const sl = Math.hypot(hB, hB) / S, fl = Math.max(0.001, (band / 2 - hB)) / S;
      roofQuad([a[0] + nx * e, yE, a[1] + nz * e], [c[0] + nx * e, yE, c[1] + nz * e],
               [R1[i2][0], yE + hB, R1[i2][1]], [R1[i][0], yE + hB, R1[i][1]],
               [0, 0, uL, 0, uL, sl, 0, sl], _zqA, [nx, 1, nz]);
      roofQuad([R1[i][0], yE + hB, R1[i][1]], [R1[i2][0], yE + hB, R1[i2][1]],
               [R2[i2][0], yE + rr, R2[i2][1]], [R2[i][0], yE + rr, R2[i][1]],
               [0, sl, uL, sl, uL, sl + fl, 0, sl + fl], _ztA, [nx * 0.2, 1, nz * 0.2]);
      roofQuad([R2[i][0], yE + rr, R2[i][1]], [R2[i2][0], yE + rr, R2[i2][1]],
               [R3[i2][0], yE + hB, R3[i2][1]], [R3[i][0], yE + hB, R3[i][1]],
               [0, sl + fl, uL, sl + fl, uL, sl + fl * 2, 0, sl + fl * 2], _ztB, [-nx * 0.2, 1, -nz * 0.2]);
      roofQuad([R3[i][0], yE + hB, R3[i][1]], [R3[i2][0], yE + hB, R3[i2][1]],
               [R4[i2][0], yE, R4[i2][1]], [R4[i][0], yE, R4[i][1]],
               [0, sl + fl * 2, uL, sl + fl * 2, uL, sl * 2 + fl * 2, 0, sl * 2 + fl * 2],
               _zqB, [-nx, 1, -nz]);

      function roofQuad(p0, p1, p2, p3, uv, tint, want){ quad(R, p0, p1, p2, p3, uv, tint, 0, want); }

      /* 转角亭顶 toit en pavillon d'angle：奥斯曼转角楼在 pan coupé 上加的小攒尖顶。
         檐口线一米不动（那条线是法令，也是巴黎天际线的来源，不许打散），
         但屋面之上多了 40–80m 一次的小起伏，天际线不再是一把直尺。 */
      if (run && run.chamfer && !R1.collapsed && GRAND_KLASS[run.klass] &&
          PC.hash2(a[0], a[1], 33) < 0.40){
        const rad = Math.min(L * 0.45, 3.9);
        if (rad > 1.6){
          const px = (R1[i][0] + R1[i2][0]) / 2 - nx * rad * 0.20;
          const pz = (R1[i][1] + R1[i2][1]) / 2 - nz * rad * 0.20;
          /* 亭顶跟着**本条边**的包浆走，不再回头去查街廓那一档——
             一个亮锌屋面上顶着一顶老锌亭子，从空中看是最扎眼的一种假 */
          pavilion(R, px, yE + hB - 0.35, pz, rad, 1.0 + rad * 0.95, _zB, _zT);
        }
      }

      /* 烟囱与天窗的候选点：souche 落在 parcel 分界线（山墙）与屋脊上，
         管排**垂直于街面**——搞反了整片屋顶会变成随便撒的柱子（haussmann §9.4） */
      if (run){
        for (let k = run.from; k < run.to; k++){
          const q = b.parcels[k];
          if (!q) continue;
          const s0 = q.seg[0], s1 = q.seg[1];
          const mx = (s0[0] + s1[0]) / 2, mz = (s0[1] + s1[1]) / 2;
          /* souche 落点不能用「街面法线往里推 d」——那个点在细长街廓上会推出屋面。
             改成直接落在已经建好的环上（R1=brisis 顶，R2=屋脊），按地块在这条边上的
             参数位置插值，天生就贴着屋面。n 是**朝街外**的法线，方向别搞反。
             但参数位置必须**离两端各让开 1.2m**：这条边的屋面标高是 yE，
             而转角另一条街可能限高不同，正好压在角点上的烟囱会站到隔壁那片矮屋面上空
             （实测 26562 个抽样点里有 127 个这样悬空 3m，正好等于两条街的限高差）。 */
          const tEps = Math.min(0.45, 1.2 / L);
          const t0 = clamp(Math.hypot(s0[0] - a[0], s0[1] - a[1]) / L, tEps, 1 - tEps);
          const tm = clamp(Math.hypot(mx - a[0], mz - a[1]) / L, tEps, 1 - tEps);
          const onRing = (Rk, t) => [Rk[i][0] + (Rk[i2][0] - Rk[i][0]) * t,
                                     Rk[i][1] + (Rk[i2][1] - Rk[i][1]) * t];
          /* 收站点前最后一道闸：点必须真的落在这个街廓的轮廓里。
             环已经被 healRing 修过，正常情况下恒为真；留着它是因为「取不到锚点就跳过」
             比「按默认标高摆一个」便宜得多——宁可少一根烟囱，不要一根飘在天上。 */
          const onRoof = (px, pz) => PC.poly.contains(Pg, px, pz);
          /* ── 这一簇烟囱的档案 ───────────────────────────────────────────
             批次 = 街廓（同一片屋面上的 souche 是一次砌上去的，陶土是同一窑），
             个体 = 这栋楼。三样跟着走：
               · 颜色：从 PC.families.terracotta 抽一族，再压一条 soot 轴——
                 老的被烟熏得近黑，新的偏橙红
               · 根数：3–8 根（砌体座的长度在顶点着色器里跟着一起缩，不然三根管
                 顶着一条八根管的座，鸟瞰全是「缺牙」）
               · 风帽 mitron：约 27% 戴，管口向外撇成喇叭（也在着色器里做，零三角）
             高度早就有（s.h → Y 向缩放），但只有高度在变时，一片屋顶读出来是
             「同一根柱子被拉长拉短」——那是最典型的复制粘贴味。 */
          const cp = PC.vary.of('chimney', mx, mz, bid);
          chimneyTint(cp, _rt);
          const cPots = 3 + ((cp.f(151) * (POT_MAX - 2)) | 0);
          const cVz = cPots + (cp.f(157) > 0.73 ? 16 : 0);
          const cr = _rt.r, cg = _rt.g, cb = _rt.b;
          /* 三处 sites.push 的字面量字段**必须完全一致**（含 h / _d）：18 万个站点如果分成
             两种形状，重填时每次读 s.kind / s._d 都会退化成 megamorphic 访问。 */
          if (!R1.collapsed){
            const p1 = onRing(R1, t0);
            if (onRoof(p1[0], p1[1]))
              sites.push({x: p1[0], z: p1[1], y: yE + hB, ang: Math.atan2(-nz, nx), kind: 0,
                          h: 1.55 + PC.hash2(s0[0], s0[1], 12) * 0.95, _d: 0,
                          cr: cr, cg: cg, cb: cb, va: cp.age, vg: cp.grime, vz: cVz});
          }
          if (!R2.collapsed){
            const p2 = onRing(R2, tm);
            if (onRoof(p2[0], p2[1]))
              sites.push({x: p2[0], z: p2[1], y: yE + rr, ang: Math.atan2(-nz, nx), kind: 0,
                          h: 1.00 + PC.hash2(mx, mz, 12) * 0.80, _d: 0,
                          cr: cr, cg: cg, cb: cb, va: cp.age, vg: cp.grime, vz: cVz});
          }
          /* 天窗 lucarne：坐在 brisis 上，底沿 = 檐口顶 + 0.60（45° 坡 → 内移量 = 抬高量） */
          const lo = Math.min(0.62, hB * 0.5);
          const step2 = q.variant.dormers >= q.bays ? 1 : 2;
          for (let d = 0; d < q.bays; d += step2){
            const t = (d + 0.5) / q.bays;      // 沿地块面宽，天生不会落在转角上
            const lx = s0[0] + (s1[0] - s0[0]) * t, lz = s0[1] + (s1[1] - s0[1]) * t;
            const ux2 = lx - nx * lo, uz2 = lz - nz * lo;
            if (onRoof(ux2, uz2))
              /* 天窗跟着**本条边的屋面**走：一片新锌屋面上开着一排老锌天窗，
                 是这一层第二轮最扎眼的一处「同一件东西复制出来的」 */
              sites.push({x: ux2, z: uz2, y: yE + lo, ang: Math.atan2(-nz, nx), kind: 1,
                          h: 1.6, _d: 0,
                          cr: _zB.r, cg: _zB.g, cb: _zB.b, va: 0, vg: 0, vz: 6});
          }
          /* LOD0 用的 parcel 索引 */
          q._fx = mx; q._fz = mz; q._fn = [nx, nz]; q._fyE = yE; q._fy0 = b.y0;
          q._fcH = cH; q._fe = e; q._fhB = hB;
          LOD0PARCELS.push(q);
        }
      }
    }

    /* 转角错台的山墙：两条街限高不同时，沿角平分线补一片截面（§10 不许抹平） */
    for (let i = 0; i < n; i++){
      const j = (i + 1) % n;
      const rA = runByEdge[i], rB = runByEdge[j];
      /* 两边的兜底值必须一致。原来 hA 兜 hAvg 而 hB2 兜 0，
         于是每一条「太短放不下地块」的边（全城 107 条）都会在转角凭空造出
         一片从地面到檐口的山墙——那正是审查截到的白色尖刺碎片。
         那条边的墙本来就是按 hAvg 补的，山墙也得按 hAvg 算，才不会有落差。 */
      const hA = rA ? rA.H : hAvg, hB2 = rB ? rB.H : hAvg;
      if (Math.abs(hA - hB2) < 0.05) continue;
      const hi = Math.max(hA, hB2), lo = Math.min(hA, hB2);
      const yH = b.y0 + hi, yL = b.y0 + lo;
      /* 山墙截面沿角平分线往街廓里走，最远不许超过屋面本身的进深。
         环一旦收成重心（攒尖顶），R*[j] 就是重心，不封这个口就会拉出一片
         横跨整个街廓的薄板——远看就是一根从屋脊里戳出来的白刺。 */
      const capD = band * 1.6 + 2;
      const cap = p => {
        const dx = p[0] - Pg[j][0], dz = p[1] - Pg[j][1], dl = Math.hypot(dx, dz);
        return dl <= capD ? p : [Pg[j][0] + dx / dl * capD, Pg[j][1] + dz / dl * capD];
      };
      const prof = [[Pg[j], 0], [cap(R1[j]), hB], [cap(R2[j]), rr],
                    [cap(R3[j]), hB], [cap(R4[j]), 0]];
      /* 山墙可见的一侧朝着**矮的那条街**（高的那栋楼露出自己的侧脸） */
      const pPrev = Pg[i], pNext = Pg[(j + 1) % n];
      let wx, wz;
      if (hA > hB2){ wx = pNext[0] - Pg[j][0]; wz = pNext[1] - Pg[j][1]; }
      else         { wx = pPrev[0] - Pg[j][0]; wz = pPrev[1] - Pg[j][1]; }
      const wl = Math.hypot(wx, wz) || 1;
      const want = [wx / wl, 0, wz / wl];
      for (let k = 0; k + 1 < prof.length; k++){
        const p0 = prof[k], p1 = prof[k + 1];
        quad(W, [p0[0][0], yL + p0[1], p0[0][1]], [p1[0][0], yL + p1[1], p1[0][1]],
                [p1[0][0], yH + p1[1], p1[0][1]], [p0[0][0], yH + p0[1], p0[0][1]],
             [0, 0.55, 1, 0.55, 1, 0.98, 0, 0.98], T_GABLE, courtCol, want);
      }
    }
  }

  const LOD0PARCELS_ALL = LOD0PARCELS;

  /* ── 4.2b 天际线锚点（详见 §5 的说明） ── */
  step(0, '奥斯曼街区 · 钟楼与穹顶'); await raf();
  const AW = Buf(true), AR = Buf(true);
  const nAnchor = buildAnchors(AW, AR);
  await raf();

  function buildAnchors(W, R){
    const A_STONE   = SC(RAV[1]), A_STONE_DK = SC(RAV[5]);
    const A_ROOF    = SC(new T.Color(P.slate));
    const A_ROOF_LT = SC(new T.Color(P.slate).lerp(new T.Color(P.zincLt), 0.30));
    const A_GILT    = SC(new T.Color(P.gilt).lerp(new T.Color(P.zinc), 0.45));  // 压过的镀金，别当路灯用
    const taken = new Uint8Array(plan.blocks.length);
    const done = [];
    let n = 0;

    /* 街廓能不能装下这座堂：内院沿长轴/短轴的可用半宽 */
    const measure = (b) => {
      const court = b.court && b.court.length >= 3 ? b.court : null;
      if (!court) return null;
      const cc = PC.poly.centroid(court);
      const d = longestDir(b.poly);
      const eu = extentAlong(court, cc[0], cc[1], d[0], d[1]);
      const ev = extentAlong(court, cc[0], cc[1], -d[1], d[0]);
      return {cc, d, eu, ev};
    };
    const heroBlocked = (x, z) => {
      for (const h of HERO_KEEPOUT) if (Math.hypot(x - h[0], z - h[1]) < h[2]) return true;
      return false;
    };
    const farEnough = (x, z, r) => {
      for (const p of done) if (Math.hypot(x - p[0], z - p[1]) < r) return false;
      return true;
    };

    /* 一座锚点的尺寸表。scale 只放大不改比例——比例一改就不像堂了 */
    const emit = (b, bi, kind, sc) => {
      const m = measure(b);
      if (!m) return false;
      let Ln = Math.min(m.eu * 1.62, 52 * sc), Wn = Math.min(m.ev * 1.30, 17 * sc);
      if (kind === 'dome'){ Ln = Wn = 0; }
      const Rd = Math.min(Math.min(m.eu, m.ev) * 1.05, 13 * sc);
      if (kind === 'dome' ? Rd < 6.5 : (Ln < 22 || Wn < 9)) return false;
      const y0 = b.y0;
      /* 钟楼顶：一半做尖顶 flèche，一半做平顶钟楼（顶上一圈矮女儿墙就收）。
         全做尖顶的话天际线会变成一排哥特尖刺——巴黎实际是方塔、平顶、
         穹顶、尖顶混着来，圣叙尔皮斯和圣厄斯塔什就都不是尖的。 */
      const flat = PC.hash2(m.cc[0], m.cc[1], 53) < 0.48;
      buildAnchorMass(W, R, {
        x: m.cc[0], z: m.cc[1], y0: y0, ux: m.d[0], uz: m.d[1], kind: kind,
        Ln: Ln, Wn: Wn,
        Hw: 20 + 5 * sc, Hr: 9 + 4 * sc,
        Ht: 30 + 15 * sc, Hs: flat ? 1.6 + 1.4 * sc : 10 + 12 * sc,
        Rd: Rd, Hdr: 24 + 12 * sc, Hdo: 15 + 9 * sc
      }, A_STONE, A_STONE_DK, A_ROOF, A_ROOF_LT, A_GILT);
      taken[bi] = 1; done.push([m.cc[0], m.cc[1]]); n++;
      return true;
    };

    /* ① 真实位置的锚点：投影后找最近的、装得下的街廓 */
    for (const S of ANCHOR_SITES){
      const g = PC.geo(S[1], S[2]);
      if (g[0] < BB[0] || g[0] > BB[2] || g[1] < BB[1] || g[1] > BB[3]) continue;
      if (heroBlocked(g[0], g[1])) continue;
      const cand = [];
      for (let i = 0; i < plan.blocks.length; i++){
        if (taken[i]) continue;
        const c = plan.blocks[i].centroid;
        const d = Math.hypot(c[0] - g[0], c[1] - g[1]);
        if (d < 320) cand.push([d, i]);
      }
      cand.sort((p, q) => p[0] - q[0]);
      for (const [, i] of cand) if (emit(plan.blocks[i], i, S[3], S[4])) break;
    }

    /* ② 程序补点：外围街区也要有落脚的地方，不然只有市中心热闹。
       确定性遍历 + 520m 最小间距，跑多少次都是同一批。 */
    for (let i = 0; i < plan.blocks.length && n < 120; i++){
      if (taken[i]) continue;
      const b = plan.blocks[i], c = b.centroid;
      if (b.area < 6200) continue;
      if (heroBlocked(c[0], c[1]) || !farEnough(c[0], c[1], 520)) continue;
      const h = PC.hash2(c[0], c[1], 41);
      if (h > 0.62) continue;
      emit(b, i, h < 0.10 ? 'dome' : (h < 0.22 ? 'church2' : 'church'), 0.78 + h * 0.5);
    }
    return n;
  }

  step(0, '奥斯曼街区 · 合并分片'); await raf();
  const meshes = [];
  for (const k in chunks){
    const C = chunks[k];
    const gw = bufToGeo(C.w), gr = bufToGeo(C.r);
    if (gw){ const m = new T.Mesh(gw, facadeMat); m.castShadow = true; m.receiveShadow = true;
             ROOT.add(m); meshes.push(m); }
    if (gr){ const m = new T.Mesh(gr, roofMat); m.castShadow = false; m.receiveShadow = true;
             ROOT.add(m); meshes.push(m); }
    C.w = C.r = null;
  }
  /* 锚点两片：石作一片、屋面一片，全城各一个 draw call。
     顶点色是绝对色，所以材质 color 保持白、不带贴图。 */
  const anchorStoneMat = new T.MeshStandardMaterial({vertexColors: true, roughness: 0.94,
                                                     metalness: 0.0, envMapIntensity: 0.50});
  const anchorRoofMat  = new T.MeshStandardMaterial({vertexColors: true, roughness: 0.72,
                                                     metalness: 0.18, envMapIntensity: 0.60});
  for (const [B, mat] of [[AW, anchorStoneMat], [AR, anchorRoofMat]]){
    const g = bufToGeo(B);
    if (!g) continue;
    const m = new T.Mesh(g, mat);
    m.castShadow = true; m.receiveShadow = true;
    ROOT.add(m); meshes.push(m);
  }
  await raf();

  /* ── 4.3 实例池（烟囱林 / 天窗），按 PC.lod 分环 ── */
  step(0, '奥斯曼街区 · 烟囱林'); await raf();
  const gSoucheFull = soucheGeo(T, true, CH_SOUCHE, SC(new T.Color(P.chimney)),
                                SC(new T.Color(0x8e6f5c)));
  const gSoucheLow  = soucheGeo(T, false, CH_SOUCHE, null, CH_SOOTY);
  /* lucarne 用屋顶材质（有锌贴图），所以它的顶点色也必须是「相对贴图基色的比值」 */
  const gLucarne    = lucarneGeo(T, WHITE.clone(),
                                 ratio(SC(new T.Color(0x20262b)), ZINC_BASE));

  /* colors / vary 两个逐实例属性都是**免费**的：它们进的是同一个 InstancedMesh，
     不多一个 draw call、不多一个三角形。要加变体先算这笔账——多开一个池才要钱。 */
  POOLS = {
    near: PC.pool(gSoucheFull, souche, 620, {castShadow: false, receiveShadow: false,
                                             colors: true, vary: true}),
    far:  PC.pool(gSoucheLow,  souche, 5000, {castShadow: false, receiveShadow: false,
                                              colors: true, vary: true}),
    luc:  PC.pool(gLucarne,    roofMat, 1200, {castShadow: false, receiveShadow: false,
                                               colors: true})
  };
  ROOT.add(POOLS.near.mesh, POOLS.far.mesh, POOLS.luc.mesh);

  /* 站点分桶到 100m 网格，重填时只扫半径内的格子。
     格子从 200 缩到 100：query 的方形包围盒能更贴合 R1=1100 的圆，外溢少一半，
     代价只是多几百次格子级判断（每次判断一个平方距离，比多扫一格站点便宜得多）。 */
  SITES = sites;
  GRID = buildGrid(sites, 100, BB);

  const M = new T.Matrix4(), Q = new T.Quaternion(), V = new T.Vector3(), Sv = new T.Vector3();
  const AXIS = new T.Vector3(0, 1, 0);
  /* 逐实例的色与风化属性在建站点时就算好了（每栋楼一次），重填只是抄数——
     这条回调是全场最热的路径，绝不能在里面跑 PC.vary.of。
     两个 scratch 对象复用，重填不产生一次分配。 */
  const _pc = new T.Color(), _pv = [0, 0, 0];
  function place(pool, s, sy){
    Q.setFromAxisAngle(AXIS, s.ang);
    V.set(s.x, s.y, s.z); Sv.set(1, sy, 1);
    M.compose(V, Q, Sv);
    _pc.setRGB(s.cr, s.cg, s.cb);
    _pv[0] = s.va; _pv[1] = s.vg; _pv[2] = s.vz;
    return pool.push(M, _pc, _pv);
  }
  /* 池是有上限的，中环命中数远大于容量，所以必须**由近及远**地填——
     谁先被网格扫到谁占坑的话，结果是相机脚下一片空、远处一片密。

     但「由近及远」不等于「全序排序」。R1 圆里有 2.8 万个站点，三个池加起来只吃得下
     6820 个，对 2.8 万个建全序是纯浪费（实测这一条回调单帧 9–19ms，60fps 只有 16.7ms
     预算，相机每移动 110m 就掉一帧，环游/飞向地标/街道漫游全程都在触发）。
     改成 25m 一桶的计数排序：桶内顺序无所谓（同一个 25m 环带上先放哪根烟囱看不出来），
     桶间由近及远，三个池填满就 break——大多数点位在 700m 上下就停了，
     后面那四百米的站点连碰都不碰。
     与全序排序的实测差异：三个池的填充数完全一致（620/5000/1200），
     只有落在「正好卡在容量边界那一个 25m 环带」上的站点会被换掉，近池 ≤53 个、
     远池 ≤156 个、天窗池 ≤59 个，全在同一条环带里，看不出疏密变化。 */
  const BUCKET = 25, NBIN = Math.ceil(PC.lod.R1 / BUCKET) + 1;
  const bins = new Array(NBIN), binN = new Int32Array(NBIN);
  for (let i = 0; i < NBIN; i++) bins[i] = [];
  PC.lod.onMove(cam => {
    POOLS.near.reset(); POOLS.far.reset(); POOLS.luc.reset();
    const R0 = 500, R1 = PC.lod.R1, RL = R1 * 0.85;
    /* 桶数组只清计数不清内容：容量留着下一次用，免得每次重填都新分配几万个槽 */
    binN.fill(0);
    GRID.each(cam.x, cam.z, R1, (s, d2) => {
      const d = Math.sqrt(d2);
      s._d = d;
      const b = (d * (1 / BUCKET)) | 0;
      bins[b][binN[b]++] = s;
    });
    const nMax = POOLS.near.max, fMax = POOLS.far.max, lMax = POOLS.luc.max;
    for (let b = 0; b < NBIN; b++){
      const dLo = b * BUCKET;
      /* 收工条件：远池与天窗池都满了，而且近池要么已满、要么这一桶起已经出了近环 */
      if (POOLS.far.count >= fMax && POOLS.luc.count >= lMax &&
          (dLo >= R0 || POOLS.near.count >= nMax)) break;
      const arr = bins[b], m = binN[b];
      for (let k = 0; k < m; k++){
        const s = arr[k];
        if (s.kind === 1){ if (s._d < RL) place(POOLS.luc, s, 1); continue; }
        if (s._d < R0) place(POOLS.near, s, s.h / 1.6);
        else           place(POOLS.far,  s, s.h / 1.6);
      }
    }
    POOLS.near.commit(); POOLS.far.commit(); POOLS.luc.commit();
  }, 110);

  /* ── 4.4 LOD0：最近 40 栋补阳台栏杆几何、店面凹进、住宅大门 ── */
  LOD0 = {group: new T.Group(), mats: {rail: railMat, stone: null, dark: null}, parcels: LOD0PARCELS_ALL};
  LOD0.mats.stone = new T.MeshStandardMaterial({color: 0xffffff, vertexColors: true,
                                                roughness: 0.93, metalness: 0, envMapIntensity: 0.5});
  LOD0.mats.dark = new T.MeshStandardMaterial({color: 0x0a0c0e, roughness: 1, metalness: 0});
  /* 近景要用**绝对色**（这块材质没有图集打底），直接复用远景那条色带的原函数：
     同一条 7 档梯子、同一个 soil，两级 LOD 之间不换色。 */
  LOD0.ravAbs = ravColor;
  LOD0.ironDk = P.ironDk;
  LOD0.planters = PC.families.planter;
  LOD0.foliage = PC.families.foliage;
  ROOT.add(LOD0.group);
  const pGrid = buildGrid(LOD0PARCELS_ALL.map(q => ({x: q._fx, z: q._fz, q: q})), 200, BB);
  PC.lod.onMove(cam => rebuildLod0(T, cam, pGrid, plan), 80);

  step(0, '奥斯曼街区 · 完成'); await raf();
  let tri = 0;
  for (const m of meshes) tri += m.geometry.index.count / 3;
  console.log('[facade] 街廓 ' + plan.blocks.length + ' · 地块 ' + LOD0PARCELS_ALL.length +
              ' · 静态 mesh ' + meshes.length + ' / ' + Math.round(tri) + ' tri' +
              ' · 烟囱天窗站点 ' + sites.length + ' · 天际线锚点 ' + nAnchor);
  return {root: ROOT, meshes: meshes, pools: POOLS, sites: sites, lod0: LOD0};
},

setVisible(v){ if (ROOT) ROOT.visible = v; }
});

/* ══════════════════ 5. 天际线锚点 ══════════════════
   审查评语（截图 t-facade-air-A）：「视野内上百个街区的檐口高度完全一致，
   没有一栋高于或低于邻居，没有教堂、塔楼或任何视觉锚点。」——这条成立。

   但**檐口齐平本身不是 bug**：同一条街共享一个限高是 1859/1884 法令的结果，
   也是巴黎天际线的来源（城市层规划 §4 与 haussmann §10 都写死了这一条）。
   把奥斯曼街廓的檐口打散去换「错落感」，换来的是苏黎世不是巴黎。

   真正缺的是**另一个尺度的东西**：均质屋面之上刺出去的少数几件。巴黎城墙内有
   八十多座堂，钟楼与穹顶就是鸟瞰时眼睛落脚的地方。所以这里补两级：
     · 转角亭顶（上面 pavilion，40–80m 一次的小起伏，不动檐口线）
     · 堂（这一节，34–72m，明显越过周边 18–20m 的檐口）

   堂放在街廓**内院**里，不替换街廓。原因是 shops.js / furniture.js 的遮阳篷、
   桌椅、行道树全挂在 plan 的 parcel 上——拆掉临街面，那些东西会悬在空地上。
   而且真实的圣梅里、圣勒、圣尼古拉本来就是嵌在街廓里、只露出屋面和钟楼的。

   ⚠️ 下面的经纬是公开可查的**近似**位置（±100m 量级），几何是程序化体量，
      不是史实建模，页面上也不给这些体量挂名字。写在这里只是为了让锚点落在
      巴黎真的有堂的地方，而不是均匀撒点。 */
const ANCHOR_SITES = [
  /* 名称（仅注释）           lon      lat      类型      尺度 */
  ['圣叙尔皮斯',            2.3348, 48.8511, 'church2', 1.25],
  ['圣日耳曼德佩',          2.3345, 48.8540, 'church',  1.05],
  ['圣厄斯塔什',            2.3450, 48.8632, 'church',  1.25],
  ['圣艾蒂安杜蒙',          2.3477, 48.8465, 'church',  0.95],
  ['圣塞夫兰',              2.3457, 48.8524, 'church',  0.85],
  ['圣梅里',                2.3510, 48.8590, 'church',  0.90],
  ['圣保罗圣路易',          2.3612, 48.8551, 'dome',    0.85],
  ['圣热尔韦圣普罗泰',      2.3546, 48.8556, 'church',  0.95],
  ['玛德莱娜',              2.3245, 48.8700, 'church',  1.10],
  ['圣罗克',                2.3324, 48.8655, 'church',  0.95],
  ['圣奥古斯丁',            2.3200, 48.8747, 'dome',    1.00],
  ['三一堂',                2.3320, 48.8768, 'church',  1.05],
  ['洛雷特圣母',            2.3388, 48.8763, 'church',  0.90],
  ['圣文森特德保罗',        2.3513, 48.8797, 'church2', 1.00],
  ['圣洛朗',                2.3577, 48.8768, 'church',  0.90],
  ['圣尼古拉德尚',          2.3540, 48.8664, 'church',  0.90],
  ['圣安布鲁瓦兹',          2.3743, 48.8615, 'church2', 0.95],
  ['圣克洛蒂尔德',          2.3204, 48.8578, 'church2', 1.05],
  ['圣弗朗索瓦沙勿略',      2.3125, 48.8515, 'church',  0.95],
  ['圣菲利普杜鲁勒',        2.3110, 48.8730, 'church',  0.90],
  ['恩典谷',                2.3417, 48.8402, 'dome',    1.00],
  ['先贤祠',                2.3462, 48.8462, 'dome',    1.35],
  ['荣军院',                2.3125, 48.8550, 'dome',    1.30],
  ['法兰西学会',            2.3372, 48.8570, 'dome',    0.95],
  ['索邦礼拜堂',            2.3430, 48.8487, 'dome',    0.80],
  ['圣雅克塔',              2.3492, 48.8582, 'tower',   1.00],
  ['加尼叶歌剧院',          2.3319, 48.8720, 'dome',    1.10],
  ['蒙马特圣让',            2.3378, 48.8848, 'church',  0.85],
  ['蒙马特圣皮埃尔',        2.3418, 48.8867, 'church',  0.80],
  ['圣勒圣吉尔',            2.3496, 48.8626, 'church',  0.80],
  ['圣梅达尔',              2.3505, 48.8408, 'church',  0.85],
  ['圣安托万医院堂',        2.3800, 48.8490, 'church',  0.85],
  ['圣马丁堂',              2.3625, 48.8700, 'church',  0.85],
  ['圣贝尔纳堂',            2.3585, 48.8845, 'church2', 0.90]
];
/* 六座已建成地标的净空半径：锚点不许落进去，否则会从卢浮宫中庭里长出一座钟楼 */
const HERO_KEEPOUT = [[0, 0, 320], [-360, 270, 220], [-1030, 890, 430],
                      [-4030, 2315, 280], [-4060, 600, 340], [-500, 3750, 320]];

/* 多边形在给定方向上的半宽（用于把体量塞进内院） */
function extentAlong(poly, cx, cz, dx, dz){
  let lo = 0, hi = 0;
  for (const p of poly){ const t = (p[0] - cx) * dx + (p[1] - cz) * dz;
    if (t < lo) lo = t; if (t > hi) hi = t; }
  return Math.min(-lo, hi);
}
/* 街廓最长边的方向：堂的长轴顺着它，才不会横在内院里 */
function longestDir(poly){
  let best = 0, bx = 1, bz = 0;
  for (let i = 0, n = poly.length; i < n; i++){
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    if (L > best){ best = L; bx = dx / L; bz = dz / L; }
  }
  return [bx, bz];
}

/* 把一座堂 / 一个穹顶写进锚点缓冲。
   W = 石作缓冲（无贴图的石灰岩材质），R = 屋面缓冲（板岩）。
   两个缓冲的顶点色都是**绝对色**——锚点材质没有贴图，不像街廓那样要算比值。 */
function buildAnchorMass(W, R, o, cStone, cStoneDk, cRoof, cRoofLt, cGilt){
  const {x, z, y0, ux, uz, kind, Ln, Wn, Hw, Hr, Ht, Hs, Rd, Hdr, Hdo} = o;
  const vx = -uz, vz = ux;
  const pt = (du, dv, y) => [x + ux * du + vx * dv, y, z + uz * du + vz * dv];
  const L2 = Ln / 2, W2 = Wn / 2;

  if (kind === 'dome'){
    /* 鼓座 + 穹顶 + 采光亭：八角形，三段旋转面。先给一圈基座墙，让它不像凭空插的 */
    const SEG = 8;
    const poly = (r, t) => [x + Math.cos(t) * r, z + Math.sin(t) * r];
    const band = (r0, y0b, r1, y1b, tint, buf, wantUp) => {
      for (let i = 0; i < SEG; i++){
        const t0 = i / SEG * TAU + Math.PI / 8, t1 = (i + 1) / SEG * TAU + Math.PI / 8;
        const a0 = poly(r0, t0), a1 = poly(r0, t1), b0 = poly(r1, t0), b1 = poly(r1, t1);
        const mx = Math.cos((t0 + t1) / 2), mz = Math.sin((t0 + t1) / 2);
        quad(buf, [a0[0], y0b, a0[1]], [a1[0], y0b, a1[1]], [b1[0], y1b, b1[1]], [b0[0], y1b, b0[1]],
             [0, 0, 1, 0, 1, 1, 0, 1], tint, 0, [mx, wantUp, mz]);
      }
    };
    const yBase = y0 + Hdr * 0.42;                     // 方形基座顶
    band(Rd * 1.16, y0, Rd * 1.16, yBase, cStoneDk, W, 0);            // 基座
    band(Rd * 1.16, yBase, Rd * 1.06, yBase + 0.9, cStone, W, 0.6);   // 基座檐
    band(Rd, yBase + 0.9, Rd, y0 + Hdr, cStone, W, 0);                // 鼓座（柱廊在这个距离读不出，用素面）
    band(Rd, y0 + Hdr, Rd * 1.10, y0 + Hdr + 0.8, cStone, W, 0.6);    // 鼓座檐
    /* 穹顶：四段收分 */
    const prof = [[1.00, 0.00], [0.94, 0.34], [0.76, 0.64], [0.46, 0.87], [0.16, 1.00]];
    for (let k = 0; k + 1 < prof.length; k++)
      band(Rd * prof[k][0], y0 + Hdr + 0.8 + Hdo * prof[k][1],
           Rd * prof[k + 1][0], y0 + Hdr + 0.8 + Hdo * prof[k + 1][1],
           k >= 3 ? cGilt : cRoof, R, 0.8);
    /* 采光亭 lanternon + 尖顶 */
    const yl = y0 + Hdr + 0.8 + Hdo;
    band(Rd * 0.17, yl, Rd * 0.17, yl + Hdo * 0.26, cStone, W, 0);
    const apex = yl + Hdo * 0.26 + Hdo * 0.30;
    for (let i = 0; i < SEG; i++){
      const t0 = i / SEG * TAU + Math.PI / 8, t1 = (i + 1) / SEG * TAU + Math.PI / 8;
      const a0 = poly(Rd * 0.19, t0), a1 = poly(Rd * 0.19, t1);
      const ap = [x, apex, z];
      tri(R, [a0[0], yl + Hdo * 0.26, a0[1]], [a1[0], yl + Hdo * 0.26, a1[1]], ap,
          [0, 0, 1, 0, .5, 1], cGilt, 0,
          [Math.cos((t0 + t1) / 2), 0.8, Math.sin((t0 + t1) / 2)]);
    }
    return;
  }

  if (kind !== 'tower'){
    /* ── 中殿 nef ── */
    const yW = y0 + Hw, yRidge = yW + Hr;
    const sides = [1, -1];
    for (const s of sides)
      quad(W, pt(-L2, s * W2, y0), pt(L2, s * W2, y0), pt(L2, s * W2, yW), pt(-L2, s * W2, yW),
           [0, 0, 1, 0, 1, 1, 0, 1], cStone, 0, [vx * s, 0, vz * s]);
    /* 西立面 + 山花 */
    quad(W, pt(-L2, -W2, y0), pt(-L2, W2, y0), pt(-L2, W2, yW), pt(-L2, -W2, yW),
         [0, 0, 1, 0, 1, 1, 0, 1], cStone, 0, [-ux, 0, -uz]);
    const gTop = pt(-L2, 0, yRidge);
    tri(W, pt(-L2, -W2, yW), pt(-L2, W2, yW), gTop,
        [0, 0, 1, 0, .5, 1], cStoneDk, 0, [-ux, 0, -uz]);
    /* 屋面两坡（陡坡板岩，正是它在一片曼萨屋面里跳出来） */
    for (const s of sides)
      quad(R, pt(-L2, s * W2, yW), pt(L2, s * W2, yW), pt(L2, 0, yRidge), pt(-L2, 0, yRidge),
           [0, 0, Ln / 3, 0, Ln / 3, Hr / 2.4, 0, Hr / 2.4], s > 0 ? cRoofLt : cRoof, 0,
           [vx * s, 1, vz * s]);
    /* ── 东端后殿 chevet：半圆 5 段 + 半锥顶 ── */
    const AS = 5, ra = W2;
    const apx = pt(L2 + ra * 0.30, 0, yW + Hr * 0.62);
    for (let i = 0; i < AS; i++){
      const t0 = -Math.PI / 2 + i / AS * Math.PI, t1 = -Math.PI / 2 + (i + 1) / AS * Math.PI;
      const p0 = pt(L2 + Math.cos(t0) * ra * 0.92, Math.sin(t0) * ra, 0);
      const p1 = pt(L2 + Math.cos(t1) * ra * 0.92, Math.sin(t1) * ra, 0);
      const w = [(p0[0] + p1[0]) / 2 - pt(L2, 0, 0)[0], 0, (p0[2] + p1[2]) / 2 - pt(L2, 0, 0)[2]];
      quad(W, [p0[0], y0, p0[2]], [p1[0], y0, p1[2]], [p1[0], yW, p1[2]], [p0[0], yW, p0[2]],
           [0, 0, 1, 0, 1, 1, 0, 1], cStone, 0, w);
      tri(R, [p0[0], yW, p0[2]], [p1[0], yW, p1[2]], apx,
          [0, 0, 1, 0, .5, 1], cRoof, 0, [w[0], 1, w[2]]);
    }
  }

  /* ── 钟楼 clocher ── */
  const nT = kind === 'church2' ? 2 : 1;
  const Wt = kind === 'tower' ? Wn : Math.min(Wn * (nT === 2 ? 0.46 : 0.62), 11);
  for (let ti = 0; ti < nT; ti++){
    const dv = nT === 2 ? (ti ? 1 : -1) * (W2 - Wt / 2) : 0;
    const du = kind === 'tower' ? 0 : -L2 + Wt * 0.52;
    const yT = y0 + Ht, h2 = Wt / 2;
    const face = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const f of face){
      const su = f[0], sv = f[1];
      const c0 = pt(du + su * h2 - sv * h2, dv + sv * h2 + su * h2, y0);
      const c1 = pt(du + su * h2 + sv * h2, dv + sv * h2 - su * h2, y0);
      quad(W, c0, c1, [c1[0], yT, c1[2]], [c0[0], yT, c0[2]],
           [0, 0, 1, 0, 1, 1, 0, 1], cStone, 0, [ux * su + vx * sv, 0, uz * su + vz * sv]);
      /* 钟层的高窄洞口：一片深色，200m 外正好读成钟楼的那两道竖缝 */
      const yb = yT - Wt * 1.05, yt2 = yT - Wt * 0.22, k = 0.30;
      const d0 = pt(du + su * (h2 + 0.05) - sv * h2 * k, dv + sv * (h2 + 0.05) + su * h2 * k, y0);
      const d1 = pt(du + su * (h2 + 0.05) + sv * h2 * k, dv + sv * (h2 + 0.05) - su * h2 * k, y0);
      quad(W, [d0[0], yb, d0[2]], [d1[0], yb, d1[2]], [d1[0], yt2, d1[2]], [d0[0], yt2, d0[2]],
           [0, 0, 1, 0, 1, 1, 0, 1], cStoneDk, 0, [ux * su + vx * sv, 0, uz * su + vz * sv]);
    }
    /* 檐口一圈 + 尖顶 flèche */
    const yT2 = y0 + Ht, e2 = Wt * 0.60;
    for (const f of face){
      const su = f[0], sv = f[1];
      const c0 = pt(du + su * h2 - sv * h2, dv + sv * h2 + su * h2, 0);
      const c1 = pt(du + su * h2 + sv * h2, dv + sv * h2 - su * h2, 0);
      const e0 = pt(du + su * e2 - sv * e2, dv + sv * e2 + su * e2, 0);
      const e1 = pt(du + su * e2 + sv * e2, dv + sv * e2 - su * e2, 0);
      quad(W, [c0[0], yT2, c0[2]], [c1[0], yT2, c1[2]], [e1[0], yT2 + 0.9, e1[2]], [e0[0], yT2 + 0.9, e0[2]],
           [0, 0, 1, 0, 1, 1, 0, 1], cStone, 0, [ux * su + vx * sv, 0.5, uz * su + vz * sv]);
      const ap = pt(du, dv, yT2 + 0.9 + Hs);
      tri(R, [e0[0], yT2 + 0.9, e0[2]], [e1[0], yT2 + 0.9, e1[2]], ap,
          [0, 0, 1, 0, .5, 1], cRoof, 0, [ux * su + vx * sv, 1, uz * su + vz * sv]);
    }
  }
}

/* ══════════════════ 6. 实例几何 ══════════════════ */
/* 五面盒（省掉看不见的底面，10 tri 而不是 12）——烟囱要出好几千个，一面也是钱 */
function box5(T, sx, sy, sz, cx, cy, cz){
  const g = new T.BoxGeometry(sx, sy, sz);
  g.translate(cx, cy, cz);
  const idx = g.index.array, keep = [];
  /* BoxGeometry 面序：+x −x +y −y +z −z，每面 6 个索引。丢掉 −y（第 4 个面） */
  for (let f = 0; f < 6; f++){ if (f === 3) continue;
    for (let k = 0; k < 6; k++) keep.push(idx[f * 6 + k]); }
  g.setIndex(keep);
  return g;
}
/* souche：砌体座 + 一排陶土 mitron。管排沿 +X（=朝街廓内部）排开。
   完整件 ≈84 tri，剪影件 ≈10 tri —— 中环 5000 座只出剪影是唯一能兜住预算的分法。 */
function soucheGeo(T, withPots, cBase, cPot, cSoot){
  const gs = [];
  /* 剪影件的座长与完整件保持一致（都按满编 POT_MAX 根管烤），否则同一根烟囱
     跨过 R0=500m 的环界时会突然变胖——着色器里的座长缩放是按 SOUCHE_LEN 归一的。 */
  const N = POT_MAX, pitch = POT_PITCH, len = SOUCHE_LEN, dep = 0.55;
  /* 剪影件把管子的高度并进砌体座，远看剪影一致；近环才真的长出陶土管 */
  const hs = withPots ? 1.35 : 1.92;
  const cDirty = cBase.clone().multiplyScalar(0.84);        // 座底的水痕
  gs.push(tagPot(T, paintGrad(box5(T, len, hs, dep, 0, hs / 2, 0), cDirty, cBase, 0, hs), 0, 0, 1e9));
  if (!withPots) return mergeSimple(T, gs);
  gs.push(tagPot(T, paint(box5(T, len + 0.12, 0.10, dep + 0.12, 0, hs + 0.05, 0), cBase), 0, 0, 1e9));
  for (let i = 0; i < N; i++){
    const x = -len / 2 + 0.15 + pitch * (i + 0.5) - 0.13;
    const c = new T.CylinderGeometry(0.098, 0.108, 0.46, 6, 1, true);
    c.translate(x, hs + 0.10 + 0.23, 0);
    /* 上口 0.08 一段熏黑——近景很值钱，靠顶点色渐变实现，不加一个三角形 */
    paintGrad(c, cPot, cSoot, hs + 0.10 + 0.30, hs + 0.10 + 0.46);
    gs.push(tagPot(T, c, i + 1, x, hs + 0.10 + 0.40));
  }
  return mergeSimple(T, gs);
}
/* aPot = (管序号, 这根管的轴心 x, 是不是管口那一圈)。三样全给顶点着色器用：
   · 序号 > 本座实际根数 → 把这根收成一条线（退化三角，不出像素、不多 draw call）
   · 轴心 x = 「戴风帽 mitron」时管口向外撇的圆心
   · 管口标记 = 撇哪一圈
   序号 0 是砌体座与压顶，它的 x 跟着根数一起缩——三根管顶着六根管的座，
   鸟瞰整片屋顶就是一排缺牙。 */
function tagPot(T, g, idx, cx, topY){
  const pos = g.attributes.position, n = pos.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++){
    arr[i * 3] = idx; arr[i * 3 + 1] = cx;
    arr[i * 3 + 2] = (idx > 0 && pos.getY(i) > topY) ? 1 : 0;
  }
  g.setAttribute('aPot', new T.BufferAttribute(arr, 3));
  return g;
}
/* lucarne：平顶小天窗，前脸朝 +X（外），坐在 brisis 上 */
function lucarneGeo(T, cZinc, cGlass){
  const gs = [];
  const w = 0.95, h = 1.45, d = 0.70;
  gs.push(paint(box5(T, d, h, w, -d / 2 + 0.06, h / 2, 0), cZinc));
  const gl = new T.PlaneGeometry(0.80, 1.15);
  gl.rotateY(Math.PI / 2); gl.translate(0.075, h * 0.55, 0); gs.push(paint(gl, cGlass));
  gs.push(paint(box5(T, d + 0.16, 0.09, w + 0.16, -d / 2 + 0.06, h + 0.045, 0), cZinc));
  return mergeSimple(T, gs);
}
function paint(g, c){
  const n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++){ arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
function paintGrad(g, cLo, cHi, yLo, yHi){
  const pos = g.attributes.position, n = pos.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++){
    const t = clamp((pos.getY(i) - yLo) / Math.max(0.001, yHi - yLo), 0, 1);
    arr[i * 3] = lerp(cLo.r, cHi.r, t);
    arr[i * 3 + 1] = lerp(cLo.g, cHi.g, t);
    arr[i * 3 + 2] = lerp(cLo.b, cHi.b, t);
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
/* 带 color 属性的合并（PC.merge 只搬 position/normal/uv，实例几何要保住顶点色） */
function mergeSimple(T, gs){
  let vc = 0, ic = 0;
  for (const g of gs){ vc += g.attributes.position.count; ic += g.index ? g.index.count : g.attributes.position.count; }
  const hasPot = !!(gs[0] && gs[0].attributes.aPot);
  const Pp = new Float32Array(vc * 3), Nn = new Float32Array(vc * 3),
        Cc = new Float32Array(vc * 3), Uu = new Float32Array(vc * 2),
        Kk = hasPot ? new Float32Array(vc * 3) : null,
        Ii = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
  let vo = 0, io = 0;
  for (const g of gs){
    const c = g.attributes.position.count;
    Pp.set(g.attributes.position.array, vo * 3);
    Nn.set(g.attributes.normal.array, vo * 3);
    Cc.set(g.attributes.color.array, vo * 3);
    if (Kk && g.attributes.aPot) Kk.set(g.attributes.aPot.array, vo * 3);
    if (g.attributes.uv) Uu.set(g.attributes.uv.array, vo * 2);
    if (g.index){ const gi = g.index.array; for (let i = 0; i < gi.length; i++) Ii[io + i] = gi[i] + vo; io += gi.length; }
    else { for (let i = 0; i < c; i++) Ii[io + i] = i + vo; io += c; }
    vo += c; g.dispose();
  }
  const m = new T.BufferGeometry();
  m.setAttribute('position', new T.Float32BufferAttribute(Pp, 3));
  m.setAttribute('normal', new T.Float32BufferAttribute(Nn, 3));
  m.setAttribute('color', new T.Float32BufferAttribute(Cc, 3));
  m.setAttribute('uv', new T.Float32BufferAttribute(Uu, 2));
  if (Kk) m.setAttribute('aPot', new T.Float32BufferAttribute(Kk, 3));
  m.setIndex(new T.BufferAttribute(Ii, 1));
  m.computeBoundingSphere();
  return m;
}

/* ══════════════════ 7. 空间网格 ══════════════════ */
function buildGrid(items, cell, bb){
  const x0 = bb[0] - 200, z0 = bb[1] - 200;
  const nx = Math.ceil((bb[2] - bb[0] + 400) / cell), nz = Math.ceil((bb[3] - bb[1] + 400) / cell);
  const g = new Array(nx * nz);
  for (const it of items){
    const i = clamp(((it.x - x0) / cell) | 0, 0, nx - 1), j = clamp(((it.z - z0) / cell) | 0, 0, nz - 1);
    const k = j * nx + i;
    (g[k] || (g[k] = [])).push(it);
  }
  return {
    query(cx, cz, r){
      const out = [];
      const i0 = clamp((((cx - r) - x0) / cell) | 0, 0, nx - 1), i1 = clamp((((cx + r) - x0) / cell) | 0, 0, nx - 1);
      const j0 = clamp((((cz - r) - z0) / cell) | 0, 0, nz - 1), j1 = clamp((((cz + r) - z0) / cell) | 0, 0, nz - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++){
        const b = g[j * nx + i]; if (b) for (const it of b) out.push(it);
      }
      return out;
    },
    /* 半径内逐项回调，回调拿到平方距离。与 query 的两处差别都是为了重填那条热路径：
       ① 先按**格子到相机的最近距离**整格剔除——方形包围盒套 1100m 的圆会多捞近一倍的
          格子外溢，这一步把它压回圆本身；
       ② 不建中间数组——18 万站点的那张网格，一次 query 要 push 出五万条，
          光是这个数组的分配和 GC 就够吃掉一帧。 */
    each(cx, cz, r, cb){
      const r2 = r * r;
      const i0 = clamp((((cx - r) - x0) / cell) | 0, 0, nx - 1), i1 = clamp((((cx + r) - x0) / cell) | 0, 0, nx - 1);
      const j0 = clamp((((cz - r) - z0) / cell) | 0, 0, nz - 1), j1 = clamp((((cz + r) - z0) / cell) | 0, 0, nz - 1);
      for (let j = j0; j <= j1; j++){
        const gz0 = z0 + j * cell, gz1 = gz0 + cell;
        const dz = cz < gz0 ? gz0 - cz : (cz > gz1 ? cz - gz1 : 0), dz2 = dz * dz;
        if (dz2 > r2) continue;
        const row = j * nx;
        for (let i = i0; i <= i1; i++){
          const gx0 = x0 + i * cell, gx1 = gx0 + cell;
          const dx = cx < gx0 ? gx0 - cx : (cx > gx1 ? cx - gx1 : 0);
          if (dx * dx + dz2 > r2) continue;
          const b = g[row + i]; if (!b) continue;
          for (let k = 0; k < b.length; k++){
            const it = b[k], ex = it.x - cx, ez = it.z - cz, d2 = ex * ex + ez * ez;
            if (d2 <= r2) cb(it, d2);
          }
        }
      }
    }
  };
}

/* ══════════════════ 8. LOD0 近景细节 ══════════════════
   ≤40 栋：贯通阳台的石板 + 锻铁栏杆、底层商铺凹进 0.4m、住宅 porte cochère。
   相机移动 >80m 才重建（core.js 的 onMove 已经保证了这一点）。 */
const LOD0PARCELS = [];
/* 近景重建每移动 80m 跑一次，四个颜色对象全程复用——这里 new 一个 Color
   就等于每 80m 制造 40×N 次分配，GC 会在漫游时抖成可见的掉帧。 */
const _l1 = new THREE.Color(), _l2 = new THREE.Color(),
      _l3 = new THREE.Color(), _l4 = new THREE.Color();
function rebuildLod0(T, cam, pGrid, plan){
  if (!LOD0) return;
  const G = LOD0.group;
  while (G.children.length){ const c = G.children.pop(); c.geometry && c.geometry.dispose(); }
  /* 只收**朝着相机**的那一面：立面背面的阳台永远看不见，
     而且相机一旦切进墙体（街廓内部），背面的阳台会连同被剔除的墙一起变成悬在半空的构件。 */
  const cands = pGrid.query(cam.x, cam.z, PC.lod.R0).filter(it => {
    const q = it.q;
    return q && q._fn && ((cam.x - it.x) * q._fn[0] + (cam.z - it.z) * q._fn[1]) > 0.5;
  });
  cands.sort((a, b) => ((a.x - cam.x) ** 2 + (a.z - cam.z) ** 2) - ((b.x - cam.x) ** 2 + (b.z - cam.z) ** 2));
  const take = Math.min(40, cands.length);
  const Bs = Buf(true), Bd = Buf(false), Br = Buf(true);
  const UV = [0, 0, 1, 0, 1, 1, 0, 1];

  for (let idx = 0; idx < take; idx++){
    const q = cands[idx].q;
    if (!q || !q._fn) continue;
    const nx = q._fn[0], nz = q._fn[1], ux = -nz, uz = nx;
    const s0 = q.seg[0], s1 = q.seg[1], L = q.w;
    const lv = plan.levelTables[q.H];
    if (!lv) continue;
    const y0 = q._fy0, want = [nx, 0, nz];
    const P0 = (t, o, y) => [s0[0] + ux * (L * t) + nx * o, y, s0[1] + uz * (L * t) + nz * o];

    /* 这一栋的石材色：跟远景那片墙用**同一个** soil（建墙时已经存在 q._fsoil 上），
       两级 LOD 之间不许换色——相机推进到 340m 时整栋楼变一次色是最刺眼的 pop。
       阳台石板比墙面亮一档：出挑的水平面被雨冲，从来是整栋楼上最干净的地方。 */
    const soil = q._fsoil === undefined ? 0.45 : q._fsoil;
    const cs = LOD0.ravAbs(soil, q._fmoss || 0, !!q._fnorth, _l1).multiplyScalar(1.05);
    /* 锻铁阳台的氧化按**楼龄**走，跟石材同源（同一个 prof.age 驱动两样东西）：
       一栋几十年没洗的黑楼配一副刚重漆的锃亮栏杆，是最典型的「各随机各的」。 */
    const ip = PC.vary.of('ironwork', q._fx, q._fz, q.roadId);
    PC.vary.shade(LOD0.ironDk, ip, _l2);

    /* 贯通阳台：石板 + 栏杆（每栋只有两道，2e 与 5e） */
    for (const k of lv.balcony){
      const row = lv.rows[k]; if (!row) continue;
      const yb = y0 + row.y, sa = 0.80, th = 0.18;
      /* 板：上/前/下三面 */
      quad(Bs, P0(0, 0, yb), P0(1, 0, yb), P0(1, sa, yb), P0(0, sa, yb), UV, cs, 0, [0,1,0]);
      quad(Bs, P0(0, sa, yb), P0(1, sa, yb), P0(1, sa, yb - th), P0(0, sa, yb - th), UV, cs, 0, want);
      quad(Bs, P0(0, sa, yb - th), P0(1, sa, yb - th), P0(1, 0, yb - th), P0(0, 0, yb - th), UV, cs, 0, [0,-1,0]);
      /* 栏杆：镂空贴图平面（几何竖杆在 1px 宽度下会闪成噪点，§5.3） */
      quad(Br, P0(0, sa - 0.05, yb), P0(1, sa - 0.05, yb), P0(1, sa - 0.05, yb + 1.00), P0(0, sa - 0.05, yb + 1.00),
           [0, 0, L / 1.25, 0, L / 1.25, 1, 0, 1], _l2, 0, want);
      /* 托座 console：每个窗间墙下一个（宽 0.28 高 0.45 出挑 0.75，涡卷简化成一片斜板） */
      for (let bi = 0; bi <= q.bays; bi++){
        const t = bi / q.bays, cw = 0.13 / L;
        quad(Bs, P0(t - cw, 0.02, yb - th), P0(t + cw, 0.02, yb - th),
                 P0(t + cw, sa - 0.06, yb - th - 0.45), P0(t - cw, sa - 0.06, yb - th - 0.45),
             UV, cs, 0, [0, -0.6, 0]);
      }
      /* 花箱 jardinière：真实巴黎立面上的随机点缀。只有 2e 那道阳台摆，
         而且**不是每栋都摆**——约 16% 的楼摆 1–3 个，其余空着。
         走的是同一片 Bs 缓冲、同一块材质，一个 draw call 都不多。 */
      if (k === lv.balcony[0] && PC.hash2(q._fx, q._fz, 177) > 0.84){
        const np = 1 + ((PC.hash2(q._fx, q._fz, 179) * 3) | 0);
        _l3.set(ip.pick(LOD0.planters, 181)).convertSRGBToLinear();
        _l4.set(ip.pick(LOD0.foliage, 183)).convertSRGBToLinear()
           .multiplyScalar(0.86 + PC.hash2(q._fx, q._fz, 185) * 0.30);
        const bw = 0.62 / L, o0 = 0.30, o1 = 0.58, yt = yb + 0.30;
        for (let pi = 0; pi < np; pi++){
          const tc = (pi + 0.5 + PC.hash2(q._fx + pi * 13, q._fz, 187) * 0.5) / (np + 0.5);
          const ta = tc - bw / 2, tb = tc + bw / 2;
          if (ta < 0.02 || tb > 0.98) continue;
          quad(Bs, P0(ta, o1, yb), P0(tb, o1, yb), P0(tb, o1, yt), P0(ta, o1, yt), UV, _l3, 0, want);
          quad(Bs, P0(ta, o0, yb), P0(ta, o1, yb), P0(ta, o1, yt), P0(ta, o0, yt), UV, _l3, 0, [-ux,0,-uz]);
          quad(Bs, P0(tb, o0, yb), P0(tb, o1, yb), P0(tb, o1, yt), P0(tb, o0, yt), UV, _l3, 0, [ux,0,uz]);
          /* 顶上那一片是花草，不是石头——同一块材质，只是顶点色不同 */
          quad(Bs, P0(ta, o0, yt), P0(tb, o0, yt), P0(tb, o1, yt + 0.05), P0(ta, o1, yt + 0.05),
               UV, _l4, 0, [0, 1, 0]);
        }
      }
    }

    /* 底层：商铺凹进 0.40（devanture en feuillure）/ 住宅 porte cochère */
    const rdc = lv.rows[0], top = rdc.h - 0.55, rec = 0.40;
    const isRes = q.use === 'residential';
    if (!isRes){
      const m0 = 0.10 / L, m1 = 1 - 0.10 / L;
      quad(Bd, P0(m0, -rec, y0 + 0.30), P0(m1, -rec, y0 + 0.30), P0(m1, -rec, y0 + top), P0(m0, -rec, y0 + top),
           UV, null, 0, want);
      quad(Bs, P0(m0, -rec, y0 + top), P0(m1, -rec, y0 + top), P0(m1, 0, y0 + top), P0(m0, 0, y0 + top),
           UV, cs, 0, [0, -1, 0]);
      quad(Bs, P0(m0, -rec, y0 + 0.30), P0(m0, 0, y0 + 0.30), P0(m0, 0, y0 + top), P0(m0, -rec, y0 + top),
           UV, cs, 0, [ux, 0, uz]);
      quad(Bs, P0(m1, -rec, y0 + 0.30), P0(m1, 0, y0 + 0.30), P0(m1, 0, y0 + top), P0(m1, -rec, y0 + top),
           UV, cs, 0, [-ux, 0, -uz]);
    } else {
      const c0 = 0.5 - 1.40 / L, c1 = 0.5 + 1.40 / L, dh = 3.60;
      quad(Bd, P0(c0, -0.55, y0), P0(c1, -0.55, y0), P0(c1, -0.55, y0 + dh), P0(c0, -0.55, y0 + dh),
           UV, null, 0, want);
      quad(Bs, P0(c0, -0.55, y0 + dh), P0(c1, -0.55, y0 + dh), P0(c1, 0, y0 + dh), P0(c0, 0, y0 + dh),
           UV, cs, 0, [0, -1, 0]);
      quad(Br, P0(c0, -0.10, y0), P0(c1, -0.10, y0), P0(c1, -0.10, y0 + dh), P0(c0, -0.10, y0 + dh),
           [0, 0, 2.8 / 1.25, 0, 2.8 / 1.25, 1, 0, 1], _l2, 0, want);
    }
  }

  const add = (B, mat) => { const g = bufToGeo(B); if (!g) return;
    const m = new T.Mesh(g, mat); m.castShadow = false; m.receiveShadow = true; G.add(m); };
  add(Bs, LOD0.mats.stone); add(Bd, LOD0.mats.dark); add(Br, LOD0.mats.rail);
}

})();
