/* ══════════════════════════════════════════════════════════════════════════
   city/shops.js —— 临街门店层（order 50）

   负责：店面 devanture · 遮阳篷 store banne · 招牌金字 · 朝街排的藤椅与小圆桌 ·
        玻璃挡风屏 · 花箱 · 黑板菜单 · 花桶 · 书车 ·
        烟草店红菱形 carotte · 药房绿十字 · 住宅的 porte cochère。

   不负责：立面与屋顶（facade.js）、行道树路灯长椅（furniture.js）、
          人行道铺装与路缘（terrain.js）。

   四条自我约束：
   ① 位置全部从 PC.plan 读（parcel.seg / n / w / sidewalkW / use / variant），
      本文件一个坐标都不自己编；
   ② 只在 PC.lod.ring()===0 的地块出物件，相机移动 >72m 才重填一次；
   ③ 一切随机走 PC.hash2(店铺中点, salt) / PC.vary（内部也是位置哈希）或
      parcel.variant，一个 Math.random 都不许有 —— 同一家店永远长成同一个样子，
      相机走开两公里再走回来，截图必须像素级一致（自校验里有这条回归）。
   ④ 个体差异按「一家店 = 一套身份」组织，见 §0.5：篷/椅/桌/花箱/漆是配套的，
      也是一起旧的；差异由**一个店龄**派生，不是五个独立随机数。

   尺寸与颜色出处：city/data/streetlife.md（§ 号在注释里）、
                  city/data/haussmann.md §11（porte cochère）。
   高程：街面 y = parcel.y0，人行道面 = parcel.y0 + 0.15（terrain.js 的口径），
        本层所有东西站在人行道面上。

   预算 6 万三角 / 13 draw call（橱窗补齐五层 + 窄道单排座之后从 4 万 / 11 调高，
   实测 ring0 满载 4.1–5.9 万三角、街道机位全场 ≤93 万三角）。
   手段是**按材质归池**：所有漆木盒子共用一个单位立方体实例池、所有石构件共用
   另一个，招牌字与发光标识共用一张图集、一片动态合并网格
   —— 12 个 InstancedMesh + 1 片文字网格。
   ══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

if (typeof PC === 'undefined' || !PC.mod){ console.error('[shops] core.js 未加载'); return; }
const HP = (window.P3D && P3D.helpers) || {};
const GB = HP.GB;
const clamp = HP.clamp || ((v, a, b) => v < a ? a : (v > b ? b : v));

/* ═══════════════════ 0. 尺寸常量（米） ═══════════════════ */
const D = {
  swY:      0.15,   // 人行道面相对 parcel.y0 的抬高

  /* 店面 devanture en applique §2.1 */
  socleH:   0.35,   // 石踢脚
  skirtH:   0.75,   // 木裙板顶 = 橱窗下沿
  glassTop: 3.05,   // 橱窗顶
  corniche: 3.20,   // 檐板顶
  bandTop:  3.70,   // 招牌带顶
  capTop:   3.85,   // 上檐顶
  applique: 0.19,   // 贴附式出挑（§ 给 0.16–0.20）
  pilW:     0.26, pilD: 0.24,               // 端头壁柱见宽 / 出挑
  signH:    0.30, signY: 3.45,              // 招牌字高 / 中心标高 §2.3

  /* 橱窗四层 z（都压在 applique 0.19 的贴附厚度里，一层都不许探进墙——
     墙后面是 facade.js 的实心楼体，退到 z<0 的东西直接看不见）§2.2 */
  glZ:      0.030,  // ① 店内背板（最里）
  disZ:     0.078,  // ② 货架/挂衣杆剪影
  impZ:     0.098,  // ③ 上亮子 imposte（发光的那道横窗）
  paneZ:    0.130,  // ④ 玻璃面（反射层）
  frmZ:     0.158,  // ⑤ 木框分格（最外，压住前面四层）
  mullW:    0.075, mullD: 0.078,            // 竖梃见宽 / 出挑
  mullPitch:1.55,                            // 竖梃目标间距 → 一格玻璃约 1.4–1.8m
  imposteY: 2.56, tranH: 0.11,              // 横档中心标高 / 横档高
  doorW:    0.92, doorH: 2.28, jambG: 0.075, // 店门净宽 / 门头高 / 门樘见宽

  /* 遮阳篷 store banne §1.4 */
  awRoll:   3.12,   // 卷筒（见文件末「已知取舍 ①」，§ 原值 3.40 会埋掉招牌）
  awZ0:     0.19,   // 卷筒出挑 = 店面出挑 applique，篷根贴住檐板不留缝
  awFront:  2.55,   // 展开后前沿
  awOut:    1.80,   // 出挑 saillie
  awVal:    0.25,   // lambrequin 垂幔高（法定上限）
  awBay:    3.20,   // 一片篷 = 一个开间

  /* 露天座 terrasse §1.1–1.8 */
  chD:      0.55, chPitch: 0.72, rowGap: 1.15, backGap: 0.35,
  tblH:     0.73, tblR: 0.30,
  scrH:     1.30, scrSkirt: 0.55,           // 挡风屏玻璃段 / 下部实心裙
  plL:      0.92, plD: 0.36, plH: 0.48,     // 花箱盆身 §1.7（法定 0.40–0.80，取下段）
  plGrn:    0.58,                            // 盆口以上黄杨球高，盆+植 ≈1.06 ≤ 法定 1.60
  boardH:   0.95,                            // 折叠黑板 chevalet
  bkD:      0.32, bkH: 0.42, bkGrn: 0.46,    // 花桶 §3.3（桶身 + 花头）

  /* porte cochère haussmann §11 */
  dW:       2.80, dH: 3.60, dRise: 0.56, jambW: 0.35, keyW: 0.38, keyH: 0.55,

  /* 业态识别件 §3.1–3.2 */
  carH:     0.55, carY: 3.10, carArm: 0.35,
  crS:      0.80, crY: 3.20, crArm: 0.30,
  flagH:    0.60, flagY: 2.85
};

/* ring0 里最多长多少个店面（超出按距离截断）。这个数直接决定三角预算：
   实测商业最密的大道路段，190 个店面 ≈ 3.8 万三角，正好压在预算线下。 */
const MAX_FRONTS = 190;
const REFILL_D   = 72;      // 相机移动多少米重填一次

/* 橱窗自发光强度 §3 的「橱窗自发光」列 */
const LIT = {boulangerie: 0.85, brasserie: 0.65, cafe: 0.45, tabac: 0.40,
             pharmacie: 0.35, librairie: 0.25, fleuriste: 0.20, shop: 0.30};

/* 色族一律从 PC.families 抽，本文件不再自己编颜色数组。
   § 里的「灰粉 #C99CA0」和「茄紫 #7B3F5E」两支当初就没进族：一家店的椅子全同色，
   一旦抽到这两支，整条街就是一排品红塑料椅——样本色成立不代表铺开成立。
   用到的族：rattanWeave（藤椅编条）· tableTop（桌面石材/锌板）· awning（篷）·
            shopPaint（漆木）· planter（花箱）· foliage（绿植）· bloom（花）。 */
/* 大门漆色偏向：深绿最常见 §11（索引指向 PC.families.shopPaint） */
const DOOR_PAINT = [0, 0, 0, 2, 1, 4];

/* ═══════════════════ 0.5 一家店 = 一套身份 ═══════════════════
   这一节是本轮唯一的新概念，先说清楚它要解决什么。

   之前的问题不止是「所有店长得一样」，还包括「同一家店的东西之间没有关系」：
   篷子的色号从 variant.awning 抽，椅子的色号从另一个哈希抽，花箱从第三个抽，
   三件东西各随机各的，凑在一起像三家店的家具堆在一个门口。

   真实世界里一家咖啡馆的家具是**一批买的**：篷子、椅子、桌子、花箱、店面漆
   出自同一次装修，颜色形制成套；用了十年之后它们也**一起旧**。所以：

     ① batch = parcel。一家店抽一次身份（PC.vary.of 的 batch 传 parcel 的 seed），
        店里每件家具在这个身份下只做小幅个体浮动。
     ② 年龄是唯一的隐变量。褪色、粗糙、氧化、磨损、积垢全部由 ID.age 派生，
        不许各随机各的——五样各自独立随机是塑料玩具，一个 age 统一驱动才是岁月。
     ③ 长尾整形。PC.vary.tail(u, 2.9) 把店龄压向「新/标准」那一端：全城 5211 家
        实测 60.6% 落在前 1/3，15.1% 落在后 1/3（中位 0.24、p90 0.76）。
        一条街上有一两家扎眼，其余是背景——均匀分布的随机会让每家店都不一样，
        那读起来还是噪声，只是换了一种噪声。

   ID 是一个复用对象：front() 每次覆写它，全程单线程、不嵌套两家店，所以零分配。
   （每帧的 update() 一个字节都不分配；refill 里 PC.vary.of 每家店一个对象，
     72m 才触发一次，和既有 API 的口径一致。） */
const ID = {
  age: 0, grime: 0, wear: 0, moss: 0, tint: 0, riverside: 0, prestige: 0.5,
  sun: 0, batch: 0, lit: 0.3,
  paint: 0, awn: 0, weave: 0, top: 0, f: null
};
/* 逐件家具的临时档案：喂给 PC.vary.shade / pool.push 的第三个参数，复用不分配 */
const SP = {age: 0, grime: 0, wear: 0, moss: 0, tint: 0};
/* 两个插值目标（模块级常量，不每帧 new）：
   镀金氧化是往深褐走，不是往灰白走——PC.vary.shade 的褪色方向对油漆对，对金不对。 */
let GILT_OX = null, FADE_W = null, ZERO = null;
const DEAD_LEAF = 0x9a8a4e;      // 枯掉的黄杨：土黄带一点残绿
/* aVary 三元组的复用槽（pool.push 也接受 {age,grime,tint} 对象，这里直接用 SP） */

function identity(pc, mx, mz, use){
  const prof = PC.vary.of('shopfront', mx, mz, pc.variant.seed);
  /* 店龄：长尾整形后再被街区档次拉低（好街区维护勤，门脸翻新得快） */
  const t = PC.vary.tail(prof.f(151), 2.9);
  ID.age   = clamp((0.14 + 0.94 * t) * (1.16 - 0.40 * prof.prestige), 0, 1);
  ID.riverside = prof.riverside; ID.prestige = prof.prestige;
  /* 以下四样全部由 ID.age 派生，不是四个独立随机数 */
  ID.grime = clamp(ID.age * (0.60 + 0.60 * prof.riverside) * (0.74 + 0.48 * prof.f(37)), 0, 1);
  ID.wear  = clamp(ID.age * (0.55 + 0.72 * prof.f(53)), 0, 1);
  ID.moss  = clamp(ID.age * (0.10 + 0.52 * prof.riverside) * prof.f(71) * 0.85, 0, 1);
  ID.tint  = prof.tint;
  ID.batch = pc.variant.seed;
  ID.f     = prof.f;
  /* 朝向决定日晒：本地系 +z = 北（PC.geo），法线指着南（n[1]<0）的立面晒得最狠 */
  ID.sun   = clamp(0.5 - pc.n[1] * 0.5, 0, 1);
  /* 成套的四个色号：同一次装修买的，所以都挂在这个 parcel 上 */
  const FAM = PC.families;
  ID.paint = FAM.shopPaint[pc.variant.paint % FAM.shopPaint.length];
  ID.awn   = FAM.awning[pc.variant.awning % FAM.awning.length];
  /* 编条色再压一次长尾：族里前四支是本色藤（米白/浅藤/蜜色/深藤），后四支是
     染过的深红/焦糖/墨绿/天青。真实巴黎露天座本色占多数，染色的是少数派，
     所以不是均匀抽 —— tail(u,1.5) 让本色约占 63%。 */
  { const RW = FAM.rattanWeave;
    ID.weave = RW[Math.min(RW.length - 1, (PC.vary.tail(prof.f(167), 1.5) * RW.length) | 0)]; }
  /* 桌面：咖啡馆/啤酒屋偏锌板与深石（老 bistro 的做法），其它业态偏大理石 */
  { const u = prof.f(173), zinky = (use === 'cafe' || use === 'brasserie' || use === 'tabac');
    const k = zinky ? PC.vary.head(u, 1.7) : PC.vary.tail(u, 1.7);
    ID.top = FAM.tableTop[Math.min(FAM.tableTop.length - 1,
                                   (k * FAM.tableTop.length) | 0)]; }
  /* 店里开多亮：LIT 是业态基准，再乘一个店的个性（有的店灯火通明，有的半开）。
     老店的灯泡旧、灯罩脏，整体压暗。 */
  ID.lit = clamp((LIT[use] === undefined ? 0.30 : LIT[use])
                 * (0.68 + 0.62 * prof.f(181)) * (1 - 0.30 * ID.age), 0, 1);
  return prof;
}

/* 逐件家具的档案：店龄 × 该件的老化倍率 × 个体浮动。
   mul<1 = 这件比店面新（刚换的椅子），mul>1 = 这件比店面旧（临街那把）。 */
function itemProf(u, mul, tintU){
  SP.age   = clamp(ID.age * mul * (0.76 + 0.48 * u), 0, 1);
  SP.grime = clamp(SP.age * (0.52 + 0.58 * ID.riverside) * (0.80 + 0.40 * u), 0, 1);
  SP.wear  = clamp(SP.age * (0.60 + 0.60 * u), 0, 1);
  SP.moss  = ID.moss * 0.45;
  SP.tint  = tintU;
  return SP;
}
/* 浅色件的老化方向和深色件相反。
   PC.vary.shade 的褪色目标是灰白（0xc9c6bd）——对深绿、酒红、深蓝的店面漆是对的，
   用在米白藤椅、白大理石台面、米白篷布上等于什么都没做：一排米白椅子无论多旧
   都一模一样（截图 v3h-terrasse-wall：九把椅子的 instanceColor 只差 0.008）。
   真实世界里浅色件不会被晒得更白，只会脏、只会发黄。所以按底色明度把「褪色」
   换成「积垢」，明度越高换得越彻底。SP 被就地改写，shader 的 aVary 也跟着走，
   两层说的是同一件事。 */
function agedTone(base, out){
  const l = ((base >> 16 & 255) * 0.299 + (base >> 8 & 255) * 0.587 + (base & 255) * 0.114) / 255;
  if (l > 0.52){
    const k = clamp((l - 0.52) / 0.40, 0, 1), a0 = SP.age;
    SP.age   = a0 * (1 - 0.78 * k);
    SP.grime = clamp(SP.grime + a0 * (0.42 + 0.38 * k) * k, 0, 1);
  }
  return PC.vary.shade(base, SP, out || COL);
}

/* 店面漆的档案在 front() 里算一次，壁柱、竖梃、门樘、黑板架反复取用——
   它们是同一天同一遍漆刷上去的，各自再随机一次就散架了。 */
let PPA = 0, PPG = 0, PPT = 0;
function savePaintProf(){ PPA = SP.age; PPG = SP.grime; PPT = SP.tint; }
function loadPaintProf(k){
  SP.age = clamp(PPA * (k === undefined ? 1 : k), 0, 1);
  SP.grime = PPG; SP.wear = SP.age; SP.moss = ID.moss * 0.45; SP.tint = PPT;
  return SP;
}

/* ═══════════════════ 1. 店名与标识图集 ═══════════════════
   2048² canvas。上 24 行 × 2 列 = 48 个店名格（白色衬线大写，用顶点色染成金或
   白）；最下一条 512px 放方形符号格（红菱形 carotte / 绿十字）——这两个不染色，
   颜色直接烤进图里，因为「白底红字」这种反差单靠乘法染不出来。 */
const NAMES = {
  boulangerie: ['BOULANGERIE', 'BOULANGERIE · PÂTISSERIE', 'AU PAIN DORÉ', 'MAISON DUVAL', 'LE FOURNIL'],
  cafe:        ['CAFÉ DE LA MAIRIE', 'LE PETIT ZINC', 'AU RENDEZ-VOUS', 'LE BALTO',
                'CAFÉ DES ARTS', 'LE RÉVEIL MATIN', 'CHEZ LUCIEN', 'LE SAINT-JEAN'],
  brasserie:   ['BRASSERIE', 'BRASSERIE DU PONT', 'LE GRAND COMPTOIR', 'BRASSERIE DE LA GARE'],
  tabac:       ['TABAC', 'BAR · TABAC', 'LA CIVETTE'],
  pharmacie:   ['PHARMACIE', 'PHARMACIE DU CENTRE', 'GRANDE PHARMACIE'],
  librairie:   ['LIBRAIRIE', 'LIVRES ANCIENS', 'LA PAGE BLANCHE'],
  fleuriste:   ['FLEURISTE', 'AU JARDIN FLEURI', 'FLEURS'],
  shop:        ['ÉPICERIE', 'FROMAGERIE', 'BOUCHERIE', 'CHARCUTERIE', 'QUINCAILLERIE',
                'COIFFEUR', 'CHAUSSURES', 'ANTIQUITÉS', 'PRESSING', 'PAPETERIE',
                'CRÉMERIE', 'POISSONNERIE', 'MERCERIE', 'HORLOGERIE', 'CAVES',
                'TRAITEUR', 'OPTICIEN', 'TEINTURERIE', 'MAROQUINERIE']
};
const ATLAS = 2048, CELL_W = 1024, CELL_H = 64, NAME_ROWS = 24;
const SYM_Y0 = NAME_ROWS * CELL_H, SYM_S = 256;
const CAPF = 44 / CELL_H;          // 一格里字高占比：贴图 quad 高 = 字高 / CAPF

let NAMEIDX = null, SYMIDX = null;

function buildAtlas(){
  const c = PC.canvas(ATLAS, ATLAS), g = c.getContext('2d');
  g.clearRect(0, 0, ATLAS, ATLAS);
  g.textBaseline = 'alphabetic'; g.textAlign = 'left'; g.fillStyle = '#ffffff';

  NAMEIDX = {};
  const all = [];
  for (const use in NAMES){ NAMEIDX[use] = []; for (const s of NAMES[use]) all.push([use, s]); }

  let slot = 0;
  for (const pair of all){
    if (slot >= NAME_ROWS * 2) break;
    const use = pair[0], txt = pair[1];
    const col = slot % 2, row = (slot / 2) | 0;
    const x0 = col * CELL_W, y0 = row * CELL_H, fs = 44;
    g.font = '600 ' + fs + 'px Georgia, "Times New Roman", serif';
    const sp = fs * 0.12;                       // 字距约字高 0.12 §2.3
    let wsum = 0;
    for (const ch of txt) wsum += g.measureText(ch).width + sp;
    wsum -= sp;
    const k = Math.min(1, (CELL_W - 24) / wsum);
    g.save(); g.translate(x0 + 12, y0 + 54); g.scale(k, 1);
    let cx = 0;
    for (const ch of txt){ g.fillText(ch, cx, 0); cx += g.measureText(ch).width + sp; }
    g.restore();
    const drawn = wsum * k + 24;
    NAMEIDX[use].push({
      u0: x0 / ATLAS, u1: (x0 + drawn) / ATLAS,
      v0: 1 - (y0 + CELL_H) / ATLAS, v1: 1 - y0 / ATLAS,
      ar: drawn / CELL_H
    });
    slot++;
  }

  /* 烟草店红菱形 carotte §3.1：竖立菱形，亮红 #D42A20 + 白色 TABAC，1906 年起法定 */
  g.save(); g.translate(SYM_S * 0.5, SYM_Y0 + SYM_S * 0.5);
  g.fillStyle = '#D42A20';
  g.beginPath(); g.moveTo(0, -114); g.lineTo(83, 0); g.lineTo(0, 114); g.lineTo(-83, 0);
  g.closePath(); g.fill();
  g.strokeStyle = '#8d1a12'; g.lineWidth = 6; g.stroke();
  g.fillStyle = '#F4F1EA'; g.textAlign = 'center';
  g.font = '700 30px Georgia, serif'; g.fillText('TABAC', 0, 11);
  g.restore();

  /* 药房绿十字 §3.2：希腊十字，臂宽 = 边长 1/3，#00A651 */
  g.save(); g.translate(SYM_S * 1.5, SYM_Y0 + SYM_S * 0.5);
  const a = 110, b = a / 3;
  g.fillStyle = '#00A651';
  g.fillRect(-b, -a, 2 * b, 2 * a); g.fillRect(-a, -b, 2 * a, 2 * b);
  g.fillStyle = '#63E39C';
  g.fillRect(-b + 11, -a + 11, 2 * b - 22, 2 * a - 22);
  g.fillRect(-a + 11, -b + 11, 2 * a - 22, 2 * b - 22);
  g.restore();
  g.textAlign = 'left';

  /* 绿植与花的剪影（白＋灰，由顶点色染成叶绿或花色）。
     用带 alpha 的剪影，不用交叉实心片——同样 2 个三角，轮廓真实得多。 */
  const rnd = (HP.mulberry32 ? HP.mulberry32(4021) : Math.random);
  /* 黄杨球 §1.7：一团修剪过的球冠。所有笔触必须收在 256² 的格子里——
     溢出会污染相邻的绿十字格和最后一行店名格（叶子长到药房招牌上去）。
     半径预算：中心偏移 ≤78 + 叶片半径 ≤42 = 120 < 128。 */
  g.save(); g.translate(SYM_S * 2.5, SYM_Y0 + SYM_S);          // 底边居中
  for (let i = 0; i < 52; i++){
    const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.55);
    const x = Math.cos(a) * r * 78, y = -62 - Math.sin(a) * r * 62 - rnd() * 20;
    const s = 18 + rnd() * 24, k = 0.50 + rnd() * 0.50;
    g.fillStyle = 'rgb(' + [(k*255)|0, (k*255)|0, (k*255)|0] + ')';
    g.beginPath(); g.ellipse(x, y, s, s * (0.72 + rnd() * 0.4), rnd() * 3, 0, Math.PI * 2); g.fill();
  }
  /* 两侧垂下来的常春藤：花箱最容易被认出来的那一笔 */
  for (const sx of [-1, 1]) for (let i = 0; i < 7; i++){
    const x = sx * (56 + rnd() * 34), y = -18 - rnd() * 46, s = 9 + rnd() * 9;
    const k = 0.42 + rnd() * 0.34;
    g.fillStyle = 'rgb(' + [(k*255)|0, (k*255)|0, (k*255)|0] + ')';
    g.beginPath(); g.ellipse(x, y, s, s * 1.25, rnd() * 3, 0, Math.PI * 2); g.fill();
  }
  g.restore();
  g.save(); g.translate(SYM_S * 3.5, SYM_Y0 + SYM_S);
  g.strokeStyle = 'rgb(120,120,120)'; g.lineWidth = 5;
  for (let i = 0; i < 11; i++){
    const x = (rnd() - 0.5) * 150, y = -80 - rnd() * 110;
    g.beginPath(); g.moveTo(x * 0.25, -12); g.lineTo(x, y); g.stroke();
    const k = 0.68 + rnd() * 0.32, s = 15 + rnd() * 12;
    g.fillStyle = 'rgb(' + [(k*255)|0, (k*255)|0, (k*255)|0] + ')';
    g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
  }
  g.restore();

  /* ── 橱窗里的陈列剪影（cell 4/5/6）§2.2 ──
     玻璃后面什么都没有，橱窗就永远是一块板——这三格是最便宜的解法：两个三角
     一格玻璃，走已有的文字网格，一个 draw call 不多加。
     画的是灰阶（0.35–1.0）实心块，不是纯黑：alphaTest 0.42 只看 alpha，颜色由
     顶点色再压暗一档，出来就是「背光的家具轮廓 + 几件反光的东西」。
     所有笔触收在 x∈[−96,96] / y∈[−246,−4]，越界会污染相邻格。
     竖长构图（约 0.7 宽高比）：一格玻璃是竖的，横着构图一拉就散。 */
  const gray = k => { const v = (k * 255) | 0; g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; };
  const board = (y, w, t) => { gray(0.52); g.fillRect(-w/2, y, w, t); };

  /* cell 4 · 货架 étagère：四层板 + 两侧立柱 + 一排罐子盒子（杂货/书店/药房/烟草） */
  g.save(); g.translate(SYM_S * 4.5, SYM_Y0 + SYM_S);
  gray(0.34); g.fillRect(-92, -238, 12, 234); g.fillRect(80, -238, 12, 234);
  for (let r = 0; r < 4; r++){
    const yb = -34 - r * 52;
    board(yb, 184, 9);
    let x = -82;
    while (x < 74){
      const w = 12 + rnd() * 22, h = 16 + rnd() * 26;
      gray(0.42 + rnd() * 0.52);
      if (rnd() < 0.34){ g.beginPath(); g.ellipse(x + w/2, yb - h*0.55, w/2, h*0.55, 0, 0, Math.PI*2); g.fill(); }
      else g.fillRect(x, yb - h, w, h);
      x += w + 4 + rnd() * 7;
    }
  }
  g.restore();

  /* cell 5 · 柜台与面包架 comptoir（面包房/咖啡馆/啤酒屋/花店）：
     下面一段是柜台立面，上面是斜插的长棍与圆面包，顶上两盏吊灯——
     吊灯是「店里开着灯」这件事最省的一笔。 */
  g.save(); g.translate(SYM_S * 5.5, SYM_Y0 + SYM_S);
  gray(0.30); g.fillRect(-90, -96, 180, 92);
  gray(0.62); g.fillRect(-90, -104, 180, 10);              // 柜台面（亮）
  gray(0.44); g.fillRect(-78, -180, 156, 8);               // 背后一层架板
  for (let i = 0; i < 9; i++){                              // 斜插的长棍面包
    const x = -74 + i * 18.5, lean = (rnd() - 0.5) * 16;
    gray(0.55 + rnd() * 0.40);
    g.save(); g.translate(x, -140); g.rotate(lean / 90);
    g.fillRect(-5, -44, 10, 60); g.restore();
  }
  for (let i = 0; i < 5; i++){                              // 架板上的圆面包
    gray(0.50 + rnd() * 0.42);
    g.beginPath(); g.ellipse(-58 + i * 29, -194, 13, 11, 0, 0, Math.PI * 2); g.fill();
  }
  for (const px of [-42, 42]){                              // 吊灯
    gray(0.36); g.fillRect(px - 2, -246, 4, 32);
    gray(0.96); g.beginPath();
    g.moveTo(px - 17, -206); g.lineTo(px + 17, -206); g.lineTo(px + 8, -224); g.lineTo(px - 8, -224);
    g.closePath(); g.fill();
  }
  g.restore();

  /* cell 6 · 挂衣杆 portant（服装/皮具类的 shop）：一根杆 + 一排衣影 */
  g.save(); g.translate(SYM_S * 6.5, SYM_Y0 + SYM_S);
  gray(0.58); g.fillRect(-92, -212, 184, 7);
  for (let i = 0; i < 7; i++){
    const x = -74 + i * 25, w = 17 + rnd() * 7, h = 92 + rnd() * 46;
    gray(0.38 + rnd() * 0.44);
    g.beginPath();
    g.moveTo(x, -205); g.lineTo(x + w * 0.5, -196 - rnd() * 6); g.lineTo(x + w, -205);
    g.lineTo(x + w * 0.86, -205 + h); g.lineTo(x + w * 0.14, -205 + h);
    g.closePath(); g.fill();
  }
  gray(0.30); g.fillRect(-70, -40, 140, 36);                // 底下一段矮台
  g.restore();

  /* 第二排 · 每种内景的第二个变体。
     一片变体不够用：这份平面把 9.6–22.4m 的整条临街面判给一家店，一家店就能排出
     九格玻璃，同一张剪影镜像着重复九次，顺街看过去是墙纸不是店（截图 after3-wide）。
     两个变体 × 左右镜像 = 四种面貌，重复才散得开。 */
  const R2 = SYM_Y0 + SYM_S;

  /* cell 4' · 货架变体：层高不等、瓶子更高、地上堆一摞箱子 */
  g.save(); g.translate(SYM_S * 4.5, R2 + SYM_S);
  gray(0.34); g.fillRect(-90, -236, 10, 176);
  for (let r = 0; r < 3; r++){
    const yb = -78 - r * 58;
    board(yb, 170, 8);
    let x = -76;
    while (x < 68){
      const w = 10 + rnd() * 16, h = 26 + rnd() * 30;
      gray(0.44 + rnd() * 0.50);
      g.fillRect(x, yb - h, w, h);
      if (rnd() < 0.4){ gray(0.86); g.fillRect(x + 1, yb - h - 5, w - 2, 5); }  // 瓶盖
      x += w + 3 + rnd() * 6;
    }
  }
  for (let i = 0; i < 4; i++){                              // 地上的箱子
    gray(0.36 + rnd() * 0.22);
    g.fillRect(-72 + i * 38, -34 - rnd() * 22, 32, 30);
  }
  g.restore();

  /* cell 5' · 柜台变体：玻璃点心柜 + 咖啡机 + 上面一排酒瓶 */
  g.save(); g.translate(SYM_S * 5.5, R2 + SYM_S);
  gray(0.28); g.fillRect(-88, -120, 176, 116);              // 柜身
  gray(0.70); g.fillRect(-88, -128, 176, 10);               // 台面
  gray(0.50); g.strokeStyle = 'rgb(150,150,150)'; g.lineWidth = 4;
  g.strokeRect(-80, -114, 160, 60);                          // 点心柜玻璃框
  for (let i = 0; i < 7; i++){                               // 柜里的点心
    gray(0.58 + rnd() * 0.36);
    g.beginPath(); g.ellipse(-66 + i * 22, -68, 9, 7, 0, 0, Math.PI * 2); g.fill();
  }
  gray(0.66); g.fillRect(24, -186, 54, 58);                  // 咖啡机
  gray(0.92); g.fillRect(32, -176, 12, 18); g.fillRect(56, -176, 12, 18);
  gray(0.44); g.fillRect(-88, -214, 100, 7);                 // 酒瓶架
  for (let i = 0; i < 6; i++){
    gray(0.52 + rnd() * 0.42);
    g.fillRect(-84 + i * 16, -248, 9, 34);
  }
  g.restore();

  const rect = (i, y0) => ({u0: i * SYM_S / ATLAS, u1: (i + 1) * SYM_S / ATLAS,
                            v0: 1 - (y0 + SYM_S) / ATLAS, v1: 1 - y0 / ATLAS});
  const cell = i => rect(i, SYM_Y0);
  SYMIDX = {carotte: cell(0), cross: cell(1), leaf: cell(2), bloom: cell(3),
            shelf: cell(4), rack: cell(5), rail: cell(6),
            shelf2: rect(4, R2), rack2: rect(5, R2)};
  SYMIDX.rail2 = SYMIDX.rail;      // 挂衣杆只有一个变体，靠镜像散开就够
  return c;
}

/* 遮阳篷贴图：canvas 上 45% 是篷面帆布（竖条纹，乘 instanceColor 出色差），
   下 45% 是 lambrequin 垂幔，底缘一个 U 周期一个扇贝齿（齿宽 0.20 齿深 0.06 §1.4） */
function buildAwningTex(){
  const S = 256, c = PC.canvas(S, S), g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  g.fillStyle = '#ffffff';
  const hTop = Math.round(S * 0.45);
  g.fillRect(0, 0, S, hTop);
  g.fillStyle = 'rgba(0,0,0,0.11)';
  for (let i = 0; i < 4; i++) g.fillRect(i * 64 + 24, 0, 24, hTop);
  const y0 = Math.round(S * 0.55), h = S - y0;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(0, y0); g.lineTo(S, y0); g.lineTo(S, y0 + h * 0.76);
  g.ellipse(S / 2, y0 + h * 0.76, S / 2, h * 0.24, 0, 0, Math.PI, false);
  g.lineTo(0, y0); g.closePath(); g.fill();
  return c;
}

/* ═══════════════════ 2. 动态四边形网格 ═══════════════════
   招牌金字、篷面店名、旗式招牌、红菱形、绿十字全在这一片网格里 = 一个 draw call。
   走「预分配 + drawRange」而不是 InstancedMesh：它们每片的 UV 都不同，
   InstancedMesh 换图集格必须改 shader，得不偿失。 */
function quadMesh(THREE, mat, maxQ){
  const pos = new Float32Array(maxQ * 12), uv = new Float32Array(maxQ * 8),
        col = new Float32Array(maxQ * 12), idx = new Uint16Array(maxQ * 6);
  for (let i = 0; i < maxQ; i++){
    const v = i * 4, o = i * 6;
    idx[o] = v; idx[o+1] = v+1; idx[o+2] = v+2;
    idx[o+3] = v; idx[o+4] = v+2; idx[o+5] = v+3;
  }
  const g = new THREE.BufferGeometry();
  const A = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', A(pos, 3));
  g.setAttribute('uv', A(uv, 2));
  g.setAttribute('color', A(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.setDrawRange(0, 0);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
  let n = 0;
  return {
    mesh, max: maxQ,
    get count(){ return n; },
    reset(){ n = 0; },
    /* 四个世界坐标点，正面看的顺序：左下 → 右下 → 右上 → 左上 */
    push(p0, p1, p2, p3, r, cr, cg, cb){
      if (n >= maxQ) return -1;
      const o = n * 12, t = n * 8;
      pos[o]=p0[0];   pos[o+1]=p0[1];  pos[o+2]=p0[2];
      pos[o+3]=p1[0]; pos[o+4]=p1[1];  pos[o+5]=p1[2];
      pos[o+6]=p2[0]; pos[o+7]=p2[1];  pos[o+8]=p2[2];
      pos[o+9]=p3[0]; pos[o+10]=p3[1]; pos[o+11]=p3[2];
      uv[t]=r.u0; uv[t+1]=r.v0; uv[t+2]=r.u1; uv[t+3]=r.v0;
      uv[t+4]=r.u1; uv[t+5]=r.v1; uv[t+6]=r.u0; uv[t+7]=r.v1;
      for (let k = 0; k < 4; k++){ col[o+k*3]=cr; col[o+k*3+1]=cg; col[o+k*3+2]=cb; }
      return n++;
    },
    tint(i, cr, cg, cb){
      const o = i * 12;
      for (let k = 0; k < 4; k++){ col[o+k*3]=cr; col[o+k*3+1]=cg; col[o+k*3+2]=cb; }
      g.attributes.color.needsUpdate = true;
    },
    commit(){
      g.setDrawRange(0, n * 6);
      g.attributes.position.needsUpdate = true;
      g.attributes.uv.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
    }
  };
}

/* ═══════════════════ 3. 单件几何 ═══════════════════
   共用约定：局部 +Z = 朝街法线，+X = 沿街面，y = 人行道面以上的高度。
   放置只做「绕 Y 转 θ + 缩放 + 平移」，θ = atan2(n.x, n.z)，局部 +X 落在 (n.z, −n.x)。*/

/* 四面立柱：省掉看不见的上下盖，比 box 少 4 个三角 */
function bar(g, cx, cy, cz, sx, sy, sz){
  const x0=cx-sx/2, x1=cx+sx/2, y0=cy-sy/2, y1=cy+sy/2, z0=cz-sz/2, z1=cz+sz/2, s=0.4;
  g.face([x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1], s);
  g.face([x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0], s);
  g.face([x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1], s);
  g.face([x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0], s);
}
/* 绕 Y 转 ang 的四面立柱（桌子的三只脚要用） */
function barRot(g, ang, cx, cy, cz, sx, sy, sz){
  const c = Math.cos(ang), s = Math.sin(ang), hx = sx/2, hz = sz/2;
  const y0 = cy - sy/2, y1 = cy + sy/2;
  const R = (x, z) => [cx + x*c - z*s, cz + x*s + z*c];
  const p = [R(-hx,hz), R(hx,hz), R(hx,-hz), R(-hx,-hz)];   // (x,z) 顺时针 → 法线朝外
  for (let i = 0; i < 4; i++){
    const a = p[i], b = p[(i+1)%4];
    g.face([a[0],y0,a[1]], [b[0],y0,b[1]], [b[0],y1,b[1]], [a[0],y1,a[1]], 0.4);
  }
}
/* 按高度给顶点上色：把「一件东西两种材质」压进一个 draw call
   （最终 diffuse = material.color × instanceColor × 顶点色） */
function tintByY(THREE, geo, fn){
  const p = geo.attributes.position, arr = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++){
    const c = fn(p.getY(i));
    arr[i*3] = c[0]; arr[i*3+1] = c[1]; arr[i*3+2] = c[2];
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  return geo;
}

const GEO = {};
function buildGeos(THREE){
  /* 单位立方体。漆木盒池与石块池**各建一份**：PC.pool({vary:true}) 会把 aVary
     属性挂到 geometry 上，两个池共用同一个 BufferGeometry 的话，石块池会拿到
     漆木池的逐实例属性（数量对不上，且石块材质根本没声明它）。24 个顶点，
     多一份的代价是 0。 */
  { const g = new GB(); g.box(0, 0, 0, 1, 1, 1, 0.5); GEO.box = g.build(); }
  { const g = new GB(); g.box(0, 0, 0, 1, 1, 1, 0.5); GEO.boxP = g.build(); }

  /* 店面上下线脚：一条连续型材，沿 X 拉伸到店宽。0.75–3.05 留空给橱窗。§2.1 */
  { const g = new GB(), A = D.applique;
    g.prism([[0, D.socleH], [A, D.socleH], [A, D.skirtH - 0.03], [A - 0.07, D.skirtH],
             [0, D.skirtH]], 0, -0.5, 0.5, 0.5);
    g.prism([[0, D.glassTop], [A + 0.03, D.glassTop + 0.03], [A + 0.03, D.corniche],
             [A - 0.03, D.corniche + 0.02], [A - 0.03, D.bandTop - 0.02],
             [A + 0.06, D.bandTop], [A + 0.06, D.capTop], [0, D.capTop]], 0, -0.5, 0.5, 0.5);
    GEO.band = g.build(); }

  /* 遮阳篷模块：宽度固定 1.0，一个开间一片。扇贝齿走贴图 U 重复，所以怎么缩放
     齿都不会被拉长——这是「篷宽必须随店宽变」和「齿宽必须是 0.20」唯一的调和法。
     做成 0.03 厚的薄板（上下两面各自给法线）而不是单片双面：单片双面的自阴影
     会把篷底整片压黑，而人站在街上看到的正是篷底。 */
  { const y1 = D.awRoll, y2 = D.awFront, z0 = D.awZ0, z1 = D.awOut, vb = y2 - D.awVal;
    const P = [], N = [], U = [], I = []; let vi = 0;
    const put = (x,y,z, nx,ny,nz, u,v) => { P.push(x,y,z); N.push(nx,ny,nz); U.push(u,v); return vi++; };
    const quad = (a,b,c,d) => I.push(a,b,c, a,c,d);
    const dy = y1 - y2, dz = z1 - z0, L = Math.hypot(dy, dz);
    const uy = dz / L, uz = dy / L, TH = 0.03;    // 篷面朝上外的法线 + 板厚
    /* 上表面 */
    quad(put(-0.5,y1,z0, 0,uy,uz, 0, 0.99), put( 0.5,y1,z0, 0,uy,uz, 3, 0.99),
         put( 0.5,y2,z1, 0,uy,uz, 3, 0.60), put(-0.5,y2,z1, 0,uy,uz, 0, 0.60));
    /* 下表面（法线朝下内，绕序相反） */
    quad(put(-0.5,y1-TH,z0, 0,-uy,-uz, 0, 0.99), put(-0.5,y2-TH,z1, 0,-uy,-uz, 0, 0.60),
         put( 0.5,y2-TH,z1, 0,-uy,-uz, 3, 0.60), put( 0.5,y1-TH,z0, 0,-uy,-uz, 3, 0.99));
    /* 垂幔 lambrequin：正反两片，底缘扇贝由 alpha 裁 */
    quad(put(-0.5,y2,z1+0.010, 0,0,1, 0, 0.44), put( 0.5,y2,z1+0.010, 0,0,1, 16, 0.44),
         put( 0.5,vb,z1+0.010, 0,0,1, 16, 0.01), put(-0.5,vb,z1+0.010, 0,0,1, 0, 0.01));
    quad(put(-0.5,y2,z1-0.006, 0,0,-1, 0, 0.44), put(-0.5,vb,z1-0.006, 0,0,-1, 0, 0.01),
         put( 0.5,vb,z1-0.006, 0,0,-1, 16, 0.01), put( 0.5,y2,z1-0.006, 0,0,-1, 16, 0.44));
    /* 侧颊 joues §1.4 已删。原因：一片篷 = 一个开间，所以颊也长在**每一条开间缝**上，
       而它的法线指着街的方向——相机顺街看时，这些三角正对镜头、背着太阳，在篷面
       中间劈出一道道深色斜口（截图 t-shops-cafe-3 里被当成「扭曲的非平面四边形」）。
       颊只有在篷的两个外端才该出现，而实例化几何做不到「只给首尾两片加颊」。
       篷厚 0.03，去掉颊在 3m 高度上看不出破绽，还省 2 三角/片。 */
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    gg.setAttribute('normal',   new THREE.Float32BufferAttribute(N, 3));
    gg.setAttribute('uv',       new THREE.Float32BufferAttribute(U, 2));
    gg.setIndex(I); gg.computeBoundingSphere();
    GEO.awning = gg; }

  /* 朝街的竖直四边形工具：橱窗那四层都是同一个形状，只差 z 与上下沿 */
  const facePlane = (yLo, yHi, z, rows) => {
    const R = rows || 1, P = [], N = [], U = [], I = [];
    for (let i = 0; i <= R; i++){
      const t = i / R, y = yLo + (yHi - yLo) * t;
      P.push(-0.5, y, z, 0.5, y, z);
      N.push(0,0,1, 0,0,1); U.push(0, t, 1, t);
    }
    for (let i = 0; i < R; i++){ const v = i * 2;
      I.push(v, v+1, v+3, v, v+3, v+2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal',   new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv',       new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I); g.computeBoundingSphere();
    return g;
  };

  /* ① 店内背板 §2.2：不再是一块匀色板。
     竖向 5 段渐变——顶上是店内天花的灯带，底下是柜台脚线的暗部，亮度按 t^2.1
     往上收，所以亮的只有最上面那一档，中段是过渡，下段压到 0.30。
     最终 diffuse = instanceColor（这家店多亮，见 LIT）× 顶点色（店里上亮下暗），
     两件事乘在一起，仍然只有一个 draw call。 */
  { const g = facePlane(D.skirtH, D.glassTop, D.glZ, 5);
    const p = g.attributes.position, arr = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++){
      const t = (p.getY(i) - D.skirtH) / (D.glassTop - D.skirtH);
      const k = 0.30 + 1.25 * Math.pow(t, 2.1);
      arr[i*3]   = k * (0.80 + 0.20 * t);       // 上暖下冷：灯在天花上
      arr[i*3+1] = k * (0.84 + 0.10 * t);
      arr[i*3+2] = k * (1.00 - 0.20 * t);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
    GEO.vitrine = g; }

  /* ③ 上亮子 imposte：横档以上那道小窗，走 PC.mats().glassLit（暖色自发光），
     白天也亮着——巴黎店面的灯几乎不关，这道横窗是「店里有人」最省的一笔 */
  { GEO.imposte = facePlane(D.imposteY + D.tranH/2, D.glassTop - 0.015, D.impZ, 1); }

  /* ④ 玻璃面：加法混合的电介质镜面层。
     color 全黑 → 漫反射不贡献任何东西；roughness 0.045 + envMapIntensity 2.4 →
     只剩下 IBL 的镜面瓣，而 three 的环境 BRDF 自带菲涅耳：正对时只反 4%，
     擦过时几乎全反。加法叠在背板之上 = 真实橱窗的读法（同时看得见店内与倒影），
     而且加法与顺序无关，一个 InstancedMesh 里 70 片不用排序。 */
  { GEO.pane = facePlane(D.skirtH, D.glassTop, D.paneZ, 1); }

  /* porte cochère 的拱券 + 拱心石 agrafe（石）haussmann §11 */
  { const g = new GB(), half = D.dW / 2, rise = D.dRise;
    const R = (half*half + rise*rise) / (2*rise);
    const cy = D.dH - rise - (R - rise);
    const aMax = Math.asin(clamp(half / R, -1, 1)), N = 4, ring = 0.32, pts = [];
    for (let i = 0; i <= N; i++){ const t = -aMax + 2*aMax*i/N;
      pts.push([R * Math.sin(t), cy + R * Math.cos(t)]); }
    for (let i = N; i >= 0; i--){ const t = -aMax + 2*aMax*i/N;
      pts.push([(R+ring) * Math.sin(t), cy + (R+ring) * Math.cos(t)]); }
    g.prism(pts, 2, 0, 0.12, 0.5);
    g.box(0, cy + R + 0.10, 0.10, D.keyW, D.keyH, 0.22, 0.6);
    GEO.arch = g.build(); }

  /* 藤编 bistro 椅 §1.1：0.55×0.55×0.88，局部 +Z = 面朝的方向（背在 −Z）。
     52 个三角：腿 4×8、座面 12（顶面要看得见，必须整盒）、靠背 8。 */
  { const g = new GB();
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      bar(g, sx * 0.225, 0.225, sz * 0.225, 0.036, 0.45, 0.036);
    g.box(0, 0.472, 0, 0.50, 0.045, 0.50, 1.2);
    bar(g, 0, 0.700, -0.235, 0.50, 0.360, 0.045);
    GEO.chair = tintByY(THREE, g.build(), y => y < 0.45 ? [0.58,0.58,0.60] : [1,1,1]); }

  /* 小圆桌 guéridon §1.3：Ø0.60 大理石面 + 铸铁独柱盘座，桌高 0.73 */
  { const g = new GB();
    g.cyl(0, D.tblH - 0.015, 0, D.tblR, D.tblR, 0.03, 8, 0.5, false);
    g.disc(0, D.tblH, 0, D.tblR, 1, 8);
    bar(g, 0, (D.tblH - 0.03) / 2, 0, 0.06, D.tblH - 0.03, 0.06);
    g.cyl(0, 0.025, 0, 0.21, 0.17, 0.05, 6, 0.5, false);
    g.disc(0, 0.05, 0, 0.17, 1, 6);
    /* 顶点色让「一件东西两种材质」压进一个实例：桌面吃满 instanceColor（台面石材
       或锌板由 ID.top 定），盘座只吃 0.30 —— 铸铁座是同一遍 instanceColor 压到
       0.3 的结果，所以白大理石配深灰铸铁、锌板配近黑铸铁，比两者各随机各的更真。
       原值 0.18 在深色石台面下会把盘座压成纯黑，抬到 0.30。 */
    GEO.table = tintByY(THREE, g.build(),
      y => y > D.tblH - 0.05 ? [1,1,1] : [0.30,0.31,0.30]); }

  /* 花箱 / 花桶的盆身（同一件几何，靠非等比缩放当长条花箱用）§1.7 §3.3。
     植物不做几何——放进文字网格那片图集里当剪影，见 greenery()。 */
  { const g = new GB();
    g.cyl(0, 0.5, 0, 0.42, 0.50, 1.0, 6, 0.5, false);
    g.disc(0, 0.99, 0, 0.47, 1, 6);
    GEO.planter = tintByY(THREE, g.build(), y => y > 0.96 ? [0.30,0.26,0.21] : [1,1,1]); }

  /* 玻璃挡风屏 §1.5：只做玻璃段，下部实心裙走漆木盒池 */
  { const g = new GB(); bar(g, 0, 0.5, 0, 1, 1, 1); GEO.screen = g.build(); }
}

/* ═══════════════════ 4. 模块状态 ═══════════════════ */
let root = null, pools = null, quads = null, plan = null, grid = null,
    MATS = null, PAL = null, dbgWall = null;
let M4, QT, VP, VS, EU, COL;
const crossQuads = [];
let tSec = 0;

/* 空间索引：41k 个 parcel 全量扫太浪费，按 96m 网格分桶 */
const CELL = 96;
function buildGrid(){
  grid = new Map();
  for (const b of plan.blocks) for (const p of b.parcels){
    const mx = (p.seg[0][0] + p.seg[1][0]) / 2, mz = (p.seg[0][1] + p.seg[1][1]) / 2;
    const k = Math.floor(mx / CELL) + ':' + Math.floor(mz / CELL);
    let a = grid.get(k); if (!a) grid.set(k, a = []);
    a.push({p: p, x: mx, z: mz});
  }
}
function queryGrid(cx, cz, R, out){
  out.length = 0;
  const i0 = Math.floor((cx-R)/CELL), i1 = Math.floor((cx+R)/CELL),
        j0 = Math.floor((cz-R)/CELL), j1 = Math.floor((cz+R)/CELL), R2 = R*R;
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++){
    const a = grid.get(i + ':' + j); if (!a) continue;
    for (const it of a){
      const dx = it.x - cx, dz = it.z - cz, d2 = dx*dx + dz*dz;
      if (d2 <= R2) out.push({it: it, d2: d2});
    }
  }
  return out;
}
/* prof 可选：带 {age,grime,tint} 的档案，交给 PC.pool 的 aVary 通道做逐实例风化。
   不传的池（石构件、玻璃）就退化成纯 instanceColor。 */
function place(pool, wx, y, wz, th, sx, sy, sz, col, prof){
  EU.set(0, th, 0); QT.setFromEuler(EU);
  M4.compose(VP.set(wx, y, wz), QT, VS.set(sx, sy, sz));
  return pool.push(M4, col, prof);  // 池满返回 false —— 绿植靠它决定要不要跟着长
}

/* ═══════════════════ 5. 注册 ═══════════════════ */
PC.mod('shops', {
  order: 50,
  label: '临街门店',

  async build(ctx){
    const THREE = ctx.THREE;
    plan = ctx.plan; MATS = ctx.mats; PAL = ctx.palette;
    if (!plan || !plan.blocks) throw new Error('PC.plan 缺失，门店无处附着');
    if (!GB) throw new Error('P3D.helpers.GB 缺失');

    M4 = new THREE.Matrix4(); QT = new THREE.Quaternion();
    VP = new THREE.Vector3(); VS = new THREE.Vector3();
    EU = new THREE.Euler(); COL = new THREE.Color();
    GILT_OX = new THREE.Color(0x6d5326);      // 氧化后的镀金：深褐
    FADE_W  = new THREE.Color(0xbfb9ac);      // 白漆字晒久了的方向
    ZERO    = {age: 0, grime: 0, tint: 0};    // 不参与风化的实例（aVary 必须写零，
                                              // 否则会留着上一次重填的残值）

    root = new THREE.Group(); root.name = 'shops';
    ctx.scene.add(root);

    ctx.step(0, '门店 · 烤店名图集'); await ctx.raf();
    const atlasTex = PC.cachedTex('shops:atlas', buildAtlas, {clamp: true, srgb: true, aniso: 8});
    const awTex = PC.cachedTex('shops:awning', buildAwningTex, {aniso: 8});
    awTex.wrapS = THREE.RepeatWrapping; awTex.wrapT = THREE.ClampToEdgeWrapping;

    ctx.step(0, '门店 · 构件几何'); await ctx.raf();
    buildGeos(THREE);

    const SC = MATS.SC, std = MATS.std;
    /* 漆面质感 §2.1：高光半亮漆 roughness 0.35 —— 斜阳下那条高光边是「精致」的来源 */
    const matPaint = std({color: 0xffffff, roughness: 0.35, metalness: 0, envMapIntensity: 0.9});
    const matStone = std({color: 0xffffff, roughness: 0.92, metalness: 0, envMapIntensity: 0.5});
    const matBand  = std({color: 0xffffff, roughness: 0.35, metalness: 0, envMapIntensity: 0.9});
    const matAwn   = std({color: 0xffffff, roughness: 0.90, metalness: 0, envMapIntensity: 1.05,
                          map: awTex, alphaTest: 0.5, side: THREE.FrontSide});
    const matVit   = new THREE.MeshBasicMaterial({color: 0xffffff, vertexColors: true});
    /* 玻璃反射层：见 buildGeos 里 GEO.pane 的注释。depthWrite 关掉，让它老实待在
       背板与木框之间；木框是不透明的，先画、先写深度，所以框子那几格自然把玻璃挡住。
       envMapIntensity 写 6.8 不是笔误：paris.html 的 skyAmbient() 会把全场
       env0 重映射成 env0×0.4825+0.713（抬低压高），6.8 落地正好是 4.0，
       而 4.0 是实测「擦过时读得出是玻璃、正对时又不糊住陈列」的那一档
       （截图 g-a/g-c 两组对比）。它随时刻一起变暗，夜里反射自然收掉。 */
    const matPane  = std({color: 0x000000, roughness: 0.085, metalness: 0.0,
                          envMapIntensity: 6.8, transparent: true, depthWrite: false,
                          blending: THREE.AdditiveBlending, side: THREE.FrontSide});
    /* 上亮子：派生自 PC.mats().glassLit，只把自发光压到 0.26——直接用原件的话，
       一整条街同一标高上会横着一道匀亮的奶油色带，读起来是灯箱不是窗
       （截图 g-c-obl）。共享材质不许就地改，所以 clone。 */
    const matImp   = MATS.glassLit.clone();
    matImp.emissiveIntensity = 0.26;
    /* 编条是塑包藤，不是注塑件：把 metalness 归零、roughness 提到 0.78，
       高光瓣散开，那层「塑料椅」的镜面感就没了 §1.1 */
    const matChair = std({color: 0xffffff, roughness: 0.78, metalness: 0.0,
                          envMapIntensity: 0.55, vertexColors: true});
    const matTable = std({color: 0xffffff, roughness: 0.42, metalness: 0.14,
                          envMapIntensity: 0.9, vertexColors: true});
    const matPlant = std({color: 0xffffff, roughness: 0.88, metalness: 0,
                          envMapIntensity: 0.5, vertexColors: true});

    /* ── 逐实例风化 shader ──────────────────────────────────────────────
       instanceColor 只能给「整件东西一个颜色」，做不到「同一件东西身上也有新有旧」。
       PC.varyShader 读 aVary=(age,grime,tint) 再按**局部坐标**分区：底部积污、
       朝上的面磨损露底材、整体褪色。y0/y1 是那件东西自己的局部高度区间，所以
       每类件要单独给一组——盒子是 ±0.5 的单位立方，篷子是 2.30–3.12 的真实标高。
       代价：五个 program 变体，0 个新 draw call（属性不是绘制批次）。 */
    PC.varyShader(matPaint, {key:'box', y0: -0.50, y1: -0.16, wearColor: 0x8b7c66});
    PC.varyShader(matChair, {key:'chr', y0:  0.00, y1:  0.54, wearColor: 0xd8ccb2});
    PC.varyShader(matTable, {key:'tbl', y0:  0.00, y1:  0.24, wearColor: 0xc6c4bd});
    PC.varyShader(matPlant, {key:'pln', y0:  0.00, y1:  0.52, wearColor: 0x93876f});
    PC.varyShader(matAwn,   {key:'awn', y0:  D.awFront - D.awVal, y1: D.awFront + 0.18,
                             wearColor: 0xe6e1d5});
    const matScr   = std({color: SC(0xc8d2ce), roughness: 0.06, metalness: 0, envMapIntensity: 1.6,
                          transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide});
    const matText  = new THREE.MeshBasicMaterial({map: atlasTex, alphaTest: 0.42,
                          vertexColors: true, side: THREE.DoubleSide});

    /* castShadow 只给「投影真正能被看见」的三类：篷子打在立面上的横影、
       桌椅落在人行道上的影。别的一律关——**每个投影源就是一遍 shadow map
       draw call**，全开会让本层的 draw call 直接翻倍。
       店面木框、壁柱、门扇都是贴着墙的，影子落在它们身后的墙上，看不见。 */
    /* 上限的定法：boxPaint 原来 1000 差点被橱窗分格撑爆（住宅门 6 件 × 118 家已经
       吃掉 700），chair/table 原来 190/100 在 ring0 里就用到 178/82——窄道单排座
       一开，两个池当场溢出，表现是「有些店的椅子随机消失」。按 ring0 实测峰值
       ×1.4 的余量重定（实测峰值 boxPaint 1821 / chair 301 / table 125 / quads 983）。
       上限只决定预分配的矩阵数组大小，不决定每帧画多少——commit() 只把 count
       设成实际推入数，所以调高上限本身不花一个三角。 */
    pools = {
      boxPaint: PC.pool(GEO.boxP,    matPaint, 2600, {colors: true, vary: true, castShadow: false}),
      boxStone: PC.pool(GEO.box,     matStone,  560, {colors: true, castShadow: false}),
      band:     PC.pool(GEO.band,    matBand,   200, {colors: true, castShadow: false}),
      arch:     PC.pool(GEO.arch,    matStone,  180, {colors: true, castShadow: false}),
      vitrine:  PC.pool(GEO.vitrine, matVit,    200, {colors: true, castShadow: false, receiveShadow: false}),
      imposte:  PC.pool(GEO.imposte, matImp,    200, {castShadow: false, receiveShadow: false}),
      pane:     PC.pool(GEO.pane,    matPane,   200, {castShadow: false, receiveShadow: false}),
      awning:   PC.pool(GEO.awning,  matAwn,    260, {colors: true, vary: true, castShadow: true}),
      chair:    PC.pool(GEO.chair,   matChair,  320, {colors: true, vary: true, castShadow: true}),
      table:    PC.pool(GEO.table,   matTable,  170, {colors: true, vary: true, castShadow: true}),
      planter:  PC.pool(GEO.planter, matPlant,  420, {colors: true, vary: true, castShadow: false}),
      screen:   PC.pool(GEO.screen,  matScr,    120, {colors: true, castShadow: false, receiveShadow: false})
    };
    for (const k in pools) root.add(pools[k].mesh);
    /* 900 → 1300 → 2100：花箱与花桶的绿植剪影、以及橱窗里一格玻璃一片的陈列
       剪影都走这片网格（仍然是一个 draw call），原来的余量装不下 */
    quads = quadMesh(THREE, matText, 2100);
    root.add(quads.mesh);

    ctx.step(0, '门店 · 建空间索引'); await ctx.raf();
    buildGrid();

    PC.lod.onMove(cam => { try { refill(cam); } catch(e){ console.warn('[shops] 重填失败', e); } }, REFILL_D);
    await ctx.raf();

    return {
      root: root, pools: pools, quads: quads,
      stats(){ const o = {}; for (const k in pools) o[k] = pools[k].count; o.quads = quads.count; return o; },
      /* 自校验用：临时立一片素墙，好看清店面有没有插进墙里、有没有悬空。
         默认不建——正式场景的墙归 facade.js。 */
      debugWall: on => makeDebugWall(ctx.THREE, on)
    };
  },

  update(ctx, dt){
    if (!quads || !crossQuads.length) return;
    tSec += dt;
    /* 药房绿十字：4 秒一循环的呼吸 1.00 ↔ 1.30。规范要求「动画温和」，不做快闪 §3.2 */
    const k = 1.15 + 0.15 * Math.sin(tSec * Math.PI / 2);
    for (let i = 0; i < crossQuads.length; i++) quads.tint(crossQuads[i], k, k, k);
  },

  setVisible(v){ if (root) root.visible = v; }
});

/* ═══════════════════ 6. 重填 ═══════════════════ */
const _q = [];
function refill(camPos){
  for (const k in pools) pools[k].reset();
  quads.reset(); crossQuads.length = 0;

  const list = queryGrid(camPos.x, camPos.z, PC.lod.R0, _q);
  list.sort((a, b) => a.d2 - b.d2);

  let n = 0;
  for (let i = 0; i < list.length && n < MAX_FRONTS; i++){
    const it = list[i].it;
    if (PC.lod.ring(it.x, it.z) !== 0) continue;
    front(it.p, it.x, it.z);
    n++;
  }
  for (const k in pools) pools[k].commit();
  quads.commit();
}

/* 一个 parcel 长成一家店 */
function front(pc, mx, mz){
  const n = pc.n, t = [n[1], -n[0]];               // 局部 +X = (n.z, −n.x)
  const th = Math.atan2(n[0], n[1]);
  const y0 = (pc.y0 || 0) + D.swY;
  const W = pc.w, sw = pc.sidewalkW, hs = PC.hash2;
  const L2W = (a, b) => [mx + t[0]*a + n[0]*b, mz + t[1]*a + n[1]*b];

  /* plan 没有 brasserie 这个 use，但它和 cafe 的露台规模差一大截，
     所以在 cafe 里按位置哈希抽 22% 升格 */
  let use = pc.use;
  if (use === 'cafe' && hs(mx, mz, 7) < 0.22) use = 'brasserie';

  /* 抽这家店的身份：一次 PC.vary.of，之后店里每件东西都挂在它下面 */
  identity(pc, mx, mz, use);

  if (use === 'residential'){
    if (W >= 4.4) porteCochere(pc, mx, mz, th, y0, W, L2W, hs);
    return;
  }
  if (W < 3.4) return;                             // 太窄，留给铺装

  /* 店面漆：族里那一支被店龄褪过、被积垢压过之后的样子。
     shader 那一层再往上叠底部掉漆——踢脚线以上 30cm 是被鞋踢、被拖把撞了几十年
     的地方，那一圈磨得最狠，这件事只有逐实例风化做得出来。 */
  PC.vary.shade(ID.paint, itemProf(ID.f(191), 1.0, ID.tint), COL);
  const pr = COL.r, pg = COL.g, pb = COL.b;
  savePaintProf();          // 壁柱/木框/门樘之后都复用这一份（同一遍漆，同一个龄）

  /* 石踢脚 soubassement 0 → 0.35 §2.1
     石材不许换品种（巴黎的踢脚就是石灰岩），但它可以脏、可以长苔——
     改的是「它经历了什么」，不是「它是什么」。 */
  { const p = L2W(0, D.applique / 2 + 0.01);
    SP.age = ID.age * 0.4; SP.grime = clamp(ID.grime * 1.25, 0, 1);
    SP.moss = ID.moss; SP.tint = ID.tint;
    PC.vary.shade(PAL.limestoneDk, SP, COL);
    SP.moss = ID.moss * 0.45;
    place(pools.boxStone, p[0], y0 + D.socleH/2, p[1], th, W - 0.24, D.socleH, D.applique + 0.02, COL); }

  /* 上下线脚（连续型材，沿 X 拉到店宽） */
  COL.setRGB(pr, pg, pb);
  place(pools.band, mx, y0, mz, th, W - 0.24, 1, 1, COL);

  /* 端头壁柱 pilastre —— 一家店的左右边框，这条边框是「一家店」的视觉边界。
     两根柱子共用店面漆档案，但各自有一点点个体差（同一遍漆，不同的日晒面）。 */
  for (const s of [-1, 1]){
    const p = L2W(s * (W/2 - D.pilW/2 - 0.10), D.pilD/2);
    COL.setRGB(pr, pg, pb);
    loadPaintProf(0.92 + 0.16 * (s > 0 ? ID.f(193) : ID.f(197)));
    place(pools.boxPaint, p[0], y0 + D.capTop/2, p[1], th, D.pilW, D.capTop, D.pilD, COL, SP);
  }

  /* 橱窗：白天是暗的，面包房最亮 §2.2 §3 */
  vitrine(use, mx, mz, th, y0, W, L2W, hs, pr, pg, pb);

  /* 招牌带上的金色衬线大字 §2.3 */
  const set = NAMEIDX[NAMES[use] ? use : 'shop'];
  const slot = set[(hs(mx, mz, 11) * set.length) | 0];
  let qh = D.signH / CAPF, qw = qh * slot.ar;
  { const maxW = W - 0.9;
    if (qw > maxW){ const k = maxW / qw; qw = maxW; qh *= k; }
    const hw = qw/2, hh = qh/2, y = y0 + D.signY, z = D.applique - 0.03 + 0.012;
    const a = L2W(-hw, z), b = L2W(hw, z);
    /* 金字会氧化：镀金层薄，几十年后发暗发褐（不是像油漆那样褪成灰白，
       所以这里不走 PC.vary.shade，单独往深褐插值）。10% 的店是白漆字，不氧化。 */
    if (hs(mx, mz, 13) > 0.10){
      COL.set(PAL.gilt).lerp(GILT_OX, ID.age * 0.62).convertSRGBToLinear();
    } else COL.set(0xefeae0).lerp(FADE_W, ID.age * 0.30).convertSRGBToLinear();
    quads.push([a[0], y-hh, a[1]], [b[0], y-hh, b[1]],
               [b[0], y+hh, b[1]], [a[0], y+hh, a[1]], slot, COL.r, COL.g, COL.b); }

  /* 遮阳篷 store banne：按开间铺，一片一个开间 §1.4
     三件事叠在一起决定一片篷长什么样：
       ① 族 —— 从 PC.families.awning 抽（墨绿/酒红/深蓝/米白/赭/近黑），成套；
       ② 日晒 —— 朝南的立面（ID.sun→1）褪得比朝北的狠，同一色号能差出一个档；
       ③ 长尾 —— 约 6% 的店摊上一顶明显破旧的篷，其中一个开间换过、色号对不上
                （补丁）。一条街上有一两顶扎眼的，其余是背景。 */
  const wantAwn = use === 'cafe' || use === 'brasserie' || use === 'boulangerie' ||
                  use === 'librairie' || use === 'fleuriste' ||
                  (use === 'shop' && hs(mx, mz, 17) < 0.55);
  if (wantAwn && sw >= 1.9){
    const awW = Math.min(W - 0.7, D.awBay * (W > 8 ? 2 : 1));
    const nb = Math.max(1, Math.round(awW / D.awBay)), bw = awW / nb;
    /* 篷布比店面漆老得快（RATES.awning），再乘日晒 */
    const awAge = clamp(ID.age * 1.18 * (0.74 + 0.52 * ID.sun), 0, 1);
    const ragged = PC.vary.tail(ID.f(199), 3.0) > 0.84;       // ≈6% 的店（实测 5.7%）
    const patchBay = ragged ? (ID.f(211) * nb) | 0 : -1;
    for (let i = 0; i < nb; i++){
      const p = L2W(-awW/2 + bw * (i + 0.5), 0);
      /* 每个开间一点点自己的褪色与色偏：同一顶篷也不是均匀褪的 */
      const ub = hs(mx + i * 3.9, mz, 203);
      SP.age   = clamp(awAge * (ragged ? 1.45 : 1.0) * (0.88 + 0.24 * ub), 0, 1);
      SP.grime = clamp(SP.age * (0.55 + 0.55 * ID.riverside), 0, 1);
      SP.moss  = 0; SP.tint = clamp(ID.tint + (ub - 0.5) * 0.22, 0, 1);
      const fam = PC.families.awning;
      agedTone(i === patchBay ? fam[(ID.f(223) * fam.length) | 0] : ID.awn);
      place(pools.awning, p[0], y0, p[1], th, bw, 1, 1, COL, SP);
    }
    /* 卷筒：横贯的深色金属管，压在檐板下沿，不挡招牌 §2.1。
       它是金属，随龄氧化（发亮的镀锌管几年后就是哑的深灰）。 */
    { const p = L2W(0, D.awZ0);
      loadPaintProf(1.1);
      PC.vary.shade(0x3a3a38, SP, COL);
      place(pools.boxPaint, p[0], y0 + D.awRoll, p[1], th, awW + 0.10, 0.16, 0.16, COL, SP); }
    /* 垂幔上的店名：白色衬线大写，字高 0.12 §1.4 */
    { const th2 = 0.12 / CAPF, tw = Math.min(th2 * slot.ar, awW - 0.30);
      const hh = th2/2, hw = tw/2, y = y0 + D.awFront - D.awVal/2;
      const a = L2W(-hw, D.awOut + 0.02), b = L2W(hw, D.awOut + 0.02);
      /* 垂幔上的丝网印字比篷布本身掉得更快：篷子还看得出颜色时，字已经先糊了 */
      COL.set(0xefeae0).lerp(FADE_W, clamp(awAge * 0.75, 0, 1)).convertSRGBToLinear();
      quads.push([a[0], y-hh, a[1]], [b[0], y-hh, b[1]],
                 [b[0], y+hh, b[1]], [a[0], y+hh, a[1]], slot, COL.r, COL.g, COL.b); }
  }

  /* 业态识别件 §3：只要这一件对了业态就成立 */
  if (use === 'tabac'){
    const s = D.carH/2, zc = D.applique + D.carArm + s, y = y0 + D.carY;
    const a = L2W(0, zc - s), b = L2W(0, zc + s);
    quads.push([a[0], y-s, a[1]], [b[0], y-s, b[1]],
               [b[0], y+s, b[1]], [a[0], y+s, a[1]], SYMIDX.carotte, 1, 1, 1);
    const p = L2W(0, D.applique + D.carArm/2);
    loadPaintProf(1.15);                       // 悬在外面的铁件，比门脸旧一档
    PC.vary.shade(PAL.ironDk, SP, COL);
    place(pools.boxPaint, p[0], y0 + D.carY, p[1], th, 0.05, 0.05, D.carArm, COL, SP);
  }
  if (use === 'pharmacie'){
    const s = D.crS/2 * 1.14, zc = D.applique + D.crArm + s, y = y0 + D.crY;
    const a = L2W(0, zc - s), b = L2W(0, zc + s);
    const qi = quads.push([a[0], y-s, a[1]], [b[0], y-s, b[1]],
                          [b[0], y+s, b[1]], [a[0], y+s, a[1]], SYMIDX.cross, 1.15, 1.15, 1.15);
    if (qi >= 0) crossQuads.push(qi);
    const p = L2W(0, D.applique + D.crArm/2);
    loadPaintProf(1.15);
    PC.vary.shade(PAL.ironDk, SP, COL);
    place(pools.boxPaint, p[0], y0 + D.crY, p[1], th, 0.06, 0.06, D.crArm, COL, SP);
  }
  /* 旗式招牌 enseigne drapeau §2.3：约 30% 的店有，出挑 0.75，下沿 ≥2.50 */
  if (use !== 'tabac' && use !== 'pharmacie' && hs(mx, mz, 19) < 0.30){
    const fh = D.flagH * 0.62, fw = Math.min(fh / CAPF * slot.ar * CAPF, 0.78);
    const zc = D.applique + 0.05 + fw/2, y = y0 + D.flagY + fh/2;
    const a = L2W(0, zc - fw/2), b = L2W(0, zc + fw/2);
    COL.set(PAL.gilt).lerp(GILT_OX, ID.age * 0.70).convertSRGBToLinear();
    quads.push([a[0], y-fh/2, a[1]], [b[0], y-fh/2, b[1]],
               [b[0], y+fh/2, b[1]], [a[0], y+fh/2, a[1]], slot, COL.r, COL.g, COL.b);
    const p = L2W(0, D.applique + 0.05 + fw/2);
    loadPaintProf(1.20);
    PC.vary.shade(PAL.ironDk, SP, COL);
    place(pools.boxPaint, p[0], y + fh/2 + 0.06, p[1], th, 0.04, 0.04, fw + 0.14, COL, SP);
  }

  if (use === 'librairie') bookCart(th, y0, W, sw, L2W);
  if (use === 'fleuriste') flowerBuckets(mx, mz, th, y0, W, sw, L2W, hs);
  if (use === 'cafe' || use === 'brasserie') terrasse(use, mx, mz, th, y0, W, sw, L2W, hs);
  if (use === 'tabac') tabacTables(th, y0, W, sw, L2W);
}

/* ═══ 橱窗 §2.2 ═══
   五层，从里到外：店内背板 → 陈列剪影 → 上亮子 → 玻璃面 → 木框分格。
   原来只有一层——一片 MeshBasic 匀色板贴在墙上。那一层单独存在时，无论调什么
   颜色都只能是一块封起来的板：没有分格所以没有尺度，没有反射所以不是玻璃，
   后面什么都没有所以没有深度（截图 chk2-cafe-oblique 中间那家店的灰板、
   chk3-terrasse0 里 BRASSERIE 下面那条米色带，都是同一件事）。
   五层的代价：一格玻璃多 4 个三角，每家店多 5–8 个盒子实例，全场多 2 个 draw call。 */
function vitrine(use, mx, mz, th, y0, W, L2W, hs, pr, pg, pb){
  const gw = W - 0.70;                                  // 玻璃口净宽（与壁柱内缘对齐）
  if (gw < 1.2) return;

  /* ① 店内背板：instanceColor 管「这家店多亮」（LIT），顶点色管「店里上亮下暗」。
     底色从近黑往暖白插值，再整体压到 0.62——原来的暗端是 0x2a 的中灰，
     那个中灰正是「板」的观感来源：真实店内不可能整片是均匀中灰。 */
  { const f = ID.lit * ID.lit;                       // ID.lit = 业态基准 × 这家店的个性 × 店龄
    COL.setRGB(0.078 + (1.000 - 0.078) * f,
               0.090 + (0.769 - 0.090) * f,
               0.106 + (0.518 - 0.106) * f).convertSRGBToLinear();
    /* 玻璃越脏，透出来的店内越闷。橱窗玻璃本身是加法镜面层（没有 instanceColor
       可用），所以「脏玻璃」这件事落在背板亮度上——效果一样，代价是 0。 */
    COL.multiplyScalar(0.62 * (1 - 0.26 * ID.grime));
    const p = L2W(0, 0);
    place(pools.vitrine, p[0], y0, p[1], th, gw, 1, 1, COL); }

  /* 分格：竖梃约 1.55m 一档，2–9 格。上限 9 是实例预算定的：这份平面把 9.6–22.4m
     的整条临街面判给一家店，不封顶的话一家 22m 的啤酒屋一个人要吃掉 14 根竖梃。
     店门落在其中一格，位置按哈希定死，同一家店永远开在同一边。 */
  const nb = clamp(Math.round(gw / D.mullPitch), 2, 9), bw = gw / nb;
  const door = (hs(mx, mz, 23) * nb) | 0;
  const dw = Math.min(D.doorW, bw - 0.12);
  const dx = -gw/2 + bw * (door + 0.5);

  /* ② 陈列剪影：一格玻璃一片（门那格不放），两个三角，走已有的文字网格。
     玻璃后面有没有东西，是「橱窗」和「板」最根本的分界。 */
  const kind = displayKind(use, hs(mx, mz, 27));
  if (kind){
    const yb = y0 + D.skirtH + 0.06;
    const hgt = D.imposteY - D.tranH/2 - D.skirtH - 0.16;
    const hw = (bw - 0.20) / 2;
    /* 一家店只有一种内景（一家面包房不会半边是货架），但同一张剪影原样重复
       九格就是墙纸。所以「两个变体 × 左右镜像」四选一，选谁按这一格的位置哈希。 */
    const V = [SYMIDX[kind], SYMIDX[kind + '2']];
    for (let i = 0; i < nb; i++){
      if (i === door) continue;
      const a = -gw/2 + bw * (i + 0.5), r = hs(mx + a * 6.1, mz, 83);
      const rc = V[r < 0.5 ? 0 : 1];
      const rect = (i & 1) ? {u0: rc.u1, u1: rc.u0, v0: rc.v0, v1: rc.v1} : rc;
      const A = L2W(a - hw, D.disZ), B = L2W(a + hw, D.disZ);
      /* 陈列剪影的亮度跟着这家店的灯走：灯火通明的面包房里货架是亮的，
         半开的旧杂货店里只剩轮廓。一格一格再抖一点，不是整片一个灰。 */
      const g = (0.085 + r * 0.06) * (0.62 + 1.05 * ID.lit);
      quads.push([A[0], yb, A[1]], [B[0], yb, B[1]],
                 [B[0], yb + hgt, B[1]], [A[0], yb + hgt, A[1]],
                 rect, g, g * 0.93, g * 0.84);
    }
  }

  /* ③ 上亮子（暖色自发光）+ ④ 玻璃面（加法镜面层）。两个池都不带 instanceColor：
     反射是全城一样的物理，只有「店里多亮」才因店而异，那件事在第 ① 层。 */
  { const p = L2W(0, 0);
    place(pools.imposte, p[0], y0, p[1], th, gw, 1, 1);
    place(pools.pane,    p[0], y0, p[1], th, gw, 1, 1); }

  /* ⑤ 木框分格：竖梃 meneau + 横档 traverse + 门樘。取店面漆色压深一档——
     框是同一遍漆刷在凸出的型材上，永远比漆面板背光。 */
  const fr = pr * 0.72, fg = pg * 0.72, fb = pb * 0.72;
  const gh = D.glassTop - D.skirtH, gc = (D.glassTop + D.skirtH) / 2;
  for (let i = 1; i < nb; i++){
    const p = L2W(-gw/2 + bw * i, D.frmZ);
    COL.setRGB(fr, fg, fb);
    loadPaintProf(1.0);
    place(pools.boxPaint, p[0], y0 + gc, p[1], th, D.mullW, gh, D.mullD, COL, SP);
  }
  { const p = L2W(0, D.frmZ);
    COL.setRGB(fr, fg, fb);
    loadPaintProf(1.0);
    place(pools.boxPaint, p[0], y0 + D.imposteY, p[1], th, gw, D.tranH, D.mullD, COL, SP); }
  if (dw > 0.55){
    /* 门樘是全店被摸得最多的一根木头：同一遍漆，但磨损倍率给 1.35 */
    for (const s of [-1, 1]){
      const p = L2W(dx + s * (dw/2 + D.jambG/2), D.frmZ);
      COL.setRGB(fr, fg, fb);
      loadPaintProf(1.35);
      place(pools.boxPaint, p[0], y0 + (D.doorH + D.skirtH)/2, p[1], th,
            D.jambG, D.doorH - D.skirtH, D.mullD, COL, SP);
    }
    const p = L2W(dx, D.frmZ);
    COL.setRGB(fr, fg, fb);
    loadPaintProf(1.0);
    place(pools.boxPaint, p[0], y0 + D.doorH, p[1], th, dw + D.jambG * 2, 0.09, D.mullD, COL, SP);
  }
}

/* 橱窗里陈列什么，按业态 §2.2：吃的一律柜台＋面包架，能上架的一律货架，
   一部分杂货店（服装/皮具那种）换成挂衣杆 */
function displayKind(use, r){
  if (use === 'boulangerie' || use === 'cafe' || use === 'brasserie' || use === 'fleuriste') return 'rack';
  if (use === 'shop') return r < 0.30 ? 'rail' : 'shelf';
  return 'shelf';
}

/* ═══ 露天座 §1 ═══
   带宽推导（streetlife.md §0 的四条带）：usable = sw − 0.30，通行带 1.60 优先，
   放不下一排椅子（0.95）就干脆不设。
   与 §0 那段伪代码的一处差别：不给自家店门口预留家具带。巴黎的行道树本来就不种
   在露天座正前方，两者是互斥的；留了家具带，3.3m 宽的人行道一把椅子都摆不下，
   而 3.3m 恰恰是这份平面里最常见的人行道宽度（中位 2.73，p75 3.38）。 */
function terrasseDepth(sw){
  if (sw < 2.20) return 0;
  const usable = sw - 0.30;
  let ter = Math.min(3.0, Math.max(0.95, usable / 3));
  if (usable - ter < 1.60) ter = usable - 1.60;
  return ter < 0.95 ? 0 : ter;
}

/* ═══ 露天座分档（这一节是新加的） ═══
   上面那个 terrasseDepth 只有一条线：摆不下「一排椅 0.95 + 通行带 1.60」就
   一个座位都不摆。展开来算，门槛落在 sw ≥ 2.85——而这份平面里人行道中位数
   只有 2.73。实测后果：全城 3212 家咖啡馆里 1808 家（56%）门口空空如也，
   有店招有橱窗一把椅子没有（截图 chk2-cafe-oblique 里的 LE RÉVEIL MATIN，
   sw = 2.44）。

   真实巴黎在 2m 出头的人行道上照样有露天座，但做法不是把完整露台等比缩小，
   是**换一种摆法**：贴着立面单排、椅子一律朝街、桌子换成 φ0.53 的小盘、
   不设挡风屏、进深压在 1.40 以内，剩下的全留给通行。所以这里改成三档：

     sw ≥ 4.50   full  完整露台（双排椅 + 桌 + 挡风屏 + 花箱），走 terrasseDepth
     sw ≥ 2.40   wall  贴墙单排座，进深 ≤1.40，见 wallRow()
     sw <  2.40  none  只放花箱与黑板；2.40 是硬底——椅子占 0.90，再窄通行带
                       就掉到 1.2m 以下，那不是窄，那是把人行道堵死了 */
function terrasseTier(sw){
  return sw >= 4.50 ? 'full' : (sw >= 2.40 ? 'wall' : 'none');
}
/* 贴墙单排的进深（自立面起算，含椅背离墙的 0.35）。sw 2.40 → 0.95，≥2.90 → 1.40 封顶 */
function wallDepth(sw){ return clamp(sw - 1.50, 0.95, 1.40); }

function terrasse(use, mx, mz, th, y0, W, sw, L2W, hs){
  const tier = terrasseTier(sw);
  if (tier === 'none'){ narrowFront(mx, mz, th, y0, W, sw, L2W, hs); return; }
  if (tier === 'wall'){ wallRow(mx, mz, th, y0, W, sw, L2W, hs); return; }

  let dep = terrasseDepth(sw);
  if (use === 'brasserie') dep = Math.min(3.0, dep * 1.25);   // brasserie 取上限 §3
  const runW = W - 0.9;

  const z0 = D.backGap;                        // 椅背离墙 0.35 §1.2
  const rows = dep >= 1.85 ? 2 : 1;
  /* 椅距每家店不同（0.66–0.80）。原来全城共用 0.72 一个节拍，加上桌子按 i%3
     严格落位，顺街看过去就是一条精确重复到灭点的网格——这是 t-shops-cafe-3
     里「同一组桌椅原样重复几十次」的来源。 */
  const pitch = D.chPitch * (0.92 + 0.19 * hs(mx, mz, 29));
  const cnt = Math.max(1, Math.floor(runW / pitch));
  const a0 = -(cnt - 1) * pitch / 2;

  for (let r = 0; r < rows; r++){
    const zr = z0 + D.chD/2 + r * D.rowGap;
    if (zr + D.chD/2 > dep + 0.10) break;
    const off = r ? pitch/2 : 0;
    for (let i = 0; i < cnt; i++){
      /* 每个位置两个独立的哈希：hj 管「挪到哪」，h1 管「摆什么」 */
      const hj = hs(mx + i * 2.7, mz + r * 11.3, 37);
      const a = a0 + i * pitch + off + (hj - 0.5) * pitch * 0.36;   // 沿街 ±18% 位移
      if (Math.abs(a) > runW/2) continue;
      const h1 = hs(mx + a * 3.1, mz + r * 7.7, 43);
      /* 桌子改成按位置抽样 28%（不再是 i%3），依旧落在 1 桌 : 2 椅 §1.3 上，
         但不再等距。桌子往街边挪 0.12 ±0.08 */
      if (h1 > 0.72){
        const p = L2W(a, Math.min(zr + 0.12 + (hj - 0.5) * 0.16, z0 + dep - D.tblR));
        /* 桌面石材是这家店的（ID.top，配套买的），但每张桌子被擦了多少年不一样：
           顶点色让盘座只吃 0.30 的 instanceColor，所以白大理石配深灰铸铁、
           锌板配近黑铸铁，两者是同一件事的两端，不是两个随机数。 */
        itemProf(hs(mx + a * 1.7, mz, 71), 1.05, clamp(ID.tint + (hj - 0.5) * 0.14, 0, 1));
        agedTone(ID.top);
        place(pools.table, p[0], y0, p[1], th + (hj - 0.5) * 0.5, 1, 1, 1, COL, SP);
        continue;
      }
      if (h1 < 0.15) continue;                                  // 15% 空位 §1.2
      const spin = h1 > 0.66 ? 0.9 : (h1 - 0.4) * 0.62;         // 6% 有人刚起身，其余 ±9° 抖动
      const p = L2W(a, zr + (hj - 0.5) * 0.15);                 // 进深 ±0.075 抖动
      /* 一家店的椅子同色（ID.weave 是配套买的那一批），但磨损各不相同：
         外排（r=1）临街、日晒足、翻台勤；露台两端（|a| 大）风吹雨淋也更狠。
         色相不许乱跑——tint 只在族内做 ±14% 饱和 / ±9% 明度的浮动。 */
      chairAt(pools.chair, p, y0, th + spin, 1,
              hs(mx + a * 3.7, mz + r * 9.1, 73),
              1.0 + 0.30 * r + 0.26 * Math.abs(a) / (runW / 2 + 0.01));
    }
  }

  /* 玻璃挡风屏 §1.5：只有 full 档（sw ≥4.50）才有，约 55%。侧挡成对出现。
     窄道单排座一律不设——法定不许，实际也没地方立那两片玻璃。 */
  if (hs(mx, mz, 47) < 0.55){
    for (const s of [-1, 1]){
      const p = L2W(s * (runW/2 + 0.05), z0 + dep/2);
      /* 玻璃：只加一层水垢/灰的偏色，形制不动 */
      COL.setRGB(1 - 0.16 * ID.grime, 1 - 0.11 * ID.grime, 1 - 0.13 * ID.grime);
      place(pools.screen, p[0], y0 + D.scrSkirt, p[1], th, 0.05, D.scrH, dep, COL);
      /* 下部实心裙是店面同一遍漆，但它在地面上、被踢被溅，老得快一档 */
      loadPaintProf(1.25);
      PC.vary.shade(ID.paint, SP, COL);
      place(pools.boxPaint, p[0], y0 + D.scrSkirt/2, p[1], th, 0.07, D.scrSkirt, dep, COL, SP);
    }
  }

  /* 花箱：露天座四角必有，外缘每 2.5m 一个 §1.7。
     四角是法定的，所以首尾两个不参与抽样；中间的按 72% 出现、间距 ±25% 抖动，
     否则六个一模一样的梯形盆等距排开，网格感比桌椅还刺眼。 */
  const edge = z0 + dep - D.plD/2;
  const nPl = Math.max(2, Math.round(runW / 2.5));
  for (let i = 0; i <= nPl; i++){
    const corner = (i === 0 || i === nPl);
    const hp = hs(mx + i * 4.7, mz + i * 1.9, 53);
    if (!corner && hp > 0.72) continue;
    const jit = corner ? 0 : (hp / 0.72 - 0.5) * (runW / nPl) * 0.5;   // ±25% 档距
    const a = clamp(-runW/2 + runW * i / nPl + jit, -runW/2, runW/2);
    planterAt(th, y0, L2W(a, edge), hs(mx + a * 5.3, mz, 59), L2W, a, edge, hp);
  }
  /* 黑板菜单：每家一个，放在露天座靠街的一端 §1.8 */
  blackboard(th, y0, L2W(runW/2 + 0.28, z0 + dep * 0.5));
}

/* ═══ 贴墙单排座（sw 2.40–4.50）§1.2 变体 ═══
   与完整露台的三处不同，每一处都是被 1.4m 进深逼出来的：
   ① 只有一排，椅背贴着立面（离墙 0.35），椅子全部朝街——巴黎露天座本来就是
      「朝街看人」的坐法，窄道上这个坐法反而更成立；
   ② 桌子缩到 φ0.53（完整露台是 φ0.60），并且桌沿绝不许越过 dep，
      dep 那条线就是通行带的边界；
   ③ 不设挡风屏，花箱只在两端各一个、且换成短盆——花箱在这里是露台的边界标记，
      不是装饰。
   通行宽度：sw 2.40 时余 1.15m，sw ≥2.90 时余 ≥1.50m。 */
function wallRow(mx, mz, th, y0, W, sw, L2W, hs){
  const dep = wallDepth(sw);
  const runW = W - 0.9;
  if (runW < 1.2) return;

  /* 椅子只铺中间那段，两端各留 0.45 给花箱，否则花箱会长进最外那把椅子里 */
  const seatW = runW - 0.90;
  const zc = Math.min(D.backGap + D.chD/2, dep - D.chD/2 - 0.04);
  const pitch = D.chPitch * (0.90 + 0.17 * hs(mx, mz, 29));
  const cnt = Math.max(1, Math.floor(seatW / pitch));
  const a0 = -(cnt - 1) * pitch / 2;

  const tk = 0.88;                                        // 小桌 φ0.60 × 0.88 = φ0.53
  const zt = Math.min(zc + 0.08, dep - D.tblR * tk - 0.02);
  for (let i = 0; i < cnt; i++){
    const hj = hs(mx + i * 2.7, mz + 3.1, 37);
    const a = a0 + i * pitch + (hj - 0.5) * pitch * 0.28;
    if (Math.abs(a) > seatW/2) continue;
    const h1 = hs(mx + a * 3.1, mz + 5.9, 43);
    if (h1 > 0.74){                                       // 约 1 桌 : 2 椅 §1.3
      const p = L2W(a, zt);
      itemProf(hs(mx + a * 1.7, mz + 2.3, 71), 1.05, clamp(ID.tint + (hj - 0.5) * 0.14, 0, 1));
      agedTone(ID.top);
      place(pools.table, p[0], y0, p[1], th + (hj - 0.5) * 0.5, tk, 1, tk, COL, SP);
      continue;
    }
    if (h1 < 0.12) continue;                              // 12% 空位
    const spin = h1 > 0.68 ? 0.85 : (h1 - 0.4) * 0.5;     // 少数几把刚被人推开
    const p = L2W(a, zc + (hj - 0.5) * 0.08);
    /* 窄道单排全部临街，磨损基准比宽露台的内排高 */
    chairAt(pools.chair, p, y0, th + spin, 1,
            hs(mx + a * 3.7, mz + 4.1, 73), 1.22);
  }

  /* 两端各一个短花箱当露台边界；盆外沿正好压在 dep 上，不越线 */
  const ez = Math.max(D.plD/2 + 0.10, dep - D.plD/2);
  for (const s of [-1, 1]){
    const a = s * (runW/2 - 0.05);
    planterAt(th, y0, L2W(a, ez), hs(mx + a * 5.3, mz, 59), L2W, a, ez, undefined, 0.55);
  }
  blackboard(th, y0, L2W(runW/2 + 0.30, Math.min(0.62, dep - 0.20)));
}

/* ═══ 摆不下座位的窄人行道（sw < 2.40）§1.7 §1.8 ═══
   一把椅子都放不下，但门口不能空着——空着就读不出这是一家咖啡馆。
   花箱与黑板贴着立面站，进深 ≤0.50，谁都不挡。 */
function narrowFront(mx, mz, th, y0, W, sw, L2W, hs){
  if (sw < 1.70) return;
  const runW = W - 0.9, z = 0.30;
  const n = sw >= 2.00 ? 2 : 1;
  for (let i = 0; i < n; i++){
    const a = n === 1 ? -runW/2 + 0.55
                      : (i ? runW/2 - 0.55 : -runW/2 + 0.55);
    const r = hs(mx + a * 4.3, mz, 41);
    planterAt(th, y0, L2W(a, z), r, L2W, a, z, r, 0.70);
  }
  blackboard(th, y0, L2W(runW/2 - 1.5, 0.38));
}

/* 一把椅子 §1.1。
   同一家店的椅子是**同一批买的**，所以基色一律 ID.weave；差异只在两处：
     · 磨损 mul —— 临街、外排、日晒足的那几把磨得狠（扶手先露底色，藤条发白）；
     · 族内 tint —— ±14% 饱和 / ±9% 明度的浮动，不动色相。
   色相一乱，一排椅子就从「一家店的家具」变成「一堆二手货」，那比不随机更假。
   形制不给随机：真实 bistro 椅是目录件，二十把一个尺寸，抖尺寸反而露怯。 */
function chairAt(pool, p, y0, th, k, u, mul){
  itemProf(u, mul, clamp(ID.tint + (u - 0.5) * 0.20, 0, 1));
  agedTone(ID.weave);
  return place(pool, p[0], y0, p[1], th, k, k, k, COL, SP);
}

/* 花箱 §1.7：盆身 + **黄杨球**。
   § 表里「箱 + 植物总高 ≤1.60」这一行以前只实现了「箱」——一个 0.5m 高的梯形空盆
   孤零零站在人行道上，读起来就是个垃圾桶（t-shops-cafe-1 的审查结论）。
   盆高按 § 保持在法定下段，真正缺的是盆口上那一团绿。
   kMul：窄道那两档用的短盆（0.55–0.70 倍长），完整露台不传就是原尺寸。 */
function planterAt(th, y0, p, r, L2W, a, z, hp, kMul){
  const FAM = PC.families.planter;                               // 木条箱/深绿金属/陶盆/近黑
  /* 花箱是露天件里老得最快的（RATES.planter）：日晒雨淋、被浇水、被踢。
     盆身色是这家店那一批的，但每个盆自己有龄——所以同一排里有的还挺新，
     有的边沿已经泛白、底下积了一圈土。 */
  itemProf(r, 1.25, clamp(ID.tint * 0.5 + r * 0.5, 0, 1));
  agedTone(FAM[(r * FAM.length) | 0]);
  const spin = ((hp === undefined ? r : hp) - 0.5) * 0.28;      // ±8° 摆歪
  const k = (0.90 + r * 0.20) * (kMul || 1);                     // 长度 ±10%
  const ok = place(pools.planter, p[0], y0, p[1], th + spin,
                   D.plL * k, D.plH, D.plD, COL, SP);
  /* 植物的长尾：约 4% 的箱子是空的（刚清过或者没人管了），约 10% 里面的黄杨枯了。
     这种小细节最能骗过眼睛——一整条街的绿植全都同样精神，反而假。 */
  if (!ok || !L2W) return;
  const pu = PC.vary.tail(PC.hash2(p[0], p[1], 233), 2.6) * (0.55 + 0.75 * ID.age);
  if (pu > 0.78) return;                                         // 空箱（≈3%）
  greenery(L2W, a, z, y0 + D.plH - 0.06,
           D.plL * k * 0.86, D.plGrn * (0.86 + 0.28 * r), SYMIDX.leaf, r,
           undefined, pu > 0.58 ? 1 : 0);                        // 枯黄（≈10%）
}

/* 绿植剪影：图集里的 leaf / bloom 格 + 两个三角，走已有的文字网格，不新增 draw call。
   （buildGeos 上方那句「植物放进图集当剪影，见 greenery()」原来没有对应实现。） */
function greenery(L2W, a, z, yBase, w, h, rect, r, tintRGB, dead){
  const A = L2W(a - w/2, z), B = L2W(a + w/2, z);
  let cr, cg, cb;
  if (tintRGB){ cr = tintRGB[0]; cg = tintRGB[1]; cb = tintRGB[2]; }
  else {
    /* 叶色从 PC.families.foliage 的五支里抽，不是在 foliage ↔ foliageLt 之间线性抖：
       行道树、黄杨、常春藤本来就不是同一种绿，一条街上五支混着才读得出是植物。
       增益压在 1 附近：这片网格是不受光的 MeshBasic，而实测街面在楼影里的辐照度
       本来就接近 1，给到 1.35 会亮成一团荧光绿。体积感交给图集里那 52 片
       0.5–1.0 灰阶的叶子，不靠调亮。 */
    const FAM = PC.families.foliage;
    COL.set(dead ? DEAD_LEAF : FAM[(r * FAM.length) | 0]).convertSRGBToLinear();
    const g = (0.92 + r * 0.26) * (dead ? 0.92 : 1);
    cr = COL.r * g; cg = COL.g * g; cb = COL.b * g;
  }
  quads.push([A[0], yBase, A[1]], [B[0], yBase, B[1]],
             [B[0], yBase + h, B[1]], [A[0], yBase + h, A[1]], rect, cr, cg, cb);
}

/* 折叠黑板 chevalet §1.8：高 0.95，双面板 0.50×0.70，木架 */
function blackboard(th, y0, p){
  /* 黑板天天被擦，粉笔灰吃进漆面里 —— 老店的板面是灰的不是黑的 */
  itemProf(PC.hash2(p[0], p[1], 239), 1.30, ID.tint);
  PC.vary.shade(0x1a1a18, SP, COL);
  place(pools.boxPaint, p[0], y0 + 0.56, p[1], th, 0.50, 0.68, 0.05, COL, SP);
  PC.vary.shade(PC.families.shopPaint[5], SP, COL);       // 木架：族里那支浅栗
  place(pools.boxPaint, p[0], y0 + 0.11, p[1], th, 0.54, 0.22, 0.34, COL, SP);
}

/* 书店门口的书车 §3 表：1.20 × 0.55 × 0.95，外加一排外挂书架 */
function bookCart(th, y0, W, sw, L2W){
  if (sw < 1.7) return;
  /* 书车每天推进推出，是书店最旧的一件；书脊那层反而常换（新到的书） */
  const p = L2W(-W/2 + 0.95, 0.46);
  itemProf(ID.f(241), 1.40, ID.tint);
  PC.vary.shade(PC.families.shopPaint[4], SP, COL);
  place(pools.boxPaint, p[0], y0 + 0.56, p[1], th, 1.20, 0.52, 0.55, COL, SP);
  itemProf(ID.f(243), 0.55, ID.tint);                    // 书脊：新到的那批
  PC.vary.shade(0x8a7a5c, SP, COL);
  place(pools.boxPaint, p[0], y0 + 0.92, p[1], th, 1.10, 0.26, 0.44, COL, SP);
  itemProf(ID.f(247), 1.55, ID.tint);                    // 底架铁件：锈
  PC.vary.shade(PAL.ironDk, SP, COL);
  place(pools.boxPaint, p[0], y0 + 0.15, p[1], th, 1.16, 0.30, 0.46, COL, SP);
  const q = L2W(W/2 - 1.05, 0.32);
  itemProf(ID.f(251), 1.25, ID.tint);
  PC.vary.shade(PC.families.shopPaint[4], SP, COL);
  place(pools.boxPaint, q[0], y0 + 0.95, q[1], th, 1.40, 1.10, 0.34, COL, SP);
}

/* 花店的人行道花桶 §3.3：沿店面 1–2 排，桶中心距 0.40，一桶一色 */
function flowerBuckets(mx, mz, th, y0, W, sw, L2W, hs){
  if (sw < 1.5) return;
  const rows = sw >= 2.6 ? 2 : 1, runW = W - 1.0;
  const cnt = clamp(Math.floor(runW / 0.40), 2, 14);
  for (let r = 0; r < rows; r++) for (let i = 0; i < cnt; i++){
    const hb = hs(mx + i * 3.7, mz + r * 5.1, 67);
    const a = -runW/2 + runW * i / (cnt - 1) + (hb - 0.5) * 0.12;
    const z = 0.34 + r * 0.42;
    const p = L2W(a, z);
    /* 桶是锌桶（灰），花在桶口上 —— 原来把花色刷在桶身上，一排彩色圆桶
       没有一朵花，跟花箱是同一个毛病 */
    itemProf(hb, 1.15, clamp(ID.tint * 0.4 + hb * 0.6, 0, 1));
    agedTone(0x8e9490);                                   // 锌桶：浅色，越旧越脏不是越白
    if (!place(pools.planter, p[0], y0, p[1], th + (hb - 0.5) * 0.4,
               D.bkD, D.bkH, D.bkD, COL, SP)) continue;
    const FL = PC.families.bloom;
    COL.set(FL[(hs(mx + a * 9.1, mz + r * 3.3, 61) * FL.length) | 0]).convertSRGBToLinear();
    const g = 1.30 + hb * 0.35;
    greenery(L2W, a, z, y0 + D.bkH - 0.04, D.bkD * 1.5, D.bkGrn, SYMIDX.bloom, hb,
             [COL.r * g, COL.g * g, COL.b * g]);
  }
  /* 三级阶梯架，约一半的花店有 §3.3 */
  if (hs(mx, mz, 63) < 0.5) for (let k = 0; k < 3; k++){
    const h = 0.90 - k * 0.30, p = L2W(-W/2 + 1.05, 0.28 + k * 0.35);
    /* 阶梯架天天被水浇，越低那层越旧 */
    itemProf(hs(mx, mz, 253 + k), 1.10 + 0.22 * (2 - k), ID.tint);
    PC.vary.shade(PC.families.shopPaint[5], SP, COL);
    place(pools.boxPaint, p[0], y0 + h/2, p[1], th, 1.20, h, 0.33, COL, SP);
  }
}

/* 烟草店门口两张小桌。跟着露天座一起分档：窄道那档桌子也缩到 φ0.53 并往墙边收，
   否则 sw=2.4 的人行道上一张 φ0.60 的桌子会直接骑到路缘上。 */
function tabacTables(th, y0, W, sw, L2W){
  const tier = terrasseTier(sw);
  if (tier === 'none') return;
  const dep = tier === 'full' ? terrasseDepth(sw) : wallDepth(sw);
  const tk = tier === 'full' ? 1 : 0.88;
  const zt = Math.min(D.backGap + 0.42, dep - D.tblR * tk - 0.02);
  const zc = Math.min(D.backGap + 0.28, dep - D.chD/2 - 0.04);
  const a = Math.min(W/2 - 0.9, 1.6);
  for (const s of [-1, 1]){
    const p = L2W(s * a, zt);
    itemProf(ID.f(227 + (s > 0 ? 2 : 0)), 1.05, ID.tint);
    agedTone(ID.top);
    place(pools.table, p[0], y0, p[1], th, tk, 1, tk, COL, SP);
    const q = L2W(s * a + 0.52, zc);
    chairAt(pools.chair, q, y0, th + s * 0.55, 1, ID.f(229 + (s > 0 ? 2 : 0)), 1.15);
  }
}

/* ═══ porte cochère（住宅，占全城 62%）haussmann.md §11 ═══ */
function porteCochere(pc, mx, mz, th, y0, W, L2W, hs){
  const openW = Math.min(D.dW, W - 1.4), half = openW / 2;
  /* 门在中间开间；面宽 ≥5 开间时可偏一个开间 §11 */
  const shift = pc.bays >= 5 ? (hs(mx, mz, 71) < 0.5 ? -1 : 1) * pc.pitch : 0;
  const lim = Math.max(0, W/2 - half - D.jambW - 0.4);
  const ax = clamp(shift, -lim, lim);
  const stone = [PAL.limestone, PAL.limestoneDk, PAL.limestoneLt][pc.variant.stoneTone % 3];
  const dh = D.dH - D.dRise;                       // 门扇高 = 拱脚高 3.04

  /* 门后通往内院的过道：一个暗盒子就够，不建室内 §11。
     它已经是近黑，风化再压就成纯黑洞——aVary 显式写零（不写会留着上一次
     重填时别的实例的残值，那是会「闪变」的）。 */
  { const p = L2W(ax, -0.70);
    COL.setRGB(0.012, 0.014, 0.016);
    place(pools.boxPaint, p[0], y0 + D.dH/2, p[1], th, openW, D.dH, 1.20, COL, ZERO); }

  /* 两侧壁柱。石材的品种不许变（variant.stoneTone 是这栋楼的定数），
     但一楼这一段是全立面最容易脏的地方——积垢与苔绿按「它经历了什么」给。 */
  SP.age = ID.age * 0.35; SP.grime = clamp(ID.grime * 1.15, 0, 1);
  SP.moss = ID.moss; SP.wear = ID.wear * 0.3; SP.tint = ID.tint;
  PC.vary.shade(stone, SP, COL);
  for (const s of [-1, 1]){
    const p = L2W(ax + s * (half + D.jambW/2), 0.05);
    place(pools.boxStone, p[0], y0 + dh/2, p[1], th, D.jambW, dh, 0.14, COL);
  }
  /* 半圆／扁平券 + 拱心石 agrafe（比壁柱高，雨水冲得到，脏得轻一点） */
  { const p = L2W(ax, 0);
    SP.grime = ID.grime * 0.72;
    PC.vary.shade(stone, SP, COL);
    place(pools.arch, p[0], y0, p[1], th, openW / D.dW, 1, 1, COL); }

  /* 双开橡木门扇 + 上部镂空铁艺格栅 §11。
     漆色族仍按 DOOR_PAINT 的深绿偏向抽（§11 的形制），变的是这扇门刷了多少年：
     门是整栋楼被手推得最多的一件，磨损倍率给到 1.5，shader 会在门扇下段
     磨出一片露木的底色——那是几十年鞋尖踢出来的。 */
  const FAMP = PC.families.shopPaint;
  const paint = FAMP[DOOR_PAINT[(hs(mx, mz, 73) * DOOR_PAINT.length) | 0] % FAMP.length];
  const leafW = half - 0.05;
  for (const s of [-1, 1]){
    const p = L2W(ax + s * (leafW/2 + 0.025), -0.04);
    itemProf(hs(mx, mz, 257 + (s > 0 ? 1 : 0)), 1.50, ID.tint);
    PC.vary.shade(paint, SP, COL);
    place(pools.boxPaint, p[0], y0 + (dh - 0.08)/2, p[1], th, leafW, dh - 0.08, 0.10, COL, SP);
    /* 上部铁艺格栅：锻铁随龄氧化，发暗、起一层灰绿 */
    const q = L2W(ax + s * (leafW/2 + 0.025), 0.02);
    itemProf(hs(mx, mz, 259 + (s > 0 ? 1 : 0)), 1.25, ID.tint);
    PC.vary.shade(PAL.ironDk, SP, COL);
    place(pools.boxPaint, q[0], y0 + dh - 0.48, q[1], th, leafW - 0.16, 0.60, 0.04, COL, SP);
  }
  /* 门槛石：全楼被踩得最狠的一块，磨亮 + 积垢 */
  { const p = L2W(ax, 0.10);
    SP.age = ID.age * 0.5; SP.grime = clamp(ID.grime * 1.35, 0, 1);
    SP.moss = ID.moss * 0.6; SP.tint = ID.tint;
    PC.vary.shade(PAL.limestoneDk, SP, COL);
    place(pools.boxStone, p[0], y0 + 0.04, p[1], th, openW + 0.3, 0.08, 0.32, COL); }
}

/* ═══ 自校验用的临时素墙 ═══ */
function makeDebugWall(THREE, on){
  if (!on){ if (dbgWall){ root.remove(dbgWall); dbgWall = null; } return 0; }
  if (dbgWall || !PC.lod.pos) return 0;
  const geos = [], list = queryGrid(PC.lod.pos.x, PC.lod.pos.z, PC.lod.R0, []);
  list.sort((a, b) => a.d2 - b.d2);
  for (let i = 0; i < list.length && i < MAX_FRONTS; i++){
    const p = list[i].it.p, a = p.seg[0], b = p.seg[1], n = p.n;
    const y = (p.y0 || 0) + D.swY, h = 7.0, e = 0.02;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(
      [a[0]-n[0]*e, y, a[1]-n[1]*e,  b[0]-n[0]*e, y, b[1]-n[1]*e,
       b[0]-n[0]*e, y+h, b[1]-n[1]*e,  a[0]-n[0]*e, y+h, a[1]-n[1]*e], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(
      [n[0],0,n[1], n[0],0,n[1], n[0],0,n[1], n[0],0,n[1]], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0,0, 1,0, 1,1, 0,1], 2));
    g.setIndex([0,2,1, 0,3,2]);
    geos.push(g);
  }
  const merged = PC.merge(geos);
  if (!merged) return 0;
  dbgWall = new THREE.Mesh(merged, MATS.stone);
  dbgWall.receiveShadow = true; dbgWall.frustumCulled = false;
  root.add(dbgWall);
  return geos.length;
}

/* ══════════════════════════════════════════════════════════════════════════
   已知取舍（是设计，不是 bug，别当 bug 修）

   ① 遮阳篷卷筒定在 3.12 而不是 streetlife.md §1.4 的 3.40：§ 原值会把 3.45 标高
      的招牌金字整条埋进篷子里。招牌比篷高 0.28 这件事比篷高本身重要。
   ② 篷的侧颊 joues 整个删掉。一片篷 = 一个开间，颊会长在每一条开间缝上，法线
      指着街的方向，顺街看时在篷面中间劈出一道道深色斜口。颊只该出现在篷的两个
      外端，而实例化几何做不到「只给首尾两片加颊」。
   ③ 橱窗里的陈列是图集剪影，不是几何。一格玻璃两个三角，走文字网格那一个
      draw call。代价是走近了看它是平的、没有视差；换来的是七十多家店都有内景。
   ④ 玻璃反射走「加法混合的纯镜面层」，不是真透射（transmission）。真透射要一张
      屏幕拷贝的渲染目标，代价和整条城市层一个量级。加法层在 dark 背板上叠出的
      读法与真玻璃一致（同时看得见店内与倒影），而且与绘制顺序无关。
   ⑤ 露天座三档的门槛是 4.50 / 2.40。2.40 是硬底：椅背离墙 0.35 + 椅深 0.55 = 0.90，
      再窄通行带就掉到 1.2m 以下。所以 sw < 2.40 的咖啡馆门口只有花箱与黑板，
      那不是漏摆，是摆不下。
   ⑥ 遮阳篷的出挑固定 1.80，没有随人行道收窄。sw = 1.9 的店篷子会伸到离路缘
      0.10m（法定要留 0.70）。改法是按 sw 缩 z 向缩放，但那会让篷根与店面檐板
      之间裂开 6cm 的缝。本轮不动，记在这里。
   ⑦ 椅子、桌子的**形制**不给随机（只给颜色与磨损）。真实 bistro 椅是目录件，
      一家店二十把一个尺寸，抖尺寸反而露怯——尺度不一致读起来是「一堆二手货」，
      不是「一家店的家具」。花箱例外：盆是零买的，所以给了 ±10% 长度。
   ⑧ 「一家店特别新」这条没做（只做了「特别旧」的长尾）。PC.vary.head 摆在那里
      可以用，但新店和标准件在这套色族里看起来几乎一样——多一条尾巴看不出来，
      只多一次哈希。
   ⑨ 大门的门环、店招的射灯这两件没加几何。它们各自要多一个实例 ×118 家住宅，
      boxPaint 池实测峰值已经 1929/2600，加进去要连带调池上限与三角预算。
      本轮只做了「已有构件的风化」，形制不动。
   ⑩ 橱窗玻璃的脏度落在**背板亮度**上，不在玻璃本身。玻璃是加法混合的纯镜面层
      （material.color 全黑），instanceColor 乘在 diffuse 上等于乘 0，改不动它。
      「脏玻璃 = 透出来的店内更闷」在读法上等价，代价是 0。
   ══════════════════════════════════════════════════════════════════════════ */

})();
