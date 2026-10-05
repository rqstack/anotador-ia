"""Ensino com IA local (Ollama). Só biblioteca padrão; nada sai do computador."""
import json, os, re, urllib.error, urllib.request
from urllib.parse import urlparse

BASE = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")   # ~2 GB; alternativa: llama3.2:3b
TIMEOUT = int(os.getenv("OLLAMA_TIMEOUT", "900"))
CHUNK = 8000      # caracteres por bloco enviado ao modelo
EX_N = 8          # exercícios gerados
KINDS = ("explain", "summary", "exercises")

class OllamaError(Exception):
    pass

def _http(path, payload=None, base=None, timeout=10):
    base = base or BASE
    if urlparse(base).hostname not in ("127.0.0.1", "localhost", "::1") and os.getenv("OLLAMA_ALLOW_REMOTE") != "1":
        raise OllamaError("OLLAMA_URL aponta para fora deste computador e enviaria a transcrição a terceiros. "
                          "Só defina OLLAMA_ALLOW_REMOTE=1 se você consentir.")
    req = urllib.request.Request(base + path, data=None if payload is None else json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise OllamaError(f"O Ollama respondeu com erro {e.code}. O modelo '{MODEL}' foi baixado? (ollama pull {MODEL})")
    except (urllib.error.URLError, OSError) as e:
        raise OllamaError(f"Não consegui falar com o Ollama em {base} ({e}).")
    except ValueError:
        raise OllamaError("Resposta inválida do Ollama (não é JSON).")

def ollama_status(model=None, base=None):
    model = model or MODEL
    try:
        tags = _http("/api/tags", base=base, timeout=3)
    except OllamaError:
        return {"ready": False, "running": False, "model": model,
                "help": f"Ollama não encontrado em execução. Instale em https://ollama.com/download, abra o aplicativo e rode no terminal: ollama pull {model}"}
    names = [m.get("name", "") for m in tags.get("models", []) if isinstance(m, dict)]
    ok = any(n == model or n == model + ":latest" for n in names)
    return {"ready": ok, "running": True, "model": model,
            "help": "" if ok else f"O Ollama está rodando, mas falta o modelo. No terminal: ollama pull {model}"}

def ollama_generate(prompt, system, model=None, base=None):
    j = _http("/api/generate", {"model": model or MODEL, "system": system, "prompt": prompt, "stream": False,
                                "options": {"temperature": 0.3, "num_ctx": 8192}}, base=base, timeout=TIMEOUT)
    txt = (j.get("response") or "").strip() if isinstance(j, dict) else ""
    if not txt:
        raise OllamaError("O modelo devolveu uma resposta vazia ou inválida. Tente gerar novamente.")
    return txt

SYSTEM = ("Você é um professor particular brasileiro. Responda em português do Brasil, para iniciantes. "
          "Use SOMENTE a transcrição como fonte do que foi ensinado na aula. Todo conhecimento seu que não esteja na transcrição "
          "deve vir marcado com 'Complemento:'. Nunca invente código, fórmulas ou exemplos atribuídos ao professor. "
          "Trechos marcados com [incerto] podem estar transcritos errado: diga que há dúvida em vez de adivinhar.")
GUIDE = {
    "programacao": "É uma aula de programação: explique o código por partes, a função de cada linha relevante, mostre exemplos de entrada e saída e, se ajudar, compare versão correta e incorreta (marque como Complemento).",
    "banco": "É uma aula de banco de dados: explique entidades, atributos, relacionamentos, chaves e os conceitos que aparecem na aula.",
    "matematica": "É uma aula de matemática: explique o raciocínio passo a passo, as fórmulas e exemplos resolvidos.",
    "geral": "Adapte o formato ao assunto da aula.",
}
PROMPTS = {
    "explain": "{guide}\nEsta é a parte {i} de {n} da aula; explique só o que aparece nesta parte, sem repetir o que seria de outras. "
               "Ensine como um bom professor, sem apenas parafrasear. Use estas seções: O que foi ensinado; Conceitos e definições; "
               "Explicação simples (com analogias e exemplos práticos); Relações entre os conceitos; Erros comuns; O que o aluno deve entender.\n\nTRANSCRIÇÃO:\n{text}",
    "partial": "{guide}\nParte {i} de {n}. Liste fielmente, em tópicos, os conceitos, definições, regras/sintaxe, exemplos e dúvidas desta parte. Não omita nada importante.\n\nTRANSCRIÇÃO:\n{text}",
    "summary": "{guide}\nFaça um resumo independente, com as seções: Tema principal; Conceitos essenciais; Palavras-chave e definições; Regras, fórmulas ou sintaxe; Pontos para revisar; O que o aluno deve saber. Não descarte informação importante só para encurtar.\n\nMATERIAL:\n{text}",
    "exercises": "{guide}\nCrie {n} exercícios de dificuldade progressiva (compreensão primeiro, depois aplicação prática) baseados só neste material. "
                 "Escreva apenas as perguntas, numeradas. Depois escreva uma linha exata '=== GABARITO ===' e, abaixo, as respostas com explicação.\n\nMATERIAL:\n{text}",
}
SUBJECTS = {
    "programacao": r"\b(variável|função|html|css|javascript|python|array|const|let|if|else|loop|código|tag|seletor|string)\b",
    "banco": r"\b(banco de dados|entidade|atributo|relacionamento|chave primária|chave estrangeira|tabela|sql|der)\b",
    "matematica": r"\b(equação|fórmula|soma|fração|derivada|integral|função do|teorema|raiz|porcentagem)\b",
}

def detect_subject(text):
    t = text.lower()
    best = max(SUBJECTS, key=lambda k: len(re.findall(SUBJECTS[k], t)))
    return best if re.search(SUBJECTS[best], t) else "geral"

def chunk_text(text, size=CHUNK):
    out, cur = [], ""
    for p in re.split(r"(?<=[.!?\n])\s+", text):
        if cur and len(cur) + len(p) + 1 > size:
            out.append(cur); cur = ""
        while len(p) > size:
            out.append(p[:size]); p = p[size:]
        cur = (cur + " " + p).strip()
    return out + ([cur] if cur else [])

def transcript_text(segs):
    return " ".join(("[incerto] " if s.get("uncertain") else "") + s["text"].strip() for s in segs if s.get("text", "").strip())


def _digest(chunks, guide, gen):
    """Condensa o material com menos chamadas ao Ollama."""
    if len(chunks) <= 1:
        return chunks[0] if chunks else ""

    max_parts = 4

    if len(chunks) > max_parts:
        indexes = [
            round(i * (len(chunks) - 1) / (max_parts - 1))
            for i in range(max_parts)
        ]
        chunks = [chunks[i] for i in indexes]

    parts = [
        gen(
            PROMPTS["partial"].format(
                guide=guide,
                i=i + 1,
                n=len(chunks),
                text=chunk
            )
        )
        for i, chunk in enumerate(chunks)
    ]

    return "\n\n".join(parts)

def generate(kind, segs, model=None):
    if kind not in KINDS:
        raise ValueError("Tipo de geração inválido.")
    text = transcript_text(segs)
    if not text:
        raise ValueError("A transcrição está vazia, não há o que ensinar.")
    warns = []
    if sum(1 for s in segs if s.get("uncertain")) / len(segs) > 0.2:
        warns.append("Mais de 20% dos trechos têm baixa confiança na transcrição; confira o resultado.")
    if len(text) < 400:
        warns.append("A transcrição é muito curta; a explicação pode ficar rasa ou pouco confiável.")
    subject = detect_subject(text)
    guide, gen, chunks = GUIDE[subject], (lambda p: ollama_generate(p, SYSTEM, model)), chunk_text(text)
    if kind == "explain":
        out = "\n\n---\n\n".join(gen(PROMPTS["explain"].format(guide=guide, i=i + 1, n=len(chunks), text=c)) for i, c in enumerate(chunks))
    else:
        out = gen(PROMPTS[kind].format(guide=guide, text=_digest(chunks, guide, gen), n=EX_N))
        if kind == "exercises" and "=== GABARITO ===" not in out:
            warns.append("O modelo não separou o gabarito; as respostas podem estar misturadas às perguntas.")
    return {"text": out, "model": model or MODEL, "warnings": warns, "chunks": len(chunks), "subject": subject}
