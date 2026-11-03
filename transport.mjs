import {createKeys,seal,unseal} from './crypto.mjs';
import {GitHubMailbox,Assembler} from './mailbox.mjs';
export class GitHubClient{
  constructor(settings,{mailbox,pollMs=6000,onDisconnect=()=>{}}={}){this.settings=settings;this.mailbox=mailbox||new GitHubMailbox(settings);this.pollMs=pollMs;this.onDisconnect=onDisconnect;this.assembler=new Assembler();this.pending=new Map();this.jobs=new Map();this.closed=false;this.lastResponse=Date.now();}
  async init(){this.keys=await createKeys(this.settings.masterKey);this.clientId=this.settings.clientId||crypto.randomUUID();await this.mailbox.check();void this.poll();return this;}
  update(data){
    if(data.state){this.status=data.state.status;this.summaries=data.state.jobs;}
    if(data.job)this.jobs.set(data.job.id,data.job);
    if(data.value?.id&&data.value?.status)this.jobs.set(data.value.id,data.value);
    if(data.value?.session)this.session=data.value.session;
  }
  async poll(){
    if(this.closed)return;let delay=this.pollMs;
    try{
      for(const row of await this.mailbox.read()){
        const packet=this.assembler.accept(row.body,'response');if(!packet)continue;
        let data;try{data=await unseal(this.keys,'response',packet);}catch{continue;}
        if(data.clientId!==this.clientId||!Number.isFinite(data.sentAt)||Math.abs(Date.now()-data.sentAt)>180000)continue;
        const pending=this.pending.get(data.id);
        if(!pending&&(!this.session||data.session!==this.session))continue;
        this.lastResponse=Date.now();
        if(data.event==='closed'){this.close(data.error);return;}
        if(!data.error)this.update(data);
        if(pending){clearTimeout(pending.timer);this.pending.delete(data.id);data.error?pending.reject(Error(data.error)):pending.resolve(data.value);}
      }
      if(this.session&&Date.now()-this.lastResponse>210000){this.close('电脑长时间未回应，请重新连接。');return;}
    }catch(error){
      this.lastError=error.message;
      if(/凭据已失效|专用私有仓库或任务收件箱不可访问/.test(error.message)){this.close(error.message);return;}
      delay=Math.max(15000,this.mailbox.blockedUntil-Date.now());
    }
    if(this.session&&Date.now()-this.lastResponse>210000){this.close('电脑长时间未回应，请重新连接。');return;}
    if(!this.closed)this.timer=setTimeout(()=>void this.poll(),Math.min(Math.max(delay,1000),3600000));
  }
  async rpc(kind,path='',method='GET',body=null){
    if(this.closed)throw Error('连接已断开。');
    const id=crypto.randomUUID(),now=Date.now();
    const packet=await seal(this.keys,'request',{id,clientId:this.clientId,session:this.session,kind,path,method,body,sentAt:now,expiresAt:now+60000});
    let resolve,reject;const result=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('等待电脑回应超时。任务可能已提交，请先检查电脑，不要连续重复提交。'));},85000);
    this.pending.set(id,{resolve,reject,timer});
    try{await this.mailbox.send('request',packet);}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
    return result;
  }
  async api(url,options={}){
    if(!this.session||this.closed)throw Error('请重新连接电脑。');
    if(url==='/api/status')return this.status;
    if(url==='/api/jobs'&&(!options.method||options.method==='GET'))return {jobs:this.summaries||[]};
    const match=/^\/api\/jobs\/([a-f0-9]{20})$/.exec(url);
    if(match&&(!options.method||options.method==='GET')){
      const job=this.jobs.get(match[1]);if(job)return job;
    }
    const value=await this.rpc('api',url,options.method||'GET',options.body?JSON.parse(options.body):null);
    if(match)this.jobs.set(match[1],value);return value;
  }
  close(reason){this.closed=true;clearTimeout(this.timer);for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error(reason||'连接已关闭。'));}this.pending.clear();if(reason)this.onDisconnect(reason);}
}
