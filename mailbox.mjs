// Browser and Node share this transport. Only ciphertext is written to comments.
const PREFIX='DeviceBridge encrypted v1\n';
const UUID=/^[a-f0-9-]{36}$/;
export function validateSettings(s){
  if(!s||typeof s.owner!=='string'||s.owner.length>39||!/^[-a-zA-Z0-9]+$/.test(s.owner)||typeof s.repo!=='string'||s.repo.length>100||['.','..'].includes(s.repo)||!/^[-a-zA-Z0-9_.]+$/.test(s.repo)||!Number.isSafeInteger(s.issue)||s.issue<1||typeof s.token!=='string'||s.token.length>256||!/^github_pat_[A-Za-z0-9_]+$/.test(s.token))throw Error('请使用专用私有仓库和细粒度 GitHub 访问令牌。');
  return {owner:s.owner,repo:s.repo,issue:s.issue,token:s.token};
}
export function splitPacket(direction,packet,id=crypto.randomUUID()){
  if(!['request','response'].includes(direction)||!UUID.test(id))throw Error('Invalid envelope');
  const text=JSON.stringify(packet);if(text.length>200000)throw Error('加密消息过大。');
  const parts=Math.ceil(text.length/48000);
  return Array.from({length:parts},(_,part)=>PREFIX+JSON.stringify({v:1,id,direction,part,parts,chunk:text.slice(part*48000,(part+1)*48000)}));
}
export class Assembler{
  constructor(){this.groups=new Map();this.done=new Map();}
  accept(body,direction){
    const now=Date.now();for(const [id,g] of this.groups)if(g.expiry<now)this.groups.delete(id);for(const [id,expiry] of this.done)if(expiry<now)this.done.delete(id);
    if(typeof body!=='string'||body.length>50000||!body.startsWith(PREFIX))return;
    let p;try{p=JSON.parse(body.slice(PREFIX.length));}catch{return;}
    if(p.v!==1||p.direction!==direction||!UUID.test(p.id||'')||!Number.isInteger(p.parts)||p.parts<1||p.parts>5||!Number.isInteger(p.part)||p.part<0||p.part>=p.parts||typeof p.chunk!=='string'||p.chunk.length>48000||this.done.has(p.id))return;
    if(!this.groups.has(p.id)){if(this.groups.size>=64)return;this.groups.set(p.id,{parts:p.parts,items:new Map(),expiry:now+120000});}
    const g=this.groups.get(p.id);if(g.parts!==p.parts){this.groups.delete(p.id);return;}
    if(g.items.has(p.part)&&g.items.get(p.part)!==p.chunk){this.groups.delete(p.id);return;}
    g.items.set(p.part,p.chunk);if(g.items.size!==g.parts)return;
    const text=Array.from({length:g.parts},(_,i)=>g.items.get(i)).join('');this.groups.delete(p.id);this.done.set(p.id,now+120000);
    if(this.done.size>512)this.done.delete(this.done.keys().next().value);
    if(text.length>200000)return;try{return JSON.parse(text);}catch{return;}
  }
}
export class GitHubMailbox{
  constructor(settings,{fetcher=globalThis.fetch,base='https://api.github.com',now=()=>Date.now()}={}){
    this.settings=validateSettings(settings);this.fetcher=fetcher.bind(globalThis);this.base=base;this.now=now;
    this.path='/repos/'+settings.owner+'/'+settings.repo;this.since=new Date(now()-15000).toISOString();this.lastId=0;this.blockedUntil=0;this.writes=[];this.lastWrite=0;
    this.closed=false;this.controllers=new Set();this.writeTail=Promise.resolve();
  }
  async api(path,options={}){
    if(this.closed)throw Error('收件箱连接已关闭。');
    if(this.now()<this.blockedUntil)throw Error('GitHub 正在限流，请稍后重试。');
    const controller=new AbortController();this.controllers.add(controller);const timer=setTimeout(()=>controller.abort(),15000);
    try{
    const r=await this.fetcher(this.base+this.path+path,{...options,cache:'no-store',redirect:'error',headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+this.settings.token,'X-GitHub-Api-Version':'2022-11-28',...(options.body?{'Content-Type':'application/json'}:{})},signal:controller.signal});
    if(!r.ok){
      let info;try{info=await r.json();}catch{}
      const message=typeof info?.message==='string'?info.message:'';
      const limited=r.status===429||r.status===403&&(r.headers.get('x-ratelimit-remaining')==='0'||r.headers.has('retry-after')||/rate limit|abuse detection/i.test(message));
      if(limited){const delay=Number(r.headers.get('retry-after')||60)*1000;const reset=Number(r.headers.get('x-ratelimit-reset')||0)*1000;this.blockedUntil=Math.max(this.now()+Math.max(Number.isFinite(delay)?delay:60000,60000),r.headers.get('x-ratelimit-remaining')==='0'&&Number.isFinite(reset)?reset:0);throw Error('GitHub 请求已被限流，请等待额度恢复后重试。');}
      if(r.status===403&&message.includes('Resource not accessible by personal access token'))throw Error('令牌权限不足：请编辑现有令牌，将 devicebridge-mailbox 的 Issues 权限设为 Read and write，再保存。');
      throw Error(r.status===401?'GitHub 凭据已失效，请重新配置。':r.status===404?'专用私有仓库或任务收件箱不可访问，请检查授权。':r.status===403?'GitHub 拒绝此操作（403），请检查仓库权限或账号限制。':'GitHub 请求失败（'+r.status+'）。');
    }
    return r.status===204?null:await r.json();
    }finally{clearTimeout(timer);this.controllers.delete(controller);}
  }
  async check(){
    const repo=await this.api('');if(repo.private!==true)throw Error('任务仓库必须为私有仓库；拒绝写入公开仓库。');
    if(repo.archived)throw Error('任务仓库已归档。');
    const issue=await this.api('/issues/'+this.settings.issue);if(issue.pull_request||issue.state!=='open')throw Error('请使用专用的、未关闭的 Issue 收件箱。');return true;
  }
  async read({commit=true}={}){
    const all=[];
    for(let page=1;page<=10;page++){
      const rows=await this.api('/issues/'+this.settings.issue+'/comments?per_page=100&page='+page+'&since='+encodeURIComponent(this.since));
      if(!Array.isArray(rows))throw Error('GitHub 响应格式异常。');all.push(...rows);if(rows.length<100)break;if(page===10)throw Error('消息积压过多，请创建新的专用收件箱。');
    }
    const fresh=all.filter(row=>row.id>this.lastId).sort((a,b)=>a.id-b.id);
    if(commit)for(const row of fresh)this.ack(row);
    return fresh;
  }
  ack(row){
      this.lastId=Math.max(this.lastId,row.id);
      // GitHub timestamps may have only second precision. Overlap the cursor
      // so a later comment in the same second is not skipped; IDs deduplicate.
      const overlap=Date.parse(row.created_at)-1000;
      if(Number.isFinite(overlap)&&overlap>Date.parse(this.since))this.since=new Date(overlap).toISOString();
  }
  send(direction,packet,messageId=crypto.randomUUID()){
    const send=()=>this.sendSerial(direction,packet,messageId);
    const pending=this.writeTail.then(send,send);this.writeTail=pending.catch(()=>{});return pending;
  }
  async sendSerial(direction,packet,messageId){
    await this.check();
    for(const body of splitPacket(direction,packet,messageId)){
      if(this.closed)throw Error('收件箱连接已关闭。');
      this.writes=this.writes.filter(t=>t>this.now()-3600000);
      if(this.writes.length>=160)throw Error('本端已达到实验版每小时消息额度，请稍后使用。');
      const pause=1200-(this.now()-this.lastWrite);if(pause>0)await new Promise(r=>setTimeout(r,pause));
      // Count attempts too: never retry a timed-out write automatically.
      this.writes.push(this.now());this.lastWrite=this.now();
      await this.api('/issues/'+this.settings.issue+'/comments',{method:'POST',body:JSON.stringify({body})});
    }
  }
  close(){this.closed=true;for(const controller of this.controllers)controller.abort();this.controllers.clear();this.settings.token='';}
}
