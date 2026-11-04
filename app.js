'use strict';
const $ = id => document.getElementById(id);
const samples = {
  hello: { source: '#include <stdio.h>\n\nint main(void) {\n    printf("Hello, iPad!\\n");\n    printf("My computer is running this code.\\n");\n    return 0;\n}\n', input: '' },
  function: { source: '// 定义一个函数：接收两个整数，返回它们的和\n#include <stdio.h>\n\nint add(int a, int b) {\n    return a + b;\n}\n\nint main(void) {\n    int result = add(3, 5);\n    printf("3 + 5 = %d\\n", result);\n    return 0;\n}\n', input: '' },
  input: { source: '// 先在右侧的「程序输入」中填写一个整数\n#include <stdio.h>\n\nint square(int n) {\n    return n * n;\n}\n\nint main(void) {\n    int number;\n    if (scanf("%d", &number) != 1) {\n        printf("Please enter an integer.\\n");\n        return 1;\n    }\n    if (number < -1000 || number > 1000) {\n        printf("Please use a number from -1000 to 1000.\\n");\n        return 1;\n    }\n    printf("%d squared = %d\\n", number, square(number));\n    return 0;\n}\n', input: '7\n' },
  recursion: { source: '// 函数调用自己：计算阶乘\n#include <stdio.h>\n\nlong long factorial(int n) {\n    if (n <= 1) {\n        return 1;\n    }\n    return n * factorial(n - 1);\n}\n\nint main(void) {\n    int n;\n    if (scanf("%d", &n) != 1 || n < 0 || n > 20) {\n        printf("Please enter a number from 0 to 20.\\n");\n        return 1;\n    }\n    printf("%d! = %lld\\n", n, factorial(n));\n    return 0;\n}\n', input: '5\n' },
};
const labels = { queued: '等待执行', compiling: '正在编译', running: '正在运行', success: '运行成功', compile_error: '编译失败', runtime_error: '程序异常', timeout: '运行超时', cancelled: '已停止', output_limit: '输出已达上限', error: '执行失败' };
let connected = false, activeId = null, selectedId = null, pollTimer, toastTimer;
let polling = false, submitting = false, refreshing = false;
let pendingFinalId = null, fetchingFinal = false;
function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  for(const [panel,status] of [['libraryDialog','libraryStatus'],['toolsDialog','toolsStatus']])if($(panel).open)$(status).textContent=message;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
}
async function api(url, options = {}) {
  if (globalThis.bridgeTransport) return globalThis.bridgeTransport(url, options);
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && url !== '/api/pair') { setConnected(false); $('pairOverlay').hidden = false; }
    throw new Error(data.error || '连接失败，请重试。');
  }
  return data;
}
function setConnected(value) {
  connected = value;
  $('connectionDot').classList.toggle('online', value);
  $('connectionState').textContent = value ? '已连接 · 电脑负责运行' : $('pairOverlay').hidden ? '连接中断 · 请检查电脑' : '等待配对 · 查看电脑启动窗口';
  $('logout').hidden = !value;
  buttons();
}
function buttons() {
  $('sendToComputer').disabled = !connected || globalThis.bridgeLinkRecovering === true || globalThis.bridgeExecutionEnabled === false || sendingFile;
  $('run').disabled = !connected || globalThis.bridgeExecutionEnabled === false || globalThis.bridgeLinkRecovering === true || !!activeId || submitting;
  $('stop').disabled = !connected || !activeId;
  if(globalThis.bridgeLinkRecovering){$('connectionState').textContent = globalThis.bridgeLinkMessage || '正在恢复连接…';$('connectionDot').classList.toggle('online',false);}
}
function save() {
  const item = library.items.find(x => x.id === library.active);
  item.source = $('code').value; item.input = $('stdin').value;
  try { localStorage.setItem('bridge-library-v1', JSON.stringify(library)); $('saved').textContent = '· 已保存到此浏览器'; return true; }
  catch { $('saved').textContent = '· 保存失败，请下载代码备份'; return false; }
}
function lines() {
  if(globalThis.bridgeEditor){$('codeHighlight').innerHTML=globalThis.bridgeEditor.highlight($('code').value);syncEditorScroll();}
  const count = $('code').value.split('\n').length;
  $('lineNumbers').textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
  const before = $('code').value.slice(0, $('code').selectionStart).split('\n');
  $('lineInfo').textContent = `第 ${before.length} 行，第 ${before.at(-1).length + 1} 列`;
  $('lineNumbers').scrollTop = $('code').scrollTop;
}
let library;
let sendingFile = false;
try {
  const stored = JSON.parse(localStorage.getItem('bridge-library-v1') || 'null');
  if (stored && Array.isArray(stored.items) && stored.items.length && stored.items.every(x => typeof x.id === 'string' && typeof x.name === 'string' && typeof x.source === 'string' && typeof x.input === 'string') && stored.items.some(x => x.id === stored.active)) library = stored;
} catch {}
if (!library) {
  let draft;
  try { draft = JSON.parse(localStorage.getItem('bridge-draft-v1') || 'null'); } catch {}
  library = { active: 'original', items: [{ id: 'original', name: '原有练习.c', source: typeof draft?.source === 'string' ? draft.source : samples.function.source, input: typeof draft?.input === 'string' ? draft.input : '' }] };
}
function showDocument() {
  const item = library.items.find(x => x.id === library.active);
  $('code').value = item.source; $('stdin').value = item.input;
  $('fileName').textContent = item.name;
  $('documents').replaceChildren(...library.items.map(x => { const option = document.createElement('option'); option.value = x.id; option.textContent = x.name; return option; }));
  $('documents').value = item.id; $('code').scrollTop = 0; lines();
  renderLibrary();
}
function renderLibrary() {
  const term=$('findDocument').value.trim().toLocaleLowerCase();
  const matches=library.items.filter(item=>item.name.toLocaleLowerCase().includes(term));
  $('libraryCount').textContent=String(library.items.length);
  $('libraryEmpty').hidden=matches.length>0;
  $('libraryList').replaceChildren(...matches.map(item=>{
    const button=document.createElement('button');
    button.type='button';button.className='document-card';
    button.setAttribute('aria-pressed',String(item.id===library.active));
    const name=document.createElement('strong');name.textContent=item.name;
    const detail=document.createElement('span');
    detail.textContent=(item.id===library.active?'正在编辑 · ':'')+item.source.split('\n').length+' 行';
    button.append(name,detail);
    button.addEventListener('click',()=>{
      if(!save())return toast('当前代码未保存，请先下载备份。');
      library.active=item.id;showDocument();save();
      closePanel('libraryDialog');$('code').focus();
    });
    return button;
  }));
}
let panelOpener;
function openPanel(id,opener){
  for(const other of ['libraryDialog','toolsDialog'])if(other!==id&&$(other).open)closePanel(other);
  panelOpener=opener;
  $(id==='libraryDialog'?'libraryStatus':'toolsStatus').textContent='';
  if(id==='libraryDialog')renderLibrary();
  const panel=$(id);
  if(typeof panel.showModal==='function')panel.showModal();
  else {panel.setAttribute('open','');panel.setAttribute('role','dialog');}
  $(id==='libraryDialog'?'findDocument':'closeTools').focus();
}
function closePanel(id){
  const panel=$(id);
  if(typeof panel.close==='function')panel.close();else panel.removeAttribute('open');
  panelOpener?.focus();
}
for(const [opener,panel,closer] of [['openLibrary','libraryDialog','closeLibrary'],['openTools','toolsDialog','closeTools']]){
  $(opener).addEventListener('click',()=>openPanel(panel,$(opener)));
  $(closer).addEventListener('click',()=>closePanel(panel));
  $(panel).addEventListener('click',event=>{if(event.target===$(panel)){
    const box=$(panel).getBoundingClientRect();
    if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)closePanel(panel);
  }});
  $(panel).addEventListener('cancel',()=>{panelOpener?.focus();});
}
function newDocument(source = '', input = '', suggested = '新练习.c') {
  if (!save()) return toast('当前代码未保存，请先下载备份。');
  if (library.items.length >= 100) return toast('最多保存 100 份练习，请先下载备份并整理。');
  let name = prompt('给这份练习起个名字', suggested);
  if (name === null) return;
  name = name.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 80);
  if (!name) return toast('请填写练习名称。');
  if (!name.endsWith('.c')) name += '.c';
  const previous = library.active;
  const item = { id: crypto.randomUUID(), name, source, input };
  library.items.push(item); library.active = item.id; showDocument();
  if (!save()) { library.items.pop(); library.active = previous; showDocument(); return toast('保存空间不足，未新建。原有练习已保留。'); }
  $('code').focus();
  closePanel('libraryDialog');closePanel('toolsDialog');$('code').focus();
}
showDocument(); save();
$('newCode').addEventListener('click', () => newDocument());
$('duplicateCode').addEventListener('click',()=>newDocument($('code').value,$('stdin').value,library.items.find(x=>x.id===library.active).name.replace(/\.c$/, ' 副本.c')));
$('findDocument').addEventListener('input',()=>{
  const term=$('findDocument').value.trim().toLocaleLowerCase();
  $('documents').replaceChildren(...library.items.filter(x=>x.id===library.active||x.name.toLocaleLowerCase().includes(term)).map(x=>{
    const option=document.createElement('option');option.value=x.id;option.textContent=x.name;return option;
  }));
  $('documents').value=library.active;
  renderLibrary();
});
$('focusEditor').addEventListener('click',()=>{
  const focused=document.body.classList.toggle('editor-focused');
  $('focusEditor').textContent=focused?'退出专注':'专注编辑';$('focusEditor').setAttribute('aria-pressed',String(focused));
});
$('fontSize').addEventListener('change',()=>{
  const value=Number($('fontSize').value);if(![13,15,16,17,19].includes(value))return;
  document.documentElement.style.setProperty('--editor-size',value+'px');
});
for(const button of document.querySelectorAll('[data-insert]')){
  button.addEventListener('pointerdown',event=>event.preventDefault());
  button.addEventListener('click',()=>{
    const editor=$('code'),text=button.dataset.insert;
    const start=editor.selectionStart,end=editor.selectionEnd,selected=editor.value.slice(start,end);
    const pair=text.length===2&&['{}','()','[]','""'].includes(text);
    editor.setRangeText(pair?text[0]+selected+text[1]:text,start,end,'end');
    if(pair)editor.setSelectionRange(start+1,start+1+selected.length);
    editor.focus();lines();save();
  });
}
$('documents').addEventListener('change', () => {
  const next = $('documents').value;
  if (!save()) { $('documents').value = library.active; return toast('当前代码未保存，请先下载备份。'); }
  library.active = next; showDocument(); save();
});
$('renameCode').addEventListener('click', () => {
  const item = library.items.find(x => x.id === library.active);
  const name = prompt('新的练习名称', item.name);
  if (!name?.trim()) return;
  item.name = name.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 80);
  if (!item.name.endsWith('.c')) item.name += '.c';
  save(); showDocument();
});
$('importCode').addEventListener('click', () => $('codeFile').click());
$('codeFile').addEventListener('change', async () => {
  const file = $('codeFile').files[0]; $('codeFile').value = '';
  if (!file) return;
  if (file.size > 60000) return toast('请选择不超过 60 KB 的 C 文件。');
  try { newDocument(await file.text(), '', file.name); } catch { toast('读取文件失败。'); }
});
$('writeOffline').addEventListener('click', () => { $('pairOverlay').hidden = true; setConnected(false); });
$('connectAgain').addEventListener('click', () => { closePanel('toolsDialog'); $('pairOverlay').hidden = false; $('pairCode').focus(); });
lines();
$('code').addEventListener('input', () => { lines(); save(); });
$('code').addEventListener('click', lines); $('code').addEventListener('keyup', lines);
function syncEditorScroll(){const layer=$('codeHighlight');if(layer){layer.scrollTop=$('code').scrollTop;layer.scrollLeft=$('code').scrollLeft;}}
$('code').addEventListener('scroll', () => { $('lineNumbers').scrollTop = $('code').scrollTop; syncEditorScroll(); });
$('stdin').addEventListener('input', save);
$('insertHeader').addEventListener('click',()=>{
  const name=$('headerSelect').value;
  if(!/^[a-z0-9]+\.h$/.test(name))return;
  const directive=`#include <${name}>`;
  if($('code').value.includes(directive))return toast('这份代码已经包含该头文件。');
  $('code').setRangeText(directive+'\n',0,0,'end');lines();save();
  closePanel('toolsDialog');$('code').focus();
});
function insertNewline(event){
  if(event.isComposing||event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||!globalThis.bridgeEditor)return;
  event.preventDefault();const editor=$('code'),start=editor.selectionStart;
  const edit=globalThis.bridgeEditor.newline(editor.value,start,editor.selectionEnd);
  editor.setRangeText(edit.text,start,editor.selectionEnd,'end');
  editor.setSelectionRange(start+edit.caret,start+edit.caret);lines();save();
}
function insertClosingBrace(event){
  if(event.isComposing||event.defaultPrevented||!globalThis.bridgeEditor)return;
  const editor=$('code'),edit=globalThis.bridgeEditor.closingBrace(editor.value,editor.selectionStart,editor.selectionEnd);
  if(!edit)return;
  event.preventDefault();editor.setRangeText(edit.text,edit.start,edit.end,'end');
  editor.setSelectionRange(edit.caret,edit.caret);lines();save();
}
$('code').addEventListener('beforeinput',event=>{
  if(event.inputType==='insertText'&&event.data==='}'&&event.cancelable!==false)return insertClosingBrace(event);
  if(event.inputType==='insertLineBreak'||event.inputType==='insertParagraph')insertNewline(event);
});
$('code').addEventListener('keydown', event => {
  if(event.key==='}'&&!event.ctrlKey&&!event.metaKey&&!event.altKey)return insertClosingBrace(event);
  if(event.key==='Enter')return insertNewline(event);
  if (event.key === 'Tab') {
    event.preventDefault();
    $('code').setRangeText('    ', $('code').selectionStart, $('code').selectionEnd, 'end');
    lines(); save();
  }
});
$('sample').addEventListener('change', () => {
  const sample = samples[$('sample').value]; if (!sample) return;
  newDocument(sample.source, sample.input, $('sample').selectedOptions[0].textContent + '.c'); $('sample').value = '';
});
$('download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([$('code').value], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = library.items.find(x => x.id === library.active).name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
$('selectAllCode').addEventListener('click',()=>{
  const editor=$('code');editor.focus();editor.setSelectionRange(0,editor.value.length);lines();
  toast('已全选当前代码。');
});
$('copyCode').addEventListener('click',async()=>{
  const source=$('code').value;
  if(!source)return toast('当前还没有代码。');
  try{
    if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');
    await navigator.clipboard.writeText(source);toast('代码已复制，可以粘贴提交作业。');
  }catch{
    const editor=$('code');editor.focus();editor.setSelectionRange(0,source.length);lines();
    toast('浏览器未允许自动复制，已全选代码，请长按选区选择“复制”。');
  }
});
$('sendToComputer').addEventListener('click',async()=>{
  if(sendingFile||!connected)return;
  const item=library.items.find(x=>x.id===library.active);
  const name=item.name,source=$('code').value;
  if(!source.trim())return toast('先写代码，再发送到电脑。');
  sendingFile=true;buttons();$('sendStatus').textContent='正在发送，请等待电脑确认…';
  try{
    const result=await api('/api/files',{method:'POST',body:JSON.stringify({name,source})});
    $('sendStatus').textContent='电脑已保存：'+result.path;toast('代码已保存到电脑。');
  }catch(error){$('sendStatus').textContent=error.message+' 如回应超时，请先检查电脑接收文件夹，避免重复发送。';}
  finally{sendingFile=false;buttons();}
});
function render(job) {
  $('jobStatus').textContent = labels[job.status] || job.status;
  $('jobStatus').className = `status-pill ${!job.finishedAt ? 'busy' : job.status === 'success' ? 'good' : 'bad'}`;
  const chunks = [];
  if (job.compileLog) chunks.push('── 编译信息 ──\n' + job.compileLog);
  if (job.stdout) chunks.push(job.stdout);
  if (job.stderr) chunks.push('── 程序错误 ──\n' + job.stderr);
  if (job.status === 'timeout') {
    $('jobStatus').textContent = job.timeoutPhase === 'compiling' ? '编译超时' : '运行超时';
    chunks.push(job.timeoutPhase === 'compiling'
      ? `编译超过 ${job.timeLimitSeconds || 60} 秒，已终止。请检查源码或电脑负载。`
      : `运行超过 ${job.timeLimitSeconds || '所选'} 秒，已终止。可选择更长运行时限；也请检查循环、递归和输入数据。`);
  }
  if (job.status === 'cancelled') chunks.push('你已停止这个任务。');
  if (job.status === 'output_limit') chunks.push('输出超过 64 KB，已终止程序。请检查是否在不停打印。');
  if (!chunks.length) chunks.push(job.finishedAt ? '程序没有文字输出。' : '电脑正在处理，请稍候…');
  $('output').textContent = chunks.join('\n\n');
  $('output').hidden = false; $('emptyOutput').hidden = true;
  $('resultMeta').textContent = job.finishedAt
    ? `耗时 ${(job.duration / 1000).toFixed(2)} 秒（含编译） · 退出码 ${job.exitCode ?? '—'} · ${new Date(job.createdAt).toLocaleTimeString('zh-CN')}`
    : '任务在你的电脑上执行，请保持电脑开机';
}
async function history() {
  const data = await api('/api/jobs');
  renderInsights(data.jobs);
  $('history').replaceChildren();
  if (!data.jobs.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = '暂无运行记录。'; $('history').append(p); }
  for (const job of data.jobs) {
    const row = document.createElement('button'); row.className = 'history-row';
    const name = document.createElement('span'); name.textContent = `${job.status === 'success' ? '✓' : job.finishedAt ? '·' : '↻'}  main.c · ${labels[job.status] || job.status}`;
    const time = document.createElement('span'); time.className = 'time'; time.textContent = new Date(job.createdAt).toLocaleTimeString('zh-CN');
    row.append(name, time); row.addEventListener('click', async () => {
      try { const latest = await api(`/api/jobs/${job.id}`); selectedId = job.id; render(latest); closePanel('toolsDialog'); $('output').scrollIntoView?.({block:'nearest'}); }
      catch (error) { toast(error.message); }
    }); $('history').append(row);
  }
}
function renderInsights(jobs){
  const finished=jobs.filter(j=>j.finishedAt);
  const success=finished.filter(j=>j.status==='success').length;
  const durations=finished.map(j=>j.duration).filter(n=>Number.isFinite(n)&&n>=0);
  $('runSummary').textContent=finished.length?`完成 ${finished.length} 次 · 成功 ${success} 次 · 其他 ${finished.length-success} 次 · 平均耗时 ${durations.length?(durations.reduce((a,b)=>a+b,0)/durations.length/1000).toFixed(2):'—'} 秒`:'尚无运行数据。连接电脑并运行代码后，这里会生成统计。';
  const chart=$('runChart');chart.replaceChildren();
  const recent=finished.slice(0,12).reverse();
  chart.setAttribute('aria-label',recent.length?'最近 '+recent.length+' 次任务耗时（含编译），从左到右由旧到新':'暂无任务耗时数据');
  const maximum=Math.max(1000,...recent.map(j=>Number(j.duration)||0));
  for(const [i,job] of recent.entries()){
    const bar=document.createElementNS('http://www.w3.org/2000/svg','rect');
    const height=Math.max(3,(Number(job.duration)||0)/maximum*64);
    for(const [key,value] of Object.entries({x:10+i*24,y:76-height,width:15,height,rx:4,fill:job.status==='success'?'#3478df':'#c45659'}))bar.setAttribute(key,String(value));
    const title=document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent=`${labels[job.status]||job.status} · ${((Number(job.duration)||0)/1000).toFixed(2)} 秒`;bar.append(title);chart.append(bar);
  }
}
async function refresh() {
  if(refreshing)return;
  refreshing=true;
  try{
  const data = await api('/api/status');
  setConnected(true); $('pairOverlay').hidden = true;
  $('networkBadge').textContent = data.mode === 'github' ? '● GitHub 加密任务 · 有延迟' : data.mode === 'cloud' ? '● 云端中转 · 内容加密' : data.mode === 'tailscale' ? '● 跨网络 · Tailscale' : '● 局域网连接';
  $('deviceName').textContent = data.name; $('compilerInfo').textContent = data.compiler + (data.isolation ? ' · '+data.isolation : '');
  const previous = activeId; activeId = data.activeJob;
  if (activeId && activeId !== previous) selectedId = activeId;
  if(previous&&!activeId&&selectedId===previous)pendingFinalId=previous;
  if(pendingFinalId&&!fetchingFinal){
    const id=pendingFinalId;fetchingFinal=true;
    try{const job=await api(`/api/jobs/${id}`);if(selectedId===id)render(job);if(job.finishedAt&&pendingFinalId===id)pendingFinalId=null;}catch{}
    finally{fetchingFinal=false;}
  }
  if (activeId) schedulePoll(); buttons();
  await history();
  }finally{refreshing=false;}
}
function schedulePoll() { clearTimeout(pollTimer); pollTimer = setTimeout(poll, globalThis.bridgeTransport ? 2000 : 450); }
async function poll() {
  if (!activeId || polling) return;
  polling = true;
  try {
    const id = activeId; const job = await api(`/api/jobs/${id}`);
    setConnected(true);
    if (selectedId === id) render(job);
    if (job.finishedAt && activeId === id) { activeId = null; buttons(); await history(); }
  } catch (error) { setConnected(false); $('resultMeta').textContent = '连接中断；电脑端任务可能仍在执行，恢复连接后会更新。'; }
  finally { polling = false; if (activeId && connected) schedulePoll(); }
}
$('pairForm').addEventListener('submit', async event => {
  event.preventDefault(); $('pairError').textContent = ''; $('pairButton').disabled = true;
  try {
    await api('/api/pair', { method: 'POST', body: JSON.stringify({ code: $('pairCode').value.trim() }) });
    $('pairCode').value = ''; await refresh(); toast('已连接电脑，可以开始写 C 了。');
  } catch (error) { $('pairError').textContent = error.message; }
  finally { $('pairButton').disabled = false; }
});
$('run').addEventListener('click', async () => {
  if (activeId || !connected || submitting) return;
  if (!$('code').value.trim()) return toast('先写一点 C 代码，再运行吧。');
  submitting = true; buttons();
  try {
    const job = await api('/api/jobs', { method: 'POST', body: JSON.stringify({ source: $('code').value, input: $('stdin').value, seconds: Number($('seconds').value) }) });
    activeId = job.id; selectedId = job.id; render(job); schedulePoll();
  } catch (error) { toast(error.message); try { await refresh(); } catch {} }
  finally { submitting = false; buttons(); }
});
$('stop').addEventListener('click', async () => {
  if (!activeId) return;
  try { await api(`/api/jobs/${activeId}/stop`, { method: 'POST', body: '{}' }); schedulePoll(); }
  catch (error) { toast(error.message); }
});
$('logout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST', body: '{}' }); }
  catch (error) { return toast(error.message); }
  setConnected(false); activeId = null; clearTimeout(pollTimer); $('pairOverlay').hidden = false; $('pairCode').focus();
});
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); if (!$('run').disabled) $('run').click(); } });
globalThis.addEventListener('bridge-disconnected', event => {
  activeId = null; clearTimeout(pollTimer); $('pairOverlay').hidden = false;
  setConnected(false); $('pairError').textContent = event.detail || '请重新连接电脑。';
});
// 已有 cookie 时自动恢复；网络断开后定期尝试重新连接。
refresh().catch(() => { $('pairOverlay').hidden = false; });
setInterval(() => { if ($('pairOverlay').hidden) refresh().catch(() => setConnected(false)); }, 8000);

globalThis.addEventListener('bridge-state',()=>setConnected(connected));
