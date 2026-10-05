from textutil import trim_overlap as t
assert t("a gente vai criar uma função", "uma função chamada soma") == "chamada soma"
assert t("isso é um teste", "isso é um teste") == ""
assert t("olá turma", "vamos começar") == "vamos começar"
assert t("", "primeira frase") == "primeira frase"
assert t("x", "") == ""
print("test_textutil: OK")
