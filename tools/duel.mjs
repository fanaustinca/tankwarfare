import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', e => console.log('[PAGEERROR]', e.message));
await page.goto('http://localhost:8099/index.html');
await page.waitForFunction(() => document.getElementById('loader')?.classList.contains('hidden'), {timeout:90000});
await page.click('#btn-start'); await page.waitForTimeout(300);
await page.click('#btn-quick'); await page.waitForTimeout(300);
await page.click('#btn-battle'); await page.waitForTimeout(1000);
await page.evaluate(() => { window.__app.renderer.setAnimationLoop(null); });

const r = await page.evaluate(() => {
  const b = window.__app.battle, THREE_pos = (o)=>o;
  // controlled duel: keep exactly one enemy, park it 45 m in front, both sides auto
  for (let i=1;i<b.enemies.length;i++) b.enemies[i].removeFrom(b.scene);
  b.enemies.length = 1;
  const e = b.enemies[0];
  b.player.pos.set(0,0,0); b.player.yaw = 0; b.player.speed = 0;
  e.tank.pos.set(0,0,45); e.tank.yaw = Math.PI; e.tank.speed = 0;
  b.player.turrets.forEach(t => t.mode='auto');

  const startHp = e.tank.hp, startBlocks = e.tank.modules.filter(m=>m.kind==='block').length;
  let hits=0, shotsFired=0;
  const origFire = b.fireTurret.bind(b);
  b.fireTurret = (o,t)=>{ const before=t.cooldown; origFire(o,t); if(t.cooldown!==before) shotsFired++; };
  const origDet = b.detonate.bind(b);
  b.detonate = (p,pt,tank)=>{ if(tank && tank!==b.player) hits++; origDet(p,pt,tank); };

  const dt=1/60; let time=0;
  while (time < 90 && e.alive) {
    // hold both tanks still so this measures gunnery, not driving
    b.player.pos.set(0,0,0); e.tank.pos.set(0,0,45);
    b.update(dt); time+=dt;
  }
  return {
    killed: !e.alive, ttk: +time.toFixed(1), shotsFired, hits,
    accuracy: +(hits/Math.max(1,shotsFired)*100).toFixed(0)+'%',
    enemyStartHp: Math.round(startHp), enemyEndHp: Math.round(e.tank.hp),
    enemyBlocks: startBlocks, enemyBlocksDead: e.tank.modules.filter(m=>m.kind==='block'&&m.dead).length,
    enemyTracksDead: e.tank.modules.filter(m=>m.kind==='track'&&m.dead).length,
    playerHpLeft: Math.round(b.player.hp)+'/'+Math.round(b.player.maxHp),
    playerBlocksDead: b.player.modules.filter(m=>m.kind==='block'&&m.dead).length,
    playerTurrets: b.player.turrets.map(t=>t.def.name+(t.dead?' DEAD':'')),
  };
});
console.log(r);
await browser.close();
