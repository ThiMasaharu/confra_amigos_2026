let temaAtualText = "";
let timerInterval = null;
let proibidaTimerInterval = null;
let tempoRestante = 60;
let proibidaTempoRestante = 60;
let temaOcultado = false;
let cartaAtual = null;
let rodadaProibidaAtiva = false;
let gerandoCartaProibida = false;

const fotosParticipantes = {
    Thiago: "/static/images/participantes/thiago.jpg",
    "Laís": "/static/images/participantes/lais.jpg",
    Couto: "/static/images/participantes/couto.jpg",
    Juan: "/static/images/participantes/juan.jpg",
    Adrimel: "/static/images/participantes/adrimel.jpg"
};

const corpo = document.body;
const placaresIniciais = {
    eu_duvido: {
        equipe_a: Number(corpo.dataset.euDuvidoScoreA || 0),
        equipe_b: Number(corpo.dataset.euDuvidoScoreB || 0)
    },
    proibida: {
        equipe_a: Number(corpo.dataset.proibidaScoreA || 0),
        equipe_b: Number(corpo.dataset.proibidaScoreB || 0)
    }
};

function atualizarPlacaresNaTela() {
    document.getElementById("score-a").innerText = placaresIniciais.eu_duvido.equipe_a;
    document.getElementById("score-b").innerText = placaresIniciais.eu_duvido.equipe_b;
    document.getElementById("proibida-score-a").innerText = placaresIniciais.proibida.equipe_a;
    document.getElementById("proibida-score-b").innerText = placaresIniciais.proibida.equipe_b;
}

function trocarAba(aba) {
    ["game", "proibida", "rules"].forEach(nome => {
        document.getElementById(`section-${nome}`).classList.add("hidden");
        document.getElementById(`nav-${nome}`).className = "px-4 py-2 text-sm font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition flex items-center gap-2 border border-slate-700";
    });
    document.getElementById(`section-${aba}`).classList.remove("hidden");
    document.getElementById(`nav-${aba}`).className = "px-4 py-2 text-sm font-semibold rounded-lg bg-brand-600 text-white transition flex items-center gap-2 shadow-sm";
}

function inicializarFoto(elemento, nome) {
    const fallback = elemento.parentElement.querySelector(".participant-fallback");
    elemento.addEventListener("error", () => {
        elemento.style.display = "none";
        if (fallback) fallback.style.display = "flex";
    }, { once: true });
}

function renderizarMembros(elementId, membros) {
    const container = document.getElementById(elementId);
    if (!container) return;
    container.innerHTML = (membros || []).map(nome => {
        const inicial = nome.charAt(0).toUpperCase();
        const foto = fotosParticipantes[nome] || "";
        return `
            <span class="member-pill participant-card">
                <img class="participant-photo" src="${foto}" alt="Foto de ${nome}">
                <span class="participant-fallback" style="display:none">${inicial}</span>
                <span class="participant-name">${nome}</span>
            </span>`;
    }).join("");
    container.querySelectorAll(".participant-photo").forEach(img => inicializarFoto(img, img.alt));
}

async function sortearEquipes() {
    try {
        const response = await fetch("/api/sortear-equipes", { method: "POST" });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || "Falha no sorteio.");
        renderizarMembros("members-a", data.equipes.equipe_a);
        renderizarMembros("members-b", data.equipes.equipe_b);
        renderizarMembros("proibida-members-a", data.equipes.equipe_a);
        renderizarMembros("proibida-members-b", data.equipes.equipe_b);
    } catch (err) {
        alert(`Erro ao sortear equipes: ${err.message}`);
    }
}

async function gerarTema() {
    const display = document.getElementById("theme-display");
    const btnGen = document.getElementById("btn-generate");
    btnGen.disabled = true;
    display.innerText = "Consultando Gemini API...";
    temaOcultado = false;
    try {
        const response = await fetch("/api/gerar-tema", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({})
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || "Não foi possível obter o tema.");
        temaAtualText = data.tema;
        display.innerText = temaAtualText;
        display.classList.remove("blur-theme");
        document.getElementById("btn-hide").disabled = false;
        document.getElementById("btn-start-timer").disabled = false;
        atualizarBotaoOcultarTema();
        resetarCronometroVisual();
    } catch (err) {
        display.innerText = `Erro: ${err.message}`;
    } finally {
        btnGen.disabled = false;
    }
}

function atualizarBotaoOcultarTema() {
    const label = document.getElementById("hide-label");
    const icon = document.getElementById("hide-icon");
    if (!label || !icon) return;
    if (temaOcultado) {
        label.innerText = "2. Reexibir Tema";
        icon.className = "fa-solid fa-eye text-emerald-500";
    } else {
        label.innerText = "2. Ocultar Tema";
        icon.className = "fa-solid fa-eye-slash text-amber-400";
    }
}

function ocultarTema() {
    if (!temaAtualText) return;
    const display = document.getElementById("theme-display");
    if (temaOcultado) {
        display.innerText = temaAtualText;
        display.classList.remove("blur-theme");
        temaOcultado = false;
    } else {
        display.innerText = "🙈 TEMA OCULTO (Aguardando Leilão/Início)";
        display.classList.add("blur-theme");
        temaOcultado = true;
    }
    atualizarBotaoOcultarTema();
}

function iniciarContagem() {
    if (!temaAtualText) return;
    const display = document.getElementById("theme-display");
    display.innerText = temaAtualText;
    display.classList.remove("blur-theme");
    temaOcultado = false;
    atualizarBotaoOcultarTema();
    clearInterval(timerInterval);
    tempoRestante = 60;
    atualizarDisplayCronometro();
    document.getElementById("btn-start-timer").disabled = true;
    timerInterval = setInterval(() => {
        tempoRestante--;
        atualizarDisplayCronometro();
        if (tempoRestante <= 0) {
            clearInterval(timerInterval);
            document.getElementById("btn-start-timer").disabled = false;
        }
    }, 1000);
}

function atualizarDisplayCronometro() {
    const seg = String(Math.max(0, tempoRestante)).padStart(2, "0");
    const display = document.getElementById("timer-display");
    const bar = document.getElementById("timer-bar");
    display.innerText = `00:${seg}`;
    bar.style.width = `${(Math.max(0, tempoRestante) / 60) * 100}%`;
    if (tempoRestante <= 10) {
        display.className = "text-6xl font-black font-mono tracking-wider text-rose-500 animate-pulse";
        bar.className = "bg-rose-500 h-2.5 rounded-full transition-all duration-1000";
    } else {
        display.className = "text-6xl font-black font-mono tracking-wider text-indigo-500";
        bar.className = "bg-gradient-to-r from-indigo-500 to-violet-500 h-2.5 rounded-full transition-all duration-1000";
    }
}

function resetarCronometroVisual() {
    clearInterval(timerInterval);
    tempoRestante = 60;
    const display = document.getElementById("timer-display");
    display.innerText = "01:00";
    display.className = "text-6xl font-black font-mono tracking-wider text-indigo-500";
    document.getElementById("timer-bar").style.width = "100%";
}

function atualizarBotoesAcaoProibida(desabilitado) {
    document.getElementById("btn-correct").disabled = desabilitado;
    document.getElementById("btn-skip").disabled = desabilitado;
    document.getElementById("btn-start-proibida").disabled = rodadaProibidaAtiva || gerandoCartaProibida;
}

function limparCartaVisual() {
    document.getElementById("proibida-theme").innerText = "Aguardando início";
    document.getElementById("proibida-answer").innerText = "—";
    document.getElementById("proibida-answer").classList.remove("blur-theme");
    document.getElementById("proibida-list").innerHTML = "";
    document.getElementById("btn-start-proibida").disabled = false;
    atualizarBotoesAcaoProibida(true);
    document.getElementById("proibida-round-status").innerText = "Pressione “Iniciar 1 minuto” para gerar a primeira carta.";
    cartaAtual = null;
    rodadaProibidaAtiva = false;
}

async function gerarCartaProibida() {
    gerandoCartaProibida = true;
    clearInterval(proibidaTimerInterval);
    document.getElementById("proibida-round-status").innerText = "Gerando carta com o Gemini...";
    atualizarBotoesAcaoProibida(true);
    try {
        const response = await fetch("/api/gerar-carta-proibida", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({})
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || "Não foi possível gerar a carta.");
        cartaAtual = data.carta;
        renderizarCartaProibida();
        document.getElementById("proibida-round-status").innerText = "Carta pronta. A rodada continuará imediatamente.";
        return true;
    } catch (err) {
        document.getElementById("proibida-round-status").innerText = `Erro ao gerar carta: ${err.message}`;
        return false;
    } finally {
        gerandoCartaProibida = false;
    }
}

function renderizarCartaProibida() {
    if (!cartaAtual) return;
    document.getElementById("proibida-theme").innerText = cartaAtual.tema;
    document.getElementById("proibida-answer").innerText = cartaAtual.palavra;
    document.getElementById("proibida-list").innerHTML = cartaAtual.proibidas.map(item => `<span class="forbidden-chip font-bold rounded-xl" title="${escapeHtml(item)}">${escapeHtml(item)}</span>`).join("");
    ajustarTamanhoPalavrasProibidas();
}

async function iniciarRodadaProibida() {
    if (rodadaProibidaAtiva || gerandoCartaProibida) return;
    const equipe = document.getElementById("proibida-team").value;
    if (!equipe) return;

    document.getElementById("btn-start-proibida").disabled = true;
    clearInterval(proibidaTimerInterval);
    proibidaTempoRestante = 60;
    atualizarTimerProibida();

    const sucesso = await gerarCartaProibida();
    if (!sucesso) {
        document.getElementById("btn-start-proibida").disabled = false;
        return;
    }

    rodadaProibidaAtiva = true;
    document.getElementById("proibida-round-status").innerText = `Valendo para a ${equipe === "equipe_a" ? "Equipe 1" : "Equipe 2"}!`;
    atualizarBotoesAcaoProibida(false);
    iniciarTimerProibida();
}

function iniciarTimerProibida() {
    clearInterval(proibidaTimerInterval);
    proibidaTimerInterval = setInterval(() => {
        proibidaTempoRestante--;
        atualizarTimerProibida();
        if (proibidaTempoRestante <= 0) {
            finalizarRodadaProibida("Tempo esgotado!");
        }
    }, 1000);
}

function atualizarTimerProibida() {
    const seg = String(Math.max(0, proibidaTempoRestante)).padStart(2, "0");
    const display = document.getElementById("proibida-timer-display");
    const bar = document.getElementById("proibida-timer-bar");
    display.innerText = `00:${seg}`;
    bar.style.width = `${(Math.max(0, proibidaTempoRestante) / 60) * 100}%`;
    if (proibidaTempoRestante <= 10) {
        display.className = "text-6xl font-black font-mono tracking-wider text-rose-500 animate-pulse";
        bar.className = "bg-rose-500 h-2.5 rounded-full transition-all duration-1000";
    } else {
        display.className = "text-6xl font-black font-mono tracking-wider text-indigo-500";
        bar.className = "bg-gradient-to-r from-indigo-500 to-violet-500 h-2.5 rounded-full transition-all duration-1000";
    }
}

async function registrarPalavra(resultado) {
    if (!rodadaProibidaAtiva || !cartaAtual || gerandoCartaProibida) return;

    const equipeAtual = document.getElementById("proibida-team").value;
    if (resultado === "acerto") {
        await modificarPlacar(equipeAtual, 1, "proibida");
    }

    const tempoParaContinuar = proibidaTempoRestante;
    if (tempoParaContinuar <= 0) return;

    // A consulta ao Gemini não consome o tempo restante.
    rodadaProibidaAtiva = false;
    clearInterval(proibidaTimerInterval);
    atualizarBotoesAcaoProibida(true);
    document.getElementById("proibida-round-status").innerText = resultado === "acerto"
        ? "Acerto registrado. Gerando próxima carta..."
        : "Carta pulada. Gerando próxima carta...";

    const sucesso = await gerarCartaProibida();
    if (!sucesso) {
        document.getElementById("btn-start-proibida").disabled = false;
        return;
    }

    // Se ainda havia tempo quando a carta foi acionada, retoma do mesmo segundo.
    proibidaTempoRestante = tempoParaContinuar;
    rodadaProibidaAtiva = true;
    atualizarTimerProibida();
    atualizarBotoesAcaoProibida(false);
    document.getElementById("proibida-round-status").innerText = `Nova carta pronta para a ${equipeAtual === "equipe_a" ? "Equipe 1" : "Equipe 2"}.`;
    iniciarTimerProibida();
}

function finalizarRodadaProibida(mensagem) {
    clearInterval(proibidaTimerInterval);
    rodadaProibidaAtiva = false;
    gerandoCartaProibida = false;
    document.getElementById("btn-correct").disabled = true;
    document.getElementById("btn-skip").disabled = true;
    document.getElementById("btn-start-proibida").disabled = false;
    document.getElementById("proibida-round-status").innerText = mensagem;
    proibidaTempoRestante = 0;
    atualizarTimerProibida();
}

async function modificarPlacar(equipe, delta, jogo = "eu_duvido") {
    try {
        const response = await fetch("/api/atualizar-placar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ equipe, delta, jogo })
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || "Erro ao atualizar placar.");

        if (jogo === "proibida") {
            document.getElementById("proibida-score-a").innerText = data.placar.equipe_a;
            document.getElementById("proibida-score-b").innerText = data.placar.equipe_b;
            placaresIniciais.proibida = data.placar;
        } else {
            document.getElementById("score-a").innerText = data.placar.equipe_a;
            document.getElementById("score-b").innerText = data.placar.equipe_b;
            placaresIniciais.eu_duvido = data.placar;
        }
    } catch (err) {
        console.error(err);
        throw err;
    }
}


function escapeHtml(texto) {
    return String(texto).replace(/[&<>"']/g, char => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
    }[char]));
}

function ajustarTamanhoPalavrasProibidas() {
    const chips = Array.from(document.querySelectorAll("#proibida-list .forbidden-chip"));

    chips.forEach(chip => {
        chip.classList.remove("is-wide");
        chip.style.fontSize = "16px";
    });

    chips.forEach(chip => {
        // Primeiro tenta caber na largura normal do card, reduzindo a fonte sem quebrar a palavra.
        let tamanho = 16;
        const limite = 10;
        chip.style.fontSize = `${tamanho}px`;

        while (chip.scrollWidth > chip.clientWidth + 2 && tamanho > limite) {
            tamanho -= 0.5;
            chip.style.fontSize = `${tamanho}px`;
        }

        // Frases mais longas ganham a largura das duas colunas.
        if (chip.scrollWidth > chip.clientWidth + 2) {
            chip.classList.add("is-wide");
            tamanho = 16;
            chip.style.fontSize = `${tamanho}px`;
            while (chip.scrollWidth > chip.clientWidth + 2 && tamanho > limite) {
                tamanho -= 0.5;
                chip.style.fontSize = `${tamanho}px`;
            }
        }
    });
}

window.addEventListener("resize", ajustarTamanhoPalavrasProibidas);

document.addEventListener("DOMContentLoaded", () => {
    atualizarPlacaresNaTela();
    limparCartaVisual();
});
