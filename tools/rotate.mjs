import { chromium } from 'playwright';
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1440,height:810} });
const errs=[]; page.on('pageerror',e=>errs.push(e.message+' | '+(e.stack||'').split('\n')[1]));
page.on('console',m=>{ if(m.type()==='error') errs.push(m.text().slice(0,160)); });
await page.goto('http://localhost:8099/index.html');
await page.waitForFunction(()=>document.getElementById('loader')?.classList.contains('hidden'),{timeout:90000});
await page.click('#btn-start'); await page.waitForTimeout(400);

console.log('— blocks over tracks —');
console.log(await page.evaluate(async ()=>{
  const bm=window.__app.build, P=await import('./js/parts.js');
  const c=Math.floor(P.GRID/2), out={};
  bm.build=P.emptyBuild();
  for (let j=0;j<4;j++) bm.build.tracks.set(P.key2(c,c+j),{i:c,j:c+j,type:'trk_std'});
  out.plateOnTrack     = P.placementError(bm.build,1,c,c,0,'blk_lgt') || 'OK';
  out.plateBesideTrack = P.placementError(bm.build,1,c+1,c,0,'blk_lgt') || 'OK';
  out.plateInMidair    = P.placementError(bm.build,1,c+5,c+5,0,'blk_lgt') || 'OK';
  // stack on top of the over-track plate
  bm.build.blocks.set(P.key3(c,c,0),{i:c,j:c,k:0,type:'blk_lgt'});
  out.stackAboveIt     = P.placementError(bm.build,1,c,c,1,'blk_lgt') || 'OK';
  out.turretOnIt       = P.placementError(bm.build,2,c,c,0,'tur_can') || 'OK';
  bm.rebuild();
  out.trackY  = +bm.tank.tracks[0].mesh.position.y.toFixed(2);
  out.blockY  = +bm.tank.hullMeshes[0].position.y.toFixed(2);
  out.noOverlap = out.blockY - out.trackY > 0.4;
  return out;
}));

console.log('\n— rotate a 2×1 mount —');
console.log(await page.evaluate(async ()=>{
  const bm=window.__app.build, P=await import('./js/parts.js');
  const c=Math.floor(P.GRID/2), out={};
  // a hull 1 wide and 3 deep: only a TURNED 2x1 mount can fit
  bm.build=P.emptyBuild();
  for (let j=0;j<3;j++){ bm.build.tracks.set(P.key2(c-1,c+j),{i:c-1,j:c+j,type:'trk_std'});
                         bm.build.tracks.set(P.key2(c+1,c+j),{i:c+1,j:c+j,type:'trk_std'});
                         bm.build.blocks.set(P.key3(c,c+j,0),{i:c,j:c+j,k:0,type:'blk_lgt'}); }
  out.twin_unrotated = P.placementError(bm.build,2,c,c,0,'tur_twin',0) || 'OK';
  out.twin_rotated   = P.placementError(bm.build,2,c,c,0,'tur_twin',1) || 'OK';
  out.footNormal = P.footOf(P.ALL_PARTS.tur_twin,0);
  out.footTurned = P.footOf(P.ALL_PARTS.tur_twin,1);
  out.canRotate  = { twin:P.canRotate(P.ALL_PARTS.tur_twin), cannon:P.canRotate(P.ALL_PARTS.tur_can),
                     siege:P.canRotate(P.ALL_PARTS.tur_siege) };
  bm.build.turrets.set(P.key2(c,c),{i:c,j:c,type:'tur_twin',rot:1});
  bm.rebuild();
  out.mounted = bm.tank.turrets.map(t=>({name:t.def.name, rot:t.rot, barrels:t.tips.length}));
  out.occupies = [...P.turretOccupancy(bm.build).keys()];
  return out;
}));

console.log('\n— rotation UI —');
await page.evaluate(()=>{ const b=window.__app.build; b.setPhase(2); b.selected[2]='tur_twin'; b.updateRotUI(); b.updateGhostShape(); });
await page.mouse.move(720,420); await page.waitForTimeout(250);
const ui = () => page.evaluate(()=>({ rot:window.__app.build.rotation,
  label:document.getElementById('rot-size').textContent,
  turned:document.getElementById('btn-rotate').classList.contains('turned'),
  locked:document.getElementById('btn-rotate').classList.contains('locked'),
  cursor:window.__app.build.cursor.scale.toArray().map(n=>+n.toFixed(0)) }));
console.log('twin, default :', await ui());
await page.keyboard.press('r'); await page.waitForTimeout(250);
console.log('twin, after R :', await ui());
await page.evaluate(()=>{ const b=window.__app.build; b.selected[2]='tur_siege'; b.rotation=0; b.updateRotUI(); b.updateGhostShape(); });
await page.mouse.move(720,420); await page.waitForTimeout(250);
console.log('siege (square):', await ui());
await page.keyboard.press('r'); await page.waitForTimeout(250);
console.log('siege after R :', await ui());
console.log('\nerrors:', errs.length?errs.slice(0,5):'none');
await browser.close();
