import * as THREE from 'three';
import {buildRaceRoute} from './city-map.mjs';
export async function buildReferenceCity(scene,renderer,camera,status) {
  window.THREE=THREE;
  for(const f of ['engine','city/core','city/plan','city/terrain','city/water','city/bridges','city/facade','city/shops','city/furniture','buildings/notre-dame','buildings/louvre','buildings/sainte-chapelle'])await import(`./city-reference/${f}.js`);
  const PC=window.PC,P3D=window.P3D,plan=window.PCPlan.generate(PC.SEED);PC.plan=plan;
  const racePoints=buildRaceRoute(plan), sourceCount=plan.blocks.length;
  function inside(poly,x,z){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
  function distance(x,z,a,b){const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1)));return Math.hypot(x-a.x-dx*t,z-a.z-dz*t);}
  const reserved=plan.blocks.filter(block=>racePoints.some((a,i)=>{const b=racePoints[(i+1)%racePoints.length];return block.poly.some(p=>distance(p[0],-p[1],a,b)<15)||inside(block.poly,a.x,-a.z)||inside(block.poly,(a.x+b.x)/2,-(a.z+b.z)/2);}));
  plan.blocks=plan.blocks.filter(b=>!reserved.includes(b));
  const solidBlocks=[...plan.blocks];
  const heroBlock=reserved[0]||solidBlocks[0];
  // Roads are reserved before city geometry, so source parcels cannot grow over the race route.
  for(let i=0;i<racePoints.length;i++){const a=racePoints[i],b=racePoints[(i+1)%racePoints.length],x=(a.x+b.x)/2,z=(a.z+b.z)/2;
    if(!plan.river.inWater(x,-z)&&!plan.roads.some(r=>distance(x,z,{x:r.a[0],z:-r.a[1]},{x:r.b[0],z:-r.b[1]})<2))plan.roads.push({a:[a.x,-a.z],b:[b.x,-b.z],w:27,klass:'quai',name:'巴黎河岸赛道',real:false,id:-1});
  }
  plan.integration={sourceBlocks:sourceCount,reservedBlocks:reserved.length};
  const initial=new Set(scene.children),sunState={dir:[-.45,.68,.35],hour:17.4};
  const raf=()=>document.hidden?Promise.resolve():new Promise(r=>setTimeout(r,0));
  const report=await PC.buildAll({THREE,scene,renderer,camera,helpers:P3D.helpers,SUN:sunState,sunDir:()=>sunState.dir,step:(_,m)=>status(m),raf});
  const failed=report.filter(r=>!r.ok);if(failed.length)throw new Error('城市层加载失败：'+failed.map(f=>f.mod+':'+f.err).join(';'));
  const cityRoot=new THREE.Group();cityRoot.name='Paris city, north = -Z';
  for(const child of [...scene.children])if(!initial.has(child))cityRoot.add(child);
  scene.add(cityRoot);cityRoot.scale.z=-1;cityRoot.updateMatrixWorld(true);
  // The source map uses north = +Z. Only this boundary converts it to north = -Z.
  // Reflection receives the world camera; LOD queries receive source coordinates.
  const lodPosition=new THREE.Vector3(),extraSolids=[];
  const ground=(x,z)=>plan.terrainY(x,-z);
  async function landmark(id,x,z,rotation=0){
    const def=P3D.registry[id],group=new THREE.Group();group.position.set(x,ground(x,z),z);group.rotation.y=rotation;group.scale.z=-1;scene.add(group);
    const kit=P3D.makeKit(P3D.resolvePalette(def.palette)),G={},mats={...kit.M};
    const make=(n)=>G[n]=new P3D.helpers.GB();
    for(const n of ['stone','stone2','stoneNew','lead','leadNew','oak','gold','dark','floor'])make(n);
    const ctx={THREE,scene:group,renderer,T:kit.T,M:mats,G,helpers:P3D.helpers,spots:[],shafts:[],step:()=>{},raf,solid:(x0,y0,z0,x1,y1,z1)=>{if(y0<2&&y1>1)extraSolids.push([[x+x0,z-z0],[x+x1,z-z0],[x+x1,z-z1],[x+x0,z-z1]]);},
      tex:(c,srgb,rx,ry)=>{const t=new THREE.CanvasTexture(c);if(srgb)t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;if(rx)t.repeat.set(rx,ry??rx);return t;},
      addMat:(n,p)=>{mats[n]=new THREE.MeshStandardMaterial(p);return make(n);},
      addGlass:(n,c,intensity)=>{const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;mats[n]=new THREE.MeshStandardMaterial({map:t,emissive:0xffffff,emissiveMap:t,emissiveIntensity:intensity,roughness:.3,transparent:true,opacity:.87,side:THREE.DoubleSide});return make(n);}};
    ctx.addGlass('gwin',kit.T.glassWin,.3);if(def.textures)def.textures(ctx);await def.build(ctx);
    for(const [n,gb] of Object.entries(G)){if(!gb.I.length)continue;const m=new THREE.Mesh(gb.build(),mats[n]||mats.stone);m.castShadow=!n.startsWith('g');m.receiveShadow=true;group.add(m);}
    return group;
  }
  status('卢浮宫 · 玻璃金字塔与宫殿');await landmark('louvre',-1030,-890);
  status('西岱岛 · 圣母院与圣礼拜堂');await landmark('notre-dame',0,0);await landmark('sainte-chapelle',-360,-270);
  return {PC,plan,cityRoot,ground,report,heroBlock,solidBlocks,extraSolids,update:(dt)=>{lodPosition.set(camera.position.x,camera.position.y,-camera.position.z);PC.update(dt,lodPosition);}};
}
