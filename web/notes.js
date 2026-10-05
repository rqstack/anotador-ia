// Anotações EXTRATIVAS: seleciona e organiza frases da transcrição. Não usa IA generativa e não reescreve nada.
const STOP = new Set('para como mais mas isso esse essa esta este aqui então vamos gente você voce tem ter uma uns umas dos das com não nao que por pra são ser foi está estou muito também ainda quando onde porque pois sobre depois antes agora então coisa fazer vai vou né tá'.split(' '));
const CODE = /\b(const|let|var|function|return|if|else|for|while|console\.log|import|class|def|print)\b|<\/?\w+>|\w+\(\)|[{};=]{2,}/i;
const DEF = /\b( é | são |serve para|significa|chamamos|se chama|chamado de|usamos para)\b/i;
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function buildNotes(segments) {
  const segs = segments.filter(s => s.text);
  if (!segs.length) return 'Nenhuma fala foi transcrita nesta sessão.';
  const sents = segs.flatMap(s => s.text.split(/(?<=[.!?])\s+/).map(text => ({ text, t: s.t, uncertain: s.uncertain })))
    .filter(s => s.text.length > 15);
  const freq = {};
  for (const w of segs.map(s => s.text).join(' ').toLowerCase().match(/[a-zà-ú][a-zà-ú0-9_-]{3,}/g) || [])
    if (!STOP.has(w)) freq[w] = (freq[w] || 0) + 1;
  const kws = Object.entries(freq).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w);
  const score = s => kws.filter(k => s.text.toLowerCase().includes(k)).length;
  const top = [...sents].sort((a, b) => score(b) - score(a)).slice(0, 4).sort((a, b) => a.t - b.t);
  const defs = sents.filter(s => DEF.test(s.text)).slice(0, 6);
  const code = sents.filter(s => CODE.test(s.text)).slice(0, 8);
  const doubts = segs.filter(s => s.uncertain);
  const li = list => list.length ? list.map(s => `- [${fmt(s.t)}] ${s.text}`).join('\n') : '_Nada identificado._';
  const qa = kws.slice(0, 5).map(k => {
    const s = sents.find(x => x.text.toLowerCase().includes(k));
    return `**Pergunta:** o que foi dito sobre "${k}"?\n**Trecho da aula:** ${s ? s.text : '-'}`;
  }).join('\n\n') || '_Poucos termos repetidos para gerar perguntas._';
  return `> Gerado por heurística sobre a transcrição (sem IA generativa). Os trechos são citações da aula; revise antes de estudar.

## Resumo (trechos selecionados)
${li(top)}

## Conceitos e definições
${li(defs)}

## Trechos com termos de código
Transcrição aproximada de fala, não o código exato mostrado na tela.
${code.length ? '```\n' + code.map(s => s.text).join('\n') + '\n```' : '_Nada identificado._'}

## Termos técnicos (palavras mais repetidas)
${kws.length ? kws.map(k => `- ${k}`).join('\n') : '_Nada identificado._'}

## Dúvidas para revisar (baixa confiança na transcrição)
${li(doubts)}

## Perguntas de revisão
${qa}`;
}
