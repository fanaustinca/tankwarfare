import { chromium } from 'playwright';
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:900,height:560} });
page.on('pageerror',e=>console.log('[PAGEERROR]',e.message,'\n ',(e.stack||'').split('\n').slice(1,4).join('\n ')));
page.on('console',m=>{ if(m.type()==='error') console.log('[console]',m.text().slice(0,300)); });
page.setDefaultTimeout(180000);
await page.goto('http://localhost:8099/index.html',{waitUntil:'domcontentloaded',timeout:60000});
for (let i=0;i<24;i++){
  await page.waitForTimeout(5000);
  const st = await page.evaluate(()=>({
    loader: document.getElementById('loader')?.className,
    txt: document.querySelector('.ldr-txt')?.textContent,
    app: !!window.__app, battle: !!(window.__app&&window.__app.battle) }));
  console.log(i*5+'s', JSON.stringify(st));
  if (st.loader && st.loader.includes('hidden')) { console.log('BOOTED'); break; }
}
await browser.close();
