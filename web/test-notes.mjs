import assert from 'node:assert';
import { buildNotes } from './notes.js';
const segs = [
  { t: 0, text: 'Hoje vamos falar de variável. Uma variável é um espaço na memória para guardar valor.', uncertain: false },
  { t: 8, text: 'Para criar uma variável usamos const nome igual aspas. A variável guarda o valor.', uncertain: false },
  { t: 20, text: 'trecho confuso aqui', uncertain: true },
  { t: 30, text: '', uncertain: false },
];
const md = buildNotes(segs);
assert(md.includes('## Resumo'));
assert(md.includes('variável'));
assert(md.includes('[00:20] trecho confuso aqui'));
assert(md.includes('const nome'));
assert(buildNotes([]).startsWith('Nenhuma fala'));
console.log('test-notes: OK');
