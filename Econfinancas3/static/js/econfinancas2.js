/* ==========================================================================
   CONFIGURAÇÕES GERAIS E INICIALIZAÇÃO
   ========================================================================== */
const API_URL = "http://127.0.0.1:5000/api";
let expensesChart = null;
let currentAccountsData = []; 
let currentExpensesData = [];
let currentChartMode = 'month'; 

document.addEventListener("DOMContentLoaded", () => {
    // Define data inicial nos filtros e inputs
    const today = new Date();
    const monthStr = today.toISOString().slice(0, 7); 
    document.getElementById("filter-month").value = monthStr;
    document.getElementById("pay-invoice-date").value = today.toISOString().split('T')[0];

    // Carrega dados iniciais
    loadCategories();
    loadAccountsAndCards(); 
    loadExpenses();
    loadCyclesProjection(); 
    setupEventListeners();
});

function setupEventListeners() {
    // Formulários Principais
    document.getElementById("expense-form").addEventListener("submit", addOrUpdateExpense);
    document.getElementById("add-category-btn").addEventListener("click", addCategory);
    
    // Filtros
    document.getElementById("filter-category").addEventListener("change", loadExpenses);
    document.getElementById("filter-payment").addEventListener("change", loadExpenses);
    document.getElementById("filter-month").addEventListener("change", loadExpenses);
    document.getElementById("filter-source").addEventListener("change", loadExpenses);
    document.getElementById("btn-next-invoice").addEventListener("click", filterNextInvoice);
    document.getElementById("clear-filters-btn").addEventListener("click", clearFilters);
    document.getElementById("export-btn").addEventListener("click", exportToExcel);

    // Botões de Abertura de Modais
    document.getElementById("open-accounts-modal-btn").addEventListener("click", () => {
        renderAccountsModal(); // Garante renderização ao abrir
        openModal("accounts-modal");
    });
    document.getElementById("close-accounts-modal-btn").addEventListener("click", () => closeModal("accounts-modal"));
    
    document.getElementById("open-fixed-modal-btn").addEventListener("click", () => {
        openModal("fixed-modal");
        loadFixedExpenses();
    });
    document.getElementById("add-fixed-btn").addEventListener("click", addFixedExpense);

    // Ações de Modais
    document.getElementById("save-account-btn").addEventListener("click", saveNewAccount);
    document.getElementById("confirm-pay-invoice-btn").addEventListener("click", confirmPayInvoice);
    document.getElementById("modal-cancel-btn").addEventListener("click", () => closeModal("confirmation-modal"));

    // Lógica Visual: Alternar campos Cartão/Conta no formulário
    document.getElementById("expense-payment").addEventListener("change", function() {
        const method = this.value;
        const instGroup = document.getElementById("installments-group");
        const cardCont = document.getElementById("card-choice-container");
        const accCont = document.getElementById("account-choice-container");

        // Reseta visibilidade
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
   PROJEÇÃO DE CICLOS E GASTOS FIXOS
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

async function loadFixedExpenses() {
    const container = document.getElementById("fixed-list-display");
    container.innerHTML = "Carregando...";
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
            div.style.display = "flex";
            div.style.justifyContent = "space-between";
            div.style.alignItems = "center";
            div.innerHTML = `
                <div>
                    <span style="font-weight:bold; color:white;">${item.name}</span>
                    <div style="font-size:0.85em; color:#aaa;">Vence dia: ${item.due_day} • Valor: R$ ${formatSimple(item.amount)}</div>
                </div>
                <button class="btn-delete" onclick="deleteFixedExpense(${item.id})">🗑️</button>
            `;
            container.appendChild(div);
        });
    } catch(e) { console.error(e); }
}

async function addFixedExpense() {
    const name = document.getElementById("new-fixed-name").value;
    const day = document.getElementById("new-fixed-day").value;
    const amount = document.getElementById("new-fixed-amount").value;
    
    if(!name || !day || !amount) { alert("Preencha todos os campos!"); return; }
    
    await fetch(`${API_URL}/fixed_expenses`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ name, due_day: day, amount })
    });
    
    document.getElementById("new-fixed-name").value = "";
    document.getElementById("new-fixed-amount").value = "";
    document.getElementById("new-fixed-day").value = "";
    
    loadFixedExpenses();
    loadCyclesProjection(); 
    showFeedback("Gasto fixo adicionado!", "success");
}

async function deleteFixedExpense(id) {
    if(confirm("Remover este gasto fixo?")) {
        await fetch(`${API_URL}/fixed_expenses/${id}`, { method: 'DELETE' });
        loadFixedExpenses();
        loadCyclesProjection();
    }
}

/* ==========================================================================
   CRUD GASTOS
   ========================================================================== */
async function loadExpenses() {
    try {
        const query = buildQueryString();
        const response = await fetch(`${API_URL}/expenses${query}`);
        const expenses = await response.json();
        currentExpensesData = expenses;
        renderTable(expenses);
        if (currentChartMode === 'month') renderChart(expenses); 
        else renderAnnualChart();
    } catch (e) { console.error(e); }
}

function renderTable(expenses) {
    const tbody = document.getElementById("expense-table-body");
    tbody.innerHTML = "";
    expenses.forEach(e => {
        const row = document.createElement("tr");
        const d = e.date.split("-"); // YYYY-MM-DD
        
        let statusIcon = e.status === 'CLOSED' ? '✅ ' : '';
        let rowStyle = e.status === 'CLOSED' ? "opacity: 0.6;" : "";
        let desc = statusIcon + e.description;
        if(e.total_installments > 1) desc += ` <small>(${e.current_installment}/${e.total_installments})</small>`;
        
        let cycleBadge = e.computed_cycle === 15 
            ? '<span style="color:#4dd0e1; font-weight:bold; font-size:0.8em;">Ciclo 15</span>' 
            : '<span style="color:#ffb74d; font-weight:bold; font-size:0.8em;">Ciclo 30</span>';

        row.innerHTML = `
            <td>${d[2]}/${d[1]}</td>
            <td><div style="font-weight:600; ${rowStyle}">${desc}</div><div style="font-size:0.8em; color:#aaa;">${e.category}</div></td>
            <td style="font-weight:bold;">R$ ${e.amount.toFixed(2)}</td>
            <td>${cycleBadge}</td>
            <td>
                <div class="expense-row-actions">
                    <button class="btn-edit" onclick="editExpense('${e.id}')">✏️</button>
                    <button class="btn-delete" onclick="deleteExpense('${e.id}')">🗑️</button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
}

// Prepara edição
window.editExpense = function(id) {
    const expense = currentExpensesData.find(e => e.id === id);
    if(!expense) return;

    document.getElementById("expense-id").value = expense.id;
    document.getElementById("expense-description").value = expense.description;
    document.getElementById("expense-value").value = expense.amount;
    document.getElementById("expense-date").value = expense.date;
    document.getElementById("expense-category").value = expense.category;
    document.getElementById("expense-installments").value = expense.total_installments || 1;
    
    // Seleciona método e dispara evento para mostrar campos corretos
    const paymentSelect = document.getElementById("expense-payment");
    if (expense.payment_method.includes("Crédito")) {
        paymentSelect.value = "Credit_Card";
    } else {
        paymentSelect.value = (expense.payment_method === "Pix" || expense.payment_method === "Dinheiro") ? "Pix" : "Débito";
    }
    paymentSelect.dispatchEvent(new Event('change'));

    // Preenche selects específicos após delay
    setTimeout(() => {
        if(expense.card_id) document.getElementById("expense-card-source").value = expense.card_id;
        else if(expense.bank_account_id) document.getElementById("expense-account-source").value = `ACC-${expense.bank_account_id}`;
    }, 50);

    const btn = document.getElementById("save-expense-btn");
    btn.textContent = "Atualizar Gasto";
    btn.style.backgroundColor = "#fbc02d";
    btn.style.color = "black";
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function addOrUpdateExpense(event) {
    event.preventDefault();
    const id = document.getElementById("expense-id").value;
    const payMethod = document.getElementById("expense-payment").value;
    
    let cardId = null, bankId = null, accName = "Carteira", finalMethod = payMethod;

    if (payMethod === "Credit_Card") {
        cardId = document.getElementById("expense-card-source").value;
        if(!cardId) { alert("Selecione o Cartão!"); return; }
        finalMethod = "Crédito"; 
        const sel = document.getElementById("expense-card-source");
        accName = sel.options[sel.selectedIndex].text;
    } else {
        const sourceVal = document.getElementById("expense-account-source").value;
        if(sourceVal) {
            if(sourceVal.startsWith("ACC-")) bankId = sourceVal.split("-")[1];
            else if(sourceVal.startsWith("CARD-")) cardId = sourceVal.split("-")[1];
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

    const method = id ? "PUT" : "POST";
    const url = id ? `${API_URL}/expenses/${id}` : `${API_URL}/expenses`;
    
    const response = await fetch(url, {
        method: method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if(response.ok) {
        document.getElementById("expense-form").reset();
        document.getElementById("expense-id").value = "";
        const btn = document.getElementById("save-expense-btn");
        btn.textContent = "Salvar Gasto";
        btn.style.backgroundColor = "var(--accent-green)";
        btn.style.color = "black";
        
        showFeedback("Salvo com sucesso!", "success");
        loadExpenses(); loadAccountsAndCards(); loadCyclesProjection();
    } else {
        const err = await response.json();
        showFeedback(err.error, "error");
    }
}

async function deleteExpense(id) {
    if(confirm("Excluir gasto?")) {
        await fetch(`${API_URL}/expenses/${id}`, { method: "DELETE" });
        loadExpenses(); loadAccountsAndCards(); loadCyclesProjection();
    }
}

/* ==========================================================================
   BANCOS E CARTÕES
   ========================================================================== */
async function loadAccountsAndCards() {
    try {
        const response = await fetch(`${API_URL}/accounts`);
        if (!response.ok) throw new Error("Falha");
        currentAccountsData = await response.json();
        
        renderBanksDashboard();
        renderFormDropdowns();      
        renderFilterOptions();      
    } catch (error) { console.error("Erro contas:", error); }
}

function renderBanksDashboard() {
    const container = document.getElementById("banks-dashboard-container");
    container.innerHTML = "";
    
    if (currentAccountsData.length === 0) {
        container.innerHTML = "<p class='banks-loading'>Nenhuma conta cadastrada.</p>"; return;
    }

    currentAccountsData.forEach(acc => {
        const div = document.createElement("div");
        div.className = "bank-display-item";
        
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
                        <div class="cc-metric" style="text-align:right"><span class="cc-label">Limite</span><span class="cc-value-limit">R$ <span class="editable-limit" onclick="editBalance(this, 'card', ${card.id})">${formatSimple(card.limit)}</span></span></div>
                    </div>
                </div>`;
        });
        
        div.innerHTML = `
            <div class="bank-header-styled">
                <span class="bank-name-large">🏛️ ${acc.name}</span>
                <span class="bank-balance-large">R$ <span class="editable-balance" onclick="editBalance(this, 'account', ${acc.id})">${formatSimple(acc.balance)}</span></span>
            </div>
            ${cardsHtml || '<div class="debit-only-badge">Apenas Débito</div>'}
        `;
        container.appendChild(div);
    });
}

// Edição de Saldo ao Clicar
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
    input.addEventListener("keydown", (e) => { if(e.key === "Enter") input.blur(); });
}

// Modal de Pagamento
function openPayInvoiceModal(id, name, val) {
    document.getElementById("pay-invoice-card-id").value = id;
    document.getElementById("pay-invoice-card-name").value = name;
    document.getElementById("pay-invoice-display-total").textContent = formatCurrency(val || 0);
    document.getElementById("pay-invoice-amount").value = (val || 0).toFixed(2);
    
    const select = document.getElementById("pay-invoice-bank-source");
    select.innerHTML = "";
    currentAccountsData.forEach(acc => {
        select.innerHTML += `<option value="${acc.id}">${acc.name} (R$ ${formatSimple(acc.balance)})</option>`;
    });
    openModal("pay-invoice-modal");
}

async function confirmPayInvoice() {
    const payload = {
        card_id: document.getElementById("pay-invoice-card-id").value,
        bank_account_id: document.getElementById("pay-invoice-bank-source").value,
        amount: parseFloat(document.getElementById("pay-invoice-amount").value),
        date: document.getElementById("pay-invoice-date").value
    };
    const res = await fetch(`${API_URL}/cards/pay_invoice`, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
    });
    if(res.ok) {
        closeModal("pay-invoice-modal");
        showFeedback("Fatura Paga!", "success");
        loadAccountsAndCards(); loadExpenses(); loadCyclesProjection();
    } else {
        const err = await res.json(); showFeedback(err.error, "error");
    }
}

/* ==========================================================================
   CATEGORIAS
   ========================================================================== */
async function loadCategories() {
    const res = await fetch(`${API_URL}/categories`);
    const cats = await res.json();
    const list = document.getElementById("category-list");
    const select = document.getElementById("expense-category");
    const filter = document.getElementById("filter-category");
    
    list.innerHTML = ""; 
    select.innerHTML = "";
    filter.innerHTML = '<option value="">Categoria: Todas</option>';
    
    cats.forEach(c => {
        select.innerHTML += `<option value="${c.name}">${c.name}</option>`;
        filter.innerHTML += `<option value="${c.name}">${c.name}</option>`;
        
        const li = document.createElement("li");
        li.innerHTML = `
            <span>${c.name}</span>
            <div class="category-actions">
                <button class="btn-edit" onclick="editCategory(${c.id}, '${c.name}')" style="padding:2px 6px;">✏️</button>
                <button class="btn-delete" onclick="deleteCategory(${c.id})" style="padding:2px 6px;">🗑️</button>
            </div>`;
        list.appendChild(li);
    });
}

window.editCategory = async function(id, name) {
    const newName = prompt("Novo nome:", name);
    if(newName && newName !== name) {
        await fetch(`${API_URL}/categories/${id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({name: newName}) });
        loadCategories(); loadExpenses();
    }
}

async function deleteCategory(id) {
    if(confirm("Excluir categoria?")) { await fetch(`${API_URL}/categories/${id}`, { method: 'DELETE' }); loadCategories(); }
}

async function addCategory() {
    const name = document.getElementById("new-category-name").value;
    if(name) { await fetch(`${API_URL}/categories`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({name}) }); document.getElementById("new-category-name").value = ""; loadCategories(); }
}

/* ==========================================================================
   GESTÃO DE CONTAS (MODAL)
   ========================================================================== */
function renderAccountsModal() {
    const container = document.getElementById("accounts-list-display");
    if(currentAccountsData.length === 0) { container.innerHTML = "<p>Nenhuma conta.</p>"; return; }
    
    container.innerHTML = currentAccountsData.map(acc => `
        <div class="bank-account-item">
            <div class="bank-header">
                <span class="bank-name">🏛️ ${acc.name}</span>
                <button class="btn-delete btn-sm-action" onclick="deleteAccount(${acc.id})">Excluir</button>
            </div>
            <div class="card-add-container">
                <div class="card-add-row">
                    <select id="new-card-type-${acc.id}" class="card-type-select" onchange="toggleCardDates(${acc.id})"><option value="CREDIT">Crédito</option><option value="DEBIT">Débito</option></select>
                    <input type="text" id="new-card-name-${acc.id}" placeholder="Nome Cartão" class="card-name-input">
                </div>
                <div id="date-inputs-${acc.id}" class="date-inputs-container">
                    <input type="number" id="new-card-closing-${acc.id}" placeholder="Fech." class="card-date-input">
                    <input type="number" id="new-card-due-${acc.id}" placeholder="Venc." class="card-date-input">
                </div>
                <button onclick="addCardToAccount(${acc.id})" class="btn-add-card-confirm">Add Cartão</button>
            </div>
            <div class="card-list-nested">
                ${acc.cards.map(c => `
                    <div class="card-item-nested">
                        <span>${c.type === 'CREDIT' ? '💳' : '🏧'} ${c.name}</span>
                        <button class="btn-delete btn-sm-action" onclick="deleteCard(${c.id})">🗑️</button>
                    </div>`).join("")}
            </div>
        </div>
    `).join("");
}

window.toggleCardDates = function(accId) {
    const type = document.getElementById(`new-card-type-${accId}`).value;
    const dates = document.getElementById(`date-inputs-${accId}`);
    dates.style.display = (type === 'CREDIT') ? 'flex' : 'none';
}

async function saveNewAccount() {
    const name = document.getElementById("new-account-name").value;
    if(name) { await fetch(`${API_URL}/accounts`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({name}) }); document.getElementById("new-account-name").value = ""; loadAccountsAndCards(); renderAccountsModal(); }
}

async function deleteAccount(id) {
    if(confirm("Excluir conta?")) { await fetch(`${API_URL}/accounts/${id}`, { method: 'DELETE' }); loadAccountsAndCards(); renderAccountsModal(); }
}

async function addCardToAccount(accId) {
    const payload = {
        name: document.getElementById(`new-card-name-${accId}`).value,
        card_type: document.getElementById(`new-card-type-${accId}`).value,
        closing_day: document.getElementById(`new-card-closing-${accId}`).value,
        due_day: document.getElementById(`new-card-due-${accId}`).value,
        bank_account_id: accId
    };
    if(!payload.name) return;
    await fetch(`${API_URL}/cards`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    loadAccountsAndCards(); renderAccountsModal();
}

async function deleteCard(id) {
    if(confirm("Excluir cartão?")) { await fetch(`${API_URL}/cards/${id}`, { method: 'DELETE' }); loadAccountsAndCards(); renderAccountsModal(); }
}

function renderFormDropdowns() {
    const accSel = document.getElementById("expense-account-source");
    const cardSel = document.getElementById("expense-card-source");
    accSel.innerHTML = '<option value="">-- Escolha --</option>';
    cardSel.innerHTML = '<option value="">-- Escolha --</option>';
    
    currentAccountsData.forEach(acc => {
        accSel.innerHTML += `<option value="ACC-${acc.id}">Conta: ${acc.name}</option>`;
        const debits = acc.cards.filter(c => c.type === 'DEBIT');
        if(debits.length) {
             const grp = document.createElement("optgroup"); grp.label = acc.name;
             debits.forEach(c => grp.innerHTML += `<option value="CARD-${c.id}">${c.name}</option>`);
             accSel.appendChild(grp);
        }
        const credits = acc.cards.filter(c => c.type === 'CREDIT');
        if(credits.length) {
            const grp = document.createElement("optgroup"); grp.label = acc.name;
            credits.forEach(c => grp.innerHTML += `<option value="${c.id}">${c.name}</option>`);
            cardSel.appendChild(grp);
        }
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
        if(c.type === 'CREDIT' && c.due_day) {
            let diff = c.due_day - today;
            if(diff < 0) diff += 30;
            if(diff < minDiff) { minDiff = diff; best = c; }
        }
    }));
    if(best) { document.getElementById("filter-source").value = `CARD-${best.id}`; loadExpenses(); showFeedback(`Filtrando: ${best.name}`, "success"); }
    else alert("Nenhum cartão encontrado.");
}

/* ==========================================================================
   GRÁFICOS E UTILITÁRIOS
   ========================================================================== */
function switchChart(mode) { 
    currentChartMode = mode; 
    document.getElementById('btn-chart-month').classList.toggle('active', mode === 'month'); 
    document.getElementById('btn-chart-year').classList.toggle('active', mode === 'year'); 
    if (mode === 'month') renderChart(currentExpensesData); else renderAnnualChart(); 
}

function renderChart(expenses) { 
    const ctx = document.getElementById("expensesChart").getContext("2d"); 
    
    // Agrupa valores por categoria
    const totals = {}; 
    expenses.forEach((e) => { 
        if (e.category === "Pagamento de Fatura") return;
        totals[e.category] = (totals[e.category] || 0) + e.amount; 
    }); 
    
    const labels = Object.keys(totals); 
    const data = Object.values(totals); 
    
    if (expensesChart) expensesChart.destroy(); 
    
    expensesChart = new Chart(ctx, { 
        type: "bar", 
        data: { 
            labels: labels, 
            datasets: [{ 
                label: 'Gastos do Mês', 
                data: data, 
                // Paleta de cores variada (Estilo antigo)
                backgroundColor: ["#00e676", "#ff5252", "#2979ff", "#ffea00", "#ff9100", "#d500f9", "#00b0ff", "#ff1744"], 
                borderWidth: 0, 
                borderRadius: 4, // Cantos arredondados
                barPercentage: 0.6, // Barras mais finas e elegantes
                maxBarThickness: 50 
            }] 
        }, 
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { 
                legend: { display: false }, 
                tooltip: { 
                    callbacks: { 
                        // Formata o valor para R$ ao passar o mouse
                        label: function(context) { 
                            return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(context.raw); 
                        } 
                    } 
                } 
            }, 
            scales: { 
                x: { 
                    ticks: { color: '#000000', font: { size: 11 } }, 
                    grid: { display: false } 
                }, 
                y: { 
                    beginAtZero: true, 
                    ticks: { color: '#000000', font: { weight: 'bold' } }, 
                    grid: { color: '#807e7e' } // Linhas de grade cinza suave
                } 
            } 
        } 
    }); 
}
function renderAnnualChart() { 
    fetch(`${API_URL}/dashboard/annual`)
    .then(res => res.json())
    .then(data => { 
        const ctx = document.getElementById("expensesChart").getContext("2d"); 
        if (expensesChart) expensesChart.destroy(); 
        
        const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']; 
        
        expensesChart = new Chart(ctx, { 
            type: 'line', 
            data: { 
                labels: months, 
                datasets: [ 
                    { 
                        label: 'Crédito', 
                        data: data.credit, 
                        borderColor: '#ff5252', // Vermelho
                        backgroundColor: 'rgba(255, 82, 82, 0.15)', // Fundo suave
                        borderWidth: 2, 
                        pointRadius: 3, 
                        tension: 0.4, // Curva suave
                        fill: true 
                    }, 
                    { 
                        label: 'Débito/Pix', 
                        data: data.debit, 
                        borderColor: '#00e676', // Verde
                        backgroundColor: 'rgba(0, 230, 118, 0.15)', // Fundo suave
                        borderWidth: 2, 
                        pointRadius: 3, 
                        tension: 0.4, 
                        fill: true 
                    } 
                ] 
            }, 
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                interaction: { mode: 'index', intersect: false }, 
                plugins: { 
                    legend: { display: true, labels: { color: '#000000' } },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ' + new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(context.raw);
                            }
                        }
                    }
                }, 
                scales: { 
                    x: { ticks: { color: '#000000' } }, 
                    y: { 
                        ticks: { color: '#000000' }, 
                        grid: { color: '#807e7e', borderDash: [5, 5] } // Grade pontilhada
                    } 
                } 
            } 
        }); 
    }); 
}
async function exportToExcel() {
    if(!currentExpensesData.length) { alert("Sem dados."); return; }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Relatório');
    ws.columns = [{header:'Data', key:'d'}, {header:'Desc', key:'desc'}, {header:'Valor', key:'v'}, {header:'Cat', key:'c'}, {header:'Tipo', key:'t'}];
    currentExpensesData.forEach(e => {
        if(e.category !== "Pagamento de Fatura") ws.addRow({d:e.date, desc:e.description, v:e.amount, c:e.category, t:e.payment_method});
    });
    const buffer = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), "Relatorio_Financeiro.xlsx");
}

function formatCurrency(v) { return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function formatSimple(v) { return (v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 }); }
function openModal(id) { document.getElementById(id).classList.add("show"); }
function closeModal(id) { document.getElementById(id).classList.remove("show"); }
function buildQueryString() {
    const m = document.getElementById("filter-month").value;
    const c = document.getElementById("filter-category").value;
    const p = document.getElementById("filter-payment").value;
    const s = document.getElementById("filter-source").value;
    return `?month=${m}&category=${c}&payment_method=${p}&source=${s}`;
}
function clearFilters() {
    document.getElementById("filter-category").value = "";
    document.getElementById("filter-payment").value = "";
    document.getElementById("filter-source").value = "";
    loadExpenses();
}