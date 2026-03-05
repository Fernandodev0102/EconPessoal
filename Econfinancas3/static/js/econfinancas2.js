/* ==========================================================================
   CONFIGURAÇÕES GERAIS E INICIALIZAÇÃO
   ========================================================================== */
const API_URL = "http://127.0.0.1:5000/api";
let expensesChart = null;
let currentAccountsData = [];
let currentExpensesData = [];
let currentChartMode = 'month';
let pendingDeleteId = null; // Para o modal de exclusão

document.addEventListener("DOMContentLoaded", () => {
    // Define data inicial
    const today = new Date();
    const monthStr = today.toISOString().slice(0, 7);
    document.getElementById("filter-month").value = monthStr;
    document.getElementById("pay-invoice-date").value = today.toISOString().split('T')[0];
    document.getElementById("transfer-date").value = today.toISOString().split('T')[0];

    // Carrega dados
    loadCategories();
    loadAccountsAndCards();
    loadExpenses();
    loadCyclesProjection();
    setupEventListeners();
});

function setupEventListeners() {
    // Forms
    document.getElementById("expense-form").addEventListener("submit", addExpense);
    document.getElementById("add-category-btn").addEventListener("click", addCategory);

    // Filtros
    document.getElementById("filter-category").addEventListener("change", loadExpenses);
    document.getElementById("filter-payment").addEventListener("change", loadExpenses);
    document.getElementById("filter-month").addEventListener("change", loadExpenses);
    document.getElementById("filter-source").addEventListener("change", loadExpenses);
    document.getElementById("btn-next-invoice").addEventListener("click", filterNextInvoice);
    document.getElementById("clear-filters-btn").addEventListener("click", clearFilters);
    document.getElementById("export-btn").addEventListener("click", exportToExcel);

    // Modais - Botões de abrir
    document.getElementById("open-accounts-modal-btn").addEventListener("click", () => {
        renderAccountsModal();
        openModal("accounts-modal");
    });
    document.getElementById("close-accounts-modal-btn").addEventListener("click", () => closeModal("accounts-modal"));

    document.getElementById("open-fixed-modal-btn").addEventListener("click", () => {
        openModal("fixed-modal");
        loadFixedExpenses();
    });
    document.getElementById("add-fixed-btn").addEventListener("click", addFixedExpense);

    document.getElementById("open-color-modal-btn").addEventListener("click", () => {
        openModal("color-modal");
        renderColorCustomization();
    });

    // Botão Transferência
    document.getElementById("open-transfer-modal-btn").addEventListener("click", () => {
        openModal("transfer-modal");
        renderTransferOptions();
    });
    document.getElementById("confirm-transfer-btn").addEventListener("click", confirmTransfer);

    // Modais - Ações
    document.getElementById("save-account-btn").addEventListener("click", saveNewAccount);
    document.getElementById("confirm-pay-invoice-btn").addEventListener("click", confirmPayInvoice);
    
    // Lógica Visual Inputs (Selects dinâmicos)
    document.getElementById("expense-payment").addEventListener("change", function () {
        const method = this.value;
        const instGroup = document.getElementById("installments-group");
        const cardCont = document.getElementById("card-choice-container");
        const accCont = document.getElementById("account-choice-container");

        instGroup.style.display = "none";
        cardCont.style.display = "none";
        accCont.style.display = "none";

        if (method === "Credit_Card") {
            cardCont.style.display = "block";
            instGroup.style.display = "block";
        } else if (method === "Débito" || method === "Pix") {
            accCont.style.display = "block";
        }
    });
}

function showFeedback(message, type) {
    const el = document.getElementById("feedback-message");
    if (!el) return;
    el.textContent = message;
    el.className = "";
    el.classList.add(type === 'error' ? 'feedback-error' : 'feedback-success');
    el.style.display = "block";
    setTimeout(() => { el.style.display = "none"; }, 4000);
}

/* ==========================================================================
   PROJEÇÃO DE CICLOS
   ========================================================================== */
async function loadCyclesProjection() {
    try {
        const res = await fetch(`${API_URL}/dashboard/cycles_projection`);
        const data = await res.json();

        // Ciclo 15
        document.getElementById("val-15-cards").textContent = formatCurrency(data.cycle_15.cards);
        document.getElementById("val-15-fixed").textContent = formatCurrency(data.cycle_15.fixed);
        document.getElementById("val-15-others").textContent = formatCurrency(data.cycle_15.others);
        document.getElementById("val-15-total").textContent = formatCurrency(data.cycle_15.total);

        // Ciclo 30
        document.getElementById("val-30-cards").textContent = formatCurrency(data.cycle_30.cards);
        document.getElementById("val-30-fixed").textContent = formatCurrency(data.cycle_30.fixed);
        document.getElementById("val-30-others").textContent = formatCurrency(data.cycle_30.others);
        document.getElementById("val-30-total").textContent = formatCurrency(data.cycle_30.total);
    } catch (e) { console.error("Erro na projeção:", e); }
}

/* ==========================================================================
   GASTOS FIXOS (COM LANÇAMENTO)
   ========================================================================== */
function populateFixedSourceSelect() {
    const method = document.getElementById("new-fixed-method").value;
    const sel = document.getElementById("new-fixed-source");
    sel.innerHTML = "";
    
    if(method === 'Crédito') {
        currentAccountsData.forEach(acc => {
            acc.cards.filter(c => c.type === 'CREDIT').forEach(card => {
                sel.innerHTML += `<option value="CARD-${card.id}">💳 ${card.name}</option>`;
            });
        });
    } else {
        currentAccountsData.forEach(acc => {
            sel.innerHTML += `<option value="ACC-${acc.id}">🏛️ ${acc.name}</option>`;
        });
    }
}

// Global para ser acessível pelo HTML
window.toggleFixedSourceInputs = function() {
    populateFixedSourceSelect();
}

async function loadFixedExpenses() {
    const container = document.getElementById("fixed-list-display");
    container.innerHTML = "Carregando...";
    populateFixedSourceSelect(); // Preenche o select de cadastro

    try {
        const res = await fetch(`${API_URL}/fixed_expenses`);
        const list = await res.json();
        container.innerHTML = "";

        if (list.length === 0) {
            container.innerHTML = "<p style='color:#666; text-align:center;'>Nenhum gasto fixo cadastrado.</p>";
            return;
        }

        list.forEach(item => {
            const div = document.createElement("div");
            div.className = "bank-account-item";
            div.style.alignItems = "center";
            
            // Botões: Lançar e Excluir
            const buttons = `
                <div style="display:flex; gap:5px;">
                    <button onclick="launchFixedExpense(${item.id}, '${item.name}', ${item.amount})" style="background:#00e676; color:black; padding:5px 10px; font-weight:bold;" title="Lançar no mês atual">🚀 Lançar</button>
                    <button class="btn-delete" onclick="deleteFixedExpense(${item.id})">🗑️</button>
                </div>
            `;

            div.innerHTML = `
                <div style="flex:1;">
                    <div style="font-weight:bold; color:white; font-size:1.1em;">${item.name}</div>
                    <div style="font-size:0.85em; color:#aaa; margin-top:2px;">
                        Dia ${item.due_day} • Teto: R$ ${formatSimple(item.amount)}
                    </div>
                    <div style="font-size:0.8em; color:#4dd0e1;">
                        ${item.source_desc}
                    </div>
                </div>
                ${buttons}
            `;
            container.appendChild(div);
        });
    } catch (e) { console.error(e); }
}

async function addFixedExpense() {
    const name = document.getElementById("new-fixed-name").value;
    const day = document.getElementById("new-fixed-day").value;
    const amount = document.getElementById("new-fixed-amount").value;
    const method = document.getElementById("new-fixed-method").value;
    const sourceVal = document.getElementById("new-fixed-source").value;

    if (!name || !day || !amount || !sourceVal) { alert("Preencha todos os campos!"); return; }

    let cardId = null;
    let bankId = null;

    if(sourceVal.startsWith("CARD-")) cardId = sourceVal.split("-")[1];
    else if(sourceVal.startsWith("ACC-")) bankId = sourceVal.split("-")[1];

    const payload = {
        name, amount, due_day: day, payment_method: method,
        card_id: cardId, bank_account_id: bankId
    };

    await fetch(`${API_URL}/fixed_expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    document.getElementById("new-fixed-name").value = "";
    document.getElementById("new-fixed-amount").value = "";
    loadFixedExpenses(); loadCyclesProjection();
    showFeedback("Gasto fixo salvo!", "success");
}

window.launchFixedExpense = async function(id, name, defaultAmount) {
    const realValStr = prompt(`Lançar "${name}" agora?\n\nQual o valor exato da fatura este mês?`, defaultAmount);
    if (realValStr === null) return;
    
    const realAmount = parseFloat(realValStr.replace(',', '.'));
    if(isNaN(realAmount) || realAmount <= 0) { alert("Valor inválido"); return; }

    try {
        const res = await fetch(`${API_URL}/fixed_expenses/${id}/launch`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ amount: realAmount })
        });

        if(res.ok) {
            showFeedback("Lançado no histórico!", "success");
            loadExpenses(); 
            loadAccountsAndCards();
            loadCyclesProjection();
        } else {
            const err = await res.json(); alert("Erro: " + err.error);
        }
    } catch(e) { console.error(e); }
}

async function deleteFixedExpense(id) {
    if (confirm("Remover este modelo de gasto fixo?")) {
        await fetch(`${API_URL}/fixed_expenses/${id}`, { method: 'DELETE' });
        loadFixedExpenses(); loadCyclesProjection();
    }
}

/* ==========================================================================
   CRUD GASTOS
   ========================================================================== */
async function loadExpenses() {
    try {
        const query = buildQueryString();
        const response = await fetch(`${API_URL}/expenses${query}`);
        currentExpensesData = await response.json();
        renderTable(currentExpensesData);
        if (currentChartMode === 'month') renderChart(currentExpensesData);
        else renderAnnualChart();
    } catch (e) { console.error(e); }
}

function renderTable(expenses) {
    const tbody = document.getElementById("expense-table-body");
    tbody.innerHTML = "";
    expenses.forEach(e => {
        const row = document.createElement("tr");
        const d = e.date.split("-");

        let statusIcon = e.status === 'CLOSED' ? '✅ ' : '';
        let rowStyle = e.status === 'CLOSED' ? "opacity: 0.6;" : "";
        let desc = statusIcon + e.description;
        
        const isSystemRecord = e.category === 'Transferência' || e.category === 'Pagamento de Fatura';

        if (e.total_installments > 1) desc += ` <small>(${e.current_installment}/${e.total_installments})</small>`;

        let cycleBadge = e.computed_cycle === 15 
            ? '<span style="color:#4dd0e1; font-weight:bold; font-size:0.8em;">Ciclo 15</span>' 
            : '<span style="color:#ffb74d; font-weight:bold; font-size:0.8em;">Ciclo 30</span>';

        if (isSystemRecord) cycleBadge = '<span style="font-size:0.8em; color:#aaa;">-</span>';

        let actionButtons = `
            <div class="expense-row-actions">
                <button class="btn-delete" onclick="deleteExpense('${e.id}')">🗑️</button>
            </div>
        `;

        row.innerHTML = `
            <td>${d[2]}/${d[1]}</td>
            <td>
                <div style="font-weight:600; ${rowStyle}">${desc}</div>
                <div style="font-size:0.8em; color:#aaa;">${e.category}</div>
            </td>
            <td style="font-weight:bold; ${isSystemRecord ? 'color:#aaa;' : ''}">
                R$ ${e.amount.toFixed(2)}
            </td>
            <td>${cycleBadge}</td>
            <td>${actionButtons}</td>
        `;
        tbody.appendChild(row);
    });
}

// LÓGICA DE EXCLUSÃO (Modal)
window.deleteExpense = function (id) {
    const expense = currentExpensesData.find(e => e.id === id);
    if (!expense) return;

    const modal = document.getElementById("delete-modal");
    pendingDeleteId = id;

    document.getElementById("del-desc").textContent = expense.description;
    document.getElementById("del-val").textContent = formatCurrency(expense.amount);
    const d = expense.date.split('-');
    document.getElementById("del-date").textContent = `${d[2]}/${d[1]}/${d[0]}`;

    const msg = document.getElementById("delete-modal-msg");
    const btnAll = document.getElementById("btn-delete-all");
    const btnSingle = document.getElementById("btn-delete-single");

    if (expense.total_installments > 1 || expense.group_id) {
        msg.innerHTML = `Este item é a parcela <b style="color:white">${expense.current_installment} de ${expense.total_installments}</b>.`;
        btnAll.style.display = "block";
        btnSingle.textContent = "Apagar só este mês";
        btnSingle.style.backgroundColor = "#ff9800";
    } else {
        msg.textContent = "Tem certeza que deseja apagar?";
        btnAll.style.display = "none";
        btnSingle.textContent = "🗑️ Confirmar Exclusão";
        btnSingle.style.backgroundColor = "#d32f2f";
        btnSingle.style.color = "white";
    }
    modal.classList.add("show");
}

window.executeDelete = async function (scope) {
    if (!pendingDeleteId) return;
    try {
        const res = await fetch(`${API_URL}/expenses/${pendingDeleteId}?scope=${scope}`, { method: "DELETE" });
        if (res.ok) {
            document.getElementById("delete-modal").classList.remove("show");
            showFeedback("Excluído com sucesso!", "success");
            loadExpenses(); loadAccountsAndCards(); loadCyclesProjection();
        } else {
            const err = await res.json(); alert("Erro: " + err.error);
        }
    } catch (e) { console.error(e); }
    finally { pendingDeleteId = null; }
}

async function addExpense(event) {
    event.preventDefault();
    
    const payMethod = document.getElementById("expense-payment").value;
    let cardId = null, bankId = null, accName = "Carteira", finalMethod = payMethod;

    if (payMethod === "Credit_Card") {
        cardId = document.getElementById("expense-card-source").value;
        if (!cardId) { alert("Selecione o Cartão!"); return; }
        finalMethod = "Crédito";
        const sel = document.getElementById("expense-card-source");
        accName = sel.options[sel.selectedIndex].text;
    } else {
        const src = document.getElementById("expense-account-source").value;
        if (src) {
            if (src.startsWith("ACC-")) bankId = src.split("-")[1];
            else if (src.startsWith("CARD-")) cardId = src.split("-")[1];
            const sel = document.getElementById("expense-account-source");
            accName = sel.options[sel.selectedIndex].text;
        }
    }

    const payload = {
        description: document.getElementById("expense-description").value,
        amount: parseFloat(document.getElementById("expense-value").value),
        date: document.getElementById("expense-date").value,
        category: document.getElementById("expense-category").value,
        payment_method: finalMethod, account_name: accName,
        card_id: cardId, bank_account_id: bankId,
        total_installments: parseInt(document.getElementById("expense-installments").value)
    };

    const response = await fetch(`${API_URL}/expenses`, {
        method: 'POST',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (response.ok) {
        document.getElementById("expense-form").reset();
        document.getElementById("expense-id").value = ""; 
        showFeedback("Salvo com sucesso!", "success");
        loadExpenses(); loadAccountsAndCards(); loadCyclesProjection();
    } else {
        const err = await response.json(); showFeedback(err.error, "error");
    }
}

/* ==========================================================================
   BANCOS E CARTÕES
   ========================================================================== */
async function loadAccountsAndCards() {
    try {
        const response = await fetch(`${API_URL}/accounts`);
        currentAccountsData = await response.json();
        renderBanksDashboard(); renderAccountsModal(); renderFormDropdowns(); renderFilterOptions();
    } catch (error) { console.error("Erro contas:", error); }
}

function renderBanksDashboard() {
    const container = document.getElementById("banks-dashboard-container");
    container.innerHTML = "";
    if (currentAccountsData.length === 0) { container.innerHTML = "<p class='banks-loading'>Nenhuma conta cadastrada.</p>"; return; }

    currentAccountsData.forEach(acc => {
        const div = document.createElement("div");
        div.className = "bank-display-item";
        div.style.borderLeftColor = acc.color || '#00e676';

        let cardsHtml = "";
        acc.cards.filter(c => c.type === 'CREDIT').forEach(card => {
            cardsHtml += `
                <div class="cc-box">
                    <div class="cc-header-row">
                        <span class="cc-name">💳 ${card.name}</span>
                        <button class="btn-pay-small" onclick="openPayInvoiceModal(${card.id}, '${card.name}', ${card.open_invoice})">Pagar</button>
                    </div>
                    <div class="cc-info-grid">
                        <div class="cc-metric"><span class="cc-label">Fatura</span><span class="cc-value-invoice">R$ ${formatSimple(card.open_invoice)}</span></div>
                        <div class="cc-metric" style="text-align:right">
                            <span class="cc-label">Limite</span>
                            <span class="cc-value-limit">
                                R$ <span class="editable-limit" onclick="editBalance(this, 'card', ${card.id})" style="cursor:pointer; border-bottom:1px dashed #666;">${formatSimple(card.limit)}</span>
                            </span>
                        </div>
                    </div>
                </div>`;
        });

        div.innerHTML = `
            <div class="bank-header-styled">
                <span class="bank-name-large">🏛️ ${acc.name}</span>
                <span class="bank-balance-large">
                    R$ <span class="editable-balance" onclick="editBalance(this, 'account', ${acc.id})" style="cursor:pointer; border-bottom:1px dashed #666;">${formatSimple(acc.balance)}</span>
                </span>
            </div>
            ${cardsHtml || '<div class="debit-only-badge">Apenas Débito</div>'}
        `;
        container.appendChild(div);
    });
}

function editBalance(spanElement, type, id) {
    const currentText = spanElement.innerText;
    const input = document.createElement("input");
    input.type = "text"; input.value = currentText; input.className = "input-edit-balance";
    spanElement.parentNode.replaceChild(input, spanElement);
    input.focus();

    input.addEventListener("blur", async () => {
        const rawValue = parseFloat(input.value.replace(/[^0-9.,-]/g, "").replace(",", "."));
        const endpoint = type === 'account' ? `/accounts/${id}/balance` : `/cards/${id}/limit`;
        const payload = type === 'account' ? { balance: rawValue } : { limit: rawValue };
        await fetch(`${API_URL}${endpoint}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        loadAccountsAndCards();
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
}

function openPayInvoiceModal(id, name, val) {
    document.getElementById("pay-invoice-card-id").value = id;
    document.getElementById("pay-invoice-card-name").value = name;
    document.getElementById("pay-invoice-display-total").textContent = formatCurrency(val || 0);
    document.getElementById("pay-invoice-amount").value = (val || 0).toFixed(2);
    const sel = document.getElementById("pay-invoice-bank-source");
    sel.innerHTML = currentAccountsData.map(acc => `<option value="${acc.id}">${acc.name} (R$ ${formatSimple(acc.balance)})</option>`).join("");
    openModal("pay-invoice-modal");
}

/* ==========================================================================
   CORREÇÃO DO BUG: CONFIRMAR PAGAMENTO FATURA
   ========================================================================== */
async function confirmPayInvoice() {
    const cardId = document.getElementById("pay-invoice-card-id").value;
    const bankId = document.getElementById("pay-invoice-bank-source").value;
    const amountVal = parseFloat(document.getElementById("pay-invoice-amount").value);
    const dateVal = document.getElementById("pay-invoice-date").value;

    // Validação básica
    if (!amountVal || amountVal <= 0) {
        alert("Por favor, insira um valor válido para pagamento.");
        return;
    }

    // --- CORREÇÃO DE LÓGICA NO FRONTEND ---
    // 1. Encontra o cartão nos dados atuais para comparar o valor da fatura
    let currentCard = null;
    currentAccountsData.forEach(acc => {
        const found = acc.cards.find(c => c.id == cardId);
        if(found) currentCard = found;
    });

    const totalFatura = currentCard ? currentCard.open_invoice : amountVal;
    
    // 2. Prepara o envio para a API
    const payload = {
        card_id: cardId,
        bank_account_id: bankId,
        amount: amountVal,
        date: dateVal
    };

    try {
        const res = await fetch(`${API_URL}/cards/pay_invoice`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            closeModal("pay-invoice-modal");
            
            // 3. Feedback Inteligente (Diferencia Parcial de Total)
            if (amountVal < totalFatura - 0.05) { // margem de 5 centavos
                const restante = totalFatura - amountVal;
                showFeedback(`Pagamento Parcial! Restam: R$ ${restante.toFixed(2)}`, "success");
            } else {
                showFeedback("Fatura Quitada com Sucesso!", "success");
            }

            loadAccountsAndCards(); 
            loadExpenses(); 
            loadCyclesProjection();
        } else {
            const err = await res.json(); 
            showFeedback(err.error, "error");
        }
    } catch(e) {
        console.error(e);
        showFeedback("Erro de conexão com o servidor.", "error");
    }
}

/* ==========================================================================
   PERSONALIZAÇÃO DE CORES
   ========================================================================== */
function renderColorCustomization() {
    const container = document.getElementById("color-list-display");
    container.innerHTML = "";
    if (currentAccountsData.length === 0) { container.innerHTML = "<p>Nenhuma conta.</p>"; return; }

    currentAccountsData.forEach(acc => {
        const div = document.createElement("div");
        div.className = "bank-account-item";
        div.style.display = "flex"; div.style.justifyContent = "space-between"; div.style.alignItems = "center";
        const currentColor = acc.color || '#00e676';
        div.innerHTML = `
            <span style="font-weight:bold; font-size:1.1em;">${acc.name}</span>
            <div style="display:flex; align-items:center; gap:10px;">
                <input type="color" id="color-picker-${acc.id}" value="${currentColor}" style="border:none; width:40px; height:40px; cursor:pointer; background:none;">
                <button class="btn-edit" onclick="saveColor(${acc.id})">Salvar</button>
            </div>
        `;
        container.appendChild(div);
    });
}

async function saveColor(id) {
    const newColor = document.getElementById(`color-picker-${id}`).value;
    try {
        await fetch(`${API_URL}/accounts/${id}/color`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color: newColor }) });
        showFeedback("Cor atualizada!", "success");
        loadAccountsAndCards();
    } catch (e) { console.error(e); showFeedback("Erro", "error"); }
}

/* ==========================================================================
   TRANSFERÊNCIA BANCÁRIA
   ========================================================================== */
function renderTransferOptions() {
    const sourceSel = document.getElementById("transfer-source");
    const destSel = document.getElementById("transfer-dest");
    
    sourceSel.innerHTML = "";
    destSel.innerHTML = "";

    if(currentAccountsData.length === 0) {
        sourceSel.innerHTML = "<option>Sem contas</option>";
        return;
    }

    currentAccountsData.forEach(acc => {
        sourceSel.innerHTML += `<option value="${acc.id}">${acc.name} (R$ ${formatSimple(acc.balance)})</option>`;
    });

    currentAccountsData.forEach(acc => {
        destSel.innerHTML += `<option value="${acc.id}">${acc.name}</option>`;
    });
}

async function confirmTransfer() {
    const sourceId = document.getElementById("transfer-source").value;
    const destId = document.getElementById("transfer-dest").value;
    const amount = parseFloat(document.getElementById("transfer-amount").value);
    const date = document.getElementById("transfer-date").value;

    if(sourceId === destId) { alert("A conta de origem e destino não podem ser a mesma!"); return; }
    if(!amount || amount <= 0) { alert("Digite um valor válido."); return; }

    const payload = { source_id: sourceId, dest_id: destId, amount: amount, date: date };

    try {
        const res = await fetch(`${API_URL}/transfers`, {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
        });

        if(res.ok) {
            closeModal("transfer-modal");
            document.getElementById("transfer-amount").value = "";
            showFeedback("Transferência realizada!", "success");
            loadAccountsAndCards(); loadExpenses(); loadCyclesProjection();
        } else {
            const err = await res.json(); showFeedback(err.error, "error");
        }
    } catch(e) { console.error(e); showFeedback("Erro de conexão", "error"); }
}

/* ==========================================================================
   CATEGORIAS
   ========================================================================== */
async function loadCategories() {
    const res = await fetch(`${API_URL}/categories`);
    const cats = await res.json();
    const list = document.getElementById("category-list");
    const select = document.getElementById("expense-category");
    const fil = document.getElementById("filter-category");
    list.innerHTML = ""; select.innerHTML = ""; fil.innerHTML = '<option value="">Categoria: Todas</option>';

    cats.forEach(c => {
        select.innerHTML += `<option value="${c.name}">${c.name}</option>`;
        fil.innerHTML += `<option value="${c.name}">${c.name}</option>`;
        const li = document.createElement("li");
        li.innerHTML = `<span>${c.name}</span><div class="category-actions"><button class="btn-edit" onclick="editCategory(${c.id},'${c.name}')" style="padding:2px 6px;">✏️</button><button class="btn-delete" onclick="deleteCategory(${c.id})" style="padding:2px 6px;">🗑️</button></div>`;
        list.appendChild(li);
    });
}

window.editCategory = async function (id, name) {
    const n = prompt("Novo nome:", name);
    if (n && n !== name) {
        await fetch(`${API_URL}/categories/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }) });
        loadCategories(); loadExpenses();
    }
}

async function deleteCategory(id) {
    if (confirm("Excluir categoria?")) { await fetch(`${API_URL}/categories/${id}`, { method: 'DELETE' }); loadCategories(); }
}

async function addCategory() {
    const name = document.getElementById("new-category-name").value;
    if (name) {
        await fetch(`${API_URL}/categories`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
        document.getElementById("new-category-name").value = ""; loadCategories();
    }
}

/* ==========================================================================
   GRÁFICOS
   ========================================================================== */
function switchChart(mode) {
    currentChartMode = mode;
    document.getElementById('btn-chart-month').className = mode === 'month' ? 'chart-toggle-btn active' : 'chart-toggle-btn';
    document.getElementById('btn-chart-year').className = mode === 'year' ? 'chart-toggle-btn active' : 'chart-toggle-btn';
    if (expensesChart) {
        expensesChart.clear();
        expensesChart.destroy();
        expensesChart = null;
    }
    loadExpenses();
}

function renderChart(expenses) {
    const ctx = document.getElementById("expensesChart").getContext("2d");
    const totals = {};
    
    expenses.forEach((e) => {
        // Ignora Fatura e Transferência no Gráfico Mensal
        if (e.category === "Pagamento de Fatura" || e.category === "Transferência") return;
        totals[e.category] = (totals[e.category] || 0) + e.amount;
    });
    
    const labels = Object.keys(totals); 
    const data = Object.values(totals);
    
    if (expensesChart) expensesChart.destroy();

    expensesChart = new Chart(ctx, {
        type: "pie", // Gráfico de pizza padrão
        data: {
            labels: labels,
            datasets: [{
                label: 'R$', 
                data: data,
                backgroundColor: [
                    "#00e676", "#2979ff", "#ff5252", "#ffea00", 
                    "#d500f9", "#00b0ff", "#ff9100", "#ff1744"
                ],
                borderColor: "#1e1e1e", // Cor de fundo do seu painel para separar fatias
                borderWidth: 2
            }]
        },
        options: {
            responsive: true, 
            maintainAspectRatio: false,
            plugins: { 
                legend: { 
                    display: true,
                    position: 'right',
                    labels: { 
                        color: '#000000',
                        font: { size: 12 }
                    }
                }, 
                tooltip: { 
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    callbacks: { 
                        label: function (c) { 
                            return ' ' + new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c.raw); 
                        } 
                    } 
                } 
            }
        }
    });
}

function renderAnnualChart() {
    fetch(`${API_URL}/dashboard/annual?t=${new Date().getTime()}`)
        .then(res => res.json())
        .then(data => {
            const canvas = document.getElementById("expensesChart");
            if (expensesChart) { expensesChart.destroy(); expensesChart = null; }
            const ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

            expensesChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: months, datasets: [
                        { label: 'Crédito', data: data.credit, borderColor: '#ff5252', backgroundColor: 'rgba(255, 82, 82, 0.1)', borderWidth: 3, pointRadius: 4, tension: 0.4, fill: true },
                        { label: 'Débito/Pix', data: data.debit, borderColor: '#00e676', backgroundColor: 'rgba(0, 230, 118, 0.1)', borderWidth: 3, pointRadius: 4, tension: 0.4, fill: true }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { display: true, labels: { color: '#000000' } }, tooltip: { backgroundColor: 'rgba(0,0,0,0.8)', padding: 10, callbacks: { label: function (c) { return c.dataset.label + ': ' + new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c.raw); } } } },
                    scales: { x: { ticks: { color: '#000000' }, grid: { display: false } }, y: { ticks: { color: '#000000', callback: function (v) { return 'R$ ' + v; } }, grid: { color: '#444444', borderDash: [5, 5] } } }
                }
            });
        });
}



/* ==========================================================================
   UTILITÁRIOS E EXPORTAÇÃO
   ========================================================================== */
async function exportToExcel() {
    if (!currentExpensesData.length) { alert("Sem dados."); return; }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Relatório');
    ws.columns = [{ header: 'Data', key: 'd', width: 12 }, { header: 'Descrição', key: 'desc', width: 25 }, { header: 'Valor', key: 'v', width: 15 }, { header: 'Categoria', key: 'c', width: 15 }, { header: 'Pagamento', key: 'p', width: 15 }];
    currentExpensesData.forEach(e => { if (e.category !== "Pagamento de Fatura") ws.addRow({ d: e.date, desc: e.description, v: e.amount, c: e.category, p: e.payment_method }); });
    const buffer = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), "Relatorio_Financeiro.xlsx");
}

function formatCurrency(v) { return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function formatSimple(v) { return (v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 }); }
function openModal(id) { document.getElementById(id).classList.add("show"); }
function closeModal(id) { document.getElementById(id).classList.remove("show"); }
function buildQueryString() { return `?month=${document.getElementById("filter-month").value}&category=${document.getElementById("filter-category").value}&payment_method=${document.getElementById("filter-payment").value}&source=${document.getElementById("filter-source").value}`; }
function clearFilters() { document.getElementById("filter-category").value = ""; document.getElementById("filter-payment").value = ""; document.getElementById("filter-source").value = ""; loadExpenses(); }

// GESTÃO DE CONTAS
async function saveNewAccount() {
    const name = document.getElementById("new-account-name").value;
    if (name) { await fetch(`${API_URL}/accounts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); document.getElementById("new-account-name").value = ""; loadAccountsAndCards(); renderAccountsModal(); }
}

async function deleteAccount(id) {
    if (confirm("Excluir conta?")) { await fetch(`${API_URL}/accounts/${id}`, { method: 'DELETE' }); loadAccountsAndCards(); renderAccountsModal(); }
}

async function addCardToAccount(accId) {
    const payload = {
        name: document.getElementById(`new-card-name-${accId}`).value,
        card_type: document.getElementById(`new-card-type-${accId}`).value,
        closing_day: document.getElementById(`new-card-closing-${accId}`).value,
        due_day: document.getElementById(`new-card-due-${accId}`).value,
        bank_account_id: accId
    };
    if (!payload.name) { alert("Nome obrigatório"); return; }
    await fetch(`${API_URL}/cards`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    loadAccountsAndCards(); renderAccountsModal();
}

async function deleteCard(id) {
    if (confirm("Excluir cartão?")) { await fetch(`${API_URL}/cards/${id}`, { method: 'DELETE' }); loadAccountsAndCards(); renderAccountsModal(); }
}

function renderAccountsModal() {
    const container = document.getElementById("accounts-list-display");
    if (currentAccountsData.length === 0) { container.innerHTML = "<p>Nenhuma conta.</p>"; return; }
    container.innerHTML = currentAccountsData.map(acc => `
        <div class="bank-account-item">
            <div class="bank-header"><span class="bank-name">🏛️ ${acc.name}</span><button class="btn-delete btn-sm-action" onclick="deleteAccount(${acc.id})">Excluir</button></div>
            <div class="card-add-container">
                <div class="card-add-row"><select id="new-card-type-${acc.id}" class="card-type-select" onchange="toggleCardDates(${acc.id})"><option value="CREDIT">Crédito</option><option value="DEBIT">Débito</option></select><input type="text" id="new-card-name-${acc.id}" placeholder="Nome Cartão" class="card-name-input"></div>
                <div id="date-inputs-${acc.id}" class="date-inputs-container"><input type="number" id="new-card-closing-${acc.id}" placeholder="Fech." class="card-date-input"><input type="number" id="new-card-due-${acc.id}" placeholder="Venc." class="card-date-input"></div>
                <button onclick="addCardToAccount(${acc.id})" class="btn-add-card-confirm">Add Cartão</button>
            </div>
            <div class="card-list-nested">${acc.cards.map(c => `<div class="card-item-nested"><span>${c.type === 'CREDIT' ? '💳' : '🏧'} ${c.name}</span><button class="btn-delete btn-sm-action" onclick="deleteCard(${c.id})">🗑️</button></div>`).join("")}</div>
        </div>
    `).join("");
}

window.toggleCardDates = function (accId) {
    const type = document.getElementById(`new-card-type-${accId}`).value;
    const dates = document.getElementById(`date-inputs-${accId}`);
    dates.style.display = (type === 'CREDIT') ? 'flex' : 'none';
}

function renderFormDropdowns() {
    const accSel = document.getElementById("expense-account-source");
    const cardSel = document.getElementById("expense-card-source");
    accSel.innerHTML = '<option value="">-- Escolha --</option>';
    cardSel.innerHTML = '<option value="">-- Escolha --</option>';
    currentAccountsData.forEach(acc => {
        accSel.innerHTML += `<option value="ACC-${acc.id}">Conta: ${acc.name}</option>`;
        const debits = acc.cards.filter(c => c.type === 'DEBIT');
        if (debits.length) { const grp = document.createElement("optgroup"); grp.label = acc.name; debits.forEach(c => grp.innerHTML += `<option value="CARD-${c.id}">${c.name}</option>`); accSel.appendChild(grp); }
        const credits = acc.cards.filter(c => c.type === 'CREDIT');
        if (credits.length) { const grp = document.createElement("optgroup"); grp.label = acc.name; credits.forEach(c => grp.innerHTML += `<option value="${c.id}">${c.name}</option>`); cardSel.appendChild(grp); }
    });
}

function renderFilterOptions() {
    const sel = document.getElementById("filter-source");
    sel.innerHTML = '<option value="">Origem: Todas</option>';
    currentAccountsData.forEach(acc => {
        const grp = document.createElement("optgroup"); grp.label = acc.name;
        grp.innerHTML += `<option value="ACC-${acc.id}">Conta</option>`;
        acc.cards.forEach(c => grp.innerHTML += `<option value="CARD-${c.id}">${c.name}</option>`);
        sel.appendChild(grp);
    });
}

function filterNextInvoice() {
    const today = new Date().getDate();
    let best = null, minDiff = 999;
    currentAccountsData.forEach(acc => acc.cards.forEach(c => {
        if (c.type === 'CREDIT' && c.due_day) {
            let diff = c.due_day - today;
            if (diff < 0) diff += 30;
            if (diff < minDiff) { minDiff = diff; best = c; }
        }
    }));
    if (best) { document.getElementById("filter-source").value = `CARD-${best.id}`; loadExpenses(); showFeedback(`Filtrando: ${best.name}`, "success"); }
    else { alert("Nenhum cartão encontrado."); }
}


