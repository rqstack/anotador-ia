"""Funções puras de texto (testáveis sem o modelo de voz)."""
import re

def _norm(w):
    return re.sub(r"\W+", "", w.lower())

def trim_overlap(prev, new, max_words=12):
    """Remove do início de `new` as palavras que já terminam `prev` (sobreposição entre janelas).
    Retorna "" se `new` repetir `prev` por inteiro."""
    p, n = prev.split(), new.split()
    if not n:
        return ""
    if [_norm(w) for w in n] == [_norm(w) for w in p[-len(n):]]:
        return ""
    for k in range(min(max_words, len(p), len(n)), 0, -1):
        if [_norm(w) for w in p[-k:]] == [_norm(w) for w in n[:k]]:
            return " ".join(n[k:])
    return " ".join(n)
