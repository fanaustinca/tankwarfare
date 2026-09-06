import { chromium } from 'playwright';
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport:{width:1280,height:720} });
let page = await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(e.message+' | '+(e.stack||'').split('\n')[1]));
page.on('console',m=>{ if(m.type()==='error') errs.push(m.text().slice(0,160)); });
const boot = async (p) => { await p.goto('http://localhost:8099/index.html');
  await p.waitForFunction(()=>document.getElementById('loader')?.classList.contains('hidden'),{timeout:120000}); };
await boot(page);

console.log('storage available:', await page.evaluate(async()=>(await import('./js/save.js')).Save.available()));
await page.click('#btn-start'); await page.waitForTimeout(300);
// build a distinctive tank and buy upgrades
await page.click('#btn-quick'); await page.waitForTimeout(300);
await page.evaluate(()=>{ window.TW.money(9000); window.TW.upgrade(2); });
await page.evaluate(async ()=>{ const bm=window.__app.build, P=await import('./js/parts.js');
  const c=Math.floor(P.GRID/2); bm.build.turrets.clear();
  bm.build.turrets.set(P.key2(c-1,c-1),{i:c-1,j:c-1,type:'tur_twin',rot:1}); bm.rebuild(); });
await page.waitForTimeout(1200);
const before = await page.evaluate(()=>({ tracks:window.__app.build.build.tracks.size,
  blocks:window.__app.build.build.blocks.size,
  turrets:[...window.__app.build.build.turrets.values()].map(t=>t.type+':rot'+t.rot),
  upgrades:{...window.__app.build.build.upgrades} }));
console.log('before reload:', before);

// simulate wave progress
await page.evaluate(async ()=>{ const S=(await import('./js/save.js')).Save; S.saveWave(6, 12345, 22); });

// RELOAD — same browser context, so localStorage persists
await page.close(); page = await ctx.newPage();
page.on('pageerror',e=>errs.push('after reload: '+e.message));
await boot(page);
const after = await page.evaluate(()=>({ tracks:window.__app.build.build.tracks.size,
  blocks:window.__app.build.build.blocks.size,
  turrets:[...window.__app.build.build.turrets.values()].map(t=>t.type+':rot'+t.rot),
  upgrades:{...window.__app.build.build.upgrades},
  phase:window.__app.build.phase,
  overlayNote:document.getElementById('ov-save').textContent.trim().slice(0,90),
  overlayShown:!document.getElementById('ov-save').classList.contains('hidden') }));
console.log('after reload :', after);
console.log('tank restored identically:',
  JSON.stringify(before.turrets)===JSON.stringify(after.turrets) &&
  before.blocks===after.blocks && before.tracks===after.tracks &&
  JSON.stringify(before.upgrades)===JSON.stringify(after.upgrades));
console.log('progress:', await page.evaluate(async()=>(await import('./js/save.js')).Save.loadProgress()));
await page.screenshot({path:'shots/25-saved.png'});

// settings persist
await page.evaluate(()=>{ document.getElementById('opt-invy').click();
  const s=document.getElementById('opt-sens'); s.value='1.8'; s.dispatchEvent(new Event('input')); });
await page.close(); page = await ctx.newPage(); await boot(page);
console.log('settings after reload:', await page.evaluate(()=>window.__app.settings));
console.log('errors:', errs.length?errs.slice(0,5):'none');
await browser.close();
