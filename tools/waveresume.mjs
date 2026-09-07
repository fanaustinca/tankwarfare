import { chromium } from 'playwright';
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1280,height:720} });
const errs=[]; page.on('pageerror',e=>errs.push(e.message+' | '+(e.stack||'').split('\n')[1]));
page.on('console',m=>{ if(m.type()==='error') errs.push(m.text().slice(0,180)); });
await page.goto('http://localhost:8099/index.html');
await page.waitForFunction(()=>document.getElementById('loader')?.classList.contains('hidden'),{timeout:180000});
await page.click('#btn-start'); await page.waitForTimeout(300);
await page.click('#btn-quick'); await page.waitForTimeout(300);
await page.click('#btn-battle'); await page.waitForTimeout(1500);
await page.evaluate(()=>{ window.__app.renderer.setAnimationLoop(null); });

await page.evaluate(()=>{ window.TW.wave(5); const b=window.__app.battle; b.score=4321; b.kills=17; });
await page.waitForTimeout(200);
console.log('in battle:', await page.evaluate(()=>({ wave:window.__app.battle.wave,
  score:window.__app.battle.score, kills:window.__app.battle.kills })));

// go back to the bay (B key equivalent)
await page.evaluate(()=>window.__app.returnToBuild());
await page.waitForTimeout(500);
console.log('in the bay:', await page.evaluate(()=>({
  mode:window.__app.mode, pendingRun:window.__app.battle.pendingRun,
  deployBtn:document.getElementById('btn-battle').textContent.trim() })));
await page.screenshot({path:'shots/31-resume.png'});

// redeploy
await page.click('#btn-battle'); await page.waitForTimeout(1500);
console.log('after redeploy:', await page.evaluate(()=>({ wave:window.__app.battle.wave,
  score:window.__app.battle.score, kills:window.__app.battle.kills,
  enemies:window.__app.battle.enemies.length,
  hp:Math.round(window.__app.battle.player.hp)+'/'+Math.round(window.__app.battle.player.maxHp) })));

// dying then "redeploy same tank" must start a FRESH run
await page.evaluate(()=>{ window.__app.renderer.setAnimationLoop(null);
  const b=window.__app.battle;
  b.player.modules.forEach(m=>{ if(m.kind==='block'){m.dead=true;m.hp=0;} });
  b.player.destroyed=true; b.player.hp=0;
  for(let i=0;i<250;i++) b.update(1/60); });
await page.waitForTimeout(600);
await page.click('#btn-again'); await page.waitForTimeout(1600);
console.log('after death + redeploy:', await page.evaluate(()=>({
  wave:window.__app.battle.wave, score:window.__app.battle.score,
  pendingRun:window.__app.battle.pendingRun })));
console.log('errors:', errs.length?errs.slice(0,5):'none');
await browser.close();
