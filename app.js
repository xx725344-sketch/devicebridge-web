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
let polling = false, submitting = false;
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000); }
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
  $('run').disabled = !connected || globalThis.bridgeExecutionEnabled === false || !!activeId || submitting;
  $('stop').disabled = !connected || !activeId;
}
function save() {
  try { localStorage.setItem('bridge-draft-v1', JSON.stringify({ source: $('code').value, input: $('stdin').value })); $('saved').textContent = '· 已保存到本机'; }
  catch { $('saved').textContent = '· 浏览器无法保存草稿'; }
}
function lines() {
  const count = $('code').value.split('\n').length;
  $('lineNumbers').textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
  const before = $('code').value.slice(0, $('code').selectionStart).split('\n');
  $('lineInfo').textContent = `第 ${before.length} 行，第 ${before.at(-1).length + 1} 列`;
  $('lineNumbers').scrollTop = $('code').scrollTop;
}
try {
  const draft = JSON.parse(localStorage.getItem('bridge-draft-v1') || 'null');
  $('code').value = typeof draft?.source === 'string' ? draft.source : samples.function.source;
  $('stdin').value = typeof draft?.input === 'string' ? draft.input : '';
} catch { $('code').value = samples.function.source; }
lines();
$('code').addEventListener('input', () => { lines(); save(); });
$('code').addEventListener('click', lines); $('code').addEventListener('keyup', lines);
$('code').addEventListener('scroll', () => { $('lineNumbers').scrollTop = $('code').scrollTop; });
$('stdin').addEventListener('input', save);
$('code').addEventListener('keydown', event => {
  if (event.key === 'Tab') {
    event.preventDefault();
    $('code').setRangeText('    ', $('code').selectionStart, $('code').selectionEnd, 'end');
    lines(); save();
  }
});
$('sample').addEventListener('change', () => {
  const sample = samples[$('sample').value]; if (!sample) return;
  if ($('code').value.trim() && !Object.values(samples).some(x => x.source === $('code').value) && !confirm('载入示例会替换当前代码。需要保留时，请先下载代码。继续载入？')) { $('sample').value = ''; return; }
  $('code').value = sample.source; $('stdin').value = sample.input;
  $('code').scrollTop = 0; lines(); save(); $('sample').value = '';
});
$('download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([$('code').value], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'main.c'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
function render(job) {
  $('jobStatus').textContent = labels[job.status] || job.status;
  $('jobStatus').className = `status-pill ${!job.finishedAt ? 'busy' : job.status === 'success' ? 'good' : 'bad'}`;
  const chunks = [];
  if (job.compileLog) chunks.push('── 编译信息 ──\n' + job.compileLog);
  if (job.stdout) chunks.push(job.stdout);
  if (job.stderr) chunks.push('── 程序错误 ──\n' + job.stderr);
  if (job.status === 'timeout') chunks.push('程序超过时限，已终止。请检查循环或递归的结束条件。');
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
  $('history').replaceChildren();
  if (!data.jobs.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = '还没有运行记录。试试你的第一个函数。'; $('history').append(p); }
  for (const job of data.jobs) {
    const row = document.createElement('button'); row.className = 'history-row';
    const name = document.createElement('span'); name.textContent = `${job.status === 'success' ? '✓' : job.finishedAt ? '·' : '↻'}  main.c · ${labels[job.status] || job.status}`;
    const time = document.createElement('span'); time.className = 'time'; time.textContent = new Date(job.createdAt).toLocaleTimeString('zh-CN');
    row.append(name, time); row.addEventListener('click', async () => {
      try { const latest = await api(`/api/jobs/${job.id}`); selectedId = job.id; render(latest); }
      catch (error) { toast(error.message); }
    }); $('history').append(row);
  }
}
async function refresh() {
  const data = await api('/api/status');
  setConnected(true); $('pairOverlay').hidden = true;
  $('networkBadge').textContent = data.mode === 'github' ? '● GitHub 加密任务 · 有延迟' : data.mode === 'cloud' ? '● 云端中转 · 内容加密' : data.mode === 'tailscale' ? '● 跨网络 · Tailscale' : '● 局域网连接';
  $('deviceName').textContent = data.name; $('compilerInfo').textContent = data.compiler;
  const previous = activeId; activeId = data.activeJob;
  if (activeId && activeId !== previous) selectedId = activeId;
  if (activeId) schedulePoll(); buttons();
  await history();
}
function schedulePoll() { clearTimeout(pollTimer); pollTimer = setTimeout(poll, 450); }
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

globalThis.addEventListener('bridge-state',()=>buttons());
