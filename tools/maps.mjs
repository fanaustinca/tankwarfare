import { chromium } from 'playwright';
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1440,height:810} });
const errs=[]; page.on('pageerror',e=>errs.push(e.message+' | '+(e.stack||'').split('\n')[1]));
page.on('console',m=>{ if(m.type()==='error') errs.push(m.text().slice(0,200)); });
await page.goto('http://localhost:8099/index.html');
await page.waitForFunction(()=>document.getElementById('loader')?.classList.contains('hidden'),{timeout:180000});
await page.click('#btn-start'); await page.waitForTimeout(400);
await page.click('#btn-quick'); await page.waitForTimeout(400);
console.log('picker:', await page.evaluate(()=>({
  options:[...document.querySelectorAll('#map-select option')].map(o=>o.textContent),
  selected:document.getElementById('map-select').value,
  desc:document.getElementById('map-desc').textContent })));

for (const id of ['dunes','ashfall','saltflats','highlands']) {
  await page.selectOption('#map-select', id);
  await page.waitForTimeout(200);
  await page.click('#btn-battle'); await page.waitForTimeout(3000);
  const info = await page.evaluate(async ()=>{
    const W=await import('./js/world.js'); const b=window.__app.battle;
    let lo=1e9,hi=-1e9,maxSlope=0;
    for(let i=0;i<4000;i++){ const x=(Math.random()-0.5)*480,z=(Math.random()-0.5)*480;
      const h=W.heightAt(x,z); lo=Math.min(lo,h);hi=Math.max(hi,h);
      const e=3,gx=(W.heightAt(x+e,z)-W.heightAt(x-e,z))/(2*e),gz=(W.heightAt(x,z+e)-W.heightAt(x,z-e))/(2*e);
      maxSlope=Math.max(maxSlope, Math.atan(Math.hypot(gx,gz))*180/Math.PI); }
    return { map:W.getMap().name, relief:Math.round(hi-lo), maxSlope:+maxSlope.toFixed(0),
      obstacles:b.field.obstacles.length,
      biggestRock:+Math.max(...b.field.obstacles.map(o=>o.radius)).toFixed(1),
      propMeshes:b.field.propMeshes.length,
      fog:'#'+b.scene.fog.color.getHexString()+' @'+b.scene.fog.density,
      sun:+b.field.sun.intensity.toFixed(1), env:+b.scene.environmentIntensity.toFixed(2),
      playerOnGround: Math.abs(b.player.pos.y - W.heightAt(b.player.pos.x,b.player.pos.z)) < 2 };
  });
  console.log(id.padEnd(10), JSON.stringify(info));
  await page.screenshot({path:`shots/map-${id}.png`});
  await page.evaluate(()=>window.__app.returnToBuild());
  await page.waitForTimeout(500);
}
console.log('errors:', errs.length?errs.slice(0,6):'none');
await browser.close();
