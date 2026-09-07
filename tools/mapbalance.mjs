import { chromium } from 'playwright';
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:900,height:560} });
page.on('pageerror',e=>console.log('[PAGEERROR]',e.message));
await page.goto('http://localhost:8099/index.html');
await page.waitForFunction(()=>document.getElementById('loader')?.classList.contains('hidden'),{timeout:180000});
await page.click('#btn-start'); await page.waitForTimeout(300);
await page.click('#btn-quick'); await page.waitForTimeout(300);
for (const id of ['dunes','ashfall','saltflats','highlands']) {
  await page.selectOption('#map-select', id); await page.waitForTimeout(150);
  await page.click('#btn-battle'); await page.waitForTimeout(2500);
  console.log(id.padEnd(10), JSON.stringify(await page.evaluate(async ()=>{
    const W=await import('./js/world.js'); const f=window.__app.battle.field;
    const los=(range)=>{ let bl=0,n=0;
      for(let i=0;i<1200;i++){ const a=Math.random()*Math.PI*2,r=Math.random()*200;
        const x=Math.cos(a)*r,z=Math.sin(a)*r,b2=Math.random()*Math.PI*2;
        const tx=x+Math.cos(b2)*range,tz=z+Math.sin(b2)*range;
        if(Math.hypot(tx,tz)>240) continue;
        if(f.blocked({x,z},{x:tx,z:tz})) bl++; n++; }
      return Math.round(bl/n*100); };
    // average slope, the number that actually governs driving
    let s=0,n=0; for(let i=0;i<4000;i++){ const x=(Math.random()-0.5)*460,z=(Math.random()-0.5)*460;
      const e=3,gx=(W.heightAt(x+e,z)-W.heightAt(x-e,z))/(2*e),gz=(W.heightAt(x,z+e)-W.heightAt(x,z-e))/(2*e);
      s+=Math.atan(Math.hypot(gx,gz))*180/Math.PI; n++; }
    return { avgSlope:+(s/n).toFixed(1), masked:{ '50m':los(50)+'%','100m':los(100)+'%','150m':los(150)+'%' } };
  })));
  // does a full fight actually resolve on this map?
  const fight = await page.evaluate(()=>{
    window.__app.renderer.setAnimationLoop(null);
    const b=window.__app.battle, dt=1/60;
    let t=0;
    while(t<70){ const p=b.player;
      if(!p.destroyed){ p.turrets.forEach(x=>x.mode='auto');
        let near=null,nd=1e9; for(const e of b.enemies) if(e.alive){const d=e.pos.distanceTo(p.pos); if(d<nd){nd=d;near=e;}}
        if(near){ const dx=near.pos.x-p.pos.x,dz=near.pos.z-p.pos.z;
          let d=(Math.atan2(dx,dz)-p.yaw)%(Math.PI*2); if(d>Math.PI)d-=Math.PI*2; if(d<-Math.PI)d+=Math.PI*2;
          b.keys.KeyA=d>0.08; b.keys.KeyD=d<-0.08; b.keys.KeyW=nd>28; b.keys.KeyS=false;
          if((p.stuckTime||0)>1){ b.keys.KeyW=false; b.keys.KeyS=true; b.keys.KeyA=true; b.keys.KeyD=false; } } }
      b.update(dt); t+=dt; }
    return { wave:b.wave, kills:b.kills, alive:b.enemies.filter(e=>e.alive).length,
             hp:Math.round(b.player.hp), destroyed:b.player.destroyed };
  });
  console.log('          70s fight ->', JSON.stringify(fight));
  await page.evaluate(()=>window.__app.returnToBuild()); await page.waitForTimeout(400);
  await page.reload(); await page.waitForFunction(()=>document.getElementById('loader')?.classList.contains('hidden'),{timeout:180000});
  await page.click('#btn-start'); await page.waitForTimeout(300);
  await page.click('#btn-quick'); await page.waitForTimeout(300);
}
await browser.close();
