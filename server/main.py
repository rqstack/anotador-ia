"""Serviço local: recebe áudio PCM por WebSocket e devolve a transcrição (faster-whisper, CPU).
Também serve a pasta web/, então basta iniciar este processo."""
import asyncio, ctypes, os, time
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from fastapi.staticfiles import StaticFiles

import teach
from textutil import trim_overlap

MODEL_NAME = os.getenv("WHISPER_MODEL", "small")      # use "base" se ficar lento
THREADS = int(os.getenv("WHISPER_THREADS", "4"))      # deixa CPU livre para navegador e VS Code
SR = 16000
WINDOW = int(os.getenv("WINDOW_SECONDS", "8")) * SR   # tamanho de cada trecho
OVERLAP = SR                                          # 1 s repetido entre trechos (evita cortar palavras)
PROMPT = "Aula de programação em português do Brasil: HTML, CSS, JavaScript, Python, função, variável, array, if, else, const, let."
WEB = Path(__file__).resolve().parent.parent / "web"

app = FastAPI()
_model = None

def get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        try:  # prioridade abaixo do normal no Windows
            k = ctypes.windll.kernel32
            k.SetPriorityClass(k.GetCurrentProcess(), 0x4000)
        except Exception:
            pass
        _model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8", cpu_threads=THREADS)
    return _model

def transcribe(audio, offset):
    segs, _ = get_model().transcribe(audio, language="pt", vad_filter=True, beam_size=1,
                                     initial_prompt=PROMPT, condition_on_previous_text=False)
    return [{"t": round(offset + s.start, 1), "text": s.text.strip(),
             "uncertain": s.avg_logprob < -1.0 or s.no_speech_prob > 0.6}
            for s in segs if s.text.strip()]

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    await ws.send_json({"type": "status", "msg": "Carregando modelo (na primeira vez baixa os arquivos)..."})
    try:
        await asyncio.to_thread(get_model)
    except Exception as e:
        await ws.send_json({"type": "error", "msg": f"Falha ao carregar o modelo: {e}"})
        await ws.close()
        return
    await ws.send_json({"type": "ready"})
    buf, base, tail, t0 = np.zeros(0, np.float32), 0, "", time.monotonic()

    async def process():
        nonlocal buf, base, tail
        audio = buf
        segs = await asyncio.to_thread(transcribe, audio, base / SR)
        if not segs:
            await ws.send_json({"type": "silence", "t": round(base / SR, 1)})
        for s in segs:
            text = trim_overlap(tail, s["text"])
            tail = (tail + " " + s["text"])[-300:]
            if text:
                await ws.send_json({"type": "segment", **s, "text": text})
        base += max(len(audio) - OVERLAP, 0)
        buf = audio[-OVERLAP:]
        lag = (time.monotonic() - t0) - base / SR
        await ws.send_json({"type": "lag", "seconds": round(lag, 1)})

    try:
        while True:
            m = await ws.receive()
            if m["type"] == "websocket.disconnect":
                break
            if m.get("bytes") is not None:
                if len(m["bytes"]) % 2:
                    continue  # validação: PCM 16 bits tem tamanho par
                pcm = np.frombuffer(m["bytes"], np.int16).astype(np.float32) / 32768
                buf = np.concatenate([buf, pcm])
                if len(buf) >= WINDOW:
                    await process()
            elif m.get("text") == "stop":
                if len(buf) > OVERLAP:
                    await process()
                await ws.send_json({"type": "done"})
                break
    except WebSocketDisconnect:
        pass

class Seg(BaseModel):
    t: float = 0
    text: str = Field(max_length=5000)
    uncertain: bool = False

class GenReq(BaseModel):
    kind: str
    segments: list[Seg] = Field(max_length=5000)

@app.get("/api/ollama/status")
async def ollama_status():
    return await asyncio.to_thread(teach.ollama_status)

@app.post("/api/generate")
async def generate(req: GenReq):
    try:  # roda em thread: não trava a transcrição nem outras requisições
        return await asyncio.to_thread(teach.generate, req.kind, [s.model_dump() for s in req.segments])
    except ValueError as e:
        raise HTTPException(400, str(e))
    except teach.OllamaError as e:
        raise HTTPException(503, str(e))

app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
