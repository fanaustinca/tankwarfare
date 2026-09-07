// Serve the page from a non-localhost hostname so the SDK reports 'disabled'
// — the exact situation on GitHub Pages, itch, or any non-portal host.
import { chromium } from 'playwright';
const browser = await chromium.launch({ args:[
  '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
  '--host-resolver-rules=MAP tw.example.com 127.0.0.1'] });
const page = await browser.newPage({ viewport:{width:1280,height:720} });
const errs=[], info=[];
page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
page.on('console',m=>{ const t=m.text(); if(t.startsWith('[ads]')) info.push(t);
  if(m.type()==='error') errs.push(t.slice(0,180)); });
await page.goto('http://tw.example.com:8099/index.html');
await page.waitForFunction(()=>document.getElementById('loader')?.classList.contains('hidden'),{timeout:180000});
console.log('host:', await page.evaluate(()=>location.hostname));
console.log('sdk environment:', await page.evaluate(()=>window.CrazyGames?.SDK?.environment));
console.log('ads log:', info);
console.log('adapter:', await page.evaluate(async()=>{ const {Ads}=await import('./js/ads.js');
  return { provider:Ads.provider, environment:Ads.environment, ready:Ads.ready }; }));
console.log('saves still work:', await page.evaluate(async()=>{ const {Save}=await import('./js/save.js');
  Save.saveWave(3,300,3); return Save.available() && Save.loadProgress().bestWave===3; }));

await page.click('#btn-start'); await page.waitForTimeout(400);
await page.click('#btn-quick'); await page.waitForTimeout(400);
await page.click('#btn-battle'); await page.waitForTimeout(2500);
console.log('game runs:', await page.evaluate(()=>{ const b=window.__app.battle;
  return { mode:window.__app.mode, wave:b.wave, enemies:b.enemies.length,
           hp:Math.round(b.player.hp), simRuns:(()=>{const t=b.time;b.update(1/60);return b.time>t;})() }; }));
console.log('\nplaceholder ad instead of a real one:');
const t0=Date.now();
const p = page.evaluate(async()=>{ const {Ads}=await import('./js/ads.js');
  return Ads.commercialBreak('wave cleared'); });
await page.waitForTimeout(900);
console.log('  overlay shown:', await page.evaluate(()=>!document.getElementById('ad-overlay').classList.contains('hidden')));
await page.evaluate(()=>document.getElementById('ad-skip').click());
console.log('  result:', await p, `(${Date.now()-t0}ms)`);
console.log('  resumed:', await page.evaluate(()=>!window.__app.paused));
console.log('\nerrors:', errs.length?errs.slice(0,6):'none');
await browser.close();
