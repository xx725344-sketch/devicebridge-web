import {GitHubClient} from './transport.mjs?v=20261103-safari1';
import {readPairPhoto,readPairPixels} from './scan-qr.mjs?v=20261103-safari1';
let current;
function disconnected(message){globalThis.dispatchEvent(new CustomEvent('bridge-disconnected',{detail:message}));}
globalThis.bridgeTransport=async(url,options={})=>{
  if(url==='/api/pair'){
    current?.close();let settings;
    try{settings=JSON.parse(JSON.parse(options.body).code);}catch{throw Error('请粘贴电脑管理页复制的完整配对资料。');}
    let clientId;try{clientId=localStorage.getItem('bridge-github-client-id');}catch{}
    if(!/^[a-f0-9-]{36}$/.test(clientId||'')){clientId=crypto.randomUUID();try{localStorage.setItem('bridge-github-client-id',clientId);}catch{}}
    current=await new GitHubClient({...settings,clientId},{onDisconnect:disconnected}).init();
    try{await current.rpc('hello');return {ok:true};}catch(error){current.close();throw error;}
  }
  if(url==='/api/logout'){current?.close();current=null;return {ok:true};}
  if(!current)throw Error('请粘贴配对资料连接电脑。');
  try{return await current.api(url,options);}catch(error){if(/撤销|未获电脑授权|电脑已重启/.test(error.message)){current.close();disconnected(error.message);}throw error;}
};
await import('./app.js?v=20261103-safari1');
const photo=document.getElementById('pairPhoto'),scan=document.getElementById('scanPair');
scan.addEventListener('click',()=>photo.click());
photo.addEventListener('change',async()=>{
  const file=photo.files?.[0];if(!file)return;
  scan.disabled=true;const error=document.getElementById('pairError');error.textContent='正在本机读取二维码照片…';
  try{document.getElementById('pairCode').value=await readPairPhoto(file);error.textContent='读取成功，请点击“连接电脑”。照片没有上传。';}
  catch(e){error.textContent=e.message;}
  finally{photo.value='';scan.disabled=false;}
});
const live=document.getElementById('scanLive'),cameraBox=document.getElementById('cameraBox'),video=document.getElementById('pairVideo');
let cameraStream,cameraTimer,cameraGeneration=0;
function stopCamera(){cameraGeneration++;clearTimeout(cameraTimer);cameraStream?.getTracks().forEach(track=>track.stop());cameraStream=null;video.srcObject=null;cameraBox.hidden=true;live.disabled=false;}
document.getElementById('stopCamera').addEventListener('click',stopCamera);
globalThis.addEventListener('pagehide',stopCamera);
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera();});
live.addEventListener('click',async()=>{
  stopCamera();const generation=cameraGeneration,error=document.getElementById('pairError');live.disabled=true;cameraBox.hidden=false;
  error.textContent='请允许本网页使用相机，并将完整二维码放入画面。画面仅在本机识别。';
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw Error('当前浏览器无法直接使用相机。请在 Safari 正常窗口打开 HTTPS 网页。');
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
    if(generation!==cameraGeneration){stream.getTracks().forEach(track=>track.stop());return;}
    cameraStream=stream;video.srcObject=stream;await video.play();
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true}),deadline=Date.now()+60000;
    const tick=()=>{
      if(generation!==cameraGeneration)return;
      if(Date.now()>deadline){stopCamera();error.textContent='暂时没读到二维码。请放大电脑页面，让二维码清晰完整地出现在相机画面，再扫描。';return;}
      if(video.readyState>=2&&video.videoWidth){
        const ratio=Math.min(1,1280/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.round(video.videoWidth*ratio);canvas.height=Math.round(video.videoHeight*ratio);ctx.drawImage(video,0,0,canvas.width,canvas.height);
        try{document.getElementById('pairCode').value=readPairPixels(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);stopCamera();error.textContent='扫码成功，请点击“连接电脑”。';return;}catch{}
      }
      cameraTimer=setTimeout(tick,600);
    };
    tick();
  }catch(e){stopCamera();error.textContent=e.name==='NotAllowedError'?'没有获得相机权限，请在 Safari 的当前网站设置中允许相机后重试。':e.message;}
});
