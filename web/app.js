import { buildNotes } from './notes.js';
const $ = s => document.querySelector(s);
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---- Persistência (IndexedDB) ----
const dbp = new Promise((ok, no) => {
  const r = indexedDB.open('anotador-ia', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('lessons', { keyPath: 'id' });
  r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
});
const tx = async (mode, fn) => { const d = await dbp; return new Promise((ok, no) => {
  const t = d.transaction('lessons', mode), r = fn(t.objectStore('lessons'));
  t.oncomplete = () => ok(r.result); t.onerror = () => no(t.error); }); };
const getAll = () => tx('readonly', s => s.getAll());
const put = l => tx('readwrite', s => s.put(l));
const remove = id => tx('readwrite', s => s.delete(id));
const clearAll = () => tx('readwrite', s => s.clear());

// ---- Telas ----
const views = ['home', 'session', 'notes'];
const show = v => views.forEach(n => $('#' + n).hidden = n !== v);
async function renderHome() {
  show('home');
  const all = (await getAll()).sort((a, b) => b.date - a.date), q = $('#q').value.toLowerCase();
  const hit = l => !q || [l.title, l.notes, l.segments.map(s => s.text).join(' ')].join(' ').toLowerCase().includes(q);
  $('#count').textContent = `${all.length} aula(s) salva(s)`;
  const ul = $('#list'); ul.replaceChildren();
  const rows = all.filter(hit);
  if (!rows.length) ul.append(Object.assign(document.createElement('li'), { className: 'mute', textContent: all.length ? 'Nada encontrado.' : 'Nenhuma aula ainda. Clique em "Nova aula".' }));
  for (const l of rows) {
    const li = document.createElement('li'), b = document.createElement('button'), d = document.createElement('span');
    b.className = 'open'; b.textContent = l.title; b.onclick = () => openLesson(l.id);
    d.className = 'mute'; d.textContent = new Date(l.date).toLocaleString('pt-BR');
    li.append(b, d); ul.append(li);
  }
}
$('#q').oninput = renderHome;
$('#new').onclick = () => { resetSession(); show('session'); };
$('#back1').onclick = $('#back2').onclick = () => { if (!active) renderHome(); };
$('#wipe').onclick = async () => { if (confirm('Apagar permanentemente TODAS as aulas salvas?')) { await clearAll(); renderHome(); } };
$('#theme').onclick = () => { const d = document.documentElement; d.dataset.theme = d.dataset.theme === 'dark' ? '' : 'dark'; localStorage.theme = d.dataset.theme; };
document.documentElement.dataset.theme = localStorage.theme || '';

// ---- Sessão ao vivo ----
let active = false, ws, stream, ctx, segs = [], timer, t0, silentSince = null, readyRes, doneRes;
const setStatus = (msg, cls = '') => { $('#status').textContent = msg; $('#status').parentElement.className = 'row mute ' + cls; };
const err = m => { $('#err').textContent = m; $('#err').hidden = !m; };
function resetSession() {
  segs = []; $('#tr').replaceChildren(); $('#live').textContent = ''; $('#title').value = ''; $('#clock').textContent = '00:00';
  $('#level').style.width = '0'; err(''); setStatus('Pronto para iniciar.');
}
function stopMedia() {
  stream?.getTracks().forEach(t => { t.onended = null; t.stop(); });
  ctx?.close(); stream = ctx = null;
}
function addLine(s) {
  const p = document.createElement('p'); p.style.margin = '0 0 6px';
  if (s.silence) { p.className = 'sil'; p.textContent = `[${fmt(s.t)}] sem fala detectada`; }
  else { p.textContent = `[${fmt(s.t)}] ${s.text}`; if (s.uncertain) { p.className = 'u'; p.title = 'Transcrição com baixa confiança'; } }
  return p;
}
function onMsg(m) {
  if (m.type === 'status') setStatus(m.msg);
  else if (m.type === 'ready') readyRes?.();
  else if (m.type === 'segment' || m.type === 'silence') {
    const s = m.type === 'silence' ? { t: m.t, text: '', silence: true } : { t: m.t, text: m.text, uncertain: m.uncertain };
    segs.push(s); const box = $('#tr'); box.append(addLine(s)); box.scrollTop = box.scrollHeight;
    $('#live').textContent = buildNotes(segs);
  } else if (m.type === 'lag') { if (m.seconds > 20) err(`A transcrição está ${Math.round(m.seconds)} s atrasada. Use WHISPER_MODEL=base ou reduza WHISPER_THREADS.`); else if (!$('#err').textContent.startsWith('A aba') ) err(''); }
  else if (m.type === 'error') { err(m.msg); }
  else if (m.type === 'done') doneRes?.();
}
function level(rms) {
  $('#level').style.width = Math.min(100, rms * 400) + '%';
  if (rms < 0.002) { silentSince ??= performance.now(); if (performance.now() - silentSince > 10000) err('Nenhum áudio recebido há 10 s. Confira se a aula está tocando e se o áudio da aba foi compartilhado.'); }
  else { silentSince = null; }
}
const WORKLET = `class P extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(4096);this.n=0}
process(i){const c=i[0][0];if(!c)return true;for(let k=0;k<c.length;k++){this.b[this.n++]=c[k];if(this.n===4096){const o=new Int16Array(4096);let s=0;
for(let j=0;j<4096;j++){const v=Math.max(-1,Math.min(1,this.b[j]));o[j]=v*32767;s+=v*v}this.port.postMessage({pcm:o.buffer,rms:Math.sqrt(s/4096)},[o.buffer]);this.n=0}}return true}}
registerProcessor('pcm',P)`;

$('#start').onclick = async () => {
  err('');
  const md = navigator.mediaDevices;
  if (!md?.getDisplayMedia) return err('Este navegador não permite capturar áudio de abas. Use Microsoft Edge ou Chrome no computador.');
  try {
    stream = $('#source').value === 'mic' ? await md.getUserMedia({ audio: true })
      : await md.getDisplayMedia({ video: { frameRate: 1 }, audio: true, selfBrowserSurface: 'exclude' });
  } catch (e) { return err(e.name === 'NotAllowedError' ? 'Permissão negada. Clique em "Iniciar aula" e autorize o compartilhamento.' : 'Não foi possível iniciar a captura: ' + e.message); }
  if (!stream.getAudioTracks().length) { stopMedia(); return err('A aba foi compartilhada sem áudio. Inicie de novo e marque "Compartilhar áudio da guia" na janela do navegador.'); }
  $('#start').hidden = true; $('#stop').hidden = false; setStatus('Conectando ao serviço local...');
  try {
    ws = new WebSocket(`ws://${location.host}/ws`); ws.onmessage = e => onMsg(JSON.parse(e.data));
    await new Promise((ok, no) => { readyRes = ok; ws.onerror = () => no(new Error('serviço local indisponível')); setTimeout(() => no(new Error('tempo esgotado ao carregar o modelo')), 180000); });
  } catch (e) { stopMedia(); ws?.close(); $('#start').hidden = false; $('#stop').hidden = true; setStatus('Falha ao iniciar.'); return err('Não consegui falar com o serviço local (' + e.message + '). Ele está rodando? Veja o README.'); }
  ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
  const node = new AudioWorkletNode(ctx, 'pcm'), mute = ctx.createGain(); mute.gain.value = 0;
  node.port.onmessage = ({ data }) => { if (ws.readyState === 1) ws.send(data.pcm); level(data.rms); };
  ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(node); node.connect(mute).connect(ctx.destination);
  stream.getTracks().forEach(t => t.onended = () => active && endSession());
  active = true; t0 = Date.now(); silentSince = null; setStatus('Gravando e transcrevendo (sessão ativa)', 'rec');
  timer = setInterval(() => $('#clock').textContent = fmt((Date.now() - t0) / 1000), 1000);
};
$('#stop').onclick = () => endSession();

async function endSession() {
  if (!active) return; active = false; clearInterval(timer); stopMedia();
  $('#stop').hidden = true; setStatus('Finalizando a transcrição...');
  if (ws.readyState === 1) { const done = new Promise(ok => { doneRes = ok; ws.onclose = ok; }); ws.send('stop'); await Promise.race([done, new Promise(ok => setTimeout(ok, 120000))]); }
  ws.close(); $('#start').hidden = false; $('#level').style.width = '0';
  const lesson = { id: crypto.randomUUID(), title: $('#title').value.trim() || 'Aula de ' + new Date().toLocaleDateString('pt-BR'), date: Date.now(), segments: segs, notes: buildNotes(segs) };
  await put(lesson); openLesson(lesson.id);
}

// ---- Anotações salvas ----
let cur;
async function openLesson(id) {
  cur = (await getAll()).find(l => l.id === id); if (!cur) return renderHome();
  show('notes'); $('#ntitle').value = cur.title; $('#ntext').value = cur.notes;
  $('#ntr').replaceChildren(...cur.segments.map(addLine));
  Object.keys(KINDS).forEach(renderAI); tab('nnotes');
}
let saveT; const save = () => { clearTimeout(saveT); saveT = setTimeout(() => put(cur), 400); };
$('#ntitle').oninput = e => { cur.title = e.target.value; save(); };
$('#ntext').oninput = e => { cur.notes = e.target.value; save(); };
const fullMd = () => `# ${cur.title}\n\n${cur.notes}\n\n## Transcrição\n\n${cur.segments.filter(s => s.text).map(s => `[${fmt(s.t)}] ${s.text}`).join('\n')}\n${Object.entries(KINDS).map(([k, t]) => cur.ai?.[k] ? `\n## ${t} (gerado por IA local: ${cur.ai[k].model})\n\n${cur.ai[k].text}\n` : '').join('')}`;
$('#copy').onclick = () => navigator.clipboard.writeText(cur.notes);
$('#md').onclick = () => { const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([fullMd()], { type: 'text/markdown' })), download: cur.title.replace(/[^\w-]+/g, '-').toLowerCase() + '.md' }); a.click(); URL.revokeObjectURL(a.href); };
$('#pdf').onclick = () => { $('#print').textContent = fullMd(); print(); };
$('#del').onclick = async () => { if (confirm('Excluir esta aula permanentemente?')) { await remove(cur.id); renderHome(); } };
// ---- Ensino com IA local (Ollama): explicação, resumo e exercícios ----
const KINDS = { explain: 'Explicação da aula', summary: 'Resumo', exercises: 'Exercícios' };
const panels = {};
for (const k in KINDS) {
  const d = document.createElement('div'); d.className = 'panel'; d.dataset.p = k; d.hidden = true;
  d.innerHTML = `<div class="row"><button class="primary gen"></button><button class="ghost cp">Copiar</button><span class="mute st"></span></div><div class="box out" style="white-space:pre-wrap"></div>` +
    (k === 'exercises' ? '<details><summary>Gabarito (tente responder antes de abrir)</summary><div class="box ans" style="white-space:pre-wrap"></div></details>' : '');
  d.querySelector('.gen').onclick = () => gen(k); d.querySelector('.cp').onclick = () => navigator.clipboard.writeText(cur.ai?.[k]?.text || '');
  $('#ai-panels').append(d); panels[k] = d;
}
function tab(name) {
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.t === name));
  document.querySelectorAll('.panel').forEach(p => p.hidden = p.dataset.p !== name);
  if (KINDS[name]) checkOllama(); else $('#ai-msg').hidden = true;
}
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => tab(b.dataset.t));
async function checkOllama() {
  const m = $('#ai-msg');
  try { const r = await (await fetch('/api/ollama/status')).json(); m.hidden = r.ready; m.textContent = r.help; }
  catch { m.hidden = false; m.textContent = 'Serviço local indisponível. Ele está rodando? Veja o README.'; }
}
function renderAI(k) {
  const a = cur.ai?.[k], p = panels[k], text = a?.text || 'Ainda não gerado. Clique no botão acima.';
  const [main, key] = k === 'exercises' && a ? text.split(/=+\s*GABARITO\s*=+/i) : [text];
  p.querySelector('.out').textContent = main.trim();
  if (k === 'exercises') p.querySelector('.ans').textContent = (key || 'O gabarito não veio separado; veja o texto acima.').trim();
  p.querySelector('.gen').textContent = a ? 'Gerar novamente' : 'Gerar';
  p.querySelector('.st').textContent = a ? `Gerado por IA local (${a.model}). ${(a.warnings || []).join(' ')}` : '';
}
async function gen(k) {
  const lesson = cur, p = panels[k], b = p.querySelector('.gen'), st = p.querySelector('.st');
  b.disabled = true; st.textContent = 'Gerando... pode levar vários minutos; você pode continuar usando o app.';
  try {
    const r = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: k, segments: lesson.segments.filter(s => s.text) }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : 'erro ' + r.status);
    (lesson.ai ??= {})[k] = { text: j.text, model: j.model, warnings: j.warnings, date: Date.now() };
    await put(lesson); if (cur === lesson) renderAI(k);
  } catch (e) { st.textContent = 'Falhou: ' + e.message; }
  finally { b.disabled = false; }
}
renderHome();
