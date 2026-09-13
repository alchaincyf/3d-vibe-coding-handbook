/* ═══════════════════════════════════════════════════════════════════
   PARIS-3D ENGINE · 程序化建筑引擎（Phase 0 从圣母院单体解剖而来）
   全局暴露 window.P3D：
     P3D.helpers      通用库（噪声/贴图生成/几何构建器/哥特构件）
     P3D.register(def) 注册建筑包
     P3D.runViewer(def) 单建筑查看器（配合 viewer.html 骨架）
   建筑包契约见 建筑包规范.md
   ═══════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

window.P3D = { registry:{}, register(def){ this.registry[def.id]=def; }, _lastSpan:0 };

/* ── 1. 数学 / 噪声 ─────────────────────────────────────────────── */
const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
const lerp=(a,b,t)=>a+(b-a)*t;
const TAU=Math.PI*2;

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

/* 可平铺梯度噪声 */
function makeNoise(seed, period){
  const rnd=mulberry32(seed), n=period*period, g=new Float32Array(n*2);
  for(let i=0;i<n*2;i++) g[i]=rnd()*2-1;
  const P=period;
  return function(x,y){
    const Xi=Math.floor(x), Yi=Math.floor(y), xf=x-Xi, yf=y-Yi;
    const u=xf*xf*(3-2*xf), v=yf*yf*(3-2*yf);
    const x0=((Xi%P)+P)%P, x1=(x0+1)%P, y0=((Yi%P)+P)%P, y1=(y0+1)%P;
    const i00=(y0*P+x0)<<1, i10=(y0*P+x1)<<1, i01=(y1*P+x0)<<1, i11=(y1*P+x1)<<1;
    const n00=g[i00]*xf+g[i00+1]*yf, n10=g[i10]*(xf-1)+g[i10+1]*yf;
    const n01=g[i01]*xf+g[i01+1]*(yf-1), n11=g[i11]*(xf-1)+g[i11+1]*(yf-1);
    return lerp(lerp(n00,n10,u), lerp(n01,n11,u), v);
  };
}
function fbmFactory(noise,oct){return function(x,y){let s=0,a=0.5,f=1,m=0;for(let i=0;i<oct;i++){s+=a*noise(x*f,y*f);m+=a;a*=0.5;f*=2;}return s/m;};}
function archT(t,n,m){const s=Math.abs(2*t-1);return Math.pow(Math.max(0,1-Math.pow(s,n)),1/m);}
const ARCH_N=0.86, ARCH_M=2.85;
const arch=t=>archT(t,ARCH_N,ARCH_M);


const V3=(x,y,z)=>new THREE.Vector3(x,y,z);

/* ── 2. 程序化贴图 ──────────────────────────────────────────────── */
function cv(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}

function makeStone(size, seed, tint, contrast, bed){
  const fbm=fbmFactory(makeNoise(seed,16),5);
  const fine=fbmFactory(makeNoise(seed+77,64),3);
  const H=new Float32Array(size*size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=x/size*16, v=y/size*16;
    let h=fbm(u,v)*0.62+fbm(u*3+11,v*3+7)*0.26+fine(x/size*64,y/size*64)*0.12;
    h+=Math.sin(y/size*TAU*7)*0.028*bed;
    h+=Math.sin(y/size*TAU*23+fbm(u,v)*5.0)*0.010*bed;
    H[y*size+x]=h;
  }
  const cC=cv(size,size),cR=cv(size,size),cN=cv(size,size);
  const gC=cC.getContext('2d'),gR=cR.getContext('2d'),gN=cN.getContext('2d');
  const iC=gC.createImageData(size,size),iR=gR.createImageData(size,size),iN=gN.createImageData(size,size);
  const dC=iC.data,dR=iR.data,dN=iN.data;
  const amp=26*contrast;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const h=H[y*size+x], i=(y*size+x)*4;
    const l=clamp(0.5+h*amp/255,0,1);
    const st=clamp(fbm(x/size*5+31,y/size*5+17)*0.5+0.5,0,1);
    const k=0.82+st*0.30;
    dC[i]=clamp(tint[0]*l*k,0,255); dC[i+1]=clamp(tint[1]*l*k,0,255); dC[i+2]=clamp(tint[2]*l*k*0.985,0,255); dC[i+3]=255;
    const r=clamp(0.70+(0.5-l)*0.55+st*0.10,0.18,1)*255;
    dR[i]=dR[i+1]=dR[i+2]=r; dR[i+3]=255;
  }
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const xm=(x-1+size)%size,xp=(x+1)%size,ym=(y-1+size)%size,yp=(y+1)%size;
    const dx=(H[ym*size+xp]+2*H[y*size+xp]+H[yp*size+xp])-(H[ym*size+xm]+2*H[y*size+xm]+H[yp*size+xm]);
    const dy=(H[yp*size+xm]+2*H[yp*size+x]+H[yp*size+xp])-(H[ym*size+xm]+2*H[ym*size+x]+H[ym*size+xp]);
    let nx=-dx*2.6, ny=-dy*2.6, nz=1;
    const L=Math.hypot(nx,ny,nz); nx/=L;ny/=L;nz/=L;
    const i=(y*size+x)*4;
    dN[i]=(nx*0.5+0.5)*255; dN[i+1]=(ny*0.5+0.5)*255; dN[i+2]=(nz*0.5+0.5)*255; dN[i+3]=255;
  }
  gC.putImageData(iC,0,0); gR.putImageData(iR,0,0); gN.putImageData(iN,0,0);
  return {color:cC, rough:cR, normal:cN};
}

function makeLead(size, seed, base, seams, bright){
  const c=cv(size,size), g=c.getContext('2d');
  const fbm=fbmFactory(makeNoise(seed,32),4);
  g.fillStyle='#'+base.toString(16).padStart(6,'0'); g.fillRect(0,0,size,size);
  const img=g.getImageData(0,0,size,size), d=img.data;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4;
    const n=fbm(x/size*32,y/size*32);
    const p1=Math.sin(x/size*TAU*seams)*0.5+0.5, p2=Math.sin(y/size*TAU*seams*0.5)*0.5+0.5;
    const k=0.80+n*0.30+p1*0.10+p2*0.06;
    d[i]=clamp(d[i]*k*(1+bright*0.35),0,255);
    d[i+1]=clamp(d[i+1]*k*(1+bright*0.38),0,255);
    d[i+2]=clamp(d[i+2]*k*(1+bright*0.42),0,255);
  }
  g.putImageData(img,0,0);
  g.globalAlpha=0.30; g.strokeStyle='rgba(255,255,255,.55)'; g.lineWidth=1.4;
  for(let s=0;s<seams*2;s++){const x=s/(seams*2)*size;g.beginPath();g.moveTo(x,0);g.lineTo(x,size);g.stroke();}
  g.globalAlpha=0.16; g.strokeStyle='rgba(0,0,0,.6)'; g.lineWidth=1;
  for(let s=0;s<seams;s++){const y=s/seams*size;g.beginPath();g.moveTo(0,y);g.lineTo(size,y);g.stroke();}
  g.globalAlpha=1;
  const cN=cv(size,size), gN=cN.getContext('2d');
  const iN=gN.createImageData(size,size), dN=iN.data;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const dx=Math.cos(x/size*TAU*seams*2)*0.55, dy=Math.cos(y/size*TAU*seams)*0.25;
    let nx=dx,ny=dy,nz=1; const L=Math.hypot(nx,ny,nz);
    const i=(y*size+x)*4;
    dN[i]=(nx/L*0.5+0.5)*255; dN[i+1]=(ny/L*0.5+0.5)*255; dN[i+2]=(nz/L*0.5+0.5)*255; dN[i+3]=255;
  }
  gN.putImageData(iN,0,0);
  return {color:c, normal:cN};
}

function makeOak(size, seed){
  const c=cv(size,size), g=c.getContext('2d');
  const fbm=fbmFactory(makeNoise(seed,8),4);
  const img=g.createImageData(size,size), d=img.data;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4;
    const warp=fbm(x/size*8,y/size*8)*9;
    const rings=Math.sin((x/size*24+warp)*Math.PI)*0.5+0.5;
    const grain=fbm(x/size*96,y/size*8)*0.5+0.5;
    const k=0.68+rings*0.30+grain*0.16;
    d[i]=clamp(126*k*1.06,0,255); d[i+1]=clamp(86*k*1.02,0,255); d[i+2]=clamp(50*k*0.98,0,255); d[i+3]=255;
  }
  g.putImageData(img,0,0); return c;
}

function makeWindowGlass(size, seed, pal){
  const c=cv(size,size), g=c.getContext('2d');
  g.fillStyle='#0b0e14'; g.fillRect(0,0,size,size);
  const rnd=mulberry32(seed), cols=6, rows=8, cw=size/cols, ch=size/rows;
  for(let r=0;r<rows;r++)for(let q=0;q<cols;q++){
    const p=pal[Math.floor(rnd()*pal.length)], v=0.72+rnd()*0.5;
    g.fillStyle='rgb('+Math.min(255,p[0]*v|0)+','+Math.min(255,p[1]*v|0)+','+Math.min(255,p[2]*v|0)+')';
    g.fillRect(q*cw+2.2, r*ch+2.2, cw-4.4, ch-4.4);
    g.fillStyle='rgba(255,255,255,'+(0.04+rnd()*0.10)+')';
    g.fillRect(q*cw+2.2, r*ch+2.2, cw-4.4, ch*0.34);
  }
  g.strokeStyle='#191c22'; g.lineWidth=3.4;
  for(let q=0;q<=cols;q++){g.beginPath();g.moveTo(q*cw,0);g.lineTo(q*cw,size);g.stroke();}
  for(let r=0;r<=rows;r++){g.beginPath();g.moveTo(0,r*ch);g.lineTo(size,r*ch);g.stroke();}
  return c;
}

function makeRoseTexture(size, cfg){
  const c=cv(size,size), g=c.getContext('2d');
  g.fillStyle='#080a10'; g.fillRect(0,0,size,size);
  const cx=size/2, cy=size/2, R=size/2-1, rnd=mulberry32(cfg.seed);
  const shade=(p,k)=>'rgb('+clamp(p[0]*k,0,255).toFixed(0)+','+clamp(p[1]*k,0,255).toFixed(0)+','+clamp(p[2]*k,0,255).toFixed(0)+')';
  function wedge(r0,r1,a0,a1,fill){g.beginPath();g.arc(cx,cy,r1,a0,a1);g.arc(cx,cy,r0,a1,a0,true);g.closePath();g.fillStyle=fill;g.fill();}
  function ring(r,w,col){g.beginPath();g.arc(cx,cy,r,0,TAU);g.lineWidth=w;g.strokeStyle=col;g.stroke();}
  function jewel(r,ang,rad,col){const x=cx+Math.cos(ang)*r,y=cy+Math.sin(ang)*r;
    g.beginPath();g.arc(x,y,rad,0,TAU);g.fillStyle=col;g.fill();
    g.lineWidth=Math.max(1,rad*0.30);g.strokeStyle='rgba(10,12,18,.85)';g.stroke();}
  for(const z of cfg.zones){
    const n=z.n, gap=z.gap, off=z.off||0, pal=z.pal||cfg.pal;
    for(let i=0;i<n;i++){
      const a0=off+i/n*TAU+gap, a1=off+(i+1)/n*TAU-gap;
      const col=shade(pal[i%pal.length], 0.85+rnd()*0.42);
      if(z.kind==='lance'){
        wedge(z.r0*R, z.r1*R*0.86, a0, a1, col);
        const am=(a0+a1)/2;
        jewel(z.r1*R*0.93, am, (z.r1-z.r0)*R*0.34, shade(pal[(i+2)%pal.length],1.05));
      } else if(z.kind==='quatre'){
        const am=(a0+a1)/2, rm=(z.r0+z.r1)/2*R, rad=(z.r1-z.r0)*R*0.40;
        for(let k=0;k<4;k++){const aa=am+(k-1.5)*0.13;
          g.beginPath();g.arc(cx+Math.cos(aa)*rm,cy+Math.sin(aa)*rm,rad*0.52,0,TAU);
          g.fillStyle=shade(pal[(i+k)%pal.length],0.95+rnd()*0.3);g.fill();}
      } else {
        wedge(z.r0*R, z.r1*R, a0+gap*0.4, a1-gap*0.4, col);
      }
    }
    ring(z.r0*R, Math.max(2.2,R*0.020), '#0d1017');
    ring(z.r1*R, Math.max(2.2,R*0.020), '#0d1017');
    g.lineWidth=Math.max(2,R*0.016); g.strokeStyle='#0d1017';
    for(let i=0;i<n;i++){const a=off+i/n*TAU;
      g.beginPath();g.moveTo(cx+Math.cos(a)*z.r0*R,cy+Math.sin(a)*z.r0*R);
      g.lineTo(cx+Math.cos(a)*z.r1*R,cy+Math.sin(a)*z.r1*R);g.stroke();}
  }
  const md=cfg.medallion, fr=cfg.r1*R;
  g.beginPath(); g.arc(cx,cy,fr*0.99,0,TAU); g.fillStyle=shade(md.bg,1.0); g.fill();
  g.lineWidth=Math.max(3,R*0.026); g.strokeStyle='#0d1017'; g.stroke();
  g.save(); g.beginPath(); g.arc(cx,cy,fr*0.92,0,TAU); g.clip();
  g.fillStyle=shade(md.robe,1.05);
  g.beginPath(); g.moveTo(cx-fr*0.42,cy+fr*0.95);
  g.quadraticCurveTo(cx-fr*0.30,cy-fr*0.10,cx,cy-fr*0.22);
  g.quadraticCurveTo(cx+fr*0.30,cy-fr*0.10,cx+fr*0.42,cy+fr*0.95);
  g.closePath(); g.fill();
  g.fillStyle=shade(md.halo,1.15);
  g.beginPath(); g.arc(cx,cy-fr*0.46,fr*0.28,0,TAU); g.fill();
  g.lineWidth=Math.max(2,fr*0.05); g.strokeStyle=shade(md.halo,0.55); g.stroke();
  g.fillStyle='rgba(20,16,12,.55)';
  g.beginPath(); g.arc(cx,cy-fr*0.46,fr*0.16,0,TAU); g.fill();
  g.restore();
  ring(R*0.985, Math.max(3,R*0.035), '#0b0e14');
  ring(R*0.905, Math.max(2,R*0.018), '#0d1017');
  return c;
}

function makePavement(size, seed){
  const c=cv(size,size), g=c.getContext('2d');
  const fbm=fbmFactory(makeNoise(seed,24),4);
  const img=g.createImageData(size,size), d=img.data;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4, n=fbm(x/size*24,y/size*24)*0.5+0.5, k=0.72+n*0.42;
    d[i]=clamp(96*k,0,255); d[i+1]=clamp(92*k,0,255); d[i+2]=clamp(86*k,0,255); d[i+3]=255;
  }
  g.putImageData(img,0,0);
  const rnd=mulberry32(seed+5);
  g.strokeStyle='rgba(28,28,30,.55)'; g.lineWidth=2;
  const S=size/8;
  for(let r=0;r<8;r++){ const off=(r%2)*S*0.5;
    for(let q=-1;q<9;q++){ g.strokeRect(q*S+off+rnd()*3, r*S+rnd()*3, S-rnd()*6, S-rnd()*6); } }
  return c;
}

/* 天空：等距圆柱投影，同时供背景与 IBL（PMREM）使用 */
/* ── 2b. 图案级贴图库（L3）────────────────────────────────────────
   与上面「噪声级」贴图的区别：这些有内容——灰缝、砌块、立缝、瓦垄、饰带。
   中景是材质，近景是构造。玫瑰窗（makeRoseTexture）是本项目第一个图案级
   贴图，也是全场最耐看的部位；这一族把那条路线推广到墙面与屋面。
   返回值与 makeStone 同构 {color,rough,normal}，可直接塞进标准材质槽。
   全部吃 tint（调色板角色色的 RGB 三元组），换板即换色。 */

/* 高度场 → 法线贴图（本族公用，Sobel + 环绕采样） */
function normalsFrom(H, size, amp){
  const c=cv(size,size), g=c.getContext('2d');
  const img=g.createImageData(size,size), d=img.data;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const xm=(x-1+size)%size,xp=(x+1)%size,ym=(y-1+size)%size,yp=(y+1)%size;
    const dx=(H[ym*size+xp]+2*H[y*size+xp]+H[yp*size+xp])-(H[ym*size+xm]+2*H[y*size+xm]+H[yp*size+xm]);
    const dy=(H[yp*size+xm]+2*H[yp*size+x]+H[yp*size+xp])-(H[ym*size+xm]+2*H[ym*size+x]+H[ym*size+xp]);
    let nx=-dx*amp, ny=-dy*amp, nz=1;
    const L=Math.hypot(nx,ny,nz); nx/=L;ny/=L;nz/=L;
    const i=(y*size+x)*4;
    d[i]=(nx*0.5+0.5)*255; d[i+1]=(ny*0.5+0.5)*255; d[i+2]=(nz*0.5+0.5)*255; d[i+3]=255;
  }
  g.putImageData(img,0,0); return c;
}
/* 数组 → 灰度贴图（粗糙度用） */
function grayFrom(A, size){
  const c=cv(size,size), g=c.getContext('2d');
  const img=g.createImageData(size,size), d=img.data;
  for(let i=0,n=size*size;i<n;i++){ const v=clamp(A[i],0,1)*255, k=i*4;
    d[k]=d[k+1]=d[k+2]=v; d[k+3]=255; }
  g.putImageData(img,0,0); return c;
}

/* 规整石砌块：可见灰缝 + 逐块色差 + 错缝。哥特/奥斯曼石墙的近景主角 */
function makeAshlar(size, cfg){
  cfg=cfg||{};
  const seed  = cfg.seed==null?7001:cfg.seed;
  const tint  = cfg.tint||[196,186,166];
  const courses = cfg.courses||6;            // 一张贴图里的皮数（横向砌层）
  const per     = cfg.per||3;                // 每皮的块数
  const joint   = cfg.joint==null?0.055:cfg.joint;   // 灰缝宽（占单块比例）
  const jointK  = cfg.jointK==null?0.74:cfg.jointK;  // 灰缝暗度
  const vary    = cfg.vary==null?0.075:cfg.vary;     // 块间色差幅度
  const grit    = cfg.grit==null?0.85:cfg.grit;      // 块内石纹强度
  const depth   = cfg.depth==null?1.0:cfg.depth;     // 灰缝凹陷深度（法线）
  const rnd=mulberry32(seed);
  const fbm=fbmFactory(makeNoise(seed+13,32),4);
  const fine=fbmFactory(makeNoise(seed+91,64),3);
  const rows=[];
  for(let r=0;r<courses;r++){
    const ks=[]; for(let i=0;i<per;i++) ks.push(1+(rnd()-0.5)*2*vary);
    rows.push({off:rnd(), ks:ks});           // off = 错缝偏移
  }
  const H=new Float32Array(size*size), K=new Float32Array(size*size), R=new Float32Array(size*size);
  for(let y=0;y<size;y++){
    const v=y/size, rr=v*courses, r=Math.floor(rr), fr=rr-r;
    const row=rows[((r%courses)+courses)%courses];
    for(let x=0;x<size;x++){
      const u=x/size, uu=(u+row.off)*per, bi=Math.floor(uu), fu=uu-bi;
      const k=row.ks[((bi%per)+per)%per];
      /* mask：0=灰缝中心，1=块面。用 smoothstep 做倒角，法线上就是一圈斜面 */
      const dh=Math.min(fr,1-fr), du=Math.min(fu,1-fu);
      const jm=joint*0.5;
      const sh=clamp((dh-jm*0.45)/(jm*1.15),0,1), su=clamp((du-jm*0.45)/(jm*1.15),0,1);
      const m=Math.min(sh*sh*(3-2*sh), su*su*(3-2*su));
      const stone=fbm(u*14+bi*3.1, v*14+r*5.7)*0.62+fine(u*70+bi, v*70+r)*0.38;
      const i=y*size+x;
      H[i]=(m-1)*0.62*depth + stone*0.16*grit;
      K[i]=k*lerp(jointK,1,m)*(1+stone*0.13*grit);
      R[i]=clamp(lerp(0.99,0.80,m)-stone*0.10,0.55,1);
    }
  }
  const cC=cv(size,size), gC=cC.getContext('2d');
  const iC=gC.createImageData(size,size), dC=iC.data;
  for(let i=0,n=size*size;i<n;i++){ const k=K[i], j=i*4;
    dC[j]=clamp(tint[0]*k,0,255); dC[j+1]=clamp(tint[1]*k,0,255); dC[j+2]=clamp(tint[2]*k*0.99,0,255); dC[j+3]=255; }
  gC.putImageData(iC,0,0);
  return {color:cC, rough:grayFrom(R,size), normal:normalsFrom(H,size,3.4)};
}

/* 锌板立缝屋面：巴黎屋顶的那层灰蓝。竖向凸起的咬合缝 + 氧化斑 */
function makeZinc(size, cfg){
  cfg=cfg||{};
  const seed=cfg.seed==null?7202:cfg.seed;
  const tint=cfg.tint||[142,152,161];
  const seams=cfg.seams||6;                  // 一张贴图里的立缝数
  const ribW =cfg.ribW==null?0.055:cfg.ribW; // 缝宽（占板宽比例）
  const patina=cfg.patina==null?0.5:cfg.patina;
  const fbm=fbmFactory(makeNoise(seed,32),4);
  const fine=fbmFactory(makeNoise(seed+41,64),3);
  const H=new Float32Array(size*size), K=new Float32Array(size*size), R=new Float32Array(size*size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=x/size, v=y/size, uu=u*seams, fu=uu-Math.floor(uu);
    const du=Math.min(fu,1-fu);
    const rib=clamp(1-du/(ribW*0.5),0,1);            // 立缝凸脊
    const pan=Math.cos((fu-0.5)*Math.PI)*0.10;       // 板面微鼓
    const ox=fbm(u*9,v*9)*0.5+0.5, fn=fine(u*48,v*48)*0.5+0.5;
    const i=y*size+x;
    H[i]=rib*0.85+pan*0.20+fn*0.05;
    K[i]=(0.90+pan*0.55+rib*0.16)*(1-patina*0.20*ox)*(0.97+fn*0.06);
    R[i]=clamp(0.30+patina*0.34*ox+rib*0.06,0.18,0.92);
  }
  const cC=cv(size,size), gC=cC.getContext('2d');
  const iC=gC.createImageData(size,size), dC=iC.data;
  for(let i=0,n=size*size;i<n;i++){ const k=K[i], j=i*4;
    dC[j]=clamp(tint[0]*k,0,255); dC[j+1]=clamp(tint[1]*k,0,255); dC[j+2]=clamp(tint[2]*k*1.01,0,255); dC[j+3]=255; }
  gC.putImageData(iC,0,0);
  return {color:cC, rough:grayFrom(R,size), normal:normalsFrom(H,size,3.0)};
}

/* 瓦垄 / 石板瓦：style 'slate'(鳞片) | 'barrel'(筒瓦) | 'flat'(平瓦) */
function makeTiles(size, cfg){
  cfg=cfg||{};
  const seed=cfg.seed==null?7303:cfg.seed;
  const tint=cfg.tint||[120,116,118];
  const style=cfg.style||'slate';
  const rows=cfg.rows||10, cols=cfg.cols||8;
  const vary=cfg.vary==null?0.10:cfg.vary;
  const rnd=mulberry32(seed), fbm=fbmFactory(makeNoise(seed+7,32),4);
  const ks=[]; for(let i=0;i<rows*cols;i++) ks.push(1+(rnd()-0.5)*2*vary);
  const H=new Float32Array(size*size), K=new Float32Array(size*size), R=new Float32Array(size*size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=x/size, v=y/size;
    const rr=v*rows, r=Math.floor(rr), fv=rr-r;
    const stag=(r%2)*0.5;                                  // 错缝
    const cc=(u+stag)*cols, c0=Math.floor(cc), fu=cc-c0;
    const k=ks[(((r%rows)+rows)%rows)*cols+(((c0%cols)+cols)%cols)];
    let h, shade;
    if(style==='barrel'){
      h=Math.sin(fu*Math.PI)*0.9;                          // 半圆筒
      shade=0.72+Math.sin(fu*Math.PI)*0.46;
    }else if(style==='flat'){
      h=(1-fv)*0.5;                                        // 平瓦搭接
      shade=0.80+(1-fv)*0.32;
      if(Math.min(fu,1-fu)<0.035) {h-=0.5; shade*=0.78;}
    }else{                                                 // slate 鳞片
      const dx=(fu-0.5)*2, dy=(fv-0.5)*2;
      const inScale=dx*dx*0.85+dy*dy<1;
      h=inScale? (1-fv)*0.62+0.14 : -0.45;
      shade=inScale? 0.78+(1-fv)*0.36 : 0.60;
    }
    const n=fbm(u*36+c0,v*36+r)*0.5+0.5;
    const i=y*size+x;
    H[i]=h+n*0.06;
    K[i]=shade*k*(0.96+n*0.09);
    R[i]=clamp(0.62+n*0.22-h*0.10,0.35,1);
  }
  const cC=cv(size,size), gC=cC.getContext('2d');
  const iC=gC.createImageData(size,size), dC=iC.data;
  for(let i=0,n=size*size;i<n;i++){ const k=K[i], j=i*4;
    dC[j]=clamp(tint[0]*k,0,255); dC[j+1]=clamp(tint[1]*k,0,255); dC[j+2]=clamp(tint[2]*k,0,255); dC[j+3]=255; }
  gC.putImageData(iC,0,0);
  return {color:cC, rough:grayFrom(R,size), normal:normalsFrom(H,size,2.6)};
}

/* 线脚饰带：檐口/腰线用的重复小构件带。
   band 从上到下依次绘制，每条 {t:'dentil'|'bead'|'meander'|'rosette'|'flat', h:占比, ...} */
function makeFrieze(size, cfg){
  cfg=cfg||{};
  const seed=cfg.seed==null?7404:cfg.seed;
  const tint=cfg.tint||[214,205,187];
  const bands=cfg.bands||[{t:'flat',h:0.16},{t:'dentil',h:0.30,n:16},
                          {t:'bead',h:0.14,n:32},{t:'meander',h:0.28,n:8},{t:'flat',h:0.12}];
  const fbm=fbmFactory(makeNoise(seed,32),4);
  const H=new Float32Array(size*size);
  /* 先把每条带的高度场画进 H（用 canvas 的绘制能力更省事：画灰度再读回） */
  const cH=cv(size,size), gH=cH.getContext('2d');
  gH.fillStyle='#808080'; gH.fillRect(0,0,size,size);
  let y0=0;
  for(const b of bands){
    const bh=Math.max(1,Math.round(b.h*size)), n=b.n||12, w=size/n;
    if(b.t==='flat'){ gH.fillStyle='#8c8c8c'; gH.fillRect(0,y0,size,bh); }
    else if(b.t==='dentil'){                                   // 齿饰：凸块间隔
      gH.fillStyle='#4a4a4a'; gH.fillRect(0,y0,size,bh);
      gH.fillStyle='#e0e0e0';
      for(let i=0;i<n;i++) gH.fillRect(i*w+w*0.22, y0+bh*0.12, w*0.56, bh*0.76);
    }else if(b.t==='bead'){                                    // 联珠
      gH.fillStyle='#5a5a5a'; gH.fillRect(0,y0,size,bh);
      gH.fillStyle='#dcdcdc';
      for(let i=0;i<n;i++){ gH.beginPath();
        gH.arc(i*w+w*0.5, y0+bh*0.5, Math.min(w,bh)*0.38, 0, TAU); gH.fill(); }
    }else if(b.t==='rosette'){                                 // 花瓣饰
      gH.fillStyle='#565656'; gH.fillRect(0,y0,size,bh);
      gH.fillStyle='#d8d8d8';
      for(let i=0;i<n;i++){ const cx=i*w+w*0.5, cy=y0+bh*0.5, R=Math.min(w,bh)*0.42;
        for(let p=0;p<6;p++){ const a=p/6*TAU; gH.beginPath();
          gH.arc(cx+Math.cos(a)*R*0.48, cy+Math.sin(a)*R*0.48, R*0.34, 0, TAU); gH.fill(); }
        gH.beginPath(); gH.arc(cx,cy,R*0.26,0,TAU); gH.fill(); }
    }else{                                                     // meander 回纹
      gH.fillStyle='#525252'; gH.fillRect(0,y0,size,bh);
      gH.strokeStyle='#e4e4e4'; gH.lineWidth=Math.max(2,bh*0.13); gH.lineCap='square';
      for(let i=0;i<n;i++){ const x0=i*w, p=bh*0.18, q=w*0.16;
        gH.beginPath();
        gH.moveTo(x0+q, y0+bh-p); gH.lineTo(x0+q, y0+p); gH.lineTo(x0+w-q, y0+p);
        gH.lineTo(x0+w-q, y0+bh*0.62); gH.lineTo(x0+w*0.46, y0+bh*0.62);
        gH.lineTo(x0+w*0.46, y0+bh*0.40); gH.stroke(); }
    }
    y0+=bh;
  }
  const hd=gH.getImageData(0,0,size,size).data;
  const K=new Float32Array(size*size), R=new Float32Array(size*size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=y*size+x;
    const h=hd[i*4]/255;
    const n=fbm(x/size*30,y/size*30)*0.5+0.5;
    H[i]=(h-0.5)*1.5+n*0.09;
    K[i]=(0.70+h*0.46)*(0.96+n*0.09);          // 凸处受光亮、凹处压暗 = 假 AO
    R[i]=clamp(0.94-h*0.16+n*0.08,0.55,1);
  }
  const cC=cv(size,size), gC=cC.getContext('2d');
  const iC=gC.createImageData(size,size), dC=iC.data;
  for(let i=0,n=size*size;i<n;i++){ const k=K[i], j=i*4;
    dC[j]=clamp(tint[0]*k,0,255); dC[j+1]=clamp(tint[1]*k,0,255); dC[j+2]=clamp(tint[2]*k*0.99,0,255); dC[j+3]=255; }
  gC.putImageData(iC,0,0);
  return {color:cC, rough:grayFrom(R,size), normal:normalsFrom(H,size,2.2)};
}

/* 奥斯曼阳台铁艺：带 alpha 的镂空栏板。
   用法：材质 {map:tex, alphaMap:tex, transparent:true, alphaTest:0.5, side:DoubleSide}
   返回单张 canvas（RGBA，镂空处 alpha=0），alphaMap 用同一张即可 */
function makeIronwork(size, cfg){
  cfg=cfg||{};
  const seed=cfg.seed==null?7505:cfg.seed;
  const col=cfg.color||'#2c2f33';
  const bays=cfg.bays||3;                      // 横向单元数
  const bar =cfg.bar==null?0.030:cfg.bar;      // 杆件粗细（占贴图比例）
  const rnd=mulberry32(seed);
  const c=cv(size,size), g=c.getContext('2d');
  g.clearRect(0,0,size,size);
  g.strokeStyle=col; g.fillStyle=col; g.lineCap='round'; g.lineJoin='round';
  const W=size/bays, LW=size*bar;
  /* 上下横档 */
  g.lineWidth=LW*1.5;
  g.beginPath(); g.moveTo(0,size*0.055); g.lineTo(size,size*0.055);
                 g.moveTo(0,size*0.945); g.lineTo(size,size*0.945); g.stroke();
  g.lineWidth=LW*0.9;
  g.beginPath(); g.moveTo(0,size*0.17); g.lineTo(size,size*0.17); g.stroke();
  for(let b=0;b<bays;b++){
    const x0=b*W, cx=x0+W/2;
    /* 竖向立杆 */
    g.lineWidth=LW; g.beginPath();
    g.moveTo(x0,size*0.17); g.lineTo(x0,size*0.945); g.stroke();
    /* 中央 S 形涡卷（新艺术/第二帝国铁艺的基本笔画） */
    const R=W*0.26, cy=size*0.55;
    g.lineWidth=LW*0.85;
    for(const s of [1,-1]){
      g.beginPath();
      for(let i=0;i<=48;i++){
        const t=i/48, a=t*Math.PI*1.65, r=R*(0.22+0.78*t);
        const px=cx+Math.cos(a)*r*s, py=cy-s*R*0.72+Math.sin(a)*r*0.86;
        i?g.lineTo(px,py):g.moveTo(px,py);
      }
      g.stroke();
    }
    /* 两侧对称小卷须 */
    for(const s of [-1,1]){
      g.lineWidth=LW*0.62; g.beginPath();
      for(let i=0;i<=32;i++){
        const t=i/32, a=-Math.PI*0.15+t*Math.PI*1.25, r=W*0.10*(0.3+0.7*t);
        const px=cx+s*W*0.30+Math.cos(a)*r, py=cy+Math.sin(a)*r;
        i?g.lineTo(px,py):g.moveTo(px,py);
      }
      g.stroke();
    }
    /* 铆点 */
    for(const yy of [0.30,0.55,0.80]){ g.beginPath();
      g.arc(cx, size*yy, LW*0.85, 0, TAU); g.fill(); }
    if(rnd()<0){}   /* seed 保留给未来的随机变体 */
  }
  return c;
}

/* 摄影棚环境（L2 studio 模式）：不是天空，是一张软箱灯 + 纸背景的 equirect。
   Hy4 那种「宣纸摄影棚」范式——不做天空不做地形，把预算全花在单体上 */
function makeStudio(w,h,cfg){
  cfg=cfg||{};
  const paper=cfg.paper||[244,239,227];
  const top  =cfg.top  ||[255,252,246];
  const floorC=cfg.floor||[214,205,190];
  const keyAz=cfg.keyAz==null?0.62:cfg.keyAz;      // 主光方位（0-1）
  const c=cv(w,h), g=c.getContext('2d');
  const img=g.createImageData(w,h), d=img.data;
  for(let y=0;y<h;y++){
    const v=(y+0.5)/h, dy=Math.cos(v*Math.PI);
    for(let x=0;x<w;x++){
      const u=(x+0.5)/w;
      /* 上半球：软箱主光是一大块柔和亮斑；下半球：纸面反光，向下渐暗 */
      let base = dy>0 ? lerp(paper[0],top[0],Math.pow(dy,0.7)) : lerp(paper[0],floorC[0],Math.pow(-dy,0.55));
      let baseG= dy>0 ? lerp(paper[1],top[1],Math.pow(dy,0.7)) : lerp(paper[1],floorC[1],Math.pow(-dy,0.55));
      let baseB= dy>0 ? lerp(paper[2],top[2],Math.pow(dy,0.7)) : lerp(paper[2],floorC[2],Math.pow(-dy,0.55));
      const du=Math.min(Math.abs(u-keyAz),1-Math.abs(u-keyAz));
      const key=Math.pow(clamp(1-du/0.30,0,1),1.6)*Math.pow(clamp(dy,0,1),0.5);
      const fill=Math.pow(clamp(1-Math.min(Math.abs(u-(keyAz+0.5)%1),1-Math.abs(u-(keyAz+0.5)%1))/0.42,0,1),1.4)
                 *Math.pow(clamp(dy,0,1),0.7);
      const k=1+key*0.34+fill*0.12;
      const i=(y*w+x)*4;
      d[i]=clamp(base*k,0,255); d[i+1]=clamp(baseG*k,0,255); d[i+2]=clamp(baseB*k,0,255); d[i+3]=255;
    }
  }
  g.putImageData(img,0,0); return c;
}

function makeSky(w,h,sunDir){
  const c=cv(w,h), g=c.getContext('2d');
  const img=g.createImageData(w,h), d=img.data;
  const fbm=fbmFactory(makeNoise(9137,32),5);
  const L=Math.hypot(sunDir[0],sunDir[1],sunDir[2]);
  const sx=sunDir[0]/L, sy=sunDir[1]/L, sz=sunDir[2]/L;
  const sunU=Math.atan2(sz,sx)/TAU+0.5, sunV=Math.acos(clamp(sy,-1,1))/Math.PI;
  for(let y=0;y<h;y++){
    const v=(y+0.5)/h, theta=v*Math.PI, dy=Math.cos(theta);
    for(let x=0;x<w;x++){
      const u=(x+0.5)/w;
      const dx=Math.sin(theta)*Math.cos(u*TAU), dz=Math.sin(theta)*Math.sin(u*TAU);
      let r,gg,b;
      if(dy>0.005){
        const t=Math.pow(clamp(dy,0,1),0.55);
        r=lerp(196,74,t); gg=lerp(196,124,t); b=lerp(188,196,t);
        const hz=Math.pow(1-clamp(dy*3.2,0,1),2.2);
        r=lerp(r,238,hz*0.65); gg=lerp(gg,206,hz*0.55); b=lerp(b,176,hz*0.5);
        let cl=fbm(u*32, theta*16)*0.5+0.5;
        cl=clamp((cl-0.50)*3.0,0,1)*Math.pow(clamp(dy*4,0,1),0.5);
        const lit=clamp(0.5+(dx*sx+dy*sy+dz*sz)*0.7,0,1);
        r=lerp(r,lerp(196,255,lit),cl*0.85);
        gg=lerp(gg,lerp(202,250,lit),cl*0.85);
        b=lerp(b,lerp(214,252,lit),cl*0.85);
        const duv=Math.min(Math.abs(u-sunU),1-Math.abs(u-sunU));
        const dv=Math.abs(v-sunV);
        const ang=Math.hypot(duv*(w/h)*0.5,dv)*Math.PI;
        const disc=clamp(1-ang/0.030,0,1), glow=clamp(1-ang/0.55,0,1);
        r+=disc*255+glow*glow*120; gg+=disc*238+glow*glow*104; b+=disc*206+glow*glow*76;
      } else {
        const t=clamp(-dy*4,0,1), n=fbm(u*32,v*32)*0.5+0.5;
        r=lerp(120,64,t)*(0.82+n*0.3); gg=lerp(112,62,t)*(0.82+n*0.3); b=lerp(100,56,t)*(0.82+n*0.3);
      }
      const i=(y*w+x)*4;
      d[i]=clamp(r,0,255); d[i+1]=clamp(gg,0,255); d[i+2]=clamp(b,0,255); d[i+3]=255;
    }
  }
  g.putImageData(img,0,0); return c;
}


/* ── 3. 几何构建器与哥特构件 ────────────────────────────────────── */
const NAN_FIXES=[];   /* GB.build 的退化面清洗记录（全局收集） */
class GB {
  constructor(){ this.P=[]; this.N=[]; this.U=[]; this.I=[]; this.n=0; }
  v(px,py,pz,nx,ny,nz,u,vv){ this.P.push(px,py,pz); this.N.push(nx,ny,nz); this.U.push(u,vv); return this.n++; }
  tri(a,b,c){ this.I.push(a,b,c); }
  quad(a,b,c,d){ this.I.push(a,b,c, a,c,d); }

  /* 给定法线的凸多边形，自动纠正绕序 */
  poly(pts3,nrm,o,eu,ev,s){
    const a=pts3[0], b=pts3[1], c=pts3[2];
    if(!b||!c) return;
    const u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]], v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
    const n=[u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const dt=n[0]*nrm[0]+n[1]*nrm[1]+n[2]*nrm[2];
    const P=dt>=0?pts3:pts3.slice().reverse();
    const idx=[];
    for(let i=0;i<P.length;i++){
      const p=P[i], w=[p[0]-o[0],p[1]-o[1],p[2]-o[2]];
      idx.push(this.v(p[0],p[1],p[2],nrm[0],nrm[1],nrm[2],
        (w[0]*eu[0]+w[1]*eu[1]+w[2]*eu[2])*s,
        (w[0]*ev[0]+w[1]*ev[1]+w[2]*ev[2])*s));
    }
    /* 投影到多边形平面做2D凹凸检测：凸→扇形快路径；凹→耳切法
       （凹多边形扇形三角化会把洞口糊上切片，圣礼拜堂拱肩实证） */
    let t1=[0,0,0];
    if(Math.abs(nrm[1])<0.9){ t1=[nrm[2],0,-nrm[0]]; } else { t1=[1,0,0]; }
    let tl=Math.hypot(t1[0],t1[1],t1[2])||1; t1=[t1[0]/tl,t1[1]/tl,t1[2]/tl];
    const t2=[nrm[1]*t1[2]-nrm[2]*t1[1], nrm[2]*t1[0]-nrm[0]*t1[2], nrm[0]*t1[1]-nrm[1]*t1[0]];
    const p2=P.map(p=>[p[0]*t1[0]+p[1]*t1[1]+p[2]*t1[2], p[0]*t2[0]+p[1]*t2[1]+p[2]*t2[2]]);
    let ccwArea=0;
    for(let i=0;i<p2.length;i++){ const a2=p2[i],b2=p2[(i+1)%p2.length]; ccwArea+=a2[0]*b2[1]-b2[0]*a2[1]; }
    const sgn=ccwArea>=0?1:-1;
    let convex=true;
    for(let i=0;i<p2.length;i++){
      const a2=p2[(i+p2.length-1)%p2.length], b2=p2[i], c2=p2[(i+1)%p2.length];
      const cr=(b2[0]-a2[0])*(c2[1]-b2[1])-(b2[1]-a2[1])*(c2[0]-b2[0]);
      if(cr*sgn<-1e-9){ convex=false; break; }
    }
    if(convex){
      for(let i=1;i<idx.length-1;i++) this.tri(idx[0],idx[i],idx[i+1]);
      return;
    }
    /* 耳切法（多边形规模都很小，O(n²)足够） */
    const rest=idx.map((_,i)=>i);
    const cross2=(a2,b2,c2)=>(b2[0]-a2[0])*(c2[1]-b2[1])-(b2[1]-a2[1])*(c2[0]-b2[0]);
    const inTri=(pp,a2,b2,c2)=>{
      const d1=cross2(a2,b2,pp)*sgn, d2=cross2(b2,c2,pp)*sgn, d3=cross2(c2,a2,pp)*sgn;
      return d1>=-1e-9&&d2>=-1e-9&&d3>=-1e-9;
    };
    let guard=rest.length*rest.length+8;
    while(rest.length>3&&guard-->0){
      let clipped=false;
      for(let i=0;i<rest.length;i++){
        const ia=rest[(i+rest.length-1)%rest.length], ib=rest[i], ic=rest[(i+1)%rest.length];
        const a2=p2[ia], b2=p2[ib], c2=p2[ic];
        if(cross2(a2,b2,c2)*sgn<=1e-10) continue;       /* 凹顶点不是耳 */
        let ok=true;
        for(const j of rest){
          if(j===ia||j===ib||j===ic) continue;
          if(inTri(p2[j],a2,b2,c2)){ ok=false; break; }
        }
        if(!ok) continue;
        this.tri(idx[ia],idx[ib],idx[ic]);
        rest.splice(i,1); clipped=true; break;
      }
      if(!clipped) break;                                /* 退化：跳出交给兜底扇形 */
    }
    if(rest.length===3) this.tri(idx[rest[0]],idx[rest[1]],idx[rest[2]]);
    else for(let i=1;i<rest.length-1;i++) this.tri(idx[rest[0]],idx[rest[i]],idx[rest[i+1]]);
  }
  face(a,b,c,d,s){
    /* 重载：face(vertsArr, scale) —— 用四顶点数组 + scale */
    if(Array.isArray(a) && (b===undefined||typeof b==='number')){
      s=typeof b==='number'?b:(s===undefined?0.3:s);
      [a,b,c,d]=a;
    } else {
      s=(s===undefined||s===null)?0.3:s;
    }
    /* 防御：a/b/c 必须是顶点数组；d 可缺省 → 按三角面处理（旧版曾静默丢弃3点面） */
    if(!Array.isArray(a)||!Array.isArray(b)||!Array.isArray(c)) return;
    const quad=Array.isArray(d);
    const vv=quad?d:c;
    const u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]], v=[vv[0]-a[0],vv[1]-a[1],vv[2]-a[2]];
    let n=[u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const L=Math.hypot(n[0],n[1],n[2])||1; n=[n[0]/L,n[1]/L,n[2]/L];
    const Lu=Math.hypot(u[0],u[1],u[2])||1, Lv=Math.hypot(v[0],v[1],v[2])||1;
    this.poly(quad?[a,b,c,d]:[a,b,c], n, a, [u[0]/Lu,u[1]/Lu,u[2]/Lu], [v[0]/Lv,v[1]/Lv,v[2]/Lv], s);
  }
  box(cx,cy,cz,sx,sy,sz,s){
    s=(s===undefined||s===null)?0.3:s;
    if(sx<=0||sy<=0||sz<=0) return;
    const x0=cx-sx/2,x1=cx+sx/2,y0=cy-sy/2,y1=cy+sy/2,z0=cz-sz/2,z1=cz+sz/2;
    this.face([x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],s);
    this.face([x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0],s);
    this.face([x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],s);
    this.face([x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],s);
    this.face([x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0],s);
    this.face([x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],s);
  }
  /* 棱柱拉伸：pts 为 2D 点；axis 2→(x,y)拉伸z，0→(z,y)拉伸x，1→(x,z)拉伸y */
  prism(pts,axis,d0,d1,s){
    s=(s===undefined||s===null)?0.3:s;
    const m=(p,d)=> axis===2?[p[0],p[1],d] : (axis===0?[d,p[1],p[0]]:[p[0],d,p[1]]);
    let area=0;
    for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];area+=a[0]*b[1]-b[0]*a[1];}
    const P=area>=0?pts:pts.slice().reverse(), n=P.length;
    let cx=0,cy=0; for(const p of P){cx+=p[0];cy+=p[1];} cx/=n; cy/=n;
    const ax=axis===0?[1,0,0]:(axis===1?[0,1,0]:[0,0,1]);
    const front=P.map(p=>m(p,d1)), back=P.map(p=>m(p,d0));
    const A=front[0],B=front[1],C=front[2];
    const u=[B[0]-A[0],B[1]-A[1],B[2]-A[2]], v=[C[0]-A[0],C[1]-A[1],C[2]-A[2]];
    const nn=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const ccw=(nn[0]*ax[0]+nn[1]*ax[1]+nn[2]*ax[2])>0;
    const o3=m(P[0],0);
    const e1=axis===0?[0,0,1]:(axis===1?[1,0,0]:[1,0,0]);
    const e2=axis===0?[0,1,0]:(axis===1?[0,0,1]:[0,1,0]);
    this.poly(ccw?front:front.slice().reverse(), ax, o3, e1, e2, s);
    this.poly(ccw?back.slice().reverse():back, [-ax[0],-ax[1],-ax[2]], o3, e1, e2, s);
    for(let i=0;i<n;i++){
      const p0=P[i], p1=P[(i+1)%n];
      const ex=p1[0]-p0[0], ey=p1[1]-p0[1];
      let nx2=ey, ny2=-ex;
      const L=Math.hypot(nx2,ny2)||1; nx2/=L; ny2/=L;
      const mx=(p0[0]+p1[0])/2, my=(p0[1]+p1[1])/2;
      if(nx2*(mx-cx)+ny2*(my-cy)<0){nx2=-nx2;ny2=-ny2;}
      const dir=axis===2?[nx2,ny2,0]:(axis===0?[0,ny2,nx2]:[nx2,0,ny2]);
      const uu=axis===2?[1,0,0]:(axis===0?[0,0,1]:[1,0,0]);
      this.poly([m(p0,d0),m(p1,d0),m(p1,d1),m(p0,d1)], dir, m(p0,d0), uu, ax, s);
    }
  }
  /* 沿三维折线扫掠剖面（共享顶点 → 平滑） */
  sweep(pts,prof,s,frameFn){
    s=(s===undefined||s===null)?0.4:s;
    const n=pts.length, m=prof.length, rows=[]; let acc=0;
    for(let i=0;i<n;i++){
      if(i>0){const a=pts[i-1],b=pts[i];acc+=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);}
      const F=frameFn(pts,i), row=[];
      for(let j=0;j<m;j++){
        const px=prof[j][0], py=prof[j][1];
        row.push(this.v(pts[i][0]+F.u[0]*px+F.v[0]*py,
                        pts[i][1]+F.u[1]*px+F.v[1]*py,
                        pts[i][2]+F.u[2]*px+F.v[2]*py, 0,1,0, j/(m-1)*s*2, acc*s));
      }
      rows.push(row);
    }
    for(let i=0;i<n-1;i++)for(let j=0;j<m-1;j++) this.quad(rows[i][j],rows[i][j+1],rows[i+1][j+1],rows[i+1][j]);
  }
  cyl(cx,cy,cz,r0,r1,h,seg,s,caps){
    s=(s===undefined||s===null)?0.35:s;
    const y0=cy-h/2, y1=cy+h/2, rows=[[],[]];
    for(let i=0;i<=seg;i++){
      const a=i/seg*TAU, ca=Math.cos(a), sa=Math.sin(a);
      rows[0].push(this.v(cx+r0*ca,y0,cz+r0*sa,ca,0,sa, i/seg*r0*TAU*s, 0));
      rows[1].push(this.v(cx+r1*ca,y1,cz+r1*sa,ca,0,sa, i/seg*r1*TAU*s, h*s));
    }
    for(let i=0;i<seg;i++) this.quad(rows[0][i],rows[0][i+1],rows[1][i+1],rows[1][i]);
    if(caps!==false){
      const top=[], bot=[];
      for(let i=0;i<seg;i++){
        const a=i/seg*TAU, ca=Math.cos(a), sa=Math.sin(a);
        top.push([cx+r1*ca,y1,cz+r1*sa]); bot.push([cx+r0*ca,y0,cz+r0*sa]);
      }
      if(r1>0.001) this.poly(top,[0,1,0],[cx,y1,cz],[1,0,0],[0,0,1],s);
      if(r0>0.001) this.poly(bot.slice().reverse(),[0,-1,0],[cx,y0,cz],[1,0,0],[0,0,1],s);
    }
  }
  torus(cx,cy,cz,R,r,axis,uSeg,vSeg,s){
    const pts=[];
    for(let i=0;i<=uSeg;i++){
      const a=i/uSeg*TAU, ca=Math.cos(a), sa=Math.sin(a);
      if(axis===2) pts.push([cx+R*ca,cy+R*sa,cz]);
      else if(axis===0) pts.push([cx,cy+R*sa,cz+R*ca]);
      else pts.push([cx+R*ca,cy,cz+R*sa]);
    }
    const prof=[];
    for(let j=0;j<=vSeg;j++){const b=j/vSeg*TAU; prof.push([r*Math.cos(b),r*Math.sin(b)]);}
    this.sweep(pts,prof,s,(P,i)=>{
      const a=i/uSeg*TAU, ca=Math.cos(a), sa=Math.sin(a);
      if(axis===2) return {u:[ca,sa,0],v:[0,0,1]};
      if(axis===0) return {u:[0,sa,ca],v:[1,0,0]};
      return {u:[ca,0,sa],v:[0,1,0]};
    });
  }
  disc(cx,cy,cz,R,axis,seg){
    const n=axis===2?[0,0,1]:(axis===0?[1,0,0]:[0,1,0]);
    const c=this.v(cx,cy,cz,n[0],n[1],n[2],0.5,0.5), ring=[];
    for(let i=0;i<=seg;i++){
      const a=i/seg*TAU, ca=Math.cos(a), sa=Math.sin(a);
      let p;
      if(axis===2) p=[cx+R*ca,cy+R*sa,cz];
      else if(axis===0) p=[cx,cy+R*sa,cz+R*ca];
      else p=[cx+R*ca,cy,cz+R*sa];
      ring.push(this.v(p[0],p[1],p[2],n[0],n[1],n[2],0.5+0.5*ca,0.5+0.5*sa));
    }
    for(let i=0;i<seg;i++) this.tri(c,ring[i],ring[i+1]);
  }
  /* 平滑参数网格（拱顶穹面） */
  grid(nu,nv,fn){
    const idx=[];
    for(let i=0;i<=nu;i++){ const row=[];
      for(let j=0;j<=nv;j++) row.push(this.v(0,0,0,0,1,0,i/nu,j/nv));
      idx.push(row); }
    for(let i=0;i<=nu;i++)for(let j=0;j<=nv;j++){
      const p=fn(i/nu,j/nv), k=idx[i][j]*3;
      this.P[k]=p[0]; this.P[k+1]=p[1]; this.P[k+2]=p[2];
    }
    for(let i=0;i<nu;i++)for(let j=0;j<nv;j++) this.quad(idx[i][j],idx[i][j+1],idx[i+1][j+1],idx[i+1][j]);
  }
  build(){
    /* 清洗：任何非有限坐标归零，避免退化面把包围球算成 NaN */
    let bad=0;
    for(let i=0;i<this.P.length;i++){
      if(!Number.isFinite(this.P[i])){ this.P[i]=0; bad++; }
    }
    for(let i=0;i<this.N.length;i++) if(!Number.isFinite(this.N[i])) this.N[i]=0;
    for(let i=0;i<this.U.length;i++) if(!Number.isFinite(this.U[i])) this.U[i]=0;
    if(bad) NAN_FIXES.push({group:this.mat&&this.mat.name||'?', bad:bad, verts:this.P.length/3});
    const g=new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P,3));
    g.setAttribute('normal',   new THREE.Float32BufferAttribute(this.N,3));
    g.setAttribute('uv',       new THREE.Float32BufferAttribute(this.U,2));
    g.setIndex(this.I);
    g.computeVertexNormals();     // 未共享顶点→平面着色；共享顶点（sweep/cyl/grid）→平滑
    g.computeBoundingSphere();
    return g;
  }
}

/* 哥特肋架剖面（x 水平半宽，y 竖向；负=悬挂于拱腹） */
const RIB_PROF=[
  [-1.00,0.34],[-1.00,-0.02],[-0.82,-0.22],[-0.60,-0.48],[-0.34,-0.72],
  [-0.12,-0.88],[0.00,-0.93],[0.12,-0.88],[0.34,-0.72],[0.60,-0.48],
  [0.82,-0.22],[1.00,-0.02],[1.00,0.34],[-1.00,0.34]
];
function frameV(pts,i){
  const n=pts.length, a=pts[Math.max(0,i-1)], b=pts[Math.min(n-1,i+1)];
  let dx=b[0]-a[0], dz=b[2]-a[2];
  const L=Math.hypot(dx,dz)||1; dx/=L; dz/=L;
  return {u:[dz,0,-dx], v:[0,1,0]};
}
function frameW(pts,i){
  const n=pts.length, a=pts[Math.max(0,i-1)], b=pts[Math.min(n-1,i+1)];
  let dx=b[0]-a[0], dy=b[1]-a[1];
  const L=Math.hypot(dx,dy)||1; dx/=L; dy/=L;
  return {u:[dy,-dx,0], v:[0,0,1]};
}
/* 拱券曲线：平面直线 + 竖向拱形 */
function archPts(ax,az,bx,bz,y0,y1,seg,fn){
  const p=[];
  for(let i=0;i<=seg;i++){ const t=i/seg;
    p.push([ lerp(ax,bx,t), y0+(y1-y0)*(fn?fn(t):arch(t)), lerp(az,bz,t) ]); }
  return p;
}
/* 柱面环带：角度 a0→a1，半径 r0→r1，高度 yLo(t)→yHi(t) */
function cylBand(gb,cx,cz,r0,r1,a0,a1,yLo,yHi,seg,s,caps){
  s=(s===undefined||s===null)?0.3:s;
  const fLo=typeof yLo==='function'?yLo:(()=>yLo), fHi=typeof yHi==='function'?yHi:(()=>yHi);
  const P=(r,a,y)=>[cx+r*Math.cos(a), y, cz+r*Math.sin(a)];
  const inner = r0>0.01;
  for(let i=0;i<seg;i++){
    const t0=i/seg, t1=(i+1)/seg;
    const A0=lerp(a0,a1,t0), A1=lerp(a0,a1,t1);
    const l0=fLo(t0), l1=fLo(t1), h0=fHi(t0), h1=fHi(t1);
    gb.face([P(r1,A0,l0),P(r1,A0,h0),P(r1,A1,h1),P(r1,A1,l1)], s);      // 外
    if(inner) gb.face([P(r0,A0,h0),P(r0,A0,l0),P(r0,A1,l1),P(r0,A1,h1)], s); // 内
    gb.face([P(r0,A0,h0),P(r0,A1,h1),P(r1,A1,h1),P(r1,A0,h0)], s);      // 顶
    gb.face([P(r1,A0,l0),P(r1,A1,l1),P(r0,A1,l1),P(r0,A0,l0)], s);      // 底
  }
  if(caps!==false){
    gb.face([P(r0,a0,fLo(0)),P(r0,a0,fHi(0)),P(r1,a0,fHi(0)),P(r1,a0,fLo(0))], s);
    gb.face([P(r0,a1,fLo(1)),P(r1,a1,fLo(1)),P(r1,a1,fHi(1)),P(r0,a1,fHi(1))], s);
  }
}


/* 玫瑰窗：石质棂条 + 彩色玻璃 */
function buildRose(gGlass, gStone, cx, cy, cz, dia, axis, sign, spokes){
  const R=dia/2;
  if(axis===2){ gGlass.disc(cx, cy, cz+sign*0.02, R*0.955, 2, 40); }
  else        { gGlass.disc(cx+sign*0.02, cy, cz, R*0.955, 0, 40); }
  const rings=[[R*0.985,0.60,0.30],[R*0.86,0.30,0.18],[R*0.42,0.26,0.16],[R*0.17,0.30,0.16]];
  for(const rg of rings){
    if(axis===2) gStone.torus(cx, cy, cz+sign*rg[2], rg[0], rg[1], 2,
                              Math.max(16,Math.round(rg[0]*6)), 8, 0.35);
    else         gStone.torus(cx+sign*rg[2], cy, cz, rg[0], rg[1], 0,
                              Math.max(16,Math.round(rg[0]*6)), 8, 0.35);
  }
  /* 辐条：沿径向的真实石棂条（旧版轴对齐盒在斜角会膨胀成方板） */
  const mull=(r0,r1,n,thick,dep)=>{
    const D=0.30;
    for(let i=0;i<n;i++){
      const a=i/n*TAU+Math.PI/n, ca=Math.cos(a), sa=Math.sin(a);
      const tx=-sa*thick/2, ty=ca*thick/2;          /* 玫瑰平面内的切向半厚 */
      /* 玫瑰平面内四角（u,v），再沿窗轴向挤出 D */
      const q=[[r0*ca-tx, r0*sa-ty],[r1*ca-tx, r1*sa-ty],
               [r1*ca+tx, r1*sa+ty],[r0*ca+tx, r0*sa+ty]];
      const pt=(u,v,d)=> axis===2 ? [cx+u, cy+v, cz+sign*(dep+d)]
                                  : [cx+sign*(dep+d), cy+v, cz+u];
      const A0=pt(q[0][0],q[0][1],-D/2), B0=pt(q[1][0],q[1][1],-D/2),
            C0=pt(q[2][0],q[2][1],-D/2), D0=pt(q[3][0],q[3][1],-D/2),
            A1=pt(q[0][0],q[0][1], D/2), B1=pt(q[1][0],q[1][1], D/2),
            C1=pt(q[2][0],q[2][1], D/2), D1=pt(q[3][0],q[3][1], D/2);
      gStone.face([A0,B0,C0,D0],0.45); gStone.face([D1,C1,B1,A1],0.45);
      gStone.face([A0,A1,B1,B0],0.45); gStone.face([B0,B1,C1,C0],0.45);
      gStone.face([C0,C1,D1,D0],0.45); gStone.face([D0,D1,A1,A0],0.45);
    }
  };
  mull(R*0.17,R*0.42,spokes,0.30,0.16);
  mull(R*0.42,R*0.86,spokes,0.30,0.16);
  mull(R*0.86,R*0.985,spokes*2,0.22,0.20);
}


/* ── 3b. 勾边与收边构件（L4）──────────────────────────────────────
   插画的「线稿感」搬进 3D：每个体块的边缘都有一根构件收口（金边/线脚/扶手）。
   裸切面是廉价感的最大来源——一根 12cm 的包边就能把它变成「有人做过收口」。*/

/* 沿三维折线扫掠方截面线条。up 决定截面朝向：w 横向、h 沿 up 方向 */
function trimPath(gb, pts, w, h, up, s){
  up=up||[0,1,0];
  const a=w/2, b=h/2;
  const prof=[[-a,-b],[a,-b],[a,b],[-a,b],[-a,-b]];
  gb.sweep(pts, prof, s==null?0.5:s, function(P,i){
    const p0=P[Math.max(0,i-1)], p1=P[Math.min(P.length-1,i+1)];
    let t=[p1[0]-p0[0],p1[1]-p0[1],p1[2]-p0[2]];
    const L=Math.hypot(t[0],t[1],t[2])||1; t=[t[0]/L,t[1]/L,t[2]/L];
    let u=[t[1]*up[2]-t[2]*up[1], t[2]*up[0]-t[0]*up[2], t[0]*up[1]-t[1]*up[0]];
    let lu=Math.hypot(u[0],u[1],u[2]);
    if(lu<1e-4){ u=Math.abs(t[1])>0.9?[1,0,0]:[0,1,0];      /* 折线与 up 平行时换参照 */
      u=[t[1]*u[2]-t[2]*u[1], t[2]*u[0]-t[0]*u[2], t[0]*u[1]-t[1]*u[0]];
      lu=Math.hypot(u[0],u[1],u[2])||1; }
    u=[u[0]/lu,u[1]/lu,u[2]/lu];
    return {u:u, v:[u[1]*t[2]-u[2]*t[1], u[2]*t[0]-u[0]*t[2], u[0]*t[1]-u[1]*t[0]]};
  });
}
/* 矩形闭合勾边（窗框/门框/画板边）。axis: 2→XY面, 0→YZ面, 1→XZ面 */
function trimRect(gb, cx,cy,cz, sw, sh, axis, w, h, s){
  const A=(x,y)=> axis===2?[cx+x,cy+y,cz] : (axis===0?[cx,cy+y,cz+x] : [cx+x,cy,cz+y]);
  const a=sw/2, b=sh/2;
  const up = axis===2?[0,0,1] : (axis===0?[1,0,0] : [0,1,0]);
  trimPath(gb, [A(-a,-b),A(a,-b),A(a,b),A(-a,b),A(-a,-b)], w, h, up, s);
}
/* 檐口线脚：盒体顶部一圈挑出的收边。out=挑出量，h=线脚高 */
function cornice(gb, cx,cy,cz, sx,sz, out, h, s){
  const a=sx/2+out, b=sz/2+out;
  trimPath(gb, [[cx-a,cy,cz-b],[cx+a,cy,cz-b],[cx+a,cy,cz+b],[cx-a,cy,cz+b],[cx-a,cy,cz-b]],
           out*2, h, [0,1,0], s);
}
/* 盒体棱线包边（轴对齐，用 box 拼，三角形最省）。
   which: 'top' 只包顶四棱 | 'cap' 顶底八棱 | 'all' 含四根立棱 */
function trimBox(gb, cx,cy,cz, sx,sy,sz, w, which, s){
  which=which||'cap';
  const hx=sx/2, hy=sy/2, hz=sz/2, q=w/2;
  const H=(y)=>{ gb.box(cx, cy+y, cz-hz, sx+w, w, w, s); gb.box(cx, cy+y, cz+hz, sx+w, w, w, s);
                 gb.box(cx-hx, cy+y, cz, w, w, sz-w, s);  gb.box(cx+hx, cy+y, cz, w, w, sz-w, s); };
  H(hy);
  if(which!=='top') H(-hy);
  if(which==='all') for(const sx2 of [-1,1]) for(const sz2 of [-1,1])
    gb.box(cx+sx2*hx, cy, cz+sz2*hz, w, sy-w, w, s);
  return q;
}

/* ── 3c. 调色板系统（L1）──────────────────────────────────────────
   策展纪律：整场只用 5-8 个颜色，全部从这里取，禁止在建筑包里散点写 hex。
   一个板 = 一套气质。`m` 是材质固有色，`tint` 是贴图底色（两者相乘），
   `tex` 选贴图路线（噪声级 vs 图案级），`light` 是配套的建议光照模式。*/
const PALETTES = {
  /* 现状基准：数值与升级前逐位一致，用于 before/after 对照，禁止改动 */
  'baseline':{
    label:'现状基准（写实石灰岩）',
    note:'升级前的取色：单色系+材质变化，没有「调色板」这个设计物',
    m:{ stone:0xd6cdbb, stone2:0xa79d8d, stoneNew:0xe8dfca, lead:0x8d949c, leadNew:0xc6cfd8,
        oak:0x9c7442, gold:0xd7a244, dark:0x11131a, floor:0x8f8879, ground:0x9a938a },
    tint:{ stone:[186,178,163], stone2:[152,145,133], lead:0x6b7076, leadNew:0x9aa4ad },
    trim:0xd7a244, accent:0xd7a244,
    glass:[[38,58,120],[46,74,138],[152,120,52],[64,44,96],[150,52,44]],
    tex:{ wall:'noise', roof:'lead' }, light:'daylight'
  },
  /* 方向 A：从奥斯曼巴黎的实物固有色派生 */
  'haussmann':{
    label:'奥斯曼奶油',
    note:'奶油石灰岩 + 锌灰蓝屋顶 + 咖啡馆红棕 + 梧桐绿 + 鎏金。巴黎自己的固有色',
    m:{ stone:0xe9dcc0, stone2:0xc0b096, stoneNew:0xf3e9d2, lead:0x97a2a6, leadNew:0xbcc6cb,
        oak:0x8a5b3c, gold:0xc9a227, dark:0x2b2a26, floor:0xb9ac93, ground:0xbdb3a2 },
    tint:{ stone:[214,202,178], stone2:[176,164,143], lead:0x8a9196, leadNew:0xacb4b9 },
    trim:0xc9a227, accent:0x7a4a3a,
    glass:[[40,70,132],[38,96,118],[168,132,58],[122,58,48],[70,52,104]],
    tex:{ wall:'ashlar', roof:'zinc' }, light:'curated'
  },
  /* 方向 B：Hy4 式数字卷宗，宣纸摄影棚 */
  'xuanzhi':{
    label:'宣纸卷宗',
    note:'宣纸米白打底，石色压到极低饱和，只留朱红与鎏金两点重色。藏品范式',
    m:{ stone:0xeee6d6, stone2:0xcfc4b0, stoneNew:0xf8f2e6, lead:0xa9b0b4, leadNew:0xcbd2d6,
        oak:0x9a6a44, gold:0xcfa63a, dark:0x33302b, floor:0xd8cebb, ground:0xefe9dc },
    tint:{ stone:[226,217,199], stone2:[196,186,168], lead:0x99a2a8, leadNew:0xb8c1c7 },
    trim:0xcfa63a, accent:0xa8332a,
    glass:[[46,78,140],[52,104,126],[176,140,62],[150,46,38],[76,58,112]],
    tex:{ wall:'ashlar', roof:'slate' }, light:'studio'
  },
  /* 方向 C：新艺术插画（爱丽丝那条路线）——最大胆的一档 */
  'nouveau':{
    label:'新艺术插画',
    note:'奶油白/青瓷绿/鼠尾草/珊瑚粉/靛蓝/金，六色封顶，平涂固有色。离写实最远',
    m:{ stone:0xf0e4cc, stone2:0xc7bfa4, stoneNew:0xfaf1dd, lead:0x7fa89b, leadNew:0xa8c6b8,
        oak:0xa8714a, gold:0xd9b04a, dark:0x2f3550, floor:0xd6c9ac, ground:0xdcd3bc },
    tint:{ stone:[228,214,188], stone2:[190,180,155], lead:0x6f9a8c, leadNew:0x93b6a8 },
    trim:0xd9b04a, accent:0xe08a72,
    glass:[[58,84,150],[64,124,120],[188,150,70],[214,120,100],[86,68,124]],
    tex:{ wall:'ashlar', roof:'tiles' }, light:'curated'
  }
};
/* 建筑包声明的板与内置板合并：{base:'haussmann', m:{stone:0x...}} 只覆盖列出的角色 */
function resolvePalette(p){
  const base=PALETTES[(p&&p.base)||'baseline']||PALETTES.baseline;
  const out={ label:base.label, note:base.note, trim:base.trim, accent:base.accent,
    m:Object.assign({},base.m), tint:Object.assign({},base.tint),
    mat:Object.assign({},base.mat), glass:(p&&p.glass)||base.glass,
    tex:Object.assign({},base.tex), light:base.light };
  if(p){
    if(p.m) Object.assign(out.m,p.m);
    if(p.tint) Object.assign(out.tint,p.tint);
    if(p.mat) for(const k in p.mat) out.mat[k]=Object.assign({},out.mat[k],p.mat[k]);
    if(p.tex) Object.assign(out.tex,p.tex);
    if(p.trim!=null) out.trim=p.trim;
    if(p.accent!=null) out.accent=p.accent;
    if(p.light) out.light=p.light;
    if(p.label) out.label=p.label;
  }
  return out;
}

/* ── 3c-2. 贴图 / 材质套件（单一来源）────────────────────────────────
   由调色板驱动，一次产出 {T 原始canvas, TX 已转THREE的贴图, M 材质, rep 工具}。
   贴图路线由 PAL.tex 决定：wall noise=噪声级（中景是材质、近景没内容）
   ／ashlar=图案级（有灰缝和砌块，近景是构造）；屋面同理 lead/zinc/slate/tiles。

   ⚠️ 这里是**唯一**的构造处。viewer 走单建筑、paris.html 走六座地标各一套，
   两边都调它。曾经 paris.html 自己抄了一份，引擎升级到砌块贴图后那份没跟上，
   于是城市地图里的地标一直是旧的灰噪声石头——重复就是这么变成 bug 的。 */
const hexRGB=h=>Array.isArray(h)?h:[(h>>16)&255,(h>>8)&255,h&255];
P3D.makeKit = function(PAL, opt){
  opt = opt || {};
  const TN = PAL.tint, T = {};
  if(PAL.tex.wall==='ashlar'){
    T.stone  = makeAshlar(512,{seed:1201,tint:TN.stone, courses:6,per:3,joint:0.055,vary:0.075,grit:0.85});
    T.stone2 = makeAshlar(512,{seed:4407,tint:TN.stone2,courses:5,per:2,joint:0.075,vary:0.105,grit:1.25,depth:1.2});
  }else{
    T.stone  = makeStone(512,1201,TN.stone,1.00,1.0);
    T.stone2 = makeStone(512,4407,TN.stone2,1.25,1.4);
  }
  if(PAL.tex.roof==='zinc'){
    T.lead   = makeZinc(512,{seed:771,tint:hexRGB(TN.lead),   seams:7,patina:0.60});
    T.leadNew= makeZinc(512,{seed:772,tint:hexRGB(TN.leadNew),seams:7,patina:0.16});
  }else if(PAL.tex.roof==='slate'||PAL.tex.roof==='tiles'){
    const st=PAL.tex.roof==='slate'?'slate':'flat';
    T.lead   = makeTiles(512,{seed:771,tint:hexRGB(TN.lead),   style:st,rows:12,cols:9,vary:0.12});
    T.leadNew= makeTiles(512,{seed:772,tint:hexRGB(TN.leadNew),style:st,rows:12,cols:9,vary:0.07});
  }else{
    T.lead   = makeLead(512,771,TN.lead,7,0.0);
    T.leadNew= makeLead(512,772,TN.leadNew,7,0.55);
  }
  T.oak    = makeOak(256,331);
  T.pave   = makePavement(512,909);
  T.glassWin = makeWindowGlass(256,55,PAL.glass);

  /* Canvas → Texture；颜色贴图走 sRGB，法线/粗糙度贴图保持线性 */
  const rep=(c,srgb,rx,ry)=>{
    const t=new THREE.CanvasTexture(c);
    t.wrapS=t.wrapT=THREE.RepeatWrapping; t.anisotropy=8;
    if(rx) t.repeat.set(rx, ry===undefined?rx:ry);
    if(srgb && THREE.sRGBEncoding) t.encoding=THREE.sRGBEncoding;
    return t;
  };
  const std=o=>new THREE.MeshStandardMaterial(o);
  const TX={
    sC:rep(T.stone.color,true), sN:rep(T.stone.normal,false), sR:rep(T.stone.rough,false),
    dC:rep(T.stone2.color,true), dN:rep(T.stone2.normal,false), dR:rep(T.stone2.rough,false),
    lC:rep(T.lead.color,true),   lN:rep(T.lead.normal,false),
    lR:T.lead.rough?rep(T.lead.rough,false):null,
    nC:rep(T.leadNew.color,true),nN:rep(T.leadNew.normal,false),
    nR:T.leadNew.rough?rep(T.leadNew.rough,false):null,
    oC:rep(T.oak,true), gC:rep(T.pave,true,opt.groundRepeat||60)
  };
  const C=PAL.m, M={};   /* 调色板角色色：全部材质固有色只从这里取 */
  M.stone=std({map:TX.sC,normalMap:TX.sN,roughnessMap:TX.sR,
    color:C.stone,roughness:1,metalness:0,side:THREE.DoubleSide,envMapIntensity:1.0});
  M.stone.normalScale=new THREE.Vector2(0.85,0.85);
  M.stone2=std({map:TX.dC,normalMap:TX.dN,roughnessMap:TX.dR,
    color:C.stone2,roughness:1,metalness:0,side:THREE.DoubleSide,envMapIntensity:0.95});
  M.stone2.normalScale=new THREE.Vector2(1,1);
  M.stoneNew=std({map:TX.sC,normalMap:TX.sN,roughnessMap:TX.sR,
    color:C.stoneNew,roughness:0.94,metalness:0,side:THREE.DoubleSide,envMapIntensity:1.05});
  M.stoneNew.normalScale=new THREE.Vector2(0.6,0.6);
  M.lead=std({map:TX.lC,normalMap:TX.lN,roughnessMap:TX.lR||undefined,
    color:C.lead,roughness:TX.lR?1:0.56,metalness:0.62,side:THREE.DoubleSide,envMapIntensity:1.15});
  M.lead.normalScale=new THREE.Vector2(0.7,0.7);
  M.leadNew=std({map:TX.nC,normalMap:TX.nN,roughnessMap:TX.nR||undefined,
    color:C.leadNew,roughness:TX.nR?1:0.28,metalness:0.80,side:THREE.DoubleSide,envMapIntensity:1.5});
  M.leadNew.normalScale=new THREE.Vector2(0.5,0.5);
  M.oak=std({map:TX.oC,color:C.oak,roughness:0.78,metalness:0.02,side:THREE.DoubleSide});
  M.gold=std({color:C.gold,roughness:0.28,metalness:0.95,emissive:0x3a2607,emissiveIntensity:0.6,side:THREE.DoubleSide});
  M.dark=std({color:C.dark,roughness:1,metalness:0,side:THREE.DoubleSide});
  M.floor=std({map:TX.sC,normalMap:TX.sN,
    color:C.floor,roughness:0.92,metalness:0,side:THREE.DoubleSide});
  M.floor.normalScale=new THREE.Vector2(0.7,0.7);
  M.ground=std({map:TX.gC,color:C.ground,roughness:0.96,metalness:0,side:THREE.DoubleSide});
  /* 调色板可覆盖标准材质的参数，不只是颜色。
     典型场景：铅皮屋面。氧化后的铅是哑光的，可 metalness 一高就去反射蓝天，
     屋顶于是变成一片假的饱和蓝——固有色明明是暖浅灰。颜色改不动这个，
     要改的是 metalness/roughness/envMapIntensity 这一组 */
  if(PAL.mat) for(const k in PAL.mat){ if(M[k]) Object.assign(M[k], PAL.mat[k]); }
  return {T, TX, M, rep};
};
P3D.resolvePalette = resolvePalette;
P3D.PALETTES = PALETTES;

/* ── 3d. 光照模式（L2）────────────────────────────────────────────
   核心认知：写实光照模型和多彩固有色是冲突的。强太阳直射 + 深投影 +
   ACES 压制，任何固有色进阴影区就发灰发黑。柔光模式把主光让给半球光，
   太阳降为造型光——颜色不被阴影压脏，饱和度才存活。*/
const LIGHT_MODES = {
  daylight:{ label:'写实日光', note:'正午户外：强太阳直射 + 深投影。体量感最强，颜色最容易脏',
    exposure:1.06, sunMul:1.00, sunCap:4.6, hemi:0.62, hemiSky:0xbcd2f0, hemiGround:0x50483c,
    fill:0.00, ao:0.65, weather:0.55, env:1.00, shadowOpacity:1.00, sky:'real' },
  curated:{ label:'策展柔光', note:'半球光主导、太阳退为造型光、投影变浅。固有色存活 = 多彩的前提',
    exposure:1.02, sunMul:0.30, sunCap:1.45, hemi:2.55, hemiSky:0xf4ecdc, hemiGround:0xbfae94,
    fill:0.55, ao:0.82, weather:0.18, env:1.25, shadowOpacity:0.55, sky:'real' },
  studio:{ label:'纸面摄影棚', note:'不做天空不做地形：藏品悬浮纸面 + 软影。预算全花在单体上',
    exposure:1.00, sunMul:0.16, sunCap:0.85, hemi:3.10, hemiSky:0xfffaf0, hemiGround:0xe4dac6,
    fill:0.80, ao:0.88, weather:0.06, env:1.42, shadowOpacity:0.34, sky:'paper',
    paper:0xf1ebdd, groundFlat:true }
};

P3D.PALETTES = PALETTES;
P3D.LIGHT_MODES = LIGHT_MODES;

P3D.helpers = { clamp,lerp,TAU,arch,archT,ARCH_N,ARCH_M,mulberry32,makeNoise,fbmFactory,V3,
  makeStone,makeLead,makeOak,makeWindowGlass,makeRoseTexture,makePavement,makeSky,
  GB,RIB_PROF,frameV,frameW,archPts,cylBand,buildRose,cv,
  /* L3 图案级贴图库 */
  makeAshlar,makeZinc,makeTiles,makeFrieze,makeIronwork,makeStudio,normalsFrom,grayFrom,
  /* L4 勾边与收边构件 */
  trimPath,trimRect,cornice,trimBox,
  /* L1/L2 艺术指导 */
  PALETTES,LIGHT_MODES,resolvePalette };

/* ── Phase 0：体素AO烘焙 ─────────────────────────────────────────
   把全部不透光几何体素化成 0.9m 占用网格，再对每个顶点沿法线半球
   撒 18 条余弦加权射线步进采样，近处遮挡权重高。结果写入 ao attribute，
   由 enhance() 注入的 shader 按 uAO 强度调制。一次烘焙，运行时零开销 */
P3D.bakeAO = async function(GBS, step, raf, opts){
  opts=opts||{};

  const OCC=Object.keys(GBS).filter(k=>!GBS[k].glass);
  const TGT=OCC.filter(k=>k!=='dark');
  let bx0=1e9,by0=1e9,bz0=1e9,bx1=-1e9,by1=-1e9,bz1=-1e9;
  for(const k of OCC){ const b=GBS[k]; if(!b) continue; const P=b.P;
    for(let i=0;i<P.length;i+=3){
      const x=P[i],y=P[i+1],z=P[i+2];
      if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)) continue;
      if(x<bx0)bx0=x; if(x>bx1)bx1=x; if(y<by0)by0=y;
      if(y>by1)by1=y; if(z<bz0)bz0=z; if(z>bz1)bz1=z;
    } }
  P3D._lastSpan=Math.max(bx1-bx0,by1-by0,bz1-bz0);
  const VS=Math.max(0.9, P3D._lastSpan/200);
  bx0-=VS*2; by0-=VS*2; bz0-=VS*2; bx1+=VS*2; by1+=VS*2; bz1+=VS*2;
  const NXv=Math.min(240,Math.ceil((bx1-bx0)/VS)), NYv=Math.min(160,Math.ceil((by1-by0)/VS)),
        NZv=Math.min(160,Math.ceil((bz1-bz0)/VS));
  const grid=new Uint8Array(NXv*NYv*NZv);
  const mark=(x,y,z)=>{
    const ix=(x-bx0)/VS|0, iy=(y-by0)/VS|0, iz=(z-bz0)/VS|0;
    if(ix<0||iy<0||iz<0||ix>=NXv||iy>=NYv||iz>=NZv) return;
    grid[(iz*NYv+iy)*NXv+ix]=1;
  };
  const rnd=mulberry32(4242);
  for(const k of OCC){ const b=GBS[k]; if(!b) continue; const P=b.P, I=b.I;
    for(let t=0;t<I.length;t+=3){
      const a=I[t]*3,bb=I[t+1]*3,c=I[t+2]*3;
      const ax=P[a],ay=P[a+1],az=P[a+2], bx=P[bb],by=P[bb+1],bz=P[bb+2], cx=P[c],cy=P[c+1],cz=P[c+2];
      if(!Number.isFinite(ax+ay+az+bx+by+bz+cx+cy+cz)) continue;
      const ux=bx-ax,uy=by-ay,uz=bz-az, vx=cx-ax,vy=cy-ay,vz=cz-az;
      const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
      const area=Math.hypot(nx,ny,nz)*0.5;
      mark(ax,ay,az); mark(bx,by,bz); mark(cx,cy,cz);
      mark((ax+bx+cx)/3,(ay+by+cy)/3,(az+bz+cz)/3);
      const ns=Math.min(300,Math.ceil(area/(VS*VS*0.30)));
      for(let s=0;s<ns;s++){
        const r1=Math.sqrt(rnd()), r2=rnd(), w0=1-r1, w1=r1*(1-r2), w2=r1*r2;
        mark(ax*w0+bx*w1+cx*w2, ay*w0+by*w1+cy*w2, az*w0+bz*w1+cz*w2);
      }
    } }
  /* 余弦加权半球方向组（局部 z 朝法线） */
  const NDIR=opts.ndir||18, DIRS=[];
  for(let i=0;i<NDIR;i++){
    const zc=Math.sqrt((i+0.5)/NDIR), r=Math.sqrt(Math.max(0,1-zc*zc)), a=i*2.39996323;
    DIRS.push([Math.cos(a)*r, Math.sin(a)*r, zc]);
  }
  const MAXD=16, STEP=0.7, NSTEP=Math.ceil(MAXD/STEP);
  const cache=new Map();
  let total=0; for(const k of TGT){ const b=GBS[k]; if(b) total+=b.P.length/3; }
  let done=0, sinceYield=0;
  for(const k of TGT){
    const b=GBS[k]; if(!b) continue;
    const P=b.P, I=b.I, nv=P.length/3;
    /* 面积加权顶点法线（与 computeVertexNormals 同法，AO 用） */
    const N=new Float32Array(nv*3);
    for(let t=0;t<I.length;t+=3){
      const a=I[t]*3,bb=I[t+1]*3,c=I[t+2]*3;
      const ux=P[bb]-P[a],uy=P[bb+1]-P[a+1],uz=P[bb+2]-P[a+2];
      const vx=P[c]-P[a],vy=P[c+1]-P[a+1],vz=P[c+2]-P[a+2];
      const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
      if(!Number.isFinite(nx+ny+nz)) continue;
      N[a]+=nx;N[a+1]+=ny;N[a+2]+=nz; N[bb]+=nx;N[bb+1]+=ny;N[bb+2]+=nz; N[c]+=nx;N[c+1]+=ny;N[c+2]+=nz;
    }
    const AO=new Float32Array(nv).fill(1);
    for(let vi=0;vi<nv;vi++){
      const px=P[vi*3],py=P[vi*3+1],pz=P[vi*3+2];
      let nx=N[vi*3],ny=N[vi*3+1],nz=N[vi*3+2];
      const nl=Math.hypot(nx,ny,nz);
      if(!Number.isFinite(px+py+pz)||nl<1e-9){ done++; continue; }
      nx/=nl; ny/=nl; nz/=nl;
      const key=((px*4|0)+2048)+','+((py*4|0)+2048)+','+((pz*4|0)+2048)+','+(nx*3|0)+','+(ny*3|0)+','+(nz*3|0);
      let ao=cache.get(key);
      if(ao===undefined){
        /* 法线正交基 */
        let tx,ty,tz;
        if(Math.abs(ny)<0.9){ tx=nz; ty=0; tz=-nx; } else { tx=1; ty=0; tz=0; }
        let tl=Math.hypot(tx,ty,tz); tx/=tl; ty/=tl; tz/=tl;
        const sx=ny*tz-nz*ty, sy=nz*tx-nx*tz, sz=nx*ty-ny*tx;
        const ox=px+nx*0.8, oy=py+ny*0.8, oz=pz+nz*0.8;
        let occ=0;
        for(let di=0;di<NDIR;di++){
          const D=DIRS[di];
          const dx=tx*D[0]+sx*D[1]+nx*D[2], dy=ty*D[0]+sy*D[1]+ny*D[2], dz=tz*D[0]+sz*D[1]+nz*D[2];
          for(let st2=1;st2<=NSTEP;st2++){
            const t=st2*STEP;
            const x=ox+dx*t, y=oy+dy*t, z=oz+dz*t;
            if(y<0){ occ+=1-t/MAXD; break; }   /* 地面视作遮挡体 */
            const ix=(x-bx0)/VS|0, iy=(y-by0)/VS|0, iz=(z-bz0)/VS|0;
            if(ix<0||iz<0||ix>=NXv||iz>=NZv||iy>=NYv) break;   /* 出界=开阔天空 */
            if(iy>=0&&grid[(iz*NYv+iy)*NXv+ix]){ occ+=1-t/MAXD; break; }
          }
        }
        ao=0.35+0.65*Math.pow(clamp(1-occ/NDIR,0,1),1.15);
        cache.set(key,ao);
      }
      AO[vi]=ao;
      done++; sinceYield++;
      if(sinceYield>=12000){
        sinceYield=0;
        step(88+Math.round(done/total*8),'烘焙环境光遮蔽（体素AO）'+Math.round(done/total*100)+'%');
        await raf();
      }
    }
    b.AO=AO;
  }
};

/* ── 4. 单建筑查看器 ────────────────────────────────────────────── */
P3D.runViewer = async function(def){

if (typeof THREE === 'undefined'){
  document.getElementById('err').style.display='flex';
  document.getElementById('load').style.display='none';
  return;
}
const meta=def.meta||{};
{ const put=(id,v)=>{ const el=document.getElementById(id); if(el&&v!=null) el.textContent=v; };
  put('top-t1',meta.title); put('top-t2',meta.sub); put('top-badge',meta.badge);
  put('load-lg',meta.load||meta.title); if(meta.loadSub) put('load-sub',meta.loadSub);
  document.title=(meta.title||'')+' · 数字卷宗'; }

/* ── 艺术指导：调色板 + 光照模式（L1/L2）──────────────────────────
   优先级：URL 查询参数 > 建筑包声明 > 内置默认。查询参数是为 A/B 出图准备的：
   ?pal=baseline|haussmann|xuanzhi|nouveau   ?light=daylight|curated|studio
   调色板换贴图底色，必须重新烘焙 → 走 URL 重载；光照模式可运行时切换 */
const QS=new URLSearchParams(location.search);
/* ?pal= 存在时**整包接管**，不与建筑包的偏移合并——这个参数是为 A/B 出图准备的，
   `?pal=baseline` 必须是干净的升级前，混进建筑包的实物色偏移就不是对照组了 */
const PAL=resolvePalette(QS.get('pal')?{base:QS.get('pal')}:def.palette);
let MODE_NAME=QS.get('light')||def.light||PAL.light||'daylight';
if(!LIGHT_MODES[MODE_NAME]) MODE_NAME='daylight';
let MODE=LIGHT_MODES[MODE_NAME];
/* hexRGB 已提到模块作用域（makeKit 要用），这里不再重复定义 */

const canvasEl=document.getElementById('gl');
let renderer;
try{ renderer=new THREE.WebGLRenderer({canvas:canvasEl,antialias:true,powerPreference:'high-performance',stencil:false}); }
catch(e){ document.getElementById('err').style.display='flex'; document.getElementById('load').style.display='none'; return; }
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.75));
renderer.setSize(window.innerWidth,window.innerHeight,false);
renderer.outputEncoding=THREE.sRGBEncoding;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=MODE.exposure;
if('useLegacyLights' in renderer) renderer.useLegacyLights=false;
else renderer.physicallyCorrectLights=true;
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;

const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(42, window.innerWidth/window.innerHeight, 0.45, 2600);
/* ── 太阳时间系统（Phase 0）─────────────────────────────────────
   夏季巴黎太阳弧线简化：6h 东北偏东升起 → 13h 过南 → 20h 西北偏西落下
   场景轴：X 东西（西为负）、Z 南北（北为正） */
/* 默认取夏季清晨 7:30——太阳在东北偏东、仰角约20°，
   低角度暖光正好照亮默认机位所在的北面与东端，且投出长影 */
const SUN={ hour:7.5, dir:[0.856,0.351,0.379] };
function sunDirFromHour(h){
  const t=clamp((h-6)/14,0,1);
  const phi=(-55+290*t)*Math.PI/180;
  const el=Math.max(2.5*Math.PI/180, 62*Math.PI/180*Math.sin(Math.PI*t));
  return [Math.cos(el)*Math.cos(phi), Math.sin(el), -Math.cos(el)*Math.sin(phi)];
}
SUN.dir=sunDirFromHour(SUN.hour);
const SUN_DIR=SUN.dir;   // 兼容旧引用（数组引用共享，原地更新）
/* 全局可调 uniform（多材质共享同一 value 对象） */
const U_AO={value:MODE.ao}, U_WEATHER={value:MODE.weather};
const APP={sun:null, hemi:null, fill:null, envRT:null};

const T={}, M={}, GBS={}, TXR={};   /* TXR: 已转 THREE 的贴图，供运行时切换模式回读 */
const NAN_FIXES=[];
const gb=name=>{const b=new GB(); b.mat={name:name}; GBS[name]=b; return b;};
const SOLIDS=[];
const solid=(x0,y0,z0,x1,y1,z1)=>SOLIDS.push([Math.min(x0,x1),Math.min(y0,y1),Math.min(z0,z1),
                                              Math.max(x0,x1),Math.max(y0,y1),Math.max(z0,z1)]);


SUN.hour = def.sunHour!=null ? def.sunHour : 7.5;
SUN.dir  = sunDirFromHour ? SUN.dir : SUN.dir; /* 占位，函数在下方定义后再刷新 */

const ROSE_SPOTS=[];
const SHAFTS=[]; let SHAFT_OP=0.155;

const L={bar:document.getElementById('lbar'), msg:document.getElementById('lmsg')};
const step=(p,m)=>{ L.bar.style.width=p+'%'; L.msg.textContent=m; };
const raf=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));

function bakeSky(){
  /* 纸面摄影棚模式下「天空」是一张软箱灯背景板，走同一条 equirect+PMREM 通路，
     背景与环境光一次到位，不引入第二套颜色空间处理 */
  T.sky = MODE.sky==='paper'
    ? makeStudio(1024,512,{paper:hexRGB(MODE.paper), keyAz:0.5+Math.atan2(SUN.dir[2],SUN.dir[0])/TAU})
    : makeSky(1024,512,SUN.dir);
  const old=T.skyTex, oldRT=APP.envRT;
  T.skyTex=new THREE.CanvasTexture(T.sky);
  T.skyTex.mapping=THREE.EquirectangularReflectionMapping;
  if(THREE.sRGBEncoding) T.skyTex.encoding=THREE.sRGBEncoding;
  scene.background=T.skyTex;
  const pm=new THREE.PMREMGenerator(renderer); pm.compileEquirectangularShader();
  APP.envRT=pm.fromEquirectangular(T.skyTex);
  scene.environment=APP.envRT.texture; pm.dispose();
  if(oldRT) oldRT.dispose();
  if(old) old.dispose();
}
function updateSunLight(){
  if(!APP.sun) return;
  const d=SUN.dir, sinEl=Math.max(0,d[1]);
  const SDIST=Math.max(220,(P3D._lastSpan||0)*1.6);
  APP.sun.position.set(d[0]*SDIST,d[1]*SDIST,d[2]*SDIST);
  APP.sun.intensity=Math.min(MODE.sunCap, 5.0*MODE.sunMul*Math.pow(clamp(sinEl,0.02,1),0.35));
  const warm=clamp(sinEl/0.55,0,1);
  APP.sun.color.setRGB(1.0, lerp(0.80,0.95,warm), lerp(0.58,0.87,warm));
  if(APP.hemi) APP.hemi.intensity=MODE.hemi*clamp(0.35+0.65*sinEl/0.6,0.35,1);
  /* 补光：柔光模式下不投影的反向填充，防背光面死黑（体量感靠 AO 和勾边补回来） */
  if(APP.fill){ APP.fill.intensity=MODE.fill;
    APP.fill.position.set(-d[0]*SDIST*0.75, SDIST*0.5, -d[2]*SDIST*0.75); }
}
/* 运行时切换光照模式（不重建几何与贴图，只换光/曝光/uniform/背景） */
function applyLightMode(name){
  if(!LIGHT_MODES[name]) return;
  MODE_NAME=name; MODE=LIGHT_MODES[name];
  renderer.toneMappingExposure=MODE.exposure;
  U_AO.value=MODE.ao; U_WEATHER.value=MODE.weather;
  if(APP.hemi){ APP.hemi.color.setHex(MODE.hemiSky); APP.hemi.groundColor.setHex(MODE.hemiGround); }
  for(const k in M){ const m=M[k];
    if(m && m.userData && m.userData.env0!=null) m.envMapIntensity=m.userData.env0*MODE.env; }
  if(M.ground){ M.ground.map = MODE.groundFlat?null:(TXR.gC||null);
    M.ground.color.setHex(MODE.groundFlat?MODE.paper:PAL.m.ground);
    M.ground.needsUpdate=true; }
  bakeSky(); updateSunLight();
  const el=document.getElementById('v-light'); if(el) el.textContent=MODE.label;
}


SUN.dir = sunDirFromHour(SUN.hour);
{ const hv=document.getElementById('c-hour'); if(hv) hv.value=SUN.hour; }

/* ── 玻璃组注册 ── */
const GLASS_NAMES=new Set();
function glassMatRef(){ return glassMat; } /* 在 buildAll 内定义后回填 */
let addGlass;

async function buildAll(){

step(4,'生成'+(PAL.tex.wall==='ashlar'?'石砌块（图案级）':'石灰岩')+' / 屋面 / 橡木贴图'); await raf();
const KIT=P3D.makeKit(PAL);
Object.assign(T,KIT.T);
const rep=KIT.rep;

step(16,'生成天空并用 PMREM 烘焙环境光照（IBL）'); await raf();
bakeSky();

step(24,'调制 PBR 材质'); await raf();
Object.assign(TXR,KIT.TX);
Object.assign(M,KIT.M);
/* 记下每个材质自己的 envMapIntensity 基准值，光照模式再按倍率缩放它 */
const markEnv=m=>{ m.userData.env0=(m.envMapIntensity==null?1:m.envMapIntensity);
                   m.envMapIntensity=m.userData.env0*MODE.env; return m; };
for(const k in M) markEnv(M[k]);
/* 纸面摄影棚：地面退成一张纸，不要铺装纹理跟主体抢注意力 */
if(MODE.groundFlat){ M.ground.map=null; M.ground.color.setHex(MODE.paper); }
function glassMat(c,i){
  const t=new THREE.CanvasTexture(c);
  if(THREE.sRGBEncoding) t.encoding=THREE.sRGBEncoding;
  t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;
  return new THREE.MeshStandardMaterial({map:t,emissive:0xffffff,emissiveMap:t,emissiveIntensity:i,
    roughness:0.22,metalness:0,transparent:true,opacity:0.94,side:THREE.DoubleSide,depthWrite:false,envMapIntensity:1.4});
}

/* ── Phase 0：shader 注入——烘焙AO（顶点属性）+ 世界坐标风化分区 ──
   AO 存在几何的 ao attribute 里（构建时体素射线烘焙）；
   风化按世界坐标计算：破平铺的大尺度色调、竖直面雨痕、贴地溅泥、北面苔绿 */
function enhance(mat, weather){
  mat.onBeforeCompile=shader=>{
    shader.uniforms.uAO=U_AO;
    shader.uniforms.uWeather=U_WEATHER;
    shader.vertexShader=
      'attribute float ao;\nvarying float vAO;\nvarying vec3 vWPos;\nvarying vec3 vWNorm;\n'
      +shader.vertexShader.replace('#include <fog_vertex>',
      '#include <fog_vertex>\n vAO=ao;\n vWPos=transformed;\n vWNorm=normalize(objectNormal);');
    shader.fragmentShader=
      'varying float vAO;\nvarying vec3 vWPos;\nvarying vec3 vWNorm;\nuniform float uAO;\nuniform float uWeather;\n'
      +'float wHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n'
      +'float wNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);\n'
      +' return mix(mix(wHash(i),wHash(i+vec2(1,0)),f.x),mix(wHash(i+vec2(0,1)),wHash(i+vec2(1,1)),f.x),f.y);}\n'
      +shader.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\n'
      +' diffuseColor.rgb*=1.0-uAO*(1.0-vAO);\n'
      +(weather?
        ' {\n'
        +'  float vert=1.0-abs(vWNorm.y);\n'
        +'  float big=wNoise(vWPos.xz*0.045)*0.5+wNoise(vWPos.xy*0.045+7.3)*0.5;\n'
        +'  diffuseColor.rgb*=mix(1.0,0.86+big*0.28,uWeather);\n'
        +'  vec2 sc=abs(vWNorm.x)>abs(vWNorm.z)?vWPos.zy:vWPos.xy;\n'
        +'  float st=wNoise(vec2(sc.x*1.7,sc.y*0.07));\n'
        +'  float streak=smoothstep(0.58,0.95,st)*vert*smoothstep(2.0,8.0,vWPos.y);\n'
        +'  diffuseColor.rgb*=1.0-0.26*uWeather*streak;\n'
        +'  float spl=(1.0-smoothstep(0.4,3.6,vWPos.y))*vert;\n'
        +'  diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(0.64,0.61,0.55),spl*0.65*uWeather);\n'
        +'  float north=max(0.0,vWNorm.z)*(1.0-smoothstep(6.0,24.0,vWPos.y));\n'
        +'  float moss=north*smoothstep(0.45,0.8,wNoise(vWPos.xy*0.9+vWPos.zx*0.3));\n'
        +'  diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(0.60,0.74,0.47),moss*0.45*uWeather);\n'
        +' }\n':''));
  };
  mat.needsUpdate=true;
}
enhance(M.stone,true); enhance(M.stone2,true); enhance(M.stoneNew,true); enhance(M.floor,true);
enhance(M.lead,false); enhance(M.leadNew,false); enhance(M.oak,false); enhance(M.gold,false);

const G={};
for(const n of ['stone','stone2','stoneNew','lead','leadNew','oak','gold','dark','floor']) G[n]=gb(n);
addGlass=function(name,canvas,intensity){
  M[name]=markEnv(glassMat(canvas,intensity));
  const b=gb(name); b.glass=true; GLASS_NAMES.add(name); G[name]=b; return b;
};
addGlass('gwin', T.glassWin, 0.75);
/* 建筑包自定义 PBR 材质组（如铁塔的锻铁、卢浮宫的玻璃金字塔框架） */
const addMat=function(name,params,opts){
  const m=markEnv(std(params)); M[name]=m;
  enhance(m, !!(opts&&opts.weather));
  const b=gb(name); G[name]=b; return b;
};
/* 建筑包取色的唯一入口：ctx.pal('stone'|'trim'|'accent'|…)。散点写 hex 是纪律问题 */
const pal=function(role){ const v=PAL.m[role];
  return v!=null?v:(PAL[role]!=null?PAL[role]:0xcccccc); };
pal.color=role=>new THREE.Color(pal(role));
pal.shade=(role,k)=>{ const c=new THREE.Color(pal(role)); c.multiplyScalar(k); return c.getHex(); };
pal.data=PAL;

/* 标准地面（建筑包可用 def.ground:false 关闭） */
if(def.ground!==false){
  const g=new THREE.Mesh(new THREE.PlaneGeometry(1600,1600), M.ground);
  g.rotation.x=-Math.PI/2; g.position.y=-0.06; g.receiveShadow=true; scene.add(g);
}

const CTX={THREE,scene,renderer,T,M,G,addGlass,addMat,tex:rep,solid,step,raf,
  spots:ROSE_SPOTS,shafts:SHAFTS,helpers:P3D.helpers,
  pal:pal, light:()=>MODE_NAME, mode:MODE};

if(def.textures) def.textures(CTX);
await def.build(CTX);

step(88,'烘焙环境光遮蔽（体素AO）'); await raf();
await P3D.bakeAO(GBS, step, raf);

step(97,'合成网格 · 布光 · 生成彩色光斑'); await raf();
(function finalize(){
  for(const key in GBS){
    const b=GBS[key];
    if(b.I.length===0) continue;
    const g=b.build();
    if(b.AO) g.setAttribute('ao', new THREE.Float32BufferAttribute(b.AO,1));
    const mesh=new THREE.Mesh(g, M[key]);
    const isGlass = !!b.glass;
    mesh.castShadow = !isGlass && key!=='dark';
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  const sun=new THREE.DirectionalLight(0xfff2dd, 4.1);
  sun.position.set(SUN_DIR[0]*220, SUN_DIR[1]*220, SUN_DIR[2]*220);
  sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);
  const SR=Math.max(115,(P3D._lastSpan||0)*0.75);
  sun.shadow.camera.left=-SR; sun.shadow.camera.right=SR;
  sun.shadow.camera.top=SR;   sun.shadow.camera.bottom=-SR;
  sun.shadow.camera.near=40;  sun.shadow.camera.far=560+SR*2;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias=-0.0006; sun.shadow.normalBias=0.55;
  sun.target.position.set(0,24,0);
  scene.add(sun, sun.target);
  const hemi=new THREE.HemisphereLight(MODE.hemiSky, MODE.hemiGround, MODE.hemi);
  scene.add(hemi);
  /* 反向补光（不投影）：柔光模式的第二盏。日光模式 intensity=0，等于不存在 */
  const fill=new THREE.DirectionalLight(0xe2ecf6, MODE.fill);
  fill.castShadow=false; fill.target.position.set(0,24,0);
  scene.add(fill, fill.target);
  APP.sun=sun; APP.hemi=hemi; APP.fill=fill;
  updateSunLight();

})();

if(def.effects) def.effects({THREE,scene,spots:ROSE_SPOTS,shafts:SHAFTS,helpers:P3D.helpers});
}

/* ── 卷宗数据 / 相机 / 界面 / 循环 ── */
const DOSSIER=def.dossier;
const BY_ID={}; DOSSIER.forEach(d=>BY_ID[d.id]=d);
const CEIL=def.ceil||[];

const cam={ target:new THREE.Vector3(2,28,-1), radius:219, theta:0.80, phi:1.14,
  pos:new THREE.Vector3(), fov:42, minR:2.5, maxR:430, minPhi:0.08, maxPhi:2.90 };

function sphericalToPos(){
  const s=Math.sin(cam.phi), c=Math.cos(cam.phi);
  cam.pos.set(cam.target.x+cam.radius*s*Math.cos(cam.theta),
              cam.target.y+cam.radius*c,
              cam.target.z+cam.radius*s*Math.sin(cam.theta));
}
function clampCam(p){
  p.x=clamp(p.x,-340,360); p.z=clamp(p.z,-340,340); p.y=clamp(p.y,1.1,240);
  for(const c of CEIL){
    if(p.x>c.x0&&p.x<c.x1&&p.z>c.z0&&p.z<c.z1&&p.y>0&&p.y<c.roof){ if(p.y>c.y) p.y=c.y; break; }
  }
  if(def.clampCam) def.clampCam(p);
  for(let i=0;i<SOLIDS.length;i++){
    const s=SOLIDS[i];
    if(p.x<s[0]||p.x>s[3]||p.y<s[1]||p.y>s[4]||p.z<s[2]||p.z>s[5]) continue;
    const dx0=p.x-s[0], dx1=s[3]-p.x, dy0=p.y-s[1], dy1=s[4]-p.y, dz0=p.z-s[2], dz1=s[5]-p.z;
    const m=Math.min(dx0,dx1,dy0,dy1,dz0,dz1), e=0.35;
    if(m===dx0) p.x=s[0]-e; else if(m===dx1) p.x=s[3]+e;
    else if(m===dy0) p.y=s[1]-e; else if(m===dy1) p.y=s[4]+e;
    else if(m===dz0) p.z=s[2]-e; else p.z=s[5]+e;
  }
}
function applyCam(){
  sphericalToPos(); clampCam(cam.pos);
  const d=new THREE.Vector3().subVectors(cam.pos,cam.target);
  const r=Math.max(1,d.length());
  cam.radius=clamp(r,cam.minR,cam.maxR);
  cam.phi=clamp(Math.acos(clamp(d.y/r,-1,1)),cam.minPhi,cam.maxPhi);
  cam.theta=Math.atan2(d.z,d.x);
  camera.position.copy(cam.pos);
  camera.lookAt(cam.target);
  if(Math.abs(camera.fov-cam.fov)>0.01){ camera.fov=cam.fov; camera.updateProjectionMatrix(); }
}

let dragMode=0,lastX=0,lastY=0,autoSpin=false;
const PTRS=new Map(); let pinchD=0, velT=0, velP=0;   // Phase 0：双指捏合 + 旋转惯性
canvasEl.addEventListener('contextmenu',e=>e.preventDefault());
canvasEl.addEventListener('pointerdown',e=>{
  canvasEl.setPointerCapture(e.pointerId);
  PTRS.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(PTRS.size===2){
    const p=[...PTRS.values()];
    pinchD=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
    dragMode=3;
  } else {
    dragMode=(e.button===2||e.button===1||e.shiftKey)?2:1;
  }
  lastX=e.clientX; lastY=e.clientY; velT=0; velP=0;
  canvasEl.classList.add('dragging'); flight=null;
});
canvasEl.addEventListener('pointermove',e=>{
  if(!dragMode) return;
  const pt=PTRS.get(e.pointerId);
  if(pt){ pt.x=e.clientX; pt.y=e.clientY; }
  if(dragMode===3){
    if(PTRS.size<2) return;
    const p=[...PTRS.values()];
    const d=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
    if(pinchD>1&&d>1) cam.radius=clamp(cam.radius*pinchD/d,cam.minR,cam.maxR);
    pinchD=d; applyCam(); return;
  }
  const dx=e.clientX-lastX, dy=e.clientY-lastY; lastX=e.clientX; lastY=e.clientY;
  if(dragMode===1){
    cam.theta-=dx*0.0042; cam.phi-=dy*0.0042;
    cam.phi=clamp(cam.phi,cam.minPhi,cam.maxPhi);
    velT=-dx*0.0042; velP=-dy*0.0042;
  } else {
    const right=new THREE.Vector3().setFromMatrixColumn(camera.matrix,0);
    const up=new THREE.Vector3().setFromMatrixColumn(camera.matrix,1);
    const k=cam.radius*0.0016;
    cam.target.addScaledVector(right,-dx*k).addScaledVector(up,dy*k);
    cam.target.x=clamp(cam.target.x,-170,210);
    cam.target.z=clamp(cam.target.z,-170,170);
    cam.target.y=clamp(cam.target.y,0.5,130);
  }
  applyCam();
});
const endDrag=e=>{
  PTRS.delete(e.pointerId);
  if(PTRS.size===1){ dragMode=1; const p=[...PTRS.values()][0]; lastX=p.x; lastY=p.y; }
  else if(PTRS.size===0){ dragMode=0; canvasEl.classList.remove('dragging'); }
};
canvasEl.addEventListener('pointerup',endDrag);
canvasEl.addEventListener('pointercancel',endDrag);
canvasEl.addEventListener('wheel',e=>{
  e.preventDefault();
  cam.radius=clamp(cam.radius*Math.exp(clamp(e.deltaY,-220,220)*0.00135),cam.minR,cam.maxR);
  applyCam();
},{passive:false});

let flight=null;
function flyTo(d,instant){
  const p=V3(d.cam.pos[0],d.cam.pos[1],d.cam.pos[2]);
  const t=V3(d.cam.tgt[0],d.cam.tgt[1],d.cam.tgt[2]);
  if(instant){
    cam.target.copy(t); cam.pos.copy(p);
    const dd=new THREE.Vector3().subVectors(p,t);
    cam.radius=dd.length();
    cam.phi=clamp(Math.acos(clamp(dd.y/cam.radius,-1,1)),cam.minPhi,cam.maxPhi);
    cam.theta=Math.atan2(dd.z,dd.x);
    cam.fov=d.cam.fov; applyCam(); return;
  }
  flight={p0:camera.position.clone(),t0:cam.target.clone(),f0:camera.fov,p1:p,t1:t,f1:d.cam.fov,k:0,dur:1.75};
}

const listEl=document.getElementById('list');
DOSSIER.forEach((d,i)=>{
  const n=document.createElement('div');
  n.className='item'+(i===0?' on':'');
  n.dataset.id=d.id;
  n.innerHTML='<div class="num">'+d.num+'</div><div><div class="nm">'+d.name+'</div><div class="sb">'+d.sub+'</div></div>';
  n.addEventListener('click',()=>select(d.id));
  listEl.appendChild(n);
});
const items=Array.from(listEl.children);
const infoEl=document.getElementById('info');

function select(id){
  const d=BY_ID[id]; if(!d) return;
  items.forEach((n,i)=>n.classList.toggle('on', DOSSIER[i].id===id));
  document.getElementById('i-tag').textContent=d.num+' · '+d.sub;
  document.getElementById('i-name').textContent=d.name;
  document.getElementById('i-fr').textContent=d.fr;
  document.getElementById('i-era').textContent=d.era;
  document.getElementById('i-dim').textContent=d.dim;
  document.getElementById('i-desc').innerHTML=d.desc;
  const nt=document.getElementById('i-note');
  if(d.note){nt.style.display='';nt.innerHTML=d.note;} else nt.style.display='none';
  infoEl.classList.add('show');
  const tc=document.getElementById('top-cur');
  if(tc) tc.textContent=d.num+' · '+d.name+' · '+d.sub;
  flyTo(d);
}

let shadowOn=true, shaftOn=true, volOn=true, labelOn=true;
const LABELS=[];
const btn=id=>document.getElementById(id);
btn('btn-home').addEventListener('click',()=>select(DOSSIER[0].id));
btn('btn-shadow').addEventListener('click',function(){
  shadowOn=!shadowOn; this.classList.toggle('on',shadowOn);
  renderer.shadowMap.enabled=shadowOn;
  scene.traverse(o=>{ if(o.isMesh&&o.material) o.material.needsUpdate=true; });
});
btn('btn-shaft').addEventListener('click',function(){
  shaftOn=!shaftOn; this.classList.toggle('on',shaftOn);
  ROSE_SPOTS.forEach(s=>s.intensity = shaftOn ? (s.userData.base||0) : 0);
});
btn('btn-vol').addEventListener('click',function(){
  volOn=!volOn; this.classList.toggle('on',volOn);
  SHAFTS.forEach(s=>s.visible=volOn);
});
btn('btn-spin').addEventListener('click',function(){
  autoSpin=!autoSpin; this.classList.toggle('on',autoSpin);
});
btn('btn-label').addEventListener('click',function(){
  labelOn=!labelOn; this.classList.toggle('on',labelOn);
  LABELS.forEach(l=>l.visible=labelOn);
});
window.addEventListener('keydown',e=>{
  if(e.key>='0'&&e.key<='9'){ const ki=parseInt(e.key,10); if(ki<DOSSIER.length) select(DOSSIER[ki].id); }
  if(e.key===' '){ e.preventDefault(); autoSpin=!autoSpin; btn('btn-spin').classList.toggle('on',autoSpin); }
});

/* ── Phase 0 参数面板 ─────────────────────────────────────────── */
const fmtH=h=>{const hh=Math.floor(h),mm=Math.round((h-hh)*60);return hh+':'+String(mm).padStart(2,'0');};
btn('btn-tune').addEventListener('click',function(){ this.classList.toggle('on'); document.getElementById('tune').classList.toggle('show'); });
let skyTimer=null;
btn('c-hour').addEventListener('input',function(){
  SUN.hour=parseFloat(this.value);
  const d=sunDirFromHour(SUN.hour);
  SUN.dir[0]=d[0]; SUN.dir[1]=d[1]; SUN.dir[2]=d[2];
  btn('v-hour').textContent=fmtH(SUN.hour);
  updateSunLight();                       /* 灯光即时跟随 */
  btn('ctrl-busy').textContent='烘焙天空与环境光…';
  clearTimeout(skyTimer);                 /* 天空+IBL 停止拖动后重烘 */
  skyTimer=setTimeout(()=>{ bakeSky(); btn('ctrl-busy').textContent=''; },420);
});
btn('c-weather').addEventListener('input',function(){
  U_WEATHER.value=parseFloat(this.value);
  btn('v-weather').textContent=Math.round(U_WEATHER.value*100)+'%';
});
btn('c-ao').addEventListener('input',function(){
  U_AO.value=parseFloat(this.value);
  btn('v-ao').textContent=Math.round(U_AO.value*100)+'%';
});
btn('c-exp').addEventListener('input',function(){
  renderer.toneMappingExposure=parseFloat(this.value);
  btn('v-exp').textContent=(+this.value).toFixed(2);
});
btn('v-hour').textContent=fmtH(SUN.hour);

/* ── 艺术指导控件（L1/L2）────────────────────────────────────────
   光照模式运行时可切；调色板要重新烘焙贴图，走 URL 重载 */
function syncTuneUI(){
  const set=(id,v,fmt)=>{ const e=btn(id); if(e){ e.value=v; const o=btn(id.replace('c-','v-'));
    if(o) o.textContent=fmt(v); } };
  set('c-weather',U_WEATHER.value,v=>Math.round(v*100)+'%');
  set('c-ao',U_AO.value,v=>Math.round(v*100)+'%');
  set('c-exp',renderer.toneMappingExposure,v=>(+v).toFixed(2));
  const lp=btn('v-light'); if(lp) lp.textContent=MODE.label;
  const pp=btn('v-pal');   if(pp) pp.textContent=PAL.label;
}
{ const b=btn('btn-light');
  if(b) b.addEventListener('click',function(){
    const ks=Object.keys(LIGHT_MODES);
    applyLightMode(ks[(ks.indexOf(MODE_NAME)+1)%ks.length]);
    this.classList.toggle('on', MODE_NAME!=='daylight');
    syncTuneUI();
  }); }
{ const b=btn('btn-pal');
  if(b) b.addEventListener('click',function(){
    const ks=Object.keys(PALETTES), cur=ks.indexOf(QS.get('pal')||(def.palette&&def.palette.base)||'baseline');
    const q=new URLSearchParams(location.search);
    q.set('pal', ks[(cur+1)%ks.length]); q.delete('light');   /* 让新板带回它自己的建议光照 */
    location.search=q.toString();
  }); }
syncTuneUI();

/* 调试句柄（截图自校验用） */
window.__P0={SUN,U_AO,U_WEATHER,sunDirFromHour,bakeSky,updateSunLight,renderer,camera,cam,
  PAL,LIGHT_MODES,PALETTES,applyLightMode,mode:()=>MODE_NAME,syncTuneUI};
btn('btn-cam').addEventListener('click',function(){
  const j=JSON.stringify({pos:[+camera.position.x.toFixed(1),+camera.position.y.toFixed(1),+camera.position.z.toFixed(1)],
    tgt:[+cam.target.x.toFixed(1),+cam.target.y.toFixed(1),+cam.target.z.toFixed(1)], fov:Math.round(camera.fov)});
  console.log('[机位]',j);
  try{ navigator.clipboard.writeText(j).catch(()=>{}); }catch(err){}
  const b=this, t0=b.textContent;
  b.textContent='已复制（控制台也有）';
  setTimeout(()=>b.textContent=t0,1500);
});

/* 空间标注：Canvas 文字 → Sprite（不加载任何字体文件） */
function makeLabel(text,sub,accent){
  const w=1024,h=256,c=cv(w,h),g=c.getContext('2d');
  g.clearRect(0,0,w,h);
  const r=34;
  g.fillStyle='rgba(14,16,20,.86)';
  g.beginPath(); g.moveTo(r,0); g.arcTo(w,0,w,h,r); g.arcTo(w,h,0,h,r);
  g.arcTo(0,h,0,0,r); g.arcTo(0,0,w,0,r); g.closePath(); g.fill();
  g.strokeStyle=accent?'rgba(217,165,74,.75)':'rgba(255,255,255,.18)'; g.lineWidth=3; g.stroke();
  g.fillStyle=accent?'#d9a54a':'rgba(255,255,255,.35)'; g.fillRect(0,0,10,h);
  g.font='600 62px "Helvetica Neue",Helvetica,"PingFang SC","Microsoft YaHei",sans-serif';
  g.fillStyle='#f2ece0'; g.textBaseline='middle'; g.fillText(text,52,h*0.37);
  g.font='400 40px "Helvetica Neue",Helvetica,"PingFang SC","Microsoft YaHei",sans-serif';
  g.fillStyle='#a09a91'; g.fillText(sub,54,h*0.72);
  const t=new THREE.CanvasTexture(c);
  if(THREE.sRGBEncoding) t.encoding=THREE.sRGBEncoding;
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthTest:false,depthWrite:false}));
  s.renderOrder=20; return s;
}
function addLabel(pos,scale,text,sub,accent){
  const l=makeLabel(text,sub,accent);
  l.position.set(pos[0],pos[1],pos[2]);
  l.scale.set(scale[0],scale[1],1);
  scene.add(l); LABELS.push(l);
}

const fpsEl=document.getElementById('fps'), triEl=document.getElementById('tris'),
      callEl=document.getElementById('calls'), barEl=document.querySelector('#fpsbar i');
let frames=0,last=performance.now(),acc=0,lowStreak=0;
let curPR=Math.min(window.devicePixelRatio||1,1.75);

function onResize(){
  const w=window.innerWidth,h=window.innerHeight;
  camera.aspect=w/h; camera.updateProjectionMatrix();
  renderer.setPixelRatio(curPR);
  renderer.setSize(w,h,false);
}
window.addEventListener('resize',onResize);

function loop(){
  requestAnimationFrame(loop);
  const now=performance.now(), dt=Math.min(0.10,(now-last)/1000); last=now;

  if(autoSpin&&!flight){ cam.theta+=dt*0.045; }
  /* 旋转惯性 */
  if(!dragMode&&!flight&&(Math.abs(velT)>2e-5||Math.abs(velP)>2e-5)){
    cam.theta+=velT*dt*60; cam.phi=clamp(cam.phi+velP*dt*60,cam.minPhi,cam.maxPhi);
    const k=Math.exp(-dt*4.5); velT*=k; velP*=k;
  }
  /* 相机在室外时淡出体积光柱（圆锥体会穿出建筑外壳） */
  if(SHAFTS.length){
    const cp=camera.position;
    const IB=def.interiorBox;
    const inside=IB?(cp.x>IB.x0&&cp.x<IB.x1&&Math.abs(cp.z)<IB.z&&cp.y<IB.y):false;
    SHAFT_OP+=((inside?0.155:0.02)-SHAFT_OP)*Math.min(1,dt*3);
    for(const s of SHAFTS) s.material.opacity=SHAFT_OP;
  }
  if(flight){
    flight.k+=dt;
    const t=Math.min(1,flight.k/flight.dur);
    const e=t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
    camera.position.lerpVectors(flight.p0,flight.p1,e);
    cam.target.lerpVectors(flight.t0,flight.t1,e);
    cam.fov=lerp(flight.f0,flight.f1,e);
    camera.fov=cam.fov; camera.updateProjectionMatrix();
    camera.lookAt(cam.target);
    if(t>=1){
      flight=null;
      const d=new THREE.Vector3().subVectors(camera.position,cam.target);
      cam.radius=d.length();
      cam.phi=clamp(Math.acos(clamp(d.y/cam.radius,-1,1)),cam.minPhi,cam.maxPhi);
      cam.theta=Math.atan2(d.z,d.x);
      applyCam();
    }
  } else applyCam();

  renderer.render(scene,camera);

  frames++; acc+=dt;
  if(acc>=0.5){
    const fps=frames/acc; frames=0; acc=0;
    fpsEl.textContent=fps.toFixed(0);
    fpsEl.className='v '+(fps>=50?'good':(fps>=30?'warn':'bad'));
    barEl.style.width=clamp(fps/60*100,4,100)+'%';
    triEl.textContent=renderer.info.render.triangles.toLocaleString('en-US');
    callEl.textContent=renderer.info.render.calls;
    if(fps<30) lowStreak++; else lowStreak=0;
    if(lowStreak>=3&&curPR>0.72){ curPR=Math.max(0.72,curPR-0.18); renderer.setPixelRatio(curPR); lowStreak=0; }
    else if(fps>56&&curPR<Math.min(window.devicePixelRatio||1,1.75)-0.01){
      curPR=Math.min(Math.min(window.devicePixelRatio||1,1.75),curPR+0.10);
      renderer.setPixelRatio(curPR);
    }
  }
}


buildAll().then(()=>{
  ROSE_SPOTS.forEach(sp=>{ sp.userData.base=sp.intensity; if(!shaftOn) sp.intensity=0; });
  (def.labels||[]).forEach(l=>addLabel(l.pos,l.scale,l.text,l.sub,l.accent));
  cam.maxR=Math.max(430,(P3D._lastSpan||0)*2.2);
  step(100,'就绪');
  const ld=document.getElementById('load');
  setTimeout(()=>{ ld.classList.add('gone'); setTimeout(()=>ld.style.display='none',800); },280);
  flyTo(DOSSIER[0],true);
  onResize();
  loop();
}).catch(err=>{
  console.error(err);
  document.getElementById('err').style.display='flex';
  document.getElementById('err').innerHTML='<div>构建失败：'+((err&&err.message)?err.message:err)+'</div>';
  document.getElementById('load').style.display='none';
});

};
})();
