/* ═══════════════════════════════════════════════════════════════════
   建筑包 · 巴黎圣母院 Notre-Dame de Paris
   契约：P3D.register({id, meta, sunHour, dossier, ceil, labels,
                       interiorBox, textures(ctx), build(ctx), effects(ctx)})
   ═══════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

/* ── 史实尺寸（单位：米） ── */
const D = {
  length:128, width:48,          // 总长 / 宽（耳堂处）
  towerH:69,                     // 西立面双塔高
  vaultH:33,                     // 中殿肋架拱顶高
  spireH:96,                     // 尖塔高（复建后）
  flyerSpan:15,                  // 飞扶壁单跨
  roseW:9.7, roseN:12.9, roseS:12.9
};

// 平面：X 东西（西为负），Z 南北（北为正），Y 向上
const X = { facadeOut:-64, facadeIn:-56, trW:2, trE:20, choir:20, apseC:41 };
const Z = { vessel:6.2, naveWall:7.5, a1out:13.6, a1wall:14.9, a2out:20.2,
            outer:21.4, pierOut:24.6, tran:24.0, facade:21.5 };
const Y = {
  arcade:11.0, arcadeApex:15.2,
  clereSill:20.6, clereHead:24.6, clereApex:27.4,
  naveSpring:26.0, naveCrown:33.0, wallTop:34.0, ridge:41.0,
  a1Spring:11.5, a1Crown:17.8, roofA1in:20.2, roofA1out:16.8,
  a2Spring:9.0,  a2Crown:14.4, wall2Top:21.5, roofA2in:17.0, roofA2out:13.0,
  pierTop:25.8,
  kingsY0:20.5, kingsY1:25.4, roseWY:32.0, facadeTop:45.0,
  roseTY:25.5, gableTop:41.0, trRidge:38.0, trEave:32.0,
  spireBase:40.0
};
const NAVE_BAYS = 10, NAVE_BAY = 5.8;   // 中殿 10 开间；六分拱顶每 2 间一单元
const V3=(x,y,z)=>new THREE.Vector3(x,y,z);

/* ── 卷宗条目 + 独立机位 ── */
const DOSSIER=[
 { id:'home', num:'00', name:'全景总览', sub:'Vue d’ensemble', fr:'Notre-Dame de Paris',
   era:'1163 – 1345（19 世纪大修 / 2024 复建重开）',
   dim:'总长 128 m · 宽 48 m · 双塔 69 m · 拱顶 33 m · 尖塔 96 m',
   desc:'全部几何体由代码按史实尺寸算出来，没有加载任何外部模型文件；石灰岩、铅皮、彩色玻璃的贴图与环境光照（IBL）全部由 Canvas 逐像素绘制后转成环境贴图供 PBR 材质使用。点任一条目，相机都会飞到该构件专属的机位——位置、朝向、视距逐条手定，不是套同一个公式。',
   note:'本卷宗为可交互的数字模型，非考古测绘成果；尺寸取公认值，细部作适度简化。',
   cam:{pos:[152,96,142], tgt:[2,28,-1], fov:42} },

 { id:'towers', num:'01', name:'西立面双塔', sub:'Tours occidentales', fr:'Les deux tours · 69 m',
   era:'约 1208 – 1250（1844 – 1864 年 Viollet-le-Duc 修复）',
   dim:'塔高 69 m · 塔身平面 11.0 × 10.5 m · 西立面总宽 43 m',
   desc:'圣母院唯一一对没有尖顶的塔——原设计中的塔尖从未建成，两塔以 69 米高的平顶露台收束，四角各立一座小尖塔。自下而上依次是三座深凹的尖拱门洞、国王廊（28 尊犹大王雕像，大革命时被误认作法国国王而遭捣毁，19 世纪重刻）、直径 9.7 米的西玫瑰窗，以及横贯两塔、俯瞰巴黎的「奇美拉廊」。南塔内悬 Emmanuel 大钟（约 13 吨）。',
   cam:{pos:[-135, 38, 22], tgt:[-63, 30, 0], fov:34} },

 { id:'roseW', num:'02', name:'西玫瑰窗', sub:'Rose occidentale', fr:'Rosace ouest · Ø 9.7 m',
   era:'约 1225 年（19 世纪拆解重组）',
   dim:'直径 9.7 m（三扇玫瑰窗中最小）· 12 组放射棂',
   desc:'三扇玫瑰窗里最小的一扇，坐落在国王廊之上。中心为圣母子，向外依次环列劳动月令、黄道十二宫，再外是德行与恶行的对照。13 世纪的原始玻璃大部分幸存，19 世纪由 Viollet-le-Duc 整体拆解重组并补配，2019 年火灾后再次揭取修复，2024 年复位。',
   note:'技术：用 <b>SpotLight.map</b> 把玫瑰图案当作投影片投进室内——玻璃不投影、石质棂条投影，于是地面与墙面出现带花格轮廓的彩色光斑。',
   cam:{pos:[-110, 38, 9], tgt:[-63.6, 32, 0], fov:24} },

 { id:'roseN', num:'03', name:'北耳堂玫瑰窗', sub:'Rose du transept nord', fr:'Rosace nord · Ø 12.9 m',
   era:'约 1250 – 1260',
   dim:'直径 12.9 m（三扇中最大）· 16 组放射棂 · 约八成为 13 世纪原玻璃',
   desc:'三扇中最大也最完整的一扇，中心为圣母子，外圈环列先知、士师与以色列诸王。它保存了圣母院最多的 13 世纪原始玻璃，也是 2019 年火灾中唯一未被摘取、且基本完好无损的一扇。12.9 米的直径几乎占满整个北耳堂立面的上半部。',
   cam:{pos:[11, 32, 58], tgt:[11, 25.5, 23.65], fov:26} },

 { id:'roseS', num:'04', name:'南耳堂玫瑰窗', sub:'Rose du transept sud', fr:'Rosace sud · Ø 12.9 m',
   era:'约 1260 年（路易九世捐赠）',
   dim:'直径 12.9 m · 16 组放射棂 · 18 与 19 世纪历经大修',
   desc:'由圣路易（路易九世）捐赠，与北窗同为 12.9 米。中心为基督，四周环列十二使徒，外圈为殉道者与贞女。历经 18 世纪与 19 世纪的大修，13 世纪原始玻璃的比例低于北窗；2019 年火灾后整体揭取修复，2024 年重新装回。',
   cam:{pos:[11, 32, -58], tgt:[11, 25.5, -23.65], fov:26} },

 { id:'vault', num:'05', name:'中殿肋架拱顶', sub:'Voûtes sexpartites de la nef', fr:'Nef · 33 m',
   era:'约 1182 – 1220（六分拱顶）',
   dim:'拱顶高 33 m · 中殿净宽 12.4 m · 十开间 · 每两开间一个六分拱顶单元',
   desc:'中殿采用「六分拱顶」：每两开间一个拱顶单元，四条对角肋汇聚于中央拱心石，再加一道横向脊肋，切出六个穹面。这一选择带来立柱的强弱交替——承重的强柱收束对角肋与横拱，中间的弱柱只承接侧墙拱。肋架把荷载集中到少数几个点上，墙面因此得以大面积开窗。此刻相机已置于中殿内部，可直接仰望肋架交汇处的拱心石。',
   note:'六分拱顶是圣母院区别于后来盛期哥特（四分拱顶）的关键特征。',
   cam:{pos:[-22, 13, 5], tgt:[5, 33, 0], fov:62} },

 { id:'buttress', num:'06', name:'后殿飞扶壁', sub:'Arcs-boutants du chevet', fr:'Chevet · portée ≈ 15 m',
   era:'约 1180 – 1230（现存形制多经 19 世纪重建）',
   dim:'单跨约 15 m · 扶壁墩高约 25.8 m · 后殿 13 组放射布置',
   desc:'飞扶壁不是一块斜板，而是三个分工明确的构件：<b>拱券</b>承受并汇集侧推力，<b>扶壁飞券</b>（那道凌空跨过的斜拱）把推力从高墙一点传到外侧，<b>扶壁墩</b>则是一根厚重的竖向质量，把推力压向地面，墩顶的小尖塔额外提供压重以抵抗倾覆。后殿的飞扶壁要跨越两重回廊，单跨约 15 米，呈放射状环绕半圆室。',
   note:'绕到侧面观察：飞券、拱券、扶壁墩是三个独立建模的三维体量，推力传递路径清晰可读。',
   cam:{pos:[80, 28, 65], tgt:[50, 19, 16], fov:38} },

 { id:'spire', num:'07', name:'尖塔（复建）', sub:'Flèche reconstruite', fr:'Flèche · 96 m',
   era:'13 世纪原塔 → 1859 年 Viollet-le-Duc 重建 → 2019 年焚毁 → 2024 年复建',
   dim:'高 96 m（自地面）· 自屋脊起约 55 m · 橡木骨架 + 铅皮覆面 · 八角锥体',
   desc:'现存尖塔按 Viollet-le-Duc 1859 年的形制复建：橡木骨架外覆铅皮，八角锥体，塔基四角各立一座小尖塔，八座高天窗环绕鼓座，塔身再分三层小天窗，顶端为十字架与风向鸡。1859 年那只铜鸡在 2019 年大火后从瓦砾中被寻回，修复后重新装回塔尖。',
   note:'画面上如何读出「复建」：塔身覆面用的是明显更亮的<b>新铅皮</b>（高金属度、低粗糙度），与其余屋面风化发暗的老铅皮形成对照；塔尖旁另有一枚「2019 焚毁 · 2024 复建」的空间标注。',
   cam:{pos:[55, 22, 80], tgt:[11, 88, 0], fov:30} }
];

/* ── 相机防穿模：室内天花板区域 ── */
const CEIL=[
  {x0:X.facadeIn,x1:X.trW,z0:-Z.vessel-0.3,z1:Z.vessel+0.3,y:30.4,roof:35.0},
  {x0:X.trW,x1:X.trE,z0:-Z.naveWall,z1:Z.naveWall,y:30.4,roof:35.0},
  {x0:X.trE,x1:X.apseC,z0:-Z.vessel-0.3,z1:Z.vessel+0.3,y:30.4,roof:35.0},
  {x0:X.trW,x1:X.trE,z0:Z.naveWall,z1:Z.tran,y:30.4,roof:35.0},
  {x0:X.trW,x1:X.trE,z0:-Z.tran,z1:-Z.naveWall,y:30.4,roof:35.0},
  {x0:X.facadeIn,x1:X.trW,z0:Z.naveWall,z1:Z.a1out,y:16.4,roof:20.8},
  {x0:X.facadeIn,x1:X.trW,z0:-Z.a1out,z1:-Z.naveWall,y:16.4,roof:20.8},
  {x0:X.facadeIn,x1:X.trW,z0:Z.a1wall,z1:Z.a2out,y:13.4,roof:17.6},
  {x0:X.facadeIn,x1:X.trW,z0:-Z.a2out,z1:-Z.a1wall,y:13.4,roof:17.6}
];

const TEX={};

P3D.register({
  id:'notre-dame',
  meta:{ title:'巴黎圣母院', sub:'NOTRE-DAME DE PARIS', badge:'PROCEDURAL · PHASE 0', load:'NOTRE · DAME' },
  sunHour:7.5,
  /* 调色板：奥斯曼奶油为全场统一调性，本包按实物固有色偏移。
     石材＝吕特斯石灰岩（calcaire lutétien，巴黎近郊采石场），2024 修复后
     激光+乳胶膜清洗过 42,000 m² 石面，比火灾前明显更白更亮。
     屋面＝铅皮（plomb），不是锌板——立缝锌顶是奥斯曼公寓的做法，不是中世纪教堂。
     参考照片实测（2017-10 火灾前实拍，Wikimedia Commons）：
       石材 #9b9180 H38° S17% V61%（清洗前，本包按修复后上调明度）
       铅皮屋面 #aca399 H32° S11% V68% —— 暖浅灰，不是蓝灰 */
  palette:{ base:'haussmann',
    /* ⚠️ 贴图 tint 与材质 color 是相乘的，别在两边都压暗——
       实测两边各取 0.65 就变成 0.42，暖浅灰的铅顶会渲成深棕。
       这里把颜色交给 tint 承担，材质 color 留在接近白的位置 */
    m:{ stone:0xe6dac0, stone2:0xbfb298, stoneNew:0xf2e8d4,
        lead:0xeae4da, leadNew:0xf2eee7 },
    tint:{ stone:[212,201,179], stone2:[174,163,143], lead:0xcbc3b6, leadNew:0xdfd9cf },
    /* 铅皮氧化后是哑光的。引擎默认 metalness 0.62 是「新铅」的调法，
       在蓝天 IBL 下会把屋面反射成饱和蓝——那是假的，实测固有色 H32° 暖浅灰 */
    mat:{ lead:{metalness:0.14, roughness:0.86, envMapIntensity:0.45},
          leadNew:{metalness:0.22, roughness:0.70, envMapIntensity:0.60} },
    tex:{ wall:'ashlar', roof:'lead' } },
  light:'curated',
  dossier:DOSSIER,
  ceil:CEIL,
  interiorBox:{x0:-66,x1:47,z:25,y:38},
  /* 后殿半穹顶的相机推出（引擎 CEIL 是矩形区，盖不住圆弧后殿） */
  clampCam(p){
    const dx=p.x-X.apseC, dz=p.z;
    if(dx>0&&dx*dx+dz*dz<44&&p.y>0&&p.y<35&&p.y>30.2) p.y=30.2;
  },
  labels:[
    {pos:[11,102,0],scale:[36,9],text:'2019 焚毁 · 2024 复建',sub:'FLÈCHE RECONSTRUITE — 96 m',accent:true},
    {pos:[-59,76,0],scale:[30,7.5],text:'西立面双塔 69 m',sub:'TOURS OCCIDENTALES · 1210–1250'},
    {pos:[11,45,27],scale:[30,7.5],text:'北耳堂玫瑰窗 Ø 12.9 m',sub:'ROSE NORD · 13 世纪原玻璃'},
    {pos:[58,35,22],scale:[30,7.5],text:'后殿飞扶壁 · 单跨 15 m',sub:'ARCS-BOUTANTS DU CHEVET'},
    {pos:[-20,48,-16],scale:[30,7.5],text:'中殿六分肋架拱顶 33 m',sub:'VOÛTES SEXPARTITES'}
  ],

  /* 三扇玫瑰窗贴图 + 专属玻璃材质组 */
  textures(ctx){
    const H=ctx.helpers;
const PN=[[36,58,126],[150,44,44],[70,40,112],[186,148,54],[36,96,74],[200,196,186]];
const PW=[[44,64,132],[156,52,48],[88,44,124],[182,142,58],[40,92,80],[196,190,178]];
const PS=[[152,48,50],[52,70,140],[92,42,110],[190,150,58],[44,88,72],[198,192,180]];
TEX.roseW = H.makeRoseTexture(512,{seed:11,pal:PW,r1:0.155,medallion:{bg:[42,60,124],robe:[176,142,60],halo:[226,206,150]},zones:[
  {kind:'lance',n:12,r0:0.20,r1:0.40,gap:0.030,pal:[PW[1],PW[3],PW[0],PW[4]]},
  {kind:'quatre',n:24,r0:0.44,r1:0.68,gap:0.014,pal:[PW[0],PW[2],PW[1],PW[5]]},
  {kind:'box',n:32,r0:0.72,r1:0.89,gap:0.010,pal:[PW[3],PW[0],PW[1],PW[2]]}]});
TEX.roseN = H.makeRoseTexture(512,{seed:23,pal:PN,r1:0.145,medallion:{bg:[34,54,118],robe:[168,50,52],halo:[224,204,146]},zones:[
  {kind:'lance',n:16,r0:0.19,r1:0.38,gap:0.022,pal:[PN[0],PN[1],PN[2],PN[3]]},
  {kind:'quatre',n:32,r0:0.42,r1:0.66,gap:0.010,pal:[PN[1],PN[0],PN[4],PN[3]]},
  {kind:'box',n:40,r0:0.70,r1:0.88,gap:0.008,pal:[PN[3],PN[0],PN[1],PN[5]]}]});
TEX.roseS = H.makeRoseTexture(512,{seed:37,pal:PS,r1:0.145,medallion:{bg:[150,52,52],robe:[58,74,140],halo:[228,206,150]},zones:[
  {kind:'lance',n:16,r0:0.19,r1:0.38,gap:0.022,pal:[PS[1],PS[3],PS[0],PS[2]]},
  {kind:'quatre',n:32,r0:0.42,r1:0.66,gap:0.010,pal:[PS[0],PS[1],PS[3],PS[4]]},
  {kind:'box',n:40,r0:0.70,r1:0.88,gap:0.008,pal:[PS[3],PS[1],PS[0],PS[2]]}]});

    ctx.addGlass('gw', TEX.roseW, 1.15);
    ctx.addGlass('gn', TEX.roseN, 1.32);
    ctx.addGlass('gs_', TEX.roseS, 1.22);
  },

  /* 全部几何：中殿/立面/双塔/耳堂/后殿/飞扶壁/尖塔 */
  async build(ctx){
    const {G,T,M,step,raf,solid,scene}=ctx;
    const {arch,archT,ARCH_N,ARCH_M,clamp,lerp,TAU,mulberry32,makeNoise,fbmFactory,
           archPts,cylBand,frameV,frameW,RIB_PROF,buildRose}=ctx.helpers;

/* ── 地面 ─────────────────────────────────────────────────────── */
step(28,'铺设地面与室内地坪'); await raf();
G.floor.box(4, 0.05, 0, 122, 0.1, 44, 0.15);
G.floor.box(48, 0.05, 0, 34, 0.1, 42, 0.15);

/* ── 中殿 ─────────────────────────────────────────────────────── */
step(34,'砌筑中殿：柱列 · 高窗 · 六分肋架拱顶'); await raf();
(function nave(){
  const gs=G.stone, gd=G.dark, gg=G.gwin, gl=G.lead;
  const x0=X.facadeIn, bayW=NAVE_BAY;

  for(const side of [-1,1]){
    const zv=side*Z.vessel, zw=side*Z.naveWall;
    const zA=Math.min(zv,zw), zB=Math.max(zv,zw);

    /* 高窗墙：每开间一个尖拱窗 */
    for(let b=0;b<NAVE_BAYS;b++){
      const xa=x0+b*bayW, xb=xa+bayW, mx=1.05;
      gs.box((xa+xb)/2, Y.clereSill/2, (zA+zB)/2, bayW, Y.clereSill, zB-zA, 0.30);
      gs.box(xa+mx/2, (Y.clereSill+Y.wallTop)/2, (zA+zB)/2, mx, Y.wallTop-Y.clereSill, zB-zA, 0.30);
      gs.box(xb-mx/2, (Y.clereSill+Y.wallTop)/2, (zA+zB)/2, mx, Y.wallTop-Y.clereSill, zB-zA, 0.30);
      const wx0=xa+mx, wx1=xb-mx;
      const pts=[[wx0,Y.clereHead]];
      for(let i=0;i<=14;i++){const t=i/14; pts.push([lerp(wx0,wx1,t), Y.clereHead+(Y.clereApex-Y.clereHead)*arch(t)]);}
      pts.push([wx1,Y.clereHead]); pts.push([wx1,Y.wallTop]); pts.push([wx0,Y.wallTop]);
      gs.prism(pts,2,zA,zB,0.30);
      solid(wx0,Y.clereHead,zA,wx1,Y.wallTop,zB);
      /* 玻璃 */
      const gp=[[wx0+0.18,Y.clereSill+0.18],[wx1-0.18,Y.clereSill+0.18],[wx1-0.18,Y.clereHead]];
      for(let i=14;i>=0;i--){const t=i/14; gp.push([lerp(wx0,wx1,t), Y.clereHead+(Y.clereApex-Y.clereHead)*arch(t)-0.18]);}
      gp.push([wx0+0.18,Y.clereHead]);
      gg.prism(gp,2,(zA+zB)/2-0.06,(zA+zB)/2+0.06,0.55);
      for(let k=1;k<=2;k++)
        gs.box(lerp(wx0,wx1,k/3), (Y.clereSill+Y.clereHead)/2+1.0, (zA+zB)/2, 0.20, (Y.clereHead-Y.clereSill)+2.4, 0.46, 0.6);
      gs.box((wx0+wx1)/2, Y.clereHead-0.9, (zA+zB)/2, wx1-wx0, 0.22, 0.46, 0.6);
      gs.torus((wx0+wx1)/2, Y.clereHead+0.55, (zA+zB)/2+side*0.16, 0.42, 0.11, 2, 12, 6, 0.4);
    }

    /* 柱列：强柱 / 弱柱交替 */
    for(let i=0;i<=NAVE_BAYS;i++){
      const x=x0+i*bayW, heavy=(i%2===0), zc=zv+side*0.25, r=heavy?1.02:0.74;
      gs.box(x,0.55,zc, r*2.5,1.1,r*2.5, 0.35);
      gs.cyl(x,(1.1+Y.arcade)/2,zc, r,r*0.94, Y.arcade-1.1, heavy?14:10, 0.34);
      gs.cyl(x,Y.arcade+0.42,zc, r*1.18,r*1.02, 0.84, heavy?14:10, 0.6);
      solid(x-r*1.3,0,zc-r*1.3, x+r*1.3, Y.arcade+0.9, zc+r*1.3);
      const nS=heavy?7:4;
      for(let k=0;k<nS;k++){
        const a=-Math.PI/2+(k-(nS-1)/2)*0.42;
        gs.cyl(x+Math.cos(a)*r*0.86, (1.1+Y.arcade)/2, zc+Math.sin(a)*r*0.86, 0.26,0.24, Y.arcade-1.1, 8, 0.5);
      }
      const nR=heavy?3:1;
      for(let k=0;k<nR;k++)
        gs.cyl(x+(k-(nR-1)/2)*0.62, (Y.arcade+0.9+Y.naveSpring)/2, zc+side*0.05, 0.30,0.27, Y.naveSpring-Y.arcade-0.9, 9, 0.5);
      gs.box(x, Y.clereSill-0.35, zv+side*0.16, r*2.2, 0.34, 0.5, 0.6);
    }
    /* 主拱廊 */
    for(let b=0;b<NAVE_BAYS;b++){
      const xa=x0+b*bayW, xb=xa+bayW, zc=zv+side*0.25;
      gs.sweep(archPts(xa,zc,xb,zc,Y.arcade+0.85,Y.arcadeApex+0.85,16,arch),
        [[-0.34,0.62],[-0.34,-0.30],[0.34,-0.30],[0.34,0.62],[-0.34,0.62]],0.55,frameV);
      gs.sweep(archPts(xa,zc+side*0.20,xb,zc+side*0.20,Y.arcade+0.85,Y.arcadeApex+0.85,16,arch),
        [[-0.12,0.66],[-0.12,0.44],[0.12,0.44],[0.12,0.66],[-0.12,0.66]],0.55,frameV);
      gd.box(xa+bayW/2,(Y.arcade+0.85)/2, side*(Z.vessel+0.62), bayW-1.6, Y.arcade+0.85, 0.12, 0.4);
    }
  }

  /* 六分肋架拱顶 */
  const ys=Y.naveSpring, yc=Y.naveCrown;
  const yFormeret=Y.naveCrown-2.6;
  const fan=(A,B,boss,peak)=>G.stone.grid(9,11,(u,v)=>{
    const P=archT(v,ARCH_N,ARCH_M)*peak, g=Math.sin(u*Math.PI/2);
    return [ lerp(lerp(A[0],B[0],v),boss[0],u), ys+(yc-ys)*(g+(1-g)*P), lerp(lerp(A[1],B[1],v),boss[1],u) ];
  });
  const rib=(ax,az,bx,bz,w,yTop)=>G.stone.sweep(archPts(ax,az,bx,bz,ys,yTop===undefined?yc:yTop,14,arch),
    RIB_PROF.map(p=>[p[0]*w,p[1]*w*1.35]),0.5,frameV);
  for(let k=0;k<NAVE_BAYS/2;k++){
    const xa=x0+2*k*bayW, xm=xa+bayW, xb=xa+2*bayW;
    const boss=[xm,0], fw=Z.vessel, pk=(yFormeret-ys)/(yc-ys);
    fan([xa,-fw],[xa,fw],boss,1.0);
    fan([xa,-fw],[xm,-fw],boss,pk); fan([xa,fw],[xm,fw],boss,pk);
    fan([xb,-fw],[xb,fw],boss,1.0);
    fan([xb,-fw],[xm,-fw],boss,pk); fan([xb,fw],[xm,fw],boss,pk);
    rib(xa,-fw,xa,fw,0.52); rib(xb,-fw,xb,fw,0.52); rib(xm,-fw,xm,fw,0.46);
    rib(xa,-fw,xm,0,0.58); rib(xa,fw,xm,0,0.58); rib(xb,-fw,xm,0,0.58); rib(xb,fw,xm,0,0.58);
    G.stone.sweep(archPts(xa,0,xm,0,yc,yc,6,()=>1),RIB_PROF.map(p=>[p[0]*0.40,p[1]*0.48]),0.5,frameV);
    G.stone.sweep(archPts(xm,0,xb,0,yc,yc,6,()=>1),RIB_PROF.map(p=>[p[0]*0.40,p[1]*0.48]),0.5,frameV);
    for(const s of [-1,1]){
      G.stone.sweep(archPts(xa,s*fw,xm,s*fw,ys,yFormeret,12,arch),RIB_PROF.map(p=>[p[0]*0.34,p[1]*0.41]),0.5,frameV);
      G.stone.sweep(archPts(xm,s*fw,xb,s*fw,ys,yFormeret,12,arch),RIB_PROF.map(p=>[p[0]*0.34,p[1]*0.41]),0.5,frameV);
    }
    G.stone.cyl(xm, yc-0.30, 0, 0.95, 0.62, 0.9, 12, 0.6);
    G.stone.disc(xm, yc-0.78, 0, 0.62, 1, 12);
  }

  /* 中殿屋面 */
  for(const side of [-1,1]){
    const z1=side*(Z.naveWall+0.45);
    const p0=[x0-1.2,Y.ridge,0], p1=[X.trW+1.2,Y.ridge,0];
    const p2=[X.trW+1.2,Y.wallTop-0.2,z1], p3=[x0-1.2,Y.wallTop-0.2,z1];
    gl.face(side>0?[p3,p2,p1,p0]:[p0,p1,p2,p3],0.34);
  }
  gl.box((x0+X.trW)/2, Y.ridge+0.30, 0, (X.trW-x0)+2.4, 0.5, 1.4, 0.35);
})();

/* ── 侧廊 + 耳堂 ───────────────────────────────────────────────── */
step(42,'砌筑四重侧廊 · 交叉部 · 耳堂'); await raf();
(function aisles(){
  const gs=G.stone, gs2=G.stone2, gg=G.gwin, gd=G.dark, gl=G.lead;
  const x0=X.facadeIn, x1=X.trW, bw=NAVE_BAY;

  function vaultBay(bx0,bx1,bz0,bz1,ys,yc,rw){
    const cx=(bx0+bx1)/2, cz=(bz0+bz1)/2;
    const fan=(A,B,boss)=>gs.grid(7,8,(u,v)=>{
      const P=archT(v,ARCH_N,ARCH_M), g=Math.sin(u*Math.PI/2);
      return [ lerp(lerp(A[0],B[0],v),boss[0],u), ys+(yc-ys)*(g+(1-g)*P), lerp(lerp(A[1],B[1],v),boss[1],u) ];
    });
    fan([bx0,bz0],[bx1,bz0],[cx,cz]); fan([bx1,bz0],[bx1,bz1],[cx,cz]);
    fan([bx1,bz1],[bx0,bz1],[cx,cz]); fan([bx0,bz1],[bx0,bz0],[cx,cz]);
    const P=RIB_PROF.map(p=>[p[0]*rw,p[1]*rw*1.3]);
    gs.sweep(archPts(bx0,bz0,bx1,bz1,ys,yc,10,arch),P,0.5,frameV);
    gs.sweep(archPts(bx0,bz1,bx1,bz0,ys,yc,10,arch),P,0.5,frameV);
    gs.sweep(archPts(bx0,bz0,bx1,bz0,ys,yc,10,arch),P,0.5,frameV);
    gs.sweep(archPts(bx0,bz1,bx1,bz1,ys,yc,10,arch),P,0.5,frameV);
    gs.cyl(cx, yc-0.22, cz, 0.46, 0.30, 0.5, 10, 0.6);
  }

  for(const side of [-1,1]){
    /* 内侧廊 */
    {
      const zi=Math.min(side*Z.naveWall,side*Z.a1out), zo=Math.max(side*Z.naveWall,side*Z.a1out);
      for(let b=0;b<NAVE_BAYS;b++)
        vaultBay(x0+b*bw, x0+(b+1)*bw, zi, zo, Y.a1Spring, Y.a1Crown, 0.34);
    }
    /* 内外侧廊之间的列柱 + 连拱 */
    {
      const zc=side*(Z.a1out+Z.a1wall)/2;
      for(let b=0;b<NAVE_BAYS;b++){
        const xa=x0+b*bw, xb=xa+bw, mx=1.0;
        const wTop=Y.a1Crown+1.2;
        gs.box(xa+mx/2, wTop/2, zc, mx, wTop, (Z.a1wall-Z.a1out), 0.30);
        const ox0=xa+mx, ox1=xb-mx, oy=7.0, oy2=8.8;
        const pts=[[ox0,oy]];
        for(let i=0;i<=12;i++){const t=i/12; pts.push([lerp(ox0,ox1,t), oy+(oy2-oy)*arch(t)]);}
        pts.push([ox1,oy]); pts.push([ox1,wTop]); pts.push([ox0,wTop]);
        gs.prism(pts,2,zc-(Z.a1wall-Z.a1out)/2, zc+(Z.a1wall-Z.a1out)/2, 0.30);
        gd.box((ox0+ox1)/2, oy/2, zc, ox1-ox0, oy, (Z.a1wall-Z.a1out)*0.7, 0.4);
        gs.sweep(archPts(ox0,zc+side*0.42,ox1,zc+side*0.42,oy,oy2,12,arch),
          [[-0.20,0.40],[-0.20,-0.34],[0.20,-0.34],[0.20,0.40],[-0.20,0.40]],0.55,frameV);
        gs.sweep(archPts(ox0,zc-side*0.42,ox1,zc-side*0.42,oy,oy2,12,arch),
          [[-0.20,0.40],[-0.20,-0.34],[0.20,-0.34],[0.20,0.40],[-0.20,0.40]],0.55,frameV);
      }
      for(let i=0;i<=NAVE_BAYS;i++){
        const x=x0+i*bw, r=0.58;
        gs.box(x,0.5,zc,1.6,1.0,1.6,0.35);
        gs.cyl(x,(1.0+7.0)/2,zc, r,r*0.94, 6.0, 10, 0.34);
        gs.cyl(x,7.0+0.36,zc, r*1.20,r*1.02, 0.72, 10, 0.6);
        solid(x-0.95,0,zc-0.95,x+0.95,Y.a1Crown+1.2,zc+0.95);
      }
    }
    /* 外侧廊拱顶 */
    {
      const zi=Math.min(side*Z.a1wall,side*Z.a2out), zo=Math.max(side*Z.a1wall,side*Z.a2out);
      for(let b=0;b<NAVE_BAYS;b++)
        vaultBay(x0+b*bw, x0+(b+1)*bw, zi, zo, Y.a2Spring, Y.a2Crown, 0.30);
    }
    /* 外侧廊外墙 + 尖拱窗 */
    for(let b=0;b<NAVE_BAYS;b++){
      const xa=x0+b*bw, xb=xa+bw, mx=1.15;
      const zA=Math.min(side*Z.a2out,side*Z.outer), zB=Math.max(side*Z.a2out,side*Z.outer);
      const sy=2.6, hy=12.6, ay=15.0;
      gs2.box((xa+xb)/2, sy/2, (zA+zB)/2, bw, sy, zB-zA, 0.28);
      gs2.box(xa+mx/2, (sy+Y.wall2Top)/2, (zA+zB)/2, mx, Y.wall2Top-sy, zB-zA, 0.28);
      gs2.box(xb-mx/2, (sy+Y.wall2Top)/2, (zA+zB)/2, mx, Y.wall2Top-sy, zB-zA, 0.28);
      const wx0=xa+mx, wx1=xb-mx;
      const pts=[[wx0,hy]];
      for(let i=0;i<=12;i++){const t=i/12; pts.push([lerp(wx0,wx1,t), hy+(ay-hy)*arch(t)]);}
      pts.push([wx1,hy]); pts.push([wx1,Y.wall2Top]); pts.push([wx0,Y.wall2Top]);
      gs2.prism(pts,2,zA,zB,0.28);
      const gp=[[wx0+0.16,sy+0.16],[wx1-0.16,sy+0.16],[wx1-0.16,hy]];
      for(let i=12;i>=0;i--){const t=i/12; gp.push([lerp(wx0,wx1,t), hy+(ay-hy)*arch(t)-0.16]);}
      gp.push([wx0+0.16,hy]);
      gg.prism(gp,2,(zA+zB)/2-0.06,(zA+zB)/2+0.06,0.5);
      for(let k=1;k<=2;k++) gs2.box(lerp(wx0,wx1,k/3),(sy+hy)/2+0.8,(zA+zB)/2,0.22,(hy-sy)+2.0,0.42,0.6);
      gs2.box((wx0+wx1)/2, hy-0.7, (zA+zB)/2, wx1-wx0, 0.22, 0.42, 0.6);
    }
    solid(x0,0,Math.min(side*Z.a2out,side*Z.outer), x1, Y.wall2Top, Math.max(side*Z.a2out,side*Z.outer));

    /* 侧廊屋面 */
    {
      const zi=side*Z.naveWall, zo=side*Z.a1out;
      const A=[x0-1.0,Y.roofA1in,zi], B=[x1+1.0,Y.roofA1in,zi];
      const C=[x1+1.0,Y.roofA1out,zo], Dd=[x0-1.0,Y.roofA1out,zo];
      gl.face(side>0?[Dd,C,B,A]:[A,B,C,Dd],0.34);
      const zi2=side*Z.a1wall, zo2=side*Z.a2out;
      const E=[x0-1.0,Y.roofA2in,zi2], F=[x1+1.0,Y.roofA2in,zi2];
      const Gg=[x1+1.0,Y.roofA2out,zo2], H=[x0-1.0,Y.roofA2out,zo2];
      gl.face(side>0?[H,Gg,F,E]:[E,F,Gg,H],0.34);
    }
    /* 外墙压顶 + 露台栏杆 */
    {
      const zc=side*(Z.a2out+Z.outer)/2;
      gs2.box((x0+x1)/2, Y.wall2Top+0.20, zc, x1-x0, 0.40, (Z.outer-Z.a2out)+0.5, 0.3);
      const nB=Math.floor((x1-x0)/0.85);
      for(let i=0;i<=nB;i++) gs2.cyl(x0+i*(x1-x0)/nB, Y.wall2Top+0.85, zc, 0.13,0.13,0.9, 6, 0.8);
    }
  }

  /* 耳堂 + 交叉部 */
  {
    const yS=24.0, yC=Y.vaultH;
    const quadFan=(bx0,bx1,bz0,bz1,ys,yc,rw)=>{
      const cx=(bx0+bx1)/2, cz=(bz0+bz1)/2;
      const fan=(A,B,boss)=>gs.grid(8,9,(u,v)=>{
        const P=archT(v,ARCH_N,ARCH_M), g=Math.sin(u*Math.PI/2);
        return [ lerp(lerp(A[0],B[0],v),boss[0],u), ys+(yc-ys)*(g+(1-g)*P), lerp(lerp(A[1],B[1],v),boss[1],u) ];
      });
      fan([bx0,bz0],[bx1,bz0],[cx,cz]); fan([bx1,bz0],[bx1,bz1],[cx,cz]);
      fan([bx1,bz1],[bx0,bz1],[cx,cz]); fan([bx0,bz1],[bx0,bz0],[cx,cz]);
      const P=RIB_PROF.map(p=>[p[0]*rw,p[1]*rw*1.3]);
      gs.sweep(archPts(bx0,bz0,bx1,bz1,ys,yc,12,arch),P,0.5,frameV);
      gs.sweep(archPts(bx0,bz1,bx1,bz0,ys,yc,12,arch),P,0.5,frameV);
      gs.sweep(archPts(bx0,bz0,bx1,bz0,ys,yc,12,arch),P,0.5,frameV);
      gs.sweep(archPts(bx0,bz1,bx1,bz1,ys,yc,12,arch),P,0.5,frameV);
      gs.cyl(cx, yc-0.28, cz, 0.85, 0.55, 0.8, 12, 0.6);
    };
    for(const sd of [-1,1]){
      const zi=Math.min(sd*Z.naveWall, sd*(Z.tran-1.3)), zo=Math.max(sd*Z.naveWall, sd*(Z.tran-1.3));
      quadFan(X.trW,X.trE, zi,(zi+zo)/2, yS,yC, 0.46);
      quadFan(X.trW,X.trE, (zi+zo)/2,zo, yS,yC, 0.46);
      for(const xw of [X.trW,X.trE]){
        gs.box(xw, Y.wallTop/2, sd*(Z.naveWall+Z.tran)/2, 1.5, Y.wallTop, Math.abs(Z.tran-Z.naveWall), 0.28);
        solid(xw-0.75,0,Math.min(sd*Z.naveWall,sd*Z.tran), xw+0.75, Y.wallTop, Math.max(sd*Z.naveWall,sd*Z.tran));
      }
      const ridgeX=(X.trW+X.trE)/2;
      for(const sx of [-1,1]){
        const xou = sx>0? X.trE+0.4 : X.trW-0.4;
        const a=[ridgeX,Y.trRidge,zi], b=[ridgeX,Y.trRidge,zo];
        const c=[xou,Y.trEave,zo], d=[xou,Y.trEave,zi];
        gl.face(sx>0?[a,b,c,d]:[d,c,b,a],0.34);
      }
      gl.box(ridgeX, Y.trRidge+0.28, (zi+zo)/2, 1.3, 0.46, (zo-zi)+2.2, 0.35);
    }
    /* 交叉部 */
    {
      const zA=-Z.naveWall, zB=Z.naveWall;
      quadFan(X.trW,X.trE,zA,zB,yS,yC,0.55);
      for(const px of [X.trW,X.trE]) for(const pz of [zA,zB]){
        gs.box(px,0.6,pz,2.9,1.2,2.9,0.35);
        gs.cyl(px,(1.2+Y.arcade)/2,pz,1.22,1.12,Y.arcade-1.2,16,0.34);
        gs.cyl(px,Y.arcade+0.5,pz,1.44,1.24,0.9,16,0.6);
        for(let k=0;k<8;k++){const a=k/8*TAU;
          gs.cyl(px+Math.cos(a)*1.08,(1.2+Y.arcade)/2,pz+Math.sin(a)*1.08,0.32,0.29,Y.arcade-1.2,8,0.5);}
        for(let k=0;k<4;k++){const a=Math.PI/4+k/4*TAU;
          gs.cyl(px+Math.cos(a)*0.7,(Y.arcade+0.95+yS)/2,pz+Math.sin(a)*0.7,0.34,0.30,yS-Y.arcade-0.95,9,0.5);}
        solid(px-1.6,0,pz-1.6,px+1.6,yS,pz+1.6);
      }
      /* 交叉部四坡屋面 */
      const cx=(X.trW+X.trE)/2, R=11.5, yb=Y.spireBase-6, yt=Y.spireBase;
      const corners=[[cx+R,0],[cx,R],[cx-R,0],[cx,-R]];
      for(let q=0;q<4;q++){
        const p1=corners[q], p2=corners[(q+1)%4];
        gl.face([[cx,yt,0],[p1[0],yb,p1[1]],[p2[0],yb,p2[1]]],0.34);
      }
    }
  }
})();

/* ── 后殿（半圆室 + 放射小教堂）───────────────────────────────── */
step(52,'砌筑后殿半圆室 · 回廊 · 放射小教堂'); await raf();
(function chevet(){
  const gs=G.stone, gs2=G.stone2, gg=G.gwin, gl=G.lead;
  const cx=X.apseC, cz=0, NS=13;
  const R0=6.2, R1=7.4, R2=13.6, R3=14.8, R4=18.6, R5=19.8;
  const A0=-Math.PI/2, A1=Math.PI/2;
  const ang=t=>lerp(A0,A1,t);
  const ysA=25.5, ycA=Y.vaultH-1.0;

  /* 半圆室穹顶（扇形肋） */
  {
    const boss=[cx,cz];
    for(let s=0;s<NS;s++){
      const a0=ang(s/NS), a1=ang((s+1)/NS);
      gs.grid(8,8,(u,v)=>{
        const P=archT(v,ARCH_N,ARCH_M), g=Math.sin(u*Math.PI/2);
        const A=[cx+R0*Math.cos(a0),cz+R0*Math.sin(a0)], B=[cx+R0*Math.cos(a1),cz+R0*Math.sin(a1)];
        return [ lerp(lerp(A[0],B[0],v),boss[0],u), ysA+(ycA-ysA)*(g+(1-g)*P), lerp(lerp(A[1],B[1],v),boss[1],u) ];
      });
    }
    for(let s=0;s<=NS;s++){
      const a=ang(s/NS);
      gs.sweep(archPts(cx+R0*Math.cos(a),cz+R0*Math.sin(a), cx,cz, ysA,ycA, 12, arch),
        RIB_PROF.map(p=>[p[0]*0.44,p[1]*0.57]),0.5,frameV);
    }
    gs.cyl(cx, ycA-0.30, cz, 1.0, 0.6, 0.9, 14, 0.6);
  }
  /* 环形拱顶（回廊 / 小教堂环） */
  function annulus(ri,ro,ys,yc,rw){
    for(let s=0;s<NS;s++){
      const a0=ang(s/NS), a1=ang((s+1)/NS);
      gs.grid(6,10,(u,v)=>{
        const a=lerp(a0,a1,u), r=lerp(ri,ro,v);
        return [cx+r*Math.cos(a), ys+(yc-ys)*archT(v,ARCH_N,ARCH_M), cz+r*Math.sin(a)];
      });
    }
    if(rw>0) for(let s=0;s<=NS;s++){
      const a=ang(s/NS);
      gs.sweep(archPts(cx+ri*Math.cos(a),cz+ri*Math.sin(a), cx+ro*Math.cos(a),cz+ro*Math.sin(a), ys,yc, 12, arch),
        RIB_PROF.map(p=>[p[0]*rw,p[1]*rw*1.3]),0.5,frameV);
    }
  }
  annulus(R1,R2,16.0,21.0,0.34);
  annulus(R3,R4, 8.5,14.4,0.30);

  /* 半圆室高窗：柱面环带 */
  for(let s=0;s<NS;s++){
    const a0=ang(s/NS), a1=ang((s+1)/NS), w0=lerp(a0,a1,0.13), w1=lerp(a0,a1,0.87);
    const sy=19.5, hy=24.0, ay=26.4, top=33.5;
    cylBand(gs,cx,cz,R0,R1,a0,a1, 0, sy, 3, 0.30);                       // 窗台以下
    cylBand(gs,cx,cz,R0,R1,a0,w0, sy, top, 2, 0.30);                     // 左垛
    cylBand(gs,cx,cz,R0,R1,w1,a1, sy, top, 2, 0.30);                     // 右垛
    cylBand(gs,cx,cz,R0,R1,w0,w1, t=>hy+(ay-hy)*arch(t), top, 12, 0.30); // 拱肩
    cylBand(gg,cx,cz,(R0+R1)/2,(R0+R1)/2, w0,w1, sy, t=>hy+(ay-hy)*arch(t)-0.18, 12, 0.55); // 玻璃
    for(let k=1;k<=2;k++){
      const a=lerp(w0,w1,k/3);
      gs.box(cx+R1*0.92*Math.cos(a),(sy+hy)/2+1.0, cz+R1*0.92*Math.sin(a), 0.34,(hy-sy)+2.6,0.34,0.6);
    }
  }
  /* 放射小教堂外墙 + 窗 */
  for(let s=0;s<NS;s++){
    const a0=ang(s/NS), a1=ang((s+1)/NS), w0=lerp(a0,a1,0.12), w1=lerp(a0,a1,0.88);
    const sy=2.6, hy=13.2, ay=15.6, top=17.5;
    cylBand(gs2,cx,cz,R4,R5,a0,a1, 0, sy, 3, 0.28);
    cylBand(gs2,cx,cz,R4,R5,a0,w0, sy, top, 2, 0.28);
    cylBand(gs2,cx,cz,R4,R5,w1,a1, sy, top, 2, 0.28);
    cylBand(gs2,cx,cz,R4,R5,w0,w1, t=>hy+(ay-hy)*arch(t), top, 12, 0.28);
    cylBand(gg,cx,cz,(R4+R5)/2,(R4+R5)/2, w0,w1, sy, t=>hy+(ay-hy)*arch(t)-0.16, 12, 0.55);
    for(let k=1;k<=2;k++){
      const a=lerp(w0,w1,k/3);
      gs2.box(cx+R5*0.94*Math.cos(a),(sy+hy)/2+1.0, cz+R5*0.94*Math.sin(a), 0.32,(hy-sy)+2.6,0.32,0.6);
    }
  }
  /* 后殿屋面：两重锥面 */
  {
    const seg=26, rIn=R0+0.4, rMd=R2+0.4, rOu=R5+0.2;
    const yIn=33.5, yMd=25.5, yOu=19.5;
    for(let i=0;i<seg;i++){
      const a0=ang(i/seg), a1=ang((i+1)/seg);
      const P=(r,y,a)=>[cx+r*Math.cos(a), y, cz+r*Math.sin(a)];
      gl.face([P(rIn,yIn,a0),P(rIn,yIn,a1),P(rMd,yMd,a1),P(rMd,yMd,a0)],0.34);
      gl.face([P(rMd,yMd,a0),P(rMd,yMd,a1),P(rOu,yOu,a1),P(rOu,yOu,a0)],0.34);
    }
  }
  /* 唱经楼直段 x:20 → 41 */
  {
    const xa=X.trE, xb=X.apseC, nb=4, cbw=(xb-xa)/nb;
    for(const side of [-1,1]){
      zv: {
        const zi=Math.min(side*Z.vessel,side*Z.naveWall), zo=Math.max(side*Z.vessel,side*Z.naveWall);
        for(let b=0;b<nb;b++){
          const c0=xa+b*cbw, c1=c0+cbw, mx=1.05;
          gs.box((c0+c1)/2, Y.clereSill/2, (zi+zo)/2, cbw, Y.clereSill, zo-zi, 0.30);
          gs.box(c0+mx/2, (Y.clereSill+Y.wallTop)/2, (zi+zo)/2, mx, Y.wallTop-Y.clereSill, zo-zi, 0.30);
          gs.box(c1-mx/2, (Y.clereSill+Y.wallTop)/2, (zi+zo)/2, mx, Y.wallTop-Y.clereSill, zo-zi, 0.30);
          const wx0=c0+mx, wx1=c1-mx;
          const pts=[[wx0,Y.clereHead]];
          for(let i=0;i<=14;i++){const t=i/14; pts.push([lerp(wx0,wx1,t), Y.clereHead+(Y.clereApex-Y.clereHead)*arch(t)]);}
          pts.push([wx1,Y.clereHead]); pts.push([wx1,Y.wallTop]); pts.push([wx0,Y.wallTop]);
          gs.prism(pts,2,zi,zo,0.30);
          const gp=[[wx0+0.18,Y.clereSill+0.18],[wx1-0.18,Y.clereSill+0.18],[wx1-0.18,Y.clereHead]];
          for(let i=14;i>=0;i--){const t=i/14; gp.push([lerp(wx0,wx1,t), Y.clereHead+(Y.clereApex-Y.clereHead)*arch(t)-0.18]);}
          gp.push([wx0+0.18,Y.clereHead]);
          gg.prism(gp,2,(zi+zo)/2-0.06,(zi+zo)/2+0.06,0.55);
          for(let k=1;k<=2;k++) gs.box(lerp(wx0,wx1,k/3),(Y.clereSill+Y.clereHead)/2+1.0,(zi+zo)/2,0.20,(Y.clereHead-Y.clereSill)+2.4,0.46,0.6);
          gs.box((wx0+wx1)/2, Y.clereHead-0.9, (zi+zo)/2, wx1-wx0, 0.22, 0.46, 0.6);
          gs.torus((wx0+wx1)/2, Y.clereHead+0.55, (zi+zo)/2+side*0.16, 0.42, 0.11, 2, 12, 6, 0.4);
        }
      }
      /* 唱经楼侧廊 */
      {
        const zi=Math.min(side*Z.naveWall,side*Z.a1out), zo=Math.max(side*Z.naveWall,side*Z.a1out);
        for(let b=0;b<nb;b++){
          const c0=xa+b*cbw, c1=c0+cbw, cx2=(c0+c1)/2, cz2=(zi+zo)/2;
          const fan=(A,B,boss)=>gs.grid(6,8,(u,v)=>{
            const P=archT(v,ARCH_N,ARCH_M), g=Math.sin(u*Math.PI/2);
            return [ lerp(lerp(A[0],B[0],v),boss[0],u), Y.a1Spring+(Y.a1Crown-Y.a1Spring)*(g+(1-g)*P), lerp(lerp(A[1],B[1],v),boss[1],u) ];
          });
          fan([c0,zi],[c1,zi],[cx2,cz2]); fan([c1,zi],[c1,zo],[cx2,cz2]);
          fan([c1,zo],[c0,zo],[cx2,cz2]); fan([c0,zo],[c0,zi],[cx2,cz2]);
        }
        const zA=Math.min(side*Z.a2out,side*Z.outer), zB=Math.max(side*Z.a2out,side*Z.outer);
        for(let b=0;b<nb;b++){
          const c0=xa+b*cbw, c1=c0+cbw, mx=1.15;
          const sy=2.6, hy=12.6, ay=15.0;
          const wx0=c0+mx, wx1=c1-mx;
          gs2.box((c0+c1)/2, Y.wall2Top/2, (zA+zB)/2, cbw, Y.wall2Top, zB-zA, 0.26);
          const pts=[[wx0,hy]];
          for(let i=0;i<=12;i++){const t=i/12; pts.push([lerp(wx0,wx1,t), hy+(ay-hy)*arch(t)]);}
          pts.push([wx1,hy]); pts.push([wx1,Y.wall2Top]); pts.push([wx0,Y.wall2Top]);
          const gp=[[wx0+0.16,sy+0.16],[wx1-0.16,sy+0.16],[wx1-0.16,hy]];
          for(let i=12;i>=0;i--){const t=i/12; gp.push([lerp(wx0,wx1,t), hy+(ay-hy)*arch(t)-0.16]);}
          gp.push([wx0+0.16,hy]);
          gg.prism(gp,2,(zA+zB)/2-0.06,(zA+zB)/2+0.06,0.5);
        }
        solid(xa,0,zA, xb, Y.wall2Top, zB);
        const zi2=side*Z.naveWall, zo2=side*Z.a2out;
        const E=[xa-1.0,Y.roofA2out,zo2], F=[xb+1.0,Y.roofA2out,zo2];
        const Gg=[xb+1.0,Y.roofA1in,zi2], H=[xa-1.0,Y.roofA1in,zi2];
        gl.face(side>0?[E,F,Gg,H]:[H,Gg,F,E],0.34);
      }
    }
    /* 唱经楼中厅拱顶 */
    for(let b=0;b<nb;b++){
      const c0=xa+b*cbw, c1=c0+cbw, cx2=(c0+c1)/2;
      const fan=(A,B,boss)=>gs.grid(7,9,(u,v)=>{
        const P=archT(v,ARCH_N,ARCH_M), g=Math.sin(u*Math.PI/2);
        return [ lerp(lerp(A[0],B[0],v),boss[0],u), Y.naveSpring+(Y.naveCrown-Y.naveSpring)*(g+(1-g)*P), lerp(lerp(A[1],B[1],v),boss[1],u) ];
      });
      fan([c0,-Z.vessel],[c1,-Z.vessel],[cx2,0]); fan([c1,-Z.vessel],[c1,Z.vessel],[cx2,0]);
      fan([c1,Z.vessel],[c0,Z.vessel],[cx2,0]); fan([c0,Z.vessel],[c0,-Z.vessel],[cx2,0]);
      const P=RIB_PROF.map(p=>[p[0]*0.42,p[1]*0.55]);
      gs.sweep(archPts(c0,-Z.vessel,c1,Z.vessel,Y.naveSpring,Y.naveCrown,12,arch),P,0.5,frameV);
      gs.sweep(archPts(c0,Z.vessel,c1,-Z.vessel,Y.naveSpring,Y.naveCrown,12,arch),P,0.5,frameV);
      gs.sweep(archPts(c0,-Z.vessel,c1,-Z.vessel,Y.naveSpring,Y.naveCrown,12,arch),P,0.5,frameV);
      gs.sweep(archPts(c0,Z.vessel,c1,Z.vessel,Y.naveSpring,Y.naveCrown,12,arch),P,0.5,frameV);
      gs.cyl(cx2, Y.naveCrown-0.26, 0, 0.8, 0.5, 0.7, 12, 0.6);
    }
    for(const side of [-1,1]){
      const zz=side*(Z.naveWall+0.45);
      const A=[xa-1.2,Y.wallTop-0.2,zz], B=[xb+1.0,Y.wallTop-0.2,zz];
      const C=[xb+1.0,Y.ridge,0], Dd=[xa-1.2,Y.ridge,0];
      gl.face(side>0?[A,B,C,Dd]:[Dd,C,B,A],0.34);
    }
    gl.box((xa+xb)/2, Y.ridge+0.30, 0, (xb-xa)+2.0, 0.5, 1.4, 0.35);
  }
})();

/* ── 飞扶壁 ─────────────────────────────────────────────────────── */
step(64,'架设飞扶壁：扶壁墩 · 拱券 · 扶壁飞券'); await raf();
(function flyingButtresses(){
  const gs=G.stone;

  /* 中殿两侧：11 组 × 2 = 22 组 */
  for(const side of [-1,1]) for(let i=0;i<=NAVE_BAYS;i++){
    const x=X.facadeIn+i*NAVE_BAY;
    const zWall=side*Z.outer, zPout=side*Z.pierOut;
    const zIn=Math.min(zWall,zPout), zOut=Math.max(zWall,zPout);
    const w=2.6, pH=Y.pierTop, zc=(zIn+zOut)/2;

    /* ① 扶壁墩 */
    gs.box(x, pH/2, zc, w, pH, zOut-zIn, 0.28);
    gs.box(x, pH+0.9, zc-side*0.10, w*0.80, 1.8, (zOut-zIn)*0.86, 0.30);
    gs.box(x, pH+2.5, zc-side*0.16, w*0.62, 1.4, (zOut-zIn)*0.72, 0.30);
    solid(x-w/2, 0, zIn, x+w/2, pH, zOut);
    /* 墩顶小尖塔（压重） */
    const py=pH+3.2, pz=zc-side*0.20;
    gs.cyl(x, py+1.0, pz, 0.62, 0.50, 2.0, 6, 0.6);
    gs.cyl(x, py+2.9, pz, 0.30, 0.0,  1.9, 6, 0.6);
    gs.box(x, py+0.1, pz, 1.5, 0.3, 1.5, 0.5);
    for(let k=0;k<4;k++){const a=Math.PI/4+k/4*TAU;
      gs.cyl(x+Math.cos(a)*0.66, py+0.75, pz+Math.sin(a)*0.66, 0.16, 0.0, 1.1, 5, 0.7);}
    /* 排水石 */
    gs.box(x, pH-2.2, zc + side*(zOut-zIn)*0.58, w*0.5, 0.7, 1.6, 0.5);
    /* 外侧壁柱 */
    gs.box(x, pH/2-2, zOut-side*0.02, w*1.25, pH-4, 0.5, 0.3);

    /* ② 上层飞券：单跨 15.0 m */
    {
      const zS=zc-side*0.2, zE=side*Z.naveWall;
      const yS=23.6, yE=28.4, th=1.15, nS=14;
      const f=t=>yS+(yE-yS)*t+Math.sin(Math.PI*t)*1.9;
      const poly=[];
      for(let k=0;k<=nS;k++){const t=k/nS; poly.push([lerp(zS,zE,t), f(t)]);}
      for(let k=nS;k>=0;k--){const t=k/nS; poly.push([lerp(zS,zE,t), f(t)+2.1+0.4*Math.cos(Math.PI*(t-0.5))]);}
      gs.prism(poly, 0, x-th, x+th, 0.30);
    }
    /* ③ 下层飞券 */
    {
      const zS=zc-side*0.2, zE=side*(Z.a1wall+0.5);
      const yS=14.4, yE=17.2, th=0.85, nS=10;
      const f=t=>yS+(yE-yS)*t+Math.sin(Math.PI*t)*0.9;
      const poly=[];
      for(let k=0;k<=nS;k++){const t=k/nS; poly.push([lerp(zS,zE,t), f(t)]);}
      for(let k=nS;k>=0;k--){const t=k/nS; poly.push([lerp(zS,zE,t), f(t)+1.7]);}
      gs.prism(poly, 0, x-th, x+th, 0.30);
    }
    /* ④ 两层飞券之间的小拱券廊（拱券） */
    {
      const zA=side*(Z.a1wall+0.8), zB=zc-side*0.3;
      const z0=Math.min(zA,zB), z1=Math.max(zA,zB), nA=3;
      for(let k=0;k<nA;k++){
        const c0=lerp(z0,z1,k/nA), c1=lerp(z0,z1,(k+1)/nA);
        const poly=[];
        for(let q=0;q<=10;q++){const t=q/10; poly.push([lerp(c0,c1,t), 17.2]);}
        for(let q=10;q>=0;q--){const t=q/10; poly.push([lerp(c0,c1,t), 18.4+Math.sin(Math.PI*t)*1.5]);}
        gs.prism(poly, 0, x-0.55, x+0.55, 0.30);
      }
      gs.box(x, 17.35, (z0+z1)/2, 1.2, 0.5, z1-z0, 0.3);
      for(let k=0;k<=nA;k++)
        gs.box(x, 18.2, lerp(z0,z1,k/nA), 1.1, 1.6, 0.7, 0.4);
    }
  }

  /* 后殿：13 组放射飞扶壁，单跨 15 m */
  {
    const cx=X.apseC, cz=0, NS=13;
    const A0=-Math.PI/2, A1=Math.PI/2;
    const Rland=6.8, Rpier=21.8;     // 落点 / 起拱点 → 径向差 15.0 m
    for(let s=0;s<NS;s++){
      const a=lerp(A0,A1,(s+0.5)/NS), ca=Math.cos(a), sa=Math.sin(a);
      /* 扶壁墩 */
      const pr1=19.8, pr2=22.4;
      const pm=(pr1+pr2)/2;
      gs.box(cx+pm*ca, Y.pierTop/2, cz+pm*sa, (pr2-pr1)*Math.abs(ca)+2.6*Math.abs(sa), Y.pierTop,
             (pr2-pr1)*Math.abs(sa)+2.6*Math.abs(ca), 0.28);
      gs.box(cx+pm*ca, Y.pierTop+0.9, cz+pm*sa, (pr2-pr1)*0.78*Math.abs(ca)+2.1*Math.abs(sa), 1.8,
             (pr2-pr1)*0.78*Math.abs(sa)+2.1*Math.abs(ca), 0.30);
      solid(cx+pm*ca-2.4, 0, cz+pm*sa-2.4, cx+pm*ca+2.4, Y.pierTop, cz+pm*sa+2.4);
      /* 墩顶小尖塔 */
      const qx=cx+pm*ca, qz=cz+pm*sa;
      gs.cyl(qx, Y.pierTop+4.2, qz, 0.60, 0.48, 2.0, 6, 0.6);
      gs.cyl(qx, Y.pierTop+6.1, qz, 0.28, 0.0,  1.9, 6, 0.6);
      for(let k=0;k<4;k++){const aa=Math.PI/4+k/4*TAU;
        gs.cyl(qx+Math.cos(aa)*0.64, Y.pierTop+3.95, qz+Math.sin(aa)*0.64, 0.15, 0.0, 1.1, 5, 0.7);}
      /* 飞券：径向从墩顶斜升至后殿高墙 */
      {
        const nS=14, th=1.2;
        const f=t=>24.2+(29.4-24.2)*t+Math.sin(Math.PI*t)*2.0;
        const top=t=>f(t)+2.2+0.4*Math.cos(Math.PI*(t-0.5));
        const P3=(r,y,off)=>[cx+r*ca-off*sa, y, cz+r*sa+off*ca];
        for(let k=0;k<nS;k++){
          const t0=k/nS, t1=(k+1)/nS;
          const r0=lerp(Rpier,Rland,t0), r1=lerp(Rpier,Rland,t1);
          const A=P3(r0,f(t0),-th), B=P3(r1,f(t1),-th);
          const C=P3(r1,top(t1),-th), Dd=P3(r0,top(t0),-th);
          const A2=P3(r0,f(t0),th), B2=P3(r1,f(t1),th);
          const C2=P3(r1,top(t1),th), D2=P3(r0,top(t0),th);
          gs.face([A,B,C,Dd],0.30);        // 一侧
          gs.face([D2,C2,B2,A2],0.30);     // 另一侧
          gs.face([Dd,C,C2,D2],0.30);      // 顶面
          gs.face([B,A,A2,B2],0.30);       // 底面
        }
        gs.face([P3(Rpier,f(0),-th),P3(Rpier,top(0),-th),P3(Rpier,top(0),th),P3(Rpier,f(0),th)],0.30);
        gs.face([P3(Rland,top(1),-th),P3(Rland,f(1),-th),P3(Rland,f(1),th),P3(Rland,top(1),th)],0.30);
      }
      /* 减压小拱券 */
      {
        const c0=Rland+2.0, c1=Rpier-1.0, nS=10;
        for(let k=0;k<nS;k++){
          const t0=k/nS, t1=(k+1)/nS;
          const r0=lerp(c0,c1,t0), r1=lerp(c0,c1,t1);
          const h0=17.6+Math.sin(Math.PI*t0)*1.5, h1=17.6+Math.sin(Math.PI*t1)*1.5;
          const P3=(r,y,off)=>[cx+r*ca-off*sa, y, cz+r*sa+off*ca];
          gs.face([P3(r0,17.0,-0.55),P3(r1,17.0,-0.55),P3(r1,h1,-0.55),P3(r0,h0,-0.55)],0.30);
          gs.face([P3(r0,h0,0.55),P3(r1,h1,0.55),P3(r1,17.0,0.55),P3(r0,17.0,0.55)],0.30);
          gs.face([P3(r0,h0,-0.55),P3(r1,h1,-0.55),P3(r1,h1,0.55),P3(r0,h0,0.55)],0.30);
        }
        gs.box(cx+lerp(c0,c1,0.5)*ca, 18.4, cz+lerp(c0,c1,0.5)*sa, 2.0, 1.4, 2.0, 0.4);
      }
    }
  }
})();

/* ── 西立面 ─────────────────────────────────────────────────────── */
step(74,'立起西立面双塔 · 国王廊 · 奇美拉廊'); await raf();
(function westFacade(){
  const gs=G.stone, gs2=G.stone2, gd=G.dark, gl=G.lead;
  const fx=X.facadeOut, fxIn=X.facadeIn, depth=fxIn-fx;

  gs.box(fx+depth/2, 0.7, 0, depth+0.6, 1.4, Z.facade*2+1.2, 0.28);

  /* 三个门洞：中央 / 北(圣母) / 南(圣安娜) */
  const portals=[
    {z:0,     w:9.2, h:11.5, ay:16.6},
    {z: 16.0, w:6.0, h:8.6,  ay:12.4},
    {z:-16.0, w:6.0, h:8.6,  ay:12.4}
  ];
  const segs=[];   // 实墙区间
  {
    const sorted=portals.slice().sort((a,b)=>a.z-b.z);
    let cur=-Z.facade;
    for(const p of sorted){
      segs.push([cur, p.z-p.w/2]);
      cur=p.z+p.w/2;
    }
    segs.push([cur, Z.facade]);
  }
  for(const s of segs){
    if(s[1]-s[0] > 0.02)
      gs.box(fx+depth/2, (1.4+Y.kingsY0)/2, (s[0]+s[1])/2, depth, Y.kingsY0-1.4, s[1]-s[0], 0.30);
  }
  for(const p of portals){
    const zA=p.z-p.w/2, zB=p.z+p.w/2;
    const pts=[[zA,p.h]];
    for(let i=0;i<=16;i++){const t=i/16; pts.push([lerp(zA,zB,t), p.h+(p.ay-p.h)*arch(t)]);}
    pts.push([zB,p.h]); pts.push([zB,Y.kingsY0]); pts.push([zA,Y.kingsY0]);
    gs.prism(pts,0,fx,fxIn,0.30);
    gd.box(fx+depth*0.35, p.h/2, p.z, depth*0.7, p.h, p.w-0.4, 0.4);
    for(let k=0;k<4;k++){
      const off=k*0.62, ax=fx+0.35+k*0.42;
      gs.sweep(archPts(ax, p.z-p.w/2-off, ax, p.z+p.w/2+off, p.h-off*0.9, p.ay+off*0.55, 18, arch),
        [[-0.30,0.55],[-0.30,-0.20],[0.30,-0.20],[0.30,0.55],[-0.30,0.55]],0.55,frameV);
    }
    gs.box(fx+0.4,(1.4+p.h)/2,p.z, 1.1, p.h-1.4, 1.0, 0.35);
    gs.cyl(fx+0.4, p.h+0.55, p.z, 0.62, 0.52, 1.1, 10, 0.6);
  }
  // 中央门洞留作通道，可飞入中殿
  solid(fx,0,-Z.facade, fxIn, Y.facadeTop, -4.6);
  solid(fx,0, 4.6,      fxIn, Y.facadeTop,  Z.facade);

  /* 国王廊：28 龛 */
  {
    const y0=Y.kingsY0, y1=Y.kingsY1;
    gs.box(fx+1.4, y0-0.35, 0, 3.0, 0.7, Z.facade*2-1.0, 0.30);
    gs.box(fx+1.4, y1+0.35, 0, 3.2, 0.7, Z.facade*2-1.0, 0.30);
    const n=28, span=Z.facade*2-2.4;
    for(let i=0;i<n;i++){
      const z=-span/2+(i+0.5)*span/n;
      gs.box(fx+0.85,(y0+y1)/2,z, 1.6,(y1-y0)*0.86, span/n*0.78, 0.45);
      gd.box(fx+0.30,(y0+y1)/2,z, 0.5,(y1-y0)*0.72, span/n*0.62, 0.5);
      const za=z-span/n*0.39, zb=z+span/n*0.39, ax=fx+0.62;
      gs.sweep(archPts(ax, za, ax, zb, y1-0.75, y1-0.05, 8, arch),
        [[-0.09,0.10],[-0.09,-0.10],[0.09,-0.10],[0.09,0.10],[-0.09,0.10]],0.6,frameV);
      gs.cyl(fx+0.42, y0+(y1-y0)*0.40, z, 0.24,0.20,(y1-y0)*0.56, 8, 0.8);
      gs.cyl(fx+0.42, y0+(y1-y0)*0.76, z, 0.135,0.135,0.26, 8, 0.8);
      gs.box(fx+0.42, y0+(y1-y0)*0.10, z, 0.46,0.20,0.40, 0.6);
      gs.cyl(fx+0.62, y0+(y1-y0)*0.52, z+0.20, 0.035,0.035,(y1-y0)*0.66, 5, 1.0);
    }
  }

  /* L4 收边：西立面的横向线脚（bandeaux）。
     原先这几道分层带确实存在，但它们的 x 中心在 fx+1.2~1.4、厚度 2.6~3.2，
     算下来只比墙面探出约 0.1 m——渲出来等于没有，立面读成一整片平墙。
     这里在墙面之外补三道真正挑出的滴水线脚（0.7 m 出挑），把三段式箍出来。
     直线段用 box 惯用法；cornice() 是给闭合环用的，这里用不上 */
  {
    const zw=Z.facade*2-0.8;
    const course=(y,out,h,zspan)=>{
      G.stoneNew.box(fx-out/2+0.10, y, 0, out+0.35, h, zspan, 0.4);
      G.stone2  .box(fx-out*0.32,  y-h*0.75, 0, out*0.55, h*0.55, zspan, 0.5);  // 线脚下的凹槽阴影
    };
    course(Y.kingsY0-0.60, 0.72, 0.44, zw);          // 国王廊下
    course(Y.kingsY1+1.00, 0.80, 0.48, zw);          // 国王廊上 = 玫瑰层起脚
    course(Y.facadeTop-5.0, 0.66, 0.40, 21.0);       // 奇美拉廊下（只跨双塔之间）
  }

  /* 玫瑰窗层 */
  {
    const yA=Y.kingsY1+0.7, yB=Y.facadeTop;
    for(const sgn of [-1,1]){
      const z0=sgn*(D.roseW/2+1.6), z1=sgn*(Z.facade-0.2);
      const a=Math.min(z0,z1), b=Math.max(z0,z1);
      gs.box(fx+depth/2,(yA+yB)/2,(a+b)/2, depth*0.85, yB-yA, b-a, 0.28);
      for(let k=0;k<3;k++){
        const c0=lerp(a,b,k/3)+0.25, c1=lerp(a,b,(k+1)/3)-0.25;
        const pts=[[c0,yA+3.0]];
        for(let i=0;i<=10;i++){const t=i/10; pts.push([lerp(c0,c1,t), yA+3.0+3.4*arch(t)]);}
        pts.push([c1,yA+3.0]); pts.push([c1,yB-0.4]); pts.push([c0,yB-0.4]);
        gs.prism(pts,0,fx+depth*0.15, fx+depth*0.35, 0.28);
        gd.box(fx+depth*0.42, yA+4.2,(c0+c1)/2, 0.4, 3.0,(c1-c0)*0.9, 0.5);
      }
    }
    const zA=-D.roseW/2-1.0, zB=D.roseW/2+1.0;
    gs.box(fx+depth/2,(Y.roseWY+D.roseW/2+0.6+Y.facadeTop-0.6)/2, 0, depth*0.8,
           (Y.facadeTop-0.6)-(Y.roseWY+D.roseW/2+0.6), zB-zA, 0.28);
    gs.box(fx+depth/2,(yA+Y.roseWY-D.roseW/2-0.6)/2, 0, depth*0.85,
           (Y.roseWY-D.roseW/2-0.6)-yA, D.roseW+3.2, 0.28);
  }
  buildRose(G.gw, G.stone, fx+0.35, Y.roseWY, 0, D.roseW, 0, -1, 12);

  /* 奇美拉廊 */
  {
    const yA=Y.facadeTop-4.4, yB=Y.facadeTop;
    gs.box(fx+1.2, yB-0.35, 0, 2.6, 0.7, Z.facade*2-2.0, 0.30);
    gs.box(fx+1.2, yA+0.30, 0, 2.8, 0.6, Z.facade*2-2.0, 0.30);
    const nC=Math.floor((Z.facade*2-2.2)/1.15);
    for(let i=0;i<=nC;i++){
      const z=-(Z.facade-1.1)+i*(Z.facade*2-2.2)/nC;
      gs.cyl(fx+0.55,(yA+yB)/2,z, 0.14,0.14,(yB-yA), 8, 0.7);
      gs.cyl(fx+0.55, yA+0.20,z, 0.20,0.16,0.4, 8, 0.7);
      gs.cyl(fx+0.55, yB-0.55,z, 0.20,0.16,0.4, 8, 0.7);
      if(i%2===0){
        const gx=fx-0.30;
        gs.box(gx, yA+1.5, z, 0.85,0.55,0.45, 0.6);
        gs.box(gx-0.30, yA+1.35, z, 0.45,0.38,0.34, 0.7);
        gs.cyl(gx-0.05, yA+1.95, z, 0.16,0.10,0.35, 6, 0.8);
        gs.box(gx+0.30, yA+1.65, z, 0.42,0.16,0.14, 0.8);
      }
    }
    for(let i=0;i<=Math.floor((Z.facade*2-2.2)/0.55);i++)
      gs.cyl(fx+1.5, Y.facadeTop+0.55, -(Z.facade-1.1)+i*0.55, 0.075,0.075,0.85, 5, 1.0);
    gs.box(fx+1.5, Y.facadeTop+1.05, 0, 0.5, 0.22, Z.facade*2-2.0, 0.4);
  }

  /* 双塔：69 m */
  for(const sgn of [-1,1]){
    const zc=sgn*(Z.facade-11.0/2);
    const tx0=fx, tx1=fx+11.0, tz0=zc-10.5/2, tz1=zc+10.5/2;
    const tcx=(tx0+tx1)/2, tcz=(tz0+tz1)/2;
    gs.box(tcx,(20.5+46)/2, tcz, 11.0, 25.5, 10.5, 0.22);     // 20.5 m 以上（门洞区之上）
    solid(tx0,20.5,tz0, tx1,46,tz1);
    solid(fxIn,0,tz0, tx1,20.5,tz1);                            // 塔身后段
    for(const dx of [-1,1]) for(const dz of [-1,1]){
      const px=tcx+dx*5.1, pz=tcz+dz*4.8;
      gs.box(px,(20.5+46)/2,pz, 1.5,25.5,1.5, 0.26);
      gs.box(px,46.8,pz, 1.9,1.6,1.9, 0.3);
    }
    for(const yy of [1.6,20.2,25.6,45.6]) gs.box(tcx,yy,tcz, 11.4,0.55,10.9, 0.28);
    for(let lv=0;lv<2;lv++){
      const yA=lv?26.2:2.4, yH=17.0;
      for(let k=0;k<2;k++){
        const c0=tcz-4.0+k*4.0, c1=c0+3.4;
        const pts=[[c0,yA+3.2]];
        for(let i=0;i<=12;i++){const t=i/12; pts.push([lerp(c0,c1,t), yA+3.2+3.0*arch(t)]);}
        pts.push([c1,yA+3.2]); pts.push([c1,yA+yH]); pts.push([c0,yA+yH]);
        gs.prism(pts,0,tx0+0.2,tx0+0.9, 0.26);
        gd.box(tx0+0.55, yA+5.4,(c0+c1)/2, 0.4, 8.0, 2.8, 0.5);
        const d0=tcx-4.2+k*4.2, d1=d0+3.6;
        const pts2=[[d0,yA+3.2]];
        for(let i=0;i<=12;i++){const t=i/12; pts2.push([lerp(d0,d1,t), yA+3.2+3.0*arch(t)]);}
        pts2.push([d1,yA+3.2]); pts2.push([d1,yA+yH]); pts2.push([d0,yA+yH]);
        const za=sgn>0?tz1-0.9:tz0+0.2, zb=sgn>0?tz1-0.2:tz0+0.9;
        gs.prism(pts2,2,za,zb, 0.26);
      }
    }
    /* 钟室 46 → 63 */
    {
      const bz0=tcz-4.5, bz1=tcz+4.5;
      gs.box(tcx,63.5,tcz, 10.3,1.6,9.9, 0.26);
      for(const dx of [-1,1]) for(const dz of [-1,1])
        gs.box(tcx+dx*4.2,(46+63)/2,tcz+dz*4.0, 2.0,17,2.0, 0.26);
      gs.box(tcx,(46+63)/2,tcz, 1.9,17,9.0, 0.26);
      for(const sx of [-1,1]){
        const c0=tcx+(sx<0?-3.9:0.0), c1=tcx+(sx<0?0.0:3.9);
        if(Math.abs(c1-c0)<0.1) continue;
        gd.box((c0+c1)/2,54.5, sgn>0?bz1-0.5:bz0+0.5, c1-c0,15.0,0.5, 0.5);
        for(let k=0;k<12;k++)
          gs.box((c0+c1)/2,47.2+k*1.20, sgn>0?bz1-0.25:bz0+0.25, (c1-c0)*0.92,0.16,0.55, 0.7);
        const pts=[[c0+0.2,61.5]];
        for(let i=0;i<=10;i++){const t=i/10; pts.push([lerp(c0+0.2,c1-0.2,t), 61.5+1.3*arch(t)]);}
        pts.push([c1-0.2,61.5]); pts.push([c1-0.2,62.4]); pts.push([c0+0.2,62.4]);
        const za=sgn>0?bz1-0.9:bz0+0.2, zb=sgn>0?bz1-0.2:bz0+0.9;
        gs.prism(pts,2,za,zb, 0.26);
      }
      for(const sx of [-1,1]){
        const c0=tcz+(sx<0?-3.8:0.0), c1=tcz+(sx<0?0.0:3.8);
        if(Math.abs(c1-c0)<0.1) continue;
        gd.box(tx0+0.5,54.5,(c0+c1)/2, 0.5,15.0,c1-c0, 0.5);
        for(let k=0;k<12;k++)
          gs.box(tx0+0.25,47.2+k*1.20,(c0+c1)/2, 0.55,0.16,(c1-c0)*0.92, 0.7);
      }
    }
    /* 露台 63 → 66，四角小尖塔 → 69 */
    {
      gs.box(tcx,64.6,tcz, 10.8,0.6,10.3, 0.28);
      const nB=26;
      for(let i=0;i<=nB;i++){
        const t=i/nB;
        gs.cyl(lerp(tcx-5.0,tcx+5.0,t),65.6,tcz-5.0, 0.10,0.10,1.5, 5, 0.9);
        gs.cyl(lerp(tcx-5.0,tcx+5.0,t),65.6,tcz+5.0, 0.10,0.10,1.5, 5, 0.9);
        gs.cyl(tcx-5.0,65.6,lerp(tcz-5.0,tcz+5.0,t), 0.10,0.10,1.5, 5, 0.9);
        gs.cyl(tcx+5.0,65.6,lerp(tcz-5.0,tcz+5.0,t), 0.10,0.10,1.5, 5, 0.9);
      }
      gs.box(tcx,66.4,tcz-5.0, 10.6,0.35,0.6, 0.4);
      gs.box(tcx,66.4,tcz+5.0, 10.6,0.35,0.6, 0.4);
      gs.box(tcx-5.0,66.4,tcz, 0.6,0.35,10.6, 0.4);
      gs.box(tcx+5.0,66.4,tcz, 0.6,0.35,10.6, 0.4);
      for(const dx of [-1,1]) for(const dz of [-1,1]){
        const px=tcx+dx*4.6, pz=tcz+dz*4.4;
        gs.box(px,66.6,pz, 2.1,1.2,2.1, 0.3);
        gs.cyl(px,68.0,pz, 0.72,0.58,1.8, 6, 0.6);
        gs.cyl(px,68.9,pz, 0.34,0.0, 1.7, 6, 0.6);
        gs.cyl(px,69.6,pz, 0.07,0.05,0.6, 5, 1.0);
      }
    }
    for(let k=0;k<6;k++){
      const a=Math.PI+(k+0.5)/6*Math.PI;
      const gx=tcx+Math.cos(a)*5.4, gz=tcz+Math.sin(a)*5.2;
      gs.box(gx,64.2,gz, 0.9,0.5,0.9, 0.5);
      gs.box(gx+Math.cos(a)*0.4,63.9,gz+Math.sin(a)*0.4, 0.5,0.36,0.5, 0.6);
    }
  }

  /* 立面背后的中殿山墙 */
  {
    const zA=-Z.naveWall-0.45, zB=Z.naveWall+0.45;
    gs.prism([[zA,Y.wallTop-0.2],[0,Y.ridge+0.5],[zB,Y.wallTop-0.2],
              [zB,Y.wallTop-6],[zA,Y.wallTop-6]], 0, X.facadeIn-0.6, X.facadeIn, 0.28);
  }
})();

/* ── 耳堂立面 ───────────────────────────────────────────────────── */
step(84,'安装北 / 南耳堂玫瑰窗与立面'); await raf();
(function transeptFacades(){
  const gs=G.stone, gs2=G.stone2, gd=G.dark;

  for(const sd of [-1,1]){
    const fz=sd*Z.tran, inner=sd*(Z.tran-1.4);
    const z0=Math.min(fz,inner), z1=Math.max(fz,inner);
    const xA=-1.0, xB=23.0, cx=(xA+xB)/2;

    gs.box(cx,0.7,(z0+z1)/2, (xB-xA)+1.0,1.4,(z1-z0)+1.0, 0.28);

    /* 中央门洞 */
    {
      const pw=7.4, ph=9.2, pay=13.6;
      const pA=cx-pw/2, pB=cx+pw/2;
      gs.box((xA+pA)/2,(1.4+19.0)/2,(z0+z1)/2, pA-xA, 19.0-1.4, z1-z0, 0.28);
      gs.box((pB+xB)/2,(1.4+19.0)/2,(z0+z1)/2, xB-pB, 19.0-1.4, z1-z0, 0.28);
      const pts=[[pA,ph]];
      for(let i=0;i<=16;i++){const t=i/16; pts.push([lerp(pA,pB,t), ph+(pay-ph)*arch(t)]);}
      pts.push([pB,ph]); pts.push([pB,19.0]); pts.push([pA,19.0]);
      gs.prism(pts,2,z0,z1, 0.28);
      gd.box(cx, ph/2,(z0+z1)/2, pw-0.3, ph, (z1-z0)*0.8, 0.4);
      for(let k=0;k<3;k++){
        const off=k*0.6, zz=sd*(Z.tran-0.35-k*0.42);
        const ap=archPts(pA-off,0, pB+off,0, ph-off*0.9, pay+off*0.55, 18, arch);
        gs.sweep(ap.map(p=>[p[0],p[1],zz]),
          [[-0.28,0.50],[-0.28,-0.18],[0.28,-0.18],[0.28,0.50],[-0.28,0.50]],0.55,frameV);
      }
      gs.box(cx,(1.4+ph)/2, sd*(Z.tran-0.4), 1.0, ph-1.4, 0.9, 0.35);
      gs.cyl(cx, ph+0.5, sd*(Z.tran-0.4), 0.56,0.46,1.0, 10, 0.6);
    }
    /* 盲拱带 */
    {
      gs.box(cx,19.8,(z0+z1)/2, xB-xA, 1.6, z1-z0, 0.28);
      for(let k=0;k<9;k++){
        const c0=lerp(xA,xB,k/9)+0.2, c1=lerp(xA,xB,(k+1)/9)-0.2;
        const pts=[[c0,20.6]];
        for(let i=0;i<=8;i++){const t=i/8; pts.push([lerp(c0,c1,t), 20.6+1.5*arch(t)]);}
        pts.push([c1,20.6]); pts.push([c1,22.6]); pts.push([c0,22.6]);
        gs.prism(pts,2, sd*(Z.tran-0.5), sd*(Z.tran-1.0), 0.28);
      }
    }
    /* 玫瑰窗带 */
    const roseY=Y.roseTY, half=D.roseN/2;
    {
      for(const sgn of [-1,1]){
        const a0=sgn<0? xA : cx+half+1.7;
        const b0=sgn<0? cx-half-1.7 : xB;
        const a=Math.min(a0,b0), b=Math.max(a0,b0);
        gs.box((a+b)/2,(22.6+Y.gableTop-3.0)/2,(z0+z1)/2, b-a, (Y.gableTop-3.0)-22.6, z1-z0, 0.28);
        for(let k=0;k<2;k++){
          const c0=lerp(a,b,k/2)+0.35, c1=lerp(a,b,(k+1)/2)-0.35;
          const pts=[[c0,24.0]];
          for(let i=0;i<=10;i++){const t=i/10; pts.push([lerp(c0,c1,t), 24.0+3.2*arch(t)]);}
          pts.push([c1,24.0]); pts.push([c1,Y.gableTop-3.4]); pts.push([c0,Y.gableTop-3.4]);
          gs.prism(pts,2, sd*(Z.tran-0.4), sd*(Z.tran-1.0), 0.28);
          gd.box((c0+c1)/2,26.0, sd*(Z.tran-0.9), 0.4,3.4,(c1-c0)*0.9, 0.5);
        }
      }
      gs.box(cx,(19.4+roseY-half-0.5)/2,(z0+z1)/2, xB-xA, (roseY-half-0.5)-19.4, z1-z0, 0.28);
      gs.box(cx,(roseY+half+0.5+Y.gableTop-3.0)/2,(z0+z1)/2, D.roseN+3.4,
             (Y.gableTop-3.0)-(roseY+half+0.5), z1-z0, 0.28);
    }
    if(sd>0) buildRose(G.gn,  G.stone, cx, roseY,  Z.tran-0.35, D.roseN, 2, 1, 16);
    else     buildRose(G.gs_, G.stone, cx, roseY, -Z.tran+0.35, D.roseS, 2,-1, 16);

    /* 山花 */
    {
      const gy0=Y.gableTop-3.0;
      gs.prism([[xA-0.5,gy0],[cx,Y.gableTop],[xB+0.5,gy0],
                [xB+0.5,gy0-0.6],[xA-0.5,gy0-0.6]], 2, sd*(Z.tran-1.2), sd*Z.tran, 0.28);
      gs.torus(cx, gy0+2.6, sd*(Z.tran-1.0), 1.25,0.24, 2, 18, 6, 0.4);
      G.gwin.disc(cx, gy0+2.6, sd*(Z.tran-0.95), 1.05, 2, 16);
      gs.cyl(cx, Y.gableTop+0.7, sd*(Z.tran-0.6), 0.22,0.10,1.4, 6, 0.7);
      for(let k=0;k<5;k++){
        const t=(k+1)/6;
        gs.cyl(lerp(xA,cx,t), lerp(gy0,Y.gableTop,t)+0.6, sd*(Z.tran-0.6), 0.06,0.05,0.9, 5, 1.0);
        gs.cyl(lerp(cx,xB,t), lerp(Y.gableTop,gy0,t)+0.6, sd*(Z.tran-0.6), 0.06,0.05,0.9, 5, 1.0);
      }
    }
    /* 四角塔基（未建成的塔）*/
    for(const ex of [xA-0.5, xB+0.5]){
      const ez=(z0+z1)/2-sd*0.4;
      gs.box(ex,15.0,ez, 4.4,30.0,4.4, 0.26);
      solid(ex-2.2,0,ez-2.2, ex+2.2,30.0,ez+2.2);
      for(const dy of [8.0,16.0,24.0]) gs.box(ex,dy,ez, 4.9,0.5,4.9, 0.28);
      gs.box(ex,30.6,ez, 5.0,1.2,5.0, 0.3);
      gs.cyl(ex,32.4,ez, 0.9,0.0,2.6, 6, 0.5);
      for(let k=0;k<4;k++){const a=Math.PI/4+k/4*TAU;
        gs.cyl(ex+Math.cos(a)*1.9,32.0,ez+Math.sin(a)*1.9, 0.22,0.0,1.6, 5, 0.6);}
      gd.box(ex,20.0, sd*(Z.tran-0.3), 1.6,7.0,0.5, 0.5);
    }
    solid(xA-2.5,0,z0, xB+2.5, Y.gableTop, z1);
  }
})();

/* ── 尖塔（复建）───────────────────────────────────────────────── */
step(92,'复建尖塔：橡木骨架 + 新铅皮覆面'); await raf();
(function spire(){
  const gl2=G.leadNew, go=G.oak, gs=G.stone, gg=G.gold, gd=G.dark;
  const cx=(X.trW+X.trE)/2, cz=0;
  const y0=Y.spireBase, APEX=D.spireH;

  gs.box(cx, y0+1.2, cz, 12.4,2.4,12.4, 0.30);
  gs.box(cx, y0+2.8, cz, 11.2,0.8,11.2, 0.30);
  /* 十二使徒 + 四福音作者 */
  for(let i=0;i<12;i++){
    const a=i/12*TAU, px=cx+Math.cos(a)*5.6, pz=cz+Math.sin(a)*5.6;
    go.cyl(px,y0+3.7,pz, 0.30,0.24,1.8, 8, 0.8);
    go.cyl(px,y0+4.85,pz, 0.155,0.155,0.35, 8, 0.8);
    go.box(px,y0+2.95,pz, 0.55,0.30,0.48, 0.7);
  }
  for(let k=0;k<4;k++){
    const a=Math.PI/4+k/4*TAU, px=cx+Math.cos(a)*5.9, pz=cz+Math.sin(a)*5.9;
    go.cyl(px,y0+3.8,pz, 0.34,0.26,2.0, 8, 0.8);
    go.cyl(px,y0+5.0,pz, 0.17,0.17,0.38, 8, 0.8);
  }
  /* 四角小尖塔 */
  for(let k=0;k<4;k++){
    const a=Math.PI/4+k/4*TAU, px=cx+Math.cos(a)*5.4, pz=cz+Math.sin(a)*5.4, by=y0+3.2;
    gs.box(px,by+0.6,pz, 2.4,1.2,2.4, 0.3);
    gl2.cyl(px,by+3.0,pz, 0.95,0.72,3.6, 8, 0.5);
    gl2.cyl(px,by+5.6,pz, 0.44,0.0, 2.6, 8, 0.5);
    for(let q=0;q<4;q++){const aa=Math.PI/4+q/4*TAU;
      gs.cyl(px+Math.cos(aa)*0.95,by+2.4,pz+Math.sin(aa)*0.95, 0.24,0.0,1.7, 5, 0.6);}
    gg.cyl(px,by+7.0,pz, 0.06,0.04,0.7, 5, 1.0);
  }
  /* 八角鼓座 + 八座高天窗 */
  {
    const yA=y0+3.2, yB=y0+13.5, R=5.6;
    for(let k=0;k<8;k++){
      const a=k/8*TAU, a0=a-Math.PI/8, a1=a+Math.PI/8;
      const nx=Math.cos(a), nz=Math.sin(a);
      gl2.face([[cx+R*Math.cos(a0),yA,cz+R*Math.sin(a0)],
                [cx+R*Math.cos(a1),yA,cz+R*Math.sin(a1)],
                [cx+R*0.80*Math.cos(a1),yB,cz+R*0.80*Math.sin(a1)],
                [cx+R*0.80*Math.cos(a0),yB,cz+R*0.80*Math.sin(a0)]], 0.34);
      gd.box(cx+(R-0.35)*nx, yA+5.2, cz+(R-0.35)*nz, 1.8, 7.6, 0.5, 0.4);
      const g0=a-0.20, g1=a+0.20;
      gl2.face([[cx+(R+0.9)*Math.cos(g0),yA+1.2,cz+(R+0.9)*Math.sin(g0)],
                [cx+(R+0.9)*Math.cos(g1),yA+1.2,cz+(R+0.9)*Math.sin(g1)],
                [cx+(R+0.5)*nx,yA+8.4,cz+(R+0.5)*nz],
                [cx+(R+0.5)*nx,yA+8.4,cz+(R+0.5)*nz]], 0.34);
      gs.box(cx+(R+0.55)*nx, yA+5.0, cz+(R+0.55)*nz, 1.5, 7.4, 0.5, 0.3);
      gs.cyl(cx+(R-0.1)*nx, yA+3.4, cz+(R-0.1)*nz, 0.13,0.11,3.0, 6, 0.8);
      for(let q=0;q<6;q++){
        const t=q/6, yy=lerp(yA+1.0,yB,t), rr=lerp(R*0.99,R*0.80,t);
        gl2.cyl(cx+rr*Math.cos(a+Math.PI/8),yy,cz+rr*Math.sin(a+Math.PI/8), 0.20-t*0.09,0.10-t*0.04,0.7, 5, 0.7);
      }
    }
  }
  /* 八角锥主体 */
  {
    const yA=y0+13.5, yB=APEX-7.5, RA=4.48, RB=0.42, nC=44;
    for(let k=0;k<8;k++){
      const a0=k/8*TAU-Math.PI/8, a1=k/8*TAU+Math.PI/8;
      for(let i=0;i<nC;i++){
        const t0=i/nC, t1=(i+1)/nC;
        const r0=lerp(RA,RB,t0), r1=lerp(RA,RB,t1);
        const p0=lerp(yA,yB,t0), p1=lerp(yA,yB,t1);
        gl2.face([[cx+r0*Math.cos(a0),p0,cz+r0*Math.sin(a0)],
                  [cx+r0*Math.cos(a1),p0,cz+r0*Math.sin(a1)],
                  [cx+r1*Math.cos(a1),p1,cz+r1*Math.sin(a1)],
                  [cx+r1*Math.cos(a0),p1,cz+r1*Math.sin(a0)]], 0.30);
      }
      const a=k/8*TAU+Math.PI/8, nK=26;
      for(let q=0;q<nK;q++){
        const t=q/nK, yy=lerp(yA,yB,t), rr=lerp(RA,RB,t);
        gl2.cyl(cx+rr*Math.cos(a)*1.02,yy,cz+rr*Math.sin(a)*1.02,
                0.20*(1-t*0.82), 0.09*(1-t*0.80), 0.62*(1-t*0.4), 5, 0.7);
      }
    }
    for(let tier=0;tier<3;tier++){
      const ty=58.0+tier*8.2, tr=lerp(RA,RB,(ty-yA)/(yB-yA));
      for(let k=0;k<8;k++){
        const a=k/8*TAU, nx=Math.cos(a), nz=Math.sin(a);
        gl2.face([[cx+(tr+1.05)*Math.cos(a-0.16),ty,cz+(tr+1.05)*Math.sin(a-0.16)],
                  [cx+(tr+1.05)*Math.cos(a+0.16),ty,cz+(tr+1.05)*Math.sin(a+0.16)],
                  [cx+(tr+0.35)*nx,ty+3.4,cz+(tr+0.35)*nz],
                  [cx+(tr+0.35)*nx,ty+3.4,cz+(tr+0.35)*nz]], 0.34);
        gd.box(cx+(tr+0.15)*nx,ty+1.3,cz+(tr+0.15)*nz, 0.85,2.0,0.4, 0.5);
        gs.box(cx+(tr+0.5)*nx,ty+1.5,cz+(tr+0.5)*nz, 1.2,2.6,0.4, 0.3);
      }
    }
  }
  /* 塔尖收束 + 十字架 + 风向鸡 */
  {
    const yTop=APEX-6.5;
    gs.cyl(cx,yTop+1.2,cz, 0.62,0.48,1.6, 8, 0.5);
    gs.cyl(cx,yTop+2.3,cz, 0.86,0.62,0.5, 8, 0.5);
    gs.cyl(cx,yTop+2.9,cz, 0.34,0.24,0.8, 8, 0.5);
    const cy0=yTop+3.3;
    gg.box(cx,cy0+1.1,cz, 0.16,2.6,0.16, 1.0);
    gg.box(cx,cy0+1.75,cz, 1.25,0.16,0.16, 1.0);
    gg.cyl(cx,cy0+2.6,cz, 0.10,0.06,0.4, 6, 1.0);
    const ry=cy0+2.9;
    gg.cyl(cx,ry+0.2,cz, 0.09,0.07,0.5, 6, 1.0);
    gg.box(cx,ry+0.75,cz, 0.62,0.34,0.16, 1.0);
    gg.box(cx-0.26,ry+1.06,cz, 0.34,0.24,0.14, 1.0);
    gg.cyl(cx+0.26,ry+1.06,cz, 0.13,0.11,0.26, 6, 1.0);
    gg.cyl(cx+0.44,ry+1.02,cz, 0.06,0.03,0.16, 5, 1.0);
    gg.box(cx+0.10,ry+1.28,cz, 0.07,0.14,0.05, 1.0);
  }
})();

  },

  /* 玫瑰窗 SpotLight 彩色光斑 + 体积光柱 */
  effects(ctx){
    const {scene}=ctx;
    const ROSE_SPOTS=ctx.spots, SHAFTS=ctx.shafts;
  /* 三扇玫瑰窗：SpotLight.map 投影彩色光斑（石棂挡光 → 带花格轮廓）*/
  const roses=[
    {tex:TEX.roseW, pos:[-52.0,Y.roseWY,0],  aim:[26.0,Y.roseWY-15.0,0],  ang:0.42, inten:560},
    {tex:TEX.roseN, pos:[11.0,Y.roseTY,20.0],aim:[11.0,Y.roseTY-14.0,-28],ang:0.46, inten:700},
    {tex:TEX.roseS, pos:[11.0,Y.roseTY,-20.0],aim:[11.0,Y.roseTY-14.0,28], ang:0.46, inten:700}
  ];
  for(const r of roses){
    const t=new THREE.CanvasTexture(r.tex);
    if(THREE.sRGBEncoding) t.encoding=THREE.sRGBEncoding;
    const sp=new THREE.SpotLight(0xffffff, r.inten, 140, r.ang, 0.42, 1.55);
    sp.position.set(r.pos[0],r.pos[1],r.pos[2]);
    sp.target.position.set(r.aim[0],r.aim[1],r.aim[2]);
    sp.map=t;
    sp.castShadow=true;                    // 必须：否则着色器内 vSpotLightCoord 不存在
    sp.shadow.mapSize.set(1024,1024);
    sp.shadow.camera.near=2.0; sp.shadow.camera.far=95;
    sp.shadow.bias=-0.0009; sp.shadow.normalBias=0.35;
    scene.add(sp, sp.target);
    ROSE_SPOTS.push(sp);
    /* 附加体积光柱 */
    const dir=V3(r.aim[0]-r.pos[0], r.aim[1]-r.pos[1], r.aim[2]-r.pos[2]).normalize();
    const len=62, rad=Math.tan(r.ang)*len*0.85;
    const shaft=new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, rad, len, 26, 1, true),
      new THREE.MeshBasicMaterial({map:t, transparent:true, opacity:0.155,
        blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide}));
    shaft.position.set(r.pos[0]+dir.x*len/2, r.pos[1]+dir.y*len/2, r.pos[2]+dir.z*len/2);
    const q=new THREE.Quaternion().setFromUnitVectors(V3(0,-1,0), dir);
    shaft.quaternion.copy(q);
    shaft.renderOrder=5;
    scene.add(shaft);
    SHAFTS.push(shaft);
  }
  }
});
})();
