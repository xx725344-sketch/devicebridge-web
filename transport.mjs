import {createKeys,seal,unseal} from './crypto.mjs?v=20261104-vivid1';
import {GitHubMailbox,Assembler} from './mailbox.mjs?v=20261104-vivid1';
export class GitHubClient{
  constructor(settings,{mailbox,pollMs=6000,onDisconnect=()=>{},onState=()=>{}}={}){this.settings=settings;this.mailbox=mailbox||new GitHubMailbox(settings);this.pollMs=pollMs;this.onDisconnect=onDisconnect;this.onState=onState;this.assembler=new Assembler();this.pending=new Map();this.jobs=new Map();this.closed=false;this.lastResponse=Date.now();}
  async init(){try{this.keys=await createKeys(this.settings.masterKey);this.clientId=this.settings.clientId||crypto.randomUUID();await this.mailbox.check();void this.poll();return this;}catch(error){this.close();throw error;}}
  connection(recovering,message=''){
    this.recovering=recovering;
    this.onConnection?.({recovering,message});
  }
  resume(){
    if(this.closed||!this.session||this.resuming||Date.now()<(this.nextResume||0)||Date.now()<this.mailbox.blockedUntil)return;
    this.nextResume=Date.now()+60000;
    this.connection(true,'正在恢复连接并查询任务状态…');
    // Only repeat a handshake. Never replay code submissions or control commands.
    this.resuming=this.rpc('hello').then(()=>{
      if(!this.closed)this.connection(false);
    }).catch(error=>{
      if(this.closed)return;
      if(/撤销|未获电脑授权|请在电脑管理页面允许编号|凭据已失效|尚未允许远程执行/.test(error.message))this.close(error.message);
      else this.connection(true,'暂未收到电脑回应，将自动重试。请保持电脑开机并联网。');
    }).finally(()=>{this.resuming=null;});
  }
  wake(){
    if(this.closed)return;
    if(this.session&&Date.now()-this.lastResponse>120000)this.resume();
    clearTimeout(this.timer);void this.poll();
  }
  update(data){
    if(data.state){
      this.status=data.state.status;this.summaries=data.state.jobs;
      for(const summary of this.summaries||[]){
        const cached=this.jobs.get(summary.id);
        if(cached&&(cached.status!==summary.status||cached.finishedAt!==summary.finishedAt))this.jobs.delete(summary.id);
      }
    }
    if(data.job)this.jobs.set(data.job.id,data.job);
    if(data.value?.id&&data.value?.status)this.jobs.set(data.value.id,data.value);
    if(data.value?.session)this.session=data.value.session;
    while(this.jobs.size>32)this.jobs.delete(this.jobs.keys().next().value);
    if(data.state)this.onState(data.state);
  }
  async poll(){
    if(this.closed||this.polling)return;this.polling=true;let delay=this.pollMs;
    try{
      for(const row of await this.mailbox.read()){
        if(this.closed)return;
        const packet=this.assembler.accept(row.body,'response');if(!packet)continue;
        let data;try{data=await unseal(this.keys,'response',packet);}catch{continue;}
        if(this.closed)return;
        if(data.clientId!==this.clientId||!Number.isFinite(data.sentAt)||Math.abs(Date.now()-data.sentAt)>180000)continue;
        const pending=this.pending.get(data.id);
        if(!pending&&(!this.session||data.session!==this.session))continue;
        this.lastResponse=Date.now();
        if(data.event==='closed'){this.close(data.error);return;}
        if(!data.error){this.update(data);this.connection(false);}
        if(pending){clearTimeout(pending.timer);this.pending.delete(data.id);data.error?pending.reject(Error(data.error)):pending.resolve(data.value);}
      }
      if(this.session&&Date.now()-this.lastResponse>120000)this.resume();
    }catch(error){
      this.lastError=error.message;
      if(/凭据已失效|专用私有仓库或任务收件箱不可访问/.test(error.message)){this.close(error.message);return;}
      delay=Math.max(15000+Math.floor(Math.random()*5000),this.mailbox.blockedUntil-Date.now());
      if(this.session)this.connection(true, this.mailbox.blockedUntil>Date.now()?'GitHub 暂时限流，等待后自动恢复。':'网络暂时中断，正在等待恢复。');
    }finally{
      this.polling=false;
    }
    if(!this.closed)this.timer=setTimeout(()=>void this.poll(),Math.min(Math.max(delay,1000),3600000));
  }
  async rpc(kind,path='',method='GET',body=null){
    if(this.closed)throw Error('连接已断开。');
    if(this.pending.size>=8)throw Error('待回应请求过多，请等待电脑返回结果。');
    const id=crypto.randomUUID(),now=Date.now();
    const packet=await seal(this.keys,'request',{id,clientId:this.clientId,session:this.session,kind,path,method,body,sentAt:now,expiresAt:now+60000});
    if(this.closed)throw Error('连接已断开。');
    let resolve,reject;const result=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('等待电脑回应超时。任务可能已提交，请先检查电脑，不要连续重复提交。'));},85000);
    this.pending.set(id,{resolve,reject,timer});
    // Attach the rejection handler immediately: sending may itself outlast the reply timer.
    void result.catch(()=>{});
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
  close(reason){this.closed=true;this.session=null;clearTimeout(this.timer);this.mailbox.close();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error(reason||'连接已关闭。'));}this.pending.clear();this.keys=null;this.jobs.clear();this.status=undefined;this.summaries=undefined;if(this.settings){this.settings.token='';this.settings.masterKey='';}if(reason)this.onDisconnect(reason);}
}
