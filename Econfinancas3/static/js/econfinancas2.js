/* ==========================================================================
   CONFIGURAÇÕES GERAIS E INICIALIZAÇÃO
   ========================================================================== */
const API_URL = "http://127.0.0.1:5000/api";
let expensesChart = null;
let currentAccountsData = [];
let currentExpensesData = [];

document.addEventListener("DOMContentLoaded", () => {
    const today = new Date();
    const monthStr = today.toISOString().slice(0, 7);
    document.getElementById("filter-month").value = monthStr;

    loadExpenses();
    loadCategories();
    loadAccountsAndCards();
    updateIncome();
    setupEventListeners();
});

function setupEventListeners() {
    document.getElementById("expense-form").addEventListener("submit", addOrUpdateExpense);
    document.getElementById("add-category-btn").addEventListener("click", addCategory);

    document.getElementById("filter-category").addEventListener("change", loadExpenses);
    document.getElementById("filter-payment").addEventListener("change", loadExpenses);
    document.getElementById("filter-month").addEventListener("change", loadExpenses);
    document.getElementById("filter-cycle").addEventListener("change", loadExpenses);
    document.getElementById("filter-source").addEventListener("change", loadExpenses); // <--- NOVO LISTENER

    document.getElementById("clear-filters-btn").addEventListener("click", clearFilters);
    document.getElementById("export-btn").addEventListener("click", exportToExcel);

    document.getElementById("manage-cycles-btn").addEventListener("click", () => openModal("cycles-modal"));
    document.getElementById("open-accounts-modal-btn").addEventListener("click", () => openModal("accounts-modal"));
    document.getElementById("close-accounts-modal-btn").addEventListener("click", () => closeModal("accounts-modal"));
    document.getElementById("modal-cancel-btn").addEventListener("click", () => closeModal("confirmation-modal"));
    document.getElementById("save-account-btn").addEventListener("click", saveNewAccount);

    document.getElementById("expense-payment").addEventListener("change", function () {
        const method = this.value;
        const installmentsGroup = document.getElementById("installments-group");
        const cardContainer = document.getElementById("card-choice-container");
        const accountContainer = document.getElementById("account-choice-container");

        installmentsGroup.style.display = "none";
        cardContainer.style.display = "none";
        accountContainer.style.display = "none";
        document.getElementById("expense-installments").value = "1";

        if (method === "Credit_Card") {
            cardContainer.style.display = "block";
            installmentsGroup.style.display = "block";
        } else if (method === "Débito" || method === "Pix") {
            accountContainer.style.display = "block";
        }
    });
}

// ... (FUNÇÕES DE CONTA E CARTÃO - IGUAIS) ...
async function loadAccountsAndCards() {
    try {
        const response = await fetch(`${API_URL}/accounts`);
        currentAccountsData = await response.json();
        renderAccountsModal();
        renderFormDropdowns();
        renderFilterOptions(); // <--- NOVA CHAMADA PARA POPULAR FILTRO
    } catch (error) { console.error("Erro ao carregar contas:", error); }
}

// ... (renderAccountsModal e toggleCardDates permanecem iguais) ...
function renderAccountsModal() {
    const container = document.getElementById("accounts-list-display");
    container.innerHTML = "";
    if (currentAccountsData.length === 0) { container.innerHTML = '<p style="text-align:center; color:#666;">Nenhuma conta cadastrada.</p>'; return; }
    currentAccountsData.forEach(account => {
        const accDiv = document.createElement("div");
        accDiv.className = "bank-account-item";
        let cardsHtml = "";
        account.cards.forEach(card => {
            const isCredit = card.type === 'CREDIT';
            const detail = isCredit ? `F:${card.closing_day}/V:${card.due_day}` : `Débito`;
            const icon = isCredit ? `💳` : `🏧`;
            cardsHtml += `<div class="card-item-nested"><span>${icon} ${card.name} <small style="color:#aaa;">(${detail})</small></span><button class="btn-delete btn-sm-action" onclick="deleteCard(${card.id})">🗑️</button></div>`;
        });
        accDiv.innerHTML = `<div class="bank-header"><span class="bank-name">🏛️ ${account.name}</span><button class="btn-delete btn-sm-action" onclick="deleteAccount(${account.id})">Excluir Conta</button></div><div style="background:#222; padding:5px; border-radius:4px; margin-bottom:5px;"><div style="display:flex; gap:5px; margin-bottom:5px;"><select id="new-card-type-${account.id}" style="width:30%; font-size:0.8em; padding:4px; background:#444; border:none; color:white;" onchange="toggleCardDates(${account.id})"><option value="CREDIT">Crédito</option><option value="DEBIT">Débito</option></select><input type="text" id="new-card-name-${account.id}" placeholder="Nome Cartão" style="flex:1; font-size: 0.8em; padding: 4px; background:#444; border:none; color:white;"></div><div id="date-inputs-${account.id}" class="date-inputs-container" style="display:flex; gap:5px;"><input type="number" id="new-card-closing-${account.id}" placeholder="Dia Fech." title="Dia Fechamento" style="width: 50%; font-size: 0.8em; padding: 4px; background:#444; border:none; color:white;"><input type="number" id="new-card-due-${account.id}" placeholder="Dia Venc." title="Dia Vencimento" style="width: 50%; font-size: 0.8em; padding: 4px; background:#444; border:none; color:white;"></div><button onclick="addCardToAccount(${account.id})" class="btn-edit" style="width:100%; margin-top:5px; font-size: 0.8em; background: var(--accent-green); color: black;">+ Adicionar Cartão</button></div><div class="card-list-nested">${cardsHtml.length > 0 ? cardsHtml : '<small style="color:#666;">Sem cartões cadastrados</small>'}</div>`;
        container.appendChild(accDiv);
    });
}
window.toggleCardDates = function (accountId) {
    const type = document.getElementById(`new-card-type-${accountId}`).value;
    const dateContainer = document.getElementById(`date-inputs-${accountId}`);
    if (type === 'DEBIT') dateContainer.style.display = 'none';
    else dateContainer.style.display = 'flex';
}

// ... (renderFormDropdowns permanece igual) ...
function renderFormDropdowns() {
    const accSelect = document.getElementById("expense-account-source");
    const cardSelect = document.getElementById("expense-card-source");
    accSelect.innerHTML = '<option value="">-- Escolha --</option>';
    cardSelect.innerHTML = '<option value="">-- Escolha o Cartão --</option>';
    currentAccountsData.forEach(acc => {
        const accOpt = document.createElement("option"); accOpt.value = `ACC-${acc.id}`; accOpt.textContent = `Conta: ${acc.name}`; accSelect.appendChild(accOpt);
        const debitCards = acc.cards.filter(c => c.type === 'DEBIT');
        if (debitCards.length > 0) { const groupD = document.createElement("optgroup"); groupD.label = `${acc.name} (Cartões)`; debitCards.forEach(c => { const opt = document.createElement("option"); opt.value = `CARD-${c.id}`; opt.textContent = `🏧 ${c.name}`; groupD.appendChild(opt); }); accSelect.appendChild(groupD); }
        const creditCards = acc.cards.filter(c => c.type === 'CREDIT');
        if (creditCards.length > 0) { const groupC = document.createElement("optgroup"); groupC.label = acc.name; creditCards.forEach(c => { const opt = document.createElement("option"); opt.value = c.id; opt.textContent = `💳 ${c.name} (Vence dia ${c.due_day})`; groupC.appendChild(opt); }); cardSelect.appendChild(groupC); }
    });
}

// NOVA FUNÇÃO: POPULA O FILTRO DE ORIGEM
function renderFilterOptions() {
    const filterSelect = document.getElementById("filter-source");
    filterSelect.innerHTML = '<option value="">Origem: Todas</option>';

    currentAccountsData.forEach(acc => {
        const group = document.createElement("optgroup");
        group.label = acc.name;

        // Opção para a Conta (Débito/Pix)
        const accOpt = document.createElement("option");
        accOpt.value = `ACC-${acc.id}`;
        accOpt.textContent = `Conta (Débito/Pix)`;
        group.appendChild(accOpt);

        // Opções para cada Cartão
        acc.cards.forEach(card => {
            const cardOpt = document.createElement("option");
            cardOpt.value = `CARD-${card.id}`;
            const type = card.type === 'CREDIT' ? 'Crédito' : 'Débito';
            cardOpt.textContent = `${card.name} (${type})`;
            group.appendChild(cardOpt);
        });

        filterSelect.appendChild(group);
    });
}

// ... (AÇÕES DE CONTA E CARTÃO - IGUAIS) ...
async function saveNewAccount() { const nameInput = document.getElementById("new-account-name"); if (!nameInput.value) return; await fetch(`${API_URL}/accounts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: nameInput.value }) }); nameInput.value = ""; loadAccountsAndCards(); }
async function deleteAccount(id) { if (confirm("Excluir conta?")) { await fetch(`${API_URL}/accounts/${id}`, { method: "DELETE" }); loadAccountsAndCards(); } }
async function addCardToAccount(accountId) {
    const name = document.getElementById(`new-card-name-${accountId}`).value; const type = document.getElementById(`new-card-type-${accountId}`).value; const close = document.getElementById(`new-card-closing-${accountId}`).value; const due = document.getElementById(`new-card-due-${accountId}`).value;
    if (!name) { alert("Nome obrigatório"); return; } if (type === 'CREDIT' && (!close || !due)) { alert("Para crédito, preencha as datas"); return; }
    await fetch(`${API_URL}/cards`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name, card_type: type, closing_day: close || null, due_day: due || null, bank_account_id: accountId }) }); loadAccountsAndCards();
}
async function deleteCard(id) { if (confirm("Excluir cartão?")) { await fetch(`${API_URL}/cards/${id}`, { method: "DELETE" }); loadAccountsAndCards(); } }

/* CRUD GASTOS */
async function loadExpenses() {
    try {
        const query = buildQueryString();
        const response = await fetch(`${API_URL}/expenses${query}`);
        const expenses = await response.json();
        currentExpensesData = expenses;
        renderTable(expenses);
        updateDashboard(expenses);
        renderChart(expenses);
    } catch (e) { console.error(e); }
}

function buildQueryString() {
    const c = document.getElementById("filter-category").value;
    const p = document.getElementById("filter-payment").value;
    const m = document.getElementById("filter-month").value;
    const cy = document.getElementById("filter-cycle").value;
    const src = document.getElementById("filter-source").value; // <--- LÊ O NOVO FILTRO

    let q = "?";
    if (c) q += `category=${encodeURIComponent(c)}&`;
    if (p) q += `payment_method=${encodeURIComponent(p)}&`;
    if (m) q += `month=${m}&`;
    if (cy) q += `cycle=${cy}&`;
    if (src) q += `source=${src}&`; // <--- ENVIA PRO BACKEND
    return q;
}

// ... (RESTANTE DO ARQUIVO IGUAL) ...
async function addOrUpdateExpense(event) {
    event.preventDefault();
    const id = document.getElementById("expense-id").value;
    const desc = document.getElementById("expense-description").value;
    const val = parseFloat(document.getElementById("expense-value").value);
    const date = document.getElementById("expense-date").value;
    const cat = document.getElementById("expense-category").value;
    const payMethod = document.getElementById("expense-payment").value;
    const installments = parseInt(document.getElementById("expense-installments").value);
    let cardId = null; let bankId = null; let accName = "Carteira"; let finalMethod = payMethod;

    if (payMethod === "Credit_Card") {
        cardId = document.getElementById("expense-card-source").value;
        if (!cardId) { alert("Erro: Você deve selecionar um Cartão de Crédito!"); return; }
        finalMethod = "Crédito";
        const sel = document.getElementById("expense-card-source");
        if (sel.selectedIndex > -1) accName = sel.options[sel.selectedIndex].text;
    }
    else if (payMethod === "Débito" || payMethod === "Pix") {
        const sourceVal = document.getElementById("expense-account-source").value;
        if (sourceVal) {
            const sel = document.getElementById("expense-account-source");
            accName = sel.options[sel.selectedIndex].text + ` (${payMethod})`;
            if (sourceVal.startsWith("ACC-")) bankId = sourceVal.split("-")[1];
            else if (sourceVal.startsWith("CARD-")) cardId = sourceVal.split("-")[1];
        }
    }

    const payload = {
        description: desc, amount: val, date: date, category: cat,
        payment_method: finalMethod, account_name: accName,
        card_id: cardId, bank_account_id: bankId,
        is_credit_card: (finalMethod === "Crédito"),
        total_installments: installments
    };

    try {
        const method = id ? "PUT" : "POST";
        const url = id ? `${API_URL}/expenses/${id}` : `${API_URL}/expenses`;
        const response = await fetch(url, { method: method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!response.ok) throw new Error("Erro ao salvar");
        document.getElementById("expense-form").reset();
        document.getElementById("expense-id").value = "";
        document.getElementById("save-expense-btn").textContent = "Salvar Gasto";
        document.getElementById("save-expense-btn").style.backgroundColor = "var(--accent-green)";
        document.getElementById("card-choice-container").style.display = "none";
        document.getElementById("account-choice-container").style.display = "none";
        document.getElementById("installments-group").style.display = "none";
        showFeedback("Salvo com sucesso!", "success");
        loadExpenses();
    } catch (e) { console.error(e); showFeedback("Erro ao salvar.", "error"); }
}

window.editExpense = function (id) {
    const expense = currentExpensesData.find(e => e.id === id);
    if (!expense) return;
    document.getElementById("expense-id").value = expense.id;
    document.getElementById("expense-description").value = expense.description;
    document.getElementById("expense-value").value = expense.amount;
    document.getElementById("expense-date").value = expense.date;
    document.getElementById("expense-category").value = expense.category;
    const paymentSelect = document.getElementById("expense-payment");
    const installmentsSelect = document.getElementById("expense-installments");

    if (expense.payment_method === "Crédito") {
        paymentSelect.value = "Credit_Card";
        paymentSelect.dispatchEvent(new Event('change'));
        setTimeout(() => { if (expense.card_id) document.getElementById("expense-card-source").value = expense.card_id; }, 100);
    } else if (expense.bank_account_id || (expense.card_id && expense.payment_method !== "Crédito")) {
        paymentSelect.value = expense.payment_method;
        paymentSelect.dispatchEvent(new Event('change'));
        setTimeout(() => {
            if (expense.bank_account_id) document.getElementById("expense-account-source").value = `ACC-${expense.bank_account_id}`;
            else if (expense.card_id) document.getElementById("expense-account-source").value = `CARD-${expense.card_id}`;
        }, 100);
    } else {
        paymentSelect.value = "Outros";
        paymentSelect.dispatchEvent(new Event('change'));
    }
    installmentsSelect.value = expense.total_installments || 1;
    const btn = document.getElementById("save-expense-btn");
    btn.textContent = "Atualizar Gasto";
    btn.style.backgroundColor = "#fbc02d";
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.deleteExpense = async function (id) { if (confirm("Excluir?")) { await fetch(`${API_URL}/expenses/${id}`, { method: "DELETE" }); loadExpenses(); } }

function renderTable(expenses) {
    const tbody = document.getElementById("expense-table-body");
    tbody.innerHTML = "";
    expenses.forEach(e => {
        const row = document.createElement("tr");
        const d = e.date.split("-");
        let badge = "pgto-outros";
        if (e.payment_method.includes("Crédito")) badge = "pgto-credito";
        else if (e.payment_method === "Débito") badge = "pgto-debito";
        else if (e.payment_method === "Pix") badge = "pgto-pix";

        let desc = e.description;
        if (e.total_installments > 1) desc += ` <small>(${e.current_installment}/${e.total_installments})</small>`;

        let accDisplay = e.account;
        if (e.computed_cycle) accDisplay = `Ciclo ${e.computed_cycle}`;

        row.innerHTML = `<td>${d[2]}/${d[1]}/${d[0]}</td><td><div style="font-weight:600">${desc}</div><div style="font-size:0.8em; color:#aaa;">${e.category}</div></td><td><div style="font-size:0.85em;">${accDisplay}</div></td><td style="font-weight:bold;">R$ ${e.amount.toFixed(2)}</td><td><span class="badge-pgto ${badge}">${e.payment_method}</span></td><td style="display:flex; gap:5px;"><button class="btn-edit" onclick="editExpense('${e.id}')">✏️</button><button class="btn-delete" onclick="deleteExpense('${e.id}')">🗑️</button></td>`;
        tbody.appendChild(row);
    });
}

function updateDashboard(expenses) {
    let c15 = 0, o15 = 0, c30 = 0, o30 = 0;
    expenses.forEach(e => {
        const isCred = e.payment_method.includes("Crédito");
        const cycle = e.computed_cycle;
        if (isCred) { if (cycle === 15) c15 += e.amount; else c30 += e.amount; } else { if (cycle === 15) o15 += e.amount; else o30 += e.amount; }
    });
    document.getElementById("card-total-15").textContent = formatCurrency(c15);
    document.getElementById("other-total-15").textContent = formatCurrency(o15);
    document.getElementById("total-cycle-15").textContent = formatCurrency(c15 + o15);
    document.getElementById("card-total-30").textContent = formatCurrency(c30);
    document.getElementById("other-total-30").textContent = formatCurrency(o30);
    document.getElementById("total-cycle-30").textContent = formatCurrency(c30 + o30);
    calculateBalances(c15 + o15, c30 + o30);
}

// UTILS
async function loadCategories() {
    try {
        const response = await fetch(`${API_URL}/categories`);
        const categories = await response.json();
        const select = document.getElementById("expense-category");
        const filterSelect = document.getElementById("filter-category");
        const list = document.getElementById("category-list");
        select.innerHTML = ""; filterSelect.innerHTML = '<option value="">Categoria: Todas</option>'; list.innerHTML = "";
        categories.forEach((cat) => {
            const option = document.createElement("option"); option.value = cat.name; option.textContent = cat.name; select.appendChild(option);
            const filterOption = option.cloneNode(true); filterSelect.appendChild(filterOption);
            const li = document.createElement("li");
            li.innerHTML = `<span>${cat.name}</span><div style="display:flex; gap:5px;"><button class="btn-edit" onclick="editCategory('${cat.id}', '${cat.name}')" style="padding:2px 6px; font-size:0.7em;">✏️</button><button class="btn-delete" onclick="deleteCategory(${cat.id})" style="padding:2px 6px; font-size:0.7em;">X</button></div>`;
            list.appendChild(li);
        });
    } catch (error) { console.error("Erro categorias:", error); }
}
async function addCategory() {
    const nameInput = document.getElementById("new-category-name");
    if (!nameInput.value) return;
    await fetch(`${API_URL}/categories`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: nameInput.value }), });
    nameInput.value = ""; loadCategories();
}
window.editCategory = async function (id, currentName) {
    const newName = prompt("Novo nome:", currentName);
    if (newName && newName !== currentName) { await fetch(`${API_URL}/categories/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName }) }); loadCategories(); }
}
window.deleteCategory = async function (id) { if (confirm("Excluir?")) { await fetch(`${API_URL}/categories/${id}`, { method: "DELETE" }); loadCategories(); } }
function updateIncome() {
    const income15 = parseCurrency(document.getElementById("income-15").value);
    const income30 = parseCurrency(document.getElementById("income-30").value);
    localStorage.setItem("income15", income15); localStorage.setItem("income30", income30);
    loadExpenses();
}
function calculateBalances(total15, total30) {
    let val15 = localStorage.getItem("income15") || 0; let val30 = localStorage.getItem("income30") || 0;
    if (document.getElementById("income-15").value === "") document.getElementById("income-15").value = formatSimple(val15);
    if (document.getElementById("income-30").value === "") document.getElementById("income-30").value = formatSimple(val30);
    const balance15 = parseFloat(val15) - total15; const balance30 = parseFloat(val30) - total30;
    const el15 = document.getElementById("balance-15"); const el30 = document.getElementById("balance-30");
    el15.textContent = formatCurrency(balance15); el15.className = "balance-final " + (balance15 >= 0 ? "positive" : "negative");
    el30.textContent = formatCurrency(balance30); el30.className = "balance-final " + (balance30 >= 0 ? "positive" : "negative");
}
function formatCurrency(value) { return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function formatSimple(value) { return parseFloat(value).toLocaleString("pt-BR", { minimumFractionDigits: 2 }); }
function parseCurrency(strValue) { if (!strValue) return 0; return parseFloat(strValue.replace(/\./g, "").replace(",", ".")); }
function maskCurrency(input) { let value = input.value.replace(/\D/g, ""); value = (value / 100).toFixed(2) + ""; value = value.replace(".", ","); value = value.replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1."); input.value = value; }
function clearFilters() {
    const today = new Date();
    document.getElementById("filter-month").value = today.toISOString().slice(0, 7);
    document.getElementById("filter-category").value = "";
    document.getElementById("filter-payment").value = "";
    document.getElementById("filter-cycle").value = "";
    document.getElementById("filter-source").value = ""; // RESET ORIGEM
    loadExpenses();
}
function showFeedback(message, type) { const el = document.getElementById("feedback-message"); el.textContent = message; el.className = type; el.style.display = "block"; setTimeout(() => { el.style.display = "none"; }, 3000); }
function openModal(id) { document.getElementById(id).classList.add("show"); if (id === 'accounts-modal') loadAccountsAndCards(); }
function closeModal(id) { document.getElementById(id).classList.remove("show"); }
function showConfirmation(message, onConfirm) { const modal = document.getElementById("confirmation-modal"); document.getElementById("modal-message").textContent = message; modal.classList.add("show"); const oldBtn = document.getElementById("modal-confirm-btn"); const newBtn = oldBtn.cloneNode(true); oldBtn.parentNode.replaceChild(newBtn, oldBtn); newBtn.addEventListener("click", () => { onConfirm(); closeModal("confirmation-modal"); }); }

function closeCycle(day) {
    const confirmation = confirm(`Deseja realmente encerrar o CICLO ${day}?\nIsso irá apagar todos os gastos deste ciclo que sejam de hoje ou anteriores.\nEssa ação não pode ser desfeita.`);
    if (confirmation) {
        fetch(`${API_URL}/cycles/close/${day}`, { method: 'POST' })
            .then(res => res.json())
            .then(data => { showFeedback(data.message, "success"); loadExpenses(); })
            .catch(err => alert("Erro ao fechar ciclo"));
    }
}

function exportToExcel() {
    if (currentExpensesData.length === 0) { alert("Sem dados para exportar."); return; }
    let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
    csvContent += "Data;Descrição;Categoria;Valor;Pagamento;Conta;Parcela\n";
    currentExpensesData.forEach(e => {
        const val = e.amount.toString().replace('.', ',');
        const inst = e.total_installments > 1 ? `${e.current_installment} de ${e.total_installments}` : '1x';
        csvContent += `${e.date};${e.description};${e.category};${val};${e.payment_method};${e.account};${inst}\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `gastos_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

function renderChart(expenses) {
    const ctx = document.getElementById("expensesChart").getContext("2d");
    const totals = {};
    expenses.forEach((e) => { if (!totals[e.category]) totals[e.category] = 0; totals[e.category] += e.amount; });
    const labels = Object.keys(totals); const data = Object.values(totals);
    if (expensesChart) expensesChart.destroy();
    expensesChart = new Chart(ctx, { type: "bar", data: { labels: labels, datasets: [{ label: 'Gastos por Categoria', data: data, backgroundColor: ["#00e676", "#ff5252", "#2979ff", "#ffea00", "#ff9100", "#d500f9"], borderWidth: 0 }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#333' }, grid: { color: '#ccc' } }, y: { ticks: { color: '#333', font: { weight: 'bold' } }, grid: { display: false } } } } });
}