/* ═══════════════════════════════════════════════════════════════════
   建筑包 · 卢浮宫 Palais du Louvre — 拿破仑庭院 + 玻璃金字塔
   契约：P3D.register({id, meta, sunHour, dossier, ceil, labels,
                       textures(ctx), build(ctx)})
   数据依据（公认值）：
     金字塔：高 21.64 m · 方形底边约 35.4 m · 玻璃嵌板 673 块
             （603 菱形 + 70 三角形）· 贝聿铭 · 1989 年 3 月落成
     宫殿：拿破仑三世「新卢浮宫」（Visconti / Lefuel，1852–1857）
           庭院立面 = 底层拱廊 + 巨柱式 + 檐口（约 22 m），
           孟莎屋面至约 29 m，亭阁方穹顶约 40 m 量级，
           叙利馆钟亭（Lemercier，1624 年起）为庭院天际线最高点
     庭院：拿破仑庭院约 230 × 140 m（模型取值），三面围合，开口朝西
   ═══════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

/* ── 史实尺寸（单位：米）── */
const D = {
  pyrH:21.64, pyrB:35.4,       // 金字塔高 / 底边
  smH:5.0,    smB:8.2,         // 小金字塔（约 5 m，与主塔同坡度）
  bay:7.0                      // 宫殿立面开间
};
// 平面：X 东西（西为负），Z 南北（北为正）。金字塔位于原点
const X = { east:82, eastOut:106, west:-150 };   // 东翼庭院立面 / 东翼外墙 / 翼楼西端
const Z = { court:69, out:93 };                  // 庭院半宽 / 翼楼外墙
const Y = {
  gfSpring:4.6, gfApex:6.5, gfTop:8.8, band:9.35,   // 底层拱廊
  colB:9.6, colT:17.9, capT:18.6,                   // 巨柱式（科林斯双柱）
  winS:10.4, winT:16.4,                             // 主层窗
  entA:20.3, entB:21.05, corT:21.7,                 // 檐部 / 檐口
  balB:21.75, balT:22.8,                            // 檐口栏杆
  roofB:21.5, deck:28.6,                            // 孟莎屋面 起坡/平台
  pavWall:28.6, pavDomeT:38.6, pavTip:41.6,         // 中段亭阁
  sulWall:30.4, sulDomeT:44.2, sulTip:47.6          // 叙利馆钟亭
};

/* ── 卷宗条目 + 独立机位 ── */
const DOSSIER=[
 { id:'home', num:'00', name:'全景总览', sub:'Vue d’ensemble', fr:'Palais du Louvre · Cour Napoléon',
   era:'1190 中世纪城堡奠基 → 1852–1857 新卢浮宫围合庭院 → 1989 金字塔',
   dim:'金字塔 21.64 m / 底边约 35.4 m · 宫殿檐口约 22 m · 亭阁穹顶约 40 m · 庭院约 230 × 140 m',
   desc:'这座建筑包只有两个主角：贝聿铭玻璃金字塔的通透几何，和拿破仑三世宫殿立面的水平长卷——一个是纯粹的斜面与网格，一个是拱廊、双柱、孟莎屋顶排出的绵密节奏，对比本身就是卢浮宫的识别度。全部几何由代码按史实尺寸生成：三翼开窗节奏、金字塔菱形桁架、方穹顶曲面都是循环与参数曲面算出来的，没有加载任何外部模型。点任一条目，相机会飞到该构件专属的机位。',
   note:'本模型只做围合拿破仑庭院的三翼；再往东的方形庭院（Cour Carrée）与向西延伸的花廊/驿马廊不在范围内，地下 Hall Napoléon 与室内亦未建。',
   cam:{pos:[-234,78,-106], tgt:[16,20,0], fov:41} },

 { id:'pyramide', num:'01', name:'玻璃金字塔', sub:'Pyramide du Louvre', fr:'I. M. Pei · 21.64 m',
   era:'1983 年密特朗「大卢浮宫」计划委托贝聿铭 · 1989 年 3 月落成',
   dim:'高 21.64 m · 方形底边约 35.4 m · 坡面约 51° · 玻璃嵌板 673 块（603 菱形 + 70 三角形）',
   desc:'密特朗把整座宫殿交还博物馆后，卢浮宫需要一个能吞吐千万级客流的新入口——贝聿铭的答案是把入口大厅沉到庭院地下，地面上只留一座全透明的金字塔充当天窗与门厅。方案公布时舆论哗然，反对者称它是「死者之屋」「巴黎脸上的疤」；落成后风向彻底反转，它成了与铁塔并列的巴黎符号。塔高刻意压在宫殿檐口高度之下，玻璃用圣戈班特制的去铁超白玻璃，为的是不给百年立面蒙上一层绿。',
   note:'嵌板数常被讹传为「666 块」，卢浮宫官方口径是 673 块：603 菱形 + 70 三角形。',
   cam:{pos:[-54,10,-36], tgt:[0,9,1], fov:34} },

 { id:'structure', num:'02', name:'金属桁架骨架', sub:'Structure métallique', fr:'Réseau losangé · ≈ 200 t',
   era:'1985–1989 施工 · 节点工艺借自帆船索具',
   dim:'钢杆 + 铝合金嵌板框 + 不锈钢拉索 · 结构总重约 200 吨 · 菱形网格',
   desc:'贝聿铭要求极致的通透，结构因此被拆到不能再细：两族平行杆件在每个坡面上交织成菱形网格，再用不锈钢拉索预张紧，节点做到帆船桅杆索具的精度——承包商确实找了造帆船的工艺来做。白天它是玻璃上的一层银灰色织网，夜里内透光亮起，骨架反而成为主角。',
   note:'技术实现：每个坡面的两族杆件由循环生成（三角形上「连 AB 边 t 点与 BC 边 1−t 点」即得平行线族），玻璃面用 grid() 参数曲面贴 Canvas 渐变贴图。',
   cam:{pos:[-27,7,-16], tgt:[-4,10,-1], fov:31} },

 { id:'cour', num:'03', name:'拿破仑庭院与三翼', sub:'Cour Napoléon', fr:'Richelieu · Denon · Sully',
   era:'1852–1857 年围合成形（此前是一片被拆除的老街区）',
   dim:'庭院约 230 × 140 m · 北翼黎塞留 · 南翼德农 · 东翼叙利 · 开口朝西对杜乐丽花园',
   desc:'庭院三面被宫殿围合：北翼以黎塞留枢机命名，贴里沃利街；南翼以首任馆长德农男爵命名，沿塞纳河；东端的叙利翼通向方形庭院。唯一的开口朝西——从金字塔向西望，卡鲁塞尔凯旋门、协和广场方尖碑、香榭丽舍、凯旋门直到拉德芳斯新凯旋门排在同一条「历史轴线」上，金字塔正是这条 8 公里轴线的起点。',
   note:'轴线起点处还有一尊贝尼尼路易十四骑马像的铅铸复制品，体量太小，本模型未建。',
   cam:{pos:[-176,34,4], tgt:[30,21,0], fov:44} },

 { id:'facade', num:'04', name:'拿破仑三世立面', sub:'Façades Napoléon III', fr:'Visconti / Lefuel · 1852–1857',
   era:'1852 年 Visconti 主持动工，1853 年病逝后由 Lefuel 接手，1857 年落成',
   dim:'底层拱廊 + 巨柱式科林斯双柱 + 檐口 ≈ 22 m · 开间约 7 m · 孟莎屋面至约 29 m',
   desc:'新卢浮宫立面是法式古典主义的教科书三段式：底层是承重感十足的拱廊基座，中段巨柱式双柱一对对排过去，把两层窗统进一个大尺度，顶上以厚重檐口与栏杆收头。装饰比旧卢浮宫繁盛得多——这是第二帝国的胃口。这套「卢浮宫式」立面随后被全世界模仿，从美国的州议会大厦到日本的明治官厅，都是它的回声。',
   note:'看点：整条立面的开窗节奏由循环生成，柱对永远落在开间分缝上——古典立面的秩序感本质上就是一段代码。',
   cam:{pos:[-30,14,-14], tgt:[-40,15,69], fov:42} },

 { id:'comble', num:'05', name:'孟莎屋顶与老虎窗', sub:'Combles à la Mansart', fr:'Toits d’ardoise et de plomb',
   era:'17 世纪 François Mansart 定型的法式屋顶 · 1850 年代在此大规模应用',
   dim:'檐口 22 m 起坡 → 约 29 m 平台 · 双折坡 · 老虎窗约每两开间一扇',
   desc:'孟莎屋顶（mansard）是法式天际线的底色：下段近乎垂直的陡坡包出一整层可用的阁楼，上段近平，铅皮与石板把它们统一成巴黎特有的灰蓝色。陡坡上成排的老虎窗（lucarne）给阁楼采光，也给屋面装上了节拍器。转角与中段的亭阁（pavillon）从屋面里拔出更高的方穹顶——远看卢浮宫，认的就是这条「灰屋顶上顶着一排方穹顶」的天际线。',
   cam:{pos:[-98,44,20], tgt:[-39,26,80], fov:35} },

 { id:'bassins', num:'06', name:'小金字塔与喷泉池', sub:'Pyramidons et bassins', fr:'3 pyramidons · bassins triangulaires',
   era:'1989 年与主塔同期建成',
   dim:'3 座小金字塔高约 5 m · 与主塔同坡度 · 三角形静水池环绕布置',
   desc:'主塔周围立着三座约 5 米高的小金字塔，分居北、南、东三侧——它们不是装饰，而是地下 Hall Napoléon 的采光天窗，阳光顺着玻璃斜面直落到售票大厅。几何在地面上继续繁殖：一圈三角形黑色花岗岩水池只蓄几厘米深的静水，风停时是一组把金字塔倒过来的镜子。',
   note:'第四座「倒金字塔」（Pyramide inversée）藏在西侧卡鲁塞尔商廊的地下，不在本模型范围。',
   cam:{pos:[-23,9,-54], tgt:[6,3,-24], fov:34} },

 { id:'sully', num:'07', name:'叙利馆钟亭', sub:'Pavillon Sully (de l’Horloge)', fr:'Jacques Lemercier · 1624 –',
   era:'1624 年起 Jacques Lemercier 续建 Lescot 翼时所立 · 17 世纪',
   dim:'方穹顶合计高约 45 m（模型取值）· 庭院天际线最高点 · 女像柱与雕饰作简化处理',
   desc:'庭院东端正中的这座亭阁是三翼里资格最老的部分：路易十三时代勒梅西耶在文艺复兴的 Lescot 翼旁把宫殿向北延伸，用这座穹顶亭做了新的构图中心。两个多世纪后拿破仑三世的建筑师们围合庭院时，索性把它当作全场的对景——金字塔的轴线正对它，三翼的亭阁全都在向它看齐。穿过它底层的门洞，就是老卢浮宫的方形庭院。',
   cam:{pos:[-52,25,-13], tgt:[92,30,0], fov:33} }
];

const CEIL=[];   // 无室内

P3D.register({
  id:'louvre',
  meta:{ title:'卢浮宫', sub:'PALAIS DU LOUVRE · PYRAMIDE', badge:'PROCEDURAL · PHASE 0', load:'LE · LOUVRE' },
  sunHour:15.2,          // 午后西南高光：北翼南立面、东翼西立面与金字塔迎光坡同时受光
  /* 石材同为吕特斯石灰岩，但卢浮宫是六座楼里最暖最金的一座——
     参考照片实测（方庭 Cour carrée 西立面日景，Wikimedia Commons）：
       立面 #b39777 H32° S34% V70° —— 饱和度是圣母院(17%)的两倍
     屋面＝深色石板/铅（文艺复兴期改石板防火），冷灰近黑，实测 #69646b */
  palette:{ base:'haussmann',
    m:{ stone:0xe3caa0, stone2:0xb99f78, stoneNew:0xeed9b4,
        /* 颜色交给 tint 承担，材质 color 留在接近白的位置——两边都压暗会相乘 */
        lead:0xe8e8ec, leadNew:0xf0f0f4 },
    tint:{ stone:[214,190,152], stone2:[176,152,118], lead:0x5f5d66, leadNew:0x7b7982 },
    /* 石板瓦是矿物不是金属。metalness 一高就去反射蓝天，深灰石板顶会渲成藏青 */
    mat:{ lead:{metalness:0.06, roughness:0.92, envMapIntensity:0.35},
          leadNew:{metalness:0.10, roughness:0.85, envMapIntensity:0.45} },
    tex:{ wall:'ashlar', roof:'slate' } },
  light:'curated',
  dossier:DOSSIER,
  ceil:CEIL,
  interiorBox:null,
  /* 金字塔斜面防穿模（AABB 会把整个锥体撑成方盒，这里按锥面推出） */
  clampCam(p){
    const B=D.pyrB/2+1.6;
    const dx=Math.max(Math.abs(p.x),Math.abs(p.z));
    if(dx<B){
      const sy=(D.pyrH+1.0)*(1-dx/B)+1.2;
      if(p.y<sy) p.y=sy;
    }
  },
  labels:[
    {pos:[0,30,0],scale:[34,8.5],text:'玻璃金字塔 21.64 m',sub:'PYRAMIDE · I.M.PEI · 1989',accent:true},
    {pos:[-39,48,84],scale:[30,7.5],text:'黎塞留翼',sub:'AILE RICHELIEU · 1852–1857'},
    {pos:[-39,48,-84],scale:[30,7.5],text:'德农翼',sub:'AILE DENON · 1852–1857'},
    {pos:[96,54,0],scale:[30,7.5],text:'叙利馆钟亭 · 天际线最高点',sub:'PAVILLON SULLY · 1624'},
    {pos:[-150,28,0],scale:[30,7.5],text:'开口朝西 → 杜乐丽 · 历史轴线',sub:'AXE HISTORIQUE'}
  ],

  /* 金字塔玻璃 + 宫殿窗玻璃 */
  textures(ctx){
    const H=ctx.helpers;
    /* 金字塔：淡蓝天光渐变 + 菱形分格暗线（超白玻璃气质，低发光） */
    const c=H.cv(512,512), g=c.getContext('2d');
    const gr=g.createLinearGradient(0,512,0,0);      // v=0 底 → v=1 顶（grid 的 uv v 向上）
    gr.addColorStop(0,'#8ea9bc'); gr.addColorStop(0.55,'#bccfdd'); gr.addColorStop(1,'#e2eef5');
    g.fillStyle=gr; g.fillRect(0,0,512,512);
    g.strokeStyle='rgba(58,72,84,0.45)'; g.lineWidth=2;
    const nL=10;
    for(let k=-nL;k<=nL;k++){
      g.beginPath(); g.moveTo(k*512/nL,512); g.lineTo((k+nL)*512/nL,0); g.stroke();
      g.beginPath(); g.moveTo(k*512/nL,512); g.lineTo((k-nL)*512/nL,0); g.stroke();
    }
    g.fillStyle='rgba(255,255,255,0.10)';
    for(let k=0;k<5;k++) g.fillRect(0,40+k*95,512,16);
    ctx.addGlass('gpy', c, 0.30);
    /* 宫殿窗：灰蓝分格窗玻璃，低发光 */
    ctx.addGlass('lvwin',
      H.makeWindowGlass(256,61,[[50,60,74],[62,72,88],[42,50,62],[78,88,102],[56,64,80]]), 0.16);
    /* 水池水面：走玻璃组——不吃体素AO烘焙（金属水面会被池缘AO拉黑），自带微发光 */
    const w=H.cv(256,256), wg=w.getContext('2d');
    const wgr=wg.createLinearGradient(0,256,0,0);
    wgr.addColorStop(0,'#7fa2b4'); wgr.addColorStop(1,'#c2d6e0');
    wg.fillStyle=wgr; wg.fillRect(0,0,256,256);
    wg.strokeStyle='rgba(255,255,255,0.18)'; wg.lineWidth=1.6;
    for(let k=0;k<9;k++){ wg.beginPath(); wg.arc(128,128,14+k*15,0,Math.PI*2); wg.stroke(); }
    ctx.addGlass('lvwater', w, 0.24);
    /* 金属组：桁架铝灰 */
    ctx.addMat('alu',{color:0x70777e,roughness:0.34,metalness:0.88,side:THREE.DoubleSide});
    /* 方穹顶专用无贴图铅材：grid 的整面 UV 会把铅皮贴图拉出云纹 */
    /* 亭阁穹顶是深色石板/铅，实拍近黑（实测 #69646b）。
       原先 metalness 0.55 + envMapIntensity 0.9 在柔光下被 IBL 洗成了近白 */
    /* ⚠️ 引擎 std() 把裸 hex 当线性值用，直接传实测 sRGB 会显著偏亮——
       实测 #69646b 直接传进去显示出来是浅灰。必须 convertSRGBToLinear */
    ctx.addMat('lvdome',{color:new THREE.Color(0x69646b).convertSRGBToLinear(),
      roughness:0.88,metalness:0.10,side:THREE.DoubleSide,envMapIntensity:0.4});
  },

  /* 全部几何：庭院/金字塔/小金字塔水池/三翼/亭阁 */
  async build(ctx){
    const {G,step,raf,solid}=ctx;
    const {lerp,TAU,clamp,cornice}=ctx.helpers;
    const rArch=t=>Math.sqrt(Math.max(0,1-(2*t-1)*(2*t-1)));   // 圆拱（区别于哥特尖拱）
    const vlerp=(a,b,t)=>[lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t)];
    const vnorm=a=>{const l=Math.hypot(a[0],a[1],a[2])||1;return [a[0]/l,a[1]/l,a[2]/l];};
    const vcross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

/* ── 庭院铺装 ─────────────────────────────────────────────────── */
step(28,'铺设拿破仑庭院'); await raf();
/* 浅色石灰岩铺装。切成瓦片网格：体素AO按顶点插值，整块大板会被
   翼楼下的暗角整体拉黑，小瓦片让庭院中部保持亮度 */
for(let i=0;i<14;i++)for(let j=0;j<8;j++){
  const tx=-150+(i+0.5)*232/14, tz=-69+(j+0.5)*138/8;
  G.stone.box(tx, 0.045, tz, 232/14, 0.09, 138/8, 0.10);
}
G.stone.box(X.east+12, 0.045, 0, 24, 0.09, 186, 0.10);       // 东翼与转角下的地坪
/* 金字塔广场描边 */
for(const s of [-1,1]){
  G.stone2.box(0, 0.10, s*21.0, 42.4, 0.06, 0.5, 0.4);
  G.stone2.box(s*21.0, 0.10, 0, 0.5, 0.06, 42.4, 0.4);
}

/* ── 玻璃金字塔（主塔 + 3 小塔）──────────────────────────────── */
step(36,'架设玻璃金字塔：菱形桁架 + 超白玻璃'); await raf();
function buildPyr(cx,cz,h,hb,nDiv,sw,ew){
  const C=[[cx+hb,cz+hb],[cx+hb,cz-hb],[cx-hb,cz-hb],[cx-hb,cz+hb]];
  const apex=[cx,h,cz];
  for(let f=0;f<4;f++){
    const a=C[f], b=C[(f+1)%4];
    const A=[a[0],0,a[1]], B=[b[0],0,b[1]];
    /* 面外法线 */
    const e=[B[0]-A[0],0,B[2]-A[2]], sl=[apex[0]-A[0],apex[1]-A[1],apex[2]-A[2]];
    let nf=vnorm(vcross(e,sl));
    const mid=[(A[0]+B[0])/2-cx,0,(A[2]+B[2])/2-cz];
    if(nf[0]*mid[0]+nf[2]*mid[2]<0) nf=[-nf[0],-nf[1],-nf[2]];
    /* 玻璃面：参数三角面（微缩进面内 0.06） */
    G.gpy.grid(6,6,(u,v)=>{
      const bp=vlerp(A,B,u), p=vlerp(bp,apex,v);
      return [p[0]-nf[0]*0.06, p[1]-nf[1]*0.06, p[2]-nf[2]*0.06];
    });
    /* 细杆：方形截面沿线扫掠，外凸 half 略压在玻璃面之外 */
    const strut=(P,Q,w)=>{
      const dir=vnorm([Q[0]-P[0],Q[1]-P[1],Q[2]-P[2]]);
      const su=vnorm(vcross(nf,dir));
      G.alu.sweep([P,Q],[[-w,-0.05],[w,-0.05],[w,0.15],[-w,0.15],[-w,-0.05]],0.6,
        ()=>({u:su,v:nf}));
    };
    /* 两族平行杆（分别平行于两条斜棱）→ 菱形网格 */
    for(let k=1;k<nDiv;k++){
      const t=k/nDiv;
      strut(vlerp(A,B,t), vlerp(apex,B,t), sw);   // 平行于 A→apex
      strut(vlerp(B,A,t), vlerp(apex,A,t), sw);   // 平行于 B→apex
    }
    /* 斜棱主杆（每面建 A→apex 一条，四条棱恰好各建一次） */
    strut(A,apex,ew);
  }
  /* 基座边梁 */
  G.alu.box(cx, 0.22, cz+hb, 2*hb+0.3, 0.34, 0.34, 0.6);
  G.alu.box(cx, 0.22, cz-hb, 2*hb+0.3, 0.34, 0.34, 0.6);
  G.alu.box(cx+hb, 0.22, cz, 0.34, 0.34, 2*hb+0.3, 0.6);
  G.alu.box(cx-hb, 0.22, cz, 0.34, 0.34, 2*hb+0.3, 0.6);
}
buildPyr(0,0, D.pyrH, D.pyrB/2, 10, 0.10, 0.17);

step(42,'布置小金字塔与三角水池'); await raf();
buildPyr(  0, 30, D.smH, D.smB/2, 4, 0.06, 0.09);
buildPyr(  0,-30, D.smH, D.smB/2, 4, 0.06, 0.09);
buildPyr( 30,  0, D.smH, D.smB/2, 4, 0.06, 0.09);
for(const c of [[0,30],[0,-30],[30,0]]) solid(c[0]-4.2,0,c[1]-4.2,c[0]+4.2,D.smH,c[1]+4.2);
/* 三角形静水池：外圈石缘 + 内圈镜面水 */
function basin(pts){
  G.stone2.prism(pts,1,0,0.52,0.30);        // 池缘石台（实心，兼作池底）
  let cx=0,cz=0; for(const p of pts){cx+=p[0];cz+=p[1];} cx/=pts.length; cz/=pts.length;
  const inn=pts.map(p=>[cx+(p[0]-cx)*0.88, cz+(p[1]-cz)*0.88]);
  G.lvwater.prism(inn,1,0.30,0.60,0.012);   // 水面高出石台 8 cm——「满盈」的静水镜面才看得见
}
for(const q of [[1,1],[1,-1],[-1,1],[-1,-1]])
  basin([[15*q[0],33*q[1]],[33*q[0],33*q[1]],[33*q[0],15*q[1]]]);
basin([[-9,38],[9,38],[0,47]]);
basin([[-9,-38],[9,-38],[0,-47]]);
basin([[38,-9],[38,9],[47,0]]);

/* ── 宫殿翼楼通用构件 ────────────────────────────────────────── */
/* mkWing：把「沿翼方向 u / 进深方向 w」映射到世界坐标
   ew=true：翼沿 X 展开（北/南翼，u=x, w=z）；false：东翼（u=z, w=x）
   sgn：从庭院立面指向建筑内部的方向 */
const mkWing=(ew,sgn,wIn,wOut)=>({ew,sgn,wIn,wOut,
  box(g,u,y,w,su,sy,sw,s){ if(ew) g.box(u,y,w,su,sy,sw,s); else g.box(w,y,u,sw,sy,su,s); },
  prism(g,pts,w0,w1,s){ if(ew) g.prism(pts,2,w0,w1,s); else g.prism(pts,0,w0,w1,s); },   // pts=[u,y]
  prismW(g,pts,u0,u1,s){ if(ew) g.prism(pts,0,u0,u1,s); else g.prism(pts,2,u0,u1,s); },  // pts=[w,y]
  cylv(g,u,y,w,r0,r1,h,seg,s){ if(ew) g.cyl(u,y,w,r0,r1,h,seg,s); else g.cyl(w,y,u,r0,r1,h,seg,s); },
  sol(u0,y0,w0,u1,y1,w1){ if(ew) solid(u0,y0,w0,u1,y1,w1); else solid(w0,y0,u0,w1,y1,u1); },
  world(u,w){ return ew? [u,w] : [w,u]; }
});

/* 庭院立面段：底层拱廊 + 巨柱式 + 檐口 + 栏杆 */
function facadeRun(m,u0,u1){
  const gs=G.stone, gd=G.dark, gg=G.lvwin;
  const wIn=m.wIn, sgn=m.sgn;
  const n=Math.max(1,Math.round((u1-u0)/D.bay)), bw=(u1-u0)/n;
  /* 分缝墩 + 科林斯双柱 */
  for(let b=0;b<=n;b++){
    const u=u0+b*bw;
    m.box(gs,u,Y.gfTop/2,wIn+0.8*sgn, 2.4,Y.gfTop,1.6, 0.3);
    for(const off of [-0.75,0.75]){
      m.cylv(gs,u+off,(Y.colB+Y.colT)/2,wIn-0.35*sgn, 0.40,0.36,Y.colT-Y.colB, 10, 0.4);
      m.box(gs,u+off,Y.colB-0.22,wIn-0.35*sgn, 1.00,0.44,1.00, 0.5);
      m.box(gs,u+off,(Y.colT+Y.capT)/2,wIn-0.35*sgn, 1.05,Y.capT-Y.colT,1.05, 0.5);
    }
  }
  for(let b=0;b<n;b++){
    const ua=u0+b*bw, ub=ua+bw, um=(ua+ub)/2;
    const uA=ua+1.2, uB=ub-1.2;
    /* 底层圆拱：拱肩 */
    const pts=[[uA,Y.gfSpring]];
    for(let i=0;i<=12;i++){const t=i/12; pts.push([lerp(uA,uB,t), Y.gfSpring+(Y.gfApex-Y.gfSpring)*rArch(t)]);}
    pts.push([uB,Y.gfSpring],[uB,Y.gfTop],[uA,Y.gfTop]);
    m.prism(gs,pts,wIn,wIn+1.6*sgn,0.3);
    /* 拱窗玻璃 + 内衬 */
    const gp=[[uA+0.3,0.7],[uB-0.3,0.7],[uB-0.3,Y.gfSpring]];
    for(let i=12;i>=0;i--){const t=i/12; gp.push([lerp(uA,uB,t), Y.gfSpring+(Y.gfApex-Y.gfSpring)*rArch(t)-0.22]);}
    gp.push([uA+0.3,Y.gfSpring]);
    m.prism(gg,gp,wIn+0.95*sgn,wIn+1.07*sgn,0.3);
    m.box(gd,um,3.5,wIn+1.35*sgn, uB-uA-0.5,6.2,0.15, 0.4);
    /* 主层墙段（真开洞：窗两侧/上下砌墙；竖向拆半让AO插值更细） */
    for(const yy of [[Y.band,(Y.band+Y.entA)/2],[(Y.band+Y.entA)/2,Y.entA]]){
      m.box(gs,(ua+um-1.55)/2,(yy[0]+yy[1])/2,wIn+0.8*sgn, um-1.55-ua,yy[1]-yy[0],1.6, 0.3);
      m.box(gs,(um+1.55+ub)/2,(yy[0]+yy[1])/2,wIn+0.8*sgn, ub-um-1.55,yy[1]-yy[0],1.6, 0.3);
    }
    m.box(gs,um,(Y.winT+Y.entA)/2,wIn+0.8*sgn, 3.1,Y.entA-Y.winT,1.6, 0.3);
    m.box(gs,um,(Y.band+Y.winS)/2,wIn+0.8*sgn, 3.1,Y.winS-Y.band,1.6, 0.3);
    /* 窗框 / 窗楣三角山花 / 玻璃 */
    for(const s2 of [-1,1]) m.box(gs,um+s2*1.8,13.4,wIn+0.3*sgn, 0.55,6.4,1.1, 0.5);
    m.box(gs,um,Y.winS-0.25,wIn+0.25*sgn, 4.0,0.5,1.3, 0.5);
    m.box(gs,um,Y.winT+0.25,wIn+0.2*sgn, 4.2,0.5,1.2, 0.5);
    m.prism(gs,[[um-2.1,Y.winT+0.5],[um+2.1,Y.winT+0.5],[um,Y.winT+1.75]],wIn-0.3*sgn,wIn+0.6*sgn,0.4);
    m.box(gg,um,13.4,wIn+0.85*sgn, 3.0,6.0,0.12, 0.3);
    m.box(gd,um,13.4,wIn+1.15*sgn, 2.9,5.9,0.12, 0.4);
    /* 檐下浮雕板 */
    m.box(G.stone2,um,19.35,wIn+0.55*sgn, 2.6,1.1,0.6, 0.5);
  }
  /* 连续条带：底层压檐 / 檐部 / 檐口 / 栏杆 */
  const len=u1-u0, umid=(u0+u1)/2;
  m.box(gs,umid,(Y.gfTop+Y.band)/2,wIn+0.55*sgn, len,Y.band-Y.gfTop,2.3, 0.3);
  m.box(gs,umid,(Y.entA+Y.entB)/2,wIn+0.6*sgn, len,Y.entB-Y.entA,2.2, 0.3);
  m.box(gs,umid,(Y.entB+Y.corT)/2,wIn+0.45*sgn, len,Y.corT-Y.entB,2.7, 0.3);
  m.box(gs,umid,Y.balB+0.1,wIn-0.2*sgn, len,0.2,0.5, 0.4);
  m.box(gs,umid,Y.balT-0.12,wIn-0.2*sgn, len,0.24,0.55, 0.4);
  const nP=Math.round(len/1.8);
  for(let i=0;i<=nP;i++)
    m.box(gs,u0+i*len/nP,(Y.balB+Y.balT)/2,wIn-0.2*sgn, 0.26,Y.balT-Y.balB-0.3,0.26, 0.6);
}

/* 外侧立面（里沃利街 / 塞纳河沿岸，简化） */
function outerRun(m,u0,u1){
  const gs=G.stone, gd=G.dark;
  const wOut=m.wOut, sgn=m.sgn;
  const n=Math.max(1,Math.round((u1-u0)/D.bay)), bw=(u1-u0)/n;
  const len=u1-u0, umid=(u0+u1)/2;
  m.box(gs,umid,Y.corT/2,wOut-0.8*sgn, len,Y.corT,1.6, 0.26);
  for(let b=0;b<=n;b++)
    m.box(G.stone2,u0+b*bw,10.8,wOut-0.05*sgn, 0.9,21.6,0.4, 0.4);
  for(let b=0;b<n;b++){
    const um=u0+(b+0.5)*bw;
    m.box(gd,um,4.9,wOut, 2.4,5.4,0.24, 0.4);
    m.box(gs,um,2.0,wOut-0.1*sgn, 2.9,0.35,0.5, 0.5);
    m.box(gd,um,13.3,wOut, 2.4,5.8,0.24, 0.4);
    m.box(gs,um,10.2,wOut-0.1*sgn, 2.9,0.35,0.5, 0.5);
  }
  m.box(gs,umid,9.05,wOut-0.15*sgn, len,0.5,1.9, 0.3);
  m.box(gs,umid,20.95,wOut-0.25*sgn, len,0.6,2.1, 0.3);
  /* L4 收边：外立面原本到 corT 就是一刀切面，没有檐口。
     庭院面有完整檐部，外面（里沃利街/塞纳河侧）却裸着——这是最显眼的一处裸切边。
     直线段用既有的 m.box 惯用法，不用 cornice（那个是给闭合环用的） */
  m.box(G.stoneNew,umid,Y.corT-0.30,wOut-0.05*sgn, len,0.60,2.9, 0.3);   // 挑出檐口
  m.box(G.stoneNew,umid,Y.corT-0.72,wOut-0.30*sgn, len,0.24,2.4, 0.4);   // 檐下线脚
}

/* 孟莎屋面段 + 老虎窗 + 烟囱 */
function roofRun(m,u0,u1){
  const wIn=m.wIn, wOut=m.wOut, sgn=m.sgn;
  const wA=wIn+ ( -0.8)*sgn, wB=wOut+0.8*sgn;
  m.prismW(G.lead,[[wA,Y.roofB],[wB,Y.roofB],[wOut-5.4*sgn,Y.deck],[wIn+5.4*sgn,Y.deck]],u0,u1,0.25);
  const n=Math.max(1,Math.round((u1-u0)/D.bay)), bw=(u1-u0)/n;
  for(let b=0;b<n;b++){
    const u=u0+(b+0.5)*bw;
    if(b%2===0){          /* 庭院坡老虎窗 */
      m.box(G.stone,u,23.45,wIn+1.5*sgn, 1.7,2.5,1.8, 0.4);
      m.box(G.dark,u,23.35,wIn+0.55*sgn, 1.1,1.6,0.2, 0.4);
      m.prismW(G.lead,[[wIn+0.35*sgn,24.6],[wIn+2.65*sgn,24.6],[wIn+1.5*sgn,25.75]],u-0.95,u+0.95,0.3);
    } else {              /* 外坡老虎窗 */
      m.box(G.stone,u,23.45,wOut-1.5*sgn, 1.7,2.5,1.8, 0.4);
      m.box(G.dark,u,23.35,wOut-0.55*sgn, 1.1,1.6,0.2, 0.4);
      m.prismW(G.lead,[[wOut-0.35*sgn,24.6],[wOut-2.65*sgn,24.6],[wOut-1.5*sgn,25.75]],u-0.95,u+0.95,0.3);
    }
    if(b%3===1){
      m.box(G.stone2,u,Y.deck+1.2,wIn+7.4*sgn, 1.0,2.4,2.2, 0.4);
      m.box(G.stone2,u,Y.deck+1.2,wOut-7.4*sgn, 1.0,2.4,2.2, 0.4);
    }
  }
}

/* 方穹顶（凸面孟莎穹顶，方形平面） */
function squareDome(cx,cz,a0,a1,y0,y1){
  for(const d of [[1,0],[-1,0],[0,1],[0,-1]]){
    const t=[-d[1],d[0]];
    (G.lvdome||G.lead).grid(5,7,(u,v)=>{
      const h=a1+(a0-a1)*Math.pow(Math.cos(v*Math.PI/2),0.78);
      const s=(u*2-1)*h;
      return [cx+d[0]*h+t[0]*s, y0+(y1-y0)*v, cz+d[1]*h+t[1]*s];
    });
  }
}

/* 亭阁（pavillon）：凸出体量 + 巨柱 + 山花 + 方穹顶 */
function pavilion(m,uC,halfW,o){
  const gs=G.stone, gs2=G.stone2, gd=G.dark, gg=G.lvwin, gl=G.lead;
  const sgn=m.sgn, wIn=m.wIn, wOut=m.wOut;
  const wF=wIn-3.5*sgn, wB=wOut+1.5*sgn;
  const wCent=(wF+wB)/2, depth=Math.abs(wB-wF);
  const wall=o.wall, big=!!o.big;
  /* 主体（立面层之后的体量） */
  m.box(gs,uC,wall/2,(wF+1.4*sgn+wB)/2, halfW*2,wall,depth-1.4, 0.22);
  /* 底层三拱门洞 */
  const aw=big?4.0:3.3, spc=big?5.6:4.6, spr=5.2, apx=7.3;
  const cens=[-spc,0,spc];
  let cur=-halfW;
  for(const c of cens){
    if(c-aw/2-cur>0.05)
      m.box(gs,uC+(cur+c-aw/2)/2,Y.gfTop/2,wF+0.7*sgn, c-aw/2-cur,Y.gfTop,1.4, 0.3);
    cur=c+aw/2;
  }
  m.box(gs,uC+(cur+halfW)/2,Y.gfTop/2,wF+0.7*sgn, halfW-cur,Y.gfTop,1.4, 0.3);
  for(const c of cens){
    const A=uC+c-aw/2, B=uC+c+aw/2;
    const pts=[[A,spr]];
    for(let i=0;i<=12;i++){const t=i/12; pts.push([lerp(A,B,t), spr+(apx-spr)*rArch(t)]);}
    pts.push([B,spr],[B,Y.gfTop],[A,Y.gfTop]);
    m.prism(gs,pts,wF,wF+1.4*sgn,0.3);
    m.box(gd,uC+c,(0.2+apx)/2,wF+1.05*sgn, aw-0.3,apx-0.2,0.18, 0.4);
  }
  m.box(gs,uC,9.07,wF+0.45*sgn, halfW*2+0.7,0.55,2.1, 0.3);
  /* 巨柱 */
  const offs = big
    ? [-(halfW-1.7),-(halfW-3.4),-(o.ww/2+0.9), (o.ww/2+0.9),(halfW-3.4),(halfW-1.7)]
    : [-(halfW-1.6),-(halfW-3.2),(halfW-3.2),(halfW-1.6)];
  for(const off of offs){
    m.cylv(gs,uC+off,(Y.colB+Y.colT)/2,wF-0.55*sgn, 0.46,0.42,Y.colT-Y.colB, 10, 0.4);
    m.box(gs,uC+off,Y.colB-0.22,wF-0.55*sgn, 1.15,0.44,1.15, 0.5);
    m.box(gs,uC+off,(Y.colT+Y.capT)/2,wF-0.55*sgn, 1.2,Y.capT-Y.colT,1.2, 0.5);
  }
  /* 主层中央圆拱大窗 */
  const WW=o.ww, wSill=10.2, wSpr=14.6, wApx=16.6;
  const A=uC-WW/2, B=uC+WW/2;
  m.box(gs,(uC-halfW+A)/2,(Y.band+Y.entA)/2,wF+0.7*sgn, A-(uC-halfW),Y.entA-Y.band,1.4, 0.3);
  m.box(gs,(B+uC+halfW)/2,(Y.band+Y.entA)/2,wF+0.7*sgn, uC+halfW-B,Y.entA-Y.band,1.4, 0.3);
  const pts2=[[A,wSpr]];
  for(let i=0;i<=12;i++){const t=i/12; pts2.push([lerp(A,B,t), wSpr+(wApx-wSpr)*rArch(t)]);}
  pts2.push([B,wSpr],[B,Y.entA],[A,Y.entA]);
  m.prism(gs,pts2,wF,wF+1.4*sgn,0.3);
  m.box(gs,uC,(Y.band+wSill)/2,wF+0.7*sgn, WW,wSill-Y.band,1.4, 0.3);
  const gp2=[[A+0.3,wSill+0.15],[B-0.3,wSill+0.15],[B-0.3,wSpr]];
  for(let i=12;i>=0;i--){const t=i/12; gp2.push([lerp(A,B,t), wSpr+(wApx-wSpr)*rArch(t)-0.22]);}
  gp2.push([A+0.3,wSpr]);
  m.prism(gg,gp2,wF+0.9*sgn,wF+1.02*sgn,0.3);
  m.box(gd,uC,(wSill+wApx)/2,wF+1.2*sgn, WW-0.5,wApx-wSill-0.3,0.15, 0.4);
  m.box(gs,uC,wSill-0.35,wF-0.4*sgn, WW+1.2,0.45,1.6, 0.4);   // 阳台挑板
  /* 檐部（更凸） */
  m.box(gs,uC,(Y.entA+Y.entB)/2,wF+0.5*sgn, halfW*2+0.9,Y.entB-Y.entA,2.4, 0.3);
  m.box(gs,uC,(Y.entB+Y.corT)/2,wF+0.35*sgn, halfW*2+1.2,Y.corT-Y.entB,2.9, 0.3);
  /* 阁楼层 */
  m.box(gs,uC,(Y.corT+wall)/2,wF+1.15*sgn, halfW*2,wall-Y.corT,1.6, 0.3);
  for(const c of cens){
    m.box(gd,uC+c,(Y.corT+wall)/2,wF+0.18*sgn, 2.0,wall-Y.corT-1.8,0.25, 0.4);
    m.box(gs,uC+c,Y.corT+0.7,wF+0.16*sgn, 2.5,0.35,0.55, 0.5);
  }
  for(const s2 of [-1,1])
    m.box(gs2,uC+s2*(halfW-0.9),(Y.corT+wall)/2,wF+0.30*sgn, 0.9,wall-Y.corT,0.55, 0.4);
  m.box(gs,uC,wall-0.28,wF+0.6*sgn, halfW*2+1.0,0.56,2.6, 0.3);
  /* 山花 */
  m.prism(gs,[[uC-halfW*0.82,wall],[uC+halfW*0.82,wall],[uC,wall+(big?3.0:2.4)]],wF+0.1*sgn,wF+1.5*sgn,0.35);
  m.prism(gs2,[[uC-halfW*0.60,wall+0.35],[uC+halfW*0.60,wall+0.35],[uC,wall+(big?2.1:1.6)]],wF+0.05*sgn,wF+0.7*sgn,0.4);
  /* 角部隅石 */
  for(const s2 of [-1,1]){
    const nQ=Math.floor(wall/1.5);
    for(let k=0;k<nQ;k++)
      m.box(gs2,uC+s2*(halfW-0.55),0.75+k*1.5,wF+0.55*sgn, (k%2?1.1:1.6),1.3,1.35, 0.45);
  }
  /* 铅皮平台盖 + 方穹顶 */
  m.box(gl,uC,wall+0.25,wCent, halfW*2+0.4,0.5,depth+0.4, 0.3);
  const a0=halfW-2.3, a1=a0*0.36, dy0=wall+0.5, dy1=o.dome;
  const cW=m.world(uC,wCent);
  /* L4 收边：亭阁顶原本是铅皮盖直接压在墙上，一条裸切线。
     补一圈挑出檐口 + 穹顶起拱处一道箍。闭合环用 cornice()，
     世界轴的长宽随翼向翻转（mkWing 的 u/w 映射） */
  { const pw = m.ew ? [halfW*2, depth] : [depth, halfW*2];
    cornice(G.stoneNew, cW[0], wall-0.12, cW[1], pw[0], pw[1], 0.34, 0.62, 0.45);
    cornice(G.stone2,   cW[0], wall-0.62, cW[1], pw[0], pw[1], 0.16, 0.26, 0.5);
    cornice(G.stoneNew, cW[0], dy0+0.16,  cW[1], a0*2,  a0*2,  0.20, 0.34, 0.5); }
  squareDome(cW[0],cW[1],a0,a1,dy0,dy1);
  /* 穹顶牛眼窗（朝庭院） */
  const hv=a1+(a0-a1)*Math.pow(Math.cos(0.38*Math.PI/2),0.78);
  const yOc=dy0+(dy1-dy0)*0.38;
  if(m.ew){
    G.stone.torus(uC,yOc,wCent-(hv+0.15)*sgn, 0.95,0.17, 2, 14, 6, 0.4);
    G.dark.disc(uC,yOc,wCent-(hv+0.30)*sgn, 0.8, 2, 14);
  } else {
    G.stone.torus(wCent-(hv+0.15)*sgn,yOc,uC, 0.95,0.17, 0, 14, 6, 0.4);
    G.dark.disc(wCent-(hv+0.30)*sgn,yOc,uC, 0.8, 0, 14);
  }
  /* 顶座 + 采光亭 + 镀金尖饰 */
  G.lead.box(cW[0],dy1+0.22,cW[1], a1*2+0.7,0.45,a1*2+0.7, 0.4);
  G.stone.box(cW[0],dy1+0.95,cW[1], 1.5,1.1,1.5, 0.5);
  G.lead.cyl(cW[0],dy1+1.9,cW[1], 0.95,0.15,1.0, 8, 0.5);
  G.gold.cyl(cW[0],(dy1+2.4+o.tip)/2,cW[1], 0.13,0.03,o.tip-dy1-2.4, 6, 1.0);
  /* 防穿模 */
  m.sol(uC-halfW,0,Math.min(wF,wB),uC+halfW,wall,Math.max(wF,wB));
  solid(cW[0]-a0,wall,cW[1]-a0,cW[0]+a0,dy1,cW[1]+a0);
}

/* ── 北翼（黎塞留）─────────────────────────────────────────────── */
step(52,'砌筑北翼（黎塞留翼）：拱廊 · 巨柱式 · 孟莎屋面'); await raf();
{
  const mN=mkWing(true,+1,Z.court,Z.out);
  for(const r of [[-132,-48],[-30,40],[58,X.east]]){
    facadeRun(mN,r[0],r[1]); outerRun(mN,r[0],r[1]); roofRun(mN,r[0],r[1]);
  }
  solid(X.west,0,Z.court,X.east,Y.corT,Z.out);
  await raf();
  pavilion(mN,-141,9,{wall:Y.pavWall,dome:Y.pavDomeT,tip:Y.pavTip,ww:4.4});   // 蒂尔戈亭
  pavilion(mN, -39,9,{wall:Y.pavWall,dome:Y.pavDomeT,tip:Y.pavTip,ww:4.4});   // 黎塞留亭
  pavilion(mN,  49,9,{wall:Y.pavWall,dome:Y.pavDomeT,tip:Y.pavTip,ww:4.4});   // 科尔贝亭
}

/* ── 南翼（德农）──────────────────────────────────────────────── */
step(62,'砌筑南翼（德农翼）'); await raf();
{
  const mS=mkWing(true,-1,-Z.court,-Z.out);
  for(const r of [[-132,-48],[-30,40],[58,X.east]]){
    facadeRun(mS,r[0],r[1]); outerRun(mS,r[0],r[1]); roofRun(mS,r[0],r[1]);
  }
  solid(X.west,0,-Z.out,X.east,Y.corT,-Z.court);
  await raf();
  pavilion(mS,-141,9,{wall:Y.pavWall,dome:Y.pavDomeT,tip:Y.pavTip,ww:4.4});   // 莫里安亭
  pavilion(mS, -39,9,{wall:Y.pavWall,dome:Y.pavDomeT,tip:Y.pavTip,ww:4.4});   // 德农亭
  pavilion(mS,  49,9,{wall:Y.pavWall,dome:Y.pavDomeT,tip:Y.pavTip,ww:4.4});   // 达吕亭
}

/* ── 东翼（叙利）+ 钟亭 ───────────────────────────────────────── */
step(72,'砌筑东翼（叙利翼）与钟亭方穹顶'); await raf();
{
  const mE=mkWing(false,+1,X.east,X.eastOut);
  for(const r of [[-69,-13],[13,69]]){
    facadeRun(mE,r[0],r[1]); outerRun(mE,r[0],r[1]); roofRun(mE,r[0],r[1]);
  }
  solid(X.east,0,-Z.court,X.eastOut,Y.corT,Z.court);
  await raf();
  pavilion(mE,0,13,{wall:Y.sulWall,dome:Y.sulDomeT,tip:Y.sulTip,ww:5.6,big:true});  // 叙利馆钟亭
}

/* ── 转角体量（东北 / 东南）──────────────────────────────────── */
step(84,'补齐转角体量与收尾'); await raf();
for(const s of [-1,1]){
  const x0=X.east, x1=X.eastOut, z0=s*Z.court, z1=s*Z.out;
  const zc=(z0+z1)/2;
  G.stone.box((x0+x1)/2,Y.corT/2,zc, x1-x0,Y.corT,Math.abs(z1-z0), 0.24);
  G.stone.box((x0+x1)/2,20.95,zc, x1-x0+0.6,0.55,Math.abs(z1-z0)+0.6, 0.3);
  G.stone.box((x0+x1)/2,9.05,zc, x1-x0+0.4,0.5,Math.abs(z1-z0)+0.4, 0.3);
  for(let k=0;k<3;k++){
    const xm=x0+4+k*8;
    G.dark.box(xm,4.9,z1, 2.2,5.0,0.24, 0.4);
    G.dark.box(xm,13.3,z1, 2.2,5.6,0.24, 0.4);
  }
  G.lead.prism([[x0-0.6,Y.roofB],[x1+0.6,Y.roofB],[x1-4.6,27.2],[x0+4.6,27.2]],2,
               Math.min(z0,z1),Math.max(z0,z1),0.25);
  solid(x0,0,Math.min(z0,z1),x1,Y.corT,Math.max(z0,z1));
}
  },

});
})();
