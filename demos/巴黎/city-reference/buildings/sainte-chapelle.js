/* ═══════════════════════════════════════════════════════════════════
   建筑包 · 圣礼拜堂 Sainte-Chapelle (Palais de la Cité)
   契约：P3D.register({id, meta, sunHour, dossier, ceil, labels,
                       interiorBox, textures(ctx), build(ctx), effects(ctx)})
   史实数据（公认值，细部适度简化）：
   1242–1248 为路易九世建造，存放荆棘冠圣物，辐射式哥特（Rayonnant）巅峰
   长约36m · 宽约17m（含扶壁）· 屋脊约42.5m · 尖塔总高约75m（1853 Lassus 重建）
   上层15扇高窗，每扇高约15.35m，约600㎡ 13世纪原玻璃；上层拱顶20.5m，下层6.6m
   西立面火焰式玫瑰窗 Ø约9m（15世纪末更换）；无飞扶壁，靠纤细扶壁+暗藏铁链
   ═══════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

/* ── 史实尺寸（单位：米）── */
const D = {
  ridge:42.5,                    // 屋脊高
  top:75.0,                      // 尖塔顶总高
  winH:15.35,                    // 上层高窗净高
  rose:9.0,                      // 西玫瑰窗直径
  vaultUp:20.5, vaultLow:6.6     // 上/下层拱顶高（室内）
};

// 平面：X 东西（西为负，后殿朝东），Z 南北（北为正），Y 向上
const X = { porch:-20.0, fac:-17.0, facIn:-15.6, naveE:7.4, apseC:7.4 };
const Z = { vin:5.4, out:6.6, butt:8.5 };
const Y = {
  lowSill:2.4, lowHead:5.3, lowApex:6.3,       // 下层礼拜堂小窗
  cornice:8.0, floor:8.35,                     // 腰线 / 上层地坪
  sill:11.0, head:23.0, apex:26.35,            // 上层高窗（15.35m 净高）
  wallTop:28.6, spring:22.5, crown:28.9,       // 墙顶 / 拱顶起拱 / 拱顶冠
  eave:28.8, gable:32.8,                       // 屋檐 / 窗上山墙尖饰
  roseC:23.5, facGable:42.0                    // 玫瑰窗中心 / 西立面山花顶
};
const BAYS=4, BAY=(X.naveE-X.facIn)/BAYS;      // 中殿 4 开间 × 5.75
const APSE_N=7;                                // 后殿七面
const SPX=4.0;                                 // 尖塔中心 x
const V3=(x,y,z)=>new THREE.Vector3(x,y,z);

/* ── 卷宗条目 + 独立机位 ── */
const DOSSIER=[
 { id:'home', num:'00', name:'全景总览', sub:'Vue d’ensemble', fr:'Sainte-Chapelle · Palais de la Cité',
   era:'1242 – 1248（1248 年 4 月 26 日祝圣 · 19 世纪大修）',
   dim:'长约 36 m · 宽约 17 m · 屋脊 42.5 m · 尖塔总高约 75 m',
   desc:'路易九世为荆棘冠圣物建造的「玻璃圣髑盒」：1239 年他从君士坦丁堡拉丁皇帝鲍德温二世手中购得荆棘冠，花费约 13.5 万里弗——而整座建筑的造价只有约 4 万里弗。六年建成，辐射式哥特（Rayonnant）就此登顶：上层 15 扇 15.35 米高的彩窗把墙体几乎完全取消，石头退化为窗与窗之间的细骨架。全部几何按史实尺寸由代码算出，石材、铅皮与彩色玻璃贴图均由 Canvas 逐像素绘制。',
   note:'本卷宗为可交互数字模型，非考古测绘成果；尺寸取公认值，细部作适度简化。',
   cam:{pos:[-84,46,-88], tgt:[0,30,0], fov:43} },

 { id:'glasswall', num:'01', name:'十五扇高窗（玻璃墙）', sub:'Verrières de la chapelle haute', fr:'15 verrières · h 15.35 m',
   era:'1242 – 1248（约三分之二为 13 世纪原玻璃）',
   dim:'每扇高约 15.35 m · 中殿窗宽约 4.7 m · 彩玻璃约 600 ㎡ · 1113 幅圣经场景',
   desc:'这就是圣礼拜堂的建筑革命：中殿每个开间的整面墙都让位给一扇高窗，窗与窗之间只剩一根扶壁的宽度。拱顶推力不再靠厚墙消化，而是被收进外侧纤细的扶壁和暗藏在砌体里的铁链，于是「石头消失、只剩玻璃」。15 扇窗共约 600 ㎡ 玻璃、1113 幅场景，从《创世记》一直讲到圣物抵达巴黎——最后一扇窗的主角正是路易九世本人迎奉荆棘冠。',
   note:'技术：玻璃走自发光材质（emissiveMap），发光强度刻意调高，白天在立面上也能读出彩窗——这是与圣母院最大的差异点。',
   cam:{pos:[-14,20,-46], tgt:[-4,19,0], fov:34} },

 { id:'rose', num:'02', name:'西玫瑰窗（火焰式）', sub:'Rose occidentale', fr:'Rose flamboyante · Ø 约 9 m',
   era:'约 1485 – 1495（查理八世时期更换）',
   dim:'直径约 9 m · 火焰式棂条 · 主题：圣约翰《启示录》',
   desc:'与上层高窗相隔两个多世纪：13 世纪的原窗是辐射式，15 世纪末在查理八世资助下整扇换成了火焰式（Flamboyant）——棂条弯成 S 形火舌，是晚期哥特的签名笔法。主题也换成了圣约翰的《启示录》异象：中心是宝座上的基督，末日的骑士、号角与羔羊环列四周。它与楼下 13 世纪的叙事窗同处一室，等于把哥特玻璃艺术的首尾两端装进了同一栋建筑。',
   note:'技术：玫瑰图案由 Canvas 逐像素绘制（makeRoseTexture）；石棂为自绘的旋转辐条+三叶环——引擎 buildRose 的轴对齐辐条在近景会糊成板，这扇窗值得单独伺候。',
   cam:{pos:[-46,25,-10], tgt:[-16.8,23.5,0], fov:24} },

 { id:'interior', num:'03', name:'上层礼拜堂', sub:'Chapelle haute', fr:'Voûte 20.5 m · 王室专属',
   era:'1248 年祝圣 · 王室由王宫长廊直接进入',
   dim:'室内宽 10.7 m · 拱顶高 20.5 m · 柱间立十二使徒像',
   desc:'相机此刻已在上层礼拜堂内部。这里曾是全巴黎最接近天堂的房间：四周没有墙，只有 15 扇通高的彩窗和窗间贴金的细柱，拱顶悬在 20.5 米高处。荆棘冠供奉在后殿的圣物高台（tribune）上，只有国王本人有钥匙。窗间石柱前立十二使徒雕像，各持一枚祝圣十字。对同时代人来说，走进这里等于走进一只从内部点亮的珠宝盒。',
   note:'技术：用 <b>SpotLight.map</b> 把彩窗贴图当投影片投进室内，地面与墙面出现彩色光斑——做法与圣母院玫瑰窗相同。',
   cam:{pos:[-13,11.5,0], tgt:[7,17,0], fov:55} },

 { id:'buttress', num:'04', name:'纤细扶壁与山墙尖饰', sub:'Contreforts & gâbles', fr:'无飞扶壁',
   era:'1242 – 1248',
   dim:'扶壁进深约 1.9 m · 每扇高窗上方一座山墙尖饰（gâble）· 扶壁顶端为尖塔饰',
   desc:'圣礼拜堂没有飞扶壁。上层是单一空间、没有侧廊，拱顶推力由三件事共同消化：窗间纤细的竖向扶壁、两道暗藏在砌体里环箍全楼的铁链，以及横穿彩窗、伪装成玻璃格架的铁拉杆。于是外立面得以保持一个干净的竖直棱柱体。每扇高窗上方立一座带卷叶饰的三角山墙，扶壁顶端收成小尖塔——从街上仰望，屋檐一圈石尖丛立，像给建筑戴上了它所供奉的荆棘冠。',
   cam:{pos:[-20,36,-24], tgt:[-2,28,-6.6], fov:30} },

 { id:'fleche', num:'05', name:'尖塔', sub:'Flèche', fr:'Flèche · 总高约 75 m',
   era:'现存为 1853 年 Lassus 重建（历史上第五座）',
   dim:'塔身约 33 m · 雪松木构架覆铅皮 · 两层镂空塔亭',
   desc:'现在看到的是这栋建筑历史上的第五座尖塔：前几座先后毁于火灾与大革命前的拆除，1853 年由主持修复的建筑师 Lassus 按 15 世纪形制重建——雪松木构架外覆铅皮，塔身约 33 米，把全楼总高推到约 75 米。底部两层镂空塔亭由细柱与小山墙围成，天光可以直接穿过；其上是布满卷叶饰的八棱锥，顶端立十字架。',
   note:'画面对照：这座 1853 年的尖塔用的是风化发暗的<b>老铅皮</b>——与圣母院 2024 年复建尖塔的亮铅皮正好互为对照。',
   cam:{pos:[40,54,-48], tgt:[4,58,0], fov:34} },

 { id:'duplex', num:'06', name:'上下双层结构', sub:'Chapelle basse', fr:'下层拱顶 6.6 m',
   era:'1242 – 1248 · 下层献给圣母',
   dim:'下层拱顶仅 6.6 m · 上层专属王室与圣物 · 一座建筑摞着两座礼拜堂',
   desc:'圣礼拜堂其实是两座礼拜堂摞在一起：下层献给圣母，拱顶只有 6.6 米，供王宫的仆从与卫兵使用；上层才是国王的世界，与王宫寝殿由廊道直通，无须落地。这套垂直等级写在外立面上就是三段式：底部一圈矮小的下层窗，腰线一刀切开，之上是通高 15 米的玻璃墙——楼下是人间，楼上是天堂。',
   cam:{pos:[56,20,-50], tgt:[2,16,0], fov:34} }
];

/* ── 相机防穿模：上层礼拜堂天花板 ── */
const CEIL=[
  {x0:X.facIn, x1:X.naveE, z0:-Z.vin, z1:Z.vin, y:27.6, roof:43.0}
];

const TEX={};

P3D.register({
  id:'sainte-chapelle',
  meta:{ title:'圣礼拜堂', sub:'SAINTE-CHAPELLE', badge:'PROCEDURAL · PHASE 0', load:'SAINTE · CHAPELLE' },
  sunHour:15.0,
  /* 与圣母院同城同料（吕特斯石灰岩），色系跟圣母院走；
     尖塔是雪松木外包铅皮，屋面同样是铅不是锌。
     真正的身份在室内彩窗，那部分由 addGlass 的四组玻璃承担，调色板不碰 */
  palette:{ base:'haussmann',
    m:{ stone:0xe6dac0, stone2:0xbfb298, stoneNew:0xf2e8d4,
        lead:0xeae4da, leadNew:0xf2eee7 },
    tint:{ stone:[212,201,179], stone2:[174,163,143], lead:0xcbc3b6, leadNew:0xdfd9cf },
    mat:{ lead:{metalness:0.14, roughness:0.86, envMapIntensity:0.45},
          leadNew:{metalness:0.22, roughness:0.70, envMapIntensity:0.60} },
    tex:{ wall:'ashlar', roof:'lead' } },
  light:'curated',
  dossier:DOSSIER,
  ceil:CEIL,
  interiorBox:{x0:X.facIn, x1:12.6, z:Z.vin, y:29.5},
  /* 后殿半穹顶（CEIL 矩形盖不住圆弧段） */
  clampCam(p){
    const dx=p.x-X.apseC, dz=p.z;
    if(dx>0 && dx*dx+dz*dz<29.1 && p.y>27.6 && p.y<43.0) p.y=27.6;
  },
  labels:[
    {pos:[13.5,70,0],scale:[11,2.75],text:'尖塔 · 总高约 75 m',sub:'FLÈCHE · 1853 · LASSUS',accent:true},
    {pos:[-4,35.5,-12],scale:[10,2.5],text:'十五扇高窗 15.35 m',sub:'约 600 ㎡ 13 世纪原玻璃'},
    {pos:[-24,36,4],scale:[9,2.25],text:'西玫瑰窗 Ø 9 m',sub:'ROSE FLAMBOYANTE · 约 1485'},
    {pos:[-23,3,-9],scale:[9,2.25],text:'无飞扶壁 · 暗藏铁链',sub:'CONTREFORTS · 1242–1248'}
  ],

  /* 彩窗贴图 + 专属玻璃组：发光强度刻意偏高（玻璃墙是这栋楼的灵魂） */
  textures(ctx){
    const H=ctx.helpers;
    // 13 世纪的蓝红主调
    const PW=[[40,58,138],[158,42,44],[52,96,166],[190,148,52],[84,44,120],[36,110,84]];
    /* 平铺：makeWindowGlass 只有 6×8 窗格，15m 高窗需要更密的铅条网格 */
    const tile=(src,nx,ny)=>{
      const c=H.cv(src.width*nx, src.height*ny), g=c.getContext('2d');
      for(let i=0;i<nx;i++)for(let j=0;j<ny;j++) g.drawImage(src,i*src.width,j*src.height);
      return c;
    };
    TEX.win  = tile(H.makeWindowGlass(256, 71, PW), 2, 5);          // 12×40 格 → 15m 高窗
    TEX.winS = H.makeWindowGlass(256, 71, PW);                      // 小圆窗用原始密度
    TEX.low  = tile(H.makeWindowGlass(256, 83, [[46,64,140],[150,46,46],[70,44,116],[178,140,54],[42,96,80]]), 2, 1);
    const PR=[[52,60,146],[164,50,48],[96,46,128],[196,156,60],[46,96,88],[204,196,182]];
    TEX.rose = H.makeRoseTexture(512,{seed:41,pal:PR,r1:0.14,
      medallion:{bg:[40,52,128],robe:[168,52,50],halo:[228,208,152]},zones:[
      {kind:'lance',n:16,r0:0.18,r1:0.40,gap:0.024,pal:[PR[1],PR[0],PR[3],PR[2]]},
      {kind:'quatre',n:24,r0:0.44,r1:0.70,gap:0.012,pal:[PR[0],PR[1],PR[4],PR[3]]},
      {kind:'box',n:32,r0:0.74,r1:0.90,gap:0.009,pal:[PR[3],PR[0],PR[1],PR[2]]}]});
    ctx.addGlass('schaut', TEX.win, 1.55);   // 上层高窗
    ctx.addGlass('scbas',  TEX.low, 1.10);   // 下层小窗
    ctx.addGlass('scocu',  TEX.winS, 1.30);  // 窗头/山墙小圆窗
    ctx.addGlass('scrose', TEX.rose, 1.35);  // 西玫瑰窗
  },

  /* 全部几何 */
  async build(ctx){
    const {G,step,raf,solid}=ctx;
    const {arch,archT,ARCH_N,ARCH_M,lerp,TAU,archPts,cylBand,frameV,RIB_PROF}=ctx.helpers;
    const gs=G.stone, gs2=G.stone2, gd=G.dark, gl=G.lead, gg=G.gold, go=G.oak;
    const GH=G.schaut, GL=G.scbas, GO=G.scocu;

    /* 尖拱玻璃面：grid 的 UV 天然铺满 0..1，铅条密度不失真 */
    const glassX=(gb,x0,x1,z,sill,head,apex)=>gb.grid(8,14,(u,v)=>{
      const top=head+(apex-head)*arch(u);
      return [lerp(x0,x1,u), lerp(sill,top,v), z];
    });
    const glassArc=(gb,cx,r,a0,a1,sill,head,apex)=>gb.grid(6,14,(u,v)=>{
      const a=lerp(a0,a1,u), top=head+(apex-head)*arch(u);
      return [cx+r*Math.cos(a), lerp(sill,top,v), r*Math.sin(a)];
    });
    /* 拱肩：逐段竖条（poly 的扇形三角化对凹多边形失效，会把拱洞糊死） */
    const spandrelX=(gb,x0,x1,head,apex,top,z0,z1)=>{
      const n=12;
      for(let i=0;i<n;i++){
        const t0=i/n, t1=(i+1)/n;
        const xa=lerp(x0,x1,t0), xb=lerp(x0,x1,t1);
        const ya=head+(apex-head)*arch(t0), yb=head+(apex-head)*arch(t1);
        gb.face([[xa,ya,z1],[xb,yb,z1],[xb,top,z1],[xa,top,z1]],0.3);
        gb.face([[xa,top,z0],[xb,top,z0],[xb,yb,z0],[xa,ya,z0]],0.3);
        gb.face([[xa,ya,z0],[xb,yb,z0],[xb,yb,z1],[xa,ya,z1]],0.3);
      }
    };
    const spandrelZ=(gb,z0,z1,head,apex,top,x0,x1)=>{
      const n=12;
      for(let i=0;i<n;i++){
        const t0=i/n, t1=(i+1)/n;
        const za=lerp(z0,z1,t0), zb=lerp(z0,z1,t1);
        const ya=head+(apex-head)*arch(t0), yb=head+(apex-head)*arch(t1);
        gb.face([[x0,ya,za],[x0,yb,zb],[x0,top,zb],[x0,top,za]],0.3);
        gb.face([[x1,top,za],[x1,top,zb],[x1,yb,zb],[x1,ya,za]],0.3);
        gb.face([[x0,ya,za],[x1,ya,za],[x1,yb,zb],[x0,yb,zb]],0.3);
      }
    };

/* ── 地面与地坪 ───────────────────────────────────────────────── */
step(28,'铺设庭院地面与上层地坪'); await raf();
G.floor.box(0, 0.05, 0, 62, 0.1, 36, 0.15);
G.floor.box((X.facIn+X.naveE)/2, Y.floor, 0, X.naveE-X.facIn, 0.26, Z.vin*2, 0.2);
G.floor.disc(X.apseC, Y.floor+0.14, 0, Z.vin, 1, 18);

/* ── 中殿两侧：下层小窗带 + 腰线 + 上层玻璃墙 ─────────────────── */
step(36,'砌筑玻璃墙：15 扇高窗 · 石棂骨架'); await raf();
(function walls(){
  for(const side of [-1,1]){
    const zA=Math.min(side*Z.vin, side*Z.out), zB=Math.max(side*Z.vin, side*Z.out);
    const zc=(zA+zB)/2;
    for(let b=0;b<BAYS;b++){
      const xa=X.facIn+b*BAY, xb=xa+BAY, mid=(xa+xb)/2;

      /* 底座 0 → 下层窗台 */
      gs2.box(mid, Y.lowSill/2, zc, BAY, Y.lowSill, zB-zA, 0.30);

      /* 下层小窗带 lowSill → sill（含腰线以下墙体） */
      {
        const m=1.1, wx0=xa+m, wx1=xb-m;
        gs2.box(xa+m/2, (Y.lowSill+Y.sill)/2, zc, m, Y.sill-Y.lowSill, zB-zA, 0.30);
        gs2.box(xb-m/2, (Y.lowSill+Y.sill)/2, zc, m, Y.sill-Y.lowSill, zB-zA, 0.30);
        spandrelX(gs2, wx0, wx1, Y.lowHead, Y.lowApex, Y.sill, zA, zB);
        glassX(GL, wx0+0.14, wx1-0.14, side*6.48, Y.lowSill+0.14, Y.lowHead, Y.lowApex-0.14);
        gs2.box(mid,(Y.lowSill+Y.lowHead)/2+0.6, zc, 0.24, (Y.lowHead-Y.lowSill)+1.8, 0.42, 0.6);
      }

      /* 上层高窗 sill → wallTop：石头只剩骨架 */
      {
        const m=0.65, wx0=xa+m, wx1=xb-m;
        gs.box(xa+m/2, (Y.sill+Y.wallTop)/2, zc, m, Y.wallTop-Y.sill, zB-zA, 0.30);
        gs.box(xb-m/2, (Y.sill+Y.wallTop)/2, zc, m, Y.wallTop-Y.sill, zB-zA, 0.30);
        spandrelX(gs, wx0, wx1, Y.head, Y.apex, Y.wallTop, zA, zB);
        solid(wx0,Y.head,zA,wx1,Y.wallTop,zB);
        /* 玻璃：几乎占满整个开间，贴住外皮（深窗洞的拱肩底面会遮拱头玻璃） */
        glassX(GH, wx0+0.15, wx1-0.15, side*6.52, Y.sill+0.15, Y.head, Y.apex-0.15);
        /* 石棂：4 束柳叶窗 → 3 根竖棂 + 头部小圆窗 */
        for(let k=1;k<=3;k++)
          gs.box(lerp(wx0,wx1,k/4), (Y.sill+Y.head)/2+0.9, side*6.52, 0.16, (Y.head-Y.sill)+2.2, 0.35, 0.6);
        gs.torus(mid, Y.head+1.5, side*6.60, 0.85, 0.13, 2, 14, 6, 0.4);
        GO.disc(mid, Y.head+1.5, side*6.56, 0.70, 2, 14);
      }

      /* 窗上山墙尖饰（gâble）——「石头荆棘冠」的天际线 */
      {
        const g0=Math.min(side*6.45,side*6.85), g1=Math.max(side*6.45,side*6.85);
        const wx0=xa+0.25, wx1=xb-0.25;
        gs.prism([[wx0,27.0],[mid,Y.gable],[wx1,27.0],[wx1,26.4],[wx0,26.4]],2,g0,g1,0.30);
        gs.torus(mid, 29.1, side*6.9, 0.85, 0.13, 2, 14, 6, 0.4);
        GO.disc(mid, 29.1, side*6.94, 0.70, 2, 14);
        gs.cyl(mid, Y.gable+0.55, side*6.65, 0.16, 0.05, 1.1, 5, 0.8);
        for(let k=1;k<=4;k++){
          const t=k/5;
          gs.cyl(lerp(wx0,mid,t), lerp(27.0,Y.gable,t)+0.35, side*6.65, 0.07,0.05,0.6, 5, 1.0);
          gs.cyl(lerp(mid,wx1,t), lerp(Y.gable,27.0,t)+0.35, side*6.65, 0.07,0.05,0.6, 5, 1.0);
        }
      }
    }
    /* 腰线（上下两层的分界线） */
    gs.box((X.facIn+X.naveE)/2, Y.cornice+0.2, side*6.85, X.naveE-X.facIn, 0.6, 0.7, 0.4);
    /* 墙顶压顶 + 栏杆 */
    gs.box((X.facIn+X.naveE)/2, Y.wallTop+0.15, side*6.15, X.naveE-X.facIn, 0.35, 1.4, 0.4);
    const nB=Math.floor((X.naveE-X.facIn)/1.0);
    for(let i=0;i<=nB;i++)
      gs.cyl(X.facIn+i*(X.naveE-X.facIn)/nB, 29.15, side*6.28, 0.09,0.09,0.8, 5, 0.9);
    gs.box((X.facIn+X.naveE)/2, 29.6, side*6.28, X.naveE-X.facIn, 0.2, 0.35, 0.4);
    /* 整面墙的相机实体 */
    solid(X.facIn, 8.3, Math.min(side*Z.vin,side*Z.out), X.naveE, Y.wallTop, Math.max(side*Z.vin,side*Z.out));
  }
  /* 下层整体（相机不进下层） */
  solid(X.fac, 0, -Z.out, X.naveE, 8.3, Z.out);
})();

/* ── 扶壁（无飞扶壁——这是重点差异）───────────────────────────── */
step(46,'立起纤细扶壁与尖塔饰'); await raf();
(function buttresses(){
  for(const side of [-1,1]) for(let i=0;i<=BAYS;i++){
    const x=X.facIn+i*BAY;
    /* 下段更深（衬托下层），上段收细 */
    gs2.box(x, 4.3, side*7.5, 1.7, 8.6, 1.9, 0.28);
    gs.box(x, 18.6, side*7.2, 1.4, 20.0, 1.3, 0.28);
    gs.box(x, 8.9, side*7.55, 1.9, 0.6, 2.1, 0.4);        // 腰线过渡
    gs.box(x, 24.0, side*7.35, 1.6, 0.5, 1.1, 0.4);       // 上段束带
    /* 顶端小尖塔（pinnacle） */
    gs.box(x, 29.2, side*7.2, 1.6, 1.4, 1.5, 0.3);
    gs.cyl(x, 31.2, side*7.2, 0.52, 0.40, 2.6, 6, 0.6);
    gs.cyl(x, 33.6, side*7.2, 0.26, 0.0, 2.2, 6, 0.6);
    for(let k=0;k<4;k++){const a=Math.PI/4+k/4*TAU;
      gs.cyl(x+Math.cos(a)*0.58, 30.6, side*7.2+Math.sin(a)*0.58, 0.13, 0.0, 1.0, 5, 0.7);}
    solid(x-0.9, 0, Math.min(side*6.6,side*8.5), x+0.9, 29.9, Math.max(side*6.6,side*8.5));
  }
})();

/* ── 后殿：七面环窗 ───────────────────────────────────────────── */
step(54,'砌筑后殿七面环窗'); await raf();
(function apse(){
  const cx=X.apseC, R1=Z.vin, R2=Z.out;
  const ang=t=>lerp(-Math.PI/2, Math.PI/2, t);
  for(let s=0;s<APSE_N;s++){
    const a0=ang(s/APSE_N), a1=ang((s+1)/APSE_N);
    const w0=lerp(a0,a1,0.22), w1=lerp(a0,a1,0.78);
    const lw0=lerp(a0,a1,0.30), lw1=lerp(a0,a1,0.70);
    /* 底座 */
    cylBand(gs2,cx,0,R1,R2,a0,a1, 0, Y.lowSill, 1, 0.30);
    /* 下层小窗带 */
    cylBand(gs2,cx,0,R1,R2,a0,lw0, Y.lowSill, Y.sill, 1, 0.30);
    cylBand(gs2,cx,0,R1,R2,lw1,a1, Y.lowSill, Y.sill, 1, 0.30);
    cylBand(gs2,cx,0,R1,R2,lw0,lw1, t=>Y.lowHead+(Y.lowApex-Y.lowHead)*arch(t), Y.sill, 8, 0.30);
    glassArc(GL, cx, 6.48, lw0, lw1, Y.lowSill+0.12, Y.lowHead, Y.lowApex-0.12);
    /* 上层高窗 */
    cylBand(gs,cx,0,R1,R2,a0,w0, Y.sill, Y.wallTop, 1, 0.30);
    cylBand(gs,cx,0,R1,R2,w1,a1, Y.sill, Y.wallTop, 1, 0.30);
    cylBand(gs,cx,0,R1,R2,w0,w1, t=>Y.head+(Y.apex-Y.head)*arch(t), Y.wallTop, 10, 0.30);
    glassArc(GH, cx, 6.52, w0, w1, Y.sill+0.12, Y.head, Y.apex-0.15);
    /* 中央竖棂 */
    {
      const am=(w0+w1)/2;
      gs.box(cx+Math.cos(am)*6.55, (Y.sill+Y.head)/2+0.9, Math.sin(am)*6.55,
             0.18, (Y.head-Y.sill)+2.0, 0.18, 0.6);
    }
    /* 山墙尖饰（面向法线方向的小三角） */
    {
      const am=(a0+a1)/2, ca=Math.cos(am), sa=Math.sin(am);
      const tx=-sa, tz=ca, hw=1.15;
      const P=(r,t,y)=>[cx+r*ca+t*tx, y, r*sa+t*tz];
      const yb=27.0, yt=31.4, r0=6.45, r1=6.85;
      gs.face([P(r1,-hw,yb),P(r1,hw,yb),P(r1,0,yt),P(r1,0,yt)],0.3);
      gs.face([P(r0,hw,yb),P(r0,-hw,yb),P(r0,0,yt),P(r0,0,yt)],0.3);
      gs.face([P(r0,-hw,yb),P(r1,-hw,yb),P(r1,0,yt),P(r0,0,yt)],0.3);
      gs.face([P(r1,hw,yb),P(r0,hw,yb),P(r0,0,yt),P(r1,0,yt)],0.3);
      gs.cyl(cx+6.65*ca, yt+0.5, 6.65*sa, 0.14, 0.05, 1.0, 5, 0.8);
    }
  }
  /* 腰线 / 压顶 */
  cylBand(gs,cx,0,R2,7.0,-Math.PI/2,Math.PI/2, Y.cornice-0.1, Y.cornice+0.5, 14, 0.4);
  cylBand(gs,cx,0,5.3,6.4,-Math.PI/2,Math.PI/2, Y.wallTop, Y.wallTop+0.35, 14, 0.4);
  /* 后殿放射扶壁（八道） */
  for(let s=0;s<=APSE_N;s++){
    const a=ang(s/APSE_N), da=0.075;
    cylBand(gs2,cx,0,R2,8.3, a-da, a+da, 0, 8.9, 1, 0.28);
    cylBand(gs,cx,0,R2,7.7, a-da*0.85, a+da*0.85, 8.9, 29.2, 1, 0.28);
    const px=cx+7.35*Math.cos(a), pz=7.35*Math.sin(a);
    gs.cyl(px, 30.3, pz, 0.46, 0.36, 2.2, 6, 0.6);
    gs.cyl(px, 32.4, pz, 0.24, 0.0, 2.0, 6, 0.6);
  }
  solid(cx, 0, -5.2, 12.8, 8.3, 5.2);
})();

/* ── 室内：上层礼拜堂 ─────────────────────────────────────────── */
step(62,'装修上层礼拜堂：盲拱座凳 · 使徒柱 · 四分拱顶'); await raf();
(function interior(){
  /* 盲拱座凳带（dado） */
  for(const side of [-1,1]){
    gs.box((X.facIn+X.naveE)/2, 9.65, side*5.28, X.naveE-X.facIn, 2.6, 0.24, 0.4);
    const n=Math.floor((X.naveE-X.facIn)/1.15);
    for(let i=0;i<=n;i++)
      gs.cyl(X.facIn+i*(X.naveE-X.facIn)/n, 9.65, side*5.14, 0.08,0.08,2.4, 6, 0.8);
  }
  cylBand(gs, X.apseC, 0, 5.15, 5.4, -Math.PI/2, Math.PI/2, Y.floor, 10.95, 14, 0.4);

  /* 墙面束柱 + 十二使徒像（窗间柱前） */
  for(let i=0;i<=BAYS;i++){
    const x=X.facIn+i*BAY;
    for(const side of [-1,1]){
      gs.cyl(x, (Y.floor+Y.spring)/2, side*5.12, 0.30, 0.27, Y.spring-Y.floor, 9, 0.5);
      if(i>=1&&i<=3){
        gs2.box(x, 14.35, side*5.02, 0.5, 0.26, 0.42, 0.6);      // 托座
        gs2.cyl(x, 15.25, side*5.02, 0.17, 0.14, 1.5, 7, 0.7);   // 立像
        gs2.cyl(x, 16.15, side*5.02, 0.10, 0.10, 0.24, 6, 0.8);
      }
    }
  }
  /* 后殿束柱 + 其余使徒 */
  for(let s=1;s<APSE_N;s++){
    const a=lerp(-Math.PI/2,Math.PI/2,s/APSE_N);
    const px=X.apseC+5.1*Math.cos(a), pz=5.1*Math.sin(a);
    gs.cyl(px,(Y.floor+Y.spring)/2, pz, 0.28,0.25, Y.spring-Y.floor, 9, 0.5);
    gs2.box(px*0.99, 14.35, pz*0.97, 0.45, 0.26, 0.4, 0.6);
    gs2.cyl(px*0.99, 15.25, pz*0.97, 0.16, 0.13, 1.5, 7, 0.7);
    gs2.cyl(px*0.99, 16.15, pz*0.97, 0.10, 0.10, 0.24, 6, 0.8);
  }
  /* 圣坛拱墙：中殿拱顶与后殿穹顶交界处的拱肩封板（两组曲面形状不同，留缝） */
  {
    const n=16, x0=X.naveE-0.12, x1=X.naveE+0.12, top=Y.crown+0.5;
    for(let i=0;i<n;i++){
      const t0=i/n, t1=(i+1)/n;
      const za=lerp(-Z.vin,Z.vin,t0), zb=lerp(-Z.vin,Z.vin,t1);
      const ya=Y.spring+(Y.crown-Y.spring)*archT(t0,ARCH_N,ARCH_M);
      const yb=Y.spring+(Y.crown-Y.spring)*archT(t1,ARCH_N,ARCH_M);
      gs.face([[x0,ya,za],[x0,yb,zb],[x0,top,zb],[x0,top,za]],0.4);
      gs.face([[x1,top,za],[x1,top,zb],[x1,yb,zb],[x1,ya,za]],0.4);
      gs.face([[x0,ya,za],[x1,ya,za],[x1,yb,zb],[x0,yb,zb]],0.4);
    }
  }

  /* 四分拱顶（每开间一个单元） */
  const ys=Y.spring, yc=Y.crown, fw=Z.vin;
  const fan=(A,B,boss)=>gs.grid(7,8,(u,v)=>{
    const P=archT(v,ARCH_N,ARCH_M), g=Math.sin(u*Math.PI/2);
    return [ lerp(lerp(A[0],B[0],v),boss[0],u), ys+(yc-ys)*(g+(1-g)*P), lerp(lerp(A[1],B[1],v),boss[1],u) ];
  });
  for(let b=0;b<BAYS;b++){
    const xa=X.facIn+b*BAY, xb=xa+BAY, cx2=(xa+xb)/2;
    fan([xa,-fw],[xb,-fw],[cx2,0]); fan([xb,-fw],[xb,fw],[cx2,0]);
    fan([xb,fw],[xa,fw],[cx2,0]);   fan([xa,fw],[xa,-fw],[cx2,0]);
    const P=RIB_PROF.map(p=>[p[0]*0.42,p[1]*0.55]);
    gs.sweep(archPts(xa,-fw,xb,fw,ys,yc,12,arch),P,0.5,frameV);
    gs.sweep(archPts(xa,fw,xb,-fw,ys,yc,12,arch),P,0.5,frameV);
    gs.sweep(archPts(xa,-fw,xa,fw,ys,yc,12,arch),P,0.5,frameV);
    gs.sweep(archPts(xb,-fw,xb,fw,ys,yc,12,arch),P,0.5,frameV);
    gs.cyl(cx2, yc-0.26, 0, 0.7, 0.45, 0.7, 12, 0.6);
  }
  /* 后殿放射拱顶 */
  {
    const cx=X.apseC, boss=[cx,0], R=Z.vin;
    for(let s=0;s<APSE_N;s++){
      const a0=lerp(-Math.PI/2,Math.PI/2,s/APSE_N), a1=lerp(-Math.PI/2,Math.PI/2,(s+1)/APSE_N);
      gs.grid(7,7,(u,v)=>{
        const P=archT(v,ARCH_N,ARCH_M), g=Math.sin(u*Math.PI/2);
        const A=[cx+R*Math.cos(a0),R*Math.sin(a0)], B=[cx+R*Math.cos(a1),R*Math.sin(a1)];
        return [ lerp(lerp(A[0],B[0],v),boss[0],u), ys+(yc-ys)*(g+(1-g)*P), lerp(lerp(A[1],B[1],v),boss[1],u) ];
      });
    }
    for(let s=0;s<=APSE_N;s++){
      const a=lerp(-Math.PI/2,Math.PI/2,s/APSE_N);
      gs.sweep(archPts(cx+R*Math.cos(a),R*Math.sin(a), cx,0, ys,yc, 10, arch),
        RIB_PROF.map(p=>[p[0]*0.38,p[1]*0.50]),0.5,frameV);
    }
    gs.cyl(cx, yc-0.26, 0, 0.7, 0.45, 0.7, 12, 0.6);
  }
})();

/* ── 屋面：陡峭单一坡屋顶 ─────────────────────────────────────── */
step(70,'覆盖陡坡铅皮屋面 · 屋脊饰'); await raf();
(function roof(){
  const x0=-16.6, x1=X.apseC;
  for(const side of [-1,1]){
    const z1=side*7.0;
    const A=[x0,Y.eave,z1], B=[x1,Y.eave,z1], C=[x1,D.ridge,0], Dd=[x0,D.ridge,0];
    gl.face(side>0?[Dd,C,B,A]:[A,B,C,Dd],0.34);
  }
  /* 后殿半锥面 */
  {
    const seg=14, apex=[X.apseC,D.ridge,0];
    for(let i=0;i<seg;i++){
      const a0=lerp(-Math.PI/2,Math.PI/2,i/seg), a1=lerp(-Math.PI/2,Math.PI/2,(i+1)/seg);
      const P=a=>[X.apseC+7.0*Math.cos(a), Y.eave, 7.0*Math.sin(a)];
      gl.face([apex,P(a0),P(a1),P(a1)],0.34);
    }
  }
  /* 屋脊 + 脊饰（鎏金卷叶） */
  gl.box((x0+x1)/2, D.ridge+0.2, 0, x1-x0, 0.45, 0.9, 0.35);
  const n=Math.floor((x1-x0)/2.2);
  for(let i=0;i<=n;i++){
    const x=x0+i*(x1-x0)/n;
    gg.cyl(x, D.ridge+0.75, 0, 0.07, 0.03, 0.7, 5, 1.0);
  }
})();

/* ── 西立面：门廊 · 玫瑰窗 · 山花 · 双梯塔 ───────────────────── */
step(78,'立起西立面：双拱门廊 · 火焰玫瑰窗 · 双梯塔'); await raf();
(function westFacade(){
  const fx=X.fac, fd=X.facIn-X.fac, fcx=fx+fd/2;

  /* 主墙体（含正门洞 z ±2.0） */
  gs.box(fcx, 3.6, -4.3, fd, 7.2, 4.6, 0.28);
  gs.box(fcx, 3.6,  4.3, fd, 7.2, 4.6, 0.28);
  spandrelZ(gs, -2.0, 2.0, 5.2, 7.2, 8.8, fx, fx+fd);
  gd.box(fx+0.55, 2.7, 0, 0.7, 5.4, 3.5, 0.4);
  /* 中段（玫瑰窗以下）+ 盲拱带 */
  gs.box(fcx, 13.7, 0, fd, 9.8, 13.2, 0.28);
  for(let k=0;k<5;k++){
    const c0=-5.5+k*2.2+0.25, c1=-5.5+(k+1)*2.2-0.25;
    const pts=[[c0,14.6]];
    for(let i=0;i<=10;i++){const t=i/10; pts.push([lerp(c0,c1,t), 14.6+1.6*arch(t)]);}
    pts.push([c1,14.6]); pts.push([c1,17.4]); pts.push([c0,17.4]);
    gs.prism(pts,0,fx-0.25,fx+0.4,0.28);
  }
  /* 玫瑰窗区四周墙体 */
  gs.box(fcx, 23.5, -5.75, fd, 9.8, 1.7, 0.28);
  gs.box(fcx, 23.5,  5.75, fd, 9.8, 1.7, 0.28);
  gs.box(fcx, 19.0, 0, fd, 0.9, 11.6, 0.28);
  gs.box(fcx, 28.15, 0, fd, 0.9, 11.6, 0.28);
  /* 方洞四角：贴着玫瑰圆弧补石（凹多边形不能交给 poly，用角点三角扇手工填） */
  for(const sz of [-1,1]) for(const sy of [-1,1]){
    const r=4.42, z2=4.92, y2=4.98;
    const path=[[0,y2],[0,r]];
    for(let i=1;i<=6;i++){const a=i/6*Math.PI/2; path.push([r*Math.sin(a), r*Math.cos(a)]);}
    path.push([z2,0]);
    for(const xp of [fx+0.2, fx+1.1]){
      for(let i=0;i<path.length-1;i++){
        const A=[xp, Y.roseC+sy*path[i][1],   sz*path[i][0]];
        const B=[xp, Y.roseC+sy*path[i+1][1], sz*path[i+1][0]];
        const C=[xp, Y.roseC+sy*y2, sz*z2];
        gs.face([A,B,C,C],0.3);
      }
    }
  }
  /* 火焰式玫瑰窗（自绘石棂：buildRose 的轴对齐辐条在近景会糊成板，
     这里用旋转正确的真辐条 + 细石环，玻璃盘做法与 buildRose 相同） */
  (function rose(){
    const cx=fx+0.45, cy=Y.roseC, R=D.rose/2;
    G.scrose.disc(cx-0.02, cy, 0, R*0.955, 0, 40);
    for(const rg of [[R*0.985,0.40],[R*0.60,0.17],[R*0.26,0.15]])
      gs.torus(cx-0.20, cy, 0, rg[0], rg[1], 0, Math.max(18,Math.round(rg[0]*6)), 7, 0.35);
    const bar=(a,r0,r1,w)=>{
      const ca=Math.cos(a), sa=Math.sin(a);
      const py=-sa*w, pz=ca*w, x0=cx-0.32, x1=cx-0.08;
      const P=(r,s,x)=>[x, cy+r*ca+s*py, r*sa+s*pz];
      gs.face([P(r0,-1,x0),P(r1,-1,x0),P(r1,1,x0),P(r0,1,x0)],0.4);
      gs.face([P(r0,1,x1),P(r1,1,x1),P(r1,-1,x1),P(r0,-1,x1)],0.4);
      gs.face([P(r0,-1,x0),P(r0,-1,x1),P(r1,-1,x1),P(r1,-1,x0)],0.4);
      gs.face([P(r0,1,x1),P(r0,1,x0),P(r1,1,x0),P(r1,1,x1)],0.4);
    };
    for(let k=0;k<8;k++)  bar(k/8*TAU+Math.PI/8, R*0.26, R*0.60, 0.09);
    for(let k=0;k<16;k++) bar(k/16*TAU+Math.PI/16, R*0.60, R*0.985, 0.09);
    /* 火焰式意向：外圈棂间嵌小三叶环 */
    for(let k=0;k<16;k++){
      const a=k/16*TAU;
      gs.torus(cx-0.16, cy+Math.cos(a)*R*0.80, Math.sin(a)*R*0.80, 0.30, 0.07, 0, 10, 5, 0.5);
    }
  })();

  /* 山花（gable）→ 与屋脊同高 */
  gs.prism([[-6.9,Y.wallTop],[0,Y.facGable],[6.9,Y.wallTop],[6.9,Y.wallTop-0.8],[-6.9,Y.wallTop-0.8]],
           0, fx, fx+0.9, 0.28);
  gs.torus(fx+0.42, 33.0, 0, 1.25, 0.18, 0, 16, 6, 0.4);
  GO.disc(fx+0.38, 33.0, 0, 1.05, 0, 14);
  for(let k=1;k<=5;k++){
    const t=k/6;
    gs.cyl(fx+0.4, lerp(Y.wallTop,Y.facGable,t)+0.35, lerp(-6.9,0,t), 0.07,0.05,0.7, 5, 1.0);
    gs.cyl(fx+0.4, lerp(Y.facGable,Y.wallTop,t)+0.35, lerp(0,6.9,t), 0.07,0.05,0.7, 5, 1.0);
  }
  gg.box(fx+0.4, Y.facGable+1.0, 0, 0.12, 2.0, 0.12, 1.0);
  gg.box(fx+0.4, Y.facGable+1.45, 0, 0.12, 0.12, 0.9, 1.0);

  /* 门廊（两拱一中柱，双层带凉廊） */
  {
    const pfx0=X.porch, pfx1=X.porch+0.85;
    for(const sz of [-1,1]) gs2.box(-18.5, 5.75, sz*5.05, 3.0, 11.5, 1.5, 0.28);
    gs.box(-19.55, 3.2, 0, 0.9, 6.4, 1.1, 0.30);
    for(const o of [[-4.3,-0.55],[0.55,4.3]])
      spandrelZ(gs, o[0], o[1], 6.4, 8.9, 10.8, pfx0, pfx1);
    gs.box(-18.5, 11.15, 0, 3.0, 0.7, 11.6, 0.28);
    /* 凉廊层 */
    for(let i=0;i<5;i++){
      const z=-4.6+i*2.3;
      gs.cyl(-19.6, 14.3, z, 0.26, 0.24, 5.2, 8, 0.5);
    }
    for(let i=0;i<4;i++){
      const z0=-4.6+i*2.3, z1=z0+2.3;
      gs.sweep(archPts(-19.6,z0+0.2,-19.6,z1-0.2, 16.0, 17.2, 10, arch),
        [[-0.14,0.3],[-0.14,-0.2],[0.14,-0.2],[0.14,0.3],[-0.14,0.3]],0.55,frameV);
    }
    gs.box(-18.5, 17.75, 0, 3.0, 0.6, 11.0, 0.28);
    const nP=14;
    for(let i=0;i<=nP;i++)
      gs.cyl(-19.6, 18.55, -4.9+i*9.8/nP, 0.08,0.08,0.75, 5, 0.9);
    gs.box(-19.6, 19.0, 0, 0.35, 0.18, 10.2, 0.4);
  }

  /* 双梯塔（镂空冠顶）——立面剪影的另一半 */
  for(const sz of [-1,1]){
    const tz=sz*7.35, tx=-16.6;
    gs.cyl(tx, 4.6, tz, 1.30, 1.16, 9.2, 10, 0.30);
    gs.cyl(tx, 23.9, tz, 1.12, 1.00, 29.4, 10, 0.30);
    for(const yy of [Y.cornice+0.2, 19.0, Y.wallTop]) gs.torus(tx, yy, tz, 1.14, 0.14, 1, 12, 5, 0.4);
    /* 冠顶：八根小柱镂空亭 + 石锥（与山花顶几乎同高） */
    gs.box(tx, 38.85, tz, 2.6, 0.5, 2.6, 0.35);
    for(let k=0;k<8;k++){
      const a=k/8*TAU;
      gs.cyl(tx+Math.cos(a)*0.90, 40.35, tz+Math.sin(a)*0.90, 0.10,0.10,2.5, 6, 0.8);
    }
    gs.box(tx, 41.8, tz, 2.4, 0.4, 2.4, 0.35);
    gs.cyl(tx, 43.4, tz, 1.00, 0.0, 2.9, 8, 0.5);
    gg.cyl(tx, 45.2, tz, 0.07, 0.03, 0.9, 5, 1.0);
    solid(tx-1.5, 0, tz-1.5, tx+1.5, 41.8, tz+1.5);
  }

  /* 相机实体：立面两翼 + 门洞以上（中央门洞留作飞入通道） */
  solid(fx, 0, -6.6, X.facIn, Y.wallTop, -2.1);
  solid(fx, 0,  2.1, X.facIn, Y.wallTop,  6.6);
  solid(fx, 8.8, -2.1, X.facIn, Y.wallTop, 2.1);
})();

/* ── 尖塔（1853 Lassus · 老铅皮）─────────────────────────────── */
step(86,'升起镂空尖塔'); await raf();
(function fleche(){
  const cx=SPX, cz=0;
  /* 裙座：八角裙摆压住屋脊（底缘贴合屋面坡度） */
  {
    const RB=4.1, RT=2.55, yT=42.9;
    const yb=z=>D.ridge - 1.957*Math.abs(z) - 0.9;
    for(let k=0;k<8;k++){
      const a0=k/8*TAU+Math.PI/8, a1=(k+1)/8*TAU+Math.PI/8;
      const b0=[cx+RB*Math.cos(a0), yb(RB*Math.sin(a0)), cz+RB*Math.sin(a0)];
      const b1=[cx+RB*Math.cos(a1), yb(RB*Math.sin(a1)), cz+RB*Math.sin(a1)];
      const t1=[cx+RT*Math.cos(a1), yT, cz+RT*Math.sin(a1)];
      const t0=[cx+RT*Math.cos(a0), yT, cz+RT*Math.sin(a0)];
      gl.face([b0,b1,t1,t0],0.30);
    }
    /* 座缘八座小尖饰 */
    for(let k=0;k<8;k++){
      const a=k/8*TAU+Math.PI/8;
      const px=cx+2.75*Math.cos(a), pz=cz+2.75*Math.sin(a);
      gl.cyl(px, 43.6, pz, 0.22, 0.16, 1.4, 6, 0.6);
      gl.cyl(px, 44.9, pz, 0.13, 0.0, 1.2, 6, 0.6);
    }
  }
  /* 镂空层一：八柱亭 */
  {
    const R=2.30, y0=42.9, y1=48.0;
    go.cyl(cx, (y0+y1)/2, cz, 0.55, 0.45, y1-y0, 8, 0.5);      // 木芯柱
    for(let k=0;k<8;k++){
      const a=k/8*TAU;
      gl.cyl(cx+Math.cos(a)*R, (y0+y1)/2, cz+Math.sin(a)*R, 0.17, 0.15, y1-y0, 6, 0.6);
    }
    for(let k=0;k<8;k++){
      const a0=k/8*TAU, a1=(k+1)/8*TAU, am=(a0+a1)/2;
      const p0=[cx+Math.cos(a0)*R, y1-1.6, cz+Math.sin(a0)*R];
      const p1=[cx+Math.cos(a1)*R, y1-1.6, cz+Math.sin(a1)*R];
      const pk=[cx+Math.cos(am)*R*1.06, y1+0.9, cz+Math.sin(am)*R*1.06];
      gl.face([p0,p1,pk,pk],0.4);                              // 每面小山墙
    }
    gl.box(cx, 48.25, cz, 4.0, 0.5, 4.0, 0.35);
  }
  /* 镂空层二 */
  {
    const R=1.55, y0=48.5, y1=51.6;
    go.cyl(cx, (y0+y1)/2, cz, 0.40, 0.34, y1-y0, 8, 0.5);
    for(let k=0;k<8;k++){
      const a=k/8*TAU+Math.PI/8;
      gl.cyl(cx+Math.cos(a)*R, (y0+y1)/2, cz+Math.sin(a)*R, 0.13, 0.11, y1-y0, 6, 0.6);
    }
    gl.box(cx, 51.85, cz, 2.7, 0.5, 2.7, 0.35);
  }
  /* 八棱锥 + 卷叶饰 */
  {
    const yA=52.1, yB=70.8, RA=1.42, RB=0.10, nC=20;
    for(let k=0;k<8;k++){
      const a0=k/8*TAU-Math.PI/8, a1=k/8*TAU+Math.PI/8;
      for(let i=0;i<nC;i++){
        const t0=i/nC, t1=(i+1)/nC;
        const r0=lerp(RA,RB,t0), r1=lerp(RA,RB,t1);
        const p0=lerp(yA,yB,t0), p1=lerp(yA,yB,t1);
        gl.face([[cx+r0*Math.cos(a0),p0,cz+r0*Math.sin(a0)],
                 [cx+r0*Math.cos(a1),p0,cz+r0*Math.sin(a1)],
                 [cx+r1*Math.cos(a1),p1,cz+r1*Math.sin(a1)],
                 [cx+r1*Math.cos(a0),p1,cz+r1*Math.sin(a0)]],0.30);
      }
      const a=k/8*TAU+Math.PI/8, nK=10;
      for(let q=0;q<nK;q++){
        const t=q/nK, yy=lerp(yA,yB,t), rr=lerp(RA,RB,t);
        gl.cyl(cx+rr*Math.cos(a)*1.04, yy, cz+rr*Math.sin(a)*1.04,
               0.12*(1-t*0.8), 0.05*(1-t*0.8), 0.5*(1-t*0.4), 5, 0.7);
      }
    }
    gg.torus(cx, 60.0, cz, 0.85, 0.07, 1, 12, 5, 0.8);          // 荆棘冠环饰
  }
  /* 顶端十字架 → 总高约 75 m */
  gg.box(cx, 72.6, cz, 0.14, 3.6, 0.14, 1.0);
  gg.box(cx, 73.5, cz, 0.14, 0.14, 1.3, 1.0);
  gg.cyl(cx, 74.7, cz, 0.09, 0.0, 0.6, 5, 1.0);
})();

  },

  /* 彩窗 SpotLight 光斑 + 体积光柱（做法同圣母院玫瑰窗） */
  effects(ctx){
    const {scene}=ctx;
    const SPOTS=ctx.spots, SHAFTS=ctx.shafts;
    /* 玻璃组不接收阴影：深窗洞与山墙的投影会把彩窗压成黑块，
       关掉后白天立面也能读出彩窗（本建筑的灵魂就是玻璃墙） */
    scene.traverse(o=>{
      if(o.isMesh && o.material && o.material.emissiveMap && o.material.transparent){
        o.receiveShadow=false; o.material.needsUpdate=true;
      }
    });
    const beams=[
      /* 南墙高窗（z 负侧）向北下方投彩色光斑 */
      {tex:TEX.win, pos:[-7.0,23.0,-4.6], aim:[-5.0,8.35,2.5], ang:0.46, inten:620, len:24},
      /* 后殿东窗向西下方 */
      {tex:TEX.win, pos:[12.4,24.0,0], aim:[4.5,8.35,0], ang:0.40, inten:500, len:22}
    ];
    for(const r of beams){
      const t=new THREE.CanvasTexture(r.tex);
      if(THREE.sRGBEncoding) t.encoding=THREE.sRGBEncoding;
      const sp=new THREE.SpotLight(0xffffff, r.inten, 90, r.ang, 0.42, 1.55);
      sp.position.set(r.pos[0],r.pos[1],r.pos[2]);
      sp.target.position.set(r.aim[0],r.aim[1],r.aim[2]);
      sp.map=t;
      sp.castShadow=true;                  // 必须：否则着色器内 vSpotLightCoord 不存在
      sp.shadow.mapSize.set(1024,1024);
      sp.shadow.camera.near=1.5; sp.shadow.camera.far=70;
      sp.shadow.bias=-0.0009; sp.shadow.normalBias=0.35;
      scene.add(sp, sp.target);
      SPOTS.push(sp);
      /* 体积光柱 */
      const dir=V3(r.aim[0]-r.pos[0], r.aim[1]-r.pos[1], r.aim[2]-r.pos[2]).normalize();
      const rad=Math.tan(r.ang)*r.len*0.85;
      const shaft=new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, rad, r.len, 22, 1, true),
        new THREE.MeshBasicMaterial({map:t, transparent:true, opacity:0.155,
          blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide}));
      shaft.position.set(r.pos[0]+dir.x*r.len/2, r.pos[1]+dir.y*r.len/2, r.pos[2]+dir.z*r.len/2);
      const q=new THREE.Quaternion().setFromUnitVectors(V3(0,-1,0), dir);
      shaft.quaternion.copy(q);
      shaft.renderOrder=5;
      scene.add(shaft);
      SHAFTS.push(shaft);
    }
  }
});
})();
