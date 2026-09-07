// Exercises the real CrazyGames SDK. On localhost the SDK reports
// environment 'local' and serves demo ads, so this is the genuine path.
import { chromium } from 'playwright';
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1280,height:720} });
const errs=[], info=[];
page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
page.on('console',m=>{ const t=m.text();
  if (t.startsWith('[ads]')) info.push(t);
  if (m.type()==='error') errs.push(t.slice(0,180)); });
page.on('requestfailed',r=>{ if(r.url().includes('crazygames')) errs.push('SDK LOAD FAILED: '+r.url()); });

await page.goto('http://localhost:8099/index.html');
console.log('sdk script loaded:', await page.evaluate(()=>typeof window.CrazyGames));
await page.waitForFunction(()=>document.getElementById('loader')?.classList.contains('hidden'),{timeout:180000});
console.log('ads log:', info);
console.log('detected:', await page.evaluate(async()=>{ const {Ads}=await import('./js/ads.js');
  return { provider:Ads.provider, environment:Ads.environment, ready:Ads.ready, adblock:Ads.adblock }; }));
console.log('sdk surface:', await page.evaluate(()=>{
  const S=window.CrazyGames && window.CrazyGames.SDK; if(!S) return null;
  return { environment:S.environment, modules:Object.keys(S).filter(k=>typeof S[k]==='object'),
    hasRequestAd: typeof S.ad?.requestAd, hasBanner: typeof S.banner?.requestBanner,
    hasData: typeof S.data?.getItem, hasGameplayStart: typeof S.game?.gameplayStart }; }));
console.log('save backend is SDK.data:', await page.evaluate(async()=>{
  const {Save}=await import('./js/save.js');
  const S=window.CrazyGames?.SDK;
  if(!S || S.environment==='disabled') return 'n/a (disabled env)';
  Save.saveWave(9, 999, 9);
  return { viaSdk: S.data.getItem('tw.progress.v1') !== null, works: Save.loadProgress().bestWave===9 }; }));

await page.click('#btn-start'); await page.waitForTimeout(400);
await page.click('#btn-quick'); await page.waitForTimeout(400);
console.log('banner:', await page.evaluate(()=>{ const el=document.getElementById('bay-banner');
  const r=el.getBoundingClientRect();
  const up=document.querySelector('.upgrades').getBoundingClientRect();
  const bar=document.querySelector('.buildbar').getBoundingClientRect();
  return { size:[el.style.width,el.style.height], childCount:el.children.length,
           overlapsUpgrades: r.top < up.bottom, overlapsBuildBar: r.bottom > bar.top,
           onScreen: r.top>0 && r.bottom<innerHeight }; }));
await page.screenshot({path:'shots/32-crazy-bay.png'});

await page.click('#btn-battle'); await page.waitForTimeout(2000);
console.log('\nrequesting a real midgame ad through the SDK...');
const ad = await page.evaluate(async ()=>{
  const {Ads}=await import('./js/ads.js');
  const t0=performance.now();
  const shown = await Ads.commercialBreak('wave cleared');
  return { shown, ms:Math.round(performance.now()-t0), pausedAfter: !!window.__app.paused }; });
console.log('midgame ad:', ad);
console.log('ads log now:', info.slice(-3));
console.log('game resumed cleanly:', await page.evaluate(()=>({
  paused:!!window.__app.paused, mode:window.__app.mode,
  simRuns:(()=>{const b=window.__app.battle;const t=b.time;b.update(1/60);return b.time>t;})() })));
// rewarded path, end to end through the SDK
console.log('\nrewarded ad via the revive button...');
console.log(await page.evaluate(async ()=>{
  const {Ads}=await import('./js/ads.js');
  const t0=performance.now();
  const earned = await Ads.rewardedBreak('Repair & continue');
  return { earned, ms:Math.round(performance.now()-t0), paused:!!window.__app.paused }; }));

// gameplayStart/Stop must not throw
console.log('lifecycle calls:', await page.evaluate(async ()=>{
  const {Ads}=await import('./js/ads.js');
  const out={};
  try { Ads.gameplayStop(); out.stop='ok'; } catch(e){ out.stop=e.message; }
  try { Ads.gameplayStart(); out.start='ok'; } catch(e){ out.start=e.message; }
  try { Ads.happytime(); out.happytime='ok'; } catch(e){ out.happytime=e.message; }
  try { Ads.loadingFinished(); out.loadingStop='ok'; } catch(e){ out.loadingStop=e.message; }
  return out; }));

console.log('banner failures:', info.filter(l=>l.includes('notVisible')).length);
console.log('\nerrors:', errs.length?errs.slice(0,6):'none');
await browser.close();
