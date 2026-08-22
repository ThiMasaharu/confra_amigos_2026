import os
import random
from flask import Flask, render_template, request, jsonify, session
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY")

# Inicialização do cliente Gemini
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

MEMBROS_PADRAO = ["Thiago", "Laís", "Couto", "Juan"]

PROMPT_SISTEMA_GEMINI = """
Você é um gerador de temas para um jogo de adivinhação/leilão estilo 'Eu Duvido'.
Sua tarefa é gerar APENAS UM TEMA por resposta.

Diretrizes para o Tema:
1. Deve ser equilibrado (nem muito genérico como 'Coisas', nem absurdamente específico como 'Subespécies de líquens da Antártida').
2. Pode ser fácil ou difícil, abrangendo temas como esportes, anime, video games, geografia, conhecimentos gerais, cotidiano, objetos, marcas, biologia, alimentos, etc.
3. Exemplos de bons temas:
   - "Personagens do anime One Piece"
   - "Times de futebol que começam com a letra C"
   - "Países da Europa que não usam o Euro"
   - "Mamíferos que vivem na água"
   - "Frutas de cor amarela""
   - "Video games da plataforma Nintendo"
   - "Elementos da tabela periódica"
4. Responda ESTRITAMENTE apenas com o nome/frase do tema, sem aspas, sem numeração, sem introduções ou explicações.
"""

@app.route("/")
def index():
    session["temas_usados"] = []
    session["placar"] = {"equipe_a": 0, "equipe_b": 0}
    session["equipes"] = {"equipe_a": [], "equipe_b": []}
    session.modified = True

    # Adicionado: placar=session["placar"]
    return render_template("index.html", placar=session["placar"])

@app.route("/api/sortear-equipes", methods=["POST"])
def sortear_equipes():
    membros = MEMBROS_PADRAO.copy()
    random.shuffle(membros)
    equipe_a = membros[:2]
    equipe_b = membros[2:]
    
    session["equipes"] = {
        "equipe_a": equipe_a,
        "equipe_b": equipe_b
    }
    return jsonify({
        "success": True,
        "equipes": session["equipes"]
    })

@app.route("/api/gerar-tema", methods=["POST"])
def gerar_tema():
    try:
        data = request.get_json(silent=True) or {}
        prompt = (data.get("prompt") or PROMPT_SISTEMA_GEMINI).strip()

        if not client:
            return jsonify({
                "success": False,
                "error": "GEMINI_API_KEY não configurada no ambiente."
            }), 500

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt
        )

        tema_gerado = (getattr(response, "text", None) or "").strip()
        if not tema_gerado:
            return jsonify({
                "success": False,
                "error": "O Gemini não retornou um tema válido."
            }), 502

        return jsonify({"success": True, "tema": tema_gerado})

    except Exception as e:
        app.logger.exception("Erro ao consultar Gemini")
        return jsonify({
            "success": False,
            "error": f"Erro ao consultar o Gemini: {str(e)}"
        }), 500

@app.route("/api/atualizar-placar", methods=["POST"])
def atualizar_placar():
    data = request.json or {}
    equipe = data.get("equipe") # 'equipe_a' ou 'equipe_b'
    delta = data.get("delta", 1)  # +1 ou -1
    
    placar = session.get("placar", {"equipe_a": 0, "equipe_b": 0})
    if equipe in placar:
        placar[equipe] = max(0, placar[equipe] + delta)
        session["placar"] = placar
        
    return jsonify({"success": True, "placar": session["placar"]})

@app.route("/api/resetar-sessao", methods=["POST"])
def resetar_sessao():
    session["temas_usados"] = []
    session["placar"] = {"equipe_a": 0, "equipe_b": 0}
    session["equipes"] = {"equipe_a": [], "equipe_b": []}
    return jsonify({"success": True})

if __name__ == "__main__":
    app.run(debug=True, port=5000)