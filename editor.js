'use strict';
// Local, dependency-free C highlighting. Source text is always HTML-escaped.
globalThis.bridgeEditor = (() => {
  const escape = s => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function highlight(source) {
    const pattern = /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|"(?:\\[\s\S]|[^"\\])*"?|'(?:\\[\s\S]|[^'\\])*'?|^\s*#[^\n]*|\b(?:int|void|char|short|long|float|double|signed|unsigned|const|static|extern|struct|union|enum|typedef|return|if|else|for|while|do|switch|case|default|break|continue|sizeof|volatile|restrict|inline|_Bool)\b|\b\d+(?:\.\d+)?\b|[{}()[\]]/gm;
    let html = '', offset = 0; const stack = [], pairs = {')':'(',']':'[','}':'{'};
    for (const match of source.matchAll(pattern)) {
      const text = match[0]; html += escape(source.slice(offset, match.index)); offset = match.index + text.length;
      let cls = '';
      if (/^[({\[]$/.test(text)) { cls = 'bracket-' + stack.length % 3; stack.push(text); }
      else if (pairs[text]) { if (stack.at(-1) === pairs[text]) { stack.pop(); cls = 'bracket-' + stack.length % 3; } else cls = 'bracket-error'; }
      else if (text.startsWith('//') || text.startsWith('/*')) cls = 'token-comment';
      else if (/^["']/.test(text)) cls = 'token-string';
      else if (/^\s*#/.test(text)) cls = 'token-directive';
      else cls = /^\d/.test(text) ? 'token-number' : 'token-keyword';
      html += `<span class="${cls}">${escape(text)}</span>`;
    }
    return html + escape(source.slice(offset)) + '\n';
  }
  function context(source) {
    const blocks=[];let state='code',lineStart=0,lastToken='';
    for(let i=0;i<source.length;i++){
      const c=source[i],next=source[i+1];
      if(c==='\n'){lineStart=i+1;if(state==='line')state='code';if(state==='directive'&&source[i-1]!=='\\')state='code';continue;}
      if(state==='line'||state==='directive')continue;
      if(state==='comment'){if(c==='*'&&next==='/'){state='code';i++;}continue;}
      if(state==='"'||state==="'"){if(c==='\\'){i++;continue;}if(c===state)state='code';continue;}
      if(c==='/'&&next==='/'){state='line';i++;continue;}
      if(c==='/'&&next==='*'){state='comment';i++;continue;}
      if(c==='"'||c==="'"){state=c;lastToken='literal';continue;}
      if(c==='#'&&/^[\t ]*$/.test(source.slice(lineStart,i))){state='directive';continue;}
      if(!/\s/.test(c))lastToken=c;
      if(c==='{'){
        const leading=/^[\t ]*/.exec(source.slice(lineStart))[0].replace(/\t/g,'    ').length;
        blocks.push(blocks.length?blocks.at(-1)+4:leading);
      }else if(c==='}')blocks.pop();
    }
    return {blocks,state,lastToken};
  }
  function newline(source, start, end) {
    const left = source.slice(0, start), right = source.slice(end);
    const line = left.slice(left.lastIndexOf('\n') + 1);
    const indent = /^[\t ]*/.exec(line)[0];
    const ctx=context(left);
    const open = !['comment','"',"'",'directive'].includes(ctx.state)&&ctx.lastToken==='{';
    const structural=ctx.blocks.length?' '.repeat(ctx.blocks.at(-1)+4):'';
    const inside = ['comment','"',"'",'directive'].includes(ctx.state)?indent:(ctx.blocks.length?structural:(ctx.lastToken==='}'?'':indent));
    const paired = open && /^\s*}/.test(right);
    const outer=ctx.blocks.length?' '.repeat(ctx.blocks.at(-1)):indent;
    return { text: '\n' + inside + (paired ? '\n' + outer : ''), caret: 1 + inside.length };
  }
  function closingBrace(source,start,end){
    if(start!==end)return null;
    const lineStart=source.lastIndexOf('\n',start-1)+1;
    if(!/^[\t ]*$/.test(source.slice(lineStart,start)))return null;
    const ctx=context(source.slice(0,start));
    if(ctx.state!=='code'||!ctx.blocks.length)return null;
    const text=' '.repeat(ctx.blocks.at(-1))+'}';
    return {start:lineStart,end,text,caret:lineStart+text.length};
  }
  return {highlight, newline, closingBrace};
})();
