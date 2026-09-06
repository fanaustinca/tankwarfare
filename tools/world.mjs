import { chromium } from 'playwright';
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1440,height:810} });
const errs=[]; page.on('pageerror',e=>errs.push(e.message+' | '+(e.stack||'').split('\n')[1]));
page.on('console',m=>{ if(m.type()==='error') errs.push(m.text().slice(0,160)); });
await page.goto('http://localhost:8099/index.html');
await page.waitForFunction(()=>document.getElementById('loader')?.classList.contains('hidden'),{timeout:120000});
await page.click('#btn-start'); await page.waitForTimeout(300);
await page.click('#btn-quick'); await page.waitForTimeout(300);
await page.click('#btn-battle'); await page.waitForTimeout(2500);
console.log(await page.evaluate(async ()=>{
  const W = await import('./js/world.js');
  const b=window.__app.battle, f=b.field;
  const kinds={}; let minR=1e9,maxR=0;
  for(const o of f.obstacles){ kinds[o.kind]=(kinds[o.kind]||0)+1; minR=Math.min(minR,o.radius); maxR=Math.max(maxR,o.radius); }
  // terrain relief sample
  let lo=1e9,hi=-1e9,maxSlope=0,slopeSum=0,n=0;
  for(let i=0;i<6000;i++){ const x=(Math.random()-0.5)*500, z=(Math.random()-0.5)*500;
    const h=W.heightAt(x,z); lo=Math.min(lo,h); hi=Math.max(hi,h);
    const e=3, gx=(W.heightAt(x+e,z)-W.heightAt(x-e,z))/(2*e), gz=(W.heightAt(x,z+e)-W.heightAt(x,z-e))/(2*e);
    const sl=Math.atan(Math.hypot(gx,gz))*180/Math.PI;
    maxSlope=Math.max(maxSlope,sl); slopeSum+=sl; n++; }
  return { arena:W.ARENA, boundaryR:Math.round(f.boundaryR), obstacles:f.obstacles.length, kinds,
    obstacleRadius:[+minR.toFixed(1), +maxR.toFixed(1)],
    terrainRelief:[Math.round(lo), Math.round(hi)], reliefRange:Math.round(hi-lo),
    slopeDeg:{ max:+maxSlope.toFixed(1), avg:+(slopeSum/n).toFixed(1) },
    spawnCentreHeight:+W.heightAt(0,0).toFixed(2),
    gridBuckets:f.gridMap.size, enemies:b.enemies.length,
    enemyDist:b.enemies.map(e=>Math.round(e.pos.distanceTo(b.player.pos))) };
}));
await page.screenshot({path:'shots/24-bigmap.png'});
console.log('errors:', errs.length?errs.slice(0,5):'none');
await browser.close();
