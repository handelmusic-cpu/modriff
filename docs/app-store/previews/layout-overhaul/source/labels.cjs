const L=require(process.cwd()+'/tests/layout/lib.js');
(async()=>{const h=await L.start();try{for(const [name,w,height] of [['portrait',886,73],['landscape',1920,61]]){
 const page=await h.browser.newPage({viewport:{width:w,height},deviceScaleFactor:1});
 await page.goto(h.url);const font=new URL('fonts/outfit-latin-400-normal.woff2',h.url).href;
 await page.setContent(`<style>@font-face{font-family:Outfit;src:url('${font}')}*{box-sizing:border-box}body{margin:0;background:#05060c;color:#eef0ff;font-family:Outfit;font-size:${name==='portrait'?19:21}px;display:flex;align-items:center;justify-content:space-between;padding:0 28px;height:${height}px;border-top:2px solid #b07bff}b{font-size:${name==='portrait'?30:28}px;font-weight:400}span{color:#9aa4cc}</style><b>mõdRïff</b><span>Some features require in-app purchase.</span>`);await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:'/private/tmp/modriff-layout-assets/'+name+'-label.png'});await page.close();
}}finally{await h.close()}})().catch(e=>{console.error(e);process.exitCode=1});
