// =====================================================================
// Cielo Vivo · versión 17 · "más real"
//  1. Horizonte con el relieve real (montañas) — Terrain Tiles (AWS / Mapzen, datos SRTM y otros)
//  2. Refracción de la atmósfera (Saemundsson), con temperatura y presión
//  3. Extinción: estrellas más débiles y rojizas cerca del horizonte (masa de aire de Kasten y Young)
//  4. Titileo (centelleo), más fuerte cerca del horizonte; los planetas casi no titilan
//  5. La Luna ilumina el cielo y apaga las estrellas débiles
//  6. Estrellas fugaces de las lluvias reales y meteoros esporádicos
//  7. Cometas y asteroides (elementos orbitales del MPC/JPL)
//  8. Eclipses de Sol y de Luna: simulación y lista de los próximos visibles
//  9. Movimiento suave: brújula + giroscopio (filtro complementario)
// 10. Adaptación de los ojos a la oscuridad en el modo nocturno
// Se carga antes del programa principal y se activa con RLinit().
// =====================================================================

const RL={k:1,kx:0.2,turb:1,kT:0,moonGlow:0,limAdj:0,adapt:0,adaptT0:null,lastRed:false,
  t:0,dt:0.016,lastT:0,moE:null,moDist:60.3,moDistJD:null,lunar:null,solarObsc:0,total:false,rS:0.267,rM:0.26,
  sunCol:[255,246,208],moonCol:null,moonDark:null,meteors:[],boost:1,boostUntil:0,camT:0,chip:null,chipT:0};
const RLtmp={dm:0,col:null,tw:1,rs:1};

// ---------- utilidades ----------
function rlRGB(c){if(Array.isArray(c))return c;if(c[0]==='#'){const n=parseInt(c.slice(1),16);return[n>>16&255,n>>8&255,n&255]}const m=c.match(/\d+/g);return m?m.slice(0,3).map(Number):[255,255,255]}
const rlMix=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
const rlCss=(c,a)=>a==null?`rgb(${c[0]|0},${c[1]|0},${c[2]|0})`:`rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`;
const rlAng=(a,b)=>Math.acos(clamp(dot(a,b),-1,1))*R2D;
function rlHash(x){x=String(x);let h=2166136261;for(let i=0;i<x.length;i++){h^=x.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0)%100000}

// ---------- 2. Refracción ----------
function RLrefr(e){
  if(!S.layers.atm)return e;
  const z=clamp(e[2],-1,1);const h=Math.asin(z)*R2D;if(h<-3||h>89.5)return e;
  const hh=Math.max(h,-1);let R=1.02/Math.tan((hh+10.3/(hh+5.11))*D2R)/60; // grados
  if(h<-1)R*=(h+3)/2;R*=RL.k;
  const h2=(h+R)*D2R,c=Math.cos(h2)/(Math.hypot(e[0],e[1])||1);
  return[e[0]*c,e[1]*c,Math.sin(h2)];
}
// ---------- 3 y 4. Masa de aire, extinción, color y titileo ----------
function rlAirmass(h){h=Math.max(h,-0.5);return Math.min(40,1/(Math.sin(h*D2R)+0.50572*Math.pow(h+6.07995,-1.6364)))}
const RED=[255,140,70],BLU=[150,190,255],SCINR=[255,105,85];
function RLstar(e,s,planet){
  const o=RLtmp;o.dm=0;o.col=null;o.tw=1;o.rs=1;
  if(!S.layers.atm&&!S.layers.twinkle)return o;
  const h=Math.asin(clamp(e[2],-1,1))*R2D;if(h<-1.5)return o;
  const X=rlAirmass(h);let c=null;
  if(S.layers.atm){
    o.dm=RL.kx*(X-1);
    const t=clamp((X-1)/13,0,0.8);if(t>0.03){c=rlMix(s.rgb||(s.rgb=rlRGB(planet?s.c:s.col)),RED,t)}
  }
  if(S.layers.twinkle){
    const seed=s.i!=null?s.i:(s.seed||(s.seed=rlHash(s.id||s.n)));
    let A=clamp(0.055*Math.pow(X,0.85)*RL.turb,0,0.6);if(planet)A*=0.12;
    const t=RL.t;
    const w=0.55*Math.sin(t*(9+seed%7)+seed)+0.3*Math.sin(t*(17+seed%11)+seed*1.7)+0.15*Math.sin(t*(31+seed%13)+seed*2.3);
    o.tw=1+A*w;o.rs=Math.sqrt(Math.max(0.3,o.tw));
    if(!planet&&s.mag<1.8&&X>2&&A>0.1){ // destellos de colores de las estrellas brillantes bajas
      const q=Math.sin(t*23+seed*0.7)*Math.sin(t*7.3+seed);
      c=rlMix(c||s.rgb||(s.rgb=rlRGB(s.col)),q>0?BLU:SCINR,Math.min(0.45,Math.abs(q)*A*1.6));
    }
  }
  if(c)o.col=rlCss(c);
  return o;
}

// ---------- 1. Relieve real ----------
const TERR={z:10,prof:null,raw:null,lat:null,lon:null,h0:null,loading:false,err:null,tries:0,R:50000,src:''};
function RLterrainEnsure(){
  if(!S.layers.relief||TERR.loading)return;
  const lat=S.lat,lon=S.lon;
  if(TERR.lat!=null&&Math.hypot((lat-TERR.lat)*111,(lon-TERR.lon)*111*Math.cos(lat*D2R))<1.5)return;
  if(TERR.err&&performance.now()-TERR.err<60000&&TERR.errLat===lat.toFixed(2)+','+lon.toFixed(2))return;
  rlLoadTerrain(lat,lon);
}
function rlTile(z,x,y){return new Promise(ok=>{const im=new Image();im.crossOrigin='anonymous';im.onload=()=>ok(im);im.onerror=()=>ok(null);
  im.src=`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;setTimeout(()=>ok(null),20000)})}
async function rlLoadTerrain(lat,lon){
  TERR.loading=true;const z=TERR.z,n=2**z;
  const c=merc(lat,lon,z);const mpp=156543.03392*Math.cos(lat*D2R)/n;const rad=TERR.R/mpp+2;
  const tx0=Math.floor((c.x-rad)/256),tx1=Math.floor((c.x+rad)/256),ty0=Math.floor((c.y-rad)/256),ty1=Math.floor((c.y+rad)/256);
  const nx=tx1-tx0+1,ny=ty1-ty0+1;const cv=document.createElement('canvas');cv.width=nx*256;cv.height=ny*256;const g=cv.getContext('2d',{willReadFrequently:true});
  const jobs=[];let ok=0;
  for(let ty=ty0;ty<=ty1;ty++)for(let tx=tx0;tx<=tx1;tx++){const X=((tx%n)+n)%n;if(ty<0||ty>=n)continue;
    jobs.push(rlTile(z,X,ty).then(im=>{if(im){g.drawImage(im,(tx-tx0)*256,(ty-ty0)*256);ok++}}))}
  await Promise.all(jobs);
  if(ok<jobs.length*0.6){TERR.loading=false;TERR.err=performance.now();TERR.errLat=lat.toFixed(2)+','+lon.toFixed(2);return}
  let px;try{px=g.getImageData(0,0,cv.width,cv.height).data}catch(e){TERR.loading=false;TERR.err=performance.now();TERR.errLat=lat.toFixed(2)+','+lon.toFixed(2);return}
  const Wd=cv.width,Hd=cv.height;const el=new Float32Array(Wd*Hd);
  for(let i=0,j=0;i<el.length;i++,j+=4)el[i]=px[j+3]<200?NaN:(px[j]*256+px[j+1]+px[j+2]/256)-32768;
  const ox=c.x-tx0*256,oy=c.y-ty0*256;
  const samp=(x,y)=>{if(x<0||y<0||x>=Wd-1||y>=Hd-1)return NaN;const x0=x|0,y0=y|0,fx=x-x0,fy=y-y0,i=y0*Wd+x0;
    return el[i]*(1-fx)*(1-fy)+el[i+1]*fx*(1-fy)+el[i+Wd]*(1-fx)*fy+el[i+Wd+1]*fx*fy};
  let h0=samp(ox,oy);if(!isFinite(h0))h0=0;
  const eye=2,Re=6371000,kref=0.13,prof=new Float32Array(720);
  for(let k=0;k<720;k++){const az=k*0.5*D2R,sx=Math.sin(az)/mpp,sy=-Math.cos(az)/mpp;let best=-90;
    for(let d=250;d<=TERR.R;d*=1.012){const hs=samp(ox+sx*d,oy+sy*d);if(!isFinite(hs))continue;
      const a=Math.atan((hs-h0-eye)/d)-d*(1-kref)/(2*Re);if(a>best)best=a}
    prof[k]=best*R2D}
  // suavizado leve (±0,5°) para que no tiemble el borde
  const sm=new Float32Array(720);for(let k=0;k<720;k++)sm[k]=(prof[(k+719)%720]+2*prof[k]+prof[(k+1)%720])/4;
  TERR.prof=sm;TERR.h0=h0;TERR.lat=lat;TERR.lon=lon;TERR.loading=false;TERR.err=null;
  if(typeof GCACHE!=='undefined')GCACHE.key='';
}
function RLhzRaw(az){const P=TERR.prof;if(!P||!S.layers.relief)return 0;const f=norm360(az)*2,i=f|0,t=f-i;return P[i%720]*(1-t)+P[(i+1)%720]*t}
function RLhz(az){return Math.max(0,RLhzRaw(az))}
function RLterrain(dayF){
  if(!TERR.prof||!S.layers.relief)return;
  const col=S.ar?null:rlCss(rlMix([9,14,13],[78,98,112],dayF),0.97);
  ctx.save();ctx.beginPath();let any=false;const edge=[];
  for(let k=0;k<720;k++){const az0=k*0.5,az1=az0+0.5;const h0=Math.max(0,TERR.prof[k]),h1=Math.max(0,TERR.prof[(k+1)%720]);
    if(h0<0.02&&h1<0.02)continue;
    const a=project(altaz2v(h0,az0)),b=project(altaz2v(h1,az1)),c=project(altaz2v(-0.4,az1)),d=project(altaz2v(-0.4,az0));
    if(!a||!b||!c||!d||a.cz<-0.3||b.cz<-0.3)continue;
    if(!inScr(a)&&!inScr(b)&&!inScr(c)&&!inScr(d))continue;
    ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineTo(c.x,c.y);ctx.lineTo(d.x,d.y);ctx.closePath();any=true;edge.push([a,b])}
  if(any&&col){ctx.fillStyle=col;ctx.fill()}
  if(edge.length){ctx.strokeStyle=S.ar?'rgba(160,255,190,.55)':`rgba(${dayF>0.5?'210,230,220':'120,160,140'},.55)`;ctx.lineWidth=1;ctx.beginPath();for(const [a,b] of edge){ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y)}ctx.stroke()}
  ctx.restore();
}
// cuándo sale o se pone un astro detrás del relieve
function RLterrainCross(key,j0,j1,rising,limb){
  let prev=null;const step=2/1440;
  for(let jd=j0;jd<=j1;jd+=step){const a=altAzOf(key,jd);const app=v2altaz(RLrefr(altaz2v(a.alt,a.az))).alt+(limb||0);const d=app-RLhzRaw(a.az);
    if(prev!=null&&(rising?(prev<0&&d>=0):(prev>0&&d<=0)))return jd;prev=d}
  return null;
}

// ---------- 5. Luz de la Luna, crepúsculo y eclipses (cálculos por cuadro) ----------
function rlTopoMoon(enu,dist){const a=v2altaz(enu);const par=Math.asin(1/dist)*R2D;return altaz2v(a.alt-par*Math.cos(a.alt*D2R),a.az)}
function rlOverlap(r1,r2,d){ // fracción del disco 1 tapada por el disco 2
  if(d>=r1+r2)return 0;if(d<=Math.abs(r2-r1))return r2>=r1?1:(r2*r2)/(r1*r1);
  const A=r1*r1*Math.acos(clamp((d*d+r1*r1-r2*r2)/(2*d*r1),-1,1))+r2*r2*Math.acos(clamp((d*d+r2*r2-r1*r1)/(2*d*r2),-1,1))-0.5*Math.sqrt(Math.max(0,(-d+r1+r2)*(d+r1-r2)*(d-r1+r2)*(d+r1+r2)));
  return A/(Math.PI*r1*r1);
}
function rlShadow(moGeoV,dist,sunDateV,sunR){ // sombra de la Tierra (radios en grados)
  const pm=Math.asin(1/dist)*R2D,ps=8.794/3600/sunR,ss=0.2666/sunR,sm=0.2725*pm;
  return{U:1.02*(pm+ps-ss),Pn:1.02*(pm+ps+ss),sm,sep:rlAng(moGeoV,[-sunDateV[0],-sunDateV[1],-sunDateV[2]])};
}
function RLpre(P,Hm,M,sunE,sun,dayF){
  const now=performance.now();RL.dt=RL.lastT?Math.min(0.25,(now-RL.lastT)/1000):0.016;RL.lastT=now;RL.t=now/1000;
  if(now-RL.kT>3000){RL.kT=now;const w=S.layers.wx&&typeof wxAt==='function'?wxAt(S.jd):null;const ok=w&&!w.out;
    const T=ok&&isFinite(w.temp)?w.temp:15,Pr=1010*Math.exp(-(TERR.h0||0)/8430);RL.k=(Pr/1010)*(283/(273+T));
    RL.kx=0.2+(ok?(w.hum>85?0.1:w.hum>65?0.05:0)+(w.vis<10?0.1:0):0.03)-((TERR.h0||0)>1200?0.03:0);
    RL.turb=ok&&isFinite(w.wind)?clamp(0.8+w.wind/40,0.8,1.8):1}
  RLterrainEnsure();
  // Luna
  const mo=moonVecOfDate(S.jd);RL.moDist=mo.dist;RL.moDistJD=S.jd;
  const moGeoE=mv(Hm,mo.v),moT=rlTopoMoon(moGeoE,mo.dist);RL.moE=RLrefr(moT);
  const sunDate=mv(P,sun.v);const il=(1-dot(mo.v,sunDate))/2;
  const moAlt=v2altaz(RL.moE).alt;
  // eclipse de Luna
  const sh=rlShadow(mo.v,mo.dist,sunDate,sun.r);RL.lunar=null;
  if(sh.sep<sh.Pn+sh.sm){const anti=mv(Hm,[-sunDate[0],-sunDate[1],-sunDate[2]]);
    const c=vnorm([moT[0]+anti[0]-moGeoE[0],moT[1]+anti[1]-moGeoE[1],moT[2]+anti[2]-moGeoE[2]]);
    RL.lunar={...sh,c:RLrefr(c),depth:(sh.U+sh.sm-sh.sep)/(2*sh.sm),pdepth:(sh.Pn+sh.sm-sh.sep)/(2*sh.sm)}}
  // eclipse de Sol (topocéntrico)
  RL.rS=0.2666/sun.r;RL.rM=0.2725*Math.asin(1/mo.dist)*R2D*(1+Math.max(0,moT[2])/mo.dist);
  const sepS=rlAng(moT,sunE);RL.solarObsc=sepS<RL.rS+RL.rM?rlOverlap(RL.rS,RL.rM,sepS):0;RL.total=RL.rM>=RL.rS&&sepS<RL.rM-RL.rS;RL.sepS=sepS;
  if(RL.solarObsc>0&&S.layers.day)dayF*=RL.total?0.07:(1-0.85*Math.pow(RL.solarObsc,5));
  // brillo del cielo por la Luna
  let mg=S.layers.day?Math.pow(il,1.6)*clamp((moAlt+2)/25,0,1)*(1-dayF):0;
  if(RL.lunar)mg*=1-0.92*clamp(RL.lunar.depth,0,1);RL.moonGlow=mg;
  // colores del Sol y la Luna según la masa de aire
  const sAlt=v2altaz(RLrefr(sunE)).alt;const Xs=rlAirmass(sAlt);
  RL.sunCol=S.layers.atm?rlMix([255,246,208],[255,105,35],Math.pow(clamp((Xs-1)/28,0,1),0.55)):[255,246,208];
  const Xm=rlAirmass(moAlt);let mc=S.layers.atm?rlMix([244,241,228],[255,170,110],Math.pow(clamp((Xm-1)/28,0,1),0.6)):[244,241,228];
  RL.moonCol=rlCss(mc);RL.moonDark=RL.solarObsc>0?'#07080c':null;
  // 10. adaptación a la oscuridad
  if(S.layers.red&&!RL.lastRed){RL.adaptT0=now;toast('👁️ Modo nocturno: tus ojos se van adaptando y en unos minutos vas a ver más estrellas débiles',4500)}
  if(!S.layers.red)RL.adaptT0=null;RL.lastRed=S.layers.red;
  RL.adapt=RL.adaptT0!=null&&dayF<0.5?(-0.6+1.4*(1-Math.exp(-(now-RL.adaptT0)/90000)))*(1-dayF):0;
  rlAdaptChip(now);
  RL.limAdj=-2.2*mg+RL.adapt;
  if(RL.boost>1&&now>RL.boostUntil)RL.boost=1;
  return dayF;
}
function rlAdaptChip(now){
  if(!RL.chip){const d=document.createElement('div');d.id='adaptChip';d.style.cssText='position:fixed;left:10px;bottom:84px;z-index:6;background:rgba(20,10,10,.75);color:#ffb3a8;font:600 12px system-ui;padding:5px 9px;border-radius:12px;display:none;pointer-events:none';document.body.appendChild(d);RL.chip=d}
  if(now-RL.chipT<1000)return;RL.chipT=now;
  if(RL.adaptT0==null){RL.chip.style.display='none';return}
  const p=Math.round(100*(1-Math.exp(-(now-RL.adaptT0)/90000)));
  if(p>=99){RL.chip.style.display='none';return}
  RL.chip.style.display='block';RL.chip.textContent=`👁️ Adaptación a la oscuridad ${p}%`;
}
function RLskyColors(top,bot,sunE,dayF){
  if(RL.moonGlow>0.01){const t=RL.moonGlow*0.85;top=rlMix(top,[24,38,74],t);bot=rlMix(bot,[40,58,96],t)}
  return[top,bot];
}
function RLtwilight(sunE,dayF){ // resplandor anaranjado del lado del Sol al amanecer y al atardecer
  if(S.ar||!S.layers.day||!S.layers.atm)return;const a=v2altaz(sunE);if(a.alt<-14||a.alt>10)return;
  const s=Math.exp(-Math.pow((a.alt+3)/6,2))*(RL.solarObsc>0.9?0.2:1);if(s<0.02)return;
  const p=project(altaz2v(RLhz(a.az),a.az));if(!p)return;const R=65*D2R*scale;
  ctx.save();ctx.globalCompositeOperation='lighter';
  const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,R);g.addColorStop(0,`rgba(255,120,50,${0.5*s})`);g.addColorStop(0.35,`rgba(255,150,80,${0.22*s})`);g.addColorStop(1,'rgba(255,150,80,0)');
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);ctx.restore();
}
function RLmoonHalo(){
  if(RL.moonGlow<0.02||!RL.moE)return;const p=project(RL.moE);if(!p)return;const R=22*D2R*scale;
  ctx.save();ctx.globalCompositeOperation='lighter';const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,R);
  g.addColorStop(0,`rgba(190,205,240,${0.28*RL.moonGlow})`);g.addColorStop(0.25,`rgba(150,170,220,${0.1*RL.moonGlow})`);g.addColorStop(1,'rgba(150,170,220,0)');
  ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,R,0,7);ctx.fill();ctx.restore();
}
// achatamiento del Sol y la Luna cerca del horizonte
function RLsquash(eTrue,rDeg){
  if(!S.layers.atm)return null;const a=v2altaz(eTrue);if(a.alt>12||a.alt<-2.5)return null;
  const t=project(RLrefr(altaz2v(a.alt+rDeg,a.az))),b=project(RLrefr(altaz2v(a.alt-rDeg,a.az)));
  const t0=project(altaz2v(a.alt+rDeg,a.az)),b0=project(altaz2v(a.alt-rDeg,a.az));if(!t||!b||!t0||!b0)return null;
  const dA=Math.hypot(t.x-b.x,t.y-b.y),dT=Math.hypot(t0.x-b0.x,t0.y-b0.y);if(dT<0.3||dA<0.1)return null;
  return{f:clamp(dA/dT,0.6,1),ux:(t.x-b.x)/dA,uy:(t.y-b.y)/dA};
}
function RLwithSquash(p,sq,fn){
  if(!sq||sq.f>0.995){fn();return}
  const k=1-sq.f,a=1-k*sq.ux*sq.ux,b=-k*sq.ux*sq.uy,d=1-k*sq.uy*sq.uy;
  ctx.save();ctx.translate(p.x,p.y);ctx.transform(a,b,b,d,0,0);ctx.translate(-p.x,-p.y);fn();ctx.restore();
}
function RLdrawSun(p,r){
  const c=RL.sunCol;
  if(RL.total){ // corona solar
    const g=ctx.createRadialGradient(p.x,p.y,r*0.9,p.x,p.y,r*4.5);g.addColorStop(0,'rgba(245,245,255,.85)');g.addColorStop(0.3,'rgba(220,230,255,.3)');g.addColorStop(1,'rgba(200,210,255,0)');
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,r*4.5,0,7);ctx.fill();
    ctx.strokeStyle='rgba(235,240,255,.35)';ctx.lineWidth=1;for(let i=0;i<14;i++){const a=i/14*Math.PI*2+0.3*Math.sin(i*7),L=r*(2+1.6*Math.abs(Math.sin(i*3.1)));ctx.beginPath();ctx.moveTo(p.x+Math.cos(a)*r,p.y+Math.sin(a)*r);ctx.lineTo(p.x+Math.cos(a)*L,p.y+Math.sin(a)*L);ctx.stroke()}
  }else{
    const k=RL.solarObsc>0?1-RL.solarObsc*0.8:1;
    const gg=ctx.createRadialGradient(p.x,p.y,r*0.3,p.x,p.y,r*4);gg.addColorStop(0,rlCss(rlMix(c,[255,240,180],0.3),k));gg.addColorStop(1,rlCss(c,0));
    ctx.fillStyle=gg;ctx.beginPath();ctx.arc(p.x,p.y,r*4,0,7);ctx.fill();
  }
  ctx.fillStyle=rlCss(c);ctx.beginPath();ctx.arc(p.x,p.y,r,0,7);ctx.fill();
  ctx.fillStyle='#ffd27a';ctx.font='600 12px system-ui';ctx.textAlign='left';ctx.fillText(RL.total?'Sol (eclipse total)':RL.solarObsc>0.01?`Sol (eclipse ${Math.round(RL.solarObsc*100)}%)`:'Sol',p.x+r*1.2+4,p.y+4);
}
function RLlunarShadow(p,r){ // sombra de la Tierra sobre la Luna, con su borde curvo
  const L=RL.lunar;if(!L)return;const pc=project(L.c);if(!pc)return;
  const infl=r/(L.sm*D2R*scale),pxd=r/L.sm;
  const cx=p.x+(pc.x-p.x)*infl,cy=p.y+(pc.y-p.y)*infl,U=L.U*pxd,Pn=L.Pn*pxd;
  ctx.save();ctx.beginPath();ctx.arc(p.x,p.y,r,0,7);ctx.clip();
  const g=ctx.createRadialGradient(cx,cy,U,cx,cy,Pn);g.addColorStop(0,'rgba(0,0,0,.38)');g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.fillRect(p.x-r,p.y-r,2*r,2*r);
  const u=ctx.createRadialGradient(cx,cy,0,cx,cy,U);u.addColorStop(0,'rgba(60,12,6,.93)');u.addColorStop(0.8,'rgba(120,35,15,.86)');u.addColorStop(1,'rgba(150,55,25,.75)');
  ctx.fillStyle=u;ctx.beginPath();ctx.arc(cx,cy,U,0,7);ctx.fill();ctx.restore();
}

// ---------- 6. Estrellas fugaces ----------
const MCOL={'Leónidas':[200,255,220],'Perseidas':[230,255,235],'Gemínidas':[255,250,215],'Oriónidas':[215,245,255],'Eta Acuáridas':[215,245,255]};
function rlShowerActivity(s,jd){
  const d=ymdFromJD(jd);let best=0;
  for(const Y of [d.Y-1,d.Y,d.Y+1]){const pk=jdFromYMDh(Y,s[1],s[2],0)+0.25;const w=s[3]>=80?1.3:2.2;best=Math.max(best,Math.exp(-Math.pow((jd-pk)/w,2)))}
  return best;
}
function RLmeteorRates(M,lm){
  const out=[];const fl=Math.pow(2.2,-Math.max(0,6.5-lm));
  for(const s of SHOWERS){const a=rlShowerActivity(s,S.jd);if(a<0.02)continue;const R=mv(M,radec2v(s[4],s[5]));if(R[2]<=0)continue;
    out.push({n:s[0],R,rate:s[3]*a*R[2]*fl})}
  out.push({n:'esporádico',R:null,rate:7*fl});
  return out;
}
function RLmeteors(M,dayF,limMag){
  if(!S.layers.meteors||dayF>0.3||S.site){RL.meteors.length=0;return}
  const dt=RL.dt;
  if(!S.play&&!(typeof ROT!=='undefined'&&ROT.on)){
    for(const r of RLmeteorRates(M,limMag)){if(Math.random()<r.rate*RL.boost/3600*dt)rlSpawn(r)}
  }
  ctx.save();ctx.lineCap='round';
  for(let i=RL.meteors.length-1;i>=0;i--){const m=RL.meteors[i];m.age+=dt;if(m.age>m.D){RL.meteors.splice(i,1);continue}
    const th=m.L*m.age/m.D,thT=Math.max(0,th-m.L*0.45);
    const at=x=>[m.P[0]*Math.cos(x)+m.T[0]*Math.sin(x),m.P[1]*Math.cos(x)+m.T[1]*Math.sin(x),m.P[2]*Math.cos(x)+m.T[2]*Math.sin(x)];
    const hv=at(th),tv=at(thT);const ha=v2altaz(hv);if(ha.alt<RLhz(ha.az)+0.3)continue;
    const ph=project(hv),pt=project(tv);if(!ph||!pt)continue;
    const u=m.age/m.D,a=(u<0.25?u/0.25:Math.pow((1-u)/0.75,0.7))*m.b;const g=ctx.createLinearGradient(pt.x,pt.y,ph.x,ph.y);g.addColorStop(0,rlCss(m.c,0));g.addColorStop(1,rlCss(m.c,Math.min(1,a)));
    ctx.strokeStyle=g;ctx.lineWidth=m.w;ctx.beginPath();ctx.moveTo(pt.x,pt.y);ctx.lineTo(ph.x,ph.y);ctx.stroke();
    ctx.fillStyle=rlCss([255,255,255],Math.min(1,a));ctx.beginPath();ctx.arc(ph.x,ph.y,m.w*0.7,0,7);ctx.fill();
    if(m.lab&&a>0.3){ctx.fillStyle=rlCss([255,240,200],a*0.8);ctx.font='10px system-ui';ctx.fillText(m.lab,ph.x+6,ph.y-6)}
  }
  ctx.restore();
}
function rlSpawn(r){
  let R=r.R;if(!R){const z=Math.random()*1.2-0.2,t=Math.random()*Math.PI*2,q=Math.sqrt(1-z*z);R=[q*Math.cos(t),q*Math.sin(t),z]}
  // punto de inicio a 10–70° del radiante
  const d=(10+Math.random()*60)*D2R,phi=Math.random()*Math.PI*2;
  let a=vnorm(cross(R,Math.abs(R[2])<0.9?[0,0,1]:[1,0,0])),b=cross(R,a);
  const P=vnorm([R[0]*Math.cos(d)+(a[0]*Math.cos(phi)+b[0]*Math.sin(phi))*Math.sin(d),R[1]*Math.cos(d)+(a[1]*Math.cos(phi)+b[1]*Math.sin(phi))*Math.sin(d),R[2]*Math.cos(d)+(a[2]*Math.cos(phi)+b[2]*Math.sin(phi))*Math.sin(d)]);
  if(P[2]<0.05)return;
  const c=dot(R,P);const T=vnorm([P[0]*c-R[0],P[1]*c-R[1],P[2]*c-R[2]]);
  const mag=-1.5+Math.random()*4.5;const fast=r.n==='Leónidas'||r.n==='Perseidas'||r.n==='Oriónidas'||r.n==='Eta Acuáridas';
  RL.meteors.push({P,T,L:(4+Math.random()*14)*D2R*(0.6+0.8*Math.sin(d)),D:(fast?0.25:0.45)+Math.random()*0.6,age:0,b:clamp(1.15-mag*0.2,0.25,1),w:clamp(3.2-mag*0.6,0.8,3.6),
    c:MCOL[r.n]||[255,252,240],lab:mag<-0.5&&r.n!=='esporádico'?r.n:''});
  if(RL.meteors.length>12)RL.meteors.shift();
}
function RLsimShower(s){
  const off=-new Date().getTimezoneOffset()/60;const d=ymdFromJD(S.jd);let Y=d.Y;
  let jd=jdFromYMDh(Y,s[1],s[2],3-off);if(jd<S.jd-3)jd=jdFromYMDh(Y+1,s[1],s[2],3-off);
  if(S.site)leaveSite();S.live=false;S.play=false;S.jd=jd;
  const P=precessionMatrix(jd),M=mmul(horizMatrix(jd,S.lat,S.lon),P);const a=v2altaz(mv(M,radec2v(s[4],s[5])));
  if(!S.sensor){S.az=a.az;S.alt=clamp(Math.max(a.alt-10,30),10,80);S.fov=Math.max(S.fov,110)}
  RL.boost=15;RL.boostUntil=performance.now()+120000;S.layers.meteors=true;
  toast(`☄️ ${s[0]}: noche del máximo a las 3. Por 2 minutos caen 15 veces más meteoros para que veas cómo es. Salen del radiante (${a.alt>0?'a '+Math.round(a.alt)+'° de altura':'bajo el horizonte'}).`,7000);
}
function RLbusy(){return RL.meteors.length>0}
function RLidleMs(){return S.layers.twinkle&&!S.ar?70:400}

// ---------- 7. Cometas y asteroides ----------
// Elementos eclípticos J2000. Asteroides: época 21/11/2025 (MPC, vía in-the-sky.org); Juno: 25/01/2025.
// Cometa Encke: perihelio el 10/02/2027 (MPC / BAA). Magnitudes: H-G para asteroides; H + 5 log Δ + K log r para cometas.
const SMALL=[
  {id:'ceres',n:'Ceres',t:'Planeta enano',a:2.7660,e:0.079576,i:10.59,O:80.25,w:73.30,M0:231.54,ep:2461000.5,H:3.35,G:0.15},
  {id:'vesta',n:'Vesta',t:'Asteroide',a:2.3615,e:0.090167,i:7.14,O:103.70,w:151.54,M0:26.81,ep:2461000.5,H:3.25,G:0.15},
  {id:'pallas',n:'Palas',t:'Asteroide',a:2.7699,e:0.23064,i:34.928,O:172.889,w:310.933,M0:211.53,ep:2461000.5,H:4.11,G:0.15},
  {id:'juno',n:'Juno',t:'Asteroide',a:2.6701,e:0.2562,i:12.99,O:169.83,w:247.84,M0:149.89,ep:2460700.5,H:5.18,G:0.15},
  {id:'encke',n:'Cometa Encke (2P)',t:'Cometa periódico (vuelve cada 3,3 años)',comet:true,q:0.3389,e:0.8471,i:11.35,O:334.02,w:187.28,T:2461446.7,H:10.2,K:9.6}
];
function rlHelioSmall(b,jd){
  const a=b.comet?b.q/(1-b.e):b.a,n=0.9856076686/Math.pow(a,1.5);
  const Mdeg=b.comet?n*(jd-b.T):b.M0+n*(jd-b.ep);const M=norm360(Mdeg)*D2R,E=kepler(M,b.e);
  const xp=a*(Math.cos(E)-b.e),yp=a*Math.sqrt(1-b.e*b.e)*Math.sin(E);
  const w=b.w*D2R,O=b.O*D2R,i=b.i*D2R,cw=Math.cos(w),sw=Math.sin(w),cO=Math.cos(O),sO=Math.sin(O),ci=Math.cos(i),si=Math.sin(i);
  return[(cw*cO-sw*sO*ci)*xp+(-sw*cO-cw*sO*ci)*yp,(cw*sO+sw*cO*ci)*xp+(-sw*sO+cw*cO*ci)*yp,(sw*si)*xp+(cw*si)*yp];
}
function RLsmallPos(b,jd){ // geocéntrico, ecuatorial J2000 + magnitud
  const T=(jd-2451545)/36525,E=helio(DATA.planets.ter,T);
  let Ph=rlHelioSmall(b,jd),g=[Ph[0]-E[0],Ph[1]-E[1],Ph[2]-E[2]],D=Math.hypot(...g);
  Ph=rlHelioSmall(b,jd-D*0.0057755);g=[Ph[0]-E[0],Ph[1]-E[1],Ph[2]-E[2]];D=Math.hypot(...g); // tiempo de luz
  const r=Math.hypot(...Ph),Re=Math.hypot(...E);
  const cosA=clamp((r*r+D*D-Re*Re)/(2*r*D),-1,1),al=Math.acos(cosA);
  let mag;if(b.comet)mag=b.H+5*Math.log10(D)+b.K*Math.log10(r);
  else{const t=Math.tan(al/2),f1=Math.exp(-3.33*Math.pow(t,0.63)),f2=Math.exp(-1.87*Math.pow(t,1.22));mag=b.H+5*Math.log10(r*D)-2.5*Math.log10((1-b.G)*f1+b.G*f2)}
  return{v:vnorm(ecl2eq(g,EPS0)),D,r,mag,Ph,E};
}
function rlCometTail(b,pos){ // dirección de la cola en J2000 ecuatorial (se aleja del Sol)
  const L=Math.min(0.25,0.035/(pos.r*pos.r));if(pos.r>2.3)return null;
  const u=vnorm(pos.Ph);const tip=[pos.Ph[0]+u[0]*L-pos.E[0],pos.Ph[1]+u[1]*L-pos.E[1],pos.Ph[2]+u[2]*L-pos.E[2]];
  return vnorm(ecl2eq(tip,EPS0));
}
function RLsmall(M,limMag,dayF){
  if(!S.layers.small)return;
  for(const b of SMALL){const key='sm:'+b.id;const pos=RLsmallPos(b,S.jd);const e=RLrefr(mv(M,pos.v));const p=project(e);if(!p||!inScr(p))continue;
    const tgt=S.target&&S.target.key===key;if(!tgt&&(dayF>0.5||!(pos.mag<limMag+1||S.fov<45)))continue;
    const vis=pos.mag<limMag;
    if(b.comet){const tv=rlCometTail(b,pos);
      if(tv&&dayF<0.6){const pt=project(RLrefr(mv(M,tv)));if(pt){const tl=Math.hypot(pt.x-p.x,pt.y-p.y);if(tl>2){const g=ctx.createLinearGradient(p.x,p.y,pt.x,pt.y);g.addColorStop(0,`rgba(190,230,255,${vis?0.55:0.25})`);g.addColorStop(1,'rgba(190,230,255,0)');ctx.strokeStyle=g;ctx.lineWidth=Math.max(2,Math.min(9,tl*0.08));ctx.lineCap='round';ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(pt.x,pt.y);ctx.stroke()}}}
      const cr=Math.max(3,Math.min(14,(limMag+2-pos.mag)*1.4));const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,cr);g.addColorStop(0,`rgba(215,245,230,${vis?0.95:0.45})`);g.addColorStop(1,'rgba(160,230,210,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,cr,0,7);ctx.fill();
    }else{ctx.fillStyle=vis?'#e8dcc4':'rgba(200,190,170,.6)';ctx.beginPath();ctx.arc(p.x,p.y,vis?2:1.5,0,7);ctx.fill();ctx.strokeStyle='rgba(230,210,170,.45)';ctx.lineWidth=1;ctx.beginPath();ctx.arc(p.x,p.y,5,0,7);ctx.stroke()}
    ctx.fillStyle='rgba(235,220,190,.85)';ctx.font='10px system-ui';ctx.textAlign='left';ctx.fillText(b.n,p.x+7,p.y+3);
    hits.push({x:p.x,y:p.y,o:{kind:'small',b,pos,enu:e}});
  }
}
function rlSmallInfo(o){
  const b=o.b,p=o.pos,aa=v2altaz(o.enu);
  const how=p.mag<6?'se puede ver a simple vista con cielo oscuro':p.mag<9.5?'necesitás binoculares':p.mag<12.5?'necesitás un telescopio':'muy débil: solo con telescopios grandes';
  return`<b>${b.n}</b><br>${b.t} · magnitud ${p.mag.toFixed(1)} (${how})<br>A ${p.D.toFixed(2)} UA de la Tierra y ${p.r.toFixed(2)} UA del Sol${b.comet?` · perihelio el ${(()=>{const d=ymdFromJD(b.T);return d.D+'/'+d.M+'/'+d.Y})()}`:''}<br>Altura ${aa.alt.toFixed(1)}° · Acimut ${aa.az.toFixed(1)}° (${dirName(aa.az)})${aa.alt<0?' · <i>bajo el horizonte</i>':''}<br><span style="font-size:12px;color:var(--dim)">Órbita calculada con elementos del Centro de Planetas Menores; posición aproximada (unos minutos de arco).${b.comet?' El brillo de los cometas puede variar mucho del pronóstico.':''}</span>`;
}

// ---------- 8. Eclipses ----------
function rlFindMin(f,a,b,tol){const g=0.381966;let c=a+g*(b-a),d=b-g*(b-a),fc=f(c),fd=f(d);while(b-a>tol){if(fc<fd){b=d;d=c;fd=fc;c=a+g*(b-a);fc=f(c)}else{a=c;c=d;fc=fd;d=b-g*(b-a);fd=f(d)}}const x=(a+b)/2;return{x,v:f(x)}}
function rlGeo(jd){const P=precessionMatrix(jd);const s=planetVecJ2000('sol',jd);const sd=mv(P,s.v);const mo=moonVecOfDate(jd);return{P,sd,sr:s.r,mo}}
function RLeclipses(j0,days){
  const out=[];let prevL=null,prevS=null,prev2L=null,prev2S=null;const step=0.25;
  const lunarSep=jd=>{const g=rlGeo(jd);return rlAng(g.mo.v,[-g.sd[0],-g.sd[1],-g.sd[2]])};
  const solarSep=jd=>{const g=rlGeo(jd);return rlAng(g.mo.v,g.sd)};
  for(let jd=j0-step;jd<=j0+days;jd+=step){
    const l=lunarSep(jd),s=solarSep(jd);
    if(prev2L!=null&&prevL<prev2L&&prevL<=l&&prevL<1.8){const m=rlFindMin(lunarSep,jd-2*step,jd,1/1440);const ev=rlLunarEv(m.x);if(ev&&ev.t>=j0)out.push(ev)}
    if(prev2S!=null&&prevS<prev2S&&prevS<=s&&prevS<1.8){const ev=rlSolarEv(jd-step);if(ev&&ev.t>=j0)out.push(ev)}
    prev2L=prevL;prevL=l;prev2S=prevS;prevS=s;
  }
  return out.sort((a,b)=>a.t-b.t);
}
function rlLunarEv(t){
  const g=rlGeo(t);const sh=rlShadow(g.mo.v,g.mo.dist,g.sd,g.sr);
  const um=(sh.U+sh.sm-sh.sep)/(2*sh.sm),pm=(sh.Pn+sh.sm-sh.sep)/(2*sh.sm);if(pm<=0)return null;
  const type=um>=1?'total':um>0?'parcial':'penumbral';
  const altAt=jd=>{const Hm=horizMatrix(jd,S.lat,S.lon);const mo=moonVecOfDate(jd);return v2altaz(RLrefr(rlTopoMoon(mv(Hm,mo.v),mo.dist))).alt};
  const a=altAt(t);let vis=a>0?'si':(altAt(t-0.06)>0||altAt(t+0.06)>0)?'parte':'no';
  return{kind:'luna',t,type,mag:um>0?um:pm,alt:a,vis};
}
function rlSolarEv(t0){
  const f=jd=>{const g=rlGeo(jd);const Hm=horizMatrix(jd,S.lat,S.lon);const sE=mv(Hm,g.sd);const mE=rlTopoMoon(mv(Hm,g.mo.v),g.mo.dist);return rlAng(sE,mE)};
  let best={x:t0,v:99};for(let jd=t0-0.3;jd<=t0+0.3;jd+=6/1440){const v=f(jd);if(v<best.v)best={x:jd,v}}
  const m=rlFindMin(f,best.x-6/1440,best.x+6/1440,20/86400);
  const g=rlGeo(m.x);const Hm=horizMatrix(m.x,S.lat,S.lon);const sE=mv(Hm,g.sd);const mT=rlTopoMoon(mv(Hm,g.mo.v),g.mo.dist);
  const rS=0.2666/g.sr,rM=0.2725*Math.asin(1/g.mo.dist)*R2D*(1+Math.max(0,mT[2])/g.mo.dist);
  if(m.v>=rS+rM)return null;
  const alt=v2altaz(RLrefr(sE)).alt;if(alt<-0.5)return null;
  const ob=rlOverlap(rS,rM,m.v);const type=rM>=rS&&m.v<rM-rS?'total':rM<rS&&m.v<rS-rM?'anular':'parcial';
  return{kind:'sol',t:m.x,type,obsc:ob,alt,vis:'si'};
}
async function RLtonightExtra(B){
  const now=S.live&&!S.site?jdNow():S.jd;let h='';
  // Sol con el relieve
  if(TERR.prof&&S.layers.relief){
    const set=findCross('sol',now-0.2,now+1,-0.833,false,10/1440),rise=set?findCross('sol',set,set+1,-0.833,true,10/1440):null;
    const ts=set?RLterrainCross('sol',set-0.15,set+0.02,false,0.27):null,tr=rise?RLterrainCross('sol',rise-0.02,rise+0.15,true,0.27):null;
    const maxH=Math.max(...TERR.prof);
    h+=`<h3>⛰️ Tu horizonte real</h3><p>Estás a unos ${Math.round(TERR.h0)} m sobre el nivel del mar. El relieve más alto que te rodea tapa hasta ${maxH.toFixed(1)}° sobre el horizonte.${ts?` Hoy el Sol se esconde detrás del relieve a las <b>${hhmm(ts)}</b>${set?` (${Math.round((set-ts)*1440)} min antes que en un horizonte plano)`:''}`:''}${tr?` y vuelve a aparecer a las <b>${hhmm(tr)}</b>`:''}.</p>`;
  }
  // cometas y asteroides
  h+='<h3>☄️ Cometas y asteroides</h3><div class="list">';
  for(const b of SMALL){const pos=RLsmallPos(b,now);let best=null;
    for(let jd=now;jd<=now+0.75;jd+=20/1440){if(sunAltAt(jd,S.lat,S.lon)>-12)continue;const P=precessionMatrix(jd),M=mmul(horizMatrix(jd,S.lat,S.lon),P);const a=v2altaz(mv(M,RLsmallPos(b,jd).v));if(!best||a.alt>best.alt)best={alt:a.alt,az:a.az,jd}}
    const how=pos.mag<6?'a simple vista con cielo oscuro':pos.mag<9.5?'con binoculares':pos.mag<12.5?'con telescopio':'solo con telescopios grandes';
    h+=`<button class="item" data-sm="${b.id}">${b.n} <span style="color:var(--dim)">· mag ${pos.mag.toFixed(1)}</span><small>${b.t} · ${how}${best&&best.alt>10?` · esta noche llega a ${Math.round(best.alt)}° hacia el ${dirName(best.az)} (${hhmm(best.jd)})`:' · esta noche queda bajo o no se ve'}</small></button>`}
  h+='</div>';
  // eclipses
  h+='<h3>🌑 Próximos eclipses visibles desde acá</h3><div id="eclList"><p>Calculando eclipses de los próximos 3 años…</p></div>';
  // lluvias: simulación
  const sh=SHOWERS.map(s=>({s,a:rlShowerActivity(s,now)})).sort((a,b)=>b.a-a.a)[0];
  h+=`<h3>✨ Estrellas fugaces</h3><p>Ahora mismo la app hace caer meteoros con la frecuencia real según la fecha, la Luna y la contaminación lumínica (unos 5 a 15 por hora una noche común). ${sh.a>0.15?`Hay actividad de las <b>${sh.s[0]}</b>.`:''}</p><div class="row">${SHOWERS.filter(s=>{const d=ymdFromJD(now);let t=jdFromYMDh(d.Y,s[1],s[2],0);if(t<now-3)t=jdFromYMDh(d.Y+1,s[1],s[2],0);return t-now<120}).slice(0,3).map(s=>`<button class="tbtn" data-shw="${s[0]}">▶ Simular ${s[0]}</button>`).join('')}</div>`;
  const div=document.createElement('div');div.innerHTML=h;B.appendChild(div);
  div.querySelectorAll('[data-sm]').forEach(b=>b.onclick=()=>{const x=SMALL.find(s=>s.id===b.dataset.sm);$('pTonight').style.display='none';S.layers.small=true;selectTarget({key:'sm:'+x.id,label:x.n})});
  div.querySelectorAll('[data-shw]').forEach(b=>b.onclick=()=>{$('pTonight').style.display='none';RLsimShower(SHOWERS.find(s=>s[0]===b.dataset.shw))});
  await new Promise(r=>setTimeout(r,40));
  const L=div.querySelector('#eclList');const ev=RLeclipses(now,3*365.25).filter(e=>e.vis!=='no'&&!(e.kind==='luna'&&e.type==='penumbral'&&e.mag<0.6));
  if(!ev.length){L.innerHTML='<p>No hay eclipses visibles desde tu ubicación en los próximos 3 años.</p>';return}
  const off=-new Date().getTimezoneOffset()/1440;
  L.innerHTML='<div class="list">'+ev.slice(0,8).map((e,i)=>{const d=ymdFromJD(e.t+off);const fecha=`${d.D}/${d.M}/${d.Y} ${String(d.h).padStart(2,'0')}:${String(d.mi).padStart(2,'0')}`;
    const txt=e.kind==='luna'?`Eclipse ${e.type} de Luna${e.type!=='total'?` (${Math.round(Math.min(e.mag,1)*100)}% ${e.type==='penumbral'?'en penumbra':'en sombra'})`:''} · Luna a ${Math.round(e.alt)}° de altura${e.vis==='parte'?' · se ve una parte':''}`
      :`Eclipse ${e.type} de Sol · se tapa el ${Math.round(e.obsc*100)}% del Sol · Sol a ${Math.round(e.alt)}° de altura`;
    return`<div class="item"><b>${fecha}</b> — ${txt}<div class="row"><button class="tbtn" data-ecl="${i}">👀 Ver la simulación</button></div></div>`}).join('')+'</div><p style="font-size:12px;color:var(--dim)">Hora del momento máximo, en tu hora local. Cálculo aproximado (±5 minutos). ⚠️ El Sol nunca se mira sin filtro especial, ni siquiera durante un eclipse parcial.</p>';
  L.querySelectorAll('[data-ecl]').forEach(b=>b.onclick=()=>{const e=ev[+b.dataset.ecl];$('pTonight').style.display='none';if(S.site)leaveSite();S.live=false;S.play=false;S.jd=e.t;
    selectTarget(e.kind==='luna'?{key:'luna',label:'Luna'}:{key:'sol',label:'Sol'});if(!S.sensor)S.fov=e.kind==='luna'?6:5;
    toast(e.kind==='luna'?'🌕 Simulación del eclipse en su momento máximo. Usá ⏩ o la rotación para verlo avanzar.':'🌞 Simulación del eclipse. ⚠️ Nunca mires el Sol sin filtro especial.',6000)});
}

// ---------- 9. Sensores: brújula + giroscopio ----------
const FUS={rel:null,absA:null,off:null};
function rlOnOri(e,abs){
  if(e.alpha==null)return;
  if(e.webkitCompassHeading!=null){ // iOS: giroscopio + brújula con filtro lento
    const off=norm360((360-e.webkitCompassHeading)-e.alpha);
    if(compassOff==null)compassOff=off;else{let d=((off-compassOff+540)%360)-180;compassOff=norm360(compassOff+d*0.03)}
    ori={a:(e.alpha+compassOff)*D2R,b:e.beta*D2R,g:e.gamma*D2R};return;
  }
  if(abs){FUS.absA=e.alpha;FUS.absT=performance.now();
    if(!FUS.rel||performance.now()-FUS.rel.t>600)ori={a:e.alpha*D2R,b:e.beta*D2R,g:e.gamma*D2R};return}
  if(!hasAbs){ori={a:e.alpha*D2R,b:e.beta*D2R,g:e.gamma*D2R};return}
  // Android: la orientación relativa (giroscopio) es suave; la absoluta (brújula) da el norte. Se combinan.
  FUS.rel={t:performance.now()};
  if(FUS.absA!=null){const off=norm360(FUS.absA-e.alpha);if(FUS.off==null)FUS.off=off;else{let d=((off-FUS.off+540)%360)-180;FUS.off=norm360(FUS.off+d*(Math.abs(d)>25?0.3:0.025))}}
  if(FUS.off==null)return;
  ori={a:(e.alpha+FUS.off)*D2R,b:e.beta*D2R,g:e.gamma*D2R};
}
function rlApplySensorCam(){
  if(!ori){setManualCam();return}
  const ca=Math.cos(ori.a),sa=Math.sin(ori.a),cb=Math.cos(ori.b),sb=Math.sin(ori.b),cg=Math.cos(ori.g),sg=Math.sin(ori.g);
  const c0=[ca*cg-sa*sb*sg,sa*cg+ca*sb*sg,-cb*sg],c1=[-sa*cb,ca*cb,sb],c2=[ca*sg+sa*sb*cg,sa*sg-ca*sb*cg,cb*cg];
  screenAng=((screen.orientation&&screen.orientation.angle)!=null?screen.orientation.angle:(window.orientation||0))*D2R;
  const cs=Math.cos(screenAng),ss=Math.sin(screenAng);
  let f=[-c2[0],-c2[1],-c2[2]];let u=[ss*c0[0]+cs*c1[0],ss*c0[1]+cs*c1[1],ss*c0[2]+cs*c1[2]];
  const o=S.azOffset*D2R,co=Math.cos(o),so=Math.sin(o);const rot=v=>[v[0]*co+v[1]*so,-v[0]*so+v[1]*co,v[2]];
  f=rot(f);u=rot(u);
  // suavizado adaptativo: quieto = sin temblor; movimiento rápido = respuesta inmediata
  const now=performance.now(),dt=RL.camT?Math.min(0.1,(now-RL.camT)/1000):0.016;RL.camT=now;
  const ang=rlAng(sF,f);let k=clamp(0.04+ang/5,0.04,0.75);k=1-Math.pow(1-k,dt*60);
  sF=vnorm(sF.map((x,i)=>x+(f[i]-x)*k));sU=vnorm(sU.map((x,i)=>x+(u[i]-x)*k));
  camF=sF;camR=vnorm(cross(sF,sU));camU=cross(camR,camF);
}

// ---------- Activación ----------
function RLinit(){
  for(const k of ['relief','atm','twinkle','meteors','small'])if(S.layers[k]===undefined)S.layers[k]=true;
  onOri=rlOnOri;applySensorCam=rlApplySensorCam;
  topoMoon=function(enu){if(RL.moDistJD!==S.jd){RL.moDist=moonVecOfDate(S.jd).dist;RL.moDistJD=S.jd}return rlTopoMoon(enu,RL.moDist)};
  const mwv=mwVisibility;mwVisibility=d=>mwv(d)*(1-0.85*RL.moonGlow);
  for(const b of SMALL)SEARCH.push({key:'sm:'+b.id,label:b.n,sub:b.t});
  const benu=bodyENU;bodyENU=function(name,M,Hm,P){if(name&&name.startsWith('sm:')){const b=SMALL.find(s=>'sm:'+s.id===name);return b?RLrefr(mv(M,RLsmallPos(b,S.jd).v)):null}return benu(name,M,Hm,P)};
  const si=showInfo;showInfo=function(o){if(o.kind!=='small')return si(o);
    $('infoBody').innerHTML=rlSmallInfo(o)+'<div class="row" style="margin-top:8px"><button class="pbtn" id="infoAI">🤖 Preguntar a la IA</button></div>';$('info').style.display='block';
    $('infoAI').onclick=()=>{$('info').style.display='none';openAI(`Contame sobre ${o.b.n}: qué es, curiosidades y cómo verlo desde acá.`)}};
  const ot=openTonight;openTonight=async function(){const pr=ot();const B=$('tonightBody');
    for(let i=0;i<100&&!B.querySelector('#issList');i++)await new Promise(r=>setTimeout(r,30));
    if(B.querySelector('#issList'))RLtonightExtra(B);return pr};
  $('bTonight').onclick=openTonight;
  // casillas de Ajustes
  const box=$('cRed')&&$('cRed').closest('label');
  if(box){const html=`<label class="chk"><input type="checkbox" id="cRelief"> Horizonte real con las montañas de alrededor</label>
    <label class="chk"><input type="checkbox" id="cAtm"> Atmósfera real: refracción y estrellas más débiles y rojizas abajo</label>
    <label class="chk"><input type="checkbox" id="cTwinkle"> Titileo de las estrellas</label>
    <label class="chk"><input type="checkbox" id="cMeteors"> Estrellas fugaces (lluvias de meteoros reales)</label>
    <label class="chk"><input type="checkbox" id="cSmall"> Cometas y asteroides</label>`;
    box.insertAdjacentHTML('afterend',html)}
  const fs=fillSet;fillSet=function(){fs();for(const [id,k] of RLBOX)if($(id))$(id).checked=!!S.layers[k]};
  for(const [id,k] of RLBOX)if($(id))$(id).onchange=e=>{S.layers[k]=e.target.checked;LS.set('layers',S.layers);if(k==='relief'&&typeof GCACHE!=='undefined')GCACHE.key=''};
  const red=$('cRed');if(red){const prev=red.onchange;red.onchange=e=>{prev&&prev(e)}}
  const about=[...document.querySelectorAll('#pSet p')].find(p=>/Catálogo/.test(p.textContent));
  if(about)about.insertAdjacentHTML('afterend','<p style="font-size:12px;color:var(--dim)">Relieve: Terrain Tiles de Mapzen en AWS (SRTM, GMTED y otros), resolución ~130 m. Refracción: fórmula de Saemundsson con la temperatura del clima real. Asteroides y cometas: elementos orbitales del Centro de Planetas Menores. Eclipses y lluvias de meteoros: cálculo propio aproximado.</p>');
}
const RLBOX=[['cRelief','relief'],['cAtm','atm'],['cTwinkle','twinkle'],['cMeteors','meteors'],['cSmall','small']];
