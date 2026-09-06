import { chromium } from 'playwright';
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1280,height:720} });
const errs=[]; page.on('pageerror',e=>errs.push(e.message+' | '+(e.stack||'').split('\n')[1]));
page.on('console',m=>{ if(m.type()==='error') errs.push(m.text().slice(0,200)); });
const info=[]; page.on('console',m=>{ if(m.text().startsWith('[ads]')) info.push(m.text()); });
await page.goto('http://localhost:8099/index.html');
await page.waitForFunction(()=>document.getElementById('loader')?.classList.contains('hidden'),{timeout:180000});
console.log('detection (no SDK present):', info);
console.log('banner mounted:', await page.evaluate(()=>{
  const el=document.getElementById('bay-banner');
  return { html: el.innerHTML.replace(/\s+/g,' ').trim().slice(0,70), w:el.style.width, h:el.style.height }; }));

await page.click('#btn-start'); await page.waitForTimeout(300);
await page.click('#btn-quick'); await page.waitForTimeout(300);
await page.click('#btn-battle'); await page.waitForTimeout(1500);

// interstitial pauses the sim
console.log('\ninterstitial:');
const t = await page.evaluate(async ()=>{
  const {Ads}=await import('./js/ads.js');
  const b=window.__app.battle; const t0=b.time;
  const p = Ads.commercialBreak('test');
  await new Promise(r=>setTimeout(r,700));
  const during = { overlayVisible: !document.getElementById('ad-overlay').classList.contains('hidden'),
                   paused: !!window.__app.paused, label: document.getElementById('ad-label').textContent };
  document.getElementById('ad-skip').click();
  await p;
  return { during, after:{ paused: !!window.__app.paused,
    overlayVisible: !document.getElementById('ad-overlay').classList.contains('hidden') } };
});
console.log(JSON.stringify(t));

// rewarded revive from the death screen
console.log('\nrewarded revive:');
console.log(await page.evaluate(async ()=>{
  const b=window.__app.battle;
  b.player.modules.forEach(m=>{ if(m.kind==='block'){ m.dead=true; m.hp=0; m.mesh.visible=false; } });
  b.player.destroyed=true; b.player.hp=0;
  b.update(1/60);                       // triggers endRun
  for(let i=0;i<200;i++) b.update(1/60); // run out endTimer -> showEnd
  return { overlayUp: !document.getElementById('overlay').classList.contains('hidden'),
           reviveOffered: document.getElementById('btn-revive').style.display !== 'none' };
}));
await page.evaluate(()=>document.getElementById('btn-revive').click());
await page.waitForTimeout(800);
await page.screenshot({path:'shots/28-ad.png'});
await page.evaluate(()=>document.getElementById('ad-skip').click());
await page.waitForTimeout(600);
console.log('after revive:', await page.evaluate(()=>{
  const b=window.__app.battle;
  return { mode:window.__app.mode, destroyed:b.player.destroyed,
    hp:Math.round(b.player.hp), liveModules:b.player.modules.filter(m=>!m.dead).length+'/'+b.player.modules.length,
    battleUiVisible: !document.getElementById('battle-ui').classList.contains('hidden'),
    wave:b.wave }; }));
console.log('errors:', errs.length?errs.slice(0,5):'none');
await browser.close();
