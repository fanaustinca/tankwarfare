// Does pressing D turn the view RIGHT on screen? Does mouse-right pan RIGHT?
// Measured by projecting a world point to NDC and watching which way it slides.
import { chromium } from 'playwright';
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:900,height:560} });
page.on('pageerror',e=>console.log('[PAGEERROR]',e.message));
await page.goto('http://localhost:8099/index.html');
await page.waitForFunction(()=>document.getElementById('loader')?.classList.contains('hidden'),{timeout:90000});
await page.click('#btn-start'); await page.waitForTimeout(300);
await page.click('#btn-quick'); await page.waitForTimeout(300);
await page.click('#btn-battle'); await page.waitForTimeout(1500);
await page.evaluate(()=>{ window.__app.renderer.setAnimationLoop(null); });

console.log(await page.evaluate(async () => {
  const THREE = await import('three');
  const b = window.__app.battle, dt = 1/60;
  const out = {};

  const settle = () => { for (let i=0;i<120;i++) b.update(dt); };
  b.player.pos.set(0, 0, 0); b.player.yaw = 0; b.player.speed = 0;
  b.camYaw = 0; b.camPitch = 0.15;
  settle();

  // ── 1. steering: where does the tank's own nose go on screen? ──
  const noseNDC = () => {
    const p = new THREE.Vector3(Math.sin(b.player.yaw)*25, 1, Math.cos(b.player.yaw)*25)
      .add(b.player.pos);
    return +p.project(b.camera).x.toFixed(3);
  };
  const camBefore = b.camera.matrixWorld.clone();
  const nose0 = noseNDC();
  b.keys.KeyD = true;
  for (let i=0;i<60;i++){ b.update(dt); b.camera.matrixWorld.copy(camBefore); }  // freeze camera
  b.camera.matrixWorld.copy(camBefore);
  b.camera.matrixWorldInverse.copy(camBefore).invert();
  const nose1 = noseNDC();
  b.keys.KeyD = false;
  out.pressD = { noseNdcBefore: nose0, noseNdcAfter: nose1,
                 noseMoved: nose1 > nose0 ? 'RIGHT' : 'LEFT',
                 expected: 'RIGHT', correct: nose1 > nose0 };

  // ── 2. camera pan: where does a fixed world point go on screen? ──
  b.player.yaw = 0; b.player.speed = 0; b.camYaw = 0;
  settle();
  const mark = new THREE.Vector3(0, 1, 40);          // fixed point straight ahead
  const m0 = +mark.clone().project(b.camera).x.toFixed(3);
  b.camYaw -= 0.30 * 0.0022 * 100;                   // simulate mouse moved RIGHT
  settle();
  const m1 = +mark.clone().project(b.camera).x.toFixed(3);
  out.mouseRight = { markNdcBefore: m0, markNdcAfter: m1,
                     worldSlid: m1 < m0 ? 'LEFT (view turned right)' : 'RIGHT (view turned left)',
                     expected: 'LEFT (view turned right)', correct: m1 < m0 };
  return out;
}));
await browser.close();
