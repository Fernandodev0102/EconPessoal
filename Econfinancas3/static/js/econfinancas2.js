// --- Variáveis Globais ---
let expenses = []; 
let categories = []; 
const DEFAULT_CATEGORY_NAME = 'Outros';
let myChart = null; 

// --- Elementos do DOM ---
const expenseForm = document.getElementById('expense-form');
const expenseIdInput = document.getElementById('expense-id');
const expenseValueInput = document.getElementById('expense-value');
const expenseDateInput = document.getElementById('expense-date');
const expenseCategorySelect = document.getElementById('expense-category');
const expensePaymentSelect = document.getElementById('expense-payment');
const expenseDescriptionInput = document.getElementById('expense-description');
const saveExpenseBtn = document.getElementById('save-expense-btn');
const expenseTableBody = document.getElementById('expense-table-body');
const feedbackMessage = document.getElementById('feedback-message');

// Displays de Totais
const displayTotalGeneral = document.getElementById('total-general');
const displayTotalPaid = document.getElementById('total-paid');
const displayTotalCredit = document.getElementById('total-credit');

const ctx = document.getElementById('expensesChart').getContext('2d');

// Elementos de Categoria e Filtros
const newCategoryNameInput = document.getElementById('new-category-name');
const addCategoryBtn = document.getElementById('add-category-btn');
const categoryListUl = document.getElementById('category-list');
const filterCategorySelect = document.getElementById('filter-category');
const filterPaymentSelect = document.getElementById('filter-payment'); // NOVO ELEMENTO
const filterDateInput = document.getElementById('filter-date');
const clearFiltersBtn = document.getElementById('clear-filters-btn');
const resetDataBtn = document.getElementById('reset-data-btn');

// Modal
const confirmationModal = document.getElementById('confirmation-modal');
const modalTitle = document.getElementById('modal-title');
const modalMessage = document.getElementById('modal-message');
const modalConfirmBtn = document.getElementById('modal-confirm-btn');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
let currentConfirmAction = null;

// --- Funções Utilitárias ---

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatDate(dateString) {
    if (!dateString) return '-';
    const [year, month, day] = dateString.split('-');
    return `${day}/${month}/${year}`;
}

function showFeedback(message, type = 'info') {
    feedbackMessage.textContent = message;
    feedbackMessage.className = `show ${type}`;
    if (type === 'success') feedbackMessage.style.backgroundColor = '#28a745';
    else if (type === 'error') feedbackMessage.style.backgroundColor = '#dc3545';
    else feedbackMessage.style.backgroundColor = '#17a2b8';
    setTimeout(() => { feedbackMessage.className = ''; }, 3000);
}

function generateDistinctColor(existingColors) {
    const letters = '0123456789ABCDEF';
    let newColor;
    let attempts = 0;
    do {
        newColor = '#';
        for (let i = 0; i < 6; i++) { newColor += letters[Math.floor(Math.random() * 16)]; }
        attempts++;
    } while (existingColors.includes(newColor) && attempts < 100);
    return newColor;
}

function getPaymentClass(method) {
    const m = (method || '').toLowerCase();
    if (m === 'crédito') return 'pgto-credito';
    if (m === 'débito') return 'pgto-debito';
    if (m === 'pix') return 'pgto-pix';
    if (m === 'dinheiro') return 'pgto-dinheiro';
    return 'pgto-outros';
}

// --- API ---

async function fetchCategories() {
    try {
        const response = await fetch('/api/categories');
        if (!response.ok) throw new Error('Erro na API');
        return await response.json();
    } catch (error) { return []; }
}

async function fetchExpenses(category = '', date = '') {
    try {
        const params = new URLSearchParams();
        if (category) params.append('category', category);
        if (date) params.append('date', date);
        const response = await fetch(`/api/expenses?${params.toString()}`);
        if (!response.ok) throw new Error('Erro na API');
        return await response.json();
    } catch (error) { return []; }
}

// --- Lógica Principal (COM FILTRO NOVO) ---

async function loadAllData() {
    const currentFilterCat = filterCategorySelect.value;
    const currentFilterPay = filterPaymentSelect.value;
    
    categories = await fetchCategories();
    renderCategories();
    
    // Restaura filtros
    filterCategorySelect.value = currentFilterCat;
    filterPaymentSelect.value = currentFilterPay;
    
    await updateDashboardOnly();
}

async function updateDashboardOnly() {
    const catFilter = filterCategorySelect.value;
    const dateFilter = filterDateInput.value;
    const payFilter = filterPaymentSelect.value; // Captura filtro de pagamento

    // Busca dados no servidor (filtrando por Categoria e Data)
    let fetchedExpenses = await fetchExpenses(catFilter, dateFilter);

    // Filtra localmente por Pagamento (se houver seleção)
    if (payFilter) {
        fetchedExpenses = fetchedExpenses.filter(exp => exp.payment_method === payFilter);
    }

    expenses = fetchedExpenses;
    
    updateTotalsAndChart();
    renderExpensesTable();
}

// --- Totais e Gráfico ---

function updateTotalsAndChart() {
    let totalGeneral = 0;
    let totalPaid = 0;
    let totalCredit = 0;
    const categoryTotals = {};

    expenses.forEach(expense => {
        const val = expense.value;
        const method = expense.payment_method;

        totalGeneral += val;
        if (method === 'Crédito') totalCredit += val;
        else totalPaid += val;

        if (!categoryTotals[expense.category]) categoryTotals[expense.category] = 0;
        categoryTotals[expense.category] += val;
    });

    displayTotalGeneral.textContent = formatCurrency(totalGeneral);
    displayTotalPaid.textContent = formatCurrency(totalPaid);
    displayTotalCredit.textContent = formatCurrency(totalCredit);

    const labels = Object.keys(categoryTotals);
    const data = Object.values(categoryTotals);
    const backgroundColors = [];
    labels.forEach(() => backgroundColors.push(generateDistinctColor(backgroundColors)));

    if (myChart) myChart.destroy();

    if (totalGeneral > 0 || labels.length > 0) {
        myChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Gasto',
                    data: data,
                    backgroundColor: backgroundColors,
                    borderWidth: 1,
                    borderRadius: 4,
                    barPercentage: 0.6
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => formatCurrency(c.raw) } } },
                scales: { x: { ticks: { callback: (v) => 'R$ ' + v } } }
            }
        });
    }
}

// --- Renderização da Tabela (COR AJUSTADA) ---

function renderExpensesTable() {
    expenseTableBody.innerHTML = '';
    
    if (expenses.length === 0) {
        expenseTableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">Nenhum gasto encontrado.</td></tr>';
        return;
    }

    expenses.forEach(expense => {
        const row = expenseTableBody.insertRow();
        const method = expense.payment_method || 'Outros';
        const cssClass = getPaymentClass(method);
        
        row.innerHTML = `
            <td>${formatDate(expense.date)}</td>
            <td>${expense.description || '-'}</td>
            <td>${expense.category}</td>
            <td><span class="badge-pgto ${cssClass}">${method}</span></td>
            <td style="color: #e74c3c; font-weight: 800; font-size: 1.1em;">${formatCurrency(expense.value)}</td>
            <td>
                <button class="btn-edit" onclick="editExpense('${expense.id}')">✏️</button>
                <button class="btn-delete" onclick="deleteExpense('${expense.id}')">🗑️</button>
            </td>
        `;
    });
}

// --- Ações ---

async function addOrUpdateExpense(event) {
    event.preventDefault();
    const id = expenseIdInput.value;
    const value = parseFloat(expenseValueInput.value);
    const date = expenseDateInput.value;
    const categoryName = expenseCategorySelect.value;
    const paymentMethod = expensePaymentSelect.value;
    const description = expenseDescriptionInput.value.trim();

    if (isNaN(value) || value <= 0) return showFeedback('Valor inválido.', 'error');
    if (!date || !categoryName || !paymentMethod) return showFeedback('Preencha campos.', 'error');

    const expenseData = { value, date, category: categoryName, payment_method: paymentMethod, description };
    const url = id ? `/api/expenses/${id}` : '/api/expenses';
    const method = id ? 'PUT' : 'POST';

    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(expenseData)
        });
        if (response.ok) {
            showFeedback('Salvo!', 'success');
            expenseForm.reset();
            expenseIdInput.value = '';
            saveExpenseBtn.textContent = 'Salvar Gasto';
            expenseDateInput.value = new Date().toISOString().split('T')[0];
            await updateDashboardOnly();
        } else throw new Error();
    } catch (e) { showFeedback('Erro ao salvar.', 'error'); }
}

function editExpense(id) {
    const expense = expenses.find(exp => exp.id === id);
    if (expense) {
        expenseIdInput.value = expense.id;
        expenseValueInput.value = expense.value;
        expenseDateInput.value = expense.date;
        expenseCategorySelect.value = expense.category;
        expensePaymentSelect.value = expense.payment_method || 'Outros';
        expenseDescriptionInput.value = expense.description;
        saveExpenseBtn.textContent = 'Atualizar Gasto';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function deleteExpense(id) {
    showConfirmationModal('Excluir', 'Apagar?', async () => {
        await fetch(`/api/expenses/${id}`, { method: 'DELETE' });
        await updateDashboardOnly();
        hideConfirmationModal();
    });
}

// --- Categorias ---

async function addCategory() {
    const name = newCategoryNameInput.value.trim();
    if (!name) return showFeedback('Nome inválido.', 'error');
    const response = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
    if (response.ok) {
        newCategoryNameInput.value = '';
        await loadAllData();
        showFeedback('Criado!', 'success');
    } else showFeedback('Erro/Existe.', 'info');
}

function renderCategories() {
    categoryListUl.innerHTML = '';
    const saved = expenseCategorySelect.value;
    expenseCategorySelect.innerHTML = '';
    filterCategorySelect.innerHTML = '<option value="">Categoria: Todas</option>';

    categories.forEach(cat => {
        const opt1 = document.createElement('option'); opt1.value = cat.name; opt1.textContent = cat.name;
        expenseCategorySelect.appendChild(opt1);
        
        const opt2 = document.createElement('option'); opt2.value = cat.name; opt2.textContent = cat.name;
        filterCategorySelect.appendChild(opt2);

        const li = document.createElement('li');
        li.innerHTML = `<span>${cat.name}</span>`;
        if (cat.name !== DEFAULT_CATEGORY_NAME) {
            const btn = document.createElement('button');
            btn.className = 'btn-delete';
            btn.textContent = 'Excluir';
            btn.onclick = () => deleteCategory(cat.id, cat.name);
            li.appendChild(btn);
        }
        categoryListUl.appendChild(li);
    });
    if (saved) expenseCategorySelect.value = saved;
}

function deleteCategory(id, name) {
    showConfirmationModal('Excluir', `Apagar "${name}"?`, async () => {
        await fetch(`/api/categories/${id}`, { method: 'DELETE' });
        await loadAllData();
        hideConfirmationModal();
    });
}

// --- Inicialização ---

expenseForm.addEventListener('submit', addOrUpdateExpense);
addCategoryBtn.addEventListener('click', addCategory);

// Listeners dos 3 filtros
filterCategorySelect.addEventListener('change', updateDashboardOnly);
filterPaymentSelect.addEventListener('change', updateDashboardOnly); // NOVO LISTENER
filterDateInput.addEventListener('change', updateDashboardOnly);

clearFiltersBtn.addEventListener('click', async () => {
    filterCategorySelect.value = '';
    filterPaymentSelect.value = '';
    filterDateInput.value = '';
    await updateDashboardOnly();
});

resetDataBtn.addEventListener('click', () => {
    showConfirmationModal('Zerar Tudo', 'Apagar TUDO?', async () => {
        await fetch('/api/reset_data', { method: 'DELETE' });
        await loadAllData();
        hideConfirmationModal();
    });
});
function showConfirmationModal(title, msg, action) {
    modalTitle.textContent = title;
    modalMessage.textContent = msg;
    currentConfirmAction = action;
    confirmationModal.classList.add('show');
}
modalConfirmBtn.addEventListener('click', () => { if (currentConfirmAction) currentConfirmAction(); });
modalCancelBtn.addEventListener('click', () => confirmationModal.classList.remove('show'));

document.addEventListener('DOMContentLoaded', async () => {
    await loadAllData();
    expenseDateInput.value = new Date().toISOString().split('T')[0];
});