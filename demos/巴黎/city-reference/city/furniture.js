/* ══════════════════════════════════════════════════════════════════════════
   city/furniture.js —— 街道家具层（order 60）

   管辖：街道尺度的所有非门店物件。
     行道树（帘式修剪 taille en rideau 逐株冠 + 猫头球冠 + 公园自然冠）· 树池箅子 ·
     双头铸铁路灯 · Wallace 饮水泉 · Morris 广告柱 · Davioud 长椅 ·
     报刊亭 · Guimard 新艺术地铁口 · 广场水池与喷泉 · 三座广场纪念柱

   不管：河岸旧书摊绿箱（归 water.js）· 咖啡馆桌椅遮阳篷（归 shops.js）·
        路面铺装与路缘石（归 terrain.js）

   规格来源：city/data/streetlife.md（§4 行道树 §5 路灯 §6 Wallace §7 Morris
            §8 长椅 §9 报刊亭 §10 Guimard §13 颜色 §14 密度）
   位置来源：PC.plan.roads / plan.places / plan.blocks / plan.river，一律只读。

   ── 两个决定整层成败的技术选择 ──

   ① 树冠是**低模球瓣簇**，不是多面体，尺度按米写死。
      前两版都栽在同一个地方：第一版把一整排冠压成一条长棱柱（一堵绿墙），
      第二版改成逐株的五棱双锥（10 tri，两端收尖）——省是省了，但那个形状
      侧面是四块大三角、两端是尖，冠幅又被拉到 9.2m 去和邻株搭接，
      街面机位上就是一张折过的巨型硬纸片，把整条街的天空全遮死。
      现在一株冠 = **2–3 个错位、大小不一的低模球瓣**（每瓣 20 tri）叠出的紧凑
      卵形，轮廓上没有一块大平面、没有一个尖角；几何一律归一到单位包围盒，
      实例矩阵直接按「冠幅 × 冠高 × 冠厚」的**米数**缩放，所以尺度可以打印核对。
      共 4 套变体（3 瓣 ×2 + 2 瓣 ×2），逐株再抖 ±12% 与 ±20° 朝向。

      量级问题用**按距离分三档**解决：
        ≤165m  四套变体的完整球瓣簇（40–60 tri）——人站在街上看到的就是这一档
        ≤560m  单瓣卵冠（20 tri）
        >560m  每 N 株并成一个三瓣冠（30 tri，N=6/18/42/84），瓣宽随距离等比放大
      并股后仍是一串鼓包而不是一条平带，所以远看是有起伏的绿线、近看是一株一株，
      全城 2.27 万株树落到 ≈2000 个实例。球瓣簇只用在广场（猫头修剪）和公园（自然冠）。

   ② 铸铁件只花 1 个 draw call，靠的是「一张图集 + 一种材质」。
      Wallace／Morris／报刊亭／地铁口颜色各不相同，却能合并进同一个 mesh——
      因为颜色不写在材质里，而是写在图集的色块格子里，靠 UV 去取。
      发光同理：emissiveMap 只在灯罩那一格是亮的，其余全黑，于是路灯的暖光
      不用单开一个 draw call。

   预算：本层 8.2–8.5 万三角 / 14 draw call（1600×1000 实测）。
   全场三角最高的机位（900m 高空全城）1,007,354，draw 124，120fps——
   改成球瓣簇之前同机位是 986,330 / 120，代价是 +2.1 万三角和 +4 个 draw call。
   （那 +4 个是冠形的 4 套变体：InstancedMesh 一个池只吃一份几何，
     要「整排不一模一样」就得一套一个池。）
   ══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

const H = (window.P3D && P3D.helpers) || {};
const clamp = H.clamp || ((v, a, b) => v < a ? a : (v > b ? b : v));

/* ═══════════════════ 0. 预算旋钮 ═══════════════════
   全部数量上限集中在这里，调性能只动这一块。
   带 CAP 的是「相机附近按距离重填」的池子；不带的是一次性铺满全城的。 */
const BUDGET = {
  crownNear:    150,    /* 近景冠上限，**每套变体各一个池**（4 池，40–60 tri/个） */
  crownMid:     820,    /* 中景单瓣卵冠上限（20 tri/个） */
  crown3Max:   1300,    /* 远景三瓣连冠上限（30 tri/个，一个盖住 6～84 株） */
  ballMax:      640,    /* 球瓣簇上限（全城常驻，40 tri/个；实测候选 531） */
  /* 树干池必须罩得住「所有可能有干的冠」= 近景+中景+球冠，否则先填的公园干
     会把街树干挤掉，中景整排树就浮在离地 3–4m 处（400m 外那道缝约 12px，看得见）。 */
  trunkCap:    1500,    /* 树干（跟着冠走，14 tri/个） */
  grateCap:     200,    /* 树池箅子（LOD0 环内，2 tri/个） */
  lampCap:      100,    /* 路灯（LOD1 环内，56 tri/个） */
  benchCap:      40,    /* 长椅（LOD1 环内，40 tri/个） */
  wallace:       16,    /* Wallace 泉 */
  morris:        14,    /* Morris 柱 */
  kiosque:        6,    /* 报刊亭 */
  guimard:        8,    /* Guimard 地铁口 */
  basins:        14     /* 广场水池 */
};

/* 树的形态常数 —— **全部是米，不是系数**。
   数值来源 streetlife.md §4.2/§4.4（悬铃木 platane，被反复修剪，不是自然树形），
   以及本轮定的三条硬指标：冠幅 5–8 / 冠高 5–7 / 冠底 3.0–3.8 / 胸径 0.35–0.55。

   与 streetlife.md §4.4「帘式修剪」表的两处**有意偏离**，记在这里免得被当 bug 改回去：
   ① 冠顶：规格表写 11–14m，这里落在 8.0–10.8m。14m 的冠顶配 20m 的檐口，
      从人视角抬头看天空是全糊死的（改前的截图就是）；压到 10.8m 才留得住街景。
   ② 冠长：规格表写「与相邻树连成一片，不留缝」。那是冬季修剪完的理想态，
      做成几何就是一堵墙。这里让冠幅 5.4–8.0 配 8.0/9.5m 的株距，
      相邻冠或轻搭或留 1–2m 缝——一眼能数出是一棵一棵的树。 */
const TREE = {
  botLo: 2.8,  botHi: 3.8,        /* 冠底净空 = 分枝点（下面要过人和车） */
  crownHLo: 4.2, crownHHi: 7.0,   /* 冠高 */
  spreadLo: 4.4, spreadHi: 8.0,   /* 冠幅（沿街方向） */
  thickK: 0.60,                   /* 冠厚 = 冠幅 × 这个数：横街方向略扁，是修剪的痕迹 */
  thickLo: 2.7, thickHi: 4.6,     /* 冠厚硬夹（薄过 2.7m 侧看又成纸片，厚过 4.6m 压到立面） */
  trunkLo: 0.24, trunkHi: 0.56,   /* 胸径。规格表中位 0.33、p75 0.50 */
  jitter: 0.12,         /* 逐株抖动幅度：冠高／冠厚／冠幅各 ±12% */
  /* 树龄驱动的尺度：新栽的补种树是真的小一圈，老树冠幅大干径粗。
     这不是又一个独立随机数——grow 只由 prof.age 来，跟树皮明度、冠色深浅同源。 */
  growLo: 0.80, growHi: 1.24,
  tilt: 0.115,          /* 树干倾斜幅度上限（弧度），6.6°。但**不是均匀分布**：
                           由 PC.vary.tail 整形，绝大多数落在 1.5° 以内，
                           只有极少数是那种一眼看出来歪着长的老树 */
  yawJit: 0.36,         /* 朝向抖动（弧度），±20°。不能给满 360°——
                           冠是「沿街长、横街扁」的，转满就把这条特征转没了 */
  spacingBd: 8.0,       /* 大道株距 */
  spacingRue: 9.5,      /* 次街株距 */
  minSidewalk: 3.2      /* 人行道窄于这个数就没有树——这不是简化，是真实的 */
};

/* 按距离分档：[环半径, 每几株并成一个实例]。
   最近两环 stride=1，一株一个冠（≤165m 是完整球瓣簇，再往外是单瓣卵冠），
   树干也只长在 stride=1 的范围里。
   往外的环 stride 必须是 3 的倍数：一个三瓣冠盖住 stride 株，每瓣 stride/3 株，
   瓣宽随距离等比放大，屏幕上始终是二十到五十像素的一个鼓包。
   数值是量出来的：这一组让全城 2.27 万株树落到 ≈2000 个实例，
   再密就压不住整层的三角预算，再疏中景就开始读成一条平带。 */
const CROWN_RINGS = [[560, 1], [900, 6], [1800, 18], [3400, 42], [1e9, 84]];
const NEAR_R = 165;                  /* 完整球瓣簇的半径。人视角看得清形状的就这一圈 */
const TRUNK_R = CROWN_RINGS[0][0];   /* 行道树干：与 stride=1 环对齐，再远树干不足 1px */
const PARK_TRUNK_R = 1200;           /* 广场／公园的树干：球冠是常驻的，干得跟远一点才不飘 */

/* 树种。比例照巴黎市政行道树普查的量级：悬铃木仍是绝对主力，其后依次是椴、
   七叶、洋槐、榆。**同一条街只种一个树种**——真实的市政绿化就是一条街一个种，
   所以按 road 抽，街与街之间才换种。

   fam  → PC.families.foliage 的下标。绿从那五族里抽，不在这里现编颜色。
          椴偏黄绿（族 3）、七叶偏深绿（族 4），这两条是树种最好认的地方。
   wK/hK/thK → 冠幅／冠高／冠厚的比例。悬铃木宽扁、椴偏卵、七叶饱满圆、洋槐疏松瘦。
   bark → 树皮的 RGB 偏色系数（乘在贴图上）：悬铃木最白，栗与榆偏棕。
   vB/mix → 该树种偏好的冠形变体下标与命中率。同种同街主要用一套冠形，
            剩下的落到别的变体上——街读起来是一个种，个体又不复制粘贴。 */
const SPECIES = [
  {n: 'platane',    fam: 0, wK: 1.16, hK: 0.94, thK: 1.04, bark: [1.00, 0.99, 0.96], vB: 0, mix: 0.55},
  {n: 'tilleul',    fam: 3, wK: 0.90, hK: 1.06, thK: 0.94, bark: [0.86, 0.80, 0.70], vB: 2, mix: 0.70},
  {n: 'marronnier', fam: 4, wK: 1.00, hK: 1.00, thK: 1.16, bark: [0.78, 0.72, 0.64], vB: 0, mix: 0.72},
  {n: 'sophora',    fam: 1, wK: 0.98, hK: 0.92, thK: 0.84, bark: [0.90, 0.85, 0.75], vB: 3, mix: 0.48},
  {n: 'orme',       fam: 2, wK: 0.88, hK: 1.10, thK: 0.90, bark: [0.82, 0.77, 0.69], vB: 1, mix: 0.60}
];
const SPECIES_CDF = [0.44, 0.64, 0.79, 0.91, 1.0];

/* ═══════════════════ 1. 图集 ═══════════════════
   512²，一张 albedo + 一张 emissive。分区：
     y 0–128    128px 块：树皮 | 海报A | 海报B | 海报C
     y 128–256  128px 块：铸铁 | 绿铸铁 | 灯罩玻璃 | METROPOLITAIN 牌
     y 256–384  128px 块：树池箅子 | 鱼鳞穹顶 | 海报D | 石材
     y 384–512  64px 色格 × 16：全部纯色件都在这里取色
   纯色格用中心点取样。为了不让 mipmap 把相邻格子的颜色糊到一起，
   这张图集**关掉 mipmap**（物件都很小，走 LinearFilter 足够）。 */
const S = 512;
const CELLS = {};      /* 名字 → [u,v] */
let ATLAS = null, ATLAS_E = null;

/* canvas 像素矩形 → uv 矩形（CanvasTexture 默认 flipY） */
function rect(x, y, w, h){ return [x / S, 1 - (y + h) / S, (x + w) / S, 1 - y / S]; }
function cellUV(i){       /* 第 i 个 64px 色格的中心 */
  const cx = (i % 8) * 64 + 32, cy = 384 + ((i / 8) | 0) * 64 + 32;
  return [cx / S, 1 - cy / S];
}
const R = {
  bark:    rect(0, 0, 128, 128),
  poster:  [rect(128, 0, 128, 128), rect(256, 0, 128, 128), rect(384, 0, 128, 128),
            rect(256, 256, 128, 128)],
  iron:    rect(0, 128, 128, 128),
  greenIr: rect(128, 128, 128, 128),
  glass:   rect(256, 128, 128, 128),
  metro:   rect(384, 128, 128, 128),
  grate:   rect(0, 256, 128, 128),
  scale:   rect(128, 256, 128, 128),
  stoneT:  rect(384, 256, 128, 128)
};

function hex(n){ return '#' + ('000000' + (n >>> 0).toString(16)).slice(-6); }
/* 在 palette 的色相上派生：f>1 提亮、f<1 压暗。禁止凭感觉写新 hex。 */
function shade(n, f){
  const r = clamp(((n >> 16) & 255) * f, 0, 255) | 0;
  const g = clamp(((n >> 8) & 255) * f, 0, 255) | 0;
  const b = clamp((n & 255) * f, 0, 255) | 0;
  return '#' + ('000000' + ((r << 16 | g << 8 | b) >>> 0).toString(16)).slice(-6);
}

/* ═══════════════════ 0b. 个体差异配色 ═══════════════════
   三条规矩，违反哪条这一层就退回「复制粘贴城市」：
     ① 色一律从 PC.families 抽，不在本文件里现编颜色数组。
     ② 褪色／积垢／氧化／磨损全部由同一个 prof.age 驱动，不各随机各的。
     ③ 少数派用 PC.vary.tail 整形抽——不是每株都怪，是一条街上有那么一两株怪。 */

const _HSL = {};
/* 枯黄：叶子晒死／缺水那一档的颜色。已是线性空间（与 shade 的输出对齐） */
const SICK_LEAF = new THREE.Color(0x8b8140).convertSRGBToLinear();
const BARK_MOSS = new THREE.Color(0.30, 0.37, 0.24);   /* 树皮北面的苔绿（乘性） */

/* 树冠色：族 = 树种（同街同族），族内浮动 = 逐株。
   顶点色里已经烤了「同一株内部上亮下暗」的渐变，这里给的是「这一株整体偏哪儿」，
   两者相乘。所以街上既有株间差，一株之内也有深浅。 */
function foliageColor(sp, prof, bTone, out){
  out.set(PC.families.foliage[sp.fam]);
  out.getHSL(_HSL);
  /* 明度分两层：批次层（整条街一起偏，±13%）+ 个体层（±9%）。
     两层的比例决定了「街与街差得开、街内部差得小」——只给个体层，
     算出来的族内标准差和全城标准差一样大，那就退回纯噪声了。 */
  out.setHSL(
    _HSL.h + (prof.tint - 0.5) * 0.030,                      /* 色相 ±5.4°：黄绿↔蓝绿 */
    clamp(_HSL.s * (0.86 + prof.f(203) * 0.30), 0, 1),       /* 饱和 ±15% */
    clamp(_HSL.l * bTone * (0.91 + prof.f(211) * 0.18)
                 * (1 - prof.age * 0.17), 0, 1));            /* 老树叶层厚、自遮蔽，整体更暗 */
  out.convertSRGBToLinear();
  /* 长尾：约 12% 的树带一点枯意，其中约 6% 明显发黄——「病树/老树」在真实街景里
     就是这个比例。均匀随机会让每株都有点黄，那是噪声不是个体。 */
  const odd = PC.vary.tail(prof.f(223), 2.5);
  if (odd > 0.72) out.lerp(SICK_LEAF, (odd - 0.72) / 0.28 * 0.56);
  return out;
}

/* 树皮色：instanceColor 在这里是**贴图的乘数**，不是最终色，所以不做 sRGB 转换。
   贴图底色是 platane 的剥落新皮 #C9C2AE，整排原样铺出来就是一排惨白柱子。 */
function barkColor(sp, prof, out){
  const k = (0.54 + 0.36 * prof.f(111)) * (1 - prof.age * 0.24);
  out.setRGB(k * sp.bark[0], k * sp.bark[1], k * sp.bark[2]);
  if (prof.moss > 0.05) out.lerp(BARK_MOSS, prof.moss * 0.45);
  return out;
}

/* 铸铁件：图集里那一格烤死的是 ironDk / parisGreen，逐件靠 instanceColor（或静态件的
   顶点色）乘成「这一根灯杆的绿」。ratio = 目标色 ÷ 基色，两边都在线性空间取，
   所以贴图上的竖向铸痕不会被抹平，只是整体偏了色。 */
function ratioTint(baseLin, targetLin, out){
  return out.setRGB(clamp(targetLin.r / Math.max(baseLin.r, 1e-4), 0, 3),
                    clamp(targetLin.g / Math.max(baseLin.g, 1e-4), 0, 3),
                    clamp(targetLin.b / Math.max(baseLin.b, 1e-4), 0, 3));
}

function buildAtlas(P){
  const ca = PC.canvas(S, S), a = ca.getContext('2d');
  const ce = PC.canvas(S, S), e = ce.getContext('2d');
  e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  a.fillStyle = hex(P.ironDk); a.fillRect(0, 0, S, S);

  const rnd = PC.rng(7717);

  /* ── 树皮：platane 剥落成迷彩斑块，这是它最好认的地方 ── */
  a.fillStyle = '#c9c2ae'; a.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 150; i++){
    const x = rnd() * 128, y = rnd() * 128;
    const w = 8 + rnd() * 22, h = 14 + rnd() * 40;
    a.fillStyle = rnd() > 0.45 ? '#8a8271' : '#a79c86';
    a.globalAlpha = 0.5 + rnd() * 0.4;
    a.beginPath(); a.ellipse(x, y, w / 2, h / 2, (rnd() - 0.5) * 0.5, 0, 6.284); a.fill();
  }
  a.globalAlpha = 1;
  for (let i = 0; i < 26; i++){       /* 竖向裂缝 */
    a.strokeStyle = '#6a6255'; a.lineWidth = 0.8 + rnd() * 1.6; a.globalAlpha = 0.5;
    a.beginPath(); a.moveTo(rnd() * 128, 0);
    a.bezierCurveTo(rnd() * 128, 40, rnd() * 128, 90, rnd() * 128, 128); a.stroke();
  }
  a.globalAlpha = 1;

  /* ── 海报：仿旧法国剧院招贴。竖长构图、大字块 + 色带。不写真实品牌名。 ── */
  const POSTERS = [
    {bg: '#b8412f', ink: '#f4e6c8', t1: 'THÉÂTRE', t2: 'REVUE', t3: 'CE SOIR'},
    {bg: '#1f3f63', ink: '#e8c34a', t1: 'CIRQUE', t2: "D'HIVER", t3: 'TOUS LES JOURS'},
    {bg: '#e2d3a8', ink: '#22303a', t1: 'CONCERT', t2: 'MUSIQUE', t3: 'GRAND BAL'},
    {bg: '#2f4a35', ink: '#e6d9b4', t1: 'OPÉRA', t2: 'COMIQUE', t3: 'SAISON'}
  ];
  POSTERS.forEach((ps, k) => {
    const ox = k < 3 ? 128 + k * 128 : 256, oy = k < 3 ? 0 : 256;
    a.fillStyle = ps.bg; a.fillRect(ox, oy, 128, 128);
    a.strokeStyle = ps.ink; a.lineWidth = 3;
    a.strokeRect(ox + 6, oy + 6, 116, 116);
    /* 中央一个装饰圆／人形剪影块 */
    a.fillStyle = ps.ink; a.globalAlpha = 0.9;
    a.beginPath(); a.arc(ox + 64, oy + 62, 26, 0, 6.284); a.fill();
    a.globalAlpha = 1; a.fillStyle = ps.bg;
    a.beginPath(); a.arc(ox + 64, oy + 62, 17, 0, 6.284); a.fill();
    a.fillStyle = ps.ink; a.textAlign = 'center';
    a.font = 'bold 17px Georgia,serif';  a.fillText(ps.t1, ox + 64, oy + 28);
    a.font = 'bold 13px Georgia,serif';  a.fillText(ps.t2, ox + 64, oy + 104);
    a.font = '9px Georgia,serif';        a.fillText(ps.t3, ox + 64, oy + 118);
    /* 旧纸的脏与折痕 */
    for (let i = 0; i < 40; i++){
      a.globalAlpha = 0.05 + rnd() * 0.09; a.fillStyle = i % 2 ? '#000' : '#fff';
      a.fillRect(ox + rnd() * 128, oy + rnd() * 128, 4 + rnd() * 30, 2 + rnd() * 10);
    }
    a.globalAlpha = 1;
  });

  /* ── 铸铁 / 绿铸铁：近乎素色 + 竖向铸痕 ── */
  const metalBlock = (x, y, base) => {
    a.fillStyle = base; a.fillRect(x, y, 128, 128);
    for (let i = 0; i < 70; i++){
      a.globalAlpha = 0.06 + rnd() * 0.12;
      a.fillStyle = rnd() > 0.5 ? '#fff' : '#000';
      a.fillRect(x + rnd() * 128, y, 0.7 + rnd() * 2.2, 128);
    }
    a.globalAlpha = 1;
  };
  metalBlock(0, 128, hex(P.ironDk));
  metalBlock(128, 128, hex(P.parisGreen));

  /* ── 灯罩玻璃：暖白玻璃 + 十字压条（albedo），emissive 同区全亮 ──
     albedo 从 #f2e4c0 压到 #c6b691：灯杆的逐盏配色是靠 instanceColor 乘上去的，
     灯笼跟灯杆共用同一个乘数，底色太亮就会被乘到过曝、整排灯笼糊成白块。
     压暗只影响白天的漫反射，夜里的光来自 emissiveMap，一点没动。 */
  a.fillStyle = '#c6b691'; a.fillRect(256, 128, 128, 128);
  a.fillStyle = hex(P.ironDk);
  a.fillRect(256, 186, 128, 5); a.fillRect(316, 128, 5, 128);
  e.fillStyle = '#ffd9a0'; e.fillRect(256, 128, 128, 128);
  e.fillStyle = '#4a3a20'; e.fillRect(256, 186, 128, 5); e.fillRect(316, 128, 5, 128);

  /* ── METROPOLITAIN 招牌：黄底深绿曲线体 ── */
  a.fillStyle = '#e8c34a'; a.fillRect(384, 128, 128, 128);
  a.strokeStyle = hex(P.parisGreen); a.lineWidth = 4;
  a.strokeRect(388, 132, 120, 120);
  a.fillStyle = hex(P.parisGreen); a.textAlign = 'center';
  a.font = 'italic bold 15px Georgia,serif';
  a.fillText('MÉTRO', 448, 180); a.fillText('POLITAIN', 448, 206);

  /* ── 树池箅子：放射 + 同心环，中心开孔是树坑的土 ── */
  a.fillStyle = '#3a3a36'; a.fillRect(0, 256, 128, 128);
  a.save(); a.beginPath(); a.rect(0, 256, 128, 128); a.clip();
  a.translate(64, 320);
  a.strokeStyle = '#22221f'; a.lineWidth = 2.6;
  for (let i = 0; i < 24; i++){
    const th = i / 24 * 6.2832;
    a.beginPath(); a.moveTo(Math.cos(th) * 22, Math.sin(th) * 22);
    a.lineTo(Math.cos(th) * 66, Math.sin(th) * 66); a.stroke();
  }
  for (let r0 = 26; r0 < 64; r0 += 9){
    a.beginPath(); a.arc(0, 0, r0, 0, 6.284); a.stroke();
  }
  a.strokeStyle = '#5a5a54'; a.lineWidth = 1;
  for (let r0 = 30; r0 < 64; r0 += 9){ a.beginPath(); a.arc(0, 0, r0, 0, 6.284); a.stroke(); }
  a.fillStyle = '#2a251d'; a.beginPath(); a.arc(0, 0, 20, 0, 6.284); a.fill();
  a.strokeStyle = '#7a756c'; a.lineWidth = 5; a.strokeRect(-62, -62, 124, 124);
  a.restore();

  /* ── 鱼鳞穹顶纹（Wallace / Morris 顶） ── */
  a.fillStyle = hex(P.parisGreen); a.fillRect(128, 256, 128, 128);
  a.strokeStyle = shade(P.parisGreen, 0.62); a.lineWidth = 1.4;
  for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++){
    const x = 128 + col * 15 + (row % 2 ? 7 : 0), y = 256 + row * 14 + 8;
    a.beginPath(); a.arc(x, y, 8, Math.PI, 0); a.stroke();
  }

  /* ── 石材（水池边缘 / 纪念柱） ── */
  a.fillStyle = hex(P.limestone); a.fillRect(384, 256, 128, 128);
  for (let i = 0; i < 120; i++){
    a.globalAlpha = 0.05 + rnd() * 0.12;
    a.fillStyle = rnd() > 0.5 ? hex(P.limestoneLt) : hex(P.limestoneDk);
    a.fillRect(384 + rnd() * 128, 256 + rnd() * 128, 4 + rnd() * 24, 3 + rnd() * 14);
  }
  a.globalAlpha = 1;

  /* ── 纯色格 ── */
  const SOLIDS = [
    ['iron',      hex(P.ironDk)],
    ['green',     hex(P.parisGreen)],
    ['guimard',   shade(P.parisGreen, 1.28)],   /* Guimard 氧化绿：比市政绿浅、偏黄 */
    ['gilt',      hex(P.gilt)],
    ['white',     '#ffffff'],
    ['benchGrey', shade(P.curb, 0.62)],         /* 街上的长椅是灰的，不是绿的 */
    ['stone',     hex(P.limestone)],
    ['stoneDk',   hex(P.limestoneDk)],
    ['dark',      '#0b0d10'],
    ['sand',      hex(P.sand)],
    ['metroY',    '#e8c34a'],
    ['bulb',      '#d9601f'],                   /* Guimard 灯罩琥珀橙 */
    ['foam',      hex(P.foam)],
    ['water',     hex(P.waterShallow)],
    ['soil',      shade(P.sand, 0.55)],
    ['ironLt',    shade(P.ironDk, 1.45)]
  ];
  SOLIDS.forEach((s, i) => {
    const cx = (i % 8) * 64, cy = 384 + ((i / 8) | 0) * 64;
    a.fillStyle = s[1]; a.fillRect(cx, cy, 64, 64);
    CELLS[s[0]] = cellUV(i);
  });
  /* 灯泡格在 emissive 图上点亮 */
  {
    const i = SOLIDS.findIndex(s => s[0] === 'bulb');
    e.fillStyle = '#ff9a3c';
    e.fillRect((i % 8) * 64, 384 + ((i / 8) | 0) * 64, 64, 64);
  }

  ATLAS = PC.texture(ca, {clamp: true, aniso: 4});
  ATLAS_E = PC.texture(ce, {clamp: true, aniso: 4});
  ATLAS.generateMipmaps = false; ATLAS.minFilter = THREE.LinearFilter;
  ATLAS_E.generateMipmaps = false; ATLAS_E.minFilter = THREE.LinearFilter;
  if (THREE.sRGBEncoding){ ATLAS.encoding = THREE.sRGBEncoding; ATLAS_E.encoding = THREE.sRGBEncoding; }
}

/* ═══════════════════ 2. 网格构建器 ═══════════════════
   为什么不用 P3D.helpers.GB：GB 按位置算 UV，而这一层的全部颜色都靠
   「UV 指到图集的哪一格」来决定，必须能逐面指定 UV。所以自带一个小的。
   支持一个 Y 轴摆位变换，静态件可以直接吐世界坐标，省一次矩阵合并。 */
function MB(){
  this.P = []; this.N = []; this.U = []; this.C = []; this.I = []; this.n = 0;
  this._x = 0; this._y = 0; this._z = 0; this._c = 1; this._s = 0;
  this._cr = 1; this._cg = 1; this._cb = 1; this._gr = 0; this._gh = 1;
}
MB.prototype.at = function(x, y, z, ry){
  this._x = x; this._y = y; this._z = z;
  this._c = Math.cos(ry || 0); this._s = Math.sin(ry || 0); return this;
};
/* 逐件配色：静态件全都合并进同一个 mesh，没有 instanceColor 可用，
   差异只能写进顶点色。col 是「乘在图集texel上的比值」，grime 是积污强度，
   gh 是积污消失的高度（雨溅只打得到下面那一截）。
   代价是每个顶点 +3 个 float，一个 draw call 都不多花。 */
MB.prototype.tint = function(col, grime, gh){
  this._cr = col ? col.r : 1; this._cg = col ? col.g : 1; this._cb = col ? col.b : 1;
  this._gr = grime || 0; this._gh = gh || 1.2; return this;
};
MB.prototype.home = function(){
  this._cr = this._cg = this._cb = 1; this._gr = 0; this._gh = 1;
  return this.at(0, 0, 0, 0);
};
MB.prototype.v = function(x, y, z, nx, ny, nz, u, vv){
  const c = this._c, s = this._s;
  this.P.push(this._x + x * c + z * s, this._y + y, this._z - x * s + z * c);
  this.N.push(nx * c + nz * s, ny, -nx * s + nz * c);
  this.U.push(u, vv);
  /* 底部积污：越靠近件的底部越脏。y 是**件的局部高度**，所以摆到蒙马特坡上也对。 */
  const d = this._gr ? 1 - this._gr * 0.44 * clamp(1 - y / this._gh, 0, 1) : 1;
  this.C.push(this._cr * d, this._cg * d, this._cb * d);
  return this.n++;
};
/* uv 参数两种写法：[u,v] 纯色格；[u0,v0,u1,v1] 矩形（按 a,b,c,d 四角铺开） */
function uv4(uv){
  return uv.length === 2 ? [uv[0], uv[1], uv[0], uv[1], uv[0], uv[1], uv[0], uv[1]]
                         : [uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]];
}
function nrm(a, b, c){
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}
/* ref = 物体内部一点：法线朝 ref 就翻绕序，保证所有面朝外 */
MB.prototype.quad = function(a, b, c, d, uv, ref){
  let n = nrm(a, b, c);
  if (ref && ((a[0] - ref[0]) * n[0] + (a[1] - ref[1]) * n[1] + (a[2] - ref[2]) * n[2]) < 0){
    const t = b; b = d; d = t; n = nrm(a, b, c);
  }
  const t = uv4(uv);
  const i0 = this.v(a[0], a[1], a[2], n[0], n[1], n[2], t[0], t[1]);
  const i1 = this.v(b[0], b[1], b[2], n[0], n[1], n[2], t[2], t[3]);
  const i2 = this.v(c[0], c[1], c[2], n[0], n[1], n[2], t[4], t[5]);
  const i3 = this.v(d[0], d[1], d[2], n[0], n[1], n[2], t[6], t[7]);
  this.I.push(i0, i1, i2, i0, i2, i3);
  return this;
};
MB.prototype.tri = function(a, b, c, uv, ref){
  let n = nrm(a, b, c);
  if (ref && ((a[0] - ref[0]) * n[0] + (a[1] - ref[1]) * n[1] + (a[2] - ref[2]) * n[2]) < 0){
    const t = b; b = c; c = t; n = nrm(a, b, c);
  }
  const t = uv4(uv);
  const i0 = this.v(a[0], a[1], a[2], n[0], n[1], n[2], t[0], t[1]);
  const i1 = this.v(b[0], b[1], b[2], n[0], n[1], n[2], t[2], t[3]);
  const i2 = this.v(c[0], c[1], c[2], n[0], n[1], n[2], t[4], t[5]);
  this.I.push(i0, i1, i2);
  return this;
};
/* 绕 Y 的回转体侧面。uv 是矩形时 u 绕一圈、v 由下到上 */
MB.prototype.tube = function(cx, cy, cz, r0, r1, y0, y1, seg, uv, capTop, capBot, rot){
  const ref = [cx, (y0 + y1) / 2, cz], isR = uv.length === 4, ph = rot || 0;
  const ring = (r, y) => {
    const o = [];
    for (let i = 0; i <= seg; i++){
      const t = ph + i / seg * Math.PI * 2;
      o.push([cx + Math.cos(t) * r, y, cz + Math.sin(t) * r]);
    }
    return o;
  };
  const A = ring(r0, y0), B = ring(r1, y1);
  for (let i = 0; i < seg; i++){
    const u0 = isR ? uv[0] + (uv[2] - uv[0]) * (i / seg) : uv[0];
    const u1 = isR ? uv[0] + (uv[2] - uv[0]) * ((i + 1) / seg) : uv[0];
    const q = isR ? [u0, uv[1], u1, uv[1], u1, uv[3], u0, uv[3]] : uv4(uv);
    const a = A[i], b = A[i + 1], c = B[i + 1], d = B[i];
    let n = nrm(a, b, c);
    if (((a[0] - ref[0]) * n[0] + (a[2] - ref[2]) * n[2]) < 0){ n = [-n[0], -n[1], -n[2]]; }
    const p = [a, b, c, d];
    const idx = [];
    for (let k = 0; k < 4; k++) idx.push(this.v(p[k][0], p[k][1], p[k][2], n[0], n[1], n[2], q[k * 2], q[k * 2 + 1]));
    /* 用外法线方向决定绕序 */
    const fn = nrm(p[0], p[1], p[2]);
    if (fn[0] * n[0] + fn[1] * n[1] + fn[2] * n[2] >= 0) this.I.push(idx[0], idx[1], idx[2], idx[0], idx[2], idx[3]);
    else this.I.push(idx[0], idx[2], idx[1], idx[0], idx[3], idx[2]);
  }
  if (capTop) this.disc(cx, y1, cz, r1, seg, uv.length === 4 ? [uv[0], uv[1]] : uv, 1, ph);
  if (capBot) this.disc(cx, y0, cz, r0, seg, uv.length === 4 ? [uv[0], uv[1]] : uv, -1, ph);
  return this;
};
MB.prototype.disc = function(cx, y, cz, r, seg, uv, up, rot){
  const t = uv4(uv), ph = rot || 0;
  const c0 = this.v(cx, y, cz, 0, up, 0, t[0], t[1]);
  let prev = -1, first = -1;
  for (let i = 0; i <= seg; i++){
    const th = ph + i / seg * Math.PI * 2;
    const id = this.v(cx + Math.cos(th) * r, y, cz + Math.sin(th) * r, 0, up, 0, t[0], t[1]);
    if (i === 0) first = id;
    /* 绕序：角度递增时 (中心, 当前, 上一个) 的几何法线朝 +Y。写反了朝上的面
       会被背面剔除——第一轮全部池水与所有顶盖就是这么消失的。 */
    else { if (up > 0) this.I.push(c0, id, prev); else this.I.push(c0, prev, id); }
    prev = id;
  }
  void first;
  return this;
};
MB.prototype.box = function(cx, cy, cz, sx, sy, sz, uv, skipBottom){
  const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2,
        z0 = cz - sz / 2, z1 = cz + sz / 2, ref = [cx, cy, cz];
  this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], uv, ref);
  this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], uv, ref);
  this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], uv, ref);
  this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], uv, ref);
  this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], uv, ref);
  if (!skipBottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], uv, ref);
  return this;
};
MB.prototype.geo = function(){
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
  g.setAttribute('normal',   new THREE.Float32BufferAttribute(this.N, 3));
  g.setAttribute('uv',       new THREE.Float32BufferAttribute(this.U, 2));
  /* 永远带一条 color：three r150 的 color_fragment 只在 USE_COLOR（= material.vertexColors）
     下才把 vColor 乘进 diffuse，而 instanceColor 是先乘进同一个 vColor 的。
     所以「材质开 vertexColors + 几何带 color 属性」是让 instanceColor 真正生效的唯一组合——
     少了这条属性，未绑定的 attribute 默认取 (0,0,0)，整批变黑。
     不做逐件配色的件这条全是 1，白乘一遍，不影响观感。 */
  g.setAttribute('color',    new THREE.Float32BufferAttribute(this.C, 3));
  g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.I, 1)
                            : new THREE.Uint16BufferAttribute(this.I, 1));
  g.computeBoundingSphere();
  return g;
};
MB.prototype.tris = function(){ return this.I.length / 3; };

/* 竖向明度渐变烤进顶点色：树冠内部因此有上亮下暗的层次，
   而这一层不花一个三角形——没有它，树冠从街上看就是一块纯色板。
   顶点色与 instanceColor 相乘，所以两者可以叠加使用。 */
function gradColors(g, lo, hi){
  const p = g.attributes.position, n = p.count, a = new Float32Array(n * 3);
  let y0 = 1e9, y1 = -1e9;
  for (let i = 0; i < n; i++){ const y = p.getY(i); if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const d = (y1 - y0) || 1;
  for (let i = 0; i < n; i++){
    const k = lo + (hi - lo) * ((p.getY(i) - y0) / d);
    a[i * 3] = k; a[i * 3 + 1] = k; a[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3));
  return g;
}

/* ═══════════════════ 3. 单件几何（实例池用的单位件） ═══════════════════ */

/* ── 树冠 ①：球瓣簇 ──────────────────────────────────────────────────
   一瓣 = 一个正二十面体（20 tri）按方向哈希推歪成不规则卵球。
   PolyhedronGeometry 不共享顶点，所以按「取整后的方向」查表，
   同一个角的几份拷贝必须拿到同一个系数，否则面会裂开。
   几瓣错位叠起来，轮廓由几条弧交出来——没有大平面，也没有尖角，
   这两样正是上一版「折纸感」的全部来源。

   变体表 [瓣心x, 瓣心y, 瓣心z, 半径x, 半径y, 半径z, 推歪幅度, 细分]。
   x 沿街、y 向上、z 横街。最后统一归一到单位包围盒，所以这里只管相对形状。
   「细分」只给近景变体的主瓣开到 1（80 tri）：主瓣直径 6m 上下，
   20 面的面片有 2.5m 宽，人站在树底下就是一块块的立方体感；
   细分一次面片缩到 1.2m，那个感觉就没了。外围小瓣不细分——它们本来就小。 */
const LOBES = [
  /* A 五瓣 · 主瓣居中偏上，四周挂一圈小瓣 —— 修剪后最常见的紧凑卵形 */
  [[ 0.00,  0.08,  0.00, 0.30, 0.29, 0.30, 0.16, 1],
   [-0.26, -0.09,  0.04, 0.22, 0.21, 0.22, 0.20],
   [ 0.26, -0.05, -0.05, 0.21, 0.22, 0.21, 0.20],
   [-0.09,  0.20, -0.06, 0.19, 0.18, 0.19, 0.22],
   [ 0.11, -0.20,  0.06, 0.20, 0.17, 0.20, 0.22]],
  /* B 五瓣 · 一瓣顶高、两瓣压低，整体偏一侧 —— 长偏了的老树 */
  [[-0.06,  0.12,  0.02, 0.28, 0.27, 0.28, 0.17, 1],
   [ 0.23, -0.01, -0.03, 0.24, 0.23, 0.23, 0.19],
   [-0.24, -0.13, -0.02, 0.21, 0.20, 0.21, 0.21],
   [ 0.05,  0.22,  0.05, 0.19, 0.17, 0.18, 0.22],
   [-0.02, -0.21, -0.05, 0.21, 0.16, 0.21, 0.22]],
  /* C 四瓣 · 左右并排、矮胖 —— 剪得狠的那一批 */
  [[-0.17,  0.03,  0.01, 0.27, 0.27, 0.27, 0.18, 1],
   [ 0.18,  0.06, -0.02, 0.26, 0.25, 0.26, 0.18],
   [ 0.01, -0.18,  0.05, 0.22, 0.19, 0.22, 0.22],
   [ 0.00,  0.20, -0.04, 0.20, 0.18, 0.20, 0.22]],
  /* D 四瓣 · 上下叠、瘦高 —— 补种没几年的小树 */
  [[ 0.03,  0.10, -0.02, 0.26, 0.28, 0.26, 0.16, 1],
   [-0.10, -0.12,  0.03, 0.25, 0.24, 0.25, 0.19],
   [ 0.13, -0.04,  0.06, 0.19, 0.20, 0.19, 0.22],
   [-0.04,  0.24, -0.03, 0.18, 0.17, 0.18, 0.22]]
];
/* 中景（165–560m）用的单瓣卵冠：一瓣 20 tri。这个距离上一株只有二三十像素，
   分不出瓣，但只要它是个卵球而不是双锥就不会读成纸片。 */
const LOBE_MID = [[0, 0, 0, 0.42, 0.40, 0.42, 0.21]];
/* 公园／广场自然冠：两瓣、错位更大更松（公园里的树不受修剪约束，冠也更不规则）。
   这一池是**全城常驻**的（531 个实例不按距离重填，砍远处等于把园子挖空），
   所以每多一瓣就是恒定 +1 万三角，全景机位上的三角预算就是这么被吃掉的。
   两瓣在 70m 外和三瓣看不出差别，多出来的余量留给街上那一档。 */
const LOBE_PARK = [[-0.14,  0.05,  0.05, 0.32, 0.31, 0.31, 0.23],
                   [ 0.16, -0.05, -0.06, 0.29, 0.29, 0.30, 0.23]];

const ICO = {};                                  /* 细分级 → 基础二十面体 */
function geoCrown(spec, salt){
  const P = [], LC = [];                       /* LC = 每个顶点所属瓣的瓣心，算法线要用 */
  spec.forEach((L, li) => {
    const d = L[7] || 0;
    const base = (ICO[d] || (ICO[d] = new THREE.IcosahedronGeometry(0.5, d))).attributes.position;
    const cache = {};
    for (let i = 0; i < base.count; i++){
      const x = base.getX(i), y = base.getY(i), z = base.getZ(i);
      const k = Math.round(x * 1e3) + '_' + Math.round(y * 1e3) + '_' + Math.round(z * 1e3);
      let f = cache[k];
      if (f === undefined)
        f = cache[k] = 1 - L[6] + 2 * L[6] *
            PC.hash2(x * 97 + li * 13 + salt, z * 97 + salt, Math.round(y * 211) + li * 7 + salt);
      P.push(L[0] + x * f * L[3] * 2, L[1] + y * f * L[4] * 2, L[2] + z * f * L[5] * 2);
      LC.push(L[0], L[1], L[2]);
    }
  });
  /* 归一到单位包围盒（±0.5）：实例缩放就等于真实的（冠幅, 冠高, 冠厚）米数，
     想核对尺度直接读 instance scale 就行，不用反推几何。 */
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < P.length; i += 3){
    if (P[i] < x0) x0 = P[i];         if (P[i] > x1) x1 = P[i];
    if (P[i+1] < y0) y0 = P[i+1];     if (P[i+1] > y1) y1 = P[i+1];
    if (P[i+2] < z0) z0 = P[i+2];     if (P[i+2] > z1) z1 = P[i+2];
  }
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, mz = (z0 + z1) / 2;
  const sx = 1 / (x1 - x0), sy = 1 / (y1 - y0), sz = 1 / (z1 - z0);
  for (let i = 0; i < P.length; i += 3){
    P[i] = (P[i] - mx) * sx;   P[i+1] = (P[i+1] - my) * sy;   P[i+2] = (P[i+2] - mz) * sz;
    LC[i] = (LC[i] - mx) * sx; LC[i+1] = (LC[i+1] - my) * sy; LC[i+2] = (LC[i+2] - mz) * sz;
  }
  /* 法线：面法线与「顶点→本瓣心」的径向按 28/72 混。
     纯面法线是硬棱（一颗切好的宝石），纯径向是完美球（水晶球）；
     偏向径向、留一点面法线，出来的是边缘软、块面之间还看得出层次的东西——
     轮廓仍是低模的多边形（这一点和全城的调子一致），但受光是连续的，
     「读起来像不透光的实心塑料」那一条要的就是这个。 */
  const N = new Float32Array(P.length);
  for (let t = 0; t < P.length; t += 9){
    const ax = P[t+3]-P[t], ay = P[t+4]-P[t+1], az = P[t+5]-P[t+2];
    const bx = P[t+6]-P[t], by = P[t+7]-P[t+1], bz = P[t+8]-P[t+2];
    let fx = ay*bz - az*by, fy = az*bx - ax*bz, fz = ax*by - ay*bx;
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    for (let k = 0; k < 3; k++){
      const o = t + k * 3;
      let rx = P[o] - LC[o], ry = P[o+1] - LC[o+1], rz = P[o+2] - LC[o+2];
      const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
      let nx = fx * 0.28 + rx * 0.72, ny = fy * 0.28 + ry * 0.72, nz = fz * 0.28 + rz * 0.72;
      const nl = Math.hypot(nx, ny, nz) || 1;
      N[o] = nx / nl; N[o+1] = ny / nl; N[o+2] = nz / nl;
    }
  }
  /* 顶点色：竖向明度渐变 × 位置噪声，深浅正好跑满 palette.foliage↔foliageLt
     那一段（foliageLt ≈ foliage × 1.32）。与 instanceColor 相乘，
     所以「这一株偏哪个树种的绿」仍归实例控制，冠内部的层次归这里。
     没有它，一株冠从街上看就是一块死绿板——改前整片同一个绿就是这么来的。 */
  const C = new Float32Array(P.length), ncache = {};
  for (let i = 0; i < P.length; i += 3){
    const vf = P[i+1] + 0.5;                    /* 0（冠底）→ 1（冠顶） */
    const key = Math.round(P[i]*400)+'_'+Math.round(P[i+1]*400)+'_'+Math.round(P[i+2]*400);
    let nz2 = ncache[key];
    if (nz2 === undefined)
      nz2 = ncache[key] = PC.hash2(P[i] * 260 + salt, P[i+2] * 260, Math.round(P[i+1] * 260) + salt);
    const k = (0.64 + 0.34 * vf) * (0.89 + 0.20 * nz2);
    C[i]   = k * (0.97 + 0.06 * nz2);
    C[i+1] = k * (1.00 + 0.05 * vf);
    C[i+2] = k * (0.94 - 0.05 * vf + 0.06 * nz2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal',   new THREE.BufferAttribute(N, 3));
  g.setAttribute('color',    new THREE.BufferAttribute(C, 3));
  g.computeBoundingSphere();
  return g;
}

/* ── 树冠 ②：远景并股用的三瓣连冠（>560m，一个盖住 6～84 株） ──
   这一档不能用球瓣簇：60 tri × 1100 个买不起，而且那个距离上一个冠只有十几像素。
   五边形截面（[z, y]，已归一到 ±0.5）在 x=0，沿街方向两端收成尖，
   三瓣把整段分成三个鼓包、瓣间收成 V 形凹口，整排读起来仍是「一棵一棵」，
   每棵却只摊到 3.3 tri。 */
const CSEC = [[0, -0.5], [0.5, -0.20], [0.40, 0.5], [-0.40, 0.5], [-0.5, -0.20]];
function geoCrownN(n){
  const m = new MB(), u = CELLS.white, w = 1 / n;
  for (let k = 0; k < n; k++){
    const x0 = -0.5 + k * w, x1 = x0 + w, xm = (x0 + x1) / 2;
    const ref = [xm, 0, 0];                    /* 绕序参考点必须落在本瓣里，不能用整体中心 */
    const A = [x0, 0, 0], B = [x1, 0, 0];      /* 本瓣两端的尖 */
    for (let i = 0; i < CSEC.length; i++){
      const p = CSEC[i], q = CSEC[(i + 1) % CSEC.length];
      const P = [xm, p[1], p[0]], Q = [xm, q[1], q[0]];
      m.tri(A, P, Q, u, ref);
      m.tri(B, Q, P, u, ref);
    }
  }
  return m.geo();
}

/* 树干：七棱锥台，单位高 1、单位**直径** 1（底半径 0.5）。14 tri
   街上看得最多的就是它：六棱在近景还读得出平面，七棱是不对称的，转起来不露馅。
   收分从 0.68 放到 0.88——悬铃木在 3.5m 分枝点处几乎还是胸径那么粗，
   收太快就成了一根削尖的木桩。 */
function geoTrunk(){
  const m = new MB();
  m.tube(0, 0, 0, 0.5, 0.44, 0, 1, 7, R.bark, false, false, 0.3);
  return m.geo();
}
/* 树池箅子：贴了铸铁放射纹的方板 + 一圈 0.22m 深的裙边。10 tri（花纹全在贴图上）
   裙边不是装饰，是为了在两种地面高度上都成立：行道树的坑开在人行道上
   （面比 terrainY 高 0.16m），广场上的树坑却直接开在铺装上（高 0.02m）。
   板顶按人行道摆，裙边在人行道上被埋掉、在广场上露出来读成花岗岩池缘——
   两种都是真实存在的做法，比「按地面类型分两套几何」省一个池。 */
function geoGrate(){
  /* 板顶抬 0.03：与人行道面同高会 z-fighting，实测结果是整块被铺装吃掉，
     一株行道树脚下什么都看不见（比埋在下面更难查——它是「有时闪一下」）。 */
  const m = new MB(), h = 0.75, d = -0.22, t = 0.03;
  m.quad([-h, t, -h], [h, t, -h], [h, t, h], [-h, t, h], R.grate, [0, -1, 0]);
  const ir = CELLS.iron;
  m.quad([-h, d, h], [h, d, h], [h, t, h], [-h, t, h], ir, [0, d, 0]);
  m.quad([h, d, -h], [-h, d, -h], [-h, t, -h], [h, t, -h], ir, [0, d, 0]);
  m.quad([h, d, h], [h, d, -h], [h, t, -h], [h, t, h], ir, [0, d, 0]);
  m.quad([-h, d, -h], [-h, d, h], [-h, t, h], [-h, t, -h], ir, [0, d, 0]);
  return m.geo();
}
/* 双头铸铁路灯 candélabre：杆高 5.50 + 灯具，56 tri
   底座 0.60 → 杆身锥收 → 顶部分叉臂展 1.10 → 两只梯形灯笼（灯罩靠图集自发光） */
function geoLamp(){
  const m = new MB(), ir = CELLS.iron;
  m.tube(0, 0, 0, 0.21, 0.17, 0, 0.60, 4, ir, true, false, 0.785);       /* 座 12 */
  m.tube(0, 0, 0, 0.08, 0.045, 0.60, 5.50, 5, ir, false, false, 0);       /* 杆 10 */
  m.box(0, 5.54, 0, 1.10, 0.075, 0.075, ir, true);                        /* 横臂 10 */
  for (const s of [-0.55, 0.55])
    m.tube(s, 0, 0, 0.18, 0.10, 5.58, 6.28, 4, R.glass, true, false, 0.785); /* 灯笼 12 */
  return m.geo();
}
/* Davioud 长椅：2.25 长，座高 0.45，靠背 0.85。44 tri
   街上灰、公园绿——靠 instanceColor 分，几何只有一份 */
function geoBench(){
  const m = new MB(), w = CELLS.white;
  m.box(0, 0.45, 0, 2.25, 0.06, 0.48, w, true);                 /* 座面 */
  m.box(0, 0.66, -0.22, 2.25, 0.36, 0.05, w, true);             /* 靠背 */
  m.box(-0.95, 0.22, 0, 0.06, 0.45, 0.42, w, true);
  m.box(0.95, 0.22, 0, 0.06, 0.45, 0.42, w, true);
  return m.geo();
}

/* ═══════════════════ 4. 静态件（合并进一个 mesh） ═══════════════════ */

/* Wallace 饮水泉 grand modèle，总高 2.71（streetlife.md §6 分段表）
   gy = 地面高程。整层原来一律栽在 y=0，蒙马特坡上这些件不是埋进山里就是悬空。 */
function putWallace(m, x, gy, z, ry, odd){
  m.at(x, gy, z, ry);
  const g = odd ? R.poster[0] : CELLS.green;   /* 全城有 7 座异色，放 1 座当彩蛋 */
  m.tube(0, 0, 0, 0.39, 0.31, 0, 0.55, 6, odd ? CELLS.gilt : CELLS.green, true, false, 0.39);
  m.tube(0, 0, 0, 0.33, 0.31, 0.55, 0.80, 6, CELLS.green, true, false, 0.39);
  for (let i = 0; i < 4; i++){                  /* 四女神像：背对背围成 Ø0.60 的柱 */
    const th = i / 4 * Math.PI * 2 + 0.78;
    const px = Math.cos(th) * 0.19, pz = Math.sin(th) * 0.19;
    m.tube(px, 0, pz, 0.115, 0.075, 0.80, 2.05, 4, g, true, false, th);
  }
  m.tube(0, 0, 0, 0.39, 0.30, 2.05, 2.35, 6, R.scale, false, false, 0.39);  /* 穹顶鱼鳞 */
  m.tube(0, 0, 0, 0.30, 0.05, 2.35, 2.50, 6, R.scale, false, false, 0.39);
  m.tube(0, 0, 0, 0.05, 0.012, 2.50, 2.71, 4, CELLS.green, true, false, 0);
  m.home();
}
/* Morris 广告柱：总高 6.00、柱身 Ø1.20、海报 1.20×3.52 三张围一圈 */
function putMorris(m, x, gy, z, ry, ps){
  m.at(x, gy, z, ry);
  m.tube(0, 0, 0, 0.66, 0.61, 0, 0.60, 8, CELLS.green, false, false, 0);
  /* 海报带：12 边形，每 4 边贴一张海报，缝隙落在三条棱上 */
  for (let k = 0; k < 3; k++){
    const a0 = k / 3 * Math.PI * 2 + 0.02, a1 = (k + 1) / 3 * Math.PI * 2 - 0.02;
    const rr = R.poster[ps[k]];
    for (let i = 0; i < 4; i++){
      const t0 = a0 + (a1 - a0) * i / 4, t1 = a0 + (a1 - a0) * (i + 1) / 4;
      const p0 = [Math.cos(t0) * 0.60, 0.60, Math.sin(t0) * 0.60];
      const p1 = [Math.cos(t1) * 0.60, 0.60, Math.sin(t1) * 0.60];
      const u0 = rr[0] + (rr[2] - rr[0]) * (i / 4), u1 = rr[0] + (rr[2] - rr[0]) * ((i + 1) / 4);
      m.quad(p0, p1, [p1[0], 4.12, p1[2]], [p0[0], 4.12, p0[2]],
             [u0, rr[1], u1, rr[3]], [0, 2.3, 0]);
    }
  }
  m.tube(0, 0, 0, 0.61, 0.61, 4.12, 4.42, 8, CELLS.green, false, false, 0);
  m.tube(0, 0, 0, 0.775, 0.775, 4.42, 4.64, 6, CELLS.green, true, false, 0.26); /* 六角挑檐 */
  m.tube(0, 0, 0, 0.65, 0.34, 4.64, 5.10, 6, R.scale, false, false, 0);
  m.tube(0, 0, 0, 0.34, 0.06, 5.10, 5.39, 6, R.scale, false, false, 0);
  m.tube(0, 0, 0, 0.07, 0.015, 5.39, 6.00, 4, CELLS.gilt, false, false, 0);
  m.home();
}
/* 报刊亭 kiosque：2.60 × 4.60，檐口 2.80，穹顶 +1.20 */
function putKiosque(m, x, gy, z, ry, grey){
  m.at(x, gy, z, ry);
  const c = grey ? CELLS.benchGrey : CELLS.green;
  m.box(0, 1.40, 0, 4.60, 2.80, 2.60, c, true);
  m.box(0, 1.55, 1.34, 3.40, 1.40, 0.10, R.glass, true);          /* 售卖窗 */
  m.tube(0, 0, 0, 2.55, 1.30, 2.80, 3.55, 8, c, false, false, 0.39);
  m.tube(0, 0, 0, 1.30, 0.10, 3.55, 4.00, 8, c, true, false, 0.39);
  for (const s of [-1, 1])                                        /* 两侧报刊展架 */
    m.box(s * 2.36, 1.55, 0, 0.10, 1.60, 1.80, R.poster[1], true);
  m.home();
}
/* Guimard C 型 entourage：围栏 + 两根蔓草灯柱 + METROPOLITAIN 字牌 */
function putGuimard(m, x, gy, z, ry){
  m.at(x, gy, z, ry);
  const gr = CELLS.guimard;
  /* 楼梯口 2.40 × 4.20，四级可见台阶，再往下用暗色封死 */
  for (let i = 0; i < 4; i++){
    const y = -0.22 * i;
    m.quad([-1.20, y, 2.10 - i * 0.34], [1.20, y, 2.10 - i * 0.34],
           [1.20, y, 1.76 - i * 0.34], [-1.20, y, 1.76 - i * 0.34], CELLS.stoneDk, [0, y - 1, 0]);
  }
  m.quad([-1.20, -0.9, 0.72], [1.20, -0.9, 0.72], [1.20, -0.9, -2.10], [-1.20, -0.9, -2.10],
         CELLS.dark, [0, -2, 0]);
  /* 围栏：三面 0.95 高，中部盾形饰板 */
  m.box(-1.24, 0.48, -0.1, 0.08, 0.95, 4.30, gr, true);
  m.box(1.24, 0.48, -0.1, 0.08, 0.95, 4.30, gr, true);
  m.box(0, 0.48, -2.20, 2.56, 0.95, 0.08, gr, true);
  for (const s of [-1, 1]) for (const zz of [-1.5, -0.2, 1.1])   /* 盾形饰板 écusson */
    m.quad([s * 1.30, 0.25, zz - 0.21], [s * 1.30, 0.25, zz + 0.21],
           [s * 1.30, 0.80, zz + 0.21], [s * 1.30, 0.80, zz - 0.21], gr, [0, 0.5, zz]);
  /* 两根灯柱：底 Ø0.22 收到 Ø0.08，顶端垂一个铃兰形橙灯罩 */
  for (const s of [-1, 1]){
    m.tube(s * 1.24, 0, 2.14, 0.11, 0.05, 0, 3.30, 5, gr, false, false, 0);
    m.tube(s * 1.24, 0, 2.14, 0.05, 0.15, 3.30, 3.60, 5, gr, false, false, 0);
    m.tube(s * 1.24, 0, 2.14, 0.15, 0.02, 3.18, 3.60, 6, CELLS.bulb, false, false, 0);
  }
  /* 招牌：宽 2.10 高 0.55，挂在两灯柱之间 */
  m.quad([-1.05, 2.35, 2.16], [1.05, 2.35, 2.16], [1.05, 2.90, 2.16], [-1.05, 2.90, 2.16],
         R.metro, [0, 2.6, 3]);
  m.quad([1.05, 2.35, 2.12], [-1.05, 2.35, 2.12], [-1.05, 2.90, 2.12], [1.05, 2.90, 2.12],
         R.metro, [0, 2.6, 1]);
  m.home();
}
/* 广场纪念柱／方尖碑：从空中一眼定位广场身份，尺寸取公认值 */
function putColumn(m, x, gy, z, kind){
  m.at(x, gy, z, 0);
  if (kind === 'obelisk'){                    /* 协和方尖碑：碑身约 22.8m + 基座 */
    m.box(0, 2.0, 0, 4.4, 4.0, 4.4, CELLS.stoneDk, true);
    m.tube(0, 0, 0, 1.30, 0.88, 4.0, 24.8, 4, R.stoneT, false, false, 0.785);
    m.tube(0, 0, 0, 0.88, 0.02, 24.8, 26.6, 4, CELLS.gilt, false, false, 0.785);
  } else {                                    /* 旺多姆柱 44m / 七月柱 47m */
    const h = kind === 'july' ? 47 : 44;
    m.box(0, 3.0, 0, 7.0, 6.0, 7.0, CELLS.stoneDk, true);
    m.tube(0, 0, 0, 1.90, 1.72, 6.0, h - 5, 10, kind === 'july' ? CELLS.iron : R.stoneT, false, false, 0);
    m.tube(0, 0, 0, 2.30, 2.30, h - 5, h - 3.4, 10, CELLS.stoneDk, true, false, 0);
    m.tube(0, 0, 0, 0.55, 0.40, h - 3.4, h, 5, CELLS.gilt, true, false, 0);
  }
  m.home();
}

/* ═══════════════════ 5. 空间索引（不许插进建筑 / 不许长在水里） ═══════════════════ */
function makeIndex(items, cell){
  const map = {};
  for (const it of items){
    const b = it.bb;
    for (let i = Math.floor(b[0] / cell); i <= Math.floor(b[2] / cell); i++)
      for (let j = Math.floor(b[1] / cell); j <= Math.floor(b[3] / cell); j++){
        const k = i + ',' + j; (map[k] || (map[k] = [])).push(it);
      }
  }
  return {
    at(x, z){ return map[Math.floor(x / cell) + ',' + Math.floor(z / cell)] || null; }
  };
}
function ptIn(p, x, z){
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++){
    const a = p[i], b = p[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/* 多边形主轴包围盒：公园的林荫道要顺着长轴排 */
function obb(poly){
  let cx = 0, cz = 0;
  for (const p of poly){ cx += p[0]; cz += p[1]; }
  cx /= poly.length; cz /= poly.length;
  let sxx = 0, szz = 0, sxz = 0;
  for (const p of poly){ const dx = p[0] - cx, dz = p[1] - cz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
  const th = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const ux = Math.cos(th), uz = Math.sin(th);
  let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
  for (const p of poly){
    const dx = p[0] - cx, dz = p[1] - cz;
    const a = dx * ux + dz * uz, b = -dx * uz + dz * ux;
    if (a < a0) a0 = a; if (a > a1) a1 = a;
    if (b < b0) b0 = b; if (b > b1) b1 = b;
  }
  return {cx, cz, ux, uz, vx: -uz, vz: ux, a0, a1, b0, b1, len: a1 - a0, wid: b1 - b0};
}

/* ═══════════════════ 6. 模块 ═══════════════════ */
let GROUP = null;

PC.mod('furniture', {
  order: 60,
  label: '街道家具',

  async build(ctx){
    const THREE_ = ctx.THREE, plan = ctx.plan, P = ctx.palette;
    if (!plan) throw new Error('PC.plan 缺失，街道家具无处可挂');

    GROUP = new THREE_.Group(); GROUP.name = 'furniture';
    ctx.scene.add(GROUP);

    ctx.step(0, '街道家具 · 烤图集'); await ctx.raf();
    buildAtlas(P);

    /* ── 材质：全层只有三种 ── */
    const SC = h => new THREE_.Color(h).convertSRGBToLinear();
    /* vertexColors 全层默认开着：MB 造的几何一律带 color 属性，
       静态件靠它做逐件配色，实例池靠它让 instanceColor 生效。不开就两边都失效。 */
    const MAT_ATLAS = new THREE_.MeshStandardMaterial({
      map: ATLAS, emissive: 0xffffff, emissiveMap: ATLAS_E, emissiveIntensity: 0.75,
      roughness: 0.62, metalness: 0.30, envMapIntensity: 0.8, vertexColors: true
    });
    /* 树叶：改前是不透光的实心塑料——roughness 0.94 已经够粗糙了，
       死感来自另外两件事：法线全是硬面法线（已在 geoCrown 里混掉），
       以及背光面纯黑、完全没有透光。
       这里补最后一点：极低的自发光（取 foliage 本色，强度 0.09）当叶片透光的
       替身，让背阴那半边仍读得出是叶子；再把环境光反射提一点点，
       天空的冷色会落在冠顶，冠内外因此有冷暖差。
       双面开着：球瓣簇有互相穿插的瓣，单面时从某些角度会看穿进冠内部。 */
    const MAT_FOL = new THREE_.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.97, metalness: 0, envMapIntensity: 0.50,
      emissive: SC(P.foliage), emissiveIntensity: 0.055,
      side: THREE_.DoubleSide, vertexColors: true
    });
    /* 路灯与长椅额外走 PC.varyShader：逐实例的 aVary=(age,grime,tint) 在片元里
       再分成两件事——底部积污（雨溅打得到的那一截）与朝上的面被摸磨出底色。
       这是只改 instanceColor 做不到的层次：**同一根灯杆身上也有新有旧**。
       长椅最明显：坐面和扶手是朝上的面，磨得最狠；椅脚积灰。
       两者本来就各是一个 InstancedMesh，clone 材质不多花 draw call。 */
    const MAT_LAMP = MAT_ATLAS.clone();
    PC.varyShader(MAT_LAMP, {y0: 0, y1: 1.7, wearColor: 0x8d8a80, key: 'lamp'});
    const MAT_BENCH = MAT_ATLAS.clone();
    MAT_BENCH.roughness = 0.72; MAT_BENCH.metalness = 0.16;
    PC.varyShader(MAT_BENCH, {y0: 0, y1: 0.50, wearColor: 0xa89a80, key: 'bench'});
    /* 树皮和树池箅子必须从 MAT_ATLAS 里分出来：那份材质是按铸铁调的
       （metalness .30 + envMapIntensity .8），铸铁需要它，这两样不需要。
       箅子是一块朝正上方的水平板，带着金属度去照 9 点钟的亮天空，整块被镜成
       白纸片——每棵行道树脚下一张，街面机位上比树还显眼。树皮同理，washed 成
       一条泛光的纸板。分出来不多花 draw call：它们本来就各是一个 InstancedMesh。 */
    const MAT_BARK = MAT_ATLAS.clone();
    MAT_BARK.metalness = 0; MAT_BARK.roughness = 0.95; MAT_BARK.envMapIntensity = 0.22;
    const MAT_GRATE = MAT_ATLAS.clone();
    MAT_GRATE.metalness = 0; MAT_GRATE.roughness = 0.92; MAT_GRATE.envMapIntensity = 0.18;
    const MAT_STONE = ctx.mats.stone;
    const MAT_WATER = new THREE_.MeshStandardMaterial({
      color: SC(P.waterShallow), roughness: 0.16, metalness: 0.15, envMapIntensity: 1.3
    });

    /* ── 索引：街廓 + 地标，用来挡住「树长进楼里」 ── */
    const solidPolys = [];
    for (const b of plan.blocks) solidPolys.push({bb: b.bb, poly: b.poly});
    for (const lm of (plan.landmarks || [])){
      const p = lm.hull || lm.poly;
      if (p && p.length > 2) solidPolys.push({bb: lm.bb, poly: p});
    }
    const IDX = makeIndex(solidPolys, 220);
    const river = plan.river;
    /* 蒙马特是抬起来的（plan.terrainY 最高 44m，terrain.js 也按它铺地）。
       上一轮只把树接上了坡，路灯／长椅／Wallace／Morris／报刊亭／地铁口／
       广场立柱／广场水池仍一律栽在 y=0，坡上不是埋进山里就是悬空。
       现在全层没有一件还写 y=0，一律读 tY。 */
    const tY = plan.terrainY || (() => 0);
    /* 人行道面比 terrainY 高这么多。**这个数是 terrain.js 里 WALK_H 的抄本**，
       那边没导出，只能对着抄——它改了这边要跟着改，否则树池箅子会埋回人行道下面。
       实测就是这么发现的：箅子摆在 tY+0.02，人行道面在 tY+0.16，
       每棵行道树脚下那块铸铁一直被盖着，从建成起就没露出来过。 */
    const WALK_H = 0.16;
    function free(x, z){
      const c = IDX.at(x, z);
      if (c) for (const it of c) if (ptIn(it.poly, x, z)) return false;
      if (river && river.inWater(x, z)) return false;
      return true;
    }

    ctx.step(6, '街道家具 · 排行道树'); await ctx.raf();

    /* ── 6.1 人行道断面：家具带的位置全部从这里算 ──
       人行道宽照抄 plan 的口径（quai 与其它街不同系数），
       路缘在 w/2−sw 处，家具带在路缘往建筑方向 0.65–0.90m。 */
    function sidewalkW(r){
      return r.klass === 'quai' ? clamp(r.w * 0.28, 2.4, 7.0) : clamp(r.w * 0.235, 1.5, 6.5);
    }
    function band(r){
      const sw = sidewalkW(r), curb = r.w / 2 - sw;
      return {sw, curb, tree: curb + Math.min(0.95, sw * 0.30), lamp: curb + 0.65, seat: curb + 0.80};
    }
    const TREE_KLASS = {quai: 1, boulevard: 1, avenue: 1, 'rue-majeure': 1};

    /* ── 6.1b 铸铁件的逐件配色 ────────────────────────────────────────
       图集里那几格颜色是烤死的（iron 格 = ironDk，green 格 = parisGreen），
       所以逐件差异要乘一个「目标色 ÷ 基色」的比值上去；贴图上的竖向铸痕
       因此保得住，只是整件偏了色。长椅例外——它取的是纯白格，
       instanceColor 就是最终色，不用换算。

       ⚠️ 踩过一次、值得写下来的坑：一开始拿「族里的绿 ÷ ironDk」当比值，全线爆表——
       ironDk 是近黑（线性 0.027），族绿比它亮两三倍，比值一律撞到上限，
       一百盏灯的 instanceColor 打印出来全是同一个数。**加了差异系统反而更整齐**。
       根因是伽马：在近黑色上，sRGB 里挪一点点，线性比值就翻几倍。
       所以灯杆改成**直接在比值空间上造差异**——比值本身就是参数，一眼能核，
       撞不撞上限直接打印得出来。 */
    const IRON_BASE  = SC(P.ironDk);
    const GREEN_BASE = SC(P.parisGreen);
    const IC1 = new THREE_.Color(), IC2 = new THREE_.Color(), IC3 = new THREE_.Color();
    function clampRatio(c, lo, hi){
      return c.setRGB(clamp(c.r, lo, hi), clamp(c.g, lo, hi), clamp(c.b, lo, hi));
    }
    /* 灯杆的逐盏比值。三个因子同一个 age 驱动，不是各随机各的：
         kBase 整体明暗（批次给 → 同一条街的灯一起深或一起浅）
         kAge  旧漆褪白 → 变亮变灰
         kDirt 积垢 → 压暗
       偏绿的方向不是我编的：取族里那一个绿相对 ironDk 的通道比，
       先按均值归一（只留色相、不带明度），再按 bias 插值回 1。 */
    function lampRatio(pf, out){
      IC3.set(pf.pick(PC.families.ironGreen, 149)).convertSRGBToLinear();
      const nb = (IC3.r + IC3.g + IC3.b) / (IRON_BASE.r + IRON_BASE.g + IRON_BASE.b) || 1;
      const dr = IC3.r / (IRON_BASE.r * nb), dg = IC3.g / (IRON_BASE.g * nb),
            db = IC3.b / (IRON_BASE.b * nb);
      const bias = 0.10 + 0.24 * pf.f(163);
      const k = (0.68 + 0.47 * pf.f(157)) * (1 + pf.age * 0.30) * (1 - pf.grime * 0.24);
      return out.setRGB(k * (1 + (dr - 1) * bias),
                        k * (1 + (dg - 1) * bias),
                        k * (1 + (db - 1) * bias));
    }
    /* 绿铸铁件（Wallace／Morris／报刊亭／地铁口）：基色是 parisGreen，
       族本来就围着它长，所以直接用 PC.vary.shade 走标准老化路径。 */
    function ironTarget(pf, out){
      return PC.vary.shade(pf.pick(PC.families.ironGreen, 149), pf, out);
    }
    /* 铸铁件候选：位置 + 地面高程 + 逐件风化档案 + 算好的颜色。
       颜色一次算完存成三个数——LOD 每次相机移动都重填，那条路径上不许 new Color。 */
    function ironCand(x, z, ry, batch){
      const pf = PC.vary.of('ironwork', x, z, batch);
      clampRatio(lampRatio(pf, IC2), 0.45, 1.75);
      return {x, z, ry, gy: tY(x, z), age: pf.age, grime: pf.grime, tint: pf.tint,
              cr: IC2.r, cg: IC2.g, cb: IC2.b};
    }
    /* 长椅：街上是灰漆木条（Davioud 的城市款），公园里是巴黎绿。
       木条被坐被摸，磨损与积灰交给 varyShader 逐面去分——这里只定整张椅子的底色。 */
    const BENCH_GREY = shade(P.curb, 0.62);      /* 与图集 benchGrey 格同源，不另编色 */
    function benchTint(c){
      const pf = PC.vary.of('ironwork', c.x, c.z, null);
      pf.age = c.age; pf.grime = c.grime; pf.tint = c.tint;    /* 与本件的 ironCand 档案对齐 */
      if (c.park) ironTarget(pf, IC1);
      else PC.vary.shade(BENCH_GREY, pf, IC1);
      c.cr = IC1.r; c.cg = IC1.g; c.cb = IC1.b;
      return c;
    }

    /* ── 6.2 行道树候选（逐株，不是逐段） ── */
    const treeC = [];         /* {x,z,ry,i,step,y,h,th,wid,sp,tone,r,tr} —— 一株一条 */
    const trunkC = [];        /* {x,z,r,h,kind} —— 只装广场/公园那些独立的树干 */
    const grateC = [];
    let lampC = [];       /* 6.3b 要按「离树多远」重新过滤，所以不是 const */
    let benchC = [];

    function speciesOf(r){
      const h = PC.hash2(r.a[0], r.a[1], 41);
      for (let i = 0; i < SPECIES.length; i++) if (h < SPECIES_CDF[i]) return SPECIES[i];
      return SPECIES[0];
    }
    /* 配色临时对象：build 期一次性用，绝不进 update()。 */
    const TCOL = new THREE_.Color(), TBARK = new THREE_.Color();

    /* 沿一条直线段栽一排树：一株一条候选，冠与干成对生成（同一条记录里），
       所以永远不会出现「有冠没干」或「有干没冠」——上一版两套表示分家，
       俯视时就看见一条绿带浮在半空、底下什么都没有。

       batch = 街道 id。一条街的树是同一年栽的同一个种，PC.vary 会让它们共享
       七成的基龄，只在剩下三成上逐株浮动——所以整条街读起来是「一批树」，
       走近了每一株又不一样。不传 batch 就退化成纯个体随机，那是噪声不是种群。 */
    const J = TREE.jitter;
    function plantRow(ax, az, ux, uz, len, sp, spacing, salt, batch){
      if (len < 14) return false;
      const mid = len / 2;
      const cx = ax + ux * mid, cz = az + uz * mid;
      /* 三点采样：中点必须可用，两端不可用就整段不要（宁可少一排，不要穿进楼里） */
      if (!free(cx, cz)) return false;
      if (!free(ax + ux * 2, az + uz * 2) && !free(ax + ux * (len - 2), az + uz * (len - 2))) return false;
      const ry = Math.atan2(-uz, ux);
      /* 整排的基准形态：同一排是同种同龄同一批修剪的树，基准必须一致，
         逐株只在这个基准上抖 ±12%——抖太多就成了野林子，不是巴黎。
         冠幅／冠高／冠厚的比例来自树种（悬铃木宽扁、椴偏卵、七叶饱满、洋槐瘦）。 */
      const hh = PC.hash2(cx, cz, 21 + salt);
      const ch0 = (TREE.crownHLo + (TREE.crownHHi - TREE.crownHLo) * hh) * sp.hK;
      const bot0 = TREE.botLo + (TREE.botHi - TREE.botLo) * PC.hash2(cx, cz, 41);
      const wid0 = (TREE.spreadLo + (TREE.spreadHi - TREE.spreadLo) * PC.hash2(cx, cz, 31)) * sp.wK;
      /* 批次色调：整条街一起偏亮或偏暗。同批的树是同年同苗圃来的，本来就该同调。 */
      const bTone = batch === undefined || batch === null
        ? 0.87 + 0.26 * PC.hash2(cx, cz, 57)
        : 0.87 + 0.26 * PC.hash2(batch * 7.3, batch * 3.1, 57);
      const n = Math.max(2, Math.round(len / spacing));
      const step = len / n;
      let put = 0;
      for (let i = 0; i < n; i++){
        const t = (i + 0.5) * step;
        const x = ax + ux * t, z = az + uz * t;
        if (!free(x, z)) continue;
        const pf = PC.vary.of('tree', x, z, batch);
        const j1 = PC.hash2(x, z, 21), j2 = PC.hash2(x, z, 31),
              j3 = PC.hash2(x, z, 41), j4 = PC.hash2(x, z, 71),
              j5 = PC.hash2(x, z, 91), j6 = PC.hash2(x, z, 101);
        /* 树龄真的驱动几何，不是只驱动颜色：老树冠幅大干径粗，
           补种没几年的小树整个小一圈。grow 和树皮明度、冠色深浅同源，
           所以一株「看着老」的树是四件事一起老，不是四个独立随机数。 */
        const grow = TREE.growLo + (TREE.growHi - TREE.growLo) * pf.age;
        /* 抖动与树种系数相乘会把极值推出去（实测过），所以最后一律夹回
           TREE 里写的规格区间——那几个数是硬指标。 */
        const ch = clamp(ch0 * grow * (1 - J + 2 * J * j1), TREE.crownHLo, TREE.crownHHi);
        const bot = clamp(bot0 + (j3 - 0.5) * 0.5, TREE.botLo, TREE.botHi);
        const wid = clamp(wid0 * grow * (1 - J + 2 * J * j4), TREE.spreadLo, TREE.spreadHi);
        /* 冠形变体：同种同街主要落在该树种偏好的那一套（mix 的概率），
           其余散到别的三套上。整排因此有一致的树种感，个体又不复制粘贴。 */
        const v = j5 < sp.mix ? sp.vB : (sp.vB + 1 + ((j5 * 97) | 0) % (LOBES.length - 1)) % LOBES.length;
        /* 倾斜用长尾整形：k=2.6 时约七成落在 0.35 倍以内（≈2.3°），
           只有 4% 超过 0.7 倍（≈4.6°）——一条街上有那么一两株明显歪的老树。 */
        const sick = PC.vary.tail(pf.f(223), 2.5);      /* 只为自检留档，配色里另算一遍 */
        const lean = TREE.tilt * (0.20 + 1.05 * PC.vary.tail(PC.hash2(x, z, 173), 2.6));
        const tx = (j2 - 0.5) * 2 * lean, tz = (j4 - 0.5) * 2 * lean;
        const tyaw = PC.hash2(x, z, 151) * 6.28;
        const y = bot + ch / 2;
        /* 歪着长的树，冠要跟着干歪过去，否则冠悬在干的正上方，一眼假。
           位移是 EU.set(tx, tyaw, tz) 那个欧拉（XYZ 序）作用在 (0,1,0) 上的水平分量。 */
        const cyaw = Math.cos(tyaw), syaw = Math.sin(tyaw);
        treeC.push({
          x, z, ry, i, step, gy: tY(x, z),
          y, h: ch, wid,
          lx: -Math.sin(tz) * cyaw * y,
          lz: (Math.sin(tx) + Math.sin(tz) * syaw) * y,
          /* 冠厚由冠幅派生再夹住：横街方向略扁是修剪的痕迹，
             但不能薄成 streetlife 表里那 2.2m——那个数是冬天剪完的绿墙，
             做成几何从斜后方看又是一张纸片。 */
          th: clamp(wid * TREE.thickK * sp.thK * (1 - J + 2 * J * j2), TREE.thickLo, TREE.thickHi),
          sp,
          /* 颜色在这里一次算完存成三个数：LOD 每次重填都要用，
             不能在 update 路径上 new Color。 */
          cr: 0, cg: 0, cb: 0, br: 0, bg: 0, bb: 0,
          v, batch, sick, lean,
          yaw: (j6 - 0.5) * 2 * TREE.yawJit,              /* 朝向抖动 ±20° */
          tx, tz, tyaw,
          /* 胸径 0.24–0.56m（规格表中位 0.33 / p75 0.50），再被树龄拉一把。
             几何的单位直径就是 1，所以这个数直接是米。 */
          r: clamp((TREE.trunkLo + (TREE.trunkHi - TREE.trunkLo) * PC.hash2(x, z, 61))
                   * (0.82 + 0.30 * pf.age), TREE.trunkLo, TREE.trunkHi),
          tr: bot + 0.9
        });
        const c = treeC[treeC.length - 1];
        foliageColor(sp, pf, bTone, TCOL); c.cr = TCOL.r; c.cg = TCOL.g; c.cb = TCOL.b;
        barkColor(sp, pf, TBARK);   c.br = TBARK.r; c.bg = TBARK.g; c.bb = TBARK.b;
        /* 行道树的坑开在人行道上，箅子要抬到人行道面；广场上的树没有这一档（见下） */
        grateC.push({x, z, ry, gy: tY(x, z) + WALK_H, k: 0.74 + 0.34 * (1 - pf.grime)});
        put++;
      }
      return put > 0;
    }

    /* 公园的林荫道：顺长轴排两列。
       不能直接照 OBB 的边放——公园轮廓是不规则的，OBB 的边多半落在园子外面，
       第一轮杜乐丽和卢森堡的双排椴树就是这么整排消失的。
       所以沿轴线扫一遍，只在「既在多边形里、又没压着房子」的最长连续段上栽。 */
    function plantAllee(pl, o, frac, sp, spacing, salt, batch){
      let any = false;
      for (const s of [-1, 1]){
        const b = s * o.wid * frac, step = 12;
        let bestFrom = 0, bestLen = 0, cur = null;
        for (let a = o.a0 + 10; a <= o.a1 - 10; a += step){
          const x = o.cx + o.ux * a + o.vx * b, z = o.cz + o.uz * a + o.vz * b;
          if (ptIn(pl.poly, x, z) && free(x, z)){ if (cur === null) cur = a; }
          else {
            if (cur !== null && a - step - cur > bestLen){ bestLen = a - step - cur; bestFrom = cur; }
            cur = null;
          }
        }
        if (cur !== null && (o.a1 - 10 - cur) > bestLen){ bestLen = o.a1 - 10 - cur; bestFrom = cur; }
        if (bestLen < 45) continue;
        const sx = o.cx + o.ux * bestFrom + o.vx * b, sz = o.cz + o.uz * bestFrom + o.vz * b;
        if (plantRow(sx, sz, o.ux, o.uz, bestLen, sp, spacing, salt, batch)) any = true;
      }
      return any;
    }

    for (const r of plan.roads){
      const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1], L = Math.hypot(dx, dz);
      if (L < 20) continue;
      const ux = dx / L, uz = dz / L, nx = uz, nz = -ux;
      const bd = band(r);
      const trimmed = L - 8;
      /* 批次 = 街道 id。一条街的灯是同一次市政工程装上去的，同批同龄；
         街与街之间差得开。树、灯、椅共用这个批次号——它们确实是同一条街的东西。 */
      const batch = r.id === undefined ? null : r.id;
      /* 路灯候选：所有街都有灯，大道 28m、次街 24m，相位与树错开 */
      if (bd.sw >= 1.8){
        const step = (r.klass === 'boulevard' || r.klass === 'avenue') ? 28 : 24;
        const n = Math.max(1, Math.round(trimmed / step));
        for (let s = -1; s <= 1; s += 2) for (let i = 0; i < n; i++){
          const t = 4 + (i + 0.5) / n * trimmed;
          const x = r.a[0] + ux * t + nx * s * bd.lamp, z = r.a[1] + uz * t + nz * s * bd.lamp;
          if (free(x, z)) lampC.push(ironCand(x, z, Math.atan2(-uz, ux) + Math.PI / 2, batch));
        }
      }
      /* 长椅候选：人行道 ≥3.5m，每 120m 一张，背朝车行道 */
      if (bd.sw >= 3.5){
        const n = Math.max(1, Math.round(trimmed / 120));
        for (let i = 0; i < n; i++){
          const t = 20 + (i + 0.5) / n * (trimmed - 40);
          const s = PC.hash2(r.a[0] + t, r.a[1], 71) > 0.5 ? 1 : -1;
          const x = r.a[0] + ux * t + nx * s * bd.seat, z = r.a[1] + uz * t + nz * s * bd.seat;
          if (free(x, z)){
            const c = ironCand(x, z, Math.atan2(-uz, ux), batch);
            c.park = false; benchTint(c); benchC.push(c);
          }
        }
      }
      /* 行道树：只有够宽的街才有 */
      if (!TREE_KLASS[r.klass] || bd.sw < TREE.minSidewalk) continue;
      const sp = speciesOf(r);
      const spacing = (r.klass === 'boulevard' || r.klass === 'avenue') ? TREE.spacingBd : TREE.spacingRue;
      /* 大道／滨河路两侧都种（双排林荫道），次街只种一侧。
         次街单侧不是省事——巴黎的 rue 大多确实只有一边有树，人行道
         另一边要留给店面陈列和卸货。两边都种会把 12m 宽的街封成一条绿隧道。

         这里同时删掉了旧的「特宽大道内侧再来一排」：那一排落在
         `bd.tree − min(9, w×0.11)`，w=40 时是离中线 10.05m，而路缘在 13.5m ——
         整排树种进了机动车道。俯视看不出来，人站在街上一眼就看见树从沥青里长出来。 */
      const both = r.klass === 'boulevard' || r.klass === 'avenue' || r.klass === 'quai';
      const only = both ? 0 : (PC.hash2(r.a[0], r.a[1], 131) > 0.5 ? 1 : -1);
      for (let s = -1; s <= 1; s += 2){
        if (only && s !== only) continue;
        plantRow(r.a[0] + ux * 4 + nx * s * bd.tree, r.a[1] + uz * 4 + nz * s * bd.tree,
                 ux, uz, trimmed, sp, spacing, s + 2, batch);
      }
    }

    ctx.step(14, '街道家具 · 种公园的树'); await ctx.raf();

    /* ── 6.3 广场与公园的树 ──
       广场：猫头修剪，一根光干加一个扁球，沿周边内缩 6m 排。
       公园：自然冠，更大更松；规则式大园（杜乐丽/卢森堡这一类）沿长轴加双排林荫道。 */
    const balls = [];         /* {x,y,z,rx,ry_,rz,cr,cg,cb} */
    const parkOrder = plan.places.slice().sort((a, b) => b.area - a.area);
    for (let pi = 0; pi < parkOrder.length; pi++){
      const pl = parkOrder[pi];
      if (pl.kind === 'cemetery') continue;
      /* 批次 = 园子。一个园子里的树是同一次绿化工程栽的，同种同龄；
         园与园之间换种换龄——所以杜乐丽和卢森堡不会长成一模一样的两片绿。 */
      const pbatch = 4001 + pi;
      const psp = SPECIES[(PC.hash2(pl.center[0], pl.center[1], 43) * SPECIES.length) | 0] || SPECIES[0];
      const pTone = 0.87 + 0.26 * PC.hash2(pbatch * 7.3, pbatch * 3.1, 57);
      const isPark = pl.kind === 'park' || pl.kind === 'garden';
      const poly = pl.poly;
      let ring = null;
      try { ring = PC.poly.inset(poly, isPark ? 7 : 5.5); } catch (e){ ring = null; }
      if (!ring || ring.length < 3) ring = poly;
      /* 沿周边按弧长撒点，配额随面积走，小广场只有几棵 */
      let per = 0;
      for (let i = 0; i < ring.length; i++){
        const a = ring[i], b = ring[(i + 1) % ring.length];
        per += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
      const quota = clamp(Math.round(Math.sqrt(pl.area) / (isPark ? 11 : 15)), isPark ? 5 : 3, 26);
      const step = per / quota;
      let acc = step * 0.5;
      for (let i = 0; i < ring.length; i++){
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 1e-3) continue;
        const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
        while (acc < L){
          const x = a[0] + ux * acc, z = a[1] + uz * acc; acc += step;
          if (!free(x, z)) continue;
          const h = PC.hash2(x, z, 81);
          const pf = PC.vary.of('tree', x, z, pbatch);
          /* 同一个树龄同时管三样：冠的大小、冠的深浅、树皮的明暗。
             三样各随机各的就是塑料玩具，一个 age 统一驱动才是岁月。 */
          const grow = TREE.growLo + (TREE.growHi - TREE.growLo) * pf.age;
          foliageColor(psp, pf, pTone, TCOL);
          barkColor(psp, pf, TBARK);
          const gy = tY(x, z);
          /* 冠也不是正球：三个轴向各再抖 ±11%，同一株的横竖比就不一样了 */
          const ax1 = 0.89 + 0.22 * pf.f(181), az1 = 0.89 + 0.22 * pf.f(191);
          if (isPark){
            /* 公园自然冠：比街上的大一圈（不受修剪约束），但冠径压到 6.8–10.8m。
               旧值 8.8–14.4m 是全场最大的绿体，从对岸看就是一颗颗悬在
               河堤女儿墙上方的巨型二十面体（chk-river 那排）。 */
            const rr = (3.4 + 2.0 * h) * grow;
            balls.push({x, y: gy + 3.8 + rr * 0.75, z,
                        rx: rr * 2 * ax1, ry: rr * 1.75 * psp.hK, rz: rr * 2 * az1,
                        cr: TCOL.r, cg: TCOL.g, cb: TCOL.b});
            trunkC.push({x, z, gy, r: (0.48 + 0.22 * h) * grow, h: 4.2, k: 1, b: balls.length - 1,
                         br: TBARK.r, bg: TBARK.g, bb: TBARK.b});
          } else {
            const rr = (2.3 + 0.8 * h) * grow;              /* 猫头：干高 3.5，冠是扁球 */
            balls.push({x, y: gy + 3.8 + rr * 0.62, z,
                        rx: rr * 2 * ax1, ry: rr * 1.42, rz: rr * 2 * az1,
                        cr: TCOL.r, cg: TCOL.g, cb: TCOL.b});
            trunkC.push({x, z, gy, r: (0.40 + 0.16 * h) * grow, h: 4.0, k: 0, b: balls.length - 1,
                         br: TBARK.r, bg: TBARK.g, bb: TBARK.b});
            grateC.push({x, z, ry: 0, gy: gy + WALK_H, k: 0.74 + 0.34 * (1 - pf.grime)});
          }
        }
        acc -= L;
      }
      /* 规则式大园的双排林荫道：顺长轴，两侧各一排修剪成方块的椴树
         （杜乐丽「南北两列修剪成方块的椴树」、卢森堡的成片栗树林荫都是这个形） */
      if (isPark && pl.area > 40000){
        const o = obb(poly);
        if (o.len > 90 && o.wid > 40){
          const sp2 = SPECIES[1];                    /* 椴树：杜乐丽那两列就是它 */
          if (!plantAllee(pl, o, 0.34, sp2, 8.0, 9, pbatch))
            if (!plantAllee(pl, o, 0.26, sp2, 8.0, 9, pbatch))
              plantAllee(pl, o, 0.17, sp2, 8.0, 9, pbatch);
        }
      }
      /* 公园长椅：绿的 */
      if (isPark && pl.area > 9000){
        const c = pl.center;
        for (let i = 0; i < 4; i++){
          const th = i / 4 * Math.PI * 2 + 0.6;
          const rr = Math.sqrt(pl.area) * 0.24;
          const x = c[0] + Math.cos(th) * rr, z = c[1] + Math.sin(th) * rr;
          if (free(x, z)){
            const bc = ironCand(x, z, th, pbatch);
            bc.park = true; benchTint(bc); benchC.push(bc);
          }
        }
      }
    }

    /* ── 6.3b 家具带避让：树先占位，灯和椅让开 ──
       路灯带在路缘 +0.65、行道树带在路缘 +0.95，横向只差 0.30m——比树干半径还小。
       两者沿街的相位又互不相干（灯 24–28m，树 7–8.5m），撞上是迟早的事：
       实测 400 盏可见路灯里 30 盏的杆从树干里穿出来，160 张可见长椅里 45 张
       被树钉穿。街面机位一眼就看得见，从空中看不见——所以它躲过了前几轮自检。
       真实巴黎的次序也是这个：树坑是定死的，灯杆和长椅躲着排。 */
    {
      const CELL = 24, grid = {};
      const put = (x, z) => {
        const k = Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
        (grid[k] || (grid[k] = [])).push(x, z);
      };
      const clearOf = (x, z, rad) => {
        const r2 = rad * rad;
        for (let i = Math.floor((x - rad) / CELL); i <= Math.floor((x + rad) / CELL); i++)
          for (let j = Math.floor((z - rad) / CELL); j <= Math.floor((z + rad) / CELL); j++){
            const c = grid[i + ',' + j];
            if (!c) continue;
            for (let k = 0; k < c.length; k += 2){
              const dx = c[k] - x, dz = c[k + 1] - z;
              if (dx * dx + dz * dz < r2) return false;
            }
          }
        return true;
      };
      for (const t of treeC) put(t.x, t.z);
      for (const t of trunkC) put(t.x, t.z);
      /* 1.7m：灯座半径 0.21 + 树干半径 ≤0.5，再留出灯罩不扎进冠里的余量。
         2.4m：长椅半长 1.13 + 树干半径 ≤0.5 + 余量。 */
      lampC = lampC.filter(c => clearOf(c.x, c.z, 1.7));
      benchC = benchC.filter(c => clearOf(c.x, c.z, 2.4));
    }

    ctx.step(22, '街道家具 · 摆铸铁件'); await ctx.raf();

    /* ── 6.4 静态件：Wallace / Morris / 报刊亭 / 地铁口 / 纪念柱 ── */
    const MS = new MB();
    let nW = 0, nM = 0, nK = 0, nG = 0;

    /* 绿铸铁静态件的逐件配色：与灯杆同一套档案，只是换成顶点色写进合并 mesh。
       基色是图集 green 格（parisGreen），所以这里换算的是相对 GREEN_BASE 的比值。
       gh = 积污消失的高度：雨溅只打得到底下那一截，高的件那一截占比就小。 */
    function greenTint(m, x, z, batch, gh){
      const pf = PC.vary.of('ironwork', x, z, batch);
      ironTarget(pf, IC1);
      clampRatio(ratioTint(GREEN_BASE, IC1, IC2), 0.72, 1.34);
      m.tint(IC2, pf.grime, gh);
      return pf;
    }

    /* Wallace：广场角与街口，全城约 20 处。
       这是一个**标准件的种群**（全城上百座同一副模子），不是唯一的地标，
       所以配色可以按族浮动；形制一个尺寸都没动。 */
    for (const pl of parkOrder){
      if (nW >= BUDGET.wallace) break;
      if (pl.area < 1500 || pl.kind === 'cemetery') continue;
      const ring = PC.poly.inset(pl.poly, 4) || pl.poly;
      let put = 0;
      for (let i = 0; i < ring.length && put < 2 && nW < BUDGET.wallace; i++){
        const v = ring[(i * 3) % ring.length];
        if (!free(v[0], v[1])) continue;
        const c = pl.center;
        greenTint(MS, v[0], v[1], nW, 1.0);
        putWallace(MS, v[0], tY(v[0], v[1]), v[1], Math.atan2(-(c[1] - v[1]), c[0] - v[0]), nW === 6);
        nW++; put++;
      }
    }
    /* Morris：大道上每 400m 一座，优先路口与广场边 */
    for (const r of plan.roads){
      if (nM >= BUDGET.morris) break;
      if (r.klass !== 'boulevard' && r.klass !== 'avenue') continue;
      const bd = band(r);
      if (bd.sw < 4.0) continue;
      const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1], L = Math.hypot(dx, dz);
      if (L < 120) continue;
      const ux = dx / L, uz = dz / L, nx = uz, nz = -ux;
      const n = Math.max(1, Math.floor(L / 400));
      for (let i = 0; i < n && nM < BUDGET.morris; i++){
        const t = (i + 0.5) / n * L;
        const s = PC.hash2(r.a[0] + t, r.a[1], 101) > 0.5 ? 1 : -1;
        const x = r.a[0] + ux * t + nx * s * (bd.curb + 0.95);
        const z = r.a[1] + uz * t + nz * s * (bd.curb + 0.95);
        if (!free(x, z)) continue;
        const h = PC.hash2(x, z, 111);
        /* 三面海报各抽各的：整城同一张贴纸最露馅，柱子转到哪一面都一样。 */
        const pf = greenTint(MS, x, z, r.id, 1.5);
        putMorris(MS, x, tY(x, z), z, h * 6.28,
                  [(pf.f(311) * 4) | 0, (pf.f(313) * 4) | 0, (pf.f(317) * 4) | 0]);
        nM++;
      }
    }
    /* 报刊亭：只在大道与广场边，人行道 ≥5.0 */
    for (const r of plan.roads){
      if (nK >= BUDGET.kiosque) break;
      if (r.klass !== 'boulevard') continue;
      const bd = band(r);
      if (bd.sw < 5.0) continue;
      const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1], L = Math.hypot(dx, dz);
      if (L < 300) continue;
      const ux = dx / L, uz = dz / L, nx = uz, nz = -ux;
      const t = L * 0.5, s = PC.hash2(r.a[0], r.a[1], 121) > 0.5 ? 1 : -1;
      const x = r.a[0] + ux * t + nx * s * (bd.curb + 1.5);
      const z = r.a[1] + uz * t + nz * s * (bd.curb + 1.5);
      if (!free(x, z)) continue;
      greenTint(MS, x, z, r.id, 1.3);
      putKiosque(MS, x, tY(x, z), z, Math.atan2(-uz, ux), PC.hash2(x, z, 131) > 0.6);
      nK++;
    }
    /* Guimard 地铁口：全巴黎只剩 86 座，城市层里也只放这几处 */
    const GUIMARD_AT = ['协和广场', '歌剧院广场', '巴士底广场', '圣米歇尔广场',
                        '夏特莱广场', '皮加勒广场', '星形广场', '太子广场'];
    for (const name of GUIMARD_AT){
      if (nG >= BUDGET.guimard) break;
      const pl = plan.places.find(p => p.name === name);
      if (!pl) continue;
      const ring = PC.poly.inset(pl.poly, 8) || pl.poly;
      const c = pl.center;
      let best = null;
      for (const v of ring){ if (free(v[0], v[1])){ best = v; break; } }
      if (!best) continue;
      const vx = c[0] - best[0], vz = c[1] - best[1];
      greenTint(MS, best[0], best[1], 6100 + nG, 1.1);
      putGuimard(MS, best[0], tY(best[0], best[1]), best[1], Math.atan2(-vz, vx) - Math.PI / 2);
      nG++;
    }
    /* 三根广场立柱：从空中一眼认出协和、旺多姆、巴士底。
       ⚠️ 这三根是有唯一正确答案的真实纪念物，**形制与颜色一个都不许随机**。
       这里只给它们「经历了什么」——底部的水渍积垢，判据是改的不是「它是什么」。 */
    const COLS = [['协和广场', 'obelisk'], ['旺多姆广场', 'vendome'], ['巴士底广场', 'july']];
    for (const cc of COLS){
      const pl = plan.places.find(p => p.name === cc[0]);
      if (!pl) continue;
      const sf = PC.vary.of('stone', pl.center[0], pl.center[1]);
      MS.tint(null, sf.grime * 0.8, 4.5);
      putColumn(MS, pl.center[0], tY(pl.center[0], pl.center[1]), pl.center[1], cc[1]);
    }

    ctx.step(30, '街道家具 · 挖水池'); await ctx.raf();

    /* ── 6.5 广场水池与喷泉：从 plan.places 的 features 里读，不自己发明 ── */
    const BS = new MB(), WS = new MB();
    const WATERY = /水池|喷泉|水阶|曲池|池塘|瀑布|大水池/;
    let nB = 0;
    for (const pl of parkOrder){
      if (nB >= BUDGET.basins) break;
      if (!pl.features || !pl.features.some(f => WATERY.test(f))) continue;
      const o = obb(pl.poly);
      const rr = clamp(Math.sqrt(pl.area) * 0.075, 4, 19);
      /* 长轴明显的规则式园：水池落在轴线上；否则落在中心 */
      const spots = (o.len > o.wid * 2.2 && o.len > 200)
        ? [[o.cx + o.ux * o.a0 * 0.52, o.cz + o.uz * o.a0 * 0.52],
           [o.cx + o.ux * o.a1 * 0.52, o.cz + o.uz * o.a1 * 0.52]]
        : [[pl.center[0], pl.center[1]]];
      for (const s of spots){
        if (nB >= BUDGET.basins) break;
        if (!free(s[0], s[1])) continue;
        const gy = tY(s[0], s[1]);
        /* 池壁：外壁 + 压顶（内壁在水面以下，省掉）。
           tube 的 y0/y1 是件的局部高度，所以整池的高程靠 at() 的 y 抬上去。 */
        BS.at(0, gy, 0, 0);
        BS.tube(s[0], 0, s[1], rr, rr, 0, 0.42, 10, R.stoneT, false, false, 0);
        BS.at(s[0], gy, s[1], 0);
        for (let i = 0; i < 10; i++){
          const t0 = i / 10 * 6.2832, t1 = (i + 1) / 10 * 6.2832;
          BS.quad([Math.cos(t0) * rr, 0.42, Math.sin(t0) * rr], [Math.cos(t1) * rr, 0.42, Math.sin(t1) * rr],
                  [Math.cos(t1) * (rr - 0.55), 0.42, Math.sin(t1) * (rr - 0.55)],
                  [Math.cos(t0) * (rr - 0.55), 0.42, Math.sin(t0) * (rr - 0.55)], CELLS.stone, [0, -3, 0]);
        }
        BS.home();
        WS.at(0, gy, 0, 0);
        WS.disc(s[0], 0.26, s[1], rr - 0.6, 10, CELLS.water, 1, 0);
        /* 大池加一道水柱 */
        if (rr > 9){
          WS.tube(s[0], 0, s[1], 0.26, 0.09, 0.26, 3.6 + rr * 0.12, 4, CELLS.foam, true, false, 0);
        }
        WS.home();
        nB++;
      }
    }

    ctx.step(38, '街道家具 · 装池子'); await ctx.raf();

    /* ── 6.6 装配 ── */
    /* 4 套冠形变体 = 4 份几何 = 4 个池。InstancedMesh 只吃一份几何，
       想要「整排不一模一样」就只能这么摊；代价是 3 个 draw call，
       在 200 的总预算里买得起（本层加完是 14 个）。 */
    /* 近景行道树可由宿主用 Tripo GLB 顶替（window.__PARIS_TREE_GLB）。程序化冠是
       「冠」的几何、原点在冠心；GLB 树是「整棵树」、原点在根部落地——两条路径的
       实例变换在 fillTrees 里分开算。GLB 树三角面远高于程序化冠（实测 18.4k 减到
       7.5k），所以近景实例上限必须单独给，不能沿用 crownNear 的 150。 */
    const TREE_GLB = (typeof window !== 'undefined') ? window.__PARIS_TREE_GLB : null;
    const TREE_VARS = TREE_GLB ? (TREE_GLB.variants || [TREE_GLB]) : null;
    /* nearMax 是近景树的总配额，均分给各变体——不然变体越多，近景三角面越失控 */
    const NEAR_CAP = TREE_VARS ? Math.max(1, Math.round((TREE_GLB.nearMax || 36) / TREE_VARS.length)) : BUDGET.crownNear;
    const gCrownV = TREE_VARS ? TREE_VARS.map(v => v.geo) : LOBES.map((spec, i) => geoCrown(spec, 17 + i * 131));
    const gCrownMid = geoCrown(LOBE_MID, 911);
    const gCrown3 = gradColors(geoCrownN(3), 0.66, 1.10);
    const gBall = geoCrown(LOBE_PARK, 613);
    const gTrunk = geoTrunk(), gGrate = geoGrate(), gLamp = geoLamp(), gBench = geoBench();

    const crown3Max = Math.min(treeC.length, BUDGET.crown3Max);
    /* 球冠不按距离重填（它是公园从空中的唯一表示，砍远处等于把园子挖空），
       所以上限必须罩得住全部候选。旧上限 240 罩不住 500+ 个候选，而 balls 是按
       「面积大的园子在前」压进来的，被砍掉的一律是小园子——皇宫花园、爱丽舍方园
       这些正好都在市中心，街面机位最可能站的地方，于是站进去看到的是一片空地。
       一个球瓣簇 40 tri，640 个 = 2.6 万三角、仍是 1 个 draw call，买得起。 */
    if (balls.length > BUDGET.ballMax)
      console.warn('[furniture] 球冠候选 ' + balls.length + ' 超过上限 ' +
                   BUDGET.ballMax + '，会有园子整片没树');
    const ballN = Math.min(balls.length, BUDGET.ballMax);
    const pCrownV = gCrownV.map((g, i) => PC.pool(g, TREE_VARS ? TREE_VARS[i].mat : MAT_FOL, NEAR_CAP,
                                                  {colors: !TREE_GLB, castShadow: true}));
    const pCrownMid = PC.pool(gCrownMid, MAT_FOL, BUDGET.crownMid, {colors: true, castShadow: true});
    const pCrown3 = PC.pool(gCrown3, MAT_FOL, crown3Max, {colors: true, castShadow: true});
    const pBall = PC.pool(gBall, MAT_FOL, ballN, {colors: true, castShadow: true});
    const pTrunk = PC.pool(gTrunk, MAT_BARK, BUDGET.trunkCap, {colors: true, receiveShadow: false});
    const pGrate = PC.pool(gGrate, MAT_GRATE, BUDGET.grateCap, {colors: true, castShadow: false});
    /* vary:true 给池子挂上 aVary=(age,grime,tint) 逐实例属性，配 MAT_LAMP/MAT_BENCH
       上注入的 varyShader 用。instanceColor 和 aVary 都不增 draw call。 */
    const pLamp = PC.pool(gLamp, MAT_LAMP, BUDGET.lampCap,
                          {colors: true, vary: true, receiveShadow: false});
    const pBench = PC.pool(gBench, MAT_BENCH, BUDGET.benchCap, {colors: true, vary: true});
    for (const p of pCrownV.concat([pCrownMid, pCrown3, pBall, pTrunk, pGrate, pLamp, pBench]))
      GROUP.add(p.mesh);

    const statics = new THREE_.Mesh(MS.geo(), MAT_ATLAS);
    statics.castShadow = statics.receiveShadow = true;
    GROUP.add(statics);
    if (BS.n){
      const mb = new THREE_.Mesh(BS.geo(), MAT_STONE);
      mb.castShadow = mb.receiveShadow = true; GROUP.add(mb);
    }
    if (WS.n) GROUP.add(new THREE_.Mesh(WS.geo(), MAT_WATER));

    /* 球冠一次铺满全城；行道树冠逐株、按距离并股，见 6.7 */
    const M4 = new THREE_.Matrix4(), Q = new THREE_.Quaternion(),
          V = new THREE_.Vector3(), SVec = new THREE_.Vector3(), COL = new THREE_.Color();
    const AXIS = new THREE_.Vector3(0, 1, 0);
    /* 公园／广场的树不沿街，所以这里可以给满 360° 的随机朝向 */
    for (let i = 0; i < ballN; i++){
      const b = balls[i];
      Q.setFromAxisAngle(AXIS, PC.hash2(b.x, b.z, 141) * 6.28);
      M4.compose(V.set(b.x, b.y, b.z), Q, SVec.set(b.rx, b.ry, b.rz));
      pBall.push(M4, COL.setRGB(b.cr, b.cg, b.cb));
    }
    pBall.commit();

    /* ── 6.7 LOD：树冠按距离并股重填；树干／箅子／路灯／长椅只在相机附近实例化 ── */

    function fill(cands, pool, R, cap, emit, camPos){
      const cx = camPos.x, cz = camPos.z, R2 = R * R, sel = [];
      for (let i = 0; i < cands.length; i++){
        const c = cands[i], dx = c.x - cx, dz = c.z - cz, d2 = dx * dx + dz * dz;
        if (d2 < R2) sel.push([d2, c]);
      }
      if (sel.length > cap){ sel.sort((a, b) => a[0] - b[0]); sel.length = cap; }
      pool.reset();
      for (const s of sel) emit(s[1]);
      pool.commit();
    }
    /* 行道树：一次遍历同时填冠与干。
       三档冠（≤165m 球瓣簇 / ≤560m 单瓣卵冠 / 更远并股三瓣冠）：
       并股 = 每 stride 株里只留 i%stride===0 的那一株，冠幅同比拉长 stride 倍——
       近处一株一冠、有缝隙，远处并成连续绿线，三角却只有 1/stride。
       树干跟着被选中的那一株走，所以「每个看得见的冠底下都有干」。 */
    const RING2 = CROWN_RINGS.map(r => [r[0] * r[0], r[1]]);
    const TRUNK_R2 = TRUNK_R * TRUNK_R, PARK_TRUNK_R2 = PARK_TRUNK_R * PARK_TRUNK_R,
          NEAR_R2 = NEAR_R * NEAR_R;
    const EU = new THREE_.Euler(), BCOL = new THREE_.Color();
    const VAR = [0, 0, 0];        /* 复用的 (age,grime,tint) 三元组，喂给 pool.push */
    const selT = [];
    function fillTrees(camPos){
      const cx = camPos.x, cz = camPos.z;
      selT.length = 0;
      for (let k = 0; k < treeC.length; k++){
        const c = treeC[k];
        const dx = c.x - cx, dz = c.z - cz, d2 = dx * dx + dz * dz;
        let st = RING2[RING2.length - 1][1];
        for (let r = 0; r < RING2.length; r++) if (d2 < RING2[r][0]){ st = RING2[r][1]; break; }
        if (c.i % st) continue;
        selT.push([d2, c, st]);
      }
      /* 近的排前面：超预算时先丢最远的（远处丢一段，绿线只是断一小截） */
      selT.sort((a, b) => a[0] - b[0]);
      for (const p of pCrownV) p.reset();
      pCrownMid.reset(); pCrown3.reset(); pTrunk.reset();
      const nv = [0, 0, 0, 0];
      let nt = 0, nm = 0, n3 = 0;
      /* 广场／公园的独立树干先占位——它们的球冠是常驻的，抢不到干就成了光头。
         b 是它那颗球冠在 balls 里的下标：球冠被 ballMax 砍掉的，树干也不许出现，
         否则广场上就杵着一根 5m 高的光杆（审查截图里那两根就是这么来的）。 */
      for (let k = 0; k < trunkC.length && nt < BUDGET.trunkCap; k++){
        const c = trunkC[k], dx = c.x - cx, dz = c.z - cz;
        if (c.b >= ballN) continue;
        if (dx * dx + dz * dz > PARK_TRUNK_R2) continue;
        Q.setFromAxisAngle(AXIS, PC.hash2(c.x, c.z, 151) * 6.28);
        M4.compose(V.set(c.x, c.gy - 0.06, c.z), Q, SVec.set(c.r, c.h, c.r));
        pTrunk.push(M4, BCOL.setRGB(c.br, c.bg, c.bb)); nt++;
      }
      for (let k = 0; k < selT.length; k++){
        const d2 = selT[k][0], c = selT[k][1], st = selT[k][2];
        if (st === 1){
          /* 朝向 = 街向 + 逐株 ±20°；冠的 x 轴仍大体沿街，所以「沿街长、横街扁」
             这条修剪特征保得住，整排又不会像复制粘贴。 */
          Q.setFromAxisAngle(AXIS, c.ry + c.yaw);
          COL.setRGB(c.cr, c.cg, c.cb);
          let ok;
          /* 冠随干一起歪（lx/lz 是干顶的水平位移）：不跟着歪，冠就悬在
             斜干的正上方，那比不歪还假。 */
          if (d2 < NEAR_R2){
            const vi = TREE_VARS ? (c.v % TREE_VARS.length) : c.v;
            const p = pCrownV[vi];
            if (nv[vi] >= NEAR_CAP) ok = false;
            else {
              if (TREE_GLB){
                /* GLB 树：几何是整棵树、原点在根部落地、高 1 单位。
                   c.h 是冠高，乘 heightScale 得到整树高。 */
                const th = c.h * TREE_GLB.heightScale;
                M4.compose(V.set(c.x, c.gy, c.z), Q, SVec.set(th, th, th));
                p.push(M4, null);
              } else {
                M4.compose(V.set(c.x + c.lx, c.gy + c.y, c.z + c.lz), Q, SVec.set(c.wid, c.h, c.th));
                p.push(M4, COL);
              }
              nv[vi]++; ok = true;
            }
          } else if (nm < BUDGET.crownMid){
            M4.compose(V.set(c.x + c.lx, c.gy + c.y, c.z + c.lz), Q, SVec.set(c.wid, c.h, c.th));
            pCrownMid.push(M4, COL); nm++; ok = true;
          } else ok = false;
          /* 树干只长在有冠的那一株底下——冠被上限砍掉了，干也不许留，
             否则街上杵着一根光杆。 */
          /* GLB 树自带树干，不再叠一根程序化的 */
          if (!TREE_GLB && ok && d2 < TRUNK_R2 && nt < BUDGET.trunkCap){
            /* 倾斜由长尾整形分配：绝大多数不到 1.5°（整排仍像人栽的），
               少数几株明显歪着长。基座沉 0.06m，倾斜掀起来的那道缝就不会露出来。 */
            EU.set(c.tx, c.tyaw, c.tz);
            Q.setFromEuler(EU);
            M4.compose(V.set(c.x, c.gy - 0.06, c.z), Q, SVec.set(c.r, c.tr, c.r));
            pTrunk.push(M4, BCOL.setRGB(c.br, c.bg, c.bb)); nt++;
            Q.setFromAxisAngle(AXIS, c.ry + c.yaw);
          }
        } else {
          if (n3 >= crown3Max) continue;
          Q.setFromAxisAngle(AXIS, c.ry);
          /* 三瓣冠的中心要落在这 st 株的中点上，而不是被选中那一株上；
             冠幅按整段拉满（乘 1.06 让相邻段搭上），远处才是一条连续绿线。 */
          const off = (st - 1) / 2 * c.step;
          M4.compose(V.set(c.x + Math.cos(c.ry) * off, c.gy + c.y, c.z - Math.sin(c.ry) * off),
                     Q, SVec.set(c.step * st * 1.06, c.h, c.th));
          pCrown3.push(M4, COL.setRGB(c.cr, c.cg, c.cb)); n3++;
        }
      }
      for (const p of pCrownV) p.commit();
      pCrownMid.commit(); pCrown3.commit(); pTrunk.commit();
    }
    PC.lod.onMove(cam => {
      fillTrees(cam);
      /* 箅子：踩得多的偏暗、少的偏亮，跟本株树的积垢挂钩（同一棵树的坑同一副箅子） */
      fill(grateC, pGrate, PC.lod.R0, BUDGET.grateCap, c => {
        Q.setFromAxisAngle(AXIS, c.ry);
        M4.compose(V.set(c.x, c.gy, c.z), Q, SVec.set(1, 1, 1));
        pGrate.push(M4, BCOL.setRGB(c.k, c.k, c.k));
      }, cam);
      /* 路灯／长椅：instanceColor 定「这一件整体什么色」，
         aVary 交给 shader 去分「同一件身上哪儿旧哪儿新」。两层缺一不可。 */
      fill(lampC, pLamp, PC.lod.R1, BUDGET.lampCap, c => {
        Q.setFromAxisAngle(AXIS, c.ry);
        M4.compose(V.set(c.x, c.gy, c.z), Q, SVec.set(1, 1, 1));
        VAR[0] = c.age; VAR[1] = c.grime; VAR[2] = c.tint;
        pLamp.push(M4, COL.setRGB(c.cr, c.cg, c.cb), VAR);
      }, cam);
      fill(benchC, pBench, PC.lod.R1, BUDGET.benchCap, c => {
        Q.setFromAxisAngle(AXIS, c.ry);
        M4.compose(V.set(c.x, c.gy, c.z), Q, SVec.set(1, 1, 1));
        VAR[0] = c.age; VAR[1] = c.grime; VAR[2] = c.tint;
        pBench.push(M4, COL.setRGB(c.cr, c.cg, c.cb), VAR);
      }, cam);
    }, 80);
    /* 先按当前相机填一次：不等第一次 lod.tick，构建完就有树 */
    try { fillTrees(ctx.camera.position); } catch (e){ console.warn('[furniture] 首填', e); }

    /* 尺度自检：不靠眼睛判断「树是不是太大了」，直接把实例缩放统计出来。
       几何已归一到单位包围盒，所以 instance scale 就是米。 */
    const rng2 = a => a.length ? [+Math.min.apply(null, a).toFixed(2),
                                  +Math.max.apply(null, a).toFixed(2)] : null;
    const bbox = (() => {
      const W = [], H = [], T = [], B = [], TP = [], D = [];
      for (const c of treeC){ W.push(c.wid); H.push(c.h); T.push(c.th);
        B.push(c.y - c.h / 2); TP.push(c.y + c.h / 2); D.push(c.r); }
      const pk = [], ph = [];
      for (let i = 0; i < ballN; i++){ pk.push(balls[i].rx); ph.push(balls[i].ry); }
      return {冠幅: rng2(W), 冠高: rng2(H), 冠厚: rng2(T),
              冠底: rng2(B), 冠顶: rng2(TP), 胸径: rng2(D),
              园树冠径: rng2(pk), 园树冠高: rng2(ph)};
    })();
    /* 差异自检：不靠眼睛判断「是不是还在复制粘贴」，把离散度打印出来。
       要看的是两个数：族内标准差（同一条街）应该明显小于全城标准差，
       比值越接近 1 说明批次没起作用——那就退回纯噪声了。 */
    const diversity = (() => {
      if (!treeC.length) return null;
      const sp = {}, byBatch = {};
      let sum = 0, sum2 = 0, sick = 0, sickHard = 0, lean = 0, lean5 = 0;
      for (const c of treeC){
        sp[c.sp.n] = (sp[c.sp.n] || 0) + 1;
        const l = 0.2126 * c.cr + 0.7152 * c.cg + 0.0722 * c.cb;   /* 冠色明度 */
        sum += l; sum2 += l * l;
        (byBatch[c.batch] || (byBatch[c.batch] = [])).push(l);
        if (c.sick > 0.72) sick++;                                 /* 带一点枯意 */
        if (c.sick > 0.86) sickHard++;                             /* 明显发黄 */
        /* 实际倾角，不是抖动幅度——量幅度会把「可能歪」当成「歪了」，虚高一倍 */
        const tl = Math.hypot(c.tx, c.tz);
        if (tl > 0.052) lean++;        /* >3°：走近了看得出来 */
        if (tl > 0.087) lean5++;       /* >5°：一眼就是那株歪的 */
      }
      const n = treeC.length, mean = sum / n;
      const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
      let inSum = 0, inN = 0;
      for (const k in byBatch){
        const a = byBatch[k]; if (a.length < 6) continue;
        let s = 0, s2 = 0;
        for (const v of a){ s += v; s2 += v * v; }
        const m = s / a.length;
        inSum += Math.sqrt(Math.max(0, s2 / a.length - m * m)); inN++;
      }
      /* 路灯的比值必须真的散开。第一版这一行全是同一个数（撞上限了），
         打印出来才发现「加了差异系统反而更整齐」。撞满上限就是回归。 */
      let lmin = 9, lmax = 0, lclip = 0;
      for (const c of lampC){
        const v = (c.cr + c.cg + c.cb) / 3;
        if (v < lmin) lmin = v; if (v > lmax) lmax = v;
        if (c.cg >= 1.749 || c.cg <= 0.451) lclip++;
      }
      return {树种: sp, 批次数: inN,
              路灯比值: lampC.length ? [+lmin.toFixed(2), +lmax.toFixed(2)] : null,
              路灯撞上限: lclip,
              冠色标准差_全城: +sd.toFixed(4),
              冠色标准差_同批: +(inN ? inSum / inN : 0).toFixed(4),
              离散比: +(inN && sd ? (inSum / inN) / sd : 0).toFixed(2),
              带枯意: +(sick / n * 100).toFixed(1) + '%',
              明显枯黄: +(sickHard / n * 100).toFixed(1) + '%',
              倾斜过3度: +(lean / n * 100).toFixed(1) + '%',
              倾斜过5度: +(lean5 / n * 100).toFixed(1) + '%'};
    })();
    const triOf = g => (g.index ? g.index.count : g.attributes.position.count) / 3;
    const stat = {
      treeCand: treeC.length,
      crownsNear: pCrownV.reduce((a, p) => a + p.count, 0),
      crownsMid: pCrownMid.count, crowns3: pCrown3.count, balls: ballN,
      trunks: pTrunk.count, trunkCand: trunkC.length,
      lampCand: lampC.length, benchCand: benchC.length,
      wallace: nW, morris: nM, kiosque: nK, guimard: nG, basins: nB,
      staticTris: MS.tris() + BS.tris() + WS.tris(),
      peakTris: Math.round(
                gCrownV.reduce((a, g) => a + BUDGET.crownNear * triOf(g), 0) +
                BUDGET.crownMid * triOf(gCrownMid) +
                crown3Max * triOf(gCrown3) + ballN * triOf(gBall) +
                BUDGET.trunkCap * triOf(gTrunk) + BUDGET.grateCap * triOf(gGrate) +
                BUDGET.lampCap * triOf(gLamp) +
                BUDGET.benchCap * triOf(gBench) +
                MS.tris() + BS.tris() + WS.tris()),
      drawCalls: GROUP.children.length
    };
    console.log('[furniture]', stat);
    console.log('[furniture] 差异自检 ' + JSON.stringify(diversity));
    console.log('[furniture] 树尺度实测（米） ' +
      Object.keys(bbox).map(k => k + ' ' + (bbox[k] ? bbox[k].join('–') : '—')).join(' | '));
    ctx.step(46, '街道家具 · 完成'); await ctx.raf();
    return stat;
  },

  setVisible(v){ if (GROUP) GROUP.visible = v; }
});

/* ══════════════════════════════════════════════════════════════════════════
   已知取舍
   · 垃圾桶、护柱 borne、公交站、Vélib 车架没做——单件辨识度低、数量却极大，
     在 3 万三角的预算里性价比最差。要加的话每一项都是一个 draw call。
   · Guimard B 型「蜻蜓」只剩 Porte Dauphine 一座，那个点位在本图幅（x<−4920）
     之外，所以只做了 C 型 entourage。
   · 冠形只有 4 套变体，同一套的两株除了缩放／朝向／色调完全一样。
     再多一套就再多一个 draw call，这是 InstancedMesh 的硬边界；
     打散靠的是「4 套变体 × 树种比例(wK/hK/thK) × 树龄缩放 × ±12% 抖动 ×
     ±20° 朝向 × 族内配色」这六层相乘。
   · 树种是「一条街一个种」，所以站在路口能看见两个种交界；但同一条街跨越
     半个城时（里沃利街 id 31 分成好几段）也只有一个种。真实巴黎也是这样报的。
   · 枯黄的病树只改颜色，不改冠形——缺叶、断枝这些得改几何，那是再多一个池。
   · 树的倾斜只有干和冠一起偏移，没有做「弯着长」的曲干：那需要把树干从
     7 棱锥台换成分段的，14 tri 会变成 40+，1500 根干就是 4 万三角。
   · 冠的轮廓仍是低模多边形（近景主瓣 80 面、外围小瓣各 20 面）。
     这是**有意跟全城的调子对齐**——立面、屋顶、遮阳篷都是平面片，
     唯独树做成光滑球会跳出来。要的是「不能有大平面和尖角」，不是「要光滑」。
   · 树冠按距离分三档（165m 内球瓣簇 / 560m 内单瓣卵冠 / 往外 6/18/42/84 株
     一个三瓣冠），档位边界上轮廓会跳一下。只在相机移动 >80m 时重填，静止时不动；
     换来的是全城 1.6 万株树只花 ≈1600 个实例。要彻底消掉跳变得做 cross-fade，
     那要双倍实例。
   · 三瓣冠的三个瓣同高同厚，抖动落在「组」上不是「瓣」上。近两档是真·逐株
     抖动，人站在街上看到的是对的；中景往外有轻微的三拍节奏。
   · 冠顶压到 8.0–10.8m，比 streetlife.md §4.4 的 11–14m 矮一截；冠也不再
     连成一片。两条都是有意的，理由写在文件上方 TREE 常数那一段。
   · 次街只种一侧。哪一侧由 `PC.hash2(road.a, 131)` 定，不看日照也不看店面朝向。
   · 全层已经没有一件还写 y=0：树／树池／路灯／长椅／Wallace／Morris／报刊亭／
     地铁口／广场立柱／广场水池一律读 plan.terrainY。
     ⚠️ 但树池箅子额外抬了 `WALK_H = 0.16`——那是 terrain.js 里同名局部常量的抄本，
     那边没导出。terrain 改人行道高度，这里要跟着改，否则箅子会重新被铺装吃掉。
     箅子的 0.22m 裙边就是为这件事留的余量：抄错一点也只是裙边露多露少。
   · 路灯／长椅的 instanceColor 是「乘在图集 texel 上的比值」，比值要夹在
     0.45–1.75。灯笼的暖白玻璃跟灯杆共用同一个乘数，超出这个范围就会被冲白。
     图集里灯罩 albedo 已经从 #f2e4c0 压到 #c6b691 给这个乘数留头寸；
     夜里的灯光来自 emissiveMap，不受影响。
   · 行道树干只在 560m 内画（与 stride=1 环对齐），广场／公园的干放宽到 1200m。
     再远树干不足 1px，冠底那 3–4m 的净空也看不出来。
   · 协和方尖碑／旺多姆柱／七月柱三根立柱严格说不算「街道家具」，
     放在这里是因为它们是广场从空中的唯一身份标识，且没有别的模块认领。
     集成时若与 terrain.js 的广场铺装重复，删 putColumn 三行即可。
   ══════════════════════════════════════════════════════════════════════════ */
})();
