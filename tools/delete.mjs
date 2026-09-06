import { chromium } from 'playwright';
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1440,height:810} });
const errs=[]; page.on('pageerror',e=>errs.push(e.message+' | '+(e.stack||'').split('\n')[1]));
page.on('console',m=>{ if(m.type()==='error') errs.push(m.text().slice(0,180)); });
await page.goto('http://localhost:8099/index.html');
await page.waitForFunction(()=>document.getElementById('loader')?.classList.contains('hidden'),{timeout:180000});
await page.click('#btn-start'); await page.waitForTimeout(400);
await page.evaluate(()=>{ window.TW.money(9000); window.TW.preset(); });
await page.waitForTimeout(700);

console.log('undo button gone:', await page.evaluate(()=>!document.getElementById('btn-undo')));
console.log('delete button:', await page.evaluate(()=>{
  const b=document.getElementById('btn-delete');
  return { text:b.textContent.trim(), armed:b.classList.contains('armed') }; }));

const cellToScreen = (i,j) => page.evaluate(({i,j})=>{
  const b=window.__app.build;
  const v=new b.ghost.position.constructor(i-7, 0, j-7);
  v.project(b.camera);
  return [(v.x*0.5+0.5)*innerWidth, (-v.y*0.5+0.5)*innerHeight];
},{i,j});

const state = () => page.evaluate(()=>({ tracks:window.__app.build.build.tracks.size,
  blocks:window.__app.build.build.blocks.size, turrets:window.__app.build.build.turrets.size,
  funds:Math.round(window.__app.build.funds), deleteMode:window.__app.build.deleteMode,
  btn:document.getElementById('btn-delete').textContent.trim() }));

console.log('\nstart:', await state());
await page.click('#btn-delete'); await page.waitForTimeout(250);
console.log('armed:', await state());

// hover a turret in phase 3 and check the red preview matches the piece
await page.evaluate(()=>window.__app.build.setPhase(2));
await page.waitForTimeout(200);
await page.click('#btn-delete'); await page.waitForTimeout(200);   // setPhase disarmed it
let [x,y] = await cellToScreen(7,7);
await page.mouse.move(x,y); await page.waitForTimeout(250);
console.log('\nhover a turret:', await page.evaluate(()=>{
  const b=window.__app.build;
  return { target:b.deleteTarget && {kind:b.deleteTarget.kind, name:b.deleteTarget.name,
             w:+b.deleteTarget.w.toFixed(2), d:+b.deleteTarget.d.toFixed(2)},
           ghostRed: b.ghostMat.color.getHexString(), ghostVisible:b.ghost.visible }; }));
await page.screenshot({path:'shots/30-delete.png'});
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(300);
console.log('after click:', await state());

// empty cell = nothing to remove
[x,y] = await cellToScreen(1,1);
await page.mouse.move(x,y); await page.waitForTimeout(250);
console.log('\nhover empty ground:', await page.evaluate(()=>({
  target: window.__app.build.deleteTarget, valid: window.__app.build.valid,
  ghostVisible: window.__app.build.ghost.visible })));
const before = await state();
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(250);
const after = await state();
console.log('clicking empty ground changed nothing:', JSON.stringify(before)===JSON.stringify(after));

// delete hull blocks
await page.evaluate(()=>{ const b=window.__app.build; b.setPhase(1); b.toggleDelete(true); });
await page.waitForTimeout(200);
let blocks0 = (await state()).blocks;
for (const [i,j] of [[7,7],[7,6],[6,7]]) {
  const [px,py] = await cellToScreen(i,j);
  await page.mouse.move(px,py); await page.waitForTimeout(120);
  await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(160);
}
const s2 = await state();
console.log('\nblocks', blocks0, '->', s2.blocks, '(3 clicks)');

// Esc disarms, palette pick disarms
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
console.log('Esc disarms:', !(await state()).deleteMode);
await page.evaluate(()=>window.__app.build.toggleDelete(true));
await page.waitForTimeout(150);
await page.click('#palette-list .part'); await page.waitForTimeout(250);
console.log('picking a part disarms:', !(await state()).deleteMode);
console.log('ctrl+Z still works as a shortcut:', await page.evaluate(()=>typeof window.__app.build.undo==='function'));
console.log('\nerrors:', errs.length?errs.slice(0,5):'none');
await browser.close();
