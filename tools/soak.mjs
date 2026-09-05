import { chromium } from 'playwright';
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1024,height:640} });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: '+e.message+' | '+(e.stack||'').split('\n')[1]));
page.on('console', m => { if (m.type()==='error') errors.push('console: '+m.text().slice(0,200)); });
await page.goto('http://localhost:8099/index.html');
await page.waitForFunction(()=>document.getElementById('loader')?.classList.contains('hidden'),{timeout:90000});
await page.click('#btn-start'); await page.waitForTimeout(400);
await page.click('#btn-quick'); await page.waitForTimeout(400);
await page.click('#btn-battle'); await page.waitForTimeout(1500);
await page.evaluate(()=>{ window.__app.renderer.setAnimationLoop(null); });

// aggressive AI-gunner player that chases the nearest hostile
const chunk = (secs) => page.evaluate((secs)=>{
  const b=window.__app.battle, dt=1/60;
  for (let i=0;i<secs*60;i++){
    const p=b.player;
    if (!p.destroyed) {
      p.turrets.forEach(t=>t.mode='auto');
      let near=null, nd=1e9;
      for (const e of b.enemies) if (e.alive) { const d=e.pos.distanceTo(p.pos); if(d<nd){nd=d;near=e;} }
      if (near) {
        const dx=near.pos.x-p.pos.x, dz=near.pos.z-p.pos.z;
        const want=Math.atan2(dx,dz);
        let d=(want-p.yaw)%(Math.PI*2);
        if(d>Math.PI)d-=Math.PI*2; if(d<-Math.PI)d+=Math.PI*2;
        b.keys.KeyA = d<-0.08; b.keys.KeyD = d>0.08;
        b.keys.KeyW = nd>28;
      }
    }
    b.update(dt);
  }
  return { t:+b.time.toFixed(0), wave:b.wave, kills:b.kills, score:b.score,
           live:b.enemies.filter(e=>e.alive).length, total:b.enemies.length,
           allies:b.allies.filter(a=>a.alive).length+'/'+b.allies.length,
           hp:Math.round(b.player.hp), maxHp:Math.round(b.player.maxHp),
           destroyed:b.player.destroyed, gameOver:!!b.gameOver, mode:window.__app.mode,
           mem: performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576)+'MB' : 'n/a' };
}, secs);

for (let i=0;i<10;i++) {
  const r = await chunk(30);
  console.log(`t=${String(r.t).padStart(3)}s wave ${r.wave} kills ${String(r.kills).padStart(2)} score ${String(r.score).padStart(6)} enemies ${r.live}/${r.total} squad ${r.allies} hp ${r.hp}/${r.maxHp}${r.destroyed?' DESTROYED':''} heap ${r.mem}`);
  if (r.destroyed) break;
  await page.waitForTimeout(50);
}
// let the end-of-run overlay appear
await page.waitForTimeout(2500);
console.log('\nend state:', await page.evaluate(()=>({
  mode: window.__app.mode,
  overlayShown: !document.getElementById('overlay').classList.contains('hidden'),
  endCardShown: !document.getElementById('ov-end').classList.contains('hidden'),
  title: document.getElementById('end-title')?.textContent,
  stats: [...document.querySelectorAll('#end-stats span')].map(e=>e.textContent),
})));
// back to the bay, then redeploy
await page.click('#btn-rebuild'); await page.waitForTimeout(800);
console.log('back in bay:', await page.evaluate(()=>({ mode:window.__app.mode,
  buildUiVisible: !document.getElementById('build-ui').classList.contains('hidden'),
  battleUiHidden: document.getElementById('battle-ui').classList.contains('hidden') })));
await page.click('#btn-battle'); await page.waitForTimeout(1500);
console.log('redeployed:', await page.evaluate(()=>({ mode:window.__app.mode,
  wave:window.__app.battle.wave, hp:Math.round(window.__app.battle.player.hp),
  enemies:window.__app.battle.enemies.length })));
console.log('\nerrors:', errors.length ? errors.slice(0,10) : 'none');
await browser.close();
