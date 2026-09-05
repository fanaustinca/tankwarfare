import { chromium } from 'playwright';
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1440,height:810} });
const errs=[]; page.on('pageerror',e=>errs.push(e.message+' | '+(e.stack||'').split('\n')[1]));
page.on('console',m=>{ if(m.type()==='error') errs.push('console: '+m.text().slice(0,160)); });
const dev=[]; page.on('console',m=>{ if(m.text().includes('TANKWARFARE')) dev.push(m.text()); });
await page.goto('http://localhost:8099/index.html');
await page.waitForFunction(()=>document.getElementById('loader')?.classList.contains('hidden'),{timeout:90000});

console.log('TW installed:', await page.evaluate(()=>typeof window.TW === 'object'));
console.log('TW commands:', await page.evaluate(()=>Object.keys(window.TW).length));
await page.click('#btn-start'); await page.waitForTimeout(400);

console.log('\n— UPGRADES —');
console.log('panel rows:', await page.evaluate(()=>document.querySelectorAll('#upgrade-list .upg').length));
await page.click('#btn-quick'); await page.waitForTimeout(500);
const before = await page.evaluate(()=>({funds:Math.round(window.__app.build.funds),
  hp:Math.round(window.__app.build.stats.hp), dps:Math.round(window.__app.build.stats.dps),
  speed:+window.__app.build.stats.topSpeed.toFixed(2)}));
console.log('before upgrades:', before);
await page.evaluate(()=>window.TW.money(20000)); await page.waitForTimeout(200);
// buy one level of each via the actual UI buttons
for (let i=0;i<3;i++){ await page.click(`#upgrade-list .upg:nth-child(${i+1}) .upg-buy`); await page.waitForTimeout(150); }
const after = await page.evaluate(()=>({funds:Math.round(window.__app.build.funds),
  hp:Math.round(window.__app.build.stats.hp), dps:Math.round(window.__app.build.stats.dps),
  speed:+window.__app.build.stats.topSpeed.toFixed(2),
  levels:{...window.__app.build.build.upgrades}}));
console.log('after 1 level each:', after);
await page.evaluate(()=>window.TW.upgrade()); await page.waitForTimeout(300);
console.log('after TW.upgrade():', await page.evaluate(()=>({
  hp:Math.round(window.__app.build.stats.hp), dps:Math.round(window.__app.build.stats.dps),
  speed:+window.__app.build.stats.topSpeed.toFixed(2), levels:{...window.__app.build.build.upgrades}})));
await page.screenshot({path:'shots/16-upgrades.png'});

console.log('\n— TEAMS —');
await page.click('#btn-battle'); await page.waitForTimeout(1800);
console.log(await page.evaluate(()=>{ const b=window.__app.battle; return {
  allies:b.allies.length, enemies:b.enemies.length,
  allyTeams:b.allies.map(a=>a.team), enemyTeams:b.enemies.map(e=>e.team),
  squadHud:document.getElementById('b-squad').textContent,
  playerUnitTeam:b.playerUnit.team,
  allySeesEnemy:b.foesOf(b.allies[0]).length, enemySeesBlue:b.foesOf(b.enemies[0]).length }; }));

await page.evaluate(()=>{ window.__app.renderer.setAnimationLoop(null);
  const b=window.__app.battle, dt=1/60; for(let i=0;i<60*45;i++) b.update(dt); });
console.log('after 45s:', await page.evaluate(()=>{ const b=window.__app.battle; return {
  kills:b.kills, allyKillsHappened:b.enemies.filter(e=>!e.alive).length,
  alliesAlive:b.allies.filter(a=>a.alive).length, enemiesAlive:b.enemies.filter(e=>e.alive).length,
  wave:b.wave, playerHp:Math.round(b.player.hp), squadHud:document.getElementById('b-squad').textContent }; }));

console.log('\n— DEV COMMANDS —');
console.log(await page.evaluate(()=>{
  const b=window.__app.battle, out={};
  out.god = window.TW.god(true);
  const hp0=b.player.hp; b.player.applyDamage(b.player.pos, 9999); out.godBlocksDamage = b.player.hp===hp0;
  window.TW.god(false);
  window.TW.spawn(3,3); out.afterSpawn=b.enemies.length;
  window.TW.allies(2,2); out.afterAllies=b.allies.length;
  window.TW.nuke(); out.afterNuke=b.enemies.filter(e=>e.alive).length;
  window.TW.wave(5); out.wave=b.wave; out.waveEnemies=b.enemies.length;
  window.TW.gunners('auto'); out.gunners=b.player.turrets.map(t=>t.mode);
  window.TW.speed(2); out.timeScale=window.__app.timeScale; window.TW.speed(1);
  window.TW.tp(); out.tpOk = b.player.pos.length()>0;
  window.TW.repair(); out.hpAfterRepair=Math.round(b.player.hp);
  out.statsOk = !!window.TW.stats();
  return out; }));
await page.screenshot({path:'shots/17-teams.png'});
console.log('\nerrors:', errs.length?errs.slice(0,8):'none');
await browser.close();
