import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as skeletonClone} from 'three/addons/utils/SkeletonUtils.js';
import {sample,GATES,LANDMARKS} from './engine.mjs';
import {buildReferenceCity} from './city-loader.mjs';
import {makeCityMap} from './city-map.mjs';
export const ASSETS = ['citroen-2cv','car-01-taxi','car-02-cargo-tricycle','building-01-corner','building-02-tall-attic','building-03-boulangerie','building-04-fleuriste','haussmann-building-lowpoly','prop-cafe-shop','building-05-kiosque','building-06-arc','building-07-sacre-coeur','building-08-metro','building-09-bookstall','eiffel-tower','prop-01-cafe-table','prop-02-bench','prop-03-planter','pedestrian-01-man-suit','pedestrian-02-woman-dress','pedestrian-03-cyclist','pedestrian-04-dog-walker','pedestrian-05-painter'];
/* 载入用于替换城市层近景行道树的 Tripo 模型。城市层在 build 期就建实例池，
   所以这个必须在 buildReferenceCity 之前注入到 window 上。
   给城市层的几何要满足两条：y=0 落地、整体高 1 单位（它按米数做实例缩放）。
   nearMax 是近景档的实例上限——GLB 树三角面远高于程序化冠，不能沿用 150 那个数。 */
async function loadCityTree(){
  /* 多个变体轮流用在近景，避免整条街一个样。nearMax 是总配额，会被均分到各变体。 */
  const keys=['tree-01-plane-green','tree-02-plane-autumn'];
  try{
    const variants=[];
    for(const k of keys){
      try{
        const g=await new GLTFLoader().loadAsync(`./assets/${k}.glb`);
        g.scene.updateMatrixWorld(true);
        let geo=null,mat=null;
        g.scene.traverse(o=>{if(!geo&&o.isMesh){geo=o.geometry;mat=o.material;}});
        if(!geo)continue;
        const box=new THREE.Box3().setFromObject(g.scene),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
        geo=geo.clone();
        geo.translate(-center.x,-box.min.y,-center.z);
        geo.scale(1/size.y,1/size.y,1/size.y);
        geo.computeBoundingBox();geo.computeBoundingSphere();
        variants.push({geo,mat});
      }catch(e){console.warn('[tree] 变体加载失败',k,e);}
    }
    if(!variants.length)return null;
    /* heightScale：城市层给的 c.h 是「冠高」。GLB 树的宽高比接近 1:1（整树包围盒），
       而程序化树是「宽 8 : 高 11」的瘦高个体，所以缩放要以「冠幅」为准——按高度等比
       放大到 2× 时冠幅会变 14m，行道树间距才 8m，整排会糊成一片。1.2 让冠幅落在 8.4m。 */
    return {variants,nearMax:36,heightScale:1.2};
  }catch(e){console.warn('[tree] Tripo 树加载失败，回退程序化树',e);return null;}
}
export async function createWorld(canvas,onProgress,quality='high') {
  const low=quality==='low';
  const renderer=new THREE.WebGLRenderer({canvas,antialias:!low,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,low?1:1.5));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.info.autoReset=false;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.18;renderer.shadowMap.enabled=!low;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  /* 雾色跟天空的暖调对齐（原来是冷灰蓝 #bfccc9，和黄昏地平线打架，远处会横出一条发青的带子） */
  const scene=new THREE.Scene();scene.background=new THREE.Color('#d2c3ad');scene.fog=new THREE.FogExp2('#d2c3ad',.00010);
  const camera=new THREE.PerspectiveCamera(52,innerWidth/innerHeight,.15,16000);camera.position.set(-4130,4,-1060);
  const sky=new THREE.Mesh(new THREE.SphereGeometry(14500,24,12),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{top:{value:new THREE.Color('#77a3b5')},bottom:{value:new THREE.Color('#eed3ad')}},vertexShader:'varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 p;uniform vec3 top;uniform vec3 bottom;void main(){gl_FragColor=vec4(mix(bottom,top,smoothstep(-.05,.7,normalize(p).y)),1.);}'}));scene.add(sky);
  scene.add(new THREE.HemisphereLight('#cbdfea','#887955',2.6));
  const sun=new THREE.DirectionalLight('#ffe0ac',3.7);sun.castShadow=!low;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-90,right:90,top:90,bottom:-90,near:1,far:400});sun.shadow.bias=-.00025;sun.shadow.normalBias=.18;scene.add(sun,sun.target);
  const env=new THREE.Scene();env.background=new THREE.Color('#d9d9c6');const pmrem=new THREE.PMREMGenerator(renderer),rt=pmrem.fromScene(env,.1);scene.environment=rt.texture;pmrem.dispose();
  const status=text=>{document.getElementById('loadText').textContent=text;};
  window.__PARIS_TREE_GLB=await loadCityTree();
  const reference=await buildReferenceCity(scene,renderer,camera,status);reference.PC.get('water').refl.dead=low;
  const map=makeCityMap(reference,scene);
  const assets={},batches=[],walkers=[];let loaded=0,seed=2026;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const queue=[...ASSETS],loader=new GLTFLoader();
  await Promise.all(Array.from({length:4},async()=>{while(queue.length){const key=queue.shift(),g=await loader.loadAsync(`./assets/${key}.glb`);assets[key]=g.scene;onProgress(++loaded,ASSETS.length);}}));
  /* Tripo 自动绑定 + 行走动画的行人。带 skeleton 的模型不能用普通 clone（骨骼会被共享），
     实例化必须走 SkeletonUtils.clone，每个实例再配一个自己的 AnimationMixer。 */
  let walkScene=null,walkClip=null;
  try{
    const g=await loader.loadAsync('./assets/pedestrian-01-walk.glb');
    if(g.animations&&g.animations.length){walkScene=g.scene;walkClip=g.animations[0];
      /* 导出时勾了「原地播放动画」，所以位移归游戏代码管、动画只管迈腿 —— 正好是我们要的。 */
      console.log('[walk] 行走动画就绪:',walkClip.name,'时长',walkClip.duration.toFixed(2)+'s');
    }
  }catch(e){console.warn('[walk] 行走动画加载失败，回退静态行人',e);}
  function model(key,height,x,z,rotation=0,y=null,dynamic=false){
    const root=assets[key].clone(true);if(key==='car-02-cargo-tricycle')root.rotation.y+=Math.PI/2;root.updateMatrixWorld(true);
    const b=new THREE.Box3().setFromObject(root),size=b.getSize(new THREE.Vector3()),center=b.getCenter(new THREE.Vector3());
    const scaled=new THREE.Group();scaled.scale.setScalar(height/size.y);root.position.sub(new THREE.Vector3(center.x,b.min.y,center.z));scaled.add(root);
    const g=new THREE.Group();g.add(scaled);g.position.set(x,y??map.ground(x,z),z);g.rotation.y=rotation;g.userData.asset=key;
    g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});scene.add(g);
    if(!dynamic&&key.startsWith('building-')&&key!=='building-06-arc'){
      const bounds=new THREE.Box3().setFromObject(g),a=bounds.min,b=bounds.max;
      map.addSolid([[a.x,a.z],[b.x,a.z],[b.x,b.z],[a.x,b.z]]);
    }
    return g;
  }
  /* 行人：优先用 Tripo 绑骨 + 行走动画的版本；拿不到就退回静态模型 + 程序化起伏。
     返回 {obj, mixer}，mixer 为 null 表示静态。 */
  function makeWalker(key,height,x,z,rotation){
    if(walkScene){
      const root=skeletonClone(walkScene);
      root.updateMatrixWorld(true);
      const b=new THREE.Box3().setFromObject(root),size=b.getSize(new THREE.Vector3()),center=b.getCenter(new THREE.Vector3());
      const scaled=new THREE.Group();scaled.scale.setScalar(height/size.y);
      root.position.sub(new THREE.Vector3(center.x,b.min.y,center.z));
      scaled.add(root);
      const g=new THREE.Group();g.add(scaled);g.position.set(x,map.ground(x,z),z);g.rotation.y=rotation;
      g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});scene.add(g);
      const mixer=new THREE.AnimationMixer(root);
      mixer.clipAction(walkClip).play();
      /* 每个行人的走路相位错开，否则一整排人会像仪仗队一样整齐划一 */
      mixer.setTime((x*0.37+z*0.11)%walkClip.duration);
      return {obj:g,mixer};
    }
    return {obj:model(key,height,x,z,rotation,null,true),mixer:null};
  }
  model('eiffel-tower',324,-4060,-600,Math.PI/4);
  for(const x of [-51,51])for(const z of [-51,51]){const px=-4060+(x+z)*Math.SQRT1_2,pz=-600+(z-x)*Math.SQRT1_2;map.addSolid([[px-8,pz-8],[px+8,pz-8],[px+8,pz+8],[px-8,pz+8]]);}
  model('building-06-arc',50,-4030,-2315,.55);
  for(const x of [-15,15]){const px=-4030+Math.cos(.55)*x,pz=-2315-Math.sin(.55)*x;map.addSolid([[px-6,pz-6],[px+6,pz-6],[px+6,pz+6],[px-6,pz+6]]);}
  model('building-07-sacre-coeur',84,-500,-3750,Math.PI);
  const buildingKeys=['building-01-corner','building-02-tall-attic','haussmann-building-lowpoly','building-03-boulangerie','building-04-fleuriste','prop-cafe-shop','building-09-bookstall'];
  // Preserve the generated models in a bespoke roadside quarter, with an explicit road setback.
  for(let i=0;i<14;i++){
    const p=sample(36+i*30),side=-1,off=34;
    const x=p.x-Math.cos(p.heading)*off*side,z=p.z+Math.sin(p.heading)*off*side;
    if(reference.plan.river.inWater(x,-z))continue;
    model(buildingKeys[i%buildingKeys.length],i%7>2?13:20,x,z,p.heading+Math.PI/2);
  }
  const spawn=sample(0),sn=map.nearestRoad(spawn.x,spawn.z),px=-Math.cos(sn.heading),pz=Math.sin(sn.heading);
  const propKeys=['building-08-metro','building-05-kiosque','prop-01-cafe-table','prop-02-bench','prop-03-planter'];
  /* 偏移量原来取「半路宽 - 2」，道具会压进路面。metro/kiosque 这两个前缀是 building-*，
     在 model() 里会被登记成 solid 碰撞块——于是变成赛道上的隐形障碍：实测全油门起步，
     2.1 秒后必撞停在起跑后 50m 处（撞停点距报亭仅 3.1m）。改成明确放在半路宽之外。 */
  for(let i=0;i<18;i++){const p=sample(i*22+8),side=i%2?-1:1,near=map.nearestRoad(p.x,p.z),off=Math.max(near.width/2-2,16);
    const x=p.x-Math.cos(p.heading)*off*side,z=p.z+Math.sin(p.heading)*off*side;
    if(reference.plan.river.inWater(x,-z))continue;
    const key=propKeys[i%5];model(key,i%5<2?3:1.1,x,z,p.heading);
    const person=makeWalker(ASSETS[18+i%5],1.72,x+1.2,z+2,p.heading);walkers.push({obj:person.obj,mixer:person.mixer,x:x+1.2,z:z+2,heading:p.heading});
  }
  const player=model('citroen-2cv',1.62,0,0,Math.PI,.1,true);
  const rivals=['car-01-taxi','car-02-cargo-tricycle','citroen-2cv'].map(key=>model(key,1.58,0,0,Math.PI,.1,true));
  rivals[2].traverse(o=>{if(o.isMesh){o.material=o.material.clone();o.material.color.multiply(new THREE.Color('#aeceec'));}});
  const ghost=model('citroen-2cv',1.62,0,0,Math.PI,.1,true);ghost.traverse(o=>{if(o.isMesh){o.material=new THREE.MeshBasicMaterial({color:'#97e8eb',transparent:true,opacity:.24,depthWrite:false});o.castShadow=false;}});ghost.visible=false;
  const ringMat=new THREE.MeshStandardMaterial({color:'#b5efda',emissive:'#6ecca5',emissiveIntensity:.8,transparent:true,opacity:.8});
  const gates=GATES.map(p=>{const g=new THREE.Group();const beam=new THREE.Mesh(new THREE.TorusGeometry(7.8,.09,5,40,Math.PI),ringMat);beam.rotation.y=p.heading;beam.position.set(p.x,map.ground(p.x,p.z)+.15,p.z);g.add(beam);scene.add(g);g.visible=false;return g;});
  const coinMat=new THREE.MeshStandardMaterial({color:'#f5cc66',emissive:'#bd8522',emissiveIntensity:.35,metalness:.55,roughness:.35});
  const coinGeo=new THREE.TorusGeometry(.45,.11,6,16);
  const coins=Array.from({length:24},()=>{const c=new THREE.Mesh(coinGeo,coinMat);scene.add(c);return c;});
  const trailGeo=new THREE.BufferGeometry();trailGeo.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(240*3),3));
  const trail=new THREE.Points(trailGeo,new THREE.PointsMaterial({color:'#ffe1a1',size:.13,transparent:true,opacity:.8,depthWrite:false}));trail.frustumCulled=false;scene.add(trail);let trailIndex=0;trailGeo.attributes.position.array.fill(-999);
  // Reusable ground arrows show the near route rather than drawing a wall of UI.
  const arrowShape=new THREE.Shape();arrowShape.moveTo(-.45,.0);arrowShape.lineTo(0,.6);arrowShape.lineTo(.45,0);arrowShape.lineTo(.24,0);arrowShape.lineTo(0,.3);arrowShape.lineTo(-.24,0);arrowShape.closePath();
  const arrowGeo=new THREE.ShapeGeometry(arrowShape),arrowMat=new THREE.MeshBasicMaterial({color:'#d4e9c1',transparent:true,opacity:.56,side:THREE.DoubleSide,depthWrite:false});
  const arrows=Array.from({length:12},()=>{const a=new THREE.Mesh(arrowGeo,arrowMat);a.rotation.x=-Math.PI/2;scene.add(a);return a;});
  // Soft tire contact anchors cars even in low graphics mode.
  const c=document.createElement('canvas');c.width=c.height=128;const cx=c.getContext('2d'),gradient=cx.createRadialGradient(64,64,6,64,64,64);gradient.addColorStop(0,'#152014c0');gradient.addColorStop(1,'#15201400');cx.fillStyle=gradient;cx.fillRect(0,0,128,128);
  const contactMat=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthWrite:false});
  const contacts=[player,...rivals].map(()=>{const p=new THREE.Mesh(new THREE.PlaneGeometry(2.7,4.7),contactMat);p.rotation.x=-Math.PI/2;scene.add(p);return p;});
  function update(game,time,dt,nearS) {
    [player,...rivals].forEach((obj,i)=>{const car=i===0?game.player:game.rivals[i-1];obj.visible=i===0||game.mode==='race';obj.position.set(car.x,map.ground(car.x,car.z)+.11,car.z);obj.rotation.set(0,car.heading, i===0?-car.steer*Math.min(Math.abs(car.speed)/23,1)*.045:0);
      contacts[i].visible=obj.visible;contacts[i].position.set(car.x,map.ground(car.x,car.z)+.05,car.z);contacts[i].rotation.z=car.heading;});
    coins.forEach((c,i)=>{const state=game.coins[i];c.visible=!state.collected&&game.phase!=='menu';c.position.set(state.x,map.ground(state.x,state.z)+1.15+Math.sin(time*2.3+i)*.12,state.z);c.rotation.y=time*1.7+i;});
    gates.forEach((g,i)=>g.visible=game.mode!=='tour'&&game.phase==='driving'&&i===game.player.nextGate);
    for(const w of walkers){
      const wp={x:w.x+Math.sin(time*.09)*3,z:w.z,heading:w.heading},dirFlip=Math.cos(time*.09)<0?Math.PI:0;
      if(w.mixer){
        /* 带动画的行人：位置由代码控制（动画导出时勾了「原地播放」，只管迈腿），
           所以这里只贴地、不再叠程序化的上下起伏。 */
        w.mixer.update(dt);
        w.obj.position.set(wp.x,map.ground(wp.x,wp.z)+.02,wp.z);
        w.obj.rotation.y=wp.heading+dirFlip;
      }else{
        w.obj.position.set(wp.x,map.ground(wp.x,wp.z)+.12+Math.abs(Math.sin(time*3.3+w.x*.01))*.025,wp.z);
        w.obj.rotation.y=wp.heading+dirFlip;
      }
      w.obj.visible=Math.hypot(wp.x-camera.position.x,wp.z-camera.position.z)<85;
    }
    batches.forEach(b=>{const s=b.boundingSphere;b.visible=Math.hypot(s.center.x-camera.position.x,s.center.z-camera.position.z)<(low?135:190)+s.radius;});
    arrows.forEach((a,i)=>{const p=sample(nearS+8+i*3.5);a.position.set(p.x,map.ground(p.x,p.z)+.09,p.z);a.rotation.z=p.heading+Math.PI;a.visible=game.phase==='driving'&&game.mode!=='tour';});
    const y=map.ground(game.player.x,game.player.z);sun.position.set(game.player.x-75,y+105,game.player.z+50);sun.target.position.set(game.player.x,y,game.player.z);sun.target.updateMatrixWorld();sky.position.copy(camera.position);reference.update(dt);
    if(game.drift>.1||game.boost>0)for(let i=0;i<3;i++){const p=game.player,a=trailGeo.attributes.position.array,j=(trailIndex++%240)*3;a[j]=p.x-Math.sin(p.heading)*1.5+(rand()-.5)*1.6;a[j+1]=map.ground(p.x,p.z)+.2+rand()*.3;a[j+2]=p.z-Math.cos(p.heading)*1.5+(rand()-.5)*.8;}
    const a=trailGeo.attributes.position.array;for(let i=1;i<a.length;i+=3)a[i]-=dt*.7;trailGeo.attributes.position.needsUpdate=true;
  }
  function setQuality(q){const l=q==='low';renderer.setPixelRatio(Math.min(devicePixelRatio,l?1:1.5));renderer.shadowMap.enabled=!l;sun.castShadow=!l;reference.PC.get('water').refl.dead=l;renderer.setSize(innerWidth,innerHeight);}
  return {renderer,scene,camera,sun,player,rivals,ghost,update,setQuality,assets,assetCount:loaded,batches,map,reference,ground:map.ground};
}
