import * as THREE from 'three';
import {configureCity, clamp} from './engine.mjs';

function closest(a,b,x,z){const dx=b[0]-a[0],dz=b[1]-a[1],l=dx*dx+dz*dz,t=clamp(((x-a[0])*dx+(z-a[1])*dz)/(l||1),0,1);return {x:a[0]+dx*t,z:a[1]+dz*t,t,distance:Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t),heading:Math.atan2(dx,dz)};}
function inside(poly,x,z){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
function intersect(a,b,c,d){const x=b[0]-a[0],z=b[1]-a[1],u=d[0]-c[0],v=d[1]-c[1],cross=x*v-z*u,t=((c[0]-a[0])*v-(c[1]-a[1])*u)/cross;return [a[0]+x*t,a[1]+z*t];}
export function buildRaceRoute(plan){
  const ny=plan.streets.find(s=>s.nameFr==='Avenue de New York').pts;
  const left=plan.streets.find(s=>s.nameFr==='Quai Jacques Chirac').pts;
  const branly=plan.streets.find(s=>s.nameFr==='Quai Branly').pts;
  const alma=plan.bridges.find(b=>b.id==='pont-de-lalma'),iena=plan.bridges.find(b=>b.id==='pont-diena');
  const axis=b=>[[b.x-b.dir[0]*500,b.z-b.dir[1]*500],[b.x+b.dir[0]*500,b.z+b.dir[1]*500]];
  const [aa,ab]=axis(alma),[ia,ib]=axis(iena);
  const almaNorth=intersect(ny[0],ny[1],aa,ab),almaSouth=intersect(branly[0],branly[1],aa,ab);
  const ienaNorth=intersect(ny[2],ny[3],ia,ib),ienaSouth=intersect(left[1],left[2],ia,ib);
  const raw=[ny[2],ny[1],ny[0],almaNorth,almaSouth,...branly,left[1],ienaSouth,ienaNorth];
  const points=[];
  // Round only the joins inside road junctions; all long runs retain source axes.
  raw.forEach((p,i)=>{const a=raw[(i+raw.length-1)%raw.length],b=raw[(i+1)%raw.length],la=Math.hypot(p[0]-a[0],p[1]-a[1]),lb=Math.hypot(b[0]-p[0],b[1]-p[1]);const radius=Math.min(8,la*.18,lb*.18);
    const from=[p[0]+(a[0]-p[0])*radius/la,p[1]+(a[1]-p[1])*radius/la],to=[p[0]+(b[0]-p[0])*radius/lb,p[1]+(b[1]-p[1])*radius/lb];
    for(let k=0;k<5;k++){const t=k/4,u=1-t;points.push({x:u*u*from[0]+2*u*t*p[0]+t*t*to[0],z:-(u*u*from[1]+2*u*t*p[1]+t*t*to[1])});}
  });
  return points;
}
export function makeCityMap(reference,scene){
  const {plan,PC}=reference;
  const roads=[...plan.roads.map(r=>({...r,a:[r.a[0],-r.a[1]],b:[r.b[0],-r.b[1]]})),...plan.bridges.map(b=>({a:[b.endA[0],-b.endA[1]],b:[b.endB[0],-b.endB[1]],w:b.deckW,name:b.name,bridge:true}))];
  const bridgeList=plan.bridges.map(b=>({...b,wx:b.x,wz:-b.z}));
  const solids=[...reference.solidBlocks.map(b=>b.poly.map(p=>[p[0],-p[1]])),...(reference.extraSolids||[])];
  const grid=new Map(),size=80;
  function indexSolid(poly,id){const xs=poly.map(p=>p[0]),zs=poly.map(p=>p[1]);for(let x=Math.floor(Math.min(...xs)/size)-1;x<=Math.floor(Math.max(...xs)/size)+1;x++)for(let z=Math.floor(Math.min(...zs)/size)-1;z<=Math.floor(Math.max(...zs)/size)+1;z++){const key=x+','+z;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(id);}}
  solids.forEach(indexSolid);
  const addSolid=poly=>{const id=solids.push(poly)-1;indexSolid(poly,id);};
  function nearestRoad(x,z){let best={distance:Infinity};for(const r of roads){const p=closest(r.a,r.b,x,z);if(p.distance<best.distance)best={...p,name:r.name,width:r.w};}return best;}
  const bridgeMeshes=[];scene.updateMatrixWorld(true);scene.traverse(o=>{if(o.isMesh&&/^bridges\.(asphalt|wood)$/.test(o.name))bridgeMeshes.push(o);});
  const ray=new THREE.Raycaster(),heightCache=new Map(),down=new THREE.Vector3(0,-1,0);
  function bridgeHeight(x,z){
    if(!bridgeList.some(b=>Math.hypot(x-b.wx,z-b.wz)<b.lengthM*.65+100))return null;
    const key=Math.round(x*2)+','+Math.round(z*2);if(heightCache.has(key))return heightCache.get(key);
    ray.set(new THREE.Vector3(x,35,z),down);const hit=ray.intersectObjects(bridgeMeshes,false).find(h=>h.point.y>-3&&h.point.y<15),h=hit?hit.point.y:null;
    if(heightCache.size>18000)heightCache.clear();heightCache.set(key,h);return h;
  }
  function ground(x,z){const h=bridgeHeight(x,z);return h===null?plan.terrainY(x,-z):h;}
  function resolve(x,z,r,oldX,oldZ){
    let hit=false;
    if(plan.river.inWater(x,-z)&&bridgeHeight(x,z)===null)return {x:oldX,z:oldZ,hit:true};
    const bb=plan.bbox;if(x<bb[0]+10||x>bb[2]-10||z<-bb[3]+10||z>-bb[1]-10)return {x:oldX,z:oldZ,hit:true};
    if(bridgeHeight(x,z)!==null)return {x,z,hit:false};
    for(let pass=0;pass<2;pass++)for(const id of grid.get(Math.floor(x/size)+','+Math.floor(z/size))||[]){const poly=solids[id],isInside=inside(poly,x,z);let edge={distance:Infinity};
      for(let i=0;i<poly.length;i++){const q=closest(poly[i],poly[(i+1)%poly.length],x,z);if(q.distance<edge.distance)edge=q;}
      if(isInside||edge.distance<r){const sign=isInside?-1:1,dx=(x-edge.x)*sign,dz=(z-edge.z)*sign,d=Math.hypot(dx,dz)||1;x=edge.x+dx/d*r;z=edge.z+dz/d*r;hit=true;}
    }
    return {x,z,hit};
  }
  const points=buildRaceRoute(plan);
  const destinations=[
    {id:'tower',title:'铁塔来信',french:'LA TOUR EIFFEL',x:-4176,z:-701,radius:100,look:[-4060,120,-600],story:'从桥上回望，铁塔撑起整片天空。'},
    {id:'alexandre',title:'金色桥梁',french:'PONT ALEXANDRE III',x:-2654,z:-1198,radius:75,look:[-2654,5,-1198],story:'桥灯、金雕与拱架，把两岸连成一封信。'},
    {id:'louvre',title:'卢浮宫之光',french:'LE LOUVRE',x:-1177,z:-886,radius:180,look:[-1030,14,-890],story:'在玻璃金字塔前，把车停慢一点。'},
    {id:'notre',title:'西岱岛来信',french:'ÎLE DE LA CITÉ',x:-188,z:-78,radius:180,look:[0,35,0],story:'穿过石桥，岛上的钟楼还在。'},
    {id:'arc',title:'凯旋归来',french:'ARC DE TRIOMPHE',x:-4100,z:-2310,radius:155,look:[-4030,22,-2315],story:'十二条街道，在这里相遇。'},
    {id:'sacre',title:'山顶的白色',french:'MONTMARTRE',x:-525,z:-3600,radius:190,look:[-500,90,-3750],story:'驶向山丘，把整座巴黎留在身后。'},
    {id:'bir',title:'双层桥的风',french:'PONT DE BIR-HAKEIM',x:-4571,z:-312,radius:90,look:[-4571,3,-312],story:'车从桥上经过，船从脚下驶去。'},
    {id:'cafe',title:'街角咖啡',french:'LE CAFÉ',x:points[0].x,z:points[0].z,radius:38,look:[points[0].x+16,5,points[0].z-8],story:'旅程的起点，有一家熟悉的咖啡馆。'},
  ];
  const env={addSolid,nearestRoad,resolve,ground,bridgeHeight,roads,bridges:bridgeList,plan,destinations,points};
  configureCity(points,destinations,env);return env;
}
