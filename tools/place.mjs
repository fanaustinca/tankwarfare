import { chromium } from 'playwright';
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1440,height:810} });
page.on('pageerror', e=>console.log('[PAGEERROR]',e.message));
await page.goto('http://localhost:8099/index.html');
await page.waitForFunction(()=>document.getElementById('loader')?.classList.contains('hidden'),{timeout:90000});
await page.click('#btn-start'); await page.waitForTimeout(400);

const state = () => page.evaluate(()=>{ const b=window.__app.build; return {
  tracks:b.build.tracks.size, blocks:b.build.blocks.size, turrets:b.build.turrets.size,
  funds:Math.round(b.funds), meshes:b.tank.group.children.length,
  battleDisabled:document.getElementById('btn-battle').disabled }; });

console.log('empty:', await state());

// lay a run of tracks by clicking the deck
await page.evaluate(()=>window.__app.build.setPhase(0));
const cellToScreen = (i,j) => page.evaluate(({i,j})=>{
  const b=window.__app.build, THREE=b.ghost.constructor;
  const P = { ox:(-15/2+0.5), oz:(-15/2+0.5) };
  const v = new b.ghost.position.constructor(i+P.ox, 0, j+P.oz);
  v.project(b.camera);
  return [ (v.x*0.5+0.5)*innerWidth, (-v.y*0.5+0.5)*innerHeight ];
}, {i,j});

for (let j=5;j<=9;j++) for (const i of [5,9]) {
  const [x,y] = await cellToScreen(i,j);
  await page.mouse.move(x,y); await page.waitForTimeout(60);
  await page.mouse.down({button:'left'}); await page.mouse.up({button:'left'});
  await page.waitForTimeout(60);
}
console.log('after laying tracks:', await state());

// hull
await page.evaluate(()=>window.__app.build.setPhase(1));
for (let j=5;j<=9;j++) for (const i of [6,7,8]) {
  const [x,y] = await cellToScreen(i,j);
  await page.mouse.move(x,y); await page.waitForTimeout(50);
  await page.mouse.down({button:'left'}); await page.mouse.up({button:'left'});
  await page.waitForTimeout(50);
}
console.log('after hull:', await state());

// a 2x2 siege gun
await page.evaluate(()=>{ const b=window.__app.build; b.setPhase(2); b.selected[2]='tur_siege'; b.updateGhostShape(); });
let [x,y] = await cellToScreen(6,6);
await page.mouse.move(x,y); await page.waitForTimeout(150);
console.log('siege hover:', await page.evaluate(()=>({cell:window.__app.build.hoverCell, valid:window.__app.build.valid, err:window.__app.build.hoverError})));
await page.mouse.down({button:'left'}); await page.mouse.up({button:'left'}); await page.waitForTimeout(200);
console.log('after siege gun:', await state());
await page.screenshot({path:'shots/15-placed.png'});

// right-click removal
await page.mouse.down({button:'right'}); await page.mouse.up({button:'right'}); await page.waitForTimeout(200);
console.log('after RMB remove:', await state());
// undo restores
await page.click('#btn-undo'); await page.waitForTimeout(200);
console.log('after undo:', await state());
await browser.close();
