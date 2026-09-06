import { chromium } from 'playwright';
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1280,height:720} });
const errs=[]; page.on('pageerror',e=>errs.push(e.message+' | '+(e.stack||'').split('\n')[1]));
page.on('console',m=>{ if(m.type()==='error') errs.push(m.text().slice(0,200)); });
await page.goto('http://localhost:8099/index.html');
await page.waitForFunction(()=>document.getElementById('loader')?.classList.contains('hidden'),{timeout:180000});
await page.click('#btn-start'); await page.waitForTimeout(300);
await page.click('#btn-quick'); await page.waitForTimeout(300);
await page.click('#btn-battle'); await page.waitForTimeout(2500);
// a full late-wave load
await page.evaluate(()=>{ window.TW.spawn(7,3); window.TW.allies(3,2); });
await page.waitForTimeout(2000);
console.log('scene load:', await page.evaluate(()=>{
  const app=window.__app, b=app.battle;
  app.renderer.info.reset();
  app.renderer.render(b.scene, b.camera);       // one plain pass, uncontaminated by the composer
  const i=app.renderer.info;
  let meshes=0; b.scene.traverse(o=>{ if(o.isMesh) meshes++; });
  return { drawCalls:i.render.calls, triangles:i.render.triangles,
    meshesInScene:meshes, geometries:i.memory.geometries, textures:i.memory.textures,
    programs:i.programs.length,
    units:{ enemies:b.enemies.length, allies:b.allies.length } };
}));
// sim throughput with a full field
console.log('sim cost:', await page.evaluate(()=>{
  const b=window.__app.battle, dt=1/60;
  b.keys.KeyW=true;
  const t0=performance.now(); for(let i=0;i<600;i++) b.update(dt); const t1=performance.now();
  b.keys.KeyW=false;
  return { msPerSimStep:+((t1-t0)/600).toFixed(3),
           budgetAt60fps:'16.67ms', headroom:+(16.67/((t1-t0)/600)).toFixed(1)+'x' };
}));
console.log('errors:', errs.length?errs.slice(0,5):'none');
await browser.close();
