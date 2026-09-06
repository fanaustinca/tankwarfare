import { chromium } from 'playwright';
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1440,height:810} });
const errs=[]; page.on('pageerror',e=>errs.push(e.message+' | '+(e.stack||'').split('\n')[1]));
page.on('console',m=>{ if(m.type()==='error') errs.push(m.text().slice(0,160)); });
await page.goto('http://localhost:8099/index.html');
await page.waitForFunction(()=>document.getElementById('loader')?.classList.contains('hidden'),{timeout:120000});
await page.click('#btn-start'); await page.waitForTimeout(300);
await page.click('#btn-quick'); await page.waitForTimeout(400);
console.log('run detection (2 side treads):', await page.evaluate(()=>({
  runs: window.__app.build.tank.trackRuns.length,
  cellsPerRun: window.__app.build.tank.trackRuns.map(r=>r.mods.length),
  runCentres: window.__app.build.tank.trackRuns.map(r=>[+r.cx.toFixed(1), +r.cz.toFixed(1)]) })));
console.log('one connected blob:', await page.evaluate(async ()=>{
  const bm=window.__app.build, P=await import('./js/parts.js'); const c=Math.floor(P.GRID/2);
  const b=P.emptyBuild();
  for(let i=-1;i<=1;i++) for(let j=-2;j<=2;j++) b.tracks.set(P.key2(c+i,c+j),{i:c+i,j:c+j,type:'trk_std'});
  bm.build=b; bm.rebuild();
  return { runs: bm.tank.trackRuns.length, cells: bm.tank.trackRuns.map(r=>r.mods.length) };
}));
console.log('four separate bogies:', await page.evaluate(async ()=>{
  const bm=window.__app.build, P=await import('./js/parts.js'); const c=Math.floor(P.GRID/2);
  const b=P.emptyBuild();
  for(const [di,dj] of [[-2,-2],[2,-2],[-2,2],[2,2]])
    for(let k=0;k<2;k++) b.tracks.set(P.key2(c+di,c+dj+k),{i:c+di,j:c+dj+k,type:'trk_std'});
  bm.build=b; bm.rebuild();
  return { runs: bm.tank.trackRuns.length, cells: bm.tank.trackRuns.map(r=>r.mods.length) };
}));
await page.click('#btn-quick'); await page.waitForTimeout(400);
await page.click('#btn-battle'); await page.waitForTimeout(1800);
await page.evaluate(()=>{ window.__app.renderer.setAnimationLoop(null); });
console.log('\narticulation while driving over terrain:');
console.log(await page.evaluate(()=>{
  const b=window.__app.battle, dt=1/60; const samples=[];
  b.keys.KeyW=true;
  for(let i=0;i<60*12;i++){ b.update(dt);
    if(i%120===0) samples.push({ t:+(i/60).toFixed(0),
      runY:b.player.trackRuns.map(r=>+r.y.toFixed(3)),
      runPitch:b.player.trackRuns.map(r=>+r.pitch.toFixed(3)),
      hullY:+b.player.pos.y.toFixed(2) }); }
  b.keys.KeyW=false;
  const spread = samples.map(s=>+(Math.max(...s.runY)-Math.min(...s.runY)).toFixed(3));
  return { samples, maxDifferentialBetweenRuns: Math.max(...spread) };
}));
console.log('\nerrors:', errs.length?errs.slice(0,5):'none');
await browser.close();
