const fs = require('fs');
const https = require('https');
const readline = require('readline');

const TOKEN_PATH = process.env.USERPROFILE + '/.aws/sso/cache/kiro-auth-token.json';
const HOST = 'runtime.us-east-1.kiro.dev';
const MAX_CTX = 8000;
const MAX_ITERS = 14;

let VERBOSE = process.argv.includes('-e') || process.argv.includes('--evidence') || process.env.ORACLE_EVIDENCE === '1';

let tok;
function loadTok() {
  try { tok = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')); }
  catch { console.error('token file missing:', TOKEN_PATH); process.exit(1); }
}
loadTok();
if (Date.now() > new Date(tok.expiresAt).getTime())
  console.error('[warn] access token expired — open Kiro once to refresh it\n');

function completion(leftFileContent, lang = 'javascript') {
  const ext = { javascript: 'q.js', python: 'q.py', shell: 'q.sh', bash: 'q.sh', sql: 'q.sql', java: 'q.java', cpp: 'q.cpp', typescript: 'q.ts' }[lang] || 'q.js';
  const body = JSON.stringify({
    fileContext: {
      leftFileContent, rightFileContent: '',
      filename: ext,
      programmingLanguage: { languageName: lang }
    },
    maxResults: 1,
    profileArn: tok.profileArn
  });
  return new Promise((resolve) => {
    const t0 = Date.now();
    const r = https.request({
      hostname: HOST, path: '/generatecompletions', method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + tok.accessToken,
        'Content-Type': 'application/json',
        'x-amzn-kiro-profile-arn': tok.profileArn,
        'x-amzn-kiro-origin': 'AI_EDITOR',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        const rid = res.headers['x-amzn-requestid'] || res.headers['x-amz-requestid'] || '-';
        if (VERBOSE) console.log(`  [evidence] POST ${HOST}/generatecompletions → HTTP ${res.statusCode}  rid=${rid}  ${Date.now() - t0}ms`);
        try { resolve({ status: res.statusCode, data: JSON.parse(b) }); }
        catch { resolve({ status: res.statusCode, raw: b }); }
      });
    });
    r.on('error', e => resolve({ status: 0, error: e.message }));
    r.setTimeout(15000, () => { r.destroy(); resolve({ status: 0, error: 'timeout' }); });
    r.end(body);
  });
}

function usageLine() {
  return new Promise((resolve) => {
    const q = 'origin=AI_EDITOR&resourceType=AGENTIC_REQUEST&isEmailRequired=false&profileArn=' + encodeURIComponent(tok.profileArn || '');
    https.get({
      hostname: 'q.us-east-1.amazonaws.com',
      path: '/getUsageLimits?' + q,
      headers: { 'Authorization': 'Bearer ' + tok.accessToken, 'x-amzn-kiro-origin': 'AI_EDITOR' }
    }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          const u = JSON.parse(b)?.usageBreakdownList?.[0];
          resolve(u
            ? `quota: ${u.currentUsageWithPrecision ?? u.currentUsage}/${u.usageLimit} credits, overages: ${u.currentOverages}`
            : `quota query: HTTP ${res.statusCode}`);
        } catch { resolve(`quota query: HTTP ${res.statusCode}`); }
      });
    }).on('error', e => resolve('quota query failed: ' + e.message));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ask(prompt) {
  loadTok();
  if (Date.now() > new Date(tok.expiresAt).getTime())
    return { out: '', calls: 0, err: 'access token expired — open Kiro once, it refreshes this file' };
  const wantsCode = /\b(write|generate|create|implement|fonksiyon|function|code|yaz|kod|sql|regex|bash|python|java|script|command|one-?liner)\b/i.test(prompt);
  const lang = /\bpython\b/i.test(prompt) ? 'python' : /\b(bash|shell|terminal)\b/i.test(prompt) ? 'shell' : /\bsql\b/i.test(prompt) ? 'sql' : /\b(java)\b/i.test(prompt) ? 'java' : 'javascript';
  const cm = lang === 'javascript' ? '//' : '#';
  const wraps = wantsCode ? [`${cm} ${prompt}\n`] : [
    `const fs = require("fs");\nconst https = require("https");\n\n// ${prompt}\nconst answer = [`,
    `// ${prompt}\nfunction answer() {\n  return [`,
    `// ${prompt}\nconst answer = "`,
    `// Q: ${prompt}\n// A:`,
  ];
  let out = '', calls = 0, wrap;
  for (wrap of wraps) {
    let r = await completion(wrap, lang);
    calls++;
    if (r.status === 429) { await sleep(3000); r = await completion(wrap, lang); calls++; }
    if (r.status !== 200) return { out, calls, err: `${r.status}: ${r.raw || JSON.stringify(r.data || {})}` };
    const c = r.data?.completions?.[0]?.content;
    if (c && !/^[\s\)\}\];,\.]*$/.test(c)) { out = c; break; }
    await sleep(300);
  }
  if (!out) return { out, calls, err: 'empty completions — soruyu "explain/list/write ..." gibi fiille sor', mode: 'none' };

  let ctx = wrap + out;
  const limit = wantsCode ? MAX_ITERS : 3;
  for (let i = 0; i < limit; i++) {
    const r = await completion(ctx.slice(-MAX_CTX), lang);
    calls++;
    if (r.status === 429) { await sleep(3000); i--; continue; }
    if (r.status !== 200) return { out, calls, err: `${r.status}: ${r.raw || JSON.stringify(r.data || {})}` };
    const c = r.data?.completions?.[0]?.content;
    if (!c || /^[\s\)\}\];,\.]*$/.test(c)) break;
    out += c;
    ctx += c;
    if (!wantsCode && /[^\\]"[\]};]?\s*$/m.test(out)) break;
    if (c.trimEnd().endsWith('}')) break;
    await sleep(400);
  }
  const mode = wantsCode ? 'code' : wrap.endsWith('[') ? 'array' : 'string';
  return { out, calls, mode };
}

async function run(prompt) {
  const { out, calls, err, mode } = await ask(prompt);
  if (err) console.log(`\n[FAIL] ${err}`);
  else {
    let pretty = out;
    if (mode === 'string') {
      const q = out.match(/[^\\]"/);
      try { pretty = eval('"' + (q ? out.slice(0, q.index + 1) : out) + '"'); }
      catch { pretty = q ? out.slice(0, q.index) : out; }
    } else if (mode === 'array') {
      try {
        let expr = '[' + out.trim().replace(/[\]\};,\s]*$/, '') + ']';
        const v = eval(expr);
        pretty = v.map((x, i) => `${i + 1}. ${x}`).join('\n');
      } catch { }
    } else {
      try {
        let expr = out.trim().replace(/;+\s*$/, '');
        const open = (expr.match(/[\[{]/g) || []).length, close = (expr.match(/[\]}]/g) || []).length;
        expr += ']}'.repeat(Math.max(0, open - close));
        const v = eval('(' + expr + ')');
        pretty = Array.isArray(v) ? v.map((x, i) => `${i + 1}. ${x}`).join('\n') : String(v);
      } catch { }
    }
    console.log('\n' + pretty);
    if (VERBOSE) console.log(`\n[${calls} completion call(s) — ${await usageLine()}]`);
  }
}

(async () => {
  if (process.argv[2]) { await run(process.argv.slice(2).join(' ')); return; }
  console.log('kiro-oracle — "exit" çıkar, "evidence" kanıt modunu açar/kapatır.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt('you> '); rl.prompt();
  for await (const line of rl) {
    const q = line.trim();
    if (!q || q === 'exit') break;
    if (q === 'evidence') { VERBOSE = !VERBOSE; console.log(`evidence ${VERBOSE ? 'on' : 'off'}`); rl.prompt(); continue; }
    await run(q);
    rl.prompt();
  }
  rl.close();
})();
