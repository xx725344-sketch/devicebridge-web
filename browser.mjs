import {GitHubClient} from './transport.mjs';
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
await import('./app.js');
