import { chromium } from 'playwright';
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1440,height:810} });
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
page.on('console',m=>{ if(m.type()==='error') errs.push(m.text().slice(0,200)); });
const t0=Date.now();
await page.goto('http://localhost:8099/index.html');
await page.waitForFunction(()=>document.getElementById('loader')?.classList.contains('hidden'),{timeout:180000});
console.log('boot + texture bake:', ((Date.now()-t0)/1000).toFixed(1)+'s (software renderer)');
console.log(await page.evaluate(async()=>{
  const {Assets}=await import('./js/assets.js');
  const sz=(t)=>t&&t.image?t.image.width+'²':'-';
  return { armourPlate:sz(Assets.tex.armour.blk_lgt.map), ground:sz(Assets.tex.ground.map),
    rock:sz(Assets.tex.rock.map), tread:sz(Assets.tex.tread.map),
    groundRepeat:Assets.tex.ground.map.repeat.toArray(), aniso:Assets.tex.ground.map.anisotropy,
    macroPresent: !!Assets.tex.ground.macro };
}));
await page.click('#btn-start'); await page.waitForTimeout(300);
await page.click('#btn-quick'); await page.waitForTimeout(600);
await page.evaluate(()=>{ const b=window.__app.build; b.camTargetDist=11; b.camElev=0.5; b.camAzim=0.7; });
await page.waitForTimeout(1000);
await page.screenshot({path:'shots/26-tex-armour.png'});
await page.click('#btn-battle'); await page.waitForTimeout(2500);
await page.evaluate(()=>{ const b=window.__app.battle; b.camPitch=0.42; b.camTargetDist=9; });
await page.waitForTimeout(1200);
await page.screenshot({path:'shots/27-tex-ground.png'});
console.log('errors:', errs.length?errs.slice(0,5):'none');
await browser.close();
