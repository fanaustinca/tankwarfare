import { chromium } from 'playwright';
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1024,height:640} });
page.on('pageerror',e=>console.log('[PAGEERROR]',e.message));
await page.goto('http://localhost:8099/index.html');
await page.waitForFunction(()=>document.getElementById('loader')?.classList.contains('hidden'),{timeout:180000});
await page.click('#btn-start'); await page.waitForTimeout(300);

// stand-still duel: siege loadout vs nine autocannons, same 3x3 platform
const duel = async (gun) => {
  await page.evaluate(async (gun)=>{
    const bm=window.__app.build, P=await import('./js/parts.js');
    const c=Math.floor(P.GRID/2), b=P.emptyBuild();
    for (let j=-2;j<=2;j++){ b.tracks.set(P.key2(c-3,c+j),{i:c-3,j:c+j,type:'trk_hvy'});
                             b.tracks.set(P.key2(c+3,c+j),{i:c+3,j:c+j,type:'trk_hvy'}); }
    for (let i=-2;i<=2;i++) for (let j=-2;j<=2;j++)
      b.blocks.set(P.key3(c+i,c+j,0),{i:c+i,j:c+j,k:0,type:'blk_hvy'});
    if (gun==='siege') b.turrets.set(P.key2(c-1,c-1),{i:c-1,j:c-1,type:'tur_siege',rot:0});
    else for (let i=-1;i<=1;i++) for (let j=-1;j<=1;j++)
      b.turrets.set(P.key2(c+i,c+j),{i:c+i,j:c+j,type:'tur_aut',rot:0});
    bm.build=b; bm.bonusFunds=90000; bm.rebuild();
  }, gun);
  await page.waitForTimeout(500);
  await page.click('#btn-battle'); await page.waitForTimeout(1500);
  await page.evaluate(async ()=>{ window.__TWworld = await import('./js/world.js'); });
  const r = await page.evaluate(()=>{
    const b=window.__app.battle;
    for(let i=1;i<b.enemies.length;i++) b.enemies[i].removeFrom(b.scene);
    b.enemies.length=1; b.allies.forEach(a=>a.removeFrom(b.scene)); b.allies.length=0;
    const e=b.enemies[0];
    // find a bearing with genuinely clear line of sight, on real ground
    const W = window.__TWworld;
    let px=0,pz=0,ex=0,ez=55;
    for (let a=0; a<64; a++){
      const ang=a/64*Math.PI*2;
      const cx=140*Math.cos(ang), cz=140*Math.sin(ang);
      const tx=cx+55*Math.cos(ang+1.2), tz=cz+55*Math.sin(ang+1.2);
      if (!b.field.blocked({x:cx,z:cz},{x:tx,z:tz})) { px=cx; pz=cz; ex=tx; ez=tz; break; }
    }
    b.player.pos.set(px, W.heightAt(px,pz), pz);
    b.player.yaw=Math.atan2(ex-px, ez-pz);
    e.tank.pos.set(ex, W.heightAt(ex,ez), ez); e.tank.yaw=b.player.yaw+Math.PI;
    b.player.turrets.forEach(t=>t.mode='auto');
    const hp0=e.tank.hp, blocks0=e.tank.modules.filter(m=>m.kind==='block').length;
    let shots=0, hits=0;
    const of=b.fireTurret.bind(b); b.fireTurret=(o,tt)=>{const c=tt.cooldown; of(o,tt); if(tt.cooldown!==c) shots++;};
    const od=b.detonate.bind(b); b.detonate=(p,pt,tk)=>{ if(tk&&tk!==b.player) hits++; od(p,pt,tk); };
    const dt=1/60; let t=0;
    while(t<60 && e.alive){
      b.player.pos.set(px, W.heightAt(px,pz), pz);
      e.tank.pos.set(ex, W.heightAt(ex,ez), ez); e.tank.speed=0;
      b.scene.updateMatrixWorld(true);          // no render loop here to do it for us
      b.update(dt); t+=dt;
    }
    const tur=b.player.turrets[0];
    return { killed:!e.alive, ttk:+t.toFixed(1), cost:b.player.stats.cost,
             shots, hits, dmgDealt:Math.round(hp0-e.tank.hp),
             enemyBlocksDead:e.tank.modules.filter(m=>m.kind==='block'&&m.dead).length+'/'+blocks0,
             diag:{ turrets:b.player.turrets.length, mode:tur&&tur.mode, dead:tur&&tur.dead,
                    target:!!(tur&&tur.aiTarget), range:tur&&tur.def.range,
                    dist:Math.round(e.pos.distanceTo(b.player.pos)),
                    blocked:b.field.blocked(b.player.pos, e.pos),
                    terrain:b.field.terrainBlocks(b.player.pos, e.pos) } };
  });
  await page.evaluate(()=>window.__app.returnToBuild());
  await page.waitForTimeout(400);
  return r;
};
// how often does the ground actually mask a shot at combat range?
await page.click('#btn-quick'); await page.waitForTimeout(300);
await page.click('#btn-battle'); await page.waitForTimeout(1500);
console.log('LOS survey:', await page.evaluate(async ()=>{
  const W=await import('./js/world.js'); const f=window.__app.battle.field;
  const out={};
  for (const range of [30,60,100,150]) {
    let blocked=0, n=0;
    for (let i=0;i<1500;i++){
      const a=Math.random()*Math.PI*2, r=Math.random()*200;
      const x=Math.cos(a)*r, z=Math.sin(a)*r;
      const b2=Math.random()*Math.PI*2;
      const tx=x+Math.cos(b2)*range, tz=z+Math.sin(b2)*range;
      if (Math.hypot(tx,tz)>240) continue;
      if (f.terrainBlocks({x,z},{x:tx,z:tz})) blocked++;
      n++;
    }
    out[range+'m'] = Math.round(blocked/n*100)+'% masked';
  }
  return out;
}));
await page.evaluate(()=>window.__app.returnToBuild()); await page.waitForTimeout(400);

console.log('155mm siege   :', await duel('siege'));
console.log('9x autocannon :', await duel('nine'));
await browser.close();
