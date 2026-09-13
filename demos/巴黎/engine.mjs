// The simulation owns time and progress. Rendering never changes race results.
export const STEP = 1 / 60;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
export const route = [];
function line(x, z, bx, bz) {
  const n = Math.ceil(Math.hypot(bx - x, bz - z) / 2);
  for (let i = 0; i < n; i++) route.push({x: x + (bx - x) * i / n, z: z + (bz - z) * i / n});
}
function arc(x, z, from, to) {
  for (let i = 0; i < 16; i++) {
    const a = from + (to - from) * i / 16;
    route.push({x: x + Math.cos(a) * 15, z: z + Math.sin(a) * 15});
  }
}
line(0, 0, 0, -119); arc(15, -119, Math.PI, Math.PI * 1.5);
line(15, -134, 113, -134); arc(113, -119, Math.PI * 1.5, Math.PI * 2);
line(128, -119, 128, 9); arc(113, 9, 0, Math.PI / 2);
line(113, 24, 15, 24); arc(15, 9, Math.PI / 2, Math.PI);
line(0, 9, 0, 0);
let distance = 0;
route.forEach((p, i) => {
  const b = route[(i + 1) % route.length];
  p.s = distance; p.len = Math.hypot(b.x - p.x, b.z - p.z);
  p.dx = (b.x - p.x) / p.len; p.dz = (b.z - p.z) / p.len;
  p.heading = Math.atan2(p.dx, p.dz); distance += p.len;
});
export let TRACK_LENGTH = distance;
export let cityEnvironment = null;
export function configureCity(points, landmarks, environment) {
  route.length=0;
  points.forEach((p,i)=>{const b=points[(i+1)%points.length];line(p.x,p.z,b.x,b.z);});
  distance=0;
  route.forEach((p,i)=>{const b=route[(i+1)%route.length];p.s=distance;p.len=Math.hypot(b.x-p.x,b.z-p.z);p.dx=(b.x-p.x)/p.len;p.dz=(b.z-p.z)/p.len;p.heading=Math.atan2(p.dx,p.dz);distance+=p.len;});
  TRACK_LENGTH=distance;GATES.splice(0,GATES.length,...Array.from({length:8},(_,i)=>sample(distance*(i+1)/8)));
  LANDMARKS.splice(0,LANDMARKS.length,...landmarks);cityEnvironment=environment;
}
export function sample(s, offset = 0) {
  s = ((s % distance) + distance) % distance;
  const p = route.find(p => p.s + p.len > s) || route[0];
  return {x: p.x + p.dx * (s - p.s) - p.dz * offset, z: p.z + p.dz * (s - p.s) + p.dx * offset, heading: p.heading, s};
}
export function nearest(x, z) {
  let best = {distance: Infinity};
  for (const p of route) {
    const along = clamp((x - p.x) * p.dx + (z - p.z) * p.dz, 0, p.len);
    const px = p.x + p.dx * along, pz = p.z + p.dz * along;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.distance) best = {x: px, z: pz, s: p.s + along, heading: p.heading, distance: d};
  }
  return best;
}
export const GATES = Array.from({length: 8}, (_, i) => sample(distance * (i + 1) / 8));
export const LANDMARKS = [
  {id:'cafe', title:'街角咖啡', french:'LE CAFÉ', s:37, story:'拐过街角，给旅途留一点空白。', eye:[-10,3,9], look:[-15,2,0]},
  {id:'tower', title:'铁塔来信', french:'LA TOUR EIFFEL', s:111, story:'追着落日，终于来到铁塔脚下。', eye:[12,4,18], look:[-8,27,-38]},
  {id:'river', title:'塞纳河风', french:'AU BORD DE LA SEINE', s:326, story:'把车窗摇下来，听一会儿河边的风。', eye:[-12,6,16], look:[18,4,-20]},
  {id:'arc', title:'凯旋归来', french:'LE GRAND RETOUR', s:449, story:'绕了一圈巴黎，带回四张明信片。', eye:[10,3,13], look:[5,11,-18]},
].map(l => ({...l, ...sample(l.s)}));

function car(lane = 0, back = 0) {
  const p=sample(-back,lane);return {...p, speed:0, moveDir:p.heading, steer:0, nextGate:0, lap:0, finished:false, finishTime:0, progress:0};
}
export class Game {
  constructor() { this.mode = 'race'; this.reset(); }
  reset(mode = this.mode) {
    this.mode=mode; this.phase='menu'; this.resumePhase=null; this.accumulator=0; this.elapsed=0; this.countdown=3;
    this.player=car(); this.rivals=[car(-3,5),car(3,9),car(-3,14)];
    this.coins = Array.from({length:24}, (_,i)=>({...sample(18+i*(distance-25)/24, Math.sin(i*.8)*2.5), collected:false}));
    this.stamps=new Set(); this.score=0; this.drift=0; this.driftTotal=0; this.boost=0; this.nitro=0.38;
    this.combo=0; this.comboTimer=0; this.rescues=0; this.hits=0; this.hitCooldown=0;
    this.events=[]; this.ghost=[]; this.recordTimer=0; this.started=false;
  }
  start(mode = this.mode) {
    this.reset(mode); this.started=true; this.phase=mode==='tour'?'driving':'countdown';
    this.emit(mode==='tour'?'tour':'countdown',3);
  }
  emit(type, value) { this.events.push({type,value}); }
  pause() { if (['countdown','driving'].includes(this.phase)) {this.resumePhase=this.phase;this.phase='paused';this.accumulator=0;} }
  resume() { if (this.phase==='paused') {this.phase=this.resumePhase;this.resumePhase=null;this.accumulator=0;} }
  advance(dt,input={}) {
    this.accumulator+=dt;
    while(this.accumulator+1e-9>=STEP) { this.step(STEP,input);this.accumulator-=STEP; }
  }
  rescue() {
    if(this.phase!=='driving')return;
    const p=this.player, safe=this.mode==='tour'&&cityEnvironment?cityEnvironment.nearestRoad(p.x,p.z):sample(this.mode==='tour'?nearest(p.x,p.z).s:p.nextGate===0?0:GATES[p.nextGate-1].s+3);
    Object.assign(p,safe,{speed:0,moveDir:safe.heading,steer:0});
    this.drift=0;this.boost=0;this.combo=0;this.rescues++;if(this.mode!=='tour')this.elapsed+=3;this.emit('rescue');
  }
  step(dt,input) {
    if(this.phase==='countdown') {
      const old=Math.ceil(this.countdown);this.countdown=Math.max(0,this.countdown-dt);
      if(this.countdown<1e-8){this.phase='driving';this.emit('go');}
      else if(Math.ceil(this.countdown)!==old)this.emit('countdown',Math.ceil(this.countdown));
      return;
    }
    if(this.phase!=='driving')return;
    this.elapsed+=dt;this.comboTimer=Math.max(0,this.comboTimer-dt);this.hitCooldown=Math.max(0,this.hitCooldown-dt);
    if(!this.comboTimer)this.combo=0;
    const p=this.player, oldX=p.x, oldZ=p.z;
    const throttle=input.up?1:input.down?-1:0, turn=(input.left?1:0)-(input.right?1:0);
    const drifting=!!(input.drift&&turn&&p.speed>7);
    const manualBoost=!!(input.boost&&this.nitro>0&&p.speed>3);
    this.boost=Math.max(0,this.boost-dt);
    if(manualBoost)this.nitro=Math.max(0,this.nitro-dt*.35);
    const top=this.boost>0||manualBoost?34:23;
    if(throttle>0)p.speed+=19*dt;
    else if(throttle<0)p.speed-=(p.speed>0?39:12)*dt;
    else p.speed*=Math.exp(-1.25*dt);
    if(this.boost>0||manualBoost)p.speed+=16*dt;
    p.speed=clamp(p.speed,-8,top);
    p.steer+=(turn-p.steer)*(1-Math.exp(-12*dt));
    p.heading+=p.steer*(drifting?2.3:1.65)*clamp(Math.abs(p.speed)/7,0,1)*Math.sign(p.speed)*dt;
    p.moveDir+=angleDelta(p.moveDir,p.heading)*(1-Math.exp(-(drifting?3.0:11)*dt));
    p.x+=Math.sin(p.moveDir)*p.speed*dt;p.z+=Math.cos(p.moveDir)*p.speed*dt;
    const road=cityEnvironment?cityEnvironment.nearestRoad(p.x,p.z):nearest(p.x,p.z);
    if(cityEnvironment){
      const result=cityEnvironment.resolve(p.x,p.z,1.1,oldX,oldZ);
      p.x=result.x;p.z=result.z;
      if(result.hit){p.speed*=.65;if(!this.hitCooldown){this.hits++;this.hitCooldown=1;this.combo=0;this.emit('hit');}}
    }else if(road.distance>11.4) {
      const scale=11.4/road.distance;p.x=road.x+(p.x-road.x)*scale;p.z=road.z+(p.z-road.z)*scale;
      p.speed*=.80;
      if(!this.hitCooldown){this.hits++;this.hitCooldown=1;this.combo=0;this.emit('hit');}
    }
    if(drifting) {this.drift+=dt;this.driftTotal+=dt;}
    else if(this.drift) {
      if(this.drift>.35){const big=this.drift>1.05;this.boost=big?1.5:.75;this.nitro=clamp(this.nitro+(big?.23:.1),0,1);this.combo++;this.comboTimer=5;
        const points=Math.round(this.drift*110)*Math.min(4,this.combo);this.score+=points;this.emit('drift',{big,points,combo:this.combo});}
      this.drift=0;
    }
    if(this.mode==='race')this.rivals.forEach((r,i)=>this.ai(r,i,dt));
    if(this.mode==='race')for(const r of this.rivals) {
      if(r.finished)continue;
      const dx=p.x-r.x,dz=p.z-r.z,d=Math.hypot(dx,dz);
      if(d<2.1){const k=(2.1-d)*.5/(d||1);p.x+=d?dx*k:1;p.z+=dz*k;r.x-=d?dx*k:1;r.z-=dz*k;p.speed*=.97;}
    }
    for(const c of this.coins)if(!c.collected&&Math.hypot(p.x-c.x,p.z-c.z)<2.3){c.collected=true;this.score+=100;this.nitro=clamp(this.nitro+.06,0,1);this.emit('coin');}
    for(const l of LANDMARKS)if(!this.stamps.has(l.id)&&Math.hypot(p.x-l.x,p.z-l.z)<(l.radius||13)){this.stamps.add(l.id);this.score+=300;this.emit('stamp',l);}
    if(this.mode!=='tour') {
      this.rivals.forEach(r=>{if(this.mode==='race')this.progress(r,r.x-Math.sin(r.heading)*r.speed*dt,r.z-Math.cos(r.heading)*r.speed*dt);});
      this.progress(p,oldX,oldZ);
    }
    if(this.mode==='time') {this.recordTimer+=dt;if(this.recordTimer>=.1){this.recordTimer-=.1;this.ghost.push([+this.elapsed.toFixed(2),+p.x.toFixed(2),+p.z.toFixed(2),+p.heading.toFixed(3)]);}}
  }
  ai(r,i,dt) {
    if(r.finished)return;
    const near=nearest(r.x,r.z), target=sample(near.s+8+i,[-2.8,0,2.8][i]+Math.sin(near.s*.025+i)*.35);
    const targetAngle=Math.atan2(target.x-r.x,target.z-r.z);
    const bend=Math.abs(angleDelta(r.heading,targetAngle));
    // Same road, checkpoints and time as the player; no teleporting or hidden rubber-banding.
    const desired=[20.5,18.9,19.8][i]*clamp(1-bend*.38,.65,1);
    r.speed+=(desired-r.speed)*(1-Math.exp(-2*dt));
    r.heading+=angleDelta(r.heading,targetAngle)*(1-Math.exp(-4.5*dt));r.moveDir=r.heading;
    r.x+=Math.sin(r.heading)*r.speed*dt;r.z+=Math.cos(r.heading)*r.speed*dt;
  }
  progress(e,ox,oz) {
    if(e.finished)return;
    const g=GATES[e.nextGate],dx=e.x-ox,dz=e.z-oz,length2=dx*dx+dz*dz;
    const t=length2?clamp(((g.x-ox)*dx+(g.z-oz)*dz)/length2,0,1):0;
    const toward=Math.sin(e.heading)*Math.sin(g.heading)+Math.cos(e.heading)*Math.cos(g.heading);
    if(toward>.1&&Math.hypot(ox+t*dx-g.x,oz+t*dz-g.z)<9.5) {
      e.nextGate++;
      if(e===this.player)this.emit('gate',e.nextGate);
      if(e.nextGate===GATES.length){e.lap++;e.nextGate=0;if(e===this.player)this.emit('lap',e.lap);}
      const laps=this.mode==='time'?1:2;
      if(e.lap>=laps){e.finished=true;e.finishTime=this.elapsed;if(e===this.player){this.phase='finished';this.emit('finish');}}
    }
    const n=nearest(e.x,e.z),prev=e.nextGate===0?0:GATES[e.nextGate-1].s;
    let along=n.s-prev;
    if(e.nextGate===0&&n.s>distance*.75)along-=distance;
    e.progress=e.lap*8+e.nextGate+clamp(along/(distance/8),-.49,.999);
  }
  place() {
    const a=[this.player,...this.rivals].sort((a,b)=>a.finished!==b.finished?(a.finished?-1:1):a.finished?a.finishTime-b.finishTime:b.progress-a.progress);
    return a.indexOf(this.player)+1;
  }
}
