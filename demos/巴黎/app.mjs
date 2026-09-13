import * as THREE from 'three';
import { createWorld } from './world.mjs';
import { Game, GATES, LANDMARKS, route, nearest, sample, TRACK_LENGTH, clamp, angleDelta } from './engine.mjs';

const $=id=>document.getElementById(id), show=(id,visible)=>$(id).hidden=!visible;
const STORE='paris-letter-city-v2';
let saved={stamps:[],best:{},ghost:[],muted:true,quality:matchMedia('(pointer:coarse)').matches?'low':'high'};
try {
  const s=JSON.parse(localStorage.getItem(STORE)||'null');
  if(s&&typeof s==='object'){
    saved.stamps=Array.isArray(s.stamps)?s.stamps.filter(id=>['tower','alexandre','louvre','notre','arc','sacre','bir','cafe'].includes(id)):[];
    saved.best=Object.fromEntries(Object.entries(s.best||{}).filter(([k,v])=>['race','time'].includes(k)&&Number.isFinite(v)&&v>0));
    saved.ghost=Array.isArray(s.ghost)?s.ghost.filter(f=>Array.isArray(f)&&f.length===4&&f.every(Number.isFinite)).slice(0,36000):[];
    saved.muted=s.muted!==false;saved.quality=s.quality==='low'?'low':'high';
  }
}catch{}
function persist(){try{localStorage.setItem(STORE,JSON.stringify(saved));}catch{toast('浏览器未保存进度，本次旅程仍可继续。');}}
const game=new Game(),input={up:false,down:false,left:false,right:false,drift:false,boost:false};
let world,mode='race',screen='loading',last=performance.now(),elapsedVisual=0,uiClock=0,toastTimer,scoreTimer;
let view=0,lookYaw=0,lookPitch=.22,drag=null,photoDistance=11,photoReturn=null,photoLandmark=null,lastTourStamp=null;
let tourGuided=0,autoGas=false,previousPhase='menu';
const cameraPos=new THREE.Vector3(),cameraTarget=new THREE.Vector3(),desired=new THREE.Vector3(),target=new THREE.Vector3();
const reducedMotion=matchMedia('(prefers-reduced-motion:reduce)').matches,coarse=matchMedia('(pointer:coarse)').matches;
const telemetry={frames:[],loadMs:0,pageErrors:[],quality:saved.quality};
window.addEventListener('error',e=>telemetry.pageErrors.push(e.message));
function toast(text){$('toast').textContent=text;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2700);}
function formatTime(t){const m=Math.floor(t/60);return `${String(m).padStart(2,'0')}:${(t%60).toFixed(2).padStart(5,'0')}`;}
function clearInput(){Object.keys(input).forEach(k=>input[k]=false);document.querySelectorAll('.held').forEach(b=>b.classList.remove('held'));drag=null;}
function setScreen(next){screen=next;document.body.dataset.screen=next;show('menu',next==='menu');show('hud',next==='playing');show('tools',next==='playing');show('touch',next==='playing'&&coarse);show('pausePanel',next==='paused');show('result',next==='result');show('photoPanel',next==='photo');show('album',next==='album');show('cityMapPanel',next==='map');clearInput();}
function updateMenu(){
  $('albumCount').textContent=`${saved.stamps.length}/${LANDMARKS.length}`;
  $('personalBest').textContent=mode==='tour'?`已收集${saved.stamps.length}处巴黎风景`:saved.best[mode]?`个人最佳 ${formatTime(saved.best[mode])}`:'第一次巴黎之旅';
  $('start').innerHTML=(mode==='race'?'出发，追一场日落':mode==='time'?'出发，超越上次的自己':'出发，把时间留给风景')+' <span>→</span>';
}
function selectMode(next){mode=next;game.reset(mode);document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});updateMenu();}
function start(next=mode){if(!world)return;mode=next;game.start(next);lastTourStamp=null;tourGuided=0;view=0;lookYaw=0;lookPitch=.22;previousPhase='menu';setScreen('playing');
  cameraPos.set(game.player.x-Math.sin(game.player.heading)*9,world.ground(game.player.x,game.player.z)+4,game.player.z-Math.cos(game.player.heading)*9);cameraTarget.set(game.player.x,world.ground(game.player.x,game.player.z)+1.1,game.player.z);initAudio();updateHUD();}
function goMenu(){selectMode(mode);world.ghost.visible=false;setScreen('menu');updateMenu();show('countdown',false);$('start').focus({preventScroll:true});}
function pause(){if(screen!=='playing')return;game.pause();if(game.phase==='paused'){setScreen('paused');show('countdown',false);$('resume').focus({preventScroll:true});}}
function resume(){if(screen!=='paused')return;game.resume();setScreen('playing');last=performance.now();}
function toggleSound(){saved.muted=!saved.muted;initAudio();updateSoundButton();persist();}
function updateSoundButton(){$('sound').textContent=saved.muted?'静音':'有声';$('sound').setAttribute('aria-label',saved.muted?'开启声音':'关闭声音');}
let audio=null,osc=null,gain=null;
function initAudio(){if(saved.muted)return;try{if(!audio){audio=new (window.AudioContext||window.webkitAudioContext)();osc=audio.createOscillator();gain=audio.createGain();const filter=audio.createBiquadFilter();osc.type='triangle';filter.frequency.value=400;gain.gain.value=0;osc.connect(filter).connect(gain).connect(audio.destination);osc.start();}if(audio.state==='suspended')audio.resume().catch(()=>{});}catch{}}
function beep(freq=660,duration=.12){if(!audio||saved.muted)return;const o=audio.createOscillator(),g=audio.createGain(),t=audio.currentTime;o.type='sine';o.frequency.value=freq;g.gain.setValueAtTime(.045,t);g.gain.exponentialRampToValueAtTime(.001,t+duration);o.connect(g).connect(audio.destination);o.start();o.stop(t+duration+.01);o.onended=()=>{o.disconnect();g.disconnect();};}
function renderAudio(){if(!audio)return;const active=screen==='playing'&&game.phase==='driving'&&!saved.muted;osc.frequency.setTargetAtTime(55+Math.abs(game.player.speed)*4.2,audio.currentTime,.08);gain.gain.setTargetAtTime(active?.018:0,audio.currentTime,.08);}
function finish(){
  const time=game.elapsed,place=game.mode==='race'?game.place():null,isBest=!saved.best[game.mode]||time<saved.best[game.mode];
  if(isBest){saved.best[game.mode]=time;if(game.mode==='time')saved.ghost=game.ghost.map(f=>[...f]);persist();}
  $('resultEyebrow').textContent=game.mode==='race'?'PARIS GRAND PRIX':'CONTRE LA MONTRE';
  $('medal').textContent=place||'PB';$('resultTitle').textContent=place===1?'把日落甩在身后。':game.mode==='time'?'这一圈，属于你。':'巴黎，为你喝彩。';
  $('resultSubtitle').textContent=(place?`第${place}名完赛`:'单圈计时完成')+(isBest?' · 新的个人纪录':' · 下一次，试着在弯前漂移');
  $('resultTime').textContent=formatTime(time);$('resultScore').textContent=game.score.toLocaleString();$('resultDrift').textContent=game.driftTotal.toFixed(1)+'s';
  $('resultNote').textContent=`金币${game.coins.filter(c=>c.collected).length}/24 · 碰撞${game.hits}次 · 救援${game.rescues}次（每次加时3秒）`;
  setScreen('result');show('countdown',false);[523,659,784,1046].forEach((f,i)=>setTimeout(()=>beep(f,.24),i*115));$('again').focus({preventScroll:true});
}
function consumeEvents(){
  for(const e of game.events.splice(0)){
    if(e.type==='countdown'){beep(440);}
    if(e.type==='go'){beep(880,.3);toast('出发！过弯时按住漂移，松开就能冲刺。');}
    if(e.type==='coin')beep(1120,.06);
    if(e.type==='hit'){beep(130,.1);toast('擦到路肩了，收一点方向。卡住可按R回到道路。');}
    if(e.type==='rescue')toast(game.mode==='tour'?'已回到道路。':'已回到上一检查点 · 加时3秒');
    if(e.type==='gate')beep(740,.1);
    if(e.type==='lap'&&e.value===1&&game.mode==='race'){toast('最后一圈。把剩下的能量用起来！');beep(1046,.2);}
    if(e.type==='drift'){const d=e.value;$('scoreBubble').textContent=`${d.big?'完美漂移':'漂亮转弯'} +${d.points}${d.combo>1?' ×'+Math.min(4,d.combo):''}`;show('scoreBubble',true);clearTimeout(scoreTimer);scoreTimer=setTimeout(()=>show('scoreBubble',false),1700);beep(d.big?880:660,.15);}
    if(e.type==='stamp'){
      lastTourStamp=e.value;if(!saved.stamps.includes(e.value.id)){saved.stamps.push(e.value.id);persist();}
      toast(`收下一张「${e.value.title}」${game.mode==='tour'?' · 按P拍照留念':''}`);beep(988,.2);
      if(game.mode==='tour'&&game.stamps.size===LANDMARKS.length)setTimeout(()=>toast('全城地标集齐！这座巴黎，没有截止时间。'),3000);
    }
    if(e.type==='finish')finish();
  }
}
function openPhoto(){if(screen!=='playing'||game.phase!=='driving')return;
  photoReturn='playing';game.pause();photoLandmark=LANDMARKS.reduce((a,b)=>Math.hypot(a.x-game.player.x,a.z-game.player.z)<Math.hypot(b.x-game.player.x,b.z-game.player.z)?a:b);
  if(Math.hypot(photoLandmark.x-game.player.x,photoLandmark.z-game.player.z)>(photoLandmark.radius||100))photoLandmark=null;
  $('photoTitle').textContent=photoLandmark?.title||'来自巴黎的明信片。';$('photoFrench').textContent=photoLandmark?.french||'CARTE POSTALE / PARIS';
  lookYaw=-.6;lookPitch=.32;photoDistance=11;setScreen('photo');
}
function closePhoto(){if(screen!=='photo')return;game.resume();setScreen(photoReturn||'playing');lookYaw=0;last=performance.now();}
async function savePhoto(){
  $('savePhoto').disabled=true;
  try{
    world.renderer.render(world.scene,world.camera);
    const src=world.renderer.domElement,c=document.createElement('canvas');c.width=src.width+80;c.height=src.height+150;
    const ctx=c.getContext('2d');ctx.fillStyle='#f4eedf';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(src,40,40);ctx.fillStyle='#263c32';
    ctx.font=`italic ${Math.max(22,c.width*.024)}px Georgia,serif`;ctx.fillText('Paris, à fond.',42,c.height-55);
    ctx.textAlign='right';ctx.font=`${Math.max(12,c.width*.012)}px sans-serif`;ctx.fillText(photoLandmark?.title||'把巴黎，开进黄昏。',c.width-42,c.height-55);
    ctx.textAlign='left';ctx.fillStyle='#8a927b';ctx.font=`${Math.max(10,c.width*.008)}px sans-serif`;ctx.fillText('巴黎来信 · 我的驾驶明信片',44,c.height-26);
    const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));if(!blob)throw new Error('空白图片');
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`巴黎来信-${photoLandmark?.id||'自由漫游'}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);toast('明信片已生成，正在保存。');
  }catch{toast('暂时无法导出，请再次尝试。');}finally{$('savePhoto').disabled=false;}
}
function album(){
  $('albumItems').innerHTML=LANDMARKS.map((l,i)=>{const found=saved.stamps.includes(l.id);return `<div class="stamp-card ${found?'':'locked'}"><span class="stamp-id">0${i+1}${found?' · ✓':''}</span><strong>${l.title}</strong><small>${found?l.story:'等待你的第一封来信'}</small></div>`;}).join('');setScreen('album');$('albumClose').focus({preventScroll:true});
}
function updateHUD(){
  const p=game.player,tour=game.mode==='tour';
  $('modeLabel').textContent=tour?'巴黎自由行':game.mode==='time'?'单圈计时':'黄昏大奖赛';
  $('lap').innerHTML=tour?`${game.stamps.size}<span>/${LANDMARKS.length}地标</span>`:`${Math.min(p.lap+1,game.mode==='time'?1:2)}<span>/${game.mode==='time'?1:2}圈</span>`;
  document.querySelector('.position').hidden=game.mode!=='race';$('place').innerHTML=`${game.place()}<span>/4</span>`;
  $('timeLabel').textContent=tour?'慢慢来':'本局用时';$('time').textContent=formatTime(game.elapsed);
  $('speed').textContent=Math.round(Math.abs(p.speed)*3.6);$('nitro').style.width=game.nitro*100+'%';$('nitroPercent').textContent=Math.round(game.nitro*100)+'%';
  $('boostLabel').textContent=game.boost>0?'漂移冲刺':input.boost&&game.nitro>0?'正在冲刺':'冲刺储备';
  $('driftHint').textContent=game.drift>.35?(game.drift>1.05?'完美！松开漂移冲刺':'继续漂移，蓄满更远'):game.nitro<.05?'漂移或金币补充能量':coarse?'按冲刺释放能量':'空格冲刺 · Shift漂移';
  $('coins').textContent=`金币 ${game.coins.filter(c=>c.collected).length}/24`;$('stamps').textContent=`地标 ${game.stamps.size}/${LANDMARKS.length}`;
  const near=nearest(p.x,p.z),road=world.map.nearestRoad(p.x,p.z),ahead=sample(near.s+36),bend=angleDelta(p.heading,ahead.heading);
  const reverse=Math.abs(angleDelta(p.heading,near.heading))>2.1&&p.speed>3;
  $('turnIcon').textContent=reverse?'↶':bend>.25?'↰':bend<-.25?'↱':'↑';
  $('routeHint').textContent=reverse?'方向反了，掉个头':bend>.25?'前方左弯':bend<-.25?'前方右弯':'沿街道直行';
  const landmark=LANDMARKS.find(l=>!game.stamps.has(l.id));
  const targetS=GATES[p.nextGate].s;
  const remaining=(targetS-near.s+TRACK_LENGTH)%TRACK_LENGTH;
  $('routeDistance').textContent=tour?(landmark?`${landmark.title} · ${Math.round(Math.hypot(p.x-landmark.x,p.z-landmark.z))}m`:'全城收齐 · 随心漫游'):`检查点 ${p.nextGate+1}/8 · ${Math.round(remaining)}m`;
  $('district').textContent=road.name||'巴黎街区';if(tour){$('routeHint').textContent=road.name||'自由探索';$('turnIcon').textContent='⌖';}
  if(tour){$('objectiveLabel').textContent='你的巴黎来信';$('objective').textContent=lastTourStamp&&Math.hypot(p.x-lastTourStamp.x,p.z-lastTourStamp.z)<(lastTourStamp.radius||100)?'按P拍照，把这一站寄给自己':landmark?'顺着路标，驶近地标收集明信片':'全城地标集齐，按P随时拍照';}
  else if(game.elapsed<7){$('objectiveLabel').textContent='先感受一下方向盘';$('objective').textContent=coarse?'按住油门，用左侧按钮转弯':'W/↑加速 · A/D左右转弯';}
  else if(game.driftTotal<.4){$('objectiveLabel').textContent='试试第一次漂移';$('objective').textContent=coarse?'转弯时按漂移，松开会加速':'转弯时按住Shift，松开加速';}
  else{$('objectiveLabel').textContent=game.mode==='time'?'超越上一次的自己':'把日落甩在身后';$('objective').textContent=game.mode==='time'?(saved.ghost.length?'浅蓝色幽灵车是你的最佳圈':'跑完这一圈，留下你的第一道车影'):'连续漂移加积分 · 金币补充冲刺';}
  drawMap(near);
}
function paintMap(canvas,full=false){
  const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,p=game.player;
  const scale=full?Math.min(w/6500,h/5700):.16,cx=full?-1900:p.x,cz=full?-1450:p.z;
  const map=q=>[w/2+(q.x-cx)*scale,h/2+(q.z-cz)*scale];
  ctx.clearRect(0,0,w,h);ctx.fillStyle=full?'#233d34':'#294137';ctx.fillRect(0,0,w,h);
  if(full){ctx.fillStyle='#c1c9a822';for(const block of world.reference.solidBlocks){ctx.beginPath();block.poly.forEach((q,i)=>{const a=map({x:q[0],z:-q[1]});i?ctx.lineTo(...a):ctx.moveTo(...a);});ctx.closePath();ctx.fill();}}
  ctx.beginPath();world.map.plan.river.pts.forEach((q,i)=>{const a=map({x:q[0],z:-q[1]});i?ctx.lineTo(...a):ctx.moveTo(...a);});ctx.strokeStyle='#7aa59c99';ctx.lineWidth=150*scale;ctx.lineJoin='round';ctx.stroke();
  ctx.lineCap='round';for(const road of world.map.roads){ctx.beginPath();ctx.moveTo(...map({x:road.a[0],z:road.a[1]}));ctx.lineTo(...map({x:road.b[0],z:road.b[1]}));ctx.strokeStyle='#ced5b849';ctx.lineWidth=Math.max(.6,road.w*scale*.38);ctx.stroke();}
  for(const b of world.map.bridges){ctx.beginPath();ctx.moveTo(...map({x:b.endA[0],z:-b.endA[1]}));ctx.lineTo(...map({x:b.endB[0],z:-b.endB[1]}));ctx.strokeStyle='#efe2bc';ctx.lineWidth=Math.max(1,b.deckW*scale*.6);ctx.stroke();}
  if(game.mode!=='tour'){ctx.beginPath();route.forEach((p,i)=>{const a=map(p);i?ctx.lineTo(...a):ctx.moveTo(...a);});ctx.closePath();ctx.strokeStyle='#eec887ba';ctx.lineWidth=full?2:3;ctx.stroke();const a=map(GATES[game.player.nextGate]);ctx.beginPath();ctx.arc(...a,6,0,7);ctx.strokeStyle='#fff2c8';ctx.stroke();}
  LANDMARKS.forEach((l,i)=>{const a=map(l);ctx.beginPath();ctx.arc(...a,full?7:4,0,7);ctx.fillStyle=saved.stamps.includes(l.id)?'#f0cc87':'#a2b296';ctx.fill();if(full){ctx.fillStyle='#f7edcf';ctx.font='16px sans-serif';ctx.fillText(l.title,a[0]+12,a[1]+5);}});
  if(game.mode==='race')game.rivals.forEach((r,i)=>{ctx.beginPath();ctx.arc(...map(r),3.5,0,7);ctx.fillStyle=['#eab888','#9dc0d3','#c3b3d0'][i];ctx.fill();});
  const a=map(p);ctx.save();ctx.translate(...a);ctx.rotate(-p.heading);ctx.beginPath();ctx.moveTo(0,8);ctx.lineTo(-5,-5);ctx.lineTo(5,-5);ctx.closePath();ctx.fillStyle='#fff5cd';ctx.shadowColor='#ffedb1';ctx.shadowBlur=9;ctx.fill();ctx.restore();
}
function drawMap(){paintMap($('minimap'));}
let mapReturn='menu';
function openMap(){if(!world)return;mapReturn=screen;if(screen==='playing')game.pause();setScreen('map');
  $('destinations').innerHTML=LANDMARKS.map((l,i)=>`<button data-destination="${i}"><span>0${i+1}</span><strong>${l.title}</strong><small>${saved.stamps.includes(l.id)?'已收集':'待探索'} · ${mapReturn==='menu'||game.mode==='tour'?'快速到达 ↗':'比赛中可查看'}</small></button>`).join('');
  $('destinations').querySelectorAll('button').forEach(b=>b.onclick=()=>travel(Number(b.dataset.destination)));paintMap($('cityMap'),true);$('mapClose').focus({preventScroll:true});
}
function closeMap(){if(screen!=='map')return;if(mapReturn==='playing'){game.resume();setScreen('playing');}else{setScreen('menu');updateMenu();}}
function travel(index){if(mapReturn!=='menu'&&game.mode!=='tour'){toast('先完成这场比赛，再去自由漫游。');return;}
  const l=LANDMARKS[index];if(mapReturn==='menu')start('tour');else{game.resume();setScreen('playing');}
  const road=world.map.nearestRoad(l.x,l.z),safe=world.map.resolve(road.x,road.z,1.2,road.x,road.z);
  Object.assign(game.player,road,{x:safe.x,z:safe.z,speed:0,steer:0,moveDir:road.heading});game.boost=0;game.drift=0;
  const y=world.ground(road.x,road.z);cameraPos.set(road.x-Math.sin(road.heading)*9,y+4.2,road.z-Math.cos(road.heading)*9);cameraTarget.set(road.x,y+1.2,road.z);lookYaw=0;
  toast(`抵达${l.title} · 可以自由驾驶，或按P拍明信片`);
}

function updateCamera(dt){
  const p=game.player,ground=world.ground(p.x,p.z);
  if(screen==='menu'||screen==='album'||screen==='map'){
    const sway=reducedMotion?0:Math.sin(elapsedVisual*.07)*.9;
    desired.set(-4550+sway*10,285,-1340);target.set(-3740,20,-670);
  }else if(screen==='photo'){
    const yaw=p.heading+lookYaw;
    desired.set(p.x-Math.sin(yaw)*photoDistance,ground+1.4+lookPitch*photoDistance,p.z-Math.cos(yaw)*photoDistance);target.set(p.x,ground+1.1,p.z);
    if(photoLandmark&&!drag){const l=photoLandmark;target.set(l.look[0],l.look[1],l.look[2]);}
  }else{
    const yaw=p.heading+lookYaw;
    const distance=view===1?14:view===2?4.7:coarse?11:8.8;
    const height=view===1?17:view===2?2.15:coarse?5.1:3.4+lookPitch*2;
    desired.set(p.x-Math.sin(yaw)*distance,ground+height,p.z-Math.cos(yaw)*distance);
    target.set(p.x+Math.sin(p.moveDir)*5,ground+1.2,p.z+Math.cos(p.moveDir)*5);
    if(!drag)lookYaw*=Math.exp(-dt*1.8);
  }
  const blend=reducedMotion?1:1-Math.exp(-dt*(view===2?9:6));cameraPos.lerp(desired,blend);cameraTarget.lerp(target,blend);
  world.camera.position.copy(cameraPos);world.camera.lookAt(cameraTarget);
  const fov=screen==='menu'?48:screen==='photo'?47:52+(!reducedMotion?Math.abs(p.speed)/23*5+(game.boost>0?5:0):0);
  world.camera.fov+=(fov-world.camera.fov)*(1-Math.exp(-dt*3));world.camera.updateProjectionMatrix();
}
function updateGhost(){
  const frames=saved.ghost;world.ghost.visible=game.mode==='time'&&game.phase==='driving'&&frames.length>1&&game.elapsed<=frames[frames.length-1][0];
  if(!world.ghost.visible)return;
  let i=Math.min(frames.length-2,Math.max(0,Math.floor(game.elapsed*10)-1));
  while(i<frames.length-2&&frames[i+1][0]<game.elapsed)i++;
  while(i>0&&frames[i][0]>game.elapsed)i--;
  const a=frames[i],b=frames[i+1],t=clamp((game.elapsed-a[0])/(b[0]-a[0]||1),0,1);
  world.ghost.position.set(a[1]+(b[1]-a[1])*t,world.ground(a[1],a[2])+.14,a[2]+(b[2]-a[2])*t);world.ghost.rotation.y=a[3]+angleDelta(a[3],b[3])*t;
}
function tick(now){
  requestAnimationFrame(tick);const raw=(now-last)/1000;last=now;if(document.hidden)return;
  const dt=Math.min(.1,raw);elapsedVisual+=dt;
  if(screen==='playing'){const controls=autoGas&&!input.down?{...input,up:true}:input;game.advance(dt,controls);consumeEvents();}
  if(screen==='playing'&&game.phase==='countdown'){show('countdown',true);$('countdown').textContent=Math.max(1,Math.ceil(game.countdown));}
  else show('countdown',false);
  const active=screen==='playing'&&(game.boost>0||input.boost&&game.nitro>0);document.body.classList.toggle('boosting',!!active);
  world.renderer.info.reset();updateCamera(dt);const near=nearest(game.player.x,game.player.z);world.update(game,elapsedVisual,dt,near.s);updateGhost();
  world.renderer.render(world.scene,world.camera);renderAudio();uiClock+=dt;
  if(uiClock>.08&&screen==='playing'){uiClock=0;updateHUD();}
  if(raw>0&&raw<1){telemetry.frames.push(raw*1000);if(telemetry.frames.length>600)telemetry.frames.shift();}
}
const keyMap={w:'up',arrowup:'up',s:'down',arrowdown:'down',a:'left',arrowleft:'left',d:'right',arrowright:'right',shift:'drift',' ':'boost'};
addEventListener('keydown',e=>{
  if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;
  const k=e.key.toLowerCase();if(keyMap[k]&&screen==='playing'){e.preventDefault();input[keyMap[k]]=true;initAudio();}
  if(e.repeat)return;
  if(k==='enter'){if(screen==='menu'&&e.target.tagName!=='BUTTON')start();else if(screen==='paused')resume();else if(screen==='result'&&e.target.tagName!=='BUTTON')start();}
  if(k==='escape'){if(screen==='photo')closePhoto();else if(screen==='paused')resume();else if(screen==='playing')pause();else if(screen==='album'){setScreen('menu');updateMenu();}else if(screen==='map')closeMap();}
  if(k==='r'&&screen==='playing')game.rescue();
  if(k==='c'&&screen==='playing'){view=(view+1)%3;lookYaw=0;toast(['跟随镜头','俯瞰镜头','低机位镜头'][view]);}
  if(k==='tab'&&(screen==='playing'||screen==='map')){e.preventDefault();screen==='map'?closeMap():openMap();}if(k==='p'&&screen==='playing')openPhoto();if(k==='m')toggleSound();
});
addEventListener('keyup',e=>{if(keyMap[e.key.toLowerCase()])input[keyMap[e.key.toLowerCase()]]=false;});
addEventListener('blur',()=>{clearInput();pause();renderAudio();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInput();pause();renderAudio();}last=performance.now();});
$('game').addEventListener('pointerdown',e=>{if(screen==='playing'||screen==='photo'){drag={id:e.pointerId,x:e.clientX,y:e.clientY};$('game').setPointerCapture(e.pointerId);}});
$('game').addEventListener('pointermove',e=>{if(drag?.id!==e.pointerId)return;lookYaw-=(e.clientX-drag.x)*.007;lookPitch=clamp(lookPitch-(e.clientY-drag.y)*.003,.04,1.3);drag.x=e.clientX;drag.y=e.clientY;});
for(const type of ['pointerup','pointercancel','lostpointercapture'])$('game').addEventListener(type,()=>drag=null);
$('game').addEventListener('wheel',e=>{if(screen==='photo'){e.preventDefault();photoDistance=clamp(photoDistance+e.deltaY*.012,4,35);}},{passive:false});
document.querySelectorAll('[data-input]').forEach(b=>{
  b.addEventListener('pointerdown',e=>{e.preventDefault();input[b.dataset.input]=true;b.classList.add('held');b.setPointerCapture(e.pointerId);initAudio();});
  for(const t of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(t,()=>{input[b.dataset.input]=false;b.classList.remove('held');});
});
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>selectMode(b.dataset.mode));
$('rescue').onclick=()=>{resume();game.rescue();};$('start').onclick=()=>start();$('resume').onclick=resume;$('pause').onclick=pause;$('restart').onclick=()=>start();$('toMenu').onclick=goMenu;$('again').onclick=()=>start();$('explore').onclick=()=>start('tour');$('resultMenu').onclick=goMenu;
$('sound').onclick=toggleSound;$('camera').onclick=()=>{view=(view+1)%3;lookYaw=0;toast(['跟随镜头','俯瞰镜头','低机位镜头'][view]);};$('photo').onclick=openPhoto;$('savePhoto').onclick=savePhoto;$('closePhoto').onclick=closePhoto;
$('mapOpen').onclick=openMap;$('menuMap').onclick=openMap;$('mapClose').onclick=closeMap;$('albumOpen').onclick=album;$('albumClose').onclick=()=>{setScreen('menu');updateMenu();};$('retry').onclick=()=>location.reload();
$('quality').value=saved.quality;$('quality').onchange=()=>{saved.quality=$('quality').value;world?.setQuality(saved.quality);telemetry.quality=saved.quality;persist();};
$('autoGas').onchange=()=>autoGas=$('autoGas').checked;
addEventListener('resize',()=>{if(world){world.camera.aspect=innerWidth/innerHeight;world.camera.updateProjectionMatrix();world.renderer.setSize(innerWidth,innerHeight);}});
// Real browser tests can read state. Production includes no teleport or win shortcut.
window.__paris={getState:()=>({screen,phase:game.phase,mode:game.mode,elapsed:game.elapsed,countdown:game.countdown,player:{...game.player},rivals:game.rivals.map(r=>({...r})),coins:game.coins.filter(c=>c.collected).length,stamps:[...game.stamps],savedStamps:[...saved.stamps],score:game.score,drift:game.driftTotal,nitro:game.nitro,input:{...input},view,ghostVisible:world?.ghost.visible,assets:world?.assetCount,city:world?{blocks:world.reference.solidBlocks.length,bridges:world.map.bridges.length,riverMeters:world.map.plan.stats.riverLen,roadSegments:world.map.roads.length,ground:world.ground(game.player.x,game.player.z),modules:world.reference.report}:null,telemetry:{loadMs:telemetry.loadMs,quality:telemetry.quality,frameCount:telemetry.frames.length,medianMs:[...telemetry.frames].sort((a,b)=>a-b)[Math.floor(telemetry.frames.length/2)],p95Ms:[...telemetry.frames].sort((a,b)=>a-b)[Math.floor(telemetry.frames.length*.95)],calls:world?.renderer.info.render.calls,triangles:world?.renderer.info.render.triangles,errors:telemetry.pageErrors}})};
try{
  const begin=performance.now();world=await createWorld($('game'),(done,total)=>{$('loadText').textContent=`铺开巴黎街头 · ${done}/${total}`;$('loadBar').style.width=(done/total*100)+'%';},saved.quality);
  telemetry.loadMs=performance.now()-begin;cameraPos.set(-4550,285,-1340);cameraTarget.set(-3740,20,-670);world.camera.position.copy(cameraPos);world.camera.lookAt(cameraTarget);
  updateSoundButton();selectMode('race');setScreen('menu');show('loading',false);last=performance.now();requestAnimationFrame(tick);
  $('game').addEventListener('webglcontextlost',e=>{e.preventDefault();pause();toast('图形暂时中断，正在恢复。');});
  $('game').addEventListener('webglcontextrestored',()=>toast('图形已恢复，可以继续旅程。'));
}catch(e){console.error(e);$('loadText').textContent='街区暂时没能加载，请检查浏览器是否支持WebGL，再试一次。';show('retry',true);telemetry.pageErrors.push(e.message);}
