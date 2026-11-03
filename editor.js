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
  function newline(source, start, end) {
    const left = source.slice(0, start), right = source.slice(end);
    const line = left.slice(left.lastIndexOf('\n') + 1);
    const indent = /^[\t ]*/.exec(line)[0];
    const open = line.trimEnd().endsWith('{');
    const inside = indent + (open ? '    ' : '');
    const paired = open && /^\s*}/.test(right);
    return { text: '\n' + inside + (paired ? '\n' + indent : ''), caret: 1 + inside.length };
  }
  return {highlight, newline};
})();
