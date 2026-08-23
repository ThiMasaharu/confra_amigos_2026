import json
import os
import random
import re
import unicodedata

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, session
from google import genai
from google.genai import types
from google.genai.errors import APIError, ClientError

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "dev-secret-change-me")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

MEMBROS_PADRAO = ["Thiago", "Laís", "Couto", "Juan"]
PLACAR_PADRAO = {"equipe_a": 0, "equipe_b": 0}
EQUIPES_PADRAO = {"equipe_a": [], "equipe_b": []}

PROMPT_SISTEMA_GEMINI = """
Você é um gerador de temas para um jogo de adivinhação/leilão estilo 'Eu Duvido'.
Sua tarefa é gerar APENAS UM TEMA por resposta.

Diretrizes para o Tema:
1. Deve ser equilibrado (nem muito genérico como 'Coisas', nem absurdamente específico como 'Subespécies de líquens da Antártida').
2. Pode ser fácil ou difícil, abrangendo temas como esportes, anime, video games, geografia, conhecimentos gerais, cotidiano, objetos, marcas, biologia, alimentos, etc.
3. Exemplos de bons temas:
   - Personagens do anime One Piece
   - Times de futebol que começam com a letra C
   - Países da Europa que não usam o Euro
   - Mamíferos que vivem na água
   - Frutas de cor amarela
   - Video games da plataforma Nintendo
   - Elementos da tabela periódica
4. Responda ESTRITAMENTE apenas com o nome/frase do tema, sem aspas, sem numeração, sem introduções ou explicações.
""".strip()

PROMPT_CARTA_PROIBIDA = """
Você é o gerador oficial de cartas do jogo brasileiro "Palavra Proibida".

Objetivo:
- Criar cartas curtas, claras e divertidas para uma rodada de 60 segundos.
- A pessoa que dá as dicas sabe a PALAVRA-ALVO e tenta fazer o parceiro adivinhá-la.
- Existem EXATAMENTE 5 PALAVRAS PROIBIDAS que seriam dicas muito óbvias.
- A palavra-alvo e as 5 proibidas devem ser suficientemente conhecidas por brasileiros.
- Varie muito a dificuldade e os assuntos, mantendo uma distribuição parecida com um jogo de festa: cotidiano, comida, lugares, esportes, cultura pop, tecnologia, objetos, profissões, animais, natureza, música, cinema, jogos, marcas, história e situações comuns.
- Evite cartas excessivamente nichadas ou que dependam de conhecimento escolar avançado.
- Não repita a mesma palavra-alvo nas últimas cartas da sessão quando isso for informado no contexto.

REGRAS LEXICAIS IMPORTANTES:
1. As 5 palavras proibidas não podem ser sinônimos obrigatórios da resposta, nem conter a resposta inteira de forma trivial.
2. Nenhuma palavra proibida pode ser a própria palavra-alvo.
3. Nenhuma palavra proibida pode compartilhar o mesmo radical óbvio com a palavra-alvo (ex.: viagem/viagem; nadar/natação; cozinhar/cozinheiro).
4. Também evite variações de gênero, número, diminutivo, aumentativo, conjugação ou derivados óbvios da palavra-alvo.
5. As palavras proibidas devem funcionar como dicas plausíveis e úteis para a palavra-alvo.
6. A palavra-alvo deve ser uma única resposta curta, preferencialmente um substantivo, nome próprio amplamente conhecido ou expressão muito curta.

Retorne SOMENTE um JSON válido no formato:
{
  "tema": "categoria curta",
  "palavra": "palavra-alvo",
  "proibidas": ["1", "2", "3", "4", "5"]
}
""".strip()


def resetar_estado_jogo():
    session["temas_usados"] = []
    session["cartas_usadas"] = []
    session["placar_eu_duvido"] = PLACAR_PADRAO.copy()
    session["placar_proibida"] = PLACAR_PADRAO.copy()
    session["equipes"] = {"equipe_a": [], "equipe_b": []}
    session.modified = True


def normalizar_texto(texto: str) -> str:
    texto = texto or ""
    texto = unicodedata.normalize("NFKD", texto)
    texto = "".join(ch for ch in texto if not unicodedata.combining(ch))
    texto = re.sub(r"[^a-z0-9\s]", " ", texto.lower())
    return re.sub(r"\s+", " ", texto).strip()


def radical_base(texto: str) -> str:
    """Heurística simples para bloquear derivados óbvios sem dicionário externo."""
    palavra = normalizar_texto(texto).split(" ")[0]
    if len(palavra) <= 4:
        return palavra
    return palavra[:6]


def carta_valida(carta: dict) -> bool:
    if not isinstance(carta, dict):
        return False

    palavra = str(carta.get("palavra", "")).strip()
    proibidas = carta.get("proibidas")
    tema = str(carta.get("tema", "")).strip()

    if not palavra or not tema or not isinstance(proibidas, list) or len(proibidas) != 5:
        return False

    alvo_norm = normalizar_texto(palavra)
    alvo_radical = radical_base(palavra)
    if len(alvo_norm) < 3:
        return False

    vistos = set()
    for item in proibidas:
        item = str(item).strip()
        norm = normalizar_texto(item)
        if not norm or norm in vistos or norm == alvo_norm:
            return False
        vistos.add(norm)
        # Impede derivados muito óbvios por prefixo do radical.
        if len(alvo_radical) >= 5 and (norm.startswith(alvo_radical) or alvo_norm.startswith(radical_base(item))):
            return False
        # Não permite a palavra-alvo inteira dentro de dica ou vice-versa em termos simples.
        if len(alvo_norm) >= 5 and (alvo_norm in norm or norm in alvo_norm):
            return False

    return True


def extrair_json(texto: str) -> dict:
    texto = (texto or "").strip()
    try:
        return json.loads(texto)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", texto, flags=re.DOTALL)
        if not match:
            raise ValueError("Gemini não retornou JSON válido.")
        return json.loads(match.group(0))
    

def gerar_com_gemini(prompt: str) -> str:
    if not client:
        raise RuntimeError("GEMINI_API_KEY não configurada no ambiente.")

    # Lista ordenada: modelo principal -> fallback
    modelos = ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite"]

    for modelo in modelos:
        try:
            response = client.models.generate_content(
                model=modelo,
                contents=prompt,
            )
            texto = (getattr(response, "text", None) or "").strip()
            if texto:
                return texto

        except (ClientError, APIError) as e:
            # Verifica se o erro foi estouro de cota (Status Code 429 / RESOURCE_EXHAUSTED)
            status_code = getattr(e, "code", None) or getattr(
                e, "status_code", None
            )
            if (
                status_code == 429
                or "429" in str(e)
                or "RESOURCE_EXHAUSTED" in str(e)
            ):
                continue  # Avança para o próximo modelo da lista
            raise e  # Lança o erro caso seja outra falha (ex: chave inválida 401)

    raise RuntimeError(
        "O Gemini não retornou conteúdo em nenhum dos modelos tentados."
    )


@app.route("/")
def index():
    # Mantém o comportamento do desafio original: uma nova abertura começa uma sessão nova.
    resetar_estado_jogo()
    return render_template(
        "index.html",
        placar_eu_duvido=session["placar_eu_duvido"],
        placar_proibida=session["placar_proibida"],
    )


@app.route("/api/sortear-equipes", methods=["POST"])
def sortear_equipes():
    membros = MEMBROS_PADRAO.copy()
    random.shuffle(membros)
    session["equipes"] = {
        "equipe_a": membros[:2],
        "equipe_b": membros[2:],
    }
    return jsonify({"success": True, "equipes": session["equipes"]})


@app.route("/api/gerar-tema", methods=["POST"])
def gerar_tema():
    try:
        data = request.get_json(silent=True) or {}
        prompt = (data.get("prompt") or PROMPT_SISTEMA_GEMINI).strip()
        tema_gerado = gerar_com_gemini(prompt)
        usados = session.get("temas_usados", [])
        if normalizar_texto(tema_gerado) not in {normalizar_texto(t) for t in usados}:
            usados.append(tema_gerado)
        session["temas_usados"] = usados[-30:]
        return jsonify({"success": True, "tema": tema_gerado})
    except Exception as exc:
        app.logger.exception("Erro ao consultar Gemini para tema")
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/gerar-carta-proibida", methods=["POST"])
def gerar_carta_proibida():
    try:
        usados = session.get("cartas_usadas", [])
        contexto = ""
        if usados:
            ultimas = ", ".join(usados[-15:])
            contexto = f"Não repita estas palavras-alvo recentes: {ultimas}."

        prompt = PROMPT_CARTA_PROIBIDA + "\n\n" + contexto
        # Pequena margem para o modelo corrigir uma carta que descumpra as regras.
        for tentativa in range(3):
            texto = gerar_com_gemini(prompt)
            carta = extrair_json(texto)
            if carta_valida(carta):
                carta["palavra"] = str(carta["palavra"]).strip()
                carta["proibidas"] = [str(x).strip() for x in carta["proibidas"]]
                usados.append(carta["palavra"])
                session["cartas_usadas"] = usados[-50:]
                return jsonify({"success": True, "carta": carta})
            prompt = PROMPT_CARTA_PROIBIDA + "\n\n" + contexto + (
                "\nIMPORTANTE: sua resposta anterior falhou nas regras lexicais. Gere outra carta totalmente diferente e valide as 5 proibidas antes de responder."
            )

        raise RuntimeError("O Gemini não conseguiu gerar uma carta válida após 3 tentativas.")
    except Exception as exc:
        app.logger.exception("Erro ao gerar carta de Palavra Proibida")
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/atualizar-placar", methods=["POST"])
def atualizar_placar():
    data = request.get_json(silent=True) or {}
    equipe = data.get("equipe")
    delta = data.get("delta", 1)
    jogo = data.get("jogo", "eu_duvido")

    try:
        delta = int(delta)
    except (TypeError, ValueError):
        delta = 0

    chave = "placar_proibida" if jogo == "proibida" else "placar_eu_duvido"
    placar = session.get(chave, PLACAR_PADRAO.copy())
    if equipe in placar:
        placar[equipe] = max(0, placar[equipe] + delta)
        session[chave] = placar
        session.modified = True

    return jsonify({"success": True, "placar": placar, "jogo": jogo})


@app.route("/api/resetar-sessao", methods=["POST"])
def resetar_sessao():
    resetar_estado_jogo()
    return jsonify({"success": True})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
