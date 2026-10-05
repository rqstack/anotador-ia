import json, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
import teach

seg = lambda t, u=False: {"t": 0, "text": t, "uncertain": u}
def raises(exc, fn, *a):
    try: fn(*a)
    except exc as e: return str(e)
    raise AssertionError("não lançou " + exc.__name__)

# chunk_text preserva ordem e tamanho
long = " ".join(f"Frase número {i} sobre variável." for i in range(600))
ch = teach.chunk_text(long, 1000)
assert len(ch) > 5 and all(len(c) <= 1000 for c in ch) and " ".join(ch).split() == long.split()
assert teach.detect_subject("uma variável e uma função em javascript") == "programacao"
assert teach.detect_subject("bom dia a todos") == "geral"

# transcrição vazia / tipo inválido
assert "vazia" in raises(ValueError, teach.generate, "explain", [seg("  ")])
raises(ValueError, teach.generate, "x", [seg("oi")])

# aula longa: chama o modelo por blocos e consolida (modelo simulado)
calls = []
teach.ollama_generate = lambda p, s, m=None, base=None: (calls.append(p), "ok " + "x" * 50)[1]
r = teach.generate("summary", [seg(long)])
assert r["chunks"] > 1 and len(calls) > r["chunks"] and r["subject"] == "programacao"
calls.clear(); r = teach.generate("explain", [seg(long)])
assert len(calls) == r["chunks"] and r["text"].count("---") == r["chunks"] - 1
r = teach.generate("exercises", [seg("curto", True)])
assert any("curta" in w for w in r["warnings"]) and any("confiança" in w for w in r["warnings"]) and any("gabarito" in w for w in r["warnings"])
assert "[incerto] curto" in calls[-1]

# falha do modelo propaga como OllamaError (a transcrição não depende disso)
def boom(*a, **k): raise teach.OllamaError("falhou")
teach.ollama_generate = boom
raises(teach.OllamaError, teach.generate, "summary", [seg(long)])

# Ollama fora do ar: status amigável e erro claro (porta 9 recusa conexão)
import importlib; importlib.reload(teach)
st = teach.ollama_status(base="http://127.0.0.1:9")
assert not st["running"] and not st["ready"] and "ollama pull" in st["help"]
assert "Não consegui falar" in raises(teach.OllamaError, teach.ollama_generate, "p", "s", None, "http://127.0.0.1:9")
assert "fora deste computador" in raises(teach.OllamaError, teach._http, "/api/tags", None, "http://exemplo.com")

# camada HTTP contra um servidor falso
class H(BaseHTTPRequestHandler):
    reply = {}
    def log_message(self, *a): pass
    def _send(self, obj):
        b = json.dumps(obj).encode(); self.send_response(200); self.end_headers(); self.wfile.write(b)
    def do_GET(self): self._send({"models": [{"name": "qwen2.5:3b"}]})
    def do_POST(self):
        self.rfile.read(int(self.headers["Content-Length"])); self._send(H.reply)
srv = HTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_port}"
assert teach.ollama_status("qwen2.5:3b", base)["ready"]
assert not teach.ollama_status("outro:1b", base)["ready"]
H.reply = {"response": " olá "}; assert teach.ollama_generate("p", "s", None, base) == "olá"
H.reply = {"foo": 1}; assert "vazia ou inválida" in raises(teach.OllamaError, teach.ollama_generate, "p", "s", None, base)
print("test_teach: OK")
