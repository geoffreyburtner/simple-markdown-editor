'use strict';

// LaTeX math for marked, rendered with KaTeX.
//
// Supported syntax:
//   Inline:   $...$   \(...\)
//   Display:  $$...$$   \[...\]   and fenced ```math blocks
//   Chemistry via mhchem:  $\ce{H2O}$   $\pu{123 kJ/mol}$
//
// `$` follows the Pandoc rule so prices like "$5 and $10" stay plain text:
// the opening `$` must be followed by a non-space, the closing `$` preceded by
// a non-space and not followed by a digit. A literal dollar sign is `\$`.

const katex = require('katex');
require('katex/contrib/mhchem');

// Rendering is pure, and the preview re-renders the whole document on every
// edit, so memoize by (mode, source).
const cache = new Map();
const CACHE_LIMIT = 500;

function renderTex(tex, displayMode) {
  const key = `${displayMode ? 'D' : 'I'}${tex}`;
  let html = cache.get(key);
  if (html === undefined) {
    html = katex.renderToString(tex, {
      displayMode,
      throwOnError: false, // show the bad source in red instead of throwing
      output: 'html',      // MathML is stripped by DOMPurify; HTML alone renders fine
      strict: 'ignore',
      trust: false
    });
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(key, html);
  }
  return html;
}

const BLOCK_RULES = [
  /^ {0,3}(`{3,}|~{3,})math[ \t]*\n([\s\S]*?)\n {0,3}\1[ \t]*(?:\n+|$)/,
  /^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/,
  /^ {0,3}\\\[([\s\S]+?)\\\][ \t]*(?:\n+|$)/
];

const blockMath = {
  name: 'blockMath',
  level: 'block',
  tokenizer(src) {
    for (const rule of BLOCK_RULES) {
      const m = rule.exec(src);
      if (m) {
        // The fenced rule captures the fence in group 1 and the body in group 2.
        const text = (m.length > 2 ? m[2] : m[1]).trim();
        return { type: 'blockMath', raw: m[0], text };
      }
    }
    return undefined;
  },
  renderer(token) {
    return `<div class="math-display">${renderTex(token.text, true)}</div>\n`;
  }
};

const INLINE_DISPLAY = /^\$\$((?:\\[\s\S]|[^\\$])+?)\$\$/;
const INLINE_PAREN = /^\\\(([\s\S]+?)\\\)/;
const INLINE_BRACKET = /^\\\[([\s\S]+?)\\\]/;
const INLINE_DOLLAR = /^\$((?:\\[\s\S]|[^\\$])+?)\$(?!\d)/;

const inlineMath = {
  name: 'inlineMath',
  level: 'inline',
  start(src) {
    const m = src.match(/\$|\\[([]/);
    return m ? m.index : undefined;
  },
  tokenizer(src) {
    let m;
    if ((m = INLINE_DISPLAY.exec(src)) || (m = INLINE_BRACKET.exec(src))) {
      return { type: 'inlineMath', raw: m[0], text: m[1].trim(), displayMode: true };
    }
    if ((m = INLINE_PAREN.exec(src))) {
      return { type: 'inlineMath', raw: m[0], text: m[1].trim(), displayMode: false };
    }
    if ((m = INLINE_DOLLAR.exec(src))) {
      const body = m[1];
      if (/^\s|\s$/.test(body) || /\n\s*\n/.test(body)) return undefined;
      return { type: 'inlineMath', raw: m[0], text: body, displayMode: false };
    }
    return undefined;
  },
  renderer(token) {
    return renderTex(token.text, token.displayMode);
  }
};

module.exports = { mathExtension: { extensions: [blockMath, inlineMath] } };
