/* ══════════════════════════════════════════════════════════════════════════
   city/terrain.js —— 城市地面层（order 10，全城脚下的一切）

   负责：河道开挖 · 车行道弹石 · 人行道与路缘石 · 街廓底面与内院 ·
        广场铺装与图案层（分格石带／花岗岩收边／同心环／零公里点）·
        公园绿地（辐射／砂砾／法式花坛／草坪／方园草坪块）· 蒙马特山丘 ·
        下层河岸步道 berge · 河床 · 城外郊野远景环

   不负责：河堤挡墙与水面（water.js）、桥（bridges.js）、
          行道树与路灯（furniture.js）、桌椅遮阳伞（shops.js）。

   三条自我约束：
   ① 所有位置只从 PC.plan 读，一个坐标都不自己编。
   ② 颜色只从 PC.palette 取或由它派生，模块里不出现凭感觉写死的灰。
   ③ 静态几何按材质分桶，每桶合成一个 BufferGeometry —— 整层 13 个 draw call。
      铺装的花纹全走程序生成的 canvas 贴图，不用几何画每一块石头。

   高程基准（不可改）：街面 y=0，下层河岸 −6.6，水面 −8.6。蒙马特按 plan.terrainY 抬升。
   ══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

if (typeof PC === 'undefined' || !PC.mod){ console.error('[terrain] core.js 未加载'); return; }
const HP = (window.P3D && P3D.helpers) || {};
const clamp = HP.clamp || ((v,a,b)=> v<a?a:(v>b?b:v));
const mulberry32 = HP.mulberry32;
const makeNoise = HP.makeNoise, fbmFactory = HP.fbmFactory;

/* ─────────────────────────── 0. 颜色工具 ───────────────────────────
   全城只有 PC.palette 一份色。这里只做「取出来再调深浅／混合」，不新造颜色。 */
const P = PC.palette;
const rgb  = h => [(h>>16)&255, (h>>8)&255, h&255];
const hexf = (r,g,b) => (clamp(r|0,0,255)<<16) | (clamp(g|0,0,255)<<8) | clamp(b|0,0,255);
function shade(h, k){ const c = rgb(h), f = t => k >= 0 ? t + (255-t)*k : t*(1+k);
  return hexf(f(c[0]), f(c[1]), f(c[2])); }
function mixc(a, b, t){ const A = rgb(a), B = rgb(b);
  return hexf(A[0]+(B[0]-A[0])*t, A[1]+(B[1]-A[1])*t, A[2]+(B[2]-A[2])*t); }
function css(h, a){ const c = rgb(h);
  return a === undefined ? 'rgb('+c+')' : 'rgba('+c+','+a+')'; }

/* 派生色（全部由 palette 混出来，改 palette 这里跟着走）。
   第一轮实测：直接用 palette 的名义色，在 sun=4.0 + ACES 的曝光下整座城市
   会亮成一片惨白（内院渲染出来约 0.85 的明度）。所以这里统一压暗一档，
   压的是「这一层在这套光照下的落地值」，不是改 palette 本身。 */
const C = {
  ground:  shade(mixc(P.pave, P.asphalt, 0.50), -0.26),  // 街面底板：弹石与沥青的中间调
  pave:    shade(P.pave, -0.30),
  sett:    shade(P.pave, -0.04),            // 广场铺石比车行道亮一档（磨得更光）
  walk:    shade(P.sidewalk, -0.35),
  curb:    shade(P.curb, -0.20),
  court:   mixc(P.asphalt, P.limestoneDk, 0.26),   // 内院：石板 + 碎石，背光的天井本就偏暗
  sand:    shade(P.sand, -0.20),
  bed:     mixc(P.waterDeep, P.sand, 0.34), // 河床淤泥
  lawn:    shade(P.lawn, -0.06),
  hedge:   shade(P.foliage, -0.26),         // 修剪黄杨绿篱
  /* 花坛：暖色但要压住彩度，全开会变成乐高积木（第一轮杜乐丽/植物园就是这样） */
  bloom:   [mixc(0xb4553f, P.lawn, .50), mixc(0xc08a3c, P.lawn, .50),
            mixc(0xa86a44, P.lawn, .45),  mixc(0xc0a05a, P.lawn, .55)],
  pool:    P.waterShallow,
  /* 广场图案层（分格线／收边／中心环／零公里点）——全部由 palette 派生。
     贴图是中性灰，颜色靠顶点色给，所以这几只要按「最终落地明度」调。 */
  figLt:   shade(mixc(P.curb, P.limestoneLt, 0.30), -0.16),  // 花岗岩收边亮带
  figMd:   shade(P.pave, -0.16),                             // 分格石带
  figDk:   shade(P.pave, -0.52),                             // 深缝
  bronze:  mixc(P.gilt, P.ironDk, 0.40),                     // 零公里点铜牌
  /* 城外：越远越暗越绿。近郊还留一点城市灰，远郊是林地农田。 */
  subNear: shade(mixc(P.pave, P.lawn, 0.44), -0.32),
  subMid:  shade(mixc(P.lawn, P.asphalt, 0.34), -0.30),
  subFar:  shade(mixc(P.foliage, P.slate, 0.30), -0.34)
};

/* ────────────────────── 0b. 地面的个体差异（PC.vary 在这一层的用法）──────────────────────
   这一层和实例池那一层不一样：地面是合并的静态几何，没有 instanceColor 可以逐件改，
   也加不起三角形——地面在每一个机位都常驻，多一个三角要在全城每一帧付钱。
   所以差异只走两条零成本的路：

     ① 顶点色。桶里本来就有顶点，把「这一段路 / 这一块广场 / 这一个内院是哪一批」
        写进顶点色，材质开 vertexColors 就够了。粒度是一条街、一块广场、一个街廓。
     ② 片元 shader。比一个四边形还小的东西——补丁、车辙、边沟——只能在片元里画。
        按 tile 取块状哈希，不逐片元加噪声：逐片元噪声出来是沙沙的杂色，
        块状差异才读得出「这里被挖开又补回去过」。

   顶点色是「乘」上贴图的，所以写进去的不是绝对色而是**比值**：目标色 ÷ 材料锚色。
   锚色取 PC.palette 里那个名义色（族的第 0 个也是它），于是 C.* 里那一档
   「在这套光照下压暗多少」的系数会原样乘过去，不会被这一层悄悄改掉。          */

const _tA = new THREE.Color(), _tB = new THREE.Color();
const FADE  = 0xc9c6bd;      // 晒褪的方向：灰白带一点冷（与 core.js 同一个目标）
const GRIME = 0x4a443b;      // 积垢的方向：暗褐灰
const ZERO4 = [0, 0, 0, 0];
/* 顶点色的公用出口：Buck.vtx 当场把 r/g/b 抄进数组，复用一个对象就够了 */
const VCOL = new THREE.Color(), VCOL2 = new THREE.Color();
/* 内院的另外两种地面处理。天井是背光的，两种都在 C.court 的暗底上加一点色，
   不能直接拿满亮度的砂土色和草绿——那会让每个天井都像开了盏灯。
   混合系数收过一轮：内院是三种不同的地面处理，本来就该比「同一种石头的两个采石批次」
   差得多，但第一轮 0.40/0.42 从空中看，整片街区的天井读成了奶油／灰／绿的马赛克。
   现在的值仍然一眼分得出是三种处理，只是不再抢走街区的主色。 */
const COURT_GRAVEL = mixc(C.court, P.sand, 0.32);   // 碎石铺面
const COURT_GREEN  = mixc(C.court, P.lawn, 0.34);   // 常年没人管，长了草
/* 「把这一桶的贴图从锚色推到目标色」需要乘多少。线性空间里算的比值。 */
function ratioTo(target, anchor, out){
  _tA.set(target).convertSRGBToLinear();
  _tB.set(anchor).convertSRGBToLinear();
  out.setRGB(_tA.r / Math.max(1e-4, _tB.r),
             _tA.g / Math.max(1e-4, _tB.g),
             _tA.b / Math.max(1e-4, _tB.b));
  return out;
}

/* 批次哈希：同一个 batch（街道 id / 广场序号 / 街廓序号）永远得到同一串值。
   PC.vary.of 的 pick/f 是按坐标哈希的——同一条街的两个路段坐标不同，
   拿它抽族会抽出两种石头，一条街就被劈成两半。批次共享得自己按 batch 哈希，
   算法与 core.js 里 of() 取批次基龄用的那一行保持一致。 */
const bhash = (batch, salt) => PC.hash2(batch * 7.3, batch * 3.1, salt);

/* 长尾抽族：多数抽到第 0 个（族里的标准件），少数才落到后面。
   k=2.4、5 支的族 → 第 0 支约 51%，最后一支约 9%。
   均匀抽会让「每条街都是不同的石头」，那读起来还是噪声，只是换了一种噪声。 */
function pickTail(fam, u, k){
  return fam[Math.min(fam.length - 1, Math.floor(PC.vary.tail(u, k === undefined ? 2.4 : k) * fam.length))];
}

/* 一件泛用地面的「批次调制色」。
     anchor  这族材料的锚色（= PC.palette 里的名义色 = 族的第 0 个）
     fam     PC.families 里的真实色族
     prof    PC.vary.of 的档案（age/grime/moss/tint 从这里来）
     opt     {batch, famSalt, span, fade, dirt, moss, gain, lo, hi, out}
   顺序是：抽族（批次共享）→ 族内明度抖动（个体，由 prof.tint 驱动）→
   褪色与积垢（由同一个 prof.age 驱动，不是各随机各的）→ 换算成比值并夹住。
   夹住是必要的：地面是全城最大的一块面，任何一块脱队都会当场读成 bug。 */
function batchTone(anchor, fam, prof, opt){
  opt = opt || {};
  const out = opt.out || new THREE.Color();
  const u = opt.batch === undefined ? prof.f(opt.famSalt || 139)
                                    : bhash(opt.batch, opt.famSalt || 139);
  _tA.set(pickTail(fam, u, opt.k));
  /* ── 个性强度 dev：整批共享的一个长尾系数 ───────────────────────────────
     长尾整形只用在「抽哪一支族」上是不够的：族抽中标准件之后，下面的族内抖动、
     褪色、积垢仍然各自按均匀分布走，三项叠起来就是「每条街都不一样」——
     那读出来还是噪声，只是换了一种噪声。实测第一轮：偏离中位 <3% 的「标准件」
     只占 22–25%，偏离 >8% 的「有个性的」反而占 34–40%，正好和原则四要的
     63% / 16% 反过来。
     dev 把下面所有偏移量统一缩放：多数批次 dev 接近下限，落回族里那个标准件；
     少数批次才把褪色与积垢拉满。缩放的是幅度不是方向，所以「年龄是隐变量」
     这条不受影响——一批路面仍然是同一个 age 同时驱动褪色与积垢。 */
  const dev = 0.16 + 0.84 * PC.vary.tail(
    opt.batch === undefined ? prof.f(191) : bhash(opt.batch, 191), 2.6);
  /* 族内：明度 ±span（默认 ±5%），色相不动。同一批里也没有两块一样的石头 */
  const span = opt.span === undefined ? 0.05 : opt.span;
  _tA.multiplyScalar(1 + (prof.tint - 0.5) * 2 * span * dev);
  /* 年龄是隐变量：褪色、积垢、苔绿全由它一个驱动 */
  _tA.lerp(_tB.set(FADE),  prof.age   * (opt.fade === undefined ? 0.16 : opt.fade) * dev);
  _tA.lerp(_tB.set(GRIME), prof.grime * (opt.dirt === undefined ? 0.22 : opt.dirt) * dev);
  if (opt.moss && prof.moss > 0.02) _tA.lerp(_tB.set(0x5a6b3e), prof.moss * opt.moss * dev);
  if (opt.gain) _tA.multiplyScalar(opt.gain);
  /* 比值要在线性空间里算，才能保证「贴图恰是锚色时，结果恰是目标色」 */
  _tA.convertSRGBToLinear();
  _tB.set(anchor).convertSRGBToLinear();
  const lo = opt.lo === undefined ? 0.80 : opt.lo, hi = opt.hi === undefined ? 1.20 : opt.hi;
  out.setRGB(clamp(_tA.r / Math.max(1e-4, _tB.r), lo, hi),
             clamp(_tA.g / Math.max(1e-4, _tB.g), lo, hi),
             clamp(_tA.b / Math.max(1e-4, _tB.b), lo, hi));
  return out;
}

/* ── 片元级铺装风化 shader ──────────────────────────────────────────────
   注入点选在 <roughnessmap_fragment>：那时 diffuseColor 已经是 map×顶点色的成品，
   roughnessFactor 也刚算出来，一处就能同时改颜色和粗糙度（车辙是磨光的，
   只调暗淡没有「光」的差别就还是一张贴纸）。零三角、零 draw call，只多一个 program。
   kind='road' 车行道弹石，kind='walk' 沥青人行道。                        */
const PAV_HASH =
  'float pvh(vec2 p){vec3 q=fract(vec3(p.xyx)*0.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}\n';

const PAV_BODY = {
  /* 车行道：边沟 → 车辙 → 修补块 → 横向开挖沟槽 → 井盖回填圆块 */
  road:
  ' float t=vPav.x, ua=vPav.y, sd=vPav.z, hw=max(1.0,vPav.w);\n' +
  ' float ac=t*hw*2.0;\n' +                                  // 横过路面的米数
  ' float traf=0.38+0.62*smoothstep(2.6,6.4,hw);\n' +        // 路越宽车越多，辙越明显
  ' float tone=1.0, worn=0.0;\n' +
  /* 车辙：轮胎常年压过的两条带，石面被磨光——亮一点、糙度低一点 */
  ' float rut=max(1.0-smoothstep(0.030,0.095,abs(t-0.295)),\n' +
  '              1.0-smoothstep(0.030,0.095,abs(t-0.705)))*traf;\n' +
  ' tone+=rut*0.100;\n' +
  /* 边沟：贴着路缘的一条，泥沙落叶常年积在这儿 */
  ' tone-=(1.0-smoothstep(0.0,0.085,min(t,1.0-t)))*0.100;\n' +
  /* 中脊：两条辙之间没被磨到，比辙暗一档 */
  ' tone-=(1.0-smoothstep(0.0,0.10,abs(t-0.5)))*0.030*traf;\n' +
  /* 修补块：2.2m×2.6m 一格，格里再内缩出一块，边缘因此参差不齐 */
  ' vec2 pc=vec2(ua/2.2, ac/2.6), ci=floor(pc), cf=pc-ci;\n' +
  ' float h1=pvh(ci+sd*97.0), mg=0.08+0.16*pvh(ci+11.3);\n' +
  ' float ins=step(mg,cf.x)*step(cf.x,1.0-mg)*step(mg,cf.y)*step(cf.y,1.0-mg);\n' +
  ' if(h1>0.935){ tone*=1.0-0.160*ins; worn=max(worn,0.80*ins); }\n' +   // 沥青补丁：6.5% 的格子，内缩后实占 ≈3%
  ' else if(h1>0.815){ tone*=1.0+(pvh(ci+3.7)-0.5)*0.13*ins; }\n' +      // 换批石块：12% 的格子，实占 ≈5.5%
  /* 横向开挖沟槽：埋管挖开又回填的一条，横跨整个路面 */
  ' float tc=floor(ua/1.5);\n' +
  ' if(pvh(vec2(tc,sd*53.0+7.0))>0.968){\n' +
  '   float w=fract(ua/1.5), bd=step(0.18,w)*step(w,0.78);\n' +
  '   tone*=1.0-0.130*bd; worn=max(worn,0.70*bd);\n }\n' +
  /* 井盖／闸阀检修后回填的圆块。不画井盖本体——井盖归街具层，位置对不上会出两套 */
  ' vec2 mc=vec2(ua,ac)/4.6, mi=floor(mc), mf=fract(mc)-0.5;\n' +
  ' if(pvh(mi+sd*29.0+5.0)>0.945){\n' +
  '   float k=1.0-smoothstep(0.14,0.20,length(mf));\n' +
  '   tone*=1.0-0.130*k; worn=max(worn,0.78*k);\n }\n' +
  ' roughnessFactor=clamp(roughnessFactor-rut*0.22+worn*0.05,0.05,1.0);\n',

  /* 人行道：墙根潮痕 → 路缘侧踩白 → 沥青补丁（比车行道密，入户管线全从这儿挖） */
  walk:
  ' float t=vPav.x, ua=vPav.y, sd=vPav.z, hw=max(0.6,vPav.w);\n' +
  ' float ac=t*hw;\n' +                                      // 从楼根到路缘的米数
  ' float tone=1.0, worn=0.0;\n' +
  ' tone-=(1.0-smoothstep(0.0,0.40,ac))*0.075;\n' +          // 墙根：屋檐滴水常年潮
  ' tone+=(1.0-smoothstep(0.0,0.60,hw-ac))*0.035;\n' +       // 路缘侧踩得最多，磨白
  ' vec2 pc=vec2(ua/1.6, ac/1.3), ci=floor(pc), cf=pc-ci;\n' +
  ' float h1=pvh(ci+sd*71.0), mg=0.07+0.18*pvh(ci+5.1);\n' +
  ' float ins=step(mg,cf.x)*step(cf.x,1.0-mg)*step(mg,cf.y)*step(cf.y,1.0-mg);\n' +
  /* 靠路缘那一侧破损更多（树池、雨水口、入户井都在那半边），门槛跟着 ac 往下走 */
  ' float near=smoothstep(0.35,0.85,ac/hw);\n' +
  ' float thA=0.925-0.055*near, thB=0.78-0.06*near;\n' +
  ' if(h1>thA){ tone*=1.0-0.145*ins; worn=max(worn,0.72*ins); }\n' +
  ' else if(h1>thB){ tone*=1.0+(pvh(ci+2.3)-0.5)*0.11*ins; }\n' +
  ' roughnessFactor=clamp(roughnessFactor+worn*0.04,0.05,1.0);\n'
};

function pavementShader(mat, kind, asphalt){
  /* asphalt：补丁本身的线性色，写成「贴图的平均值再压暗一点」。
     沥青补丁是平的——它盖住了底下的弹石，所以要混向一个**常数**色。
     第一版混向逐片元亮度，那只是去了饱和，弹石的缝一条不少地留着，
     补丁读出来是「一块变暗的弹石」而不是「一块沥青」。 */
  const a = asphalt || [0.075, 0.072, 0.068];
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = sh => {
    if (prev) prev(sh);
    sh.vertexShader = 'attribute vec4 aPav;\nvarying vec4 vPav;\n'
      + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vPav=aPav;');
    sh.fragmentShader = 'varying vec4 vPav;\n' + PAV_HASH
      + sh.fragmentShader.replace('#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\n{\n' + PAV_BODY[kind]
        /* 顶点色带着「这一批石头是什么调子」，补丁的沥青也该跟着这条街走 */
        + ' vec3 asph=vColor*vec3(' + a[0] + ',' + a[1] + ',' + a[2] + ');\n'
        + ' diffuseColor.rgb=mix(diffuseColor.rgb,asph,worn);\n'
        + ' diffuseColor.rgb*=tone;\n}\n');
  };
  mat.customProgramCacheKey = () => 'pav_' + kind;
  return mat;
}

/* ── 大片绿地／砂砾的场地内差异 shader ────────────────────────────────────
   战神广场是一块 28 公顷的多边形、杜乐丽是一块 22 公顷的砂砾，它们各自只有
   一个顶点色能给——顶点色只解决「公园之间不一样」，解决不了「同一个公园里不一样」。
   这一层同样是零三角：几何本来就建在世界坐标里（桶不带变换矩阵），
   顶点着色器里的 position 就是世界坐标，直接拿它取低频噪声。
     · 34m 尺度：地块之间的深浅（背阴处深、开阔处黄）
     · 11m 尺度：同一块里的斑驳
     · 踩秃的路径：低频噪声穿过某个值的那一条窄带，就是一条走出来的近路
   花坛不能跟着变绿地——用顶点色本身判断：暖色（红>绿）的一律不碰。          */
const GND_HASH =
  'float gh(vec2 p){vec3 q=fract(vec3(p.xyx)*0.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}\n' +
  'float gn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);\n' +
  ' return mix(mix(gh(i),gh(i+vec2(1,0)),f.x),mix(gh(i+vec2(0,1)),gh(i+vec2(1,1)),f.x),f.y);}\n';

function groundNoiseShader(mat, opt){
  opt = opt || {};
  const big = (opt.big === undefined ? 0.13 : opt.big).toFixed(3);      // 34m 尺度幅度
  const fine = (opt.fine === undefined ? 0.05 : opt.fine).toFixed(3);   // 11m 尺度幅度
  const path = (opt.path === undefined ? 0.0 : opt.path).toFixed(3);    // 踩秃路径强度
  const green = opt.green ? 1 : 0;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = sh => {
    if (prev) prev(sh);
    sh.vertexShader = 'varying vec3 vGPos;\n'
      + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vGPos=position;');
    sh.fragmentShader = 'varying vec3 vGPos;\n' + GND_HASH
      + sh.fragmentShader.replace('#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\n{\n'
        + ' float n1=gn(vGPos.xz/34.0), n2=gn(vGPos.xz/11.0);\n'
        + ' float k=1.0+(n1-0.5)*2.0*' + big + '+(n2-0.5)*2.0*' + fine + ';\n'
        + (green
            /* 花坛不能跟着绿地变。判据用「绿比红多出多少的**比例**」，不是绝对差——
               diffuseColor 这时已经乘过贴图和顶点色，在线性空间里草绿的 g−r 只有 0.02,
               拿绝对值卡门槛会把草坪自己也挡掉四分之三（第一轮就是这么白做的）。 */
            ? ' float isG=smoothstep(0.02,0.13,(diffuseColor.g-diffuseColor.r)/(diffuseColor.g+diffuseColor.r+1e-4));\n'
              /* 干的地方偏黄绿、湿的地方偏深绿：色相跟着明度一起走，不是单纯调亮暗 */
            + ' vec3 dry=diffuseColor.rgb*vec3(1.11,1.05,0.85);\n'
            + ' vec3 wet=diffuseColor.rgb*vec3(0.89,0.97,0.93);\n'
            + ' vec3 v=mix(wet,dry,smoothstep(0.30,0.72,n1));\n'
            + ' v*=k;\n'
            + (path !== '0.000'
                ? ' float d=abs(n1-0.52);\n'
                + ' float pw=(1.0-smoothstep(0.006,0.024,d))*' + path + ';\n'
                + ' v=mix(v,v*vec3(1.26,1.20,1.02),pw);\n'
                : '')
            + ' diffuseColor.rgb=mix(diffuseColor.rgb,v,isG);\n'
            : ' diffuseColor.rgb*=k;\n')
        + '}\n');
  };
  mat.customProgramCacheKey = () => 'gnd_' + green + big + fine + path;
  return mat;
}

/* 一块草坪的颜色。veg 的贴图是中性灰，颜色整个由顶点色给，所以这里返回的是绝对色
   （不是比值——比值那套只用在「贴图已经烤了基色」的桶上）。三层驱动：
     · 公园之间：批次 = 广场序号，从 PC.families.turf 长尾抽族。
       多数公园抽到第 0 支（标准巴黎草绿），少数整个公园偏黄或偏深。
     · 同园之内：位置哈希做族内明度浮动，同一片草坪没有两块颜色一样的。
     · 少数派：约 12% 的块晒成黄绿（开阔处、踩得多），约 15% 是树荫下的深绿。
   edge（0 中心 → 1 贴边）再压一档：公园的边上站着椴树列，边上的草常年在荫里。 */
const _turf = new THREE.Color(), _turfB = new THREE.Color();
function turfC(pi, x, z, edge){
  const prof = PC.vary.of('tree', x, z, 4000 + pi);
  _turf.set(pickTail(PC.families.turf, bhash(4000 + pi, 157), 2.2));
  _turf.multiplyScalar(1 + (prof.tint - 0.5) * 0.07);          // 族内 ±3.5%
  /* ⚠️ 这几档幅度全部收过一轮，别照着「看起来还不够」再调回去。
     原因是这一项和 MAT.veg 的世界坐标噪声 shader 叠在一起，而两者的读法完全不同：
     shader 的深浅是连续的，读作草地本身的起伏；这里的是**逐块**的，
     而花坛／草坪块是硬边矩形，相邻两块跳 30% 就不再读作「同一片草晒得不匀」，
     读作「这两块铺的不是同一种东西」。
     实测（同一光照下量屏幕像素）：战神广场那种只走 shader 的整块大草坪，
     明度跨度 20%，读起来是草地；卢森堡这种叠了逐块跳变的，跨度 67%，
     读起来是一床拼布被子。所以逐块这一项必须比 shader 那一项弱得多。 */
  const u = prof.f(163);
  if (u > 0.88)      _turf.lerp(_turfB.set(0xa9a163), (u - 0.88) / 0.12 * 0.15);  // 晒黄／踩秃
  else if (u < 0.15) _turf.multiplyScalar(0.945);                                 // 树荫下
  if (edge) _turf.multiplyScalar(1 - 0.06 * clamp(edge, 0, 1));
  return _turf.convertSRGBToLinear();
}

/* ─────────────────────────── 1. 程序化铺装贴图 ───────────────────────────
   一律可平铺。UV 在几何里按「世界米 / 贴图边长米」算，texture.repeat 恒为 1。 */

/* 可平铺磨损：低频 fbm 乘上去，让整片铺装不至于像壁纸 */
function wear(canvas, seed, amt, period){
  if (!makeNoise || !fbmFactory) return;
  const px = canvas.width, g = canvas.getContext('2d');
  const f = fbmFactory(makeNoise(seed, period), 4);
  const img = g.getImageData(0, 0, px, px), d = img.data;
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++){
    const k = 1 + f(x / px * period, y / px * period) * amt, i = (y*px + x) * 4;
    d[i] *= k; d[i+1] *= k; d[i+2] *= k;
  }
  g.putImageData(img, 0, 0);
}

/* 弹石路面 pavé：12–14cm 方石，行间错缝，整行带弧（真实巴黎路面是弧形排的），
   石缝深色。opt.bow 控制弧幅，opt.freq 必须是整数否则左右接不上。 */
function texSetts(px, meters, base, opt){
  opt = opt || {};
  const stone = opt.stone || 0.13;
  let n = Math.round(meters / stone); if (n % 2) n++;      // 偶数行才能上下无缝
  const cell = px / n, c = PC.canvas(px, px), g = c.getContext('2d');
  const rnd = mulberry32(opt.seed || 7);
  const bow = opt.bow === undefined ? 0.20 : opt.bow, freq = opt.freq || 3;
  const joint = opt.joint === undefined ? 0.12 : opt.joint;
  g.fillStyle = css(shade(base, -0.40)); g.fillRect(0, 0, px, px);
  const gap = Math.max(1, cell * joint);
  for (let r = -1; r <= n; r++){
    const off = (((r % 2) + 2) % 2) ? cell * 0.5 : 0;
    for (let q = -1; q <= n; q++){
      const x = q * cell + off;
      const y = r * cell + Math.sin(x / px * Math.PI * 2 * freq) * cell * bow;
      const jit = opt.jitter === undefined ? 0.28 : opt.jitter;
      const k = 1 - jit / 2 + rnd() * jit;
      const tone = shade(base, (k - 1) * 0.55);
      g.fillStyle = css(tone);
      g.fillRect(x + gap * 0.5, y + gap * 0.5, cell - gap, cell - gap);
      /* 石块受光的上棱 */
      g.fillStyle = css(shade(tone, 0.16), 0.55 * (jit / 0.28));
      g.fillRect(x + gap * 0.5, y + gap * 0.5, cell - gap, Math.max(1, cell * 0.12));
    }
  }
  wear(c, (opt.seed || 7) + 91, opt.wear === undefined ? 0.10 : opt.wear, 8);
  return c;
}

/* 孔雀尾扇形铺法 queue de paon —— 巴黎广场的传统铺法，从空中一眼认得出 */
function texFan(px, meters, base){
  const c = PC.canvas(px, px), g = c.getContext('2d');
  const rnd = mulberry32(31);
  /* 底色就是石头本色，不是缝的深色 —— 扇与扇之间盖不满的地方要读成石头，
     第一轮把底色刷成深缝色，协和广场整块就黑了。 */
  g.fillStyle = css(shade(base, -0.10)); g.fillRect(0, 0, px, px);
  const S = px / Math.max(2, Math.round(meters / 1.45));   // 扇心间距 ≈1.45m
  const RY = S * 0.5;                                      // 行距取半个扇距，扇与扇互相压住
  const nS = Math.ceil(px / S) + 1, nJ = Math.ceil(px / RY) + 1;
  const st = px / (meters / 0.13);
  for (let j = -1; j <= nJ; j++) for (let i = -1; i <= nS; i++){
    const cx = i * S + ((j % 2 + 2) % 2 ? S * 0.5 : 0), cy = j * RY;
    for (let r = st * 1.0; r < S * 0.58; r += st * 1.02){
      const nA = Math.max(6, Math.round(Math.PI * r / st));
      for (let a = 0; a < nA; a++){
        const th = Math.PI * (a + 0.5) / nA - Math.PI;   // 上半圈的扇
        const x = cx + Math.cos(th) * r, y = cy - Math.sin(th) * r * 0.94;
        const k = 0.80 + rnd() * 0.40;
        g.save(); g.translate(x, y); g.rotate(-th + Math.PI / 2);
        g.fillStyle = css(shade(base, (k - 1) * 0.55));
        g.fillRect(-st * 0.42, -st * 0.42, st * 0.84, st * 0.84);
        g.restore();
      }
    }
  }
  wear(c, 313, 0.11, 8);
  return c;
}

/* 广场铺装 = 孔雀尾扇形 + 大尺度分格石带。
   为什么要这一层：扇形铺法的花样只有 1.45m 大，从 200m 高一走 mipmap 就平均成一块纯灰
   ——第一轮圣母院前广场、市政厅广场读起来都是「一块没铺东西的板」。真实巴黎广场的
   花岗岩条带把场地切成 6–8m 的大格，那个尺度在空中才看得见，也才是广场的识别特征。
   贴图边长 21m，内部再切 div 格；边界那道带最宽，于是大小两级分格都在。 */
function texPlaza(px, meters, base, opt){
  opt = opt || {};
  const c = texFan(px, meters, base), g = c.getContext('2d');
  const S = px / meters, div = opt.div || 3, cw = px / div;
  /* 石材色差：一格一个批次色（±4%）。整片广场因此不再是一块纯色。 */
  const rnd = mulberry32(opt.seed || 41);
  for (let j = 0; j < div; j++) for (let i = 0; i < div; i++){
    const k = (rnd() - 0.5) * 0.09;
    g.fillStyle = (k >= 0 ? 'rgba(255,255,255,' : 'rgba(0,0,0,') + Math.abs(k * 1.7).toFixed(3) + ')';
    g.fillRect(i * cw, j * cw, cw, cw);
  }
  const bw = (opt.band || 0.78) * S, jw = Math.max(1, 0.14 * S);
  /* 跨过贴图边界的带要在对面补画一次，否则平铺时接缝处只剩半条 */
  const put = (x, y, w, h) => {
    g.fillRect(x, y, w, h);
    if (x < 0) g.fillRect(x + px, y, w, h);
    if (x + w > px) g.fillRect(x - px, y, w, h);
    if (y < 0) g.fillRect(x, y + px, w, h);
    if (y + h > px) g.fillRect(x, y - px, w, h);
  };
  /* 先画两向的深缝再画两向的亮带，交叉口才不会被缝切断 */
  for (const pass of [0, 1]){
    g.fillStyle = pass ? css(C.figMd, 0.82) : css(C.figDk, 0.52);
    for (let i = 0; i < div; i++){
      const p = i * cw, b = bw * (i === 0 ? 1.55 : 1), e = pass ? 0 : jw;
      put(p - b/2 - e, 0, b + e*2, px);
      put(0, p - b/2 - e, px, b + e*2);
    }
  }
  return c;
}

/* 图案层用的中性花岗岩（收边带／中心环／零公里点共用一张）。
   本身近似灰度，颜色由顶点色给——一个 draw call 要同时出亮石、深缝和铜牌。 */
function texSlab(px, meters){
  const c = PC.canvas(px, px), g = c.getContext('2d');
  const rnd = mulberry32(131);
  g.fillStyle = '#efefef'; g.fillRect(0, 0, px, px);
  for (let i = 0; i < px * px * 0.12; i++){
    const x = rnd() * px, y = rnd() * px;
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.16)';
    g.fillRect(x, y, 1 + rnd() * 1.8, 1 + rnd() * 1.8);
  }
  const step = px / meters;                       // 每米一道石材接缝
  g.strokeStyle = 'rgba(0,0,0,.20)'; g.lineWidth = 1.1;
  for (let i = 0; i < meters; i++){
    g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, px); g.stroke();
    g.beginPath(); g.moveTo(0, i * step); g.lineTo(px, i * step); g.stroke();
  }
  wear(c, 251, 0.07, 8);
  return c;
}

/* 城外远景：树林、农田与郊区街区的斑块。近似灰度，冷暖与明度由顶点色分环给。
   城内城外必须是两种材质——共用一张弹石底板，地平线就读成「无边无际的巴黎」。 */
function texOuter(px, meters){
  const c = PC.canvas(px, px), g = c.getContext('2d');
  const rnd = mulberry32(283);
  g.fillStyle = '#b6b6b6'; g.fillRect(0, 0, px, px);
  /* 斑块要在四个方向各补画一次，否则 256m 一格的接缝会在地平线上排成网格 */
  const blob = (x, y, rx, ry, rot, fill) => {
    g.fillStyle = fill;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){
      g.save(); g.translate(x + dx * px, y + dy * px); g.rotate(rot);
      g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); g.fill(); g.restore();
    }
  };
  /* 斑块要小、要淡：郊野环有时会紧挨着城市边缘（共和国广场就在城市包络线上），
     大而黑的椭圆在那个距离上会读成贴图的花纹而不是林地。 */
  for (let i = 0; i < 120; i++)                    // 林地：暗斑
    blob(rnd() * px, rnd() * px, px * (0.012 + rnd() * 0.030), px * (0.010 + rnd() * 0.024),
         rnd() * Math.PI, 'rgba(26,36,22,.17)');
  for (let i = 0; i < 90; i++)                     // 农田／空地：亮斑
    blob(rnd() * px, rnd() * px, px * (0.012 + rnd() * 0.034), px * (0.008 + rnd() * 0.022),
         rnd() * Math.PI, 'rgba(228,222,192,.10)');
  /* 郊区街区：细碎的浅色小块，只在小尺度上出现，远看只是噪点 */
  for (let i = 0; i < 1400; i++){
    const x = rnd() * px, y = rnd() * px, s = 1.2 + rnd() * 3;
    g.fillStyle = rnd() < 0.5 ? 'rgba(215,210,198,.16)' : 'rgba(30,34,30,.16)';
    g.fillRect(x, y, s, s * (0.6 + rnd()));
  }
  wear(c, 331, 0.10, 7);
  return c;
}

/* 辐射铺装 medallion（星形广场／协和广场／特罗卡德罗广场）：
   底子是弹石，上面压放射条带与同心环，向外淡出，最外一道花岗岩石缘收边。

   ⚠️ 图案只占画布的内切圆，几何也只铺一张同心圆盘（见 medallionR）。
   第一轮是按广场的外接半径贴满整块多边形，协和广场是个 360×210 的矩形，
   同心圆在四条直边上被齐齐切断，读起来像贴错了的贴图而不是广场。 */
function texRadial(px, settCanvas){
  const c = PC.canvas(px, px), g = c.getContext('2d');
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++)
    g.drawImage(settCanvas, i * px / 8, j * px / 8, px / 8, px / 8);
  const R = px / 2, cx = R, cy = R;
  /* 放射条带与同心环画在独立图层上，再用径向渐变把外缘擦掉——
     圆盘的边界因此不是一条硬边，而是渐渐化回普通铺石。 */
  const ov = PC.canvas(px, px), o = ov.getContext('2d');
  const rays = 48;
  for (let i = 0; i < rays; i++){
    const a0 = i / rays * Math.PI * 2, a1 = (i + 0.5) / rays * Math.PI * 2;
    o.beginPath(); o.moveTo(cx, cy);
    o.arc(cx, cy, R, a0, a1); o.closePath();
    o.fillStyle = i % 2 ? 'rgba(0,0,0,.075)' : 'rgba(255,255,255,.075)';
    o.fill();
  }
  o.strokeStyle = css(shade(C.sett, -0.42), 0.75);
  o.lineWidth = px * 0.006;
  for (const f of [0.16, 0.30, 0.46, 0.62, 0.78]){
    o.beginPath(); o.arc(cx, cy, R * f, 0, Math.PI * 2); o.stroke();
  }
  const grd = o.createRadialGradient(cx, cy, R * 0.80, cx, cy, R * 0.955);
  grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  o.globalCompositeOperation = 'destination-in';
  o.fillStyle = grd; o.fillRect(0, 0, px, px);
  o.globalCompositeOperation = 'source-over';
  g.drawImage(ov, 0, 0);
  /* 花岗岩石缘：一条亮石带夹在两道深缝里。圆盘几何的边界正好落在这儿，
     和外围孔雀尾铺装换花样的那条线重合，读起来是有意做的圈边不是接缝。 */
  g.lineWidth = px * 0.019; g.strokeStyle = css(shade(C.sett, 0.07));
  g.beginPath(); g.arc(cx, cy, R * 0.972, 0, Math.PI * 2); g.stroke();
  g.lineWidth = px * 0.005; g.strokeStyle = css(shade(C.sett, -0.45), 0.9);
  for (const f of [0.954, 0.990]){
    g.beginPath(); g.arc(cx, cy, R * f, 0, Math.PI * 2); g.stroke();
  }
  /* 中心圆盘（方尖碑/凯旋门的基座台地） */
  g.beginPath(); g.arc(cx, cy, R * 0.11, 0, Math.PI * 2);
  g.fillStyle = css(shade(C.sett, 0.10)); g.fill();
  g.lineWidth = px * 0.008; g.strokeStyle = css(shade(C.sett, -0.45)); g.stroke();
  return c;
}

/* medallion 的半径 = 广场的内切半径（中心到各条边的最短距离），不是外接半径。
   用外接半径，同心圆必然跑出广场被直边硬裁；用内切半径，圆盘整个躺在广场里，
   矩形广场读作「一块方场中间嵌了一枚圆形铺装徽章」——协和广场本来就是这样。 */
function medallionR(pl){
  const c = pl.center, p = pl.poly, n = p.length;
  if (n < 3 || !PC.poly.contains(p, c[0], c[1])) return 0;
  let rin = Infinity;
  for (let i = 0; i < n; i++){
    const a = p[i], b = p[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx*dx + dz*dz || 1;
    let t = ((c[0]-a[0])*dx + (c[1]-a[1])*dz) / L2; t = t < 0 ? 0 : (t > 1 ? 1 : t);
    rin = Math.min(rin, Math.hypot(c[0] - (a[0] + dx*t), c[1] - (a[1] + dz*t)));
  }
  /* 凹多边形的内切半径靠边距估不准，抽 24 个点验一遍真的都在里面 */
  let R = rin * 0.96;
  for (let k = 0; k < 3; k++){
    let ok = true;
    for (let i = 0; i < 24 && ok; i++){
      const a = i / 24 * Math.PI * 2;
      if (!PC.poly.contains(p, c[0] + Math.cos(a)*R, c[1] + Math.sin(a)*R)) ok = false;
    }
    if (ok) return R;
    R *= 0.85;
  }
  return 0;
}

/* 广场的自身坐标系：长轴 ex、短轴 ez、两向净尺寸 W/D。
   铺装的分格必须跟着广场自己的轴走，不是跟着世界坐标轴——旺多姆是斜的，
   用世界轴分格会让石带斜切过整块广场。 */
function frame(pl){
  const c = pl.center;
  let sxx = 0, sxz = 0, szz = 0;
  for (const q of pl.poly){ const dx = q[0]-c[0], dz = q[1]-c[1];
    sxx += dx*dx; sxz += dx*dz; szz += dz*dz; }
  const th = 0.5 * Math.atan2(2*sxz, sxx - szz);
  const ex = [Math.cos(th), Math.sin(th)], ez = [-Math.sin(th), Math.cos(th)];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const q of pl.poly){
    const du = (q[0]-c[0])*ex[0] + (q[1]-c[1])*ex[1];
    const dv = (q[0]-c[0])*ez[0] + (q[1]-c[1])*ez[1];
    u0 = Math.min(u0, du); u1 = Math.max(u1, du); v0 = Math.min(v0, dv); v1 = Math.max(v1, dv);
  }
  return {c, ex, ez, u0, u1, v0, v1, W: u1-u0, D: v1-v0,
          to: (u, v) => [c[0] + ex[0]*u + ez[0]*v, c[1] + ex[1]*u + ez[1]*v]};
}

/* 沿一条中心线铺一条宽 w 的石带；给了 clip 就只在多边形里的那些段出面。
   广场上所有的收边、同心环、放射线、中轴带都是这一个函数画出来的。 */
function ribbon(buck, clip, pts, w, yAt, col, closed){
  if (pts.length < 2) return;
  /* 要裁剪就先加密：裁剪是逐段按中点判的，一条 200m 的整段要么整条进要么整条丢，
     凹广场上那条边就会整根伸到广场外面去。 */
  if (clip){
    const d = [];
    const m = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < m; i++){
      const a = pts[i], b = pts[(i+1) % pts.length];
      const k = Math.max(1, Math.ceil(Math.hypot(b[0]-a[0], b[1]-a[1]) / 4));
      for (let t = 0; t < k; t++)
        d.push([a[0] + (b[0]-a[0])*t/k, a[1] + (b[1]-a[1])*t/k]);
    }
    if (!closed) d.push(pts[pts.length-1]);
    pts = d;
  }
  const n = pts.length; if (n < 2) return;
  const L = [], R = [], h = w / 2;
  for (let i = 0; i < n; i++){
    const a = pts[closed ? (i-1+n)%n : Math.max(0, i-1)];
    const b = pts[closed ? (i+1)%n : Math.min(n-1, i+1)];
    let dx = b[0]-a[0], dz = b[1]-a[1];
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    L.push([pts[i][0] + dz*h, pts[i][1] - dx*h]);
    R.push([pts[i][0] - dz*h, pts[i][1] + dx*h]);
  }
  const m = closed ? n : n - 1;
  let u = 0;
  for (let i = 0; i < m; i++){
    const j = (i+1) % n;
    const seg = Math.hypot(pts[j][0]-pts[i][0], pts[j][1]-pts[i][1]);
    const mx = (pts[i][0]+pts[j][0])/2, mz = (pts[i][1]+pts[j][1])/2;
    if (seg < 0.05){ continue; }
    if (!clip || PC.poly.contains(clip, mx, mz)){
      const Y = q => yAt(q[0], q[1]);
      buck.quad([L[i][0], Y(L[i]), L[i][1]], [L[j][0], Y(L[j]), L[j][1]],
                [R[j][0], Y(R[j]), R[j][1]], [R[i][0], Y(R[i]), R[i][1]],
                [[u,0], [u+seg/1.5, 0], [u+seg/1.5, w/1.5], [u, w/1.5]], [0,1,0], col);
    }
    u += seg / 1.5;
  }
}
const circlePts = (cx, cz, r, n) => {
  const o = [];
  for (let i = 0; i < n; i++){ const a = i/n * Math.PI * 2;
    o.push([cx + Math.cos(a)*r, cz + Math.sin(a)*r]); }
  return o;
};

/* 沥青人行道：细骨料 + 每 1m 一道浅缝（巴黎人行道是沥青不是石板，但有伸缩缝） */
function texWalk(px, meters, base){
  const c = PC.canvas(px, px), g = c.getContext('2d');
  g.fillStyle = css(base); g.fillRect(0, 0, px, px);
  const rnd = mulberry32(53);
  for (let i = 0; i < px * px * 0.16; i++){
    const x = rnd() * px, y = rnd() * px, s = 0.7 + rnd() * 1.7;
    g.fillStyle = css(shade(base, (rnd() - 0.5) * 0.55), 0.6);
    g.fillRect(x, y, s, s);
  }
  const step = px / meters;
  g.strokeStyle = css(shade(base, -0.30), 0.5); g.lineWidth = 1.2;
  for (let i = 0; i < meters; i++){
    g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, px); g.stroke();
    g.beginPath(); g.moveTo(0, i * step); g.lineTo(px, i * step); g.stroke();
  }
  wear(c, 77, 0.09, 8);
  return c;
}

/* 花岗岩路缘石：1m 一段，接缝深色 */
function texCurb(px, meters, base){
  const c = PC.canvas(px, px), g = c.getContext('2d');
  const rnd = mulberry32(19);
  g.fillStyle = css(base); g.fillRect(0, 0, px, px);
  for (let i = 0; i < px * px * 0.10; i++){
    const x = rnd() * px, y = rnd() * px;
    g.fillStyle = css(shade(base, (rnd() - 0.5) * 0.4), 0.5);
    g.fillRect(x, y, 1.4, 1.4);
  }
  const step = px / meters;
  g.fillStyle = css(shade(base, -0.45), 0.85);
  for (let i = 0; i < meters; i++) g.fillRect(i * step, 0, 1.6, px);
  wear(c, 121, 0.07, 8);
  return c;
}

/* 内院：大石板 + 缝里的碎石 */
function texCourt(px, meters, base){
  const c = PC.canvas(px, px), g = c.getContext('2d');
  const rnd = mulberry32(67);
  g.fillStyle = css(shade(base, -0.26)); g.fillRect(0, 0, px, px);
  const n = Math.max(2, Math.round(meters / 0.85)), cell = px / n;
  for (let r = 0; r < n; r++) for (let q = 0; q < n; q++){
    const k = 0.90 + rnd() * 0.20;
    g.fillStyle = css(shade(base, (k - 1) * 0.6));
    g.fillRect(q * cell + 1, r * cell + 1, cell - 2, cell - 2);
  }
  for (let i = 0; i < px * px * 0.06; i++){
    const x = rnd() * px, y = rnd() * px;
    g.fillStyle = css(shade(base, (rnd() - 0.5) * 0.5), 0.45);
    g.fillRect(x, y, 1.6, 1.6);
  }
  wear(c, 211, 0.12, 8);
  return c;
}

/* 砂砾／砂土步道（杜乐丽、卢森堡、香榭丽舍方园） */
function texSand(px, meters, base){
  const c = PC.canvas(px, px), g = c.getContext('2d');
  g.fillStyle = css(base); g.fillRect(0, 0, px, px);
  const rnd = mulberry32(89);
  for (let i = 0; i < px * px * 0.30; i++){
    const x = rnd() * px, y = rnd() * px, s = 0.8 + rnd() * 1.6;
    g.fillStyle = css(shade(base, (rnd() - 0.5) * 0.42), 0.55);
    g.fillRect(x, y, s, s);
  }
  wear(c, 149, 0.13, 8);
  return c;
}

/* 植被贴图：做成近似灰度，真正的颜色由顶点色给（草坪／绿篱／花坛共用一张） */
function texVeg(px, meters){
  const c = PC.canvas(px, px), g = c.getContext('2d');
  g.fillStyle = '#bdbdbd'; g.fillRect(0, 0, px, px);
  const rnd = mulberry32(97);
  /* 割草条纹：4m 一条，深浅交替 */
  const band = px / Math.max(1, Math.round(meters / 4));
  for (let i = 0; i < px / band; i++){
    g.fillStyle = i % 2 ? 'rgba(255,255,255,.055)' : 'rgba(0,0,0,.04)';
    g.fillRect(0, i * band, px, band);
  }
  for (let i = 0; i < px * px * 0.22; i++){
    const x = rnd() * px, y = rnd() * px;
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.14)';
    g.fillRect(x, y, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  wear(c, 173, 0.10, 8);
  return c;
}

/* ─────────────────────────── 2. 几何桶 ───────────────────────────
   同材质的面片全部堆进一个桶，最后合成一个 BufferGeometry = 一个 draw call。
   逐块 new BufferGeometry 再 PC.merge 会造上万个临时对象，这里直接写平数组。 */
function Buck(useColor, usePav){
  this.P = []; this.N = []; this.U = []; this.I = []; this.C = useColor ? [] : null;
  /* aPav：给铺装 shader 用的逐顶点四元组 (横过路面的归一位置, 沿路米数, 路段种子, 半宽米)。
     这一层是合并的静态几何，加不了实例属性；补丁与车辙比一个四边形还小，
     只能在片元里画，而片元要知道自己站在路面的哪个位置。 */
  this.A = usePav ? [] : null; this.v = 0;
}
Buck.prototype.vtx = function(x, y, z, nx, ny, nz, u, v, col, pav){
  this.P.push(x, y, z); this.N.push(nx, ny, nz); this.U.push(u, v);
  if (this.C){ const c = col || WHITE; this.C.push(c.r, c.g, c.b); }
  if (this.A){ const a = pav || ZERO4; this.A.push(a[0], a[1], a[2], a[3]); }
  return this.v++;
};
/* a,b,c,d 为 [x,y,z]，uv 为四组 [u,v]；want 是期望法线，绕序不对就自动翻面。
   —— 上万个四边形靠脑子推绕序必错，交给叉乘判一次，代价可以忽略。 */
Buck.prototype.quad = function(a, b, c, d, uv, want, col, pav){
  let nx = (b[1]-a[1])*(c[2]-a[2]) - (b[2]-a[2])*(c[1]-a[1]);
  let ny = (b[2]-a[2])*(c[0]-a[0]) - (b[0]-a[0])*(c[2]-a[2]);
  let nz = (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
  const L = Math.hypot(nx, ny, nz); if (L < 1e-9) return;
  nx /= L; ny /= L; nz /= L;
  let A = a, B = b, D = c, E = d, U = uv, V = pav;
  if (want && (nx*want[0] + ny*want[1] + nz*want[2]) < 0){
    nx = -nx; ny = -ny; nz = -nz;
    A = d; B = c; D = b; E = a; U = [uv[3], uv[2], uv[1], uv[0]];
    /* aPav 是逐顶点的，翻面重排顶点就必须跟着重排，否则「路面横向位置」会左右颠倒 */
    if (pav) V = [pav[3], pav[2], pav[1], pav[0]];
  }
  const i = this.v;
  this.vtx(A[0],A[1],A[2], nx,ny,nz, U[0][0],U[0][1], col, V && V[0]);
  this.vtx(B[0],B[1],B[2], nx,ny,nz, U[1][0],U[1][1], col, V && V[1]);
  this.vtx(D[0],D[1],D[2], nx,ny,nz, U[2][0],U[2][1], col, V && V[2]);
  this.vtx(E[0],E[1],E[2], nx,ny,nz, U[3][0],U[3][1], col, V && V[3]);
  this.I.push(i, i+1, i+2, i, i+2, i+3);
};
/* 把一份已经建好的 BufferGeometry 并进来（ShapeGeometry 铺面走这条） */
Buck.prototype.addGeo = function(g, col, pav){
  const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
  const base = this.v, cnt = p.count;
  for (let i = 0; i < cnt; i++)
    this.vtx(p.getX(i), p.getY(i), p.getZ(i),
             n ? n.getX(i) : 0, n ? n.getY(i) : 1, n ? n.getZ(i) : 0,
             u ? u.getX(i) : 0, u ? u.getY(i) : 0, col, pav);
  const idx = g.index;
  if (idx) for (let i = 0; i < idx.count; i++) this.I.push(idx.getX(i) + base);
  else for (let i = 0; i < cnt; i++) this.I.push(i + base);
  g.dispose();
};
Buck.prototype.tris = function(){ return this.I.length / 3; };
Buck.prototype.mesh = function(mat, name){
  if (!this.v) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
  g.setAttribute('normal',   new THREE.Float32BufferAttribute(this.N, 3));
  g.setAttribute('uv',       new THREE.Float32BufferAttribute(this.U, 2));
  if (this.C) g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
  if (this.A) g.setAttribute('aPav',  new THREE.Float32BufferAttribute(this.A, 4));
  g.setIndex(this.v > 65535 ? new THREE.Uint32BufferAttribute(this.I, 1)
                            : new THREE.Uint16BufferAttribute(this.I, 1));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.name = name; m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false;
  return m;
};
let WHITE = null;

/* 水平面填充：多边形（可带洞）→ 朝上的面片。
   ⚠️ ShapeGeometry 的 y 在 rotateX(−90°) 后会变成 −z，所以喂进去的必须是 (x, −z)，
      否则整块地面沿南北镜像。PC.poly.flat 没做这一步，这里自己来。 */
function fillPoly(poly, holes, yAt, uvAt){
  const V2 = p => new THREE.Vector2(p[0], -p[1]);
  const sh = new THREE.Shape(poly.map(V2));
  if (holes) for (const h of holes) sh.holes.push(new THREE.Path(h.map(V2)));
  const g = new THREE.ShapeGeometry(sh);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++){
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, yAt(x, z));
    const t = uvAt(x, z); uv.setXY(i, t[0], t[1]);
  }
  /* 绕序保证朝上 */
  const idx = g.index;
  if (idx){
    const a = idx.getX(0), b = idx.getX(1), c = idx.getX(2);
    const ax = pos.getX(a), az = pos.getZ(a);
    const cr = (pos.getX(b)-ax) * (pos.getZ(c)-az) - (pos.getZ(b)-az) * (pos.getX(c)-ax);
    if (cr > 0){ const arr = idx.array;
      for (let i = 0; i < arr.length; i += 3){ const t = arr[i+1]; arr[i+1] = arr[i+2]; arr[i+2] = t; } }
  }
  g.computeVertexNormals();
  return g;
}

/* ─────────────────────────── 3. 模块 ─────────────────────────── */
let ROOT = null, STATS = null;

PC.mod('terrain', {
  order: 10,
  label: '地面',

  async build(ctx){
    const {THREE: T, scene, plan, step, raf} = ctx;
    if (!plan) throw new Error('PC.plan 缺失，terrain 无法定位任何东西');
    WHITE = new T.Color(1, 1, 1);
    const SC = h => new T.Color(h).convertSRGBToLinear();
    const VC = h => new T.Color(h).convertSRGBToLinear();     // 顶点色也要线性
    const Y = PC.Y, tY = plan.terrainY || (() => 0);

    ROOT = new T.Group(); ROOT.name = 'city-terrain'; scene.add(ROOT);

    /* ── 3.1 贴图与材质 ── */
    step && step(2, '地面 · 烤铺装贴图'); await raf();

    const cSett   = texSetts(512, 3.2, C.pave, {seed: 7,  bow: 0.30, stone: 0.13});
    const cSettLt = texSetts(512, 3.2, C.sett, {seed: 23, bow: 0.10, stone: 0.13});
    const TX = {
      /* 底板贴图刻意做钝：它是「没铺到的地方」的兜底，不是主角。
         第一轮 6.4m/高对比度的版本在斜视角下起了明显摩尔纹（截图右下角一片斜纹）。 */
      ground: PC.cachedTex('terr.ground', () => texSetts(512, 12.8, C.ground,
                            {seed: 11, bow: 0.08, stone: 0.30, joint: 0.07,
                             jitter: 0.14, wear: 0.16}), {srgb: true}),
      pave:   PC.cachedTex('terr.pave',   () => cSett, {srgb: true}),
      plaza:  PC.cachedTex('terr.plaza',  () => texPlaza(1024, 21, C.sett, {div: 3}), {srgb: true}),
      slab:   PC.cachedTex('terr.slab',   () => texSlab(256, 4), {srgb: true}),
      outer:  PC.cachedTex('terr.outer',  () => texOuter(512, 256), {srgb: true}),
      radial: PC.cachedTex('terr.radial', () => texRadial(1024, cSettLt), {srgb: true, clamp: true}),
      walk:   PC.cachedTex('terr.walk',   () => texWalk(512, 4, C.walk), {srgb: true}),
      curb:   PC.cachedTex('terr.curb',   () => texCurb(256, 2, C.curb), {srgb: true}),
      court:  PC.cachedTex('terr.court',  () => texCourt(512, 4.4, C.court), {srgb: true}),
      sand:   PC.cachedTex('terr.sand',   () => texSand(512, 4, C.sand), {srgb: true}),
      veg:    PC.cachedTex('terr.veg',    () => texVeg(512, 8), {srgb: true})
    };
    /* polygonOffset 是这一层唯一能治 z-fighting 的手段：
       相机在 2600m 高时深度缓冲的分辨率已经接近 1m，靠 0.02m 的抬高完全不管用。
       数值越负越「靠前」。铺装的上下关系全靠这张表，不靠高差。 */
    const std = (o, off) => {
      const m = new T.MeshStandardMaterial(o);
      m.polygonOffset = true; m.polygonOffsetFactor = off; m.polygonOffsetUnits = off * 2;
      return m;
    };
    const MAT = {
      ground: std({map: TX.ground, color: SC(0xffffff), roughness: .97, metalness: 0, envMapIntensity: .40},  3),
      bed:    std({map: TX.sand,   color: SC(C.bed),   roughness: .95, metalness: 0, envMapIntensity: .30},  2),
      /* 车行道：顶点色给「这一段是哪一批石头」，shader 给车辙与修补块 */
      road:   std({map: TX.pave,   color: SC(0xffffff), roughness: .93, metalness: 0, envMapIntensity: .45,
                   vertexColors: true},  1),
      court:  std({map: TX.court,  color: SC(0xffffff), roughness: .96, metalness: 0, envMapIntensity: .40,
                   vertexColors: true},  0),
      sett:   std({map: TX.plaza,  color: SC(0xffffff), roughness: .90, metalness: 0, envMapIntensity: .50,
                   vertexColors: true}, -1),
      /* 城外远景环：更暗更绿、没有弹石纹理，让城市边界之外读成「城外」 */
      outer:  std({map: TX.outer,  color: SC(0xffffff), roughness: .99, metalness: 0, envMapIntensity: .30,
                   vertexColors: true}, 2.5),
      /* 广场图案层：收边／分格／中心环／零公里点，全城一个 draw call */
      figure: std({map: TX.slab,   color: SC(0xffffff), roughness: .84, metalness: .04,
                   envMapIntensity: .60, vertexColors: true}, -6),
      /* 圆盘要压在同一块广场的扇形铺装上，offset 必须比 sett 更靠前 */
      radial: std({map: TX.radial, color: SC(0xffffff), roughness: .90, metalness: 0, envMapIntensity: .50,
                   vertexColors: true}, -2),
      /* 水面兜底：只在 water.js 没上场时出现（见 3.4） */
      river:  std({color: SC(P.waterDeep), roughness: .22, metalness: .10, envMapIntensity: 1.25}, -3),
      sand:   std({map: TX.sand,   color: SC(0xffffff), roughness: .98, metalness: 0, envMapIntensity: .42,
                   vertexColors: true}, -1),
      veg:    std({map: TX.veg,    color: SC(0xffffff), roughness: .98, metalness: 0, envMapIntensity: .38,
                   vertexColors: true}, -2),
      pool:   std({color: SC(C.pool), roughness: .10, metalness: .05, envMapIntensity: 1.3}, -3),
      walk:   std({map: TX.walk,   color: SC(0xffffff), roughness: .95, metalness: 0, envMapIntensity: .42,
                   vertexColors: true}, -3),
      curb:   std({map: TX.curb,   color: SC(0xffffff), roughness: .88, metalness: 0, envMapIntensity: .55,
                   vertexColors: true}, -4)
    };
    /* 片元级差异：零三角、零 draw call，只多三个 program。
       补丁与车辙比一个四边形还小，顶点色够不着；大片草坪与砂砾只有一个顶点色可给，
       场地内部的深浅也只能在片元里长出来。 */
    pavementShader(MAT.road, 'road', [0.074, 0.071, 0.067]);   // C.pave 的线性均值再压一档
    pavementShader(MAT.walk, 'walk', [0.096, 0.090, 0.080]);   // C.walk 的线性均值再压一档
    groundNoiseShader(MAT.veg,  {big: .105, fine: .045, path: .30, green: true});
    groundNoiseShader(MAT.sand, {big: .075, fine: .035});
    /* 底板是「没铺到的地方」的兜底，本来不该抢戏——但它在卢浮宫西侧那种
       plan 没给出场地的空当上是整屏最大的一块面，一点起伏都没有就读成一张纸。
       给的幅度只有绿地的一半，够打破均质，不至于让它变成主角。 */
    groundNoiseShader(MAT.ground, {big: .060, fine: .030});

    const B = {
      ground: new Buck(), bed: new Buck(), road: new Buck(true, true), court: new Buck(true),
      sett: new Buck(true), radial: new Buck(true), sand: new Buck(true), veg: new Buck(true),
      pool: new Buck(), walk: new Buck(true, true), curb: new Buck(true), river: new Buck(),
      outer: new Buck(true), figure: new Buck(true)
    };

    /* ── 3.2 河道断面：算出两岸岸线 ──
       plan 的 bankL/bankR 就是切街廓时用的那条岸线，地面的洞照着它挖，
       街廓边缘与河岸之间才不会出现缝或重叠。 */
    step && step(8, '地面 · 开挖塞纳河河道'); await raf();
    const R = plan.river, NR = R.pts.length;
    const nrm = new Array(NR);
    for (let i = 0; i < NR; i++){
      const a = R.pts[Math.max(0, i-1)], b = R.pts[Math.min(NR-1, i+1)];
      const dx = b[0]-a[0], dz = b[1]-a[1], L = Math.hypot(dx, dz) || 1;
      nrm[i] = [-dz/L, dx/L];                       // 左法线：+1 侧＝左岸（南）
    }
    const bank = (i, s) => {                        // s=+1 左岸，−1 右岸
      const o = s > 0 ? R.bankL[i] : R.bankR[i];
      return [R.pts[i][0] + nrm[i][0]*o, R.pts[i][1] + nrm[i][1]*o];
    };
    const bankL = [], bankR = [];
    for (let i = 0; i < NR; i++){ bankL.push(bank(i, 1)); bankR.push(bank(i, -1)); }

    /* 河道洞：左岸顺流 + 右岸逆流，闭合成一条简单多边形（已验证两条岸线各自不自交） */
    const hole = bankL.concat(bankR.slice().reverse());

    /* ── 3.3 地面底板 ──
       整块地面就是「大矩形挖掉河道」。第一版按 512m tile 切过，
       但 tile 与河岸求交要做多边形裁剪，边缘会留 32m 锯齿；
       统一成一块反而三角更少（≈600）、draw call 更少，也没有锯齿。 */
    const BX = plan.bbox;
    const RECT = [[BX[0]-1700, BX[1]-1700], [BX[2]+1600, BX[1]-1700],
                  [BX[2]+1600, BX[3]+1700], [BX[0]-1700, BX[3]+1700]];
    const gUV = (x, z) => [x / 6.4, z / 6.4];
    B.ground.addGeo(fillPoly(RECT, [hole], () => 0, gUV));

    /* ── 城外远景环 ──
       第一轮这里和城内共用同一块底板材质，于是地平线一直到 ±11km 都是弹石铺装，
       整张图读成「无边无际的巴黎」。现在单开一个郊野材质：更暗、更绿、没有弹石纹理，
       并且按环由近及远换顶点色，城市边界不是一条硬边而是渐渐化进林地。

       内边界不能用 plan.boundary（那是二分用的凸包，比真正长了房子的范围大出近一公里），
       也不能用建成区的凸包——城市轮廓是凹的，凸包会在东南角留下六七百米宽的空灰底板。
       改成极坐标包络：绕城心分 192 个角度扇区，取每个扇区里最外的一个建成点，
       max 滤波保证包住、再平滑掉尖刺，最后整体外推 200m。星形多边形按半径往外推
       就是一圈圈同心环，永远不会自交。河道点必须一起参与，否则塞纳河西端伸出城外
       的那一截会被郊野板盖住，河会在城外凭空断掉。 */
    {
      const CB = [(BX[0]+BX[2])/2, (BX[1]+BX[3])/2];
      const NB = 192, RB = new Float64Array(NB);
      const push = (x, z) => {
        let i = Math.floor((Math.atan2(z - CB[1], x - CB[0]) + Math.PI) / (Math.PI*2) * NB);
        i = ((i % NB) + NB) % NB;
        const r = Math.hypot(x - CB[0], z - CB[1]);
        if (r > RB[i]) RB[i] = r;
      };
      for (const q of hole) push(q[0], q[1]);
      for (const b of plan.blocks){
        push(b.bb[0], b.bb[1]); push(b.bb[2], b.bb[1]);
        push(b.bb[2], b.bb[3]); push(b.bb[0], b.bb[3]);
      }
      for (const pl of plan.places) for (const q of pl.poly) push(q[0], q[1]);
      for (const lm of (plan.landmarks || [])) for (const q of lm.poly) push(q[0], q[1]);
      const RM = new Float64Array(NB), RS = new Float64Array(NB);
      for (let i = 0; i < NB; i++){
        let m = 0;
        for (let k = -4; k <= 4; k++) m = Math.max(m, RB[(i+k+NB) % NB]);
        RM[i] = m;
      }
      for (let i = 0; i < NB; i++){
        let a = 0;
        for (let k = -3; k <= 3; k++) a += RM[(i+k+NB) % NB];
        RS[i] = Math.max(a/7, RM[i] * 0.985) + 200;
      }
      const at = d => {
        const o = [];
        for (let i = 0; i < NB; i++){
          const a = i / NB * Math.PI*2 - Math.PI;
          o.push([CB[0] + Math.cos(a) * (RS[i] + d), CB[1] + Math.sin(a) * (RS[i] + d)]);
        }
        return o;
      };
      const rings = [0, 380, 1050, 2700, 6400, 16000];
      const cols  = [C.subNear, C.subNear, C.subMid, C.subMid, C.subFar, C.subFar];
      const lay = rings.map(at);
      const oUV = (x, z) => [x / 256, z / 256];
      const yO = 0.06;
      for (let k = 0; k + 1 < lay.length; k++){
        const a = lay[k], b = lay[k+1], col = VC(cols[k+1]);
        for (let i = 0; i < a.length; i++){
          const j = (i+1) % a.length;
          B.outer.quad([a[i][0], yO, a[i][1]], [a[j][0], yO, a[j][1]],
                       [b[j][0], yO, b[j][1]], [b[i][0], yO, b[i][1]],
                       [oUV(a[i][0],a[i][1]), oUV(a[j][0],a[j][1]),
                        oUV(b[j][0],b[j][1]), oUV(b[i][0],b[i][1])], [0,1,0], col);
        }
      }
    }

    /* 岛：地面的洞是「岸到岸」，两座岛在洞里，是陆地，补回来 */
    for (const il of plan.islands) B.ground.addGeo(fillPoly(il.poly, null, () => 0, gUV));

    /* ── 3.4 河床 + 下层河岸 berge ── */
    step && step(14, '地面 · 河床与下层河岸'); await raf();
    {
      /* 河床：−9.2m，中间再低 0.5m。水面在 −8.6，所以永远在水下。 */
      const bedY = (t) => Y.water - 0.6 - 0.5 * Math.sin(Math.PI * clamp(t, 0, 1));
      const bUV = (x, z) => [x / 8, z / 8];
      for (let i = 0; i < NR - 1; i++){
        const l0 = bankL[i], l1 = bankL[i+1], r0 = bankR[i], r1 = bankR[i+1];
        B.bed.quad([l0[0], bedY(0), l0[1]], [l1[0], bedY(0), l1[1]],
                   [r1[0], bedY(0), r1[1]], [r0[0], bedY(0), r0[1]],
                   [bUV(l0[0],l0[1]), bUV(l1[0],l1[1]), bUV(r1[0],r1[1]), bUV(r0[0],r0[1])], [0,1,0]);
      }

      /* 水面兜底：water.js 在册时这一层不出，一个三角都不加。
         只在单模块自校验台（?m=terrain）里补上——否则河道里只剩 −9.2m 的河床，
         整条河在堤墙的阴影里读作一块纯黑，看起来像地面层自己漏了个洞。 */
      if (!PC.has('water')){
        const wy = Y.water;
        for (let i = 0; i < NR - 1; i++){
          const l0 = bankL[i], l1 = bankL[i+1], r0 = bankR[i], r1 = bankR[i+1];
          B.river.quad([l0[0], wy, l0[1]], [l1[0], wy, l1[1]],
                       [r1[0], wy, r1[1]], [r0[0], wy, r0[1]],
                       [[0,0],[1,0],[1,1],[0,1]], [0,1,0]);
        }
      }

      /* berge：有下层步道的那些码头，在 −6.6 出一条 4–8m 宽的步道。
         挡墙（0 → −6.6）归 water.js，这里只出步道本身和它临水的一道 2m 边坎。 */
      const segs = {1: [], '-1': []};
      for (const q of plan.quays){
        if (!q.sideN || !q.hasBerge) continue;
        for (let i = 0; i < q.pts.length - 1; i++)
          segs[q.sideN].push([q.pts[i], q.pts[i+1], clamp(q.bergeW, 4, 8)]);
      }
      function nearBerge(list, x, z){
        let bd = Infinity, bw = 0;
        for (const s of list){
          const ax = s[0][0], az = s[0][1], dx = s[1][0]-ax, dz = s[1][1]-az;
          const L2 = dx*dx + dz*dz || 1;
          let t = ((x-ax)*dx + (z-az)*dz) / L2; t = t < 0 ? 0 : (t > 1 ? 1 : t);
          const px = ax + dx*t, pz = az + dz*t, d = (x-px)*(x-px) + (z-pz)*(z-pz);
          if (d < bd){ bd = d; bw = s[2]; }
        }
        return bd < 120*120 ? bw : 0;
      }
      for (const s of [1, -1]){
        const list = segs[s]; if (!list.length) continue;
        const line = s > 0 ? bankL : bankR;
        const w = new Float64Array(NR);
        for (let i = 0; i < NR; i++) w[i] = nearBerge(list, line[i][0], line[i][1]);
        /* 平滑，避免相邻站点宽度跳变出锯齿；<3m 视为没有 berge */
        const ws = new Float64Array(NR);
        for (let i = 0; i < NR; i++){
          let a = 0, n = 0;
          for (let k = -2; k <= 2; k++){ const j = i+k; if (j < 0 || j >= NR) continue; a += w[j]; n++; }
          ws[i] = a / n < 3 ? 0 : a / n;
        }
        const inward = s > 0 ? -1 : 1;               // 从岸线走向水面的方向
        for (let i = 0; i < NR - 1; i++){
          if (ws[i] < 3 || ws[i+1] < 3) continue;
          const p0 = line[i], p1 = line[i+1];
          const q0 = [p0[0] + nrm[i][0]*inward*ws[i],   p0[1] + nrm[i][1]*inward*ws[i]];
          const q1 = [p1[0] + nrm[i+1][0]*inward*ws[i+1], p1[1] + nrm[i+1][1]*inward*ws[i+1]];
          const yb = Y.berge, u0 = i * 25 / 4, u1 = (i+1) * 25 / 4;
          /* 下层河岸的铺面也是泛用件：一段一段分年整修，且常年泡在水汽里。
             批次按沿河 8 个采样点（约 200m）归一，一整段码头共享同一批次色。 */
          const bb = (i >> 3) * 2 + (s > 0 ? 0 : 1);
          const bp = PC.vary.of('stone', p0[0], p0[1], bb);
          const bc = batchTone(P.sidewalk, PC.families.sidewalk, bp,
                      {batch: bb, span: .05, fade: .10, dirt: .34, moss: .22,
                       lo: .82, hi: 1.10, out: VCOL});
          /* aPav：t 从岸侧(0)走到水侧(1)，沿河米数用河道采样点算，宽度是这一段的 bergeW */
          const bs = bhash(bb, 61);
          const pv = [[0, i*25, bs, ws[i]], [0, (i+1)*25, bs, ws[i+1]],
                      [1, (i+1)*25, bs, ws[i+1]], [1, i*25, bs, ws[i]]];
          B.walk.quad([p0[0], yb, p0[1]], [p1[0], yb, p1[1]], [q1[0], yb, q1[1]], [q0[0], yb, q0[1]],
                      [[u0,0], [u1,0], [u1, ws[i+1]/4], [u0, ws[i]/4]], [0,1,0], bc, pv);
          /* 临水边坎：从步道面下到水面，不做成飘在空中的一张纸 */
          B.curb.quad([q0[0], yb, q0[1]], [q1[0], yb, q1[1]],
                      [q1[0], Y.water - 0.4, q1[1]], [q0[0], Y.water - 0.4, q0[1]],
                      [[u0,0], [u1,0], [u1,1.1], [u0,1.1]],
                      [nrm[i][0]*inward, 0, nrm[i][1]*inward]);
        }
      }
    }

    /* ── 3.5 蒙马特山丘 ──
       径向网格比方格省一半三角，而且在山脚能和 y=0 的底板严丝合缝地收口。
       街廓是平台（plan 给每个街廓一个 y0），所以落在街廓里的网格点朝 y0 靠，
       否则山坡会从内院里穿出来。 */
    step && step(20, '地面 · 蒙马特山丘'); await raf();
    for (const h of (plan.hills || [])){
      const SEG = 64, RING = 22, RMAX = h.r * 1.02;
      const near = [];
      for (const b of plan.blocks)
        if (Math.hypot(b.centroid[0]-h.x, b.centroid[1]-h.z) < h.r + 120) near.push(b);
      const yAt = (x, z) => {
        let y = tY(x, z);
        for (const b of near){
          if (x < b.bb[0] || x > b.bb[2] || z < b.bb[1] || z > b.bb[3]) continue;
          if (PC.poly.contains(b.poly, x, z)) return b.y0;   /* 街廓是平台，山坡不许从内院里钻出来 */
        }
        return y;
      };
      const gh = new T.BufferGeometry();
      const Pv = [], Uv = [], Iv = [];
      for (let k = 0; k <= RING; k++){
        const r = RMAX * Math.pow(k / RING, 1.15);
        for (let s = 0; s < SEG; s++){
          const a = s / SEG * Math.PI * 2;
          const x = h.x + Math.cos(a) * r, z = h.z + Math.sin(a) * r;
          Pv.push(x, yAt(x, z), z); Uv.push(x / 6.4, z / 6.4);
        }
      }
      for (let k = 0; k < RING; k++) for (let s = 0; s < SEG; s++){
        const s1 = (s+1) % SEG, a = k*SEG + s, b = k*SEG + s1, c = (k+1)*SEG + s, d = (k+1)*SEG + s1;
        Iv.push(a, c, d, a, d, b);
      }
      gh.setAttribute('position', new T.Float32BufferAttribute(Pv, 3));
      gh.setAttribute('uv', new T.Float32BufferAttribute(Uv, 2));
      gh.setIndex(Iv);
      gh.computeVertexNormals();
      /* 绕序校正：法线朝下就整体翻面 */
      if (gh.attributes.normal.getY(SEG * 3) < 0){
        const a = gh.index.array;
        for (let i = 0; i < a.length; i += 3){ const t = a[i+1]; a[i+1] = a[i+2]; a[i+2] = t; }
        gh.computeVertexNormals();
      }
      B.ground.addGeo(gh);
    }

    /* ── 3.6 车行道 ──
       路面宽 = 街宽 − 两侧人行道，与 plan 给 parcel 的 sidewalkW 用同一个公式，
       所以路缘石和路面边缘天然对齐。两端各多伸半个路宽，把路口的缺角盖住。 */
    step && step(30, '地面 · 铺花岗岩弹石车行道'); await raf();
    const swOf = (klass, w) => klass === 'quai' ? clamp(w * 0.28, 2.4, 7.0)
                                                : clamp(w * 0.235, 1.5, 6.5);
    {
      const PS = 3.2;                                 // 弹石贴图边长（米）
      for (const r of plan.roads){
        const ax = r.a[0], az = r.a[1];
        let dx = r.b[0]-ax, dz = r.b[1]-az;
        const L = Math.hypot(dx, dz); if (L < 1) continue;
        dx /= L; dz /= L;
        const half = Math.max(2.5, r.w/2 - swOf(r.klass, r.w));
        /* ── 这一段路是哪一批石头 ──
           批次 = 街道 id：一条街是一次铺装工程，整条街同一批石料、同一个年份，
           但每一段仍有各自的个体浮动（prof.tint 按段的坐标取）。
           r.id 而不是段序号——不然同一条林荫道会被劈成十几种颜色。
           年龄由 PC.vary.of 统一驱动褪色与积垢：临河的脏、好街区的新。 */
        const mx = ax + dx*L/2, mz = az + dz*L/2;
        const rp = PC.vary.of('stone', mx, mz, r.id);
        const rc = batchTone(P.pave, PC.families.pave, rp,
                    {batch: r.id, span: .05, fade: .13, dirt: .24,
                     lo: .80, hi: 1.22, out: VCOL});
        const rs = bhash(r.id, 61);                   // 路段种子：决定补丁怎么分布
        const ext = Math.min(half, 6);
        const nx = dz, nz = -dx;
        /* 山上按 20m 分段采样地形，否则路面会切进山体 */
        const onHill = tY(ax, az) > 0.5 || tY(r.b[0], r.b[1]) > 0.5;
        /* 过河的路段要在岸线断开：河面上的那一段是桥面，归 bridges.js，
           这里铺过去就会和桥面重叠打架，也会在没桥的地方留一条飘在水上的路。 */
        let spans = [[-ext, L + ext]];
        const dm = R.dist(ax + dx*L/2, az + dz*L/2);
        if (dm.d < dm.w/2 + 90){
          spans = [];
          const N = Math.max(2, Math.ceil((L + 2*ext) / 8));
          let cur = null;
          for (let k = 0; k < N; k++){
            const s0 = -ext + (L + 2*ext) * k / N, s1 = -ext + (L + 2*ext) * (k+1) / N;
            const mx = ax + dx*(s0+s1)/2, mz = az + dz*(s0+s1)/2;
            if (R.inWater(mx, mz)){ if (cur){ spans.push(cur); cur = null; } }
            else if (cur) cur[1] = s1; else cur = [s0, s1];
          }
          if (cur) spans.push(cur);
        }
        for (const sp of spans){
          const SL = sp[1] - sp[0]; if (SL < 3) continue;
          const seg = onHill ? Math.max(1, Math.ceil(SL / 20)) : 1;
          for (let k = 0; k < seg; k++){
            const t0 = sp[0] + SL * k / seg, t1 = sp[0] + SL * (k+1) / seg;
            const c0 = [ax + dx*t0, az + dz*t0], c1 = [ax + dx*t1, az + dz*t1];
            const y0 = onHill ? tY(c0[0], c0[1]) : 0, y1 = onHill ? tY(c1[0], c1[1]) : 0;
            const p0 = [c0[0]+nx*half, y0, c0[1]+nz*half], p1 = [c1[0]+nx*half, y1, c1[1]+nz*half];
            const p2 = [c1[0]-nx*half, y1, c1[1]-nz*half], p3 = [c0[0]-nx*half, y0, c0[1]-nz*half];
            /* u 沿路走、v 横过路面 —— 弹石的弧行才会横着排 */
            const u0 = t0/PS, u1 = t1/PS, v = half*2/PS;
            /* aPav：p0/p1 在 +n 侧（t=0），p2/p3 在 −n 侧（t=1）；
               第二位是沿路米数（补丁按真实尺寸排，不随路宽缩放），
               第四位是半宽——片元靠它算出自己离路缘几米，也靠它推车流强度。 */
            const pv = [[0, t0, rs, half], [0, t1, rs, half],
                        [1, t1, rs, half], [1, t0, rs, half]];
            B.road.quad(p0, p1, p2, p3, [[u0,0],[u1,0],[u1,v],[u0,v]], [0,1,0], rc, pv);
          }
        }
      }
    }

    /* ── 3.7 街廓底面（含内院）── */
    step && step(44, '地面 · 街廓底面与内院'); await raf();
    {
      const cUV = (x, z) => [x/4.4, z/4.4];
      /* 内院不是一种地面，是三种：铺石板的、铺碎石的、常年没人管长了草的。
         批次 = 街廓序号（一个街廓的天井是一次修的）。
         比例用长尾定：多数是铺装，少数才碎石／长草——反过来会读成「城里到处是荒院」。 */
      let bi = 0;
      for (const b of plan.blocks){
        const y = b.y0 || 0;          /* 与车行道同高，压不压得住看 polygonOffset */
        const cp = PC.vary.of('stone', b.centroid[0], b.centroid[1], bi);
        const kind = bhash(bi, 13);
        const cc = batchTone(C.court, PC.families.courtyard, cp,
                    {batch: bi, span: .06, fade: .12, dirt: .30, lo: .80, hi: 1.20, out: VCOL});
        if (kind > 0.86)      cc.multiply(ratioTo(COURT_GREEN,  C.court, VCOL2));  // 长草的天井
        else if (kind > 0.62) cc.multiply(ratioTo(COURT_GRAVEL, C.court, VCOL2));  // 碎石铺面
        cc.setRGB(clamp(cc.r, .78, 1.38), clamp(cc.g, .78, 1.38), clamp(cc.b, .78, 1.38));
        B.court.addGeo(fillPoly(b.poly, null, () => y, cUV), cc);
        bi++;
      }
    }

    /* ── 3.8 人行道 + 路缘石 ──
       这是这次升级的关键地物：shops.js 的桌椅伞全落在它上面，
       所以边界必须和 parcel 用同一条线（block.poly 的边），宽度必须是 run.sidewalkW。
       外沿走斜接（miter），相邻两段之间不留缺口。 */
    step && step(56, '地面 · 人行道与花岗岩路缘石'); await raf();
    const WALK_H = 0.16;
    {
      const DEF = {quai: 6.2, boulevard: 4.4, avenue: 4.2, 'rue-majeure': 3.6, rue: 3.0, ruelle: 2.2};
      let done = 0;
      for (const b of plan.blocks){
        const Pp = b.poly, n = Pp.length; if (n < 3) continue;
        const y = (b.y0 || 0) + WALK_H;
        const wid = new Array(n), nn = new Array(n), rid = new Array(n);
        for (let i = 0; i < n; i++){
          const a = Pp[i], c = Pp[(i+1)%n];
          const dx = c[0]-a[0], dz = c[1]-a[1], L = Math.hypot(dx, dz) || 1;
          nn[i] = [dz/L, -dx/L];                    // 逆时针多边形 → 朝街外
          wid[i] = DEF[(b.klasses && b.klasses[i]) || 'rue'] || 3.0;
          rid[i] = -1;
        }
        for (const rn of (b.runs || [])){
          if (rn.edge >= n) continue;
          if (rn.sidewalkW) wid[rn.edge] = rn.sidewalkW;
          if (rn.roadId !== undefined && rn.roadId !== null) rid[rn.edge] = rn.roadId;
        }
        /* 外沿顶点：相邻两条外移线求交，交不出来（近平行）就直接用外移点 */
        const O = new Array(n);
        for (let i = 0; i < n; i++){
          const pi = (i - 1 + n) % n;
          const a0 = [Pp[pi][0] + nn[pi][0]*wid[pi], Pp[pi][1] + nn[pi][1]*wid[pi]];
          const d0 = [Pp[i][0]-Pp[pi][0], Pp[i][1]-Pp[pi][1]];
          const a1 = [Pp[i][0] + nn[i][0]*wid[i], Pp[i][1] + nn[i][1]*wid[i]];
          const d1 = [Pp[(i+1)%n][0]-Pp[i][0], Pp[(i+1)%n][1]-Pp[i][1]];
          const den = d0[0]*d1[1] - d0[1]*d1[0];
          let p = a1;
          if (Math.abs(den) > 1e-7){
            const t = ((a1[0]-a0[0])*d1[1] - (a1[1]-a0[1])*d1[0]) / den;
            const q = [a0[0] + d0[0]*t, a0[1] + d0[1]*t];
            const mit = Math.hypot(q[0]-Pp[i][0], q[1]-Pp[i][1]);
            if (mit < Math.max(wid[i], wid[pi]) * 2.0) p = q;
          }
          O[i] = p;
        }
        const hilly = (b.y0 || 0) > 0.5;
        for (let i = 0; i < n; i++){
          const j = (i+1) % n;
          const a = Pp[i], c = Pp[j], o0 = O[i], o1 = O[j];
          const L = Math.hypot(c[0]-a[0], c[1]-a[1]); if (L < 0.6) continue;
          /* 蒙马特：街廓是平台，平台边缘要有挡土墙扎进坡里，
             否则整块街廓连人行道一起飘在山坡上（第一轮实测就是一片悬空的盘子）。 */
          if (hilly){
            const g0 = Math.min(tY(o0[0], o0[1]), y - WALK_H) - 1.4;
            const g1 = Math.min(tY(o1[0], o1[1]), y - WALK_H) - 1.4;
            if (y - Math.max(g0, g1) > 0.4)
              B.curb.quad([o0[0], y, o0[1]], [o1[0], y, o1[1]],
                          [o1[0], g1, o1[1]], [o0[0], g0, o0[1]],
                          [[0,0], [L/2,0], [L/2,(y-g1)/2], [0,(y-g0)/2]],
                          [nn[i][0], 0, nn[i][1]]);
          }
          /* ── 这一段人行道与路缘石属于哪一批 ──
             批次 = 它临的那条街的 id：一条街的两侧人行道是同一次翻修，
             连对面那一侧也一起换，所以要用街道 id 而不是街廓序号。
             拿不到 roadId 的边（内部切出来的巷子）退回用街廓序号，仍然成批。 */
          const bt = rid[i] >= 0 ? rid[i] : (100000 + done);
          const wp = PC.vary.of('stone', (a[0]+c[0])/2, (a[1]+c[1])/2, bt);
          const wc = batchTone(P.sidewalk, PC.families.sidewalk, wp,
                      {batch: bt, span: .05, fade: .15, dirt: .26,
                       lo: .80, hi: 1.20, out: VCOL});
          /* aPav：t 从楼根(0)走到路缘(1)；沿边米数从这条边的起点算 */
          const ws2 = bhash(bt, 67);
          const wv = [[0, 0, ws2, wid[i]], [0, L, ws2, wid[i]],
                      [1, L, ws2, wid[i]], [1, 0, ws2, wid[i]]];
          /* 人行道面 */
          B.walk.quad([a[0], y, a[1]], [c[0], y, c[1]], [o1[0], y, o1[1]], [o0[0], y, o0[1]],
                      [[0,0], [L/4,0], [L/4, wid[i]/4], [0, wid[i]/4]], [0,1,0], wc, wv);
          /* 路缘石立面：下沿压到路面以下 2cm，别在斜坡上露出缝 */
          const yb = (b.y0 || 0) - 0.02;
          /* 路缘石是另一种石头（花岗岩块，比人行道耐得多），所以自己一族、自己一档老化速率。
             它被车轮蹭、被行李箱磕，磨到的地方露出没风化的新石面——所以 wear 是提亮的。 */
          const kp = PC.vary.of('stone', (o0[0]+o1[0])/2, (o0[1]+o1[1])/2, bt);
          const kc = batchTone(P.curb, PC.families.curbStone, kp,
                      {batch: bt, famSalt: 149, span: .045, fade: .10, dirt: .20,
                       gain: 1 + kp.wear * 0.07, lo: .82, hi: 1.20, out: VCOL2});
          B.curb.quad([o0[0], y, o0[1]], [o1[0], y, o1[1]],
                      [o1[0], yb, o1[1]], [o0[0], yb, o0[1]],
                      [[0,0], [L/2,0], [L/2,0.09], [0,0.09]], [nn[i][0], 0, nn[i][1]], kc);
        }
        if ((++done & 255) === 0) await raf();
      }
    }

    /* ── 3.9 广场与公园 ──
       从鸟瞰看这是最强的城市识别锚点：辐射铺石的星形广场、砂砾的杜乐丽、
       草坪的战神广场、规则式花坛的卢森堡。按 plan 的 paving 字段分流。 */
    step && step(76, '地面 · 广场与公园铺装'); await raf();
    {
      /* 广场／绿地与车行道同高（都在 tY），层叠全交给 polygonOffset。
         抬高 4cm 换来的是每块板在斜光下多一道边线，读起来像互相叠放的纸片。 */
      const yP = (x, z) => tY(x, z);
      const yF = (x, z) => tY(x, z) + 0.012;      // 图案层：只抬 1cm，压不压得住看 polygonOffset
      const cLt = VC(C.figLt), cMd = VC(C.figMd), cDk = VC(C.figDk);
      for (let pi = 0; pi < plan.places.length; pi++){
        const pl = plan.places[pi];
        const uvW = s => (x, z) => [x/s, z/s];
        const F = frame(pl);
        /* ── 这块场地用哪一种石料 ──
           批次 = 广场序号：一块广场是一次铺装工程，整块同一批石头。
           全城 54 块场地各自抽族，于是协和的蓝灰花岗岩和孚日的暖砂砾不再是同一个灰。
           铺装的**图案**（辐射／扇形／分格）不参与随机——那是设计好的，
           随机化图案就不是「这一块石头是哪批采的」而是「这块广场设计错了」。 */
        const pp = PC.vary.of('stone', pl.center[0], pl.center[1], 4000 + pi);
        const stoneC = batchTone(P.pave, PC.families.plazaStone, pp,
                        {batch: 4000 + pi, span: .05, fade: .14, dirt: .22,
                         lo: .78, hi: 1.26}).clone();
        const gravelC = batchTone(P.sand, PC.families.gravel, pp,
                        {batch: 4000 + pi, famSalt: 151, span: .05, fade: .12, dirt: .20,
                         lo: .82, hi: 1.20}).clone();
        /* 铺装的分格跟着广场自己的长轴走，UV 因此是仿射的，
           ShapeGeometry 只在多边形角点上有顶点也不会插值出错。 */
        const uvLoc = s => (x, z) => {
          const dx = x - F.c[0], dz = z - F.c[1];
          return [(dx*F.ex[0] + dz*F.ex[1]) / s, (dx*F.ez[0] + dz*F.ez[1]) / s];
        };
        /* plan 把协和广场标成 sett，但它是全巴黎最典型的辐射铺装广场（方尖碑居中，
           八尊城市女神像守角）。8 公顷以上的铺石广场一律按辐射走，这是任务书点名的
           城市识别锚点；小广场仍用孔雀尾扇形铺法。 */
        const radial = pl.paving === 'radial' || (pl.paving === 'sett' && pl.area > 45000);
        if (radial){
          /* 三层：整块广场按孔雀尾＋大分格铺（和别的铺石广场一个花样，接得上），
             中间嵌一张同心圆盘，圆盘的极坐标 UV 只覆盖它自己，
             所以同心圆再也不会被广场的直边切断。 */
          B.sett.addGeo(fillPoly(pl.poly, null, yP, uvLoc(21)), stoneC);
          const Rd = medallionR(pl);
          if (Rd > 20){
            const N = 72;
            const ring = circlePts(pl.center[0], pl.center[1], Rd, N);
            B.radial.addGeo(fillPoly(ring, null, yP,
              (x, z) => [(x - pl.center[0]) / Rd * 0.494 + 0.5,
                         (z - pl.center[1]) / Rd * 0.494 + 0.5]), stoneC);
          }
        } else if (pl.paving === 'lawn'){
          /* esplanade 的草坪不是一整块绿板：中间一条砂砾主轴，两侧椴树列与边道，
             草坪切成对称的几块。荣军院前草坪（490×278，正对亚历山大三世桥）
             真实就是四块规整大草坪。底板换成砂砾，草坪块压在上面——
             veg 的 polygonOffset 本来就比 sand 靠前，顺序天然对。 */
          if (pl.kind === 'esplanade' && F.W > 150 && F.D > 60){
            B.sand.addGeo(fillPoly(pl.poly, null, yP, uvW(4)), gravelC);
            esplanade(pl, F, B, VC, tY, pi);
          } else {
            /* 整块的大草坪（战神广场 28 公顷）只有这一个顶点色可给，
               场地内部的深浅交给 MAT.veg 的世界坐标噪声 shader */
            B.veg.addGeo(fillPoly(pl.poly, null, yP, uvW(8)), turfC(pi, pl.center[0], pl.center[1], 0));
          }
        } else if (pl.paving === 'parterre'){
          B.sand.addGeo(fillPoly(pl.poly, null, yP, uvW(4)), gravelC);
          parterre(pl, B, VC, T, tY, pi);
        } else if (pl.paving === 'gravel'){
          B.sand.addGeo(fillPoly(pl.poly, null, yP, uvW(4)), gravelC);
          if (pl.kind === 'cemetery') graves(pl, B, tY);
          /* 方园／小花园：砂砾里嵌规整草坪块。真实的巴黎 square 就是砂砾路网＋草坪块，
             整块砂砾是空的——圣母院后的让二十三世广场第一轮就是那样一片米色。 */
          else if (pl.kind === 'garden' || pl.kind === 'park') squareGarden(pl, F, B, VC, tY, pi);
        } else {
          B.sett.addGeo(fillPoly(pl.poly, null, yP, uvLoc(21)), stoneC);
        }

        /* ── 收边与中心图案（图案层，全城一个 draw call）── */
        const hard = pl.kind === 'place' || pl.kind === 'esplanade';
        if (!hard && pl.area < 4000) continue;
        if (pl.area < 900) continue;
        /* 花岗岩收边：一道亮石带贴着广场边界内侧。从空中看这一圈就是广场的轮廓线，
           没有它，铺石广场和旁边的沥青路面是同一个灰，广场根本不成形。 */
        const bw = clamp(Math.sqrt(pl.area) * (hard ? 0.022 : 0.016), 1.1, hard ? 2.6 : 2.0);
        const rim = PC.poly.inset(pl.poly, bw * 0.75 + 0.4);
        if (rim && rim.length >= 3) ribbon(B.figure, null, rim, bw, yF, hard ? cLt : cMd, true);
        if (!hard) continue;

        const zero = pl.features && pl.features.some(f => f.indexOf('零公里点') >= 0);
        if (zero){ parvis(pl, F, B, yF, cLt, cMd, VC(C.bronze), plan.landmarks); continue; }
        /* 中心图案是石线，只画在真的铺了石头的广场上。荣军院前草坪、卡鲁塞尔、孚日
           这些砂砾／草坪广场只留一圈收边——在草地上画同心石框会读成贴图漏了。 */
        const stone = pl.paving === 'sett' || pl.paving === 'radial';
        if (radial || !stone || pl.area < 3000) continue;
        /* 中心图案：近方的广场用同心环，长条的用同心矩形。中心一律取 pl.center，
           和 furniture.js 的水池／纪念柱共用同一个中心，图案不会和它们错位。 */
        const asp = Math.max(F.W, F.D) / Math.max(1, Math.min(F.W, F.D));
        const Rm = medallionR(pl);
        if (asp < 1.6 && Rm > 24){
          for (const f of [0.86, 0.52, 0.24])
            ribbon(B.figure, pl.poly, circlePts(F.c[0], F.c[1], Rm*f, 56),
                   f > 0.8 ? 1.5 : 1.1, yF, f > 0.8 ? cLt : cMd, true);
        } else {
          for (const f of [0.72, 0.40]){
            const u = F.W/2*f, v = F.D/2*f;
            ribbon(B.figure, pl.poly,
                   [F.to(-u,-v), F.to(u,-v), F.to(u,v), F.to(-u,v)].map(q => q),
                   f > 0.6 ? 1.5 : 1.1, yF, f > 0.6 ? cLt : cMd, true);
          }
          /* 长条广场的横向分格：每 ~26m 一道石带，把 220m 的长场切成读得出的段 */
          const n = Math.max(2, Math.round(F.W / 26));
          for (let i = 1; i < n; i++){
            const u = F.u0 + F.W * i / n;
            ribbon(B.figure, pl.poly, [F.to(u, F.v0), F.to(u, F.v1)], 0.9, yF, cMd, false);
          }
        }
      }
    }

    /* ── 3.10 合桶出网格 ── */
    step && step(94, '地面 · 合并静态几何'); await raf();
    const order = [['ground', MAT.ground], ['outer', MAT.outer], ['bed', MAT.bed],
                   ['road', MAT.road], ['court', MAT.court], ['sett', MAT.sett],
                   ['radial', MAT.radial], ['sand', MAT.sand], ['veg', MAT.veg],
                   ['pool', MAT.pool], ['walk', MAT.walk], ['curb', MAT.curb],
                   ['figure', MAT.figure], ['river', MAT.river]];
    let tris = 0, calls = 0;
    const detail = {};
    for (const [k, m] of order){
      const mesh = B[k].mesh(m, 'terrain-' + k);
      detail[k] = B[k].tris();
      if (!mesh) continue;
      tris += B[k].tris(); calls++;
      ROOT.add(mesh);
    }
    STATS = {tris: tris, calls: calls, detail: detail};
    console.log('[terrain] 三角 ' + tris.toLocaleString('en-US') + ' · draw call ' + calls, detail);
    step && step(99, '地面 · 完成');
    return STATS;
  },

  setVisible(v){ if (ROOT) ROOT.visible = v; }
});

/* ─────────────────────────── 4. 法式规则式花坛 ───────────────────────────
   杜乐丽 / 卢森堡 / 植物园 / 荣军院总管花园：砂砾主轴 + 几何绿块 + 中央水池。
   每块花坛 = 一块 0.75m 高的绿篱台（顶面 + 四立面）+ 台上的花／草面，
   从空中看正好是「绿框里一块颜色」，12 个三角一块，不用给每丛黄杨建模。 */
function parterre(pl, B, VC, T, tY, pi){
  const c = pl.center;
  /* 主轴：多边形的长轴 */
  let sxx = 0, sxz = 0, szz = 0;
  for (const q of pl.poly){ const dx = q[0]-c[0], dz = q[1]-c[1]; sxx += dx*dx; sxz += dx*dz; szz += dz*dz; }
  const th = 0.5 * Math.atan2(2*sxz, sxx - szz);
  const ex = [Math.cos(th), Math.sin(th)], ez = [-Math.sin(th), Math.cos(th)];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const q of pl.poly){
    const du = (q[0]-c[0])*ex[0] + (q[1]-c[1])*ex[1];
    const dv = (q[0]-c[0])*ez[0] + (q[1]-c[1])*ez[1];
    u0 = Math.min(u0, du); u1 = Math.max(u1, du); v0 = Math.min(v0, dv); v1 = Math.max(v1, dv);
  }
  const W = u1-u0, D = v1-v0;
  if (W < 40 || D < 26) return;
  /* 格子太密会把杜乐丽画成一块乐高底板；但长宽用两个不同的目标尺寸（78/58）分割，
     长方向的花园会切成两三条 70m×20m 的长条，从空中读作两片飘着的绿板子。
     两边用同一个目标边长，格子接近正方，才读得出「砂砾路网里的一格格花坛」。 */
  const CS = 46;
  const cu = Math.max(2, Math.round(W / CS)), cv = Math.max(2, Math.round(D / CS));
  const cw = W/cu, ch = D/cv, path = Math.min(9, Math.min(cw, ch) * 0.28);
  const toW = (u, v) => [c[0] + ex[0]*u + ez[0]*v, c[1] + ex[1]*u + ez[1]*v];
  /* 绿篱是同一批黄杨，同年种、同一把剪子剪的——所以整园共享一个基调，
     只在每一格上做很小的浮动。花坛的图案不参与随机（那是设计好的），
     变的只是「这一园的黄杨长得多密、剪过多久」。 */
  const hedgeBase = new THREE.Color(pickTail(PC.families.turf, bhash(4000 + (pi || 0), 173), 2.6));
  hedgeBase.lerp(new THREE.Color(C.hedge), 0.62);
  const hedgeC = new THREE.Color();
  /* 黄杨绿篱台：真实的法式花坛围边约半米，抬到 0.75 会让整块花坛读成一张浮起的板 */
  const HH = 0.55;
  /* 中央水池与它周围的砂砾空场，尺寸不跟着格子走（格子变小水池不该跟着缩） */
  const RES = clamp(Math.min(W, D) * 0.16, 16, 34);
  for (let j = 0; j < cv; j++) for (let i = 0; i < cu; i++){
    const a0 = u0 + i*cw + path/2, a1 = u0 + (i+1)*cw - path/2;
    const b0 = v0 + j*ch + path/2, b1 = v0 + (j+1)*ch - path/2;
    const cor = [toW(a0,b0), toW(a1,b0), toW(a1,b1), toW(a0,b1)];
    let ok = true;
    for (const q of cor) if (!PC.poly.contains(pl.poly, q[0], q[1])){ ok = false; break; }
    /* 中央留出水池 + 一圈砂砾平台（真实的杜乐丽/卢森堡中心都是大水池加空场） */
    const mid = Math.hypot((a0+a1)/2, (b0+b1)/2) < RES * 1.55;
    if (!ok || mid) continue;
    if (PC.hash2(cor[0][0], cor[0][1], 17) > 0.78) continue;   /* 留白：砂砾空场 */
    const y = tY(cor[0][0], cor[0][1]);      /* 绿篱台脚落在砂砾面上，不额外抬 */
    /* 绿篱台：顶面 + 四个立面 */
    hedgeC.copy(hedgeBase)
      .multiplyScalar(1 + (PC.hash2(cor[0][0], cor[0][1], 181) - 0.5) * 0.13)
      .convertSRGBToLinear();
    const top = cor.map(q => [q[0], y+HH, q[1]]);
    B.veg.quad(top[0], top[1], top[2], top[3],
               [[0,0],[cw/6,0],[cw/6,ch/6],[0,ch/6]], [0,1,0], hedgeC);
    for (let k = 0; k < 4; k++){
      const p = cor[k], q = cor[(k+1)%4];
      const nx = q[1]-p[1], nz = -(q[0]-p[0]);
      B.veg.quad([p[0], y+HH, p[1]], [q[0], y+HH, q[1]], [q[0], y, q[1]], [p[0], y, p[1]],
                 [[0,0],[1.2,0],[1.2,0.4],[0,0.4]], [nx, 0, nz], hedgeC);
    }
    /* 台上的花／草：往里收 1.3m，从空中看就是绿框里的一块颜色 */
    const in0 = a0+1.3, in1 = a1-1.3, ib0 = b0+1.3, ib1 = b1-1.3;
    if (in1 - in0 > 2 && ib1 - ib0 > 2){
      const ic = [toW(in0,ib0), toW(in1,ib0), toW(in1,ib1), toW(in0,ib1)];
      const flower = PC.hash2(ic[0][0], ic[0][1], 5) < 0.17;
      const col = flower ? VC(C.bloom[(PC.hash2(ic[0][0], ic[0][1], 9) * C.bloom.length) | 0])
                         : turfC(pi === undefined ? 0 : pi, ic[0][0], ic[0][1], 0);
      B.veg.quad([ic[0][0], y+HH+0.06, ic[0][1]], [ic[1][0], y+HH+0.06, ic[1][1]],
                 [ic[2][0], y+HH+0.06, ic[2][1]], [ic[3][0], y+HH+0.06, ic[3][1]],
                 [[0,0],[cw/6,0],[cw/6,ch/6],[0,ch/6]], [0,1,0], col);
    }
  }
  /* 中央水池：八角形（杜乐丽的大水池就是八角），带一圈石缘 */
  {
    const rr = RES;
    const y = tY(c[0], c[1]) + 0.05, N = 8;
    const ring = [];
    for (let i = 0; i < N; i++){
      const a = i / N * Math.PI * 2 + Math.PI/N;
      ring.push(toW(Math.cos(a)*rr, Math.sin(a)*rr));
    }
    if (PC.poly.contains(pl.poly, ring[0][0], ring[0][1])){
      for (let i = 1; i + 1 < N; i++){
        const p0 = ring[0], p1 = ring[i], p2 = ring[i+1];
        B.pool.quad([p0[0], y+0.30, p0[1]], [p1[0], y+0.30, p1[1]],
                    [p2[0], y+0.30, p2[1]], [p2[0], y+0.30, p2[1]],
                    [[0,0],[1,0],[1,1],[1,1]], [0,1,0]);
      }
      for (let i = 0; i < N; i++){
        const p = ring[i], q = ring[(i+1)%N];
        const dx = q[0]-p[0], dz = q[1]-p[1], L = Math.hypot(dx, dz) || 1;
        const ox = dz/L * 1.1, oz = -dx/L * 1.1;
        B.curb.quad([p[0], y+0.45, p[1]], [q[0], y+0.45, q[1]],
                    [q[0]+ox, y+0.45, q[1]+oz], [p[0]+ox, y+0.45, p[1]+oz],
                    [[0,0],[L/2,0],[L/2,0.5],[0,0.5]], [0,1,0]);
      }
    }
  }
}

/* ─────────────────────── 5. 圣母院前广场 Parvis Notre-Dame ───────────────────────
   真实的 Parvis 是灰色花岗岩大场：中央嵌着法国公路零公里点铜牌，铺装用石线画出
   同心弧与放射线，外圈一道花岗岩收边，地面上还用浅色石线标出中世纪街道的旧迹。
   第一轮它是一块纯色的板——全图最空的一处，占了圣母院正前方一大片。 */
function parvis(pl, F, B, yF, cLt, cMd, cBz, lms){
  /* 零公里点在西立面正前方十几米处。这里不写死坐标：取离广场最近的地标
     （就是圣母院），从广场形心朝它推，推到还落在广场里的第一个位置。 */
  let z0 = [pl.center[0], pl.center[1]], best = null, bd = Infinity;
  for (const l of (lms || [])){
    const d = Math.hypot(l.pos[0] - pl.center[0], l.pos[1] - pl.center[1]);
    if (d < bd){ bd = d; best = l; }
  }
  if (best) for (const t of [0.58, 0.48, 0.38, 0.28, 0.16]){
    const p = [pl.center[0] + (best.pos[0] - pl.center[0]) * t,
               pl.center[1] + (best.pos[1] - pl.center[1]) * t];
    if (PC.poly.contains(pl.poly, p[0], p[1])){ z0 = p; break; }
  }
  const RMAX = Math.max(F.W, F.D) * 0.98;
  /* 放射石线：16 条从零公里点散开 */
  for (let i = 0; i < 16; i++){
    const a = i / 16 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    ribbon(B.figure, pl.poly,
           [[z0[0] + c*7.5, z0[1] + s*7.5], [z0[0] + c*RMAX, z0[1] + s*RMAX]],
           0.7, yF, cMd, false);
  }
  /* 同心弧：最内一道用亮花岗岩，其余是分格石线 */
  for (const r of [17, 31, 47, 65, 85, 108]){
    if (r > RMAX) break;
    ribbon(B.figure, pl.poly, circlePts(z0[0], z0[1], r, clamp((r*0.7)|0, 24, 72)),
           r === 17 ? 1.4 : 0.85, yF, r === 17 ? cLt : cMd, true);
  }
  /* 中世纪街道旧迹：一圈更亮的石线，圈出西端那块旧街廓 */
  {
    const u0 = F.u0 + F.W*0.10, u1 = F.u0 + F.W*0.46;
    const v0 = -F.D*0.20, v1 = F.D*0.16;
    ribbon(B.figure, pl.poly,
           [F.to(u0,v0), F.to(u1,v0), F.to(u1,v1), F.to(u0,v1)], 0.55, yF, cLt, true);
  }
  /* 零公里点本体：花岗岩圆台里嵌一枚八角铜牌 */
  ribbon(B.figure, null, circlePts(z0[0], z0[1], 2.7, 28), 1.1, yF, cLt, true);
  const oct = circlePts(z0[0], z0[1], 1.05, 8), y = yF(z0[0], z0[1]) + 0.006;
  for (let i = 1; i + 1 < 8; i++)
    B.figure.quad([oct[0][0], y, oct[0][1]], [oct[i][0], y, oct[i][1]],
                  [oct[i+1][0], y, oct[i+1][1]], [oct[i+1][0], y, oct[i+1][1]],
                  [[0,0],[1,0],[1,1],[1,1]], [0,1,0], cBz);
}

/* ─────────────────────── 6. esplanade 的中轴与草坪块 ───────────────────────
   底板已经铺成砂砾，这里只压上对称的草坪块：中间留出主轴，两侧留出椴树列的边道，
   长向再切几段横道。四块规整大草坪＝荣军院前草坪的签名形状。 */
function esplanade(pl, F, B, VC, tY, pi){
  const ax = clamp(F.D * 0.10, 7, 16);          // 中央主轴半宽
  const mv = clamp(F.D * 0.10, 6, 24);          // 两侧边道（椴树列站这儿）
  const mu = clamp(F.W * 0.05, 6, 28);
  const nu = Math.max(2, Math.round(F.W / 180)), gap = 11;
  const su = (F.W - mu*2) / nu;
  for (const row of [[F.v0 + mv, -ax], [ax, F.v1 - mv]])
    for (let i = 0; i < nu; i++){
      const a0 = F.u0 + mu + i*su + (i ? gap/2 : 0);
      const a1 = F.u0 + mu + (i+1)*su - (i < nu-1 ? gap/2 : 0);
      lawnPanel(pl, F, B, VC, tY, (a0+a1)/2, (row[0]+row[1])/2,
                (a1-a0)/2, (row[1]-row[0])/2, 23, pi);
    }
}

/* 一块草坪：塞不下就往里收再试。广场多边形是斜的、弯的，规整的方格总有角点落在外面
   ——荣军院前草坪按外接框切出来的 215×99 大块，四块里只有一块能整个待在广场里。 */
function lawnPanel(pl, F, B, VC, tY, cu, cv, hw, hh, salt, pi){
  if (hw < 3 || hh < 3) return false;
  for (const s of [1, 0.84, 0.68, 0.52]){
    const cor = [F.to(cu-hw*s, cv-hh*s), F.to(cu+hw*s, cv-hh*s),
                 F.to(cu+hw*s, cv+hh*s), F.to(cu-hw*s, cv+hh*s)];
    let ok = true;
    for (const q of cor) if (!PC.poly.contains(pl.poly, q[0], q[1])){ ok = false; break; }
    if (!ok) continue;
    const y = tY(cor[0][0], cor[0][1]) + 0.02;
    /* 贴边的块压深一档：公园周边站着椴树列，边上的草常年在荫里 */
    const edge = Math.max(Math.abs(cu) / Math.max(1, F.W/2), Math.abs(cv) / Math.max(1, F.D/2));
    const col = turfC(pi === undefined ? salt : pi, cor[0][0], cor[0][1], edge * edge);
    B.veg.quad([cor[0][0],y,cor[0][1]], [cor[1][0],y,cor[1][1]],
               [cor[2][0],y,cor[2][1]], [cor[3][0],y,cor[3][1]],
               [[0,0],[hw*s/4,0],[hw*s/4,hh*s/4],[0,hh*s/4]], [0,1,0], col);
    return true;
  }
  return false;
}

/* ─────────────────────── 7. 方园（square）的草坪块 ───────────────────────
   巴黎的 square 不是一整块砂砾：砂砾是路网，路网里是一块块草坪，中央留给水池或纪念物。
   圣母院东端的让二十三世广场（看飞扶壁的最佳位置）第一轮就是一片空米色。 */
function squareGarden(pl, F, B, VC, tY, pi){
  /* 格子按「有效厚度」（面积÷长边）定，不按外接框定：让二十三世广场是一条沿河弯折的
     长带，外接框 242×112 但实际只有 44m 厚，按外接框切出来的大格四个角全落在广场外面，
     一块草坪都长不出来——第一轮它就还是一片空米色。 */
  const eff = pl.area / Math.max(1, Math.max(F.W, F.D));
  const cell = clamp(Math.min(eff, Math.min(F.W, F.D)) * 0.45, 11, 34);
  const nu = Math.max(1, Math.round(F.W / cell)), nv = Math.max(1, Math.round(F.D / cell));
  const mu = clamp(F.W * 0.05, 3, 12), mv = clamp(F.D * 0.05, 3, 12);
  const su = (F.W - mu*2) / nu, sv = (F.D - mv*2) / nv;
  if (su < 6 || sv < 6) return;
  const path = clamp(Math.min(su, sv) * 0.17, 2.2, 6);
  const hole = (nu >= 4 && nv >= 4) ? Math.min(su, sv) * 0.75 : 0;   // 中央水池／纪念物的净空
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++){
    const cu = F.u0 + mu + (i+0.5)*su, cv = F.v0 + mv + (j+0.5)*sv;
    const hw = (su - path)/2, hh = (sv - path)/2;
    if (hole && Math.hypot(cu, cv) < hole) continue;
    lawnPanel(pl, F, B, VC, tY, cu, cv, hw, hh, 29, pi);
  }
}

/* 蒙马特公墓：从空中看是密排的白石碑网格，铺一层砂砾认不出来。
   只出顶面（2 个三角一块），够远够小，立面看不见。 */
function graves(pl, B, tY){
  const bb = pl.bb;
  for (let z = bb[1] + 6; z < bb[3] - 6; z += 12)
    for (let x = bb[0] + 6; x < bb[2] - 6; x += 8){
      const jx = x + PC.hash2(x, z, 3) * 1.6, jz = z + PC.hash2(x, z, 4) * 2.0;
      if (!PC.poly.contains(pl.poly, jx, jz)) continue;
      const y = tY(jx, jz) + 0.18, a = 1.9, b = 0.85;
      B.curb.quad([jx-b, y, jz-a], [jx+b, y, jz-a], [jx+b, y, jz+a], [jx-b, y, jz+a],
                  [[0,0],[0.8,0],[0.8,1.9],[0,1.9]], [0,1,0]);
    }
}

})();
