// Headless smoke-test + screenshot harness.
// usage: node tools/shoot.mjs <script-name>
import { chromium } from 'playwright';
import fs from 'fs';

const OUT = new URL('../shots/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[PAGEERROR] ${e.message}\n${e.stack || ''}`));
page.on('requestfailed', (r) => logs.push(`[REQFAIL] ${r.url()} ${r.failure()?.errorText}`));

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log(`  → shots/${name}.png`);
};
const wait = (ms) => page.waitForTimeout(ms);

await page.goto('http://localhost:8099/index.html', { waitUntil: 'domcontentloaded' });

// wait for the asset bake to finish
console.log('booting…');
try {
  await page.waitForFunction(() => document.getElementById('loader')?.classList.contains('hidden')
    || !document.getElementById('loader'), { timeout: 90000 });
  console.log('  loader cleared');
} catch (e) {
  console.log('  !! loader never cleared');
  console.log('  loader text:', await page.evaluate(() => document.querySelector('.ldr-txt')?.textContent));
}
await wait(1500);
await shot('01-start');

// enter build mode
await page.click('#btn-start');
await wait(1200);
await shot('02-build-empty');

// quick build preset
await page.click('#btn-quick');
await wait(1200);
await shot('03-build-quick');

// hover a cell in phase 1 to see the ghost
await page.evaluate(() => window.__app.build.setPhase(0));
await page.mouse.move(700, 430);
await wait(400);
await shot('04-build-tracks');

await page.evaluate(() => window.__app.build.setPhase(1));
await page.mouse.move(760, 400);
await wait(400);
await shot('05-build-hull');

// into battle
await page.evaluate(() => window.__app.build.setPhase(2));
await wait(300);
await page.click('#btn-battle');
await wait(2500);
await shot('06-battle-start');

// drive + fight
await page.keyboard.down('KeyW');
await wait(2500);
await shot('07-battle-driving');
await page.keyboard.up('KeyW');

await page.evaluate(() => { window.__app.battle.firing = true; });
await wait(1800);
await shot('08-battle-firing');
await page.evaluate(() => { window.__app.battle.firing = false; });
await wait(1500);
await shot('09-battle-after');

// fps + state probe
const probe = await page.evaluate(() => {
  const b = window.__app.battle;
  return {
    mode: window.__app.mode,
    enemies: b.enemies.length,
    enemiesAlive: b.enemies.filter(e => e.alive).length,
    aiStates: b.enemies.slice(0, 6).map(e => e.state),
    playerHp: Math.round(b.player.hp) + '/' + Math.round(b.player.maxHp),
    modules: b.player.modules.length,
    turrets: b.player.turrets.length,
    speed: +b.player.speed.toFixed(2),
    topSpeed: +b.player.stats.topSpeed.toFixed(2),
    pos: b.player.pos.toArray().map(n => +n.toFixed(1)),
    activeProjectiles: b.projectiles.filter(p => p.active).length,
    triangles: window.__app.renderer.info.render.triangles,
    drawCalls: window.__app.renderer.info.render.calls,
    programs: window.__app.renderer.info.programs.length,
  };
});
console.log('\nPROBE:', JSON.stringify(probe, null, 2));

console.log('\nLOGS:');
const seen = new Set();
for (const l of logs) {
  const k = l.slice(0, 160);
  if (seen.has(k)) continue;
  seen.add(k);
  console.log(' ', l.slice(0, 400));
}
if (!logs.length) console.log('  (clean — no console output)');

await browser.close();
