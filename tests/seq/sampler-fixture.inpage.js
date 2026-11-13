// Deterministic custom asset, shared by the real bank/null test harnesses.
window._nativeSamplerFixture = function(loop){
 var ctx=getCtx(),buf=ctx.createBuffer(1,48000,48000),data=buf.getChannelData(0);
 for(var i=0;i<data.length;i++) data[i]=.35*Math.sin(i*2*Math.PI*220/48000)+.1*Math.sin(i*2*Math.PI*660/48000);
 var id='native-sampler-fixture';SMP_LIB=SMP_LIB.filter(function(c){return c.id!==id;});SMP_LIB.push({id:id,name:'Fixture',peak:.45});smpBufSet(id,buf);
 ['bass','chord','arp','melgen'].forEach(function(part){SMP_SLOTS[smpKeyVoice(part)]={id:id,start:.05,end:.9,root:60,tune:-2,fine:7,gain:.55,loop:!!loop,loopA:.2,loopB:.8};});
 modParamsSync();return id;
};
