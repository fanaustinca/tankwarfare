// Drive the simulation with a fixed timestep, bypassing render speed.
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', e => console.log('[PAGEERROR]', e.message, e.stack?.split('\n')[1]));
page.on('console', m => { if (m.type()==='error') console.log('[err]', m.text().slice(0,200)); });
await page.goto('http://localhost:8099/index.html');
await page.waitForFunction(() => document.getElementById('loader')?.classList.contains('hidden'), {timeout:90000});
await page.click('#btn-start'); await page.waitForTimeout(400);
await page.click('#btn-quick'); await page.waitForTimeout(400);
await page.click('#btn-battle'); await page.waitForTimeout(1200);

// stop the render loop so only our fixed-step sim runs
await page.evaluate(() => { window.__app.renderer.setAnimationLoop(null); });

const sim = (secs, setup) => page.evaluate(({secs, setup}) => {
  const b = window.__app.battle;
  if (setup) eval(setup);
  const dt = 1/60, n = Math.round(secs/dt);
  for (let i=0;i<n;i++) b.update(dt);
  const p = b.player;
  return {
    spd:+p.speed.toFixed(2), pos:p.pos.toArray().map(v=>+v.toFixed(1)),
    yaw:+p.yaw.toFixed(2), hp:Math.round(p.hp), maxHp:Math.round(p.maxHp),
    liveEnemies:b.enemies.filter(e=>e.alive).length, totalEnemies:b.enemies.length,
    wave:b.wave, kills:b.kills, score:b.score,
    aiStates:b.enemies.filter(e=>e.alive).map(e=>e.state),
    shotsInFlight:b.projectiles.filter(x=>x.active).length,
    deadModules:p.modules.filter(m=>m.dead).length,
    gunnerModes:p.turrets.map(t=>t.mode+(t.dead?'/dead':'')),
  };
}, {secs, setup});

console.log('— drive forward 3s —');
console.log(await sim(3, "b.keys.KeyW=true"));
console.log('— turn right 2s —');
console.log(await sim(2, "b.keys.KeyD=true"));
console.log('— coast/brake 2s —');
console.log(await sim(2, "b.keys.KeyW=false;b.keys.KeyD=false;b.keys.Space=true"));
console.log('— open fire 8s —');
console.log(await sim(8, "b.keys.Space=false;b.firing=true"));
console.log('— sustained fight 25s —');
console.log(await sim(25, "b.firing=true;b.keys.KeyW=true"));
console.log('— gunner toggle —');
console.log(await sim(3, "b.toggleAllTurrets()"));
console.log('— long fight 60s —');
console.log(await sim(60, null));

const health = await page.evaluate(() => {
  const b=window.__app.battle;
  return { enemyHp: b.enemies.map(e=>Math.round(e.tank.hp)),
           enemyStates: b.enemies.map(e=>e.state+(e.alive?'':'/DEAD')),
           playerDamagedModules: b.player.modules.filter(m=>m.damage01>0).length,
           decalsUsed: b.fx.decals.filter(d=>d.mesh.visible).length,
           smokeCount: b.fx.smoke.count, sparkCount: b.fx.spark.count };
});
console.log('\n', health);
await browser.close();
