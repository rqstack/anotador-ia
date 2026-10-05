# Anotador IA

Transcreve o áudio de uma aula online (aba do navegador) em português e monta anotações. Tudo roda no seu PC: nenhum áudio sai da máquina.

## Como funciona
```
Aba da aula --áudio--> web/ (Edge) --PCM 16 kHz por WebSocket--> server/main.py (faster-whisper, CPU)
                          |<-- trechos de texto -- |
                          v
                 IndexedDB (aulas e notas ficam no navegador)
```
- `web/`: interface (HTML/CSS/JS puro, sem build). `app.js` = captura, WebSocket, salvamento e exportação; `notes.js` = anotações.
- `server/`: FastAPI. Transcreve em trechos de 8 s com 1 s de sobreposição e remove repetições (`textutil.py`). O mesmo processo serve a interface, então só há um comando para iniciar.
- Decisão: sem Vite/React e sem SQLite, para ter menos peças. O áudio não é gravado em disco.

## Requisitos
Windows, Python 3.10+ (`py --version`), Microsoft Edge ou Chrome, ~2 GB livres (dependências + modelo `small`). Internet só na primeira execução (baixa o modelo).

## Instalar (terminal do VS Code, PowerShell)
```
cd anotador-ia
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r server\requirements.txt
```

## Iniciar
```
cd server
..\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```
Abra http://127.0.0.1:8000 no Edge. Na primeira aula o modelo é baixado (pode demorar).

Se a transcrição atrasar: `$env:WHISPER_MODEL="base"` antes de iniciar. Outras variáveis: `WHISPER_THREADS` (padrão 4), `WINDOW_SECONDS` (padrão 8).

## Usar
1. Abra a aula do DevClub em uma aba e o Anotador IA em outra.
2. Nova aula > Iniciar aula > escolha a aba da aula e marque **Compartilhar áudio da guia**.
3. Acompanhe a transcrição. Clique em **Encerrar aula** para gerar e salvar as anotações.
4. Em cada aula: editar título e notas (salva sozinho), copiar, exportar Markdown, exportar PDF (abre a impressão; escolha "Salvar como PDF") e excluir. "Apagar todas" remove tudo.

## Ensinar a aula com IA local (opcional, Ollama)
Sem o Ollama tudo continua funcionando (transcrição, notas, exportação); só as abas Explicação, Resumo e Exercícios ficam indisponíveis, com instruções na tela.
1. Instale o Ollama: https://ollama.com/download (Windows) e deixe-o aberto (ícone na bandeja).
2. Baixe o modelo no terminal (~2 GB; confira o nome atual em ollama.com/library): `ollama pull qwen2.5:3b`
3. Outro modelo: `$env:OLLAMA_MODEL="llama3.2:3b"` antes de iniciar o servidor.
4. Na aula salva, abra a aba desejada e clique em **Gerar**. Aulas longas são divididas em blocos; cada geração pode levar vários minutos em CPU. **Evite gerar durante uma aula ao vivo**, pois disputa a CPU com a transcrição.
O texto vai só para `127.0.0.1:11434` (sua máquina). Uma `OLLAMA_URL` externa é bloqueada, a menos que você defina `OLLAMA_ALLOW_REMOTE=1`. Modelos de 3B podem errar ou simplificar demais; o resultado é marcado como gerado por IA e o que não vem da aula deve aparecer como "Complemento:".

## Testes
`npm test` (Node 18+ e Python): anotações, remoção de repetições e a camada de ensino (blocos, falhas, Ollama fora do ar, com modelo simulado). A captura de áudio e a transcrição precisam ser testadas manualmente.

## Limitações conhecidas
- Captura de áudio de aba: só Chrome/Edge; sem marcar o áudio, o app avisa e não inicia. Firefox/Safari não servem.
- As anotações são **extrativas** (trechos e palavras da própria aula). A reescrita didática vem das abas de IA (Ollama). Trechos de código vêm da fala e são aproximados.
- Trechos de baixa confiança aparecem sublinhados e em "Dúvidas para revisar".
- O servidor escuta só em 127.0.0.1. A transcrição consome CPU; ele roda com prioridade reduzida.
