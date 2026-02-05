// --- VARIÁVEIS E DOM ---
let expenses = [], categories = []; 
const DEFAULT_CATEGORY_NAME = 'Outros';
let myChart = null; 

// Formulário
const expenseForm = document.getElementById('expense-form');
const expenseIdInput = document.getElementById('expense-id');
const expenseValueInput = document.getElementById('expense-value');
const expenseDateInput = document.getElementById('expense-date');
const expenseCategorySelect = document.getElementById('expense-category');
const expensePaymentSelect = document.getElementById('expense-payment');
const expenseDescriptionInput = document.getElementById('expense-description');
const saveExpenseBtn = document.getElementById('save-expense-btn');

// Campo de Parcelas (Novo)
const installmentsGroup = document.getElementById('installments-group');
const expenseInstallmentsSelect = document.getElementById('expense-installments');

// Tabela e Feedback
const expenseTableBody = document.getElementById('expense-table-body');
const feedbackMessage = document.getElementById('feedback-message');

// Displays de Totais
const displayTotalGeneral = document.getElementById('total-general');
const displayTotalPaid = document.getElementById('total-paid');
const displayTotalCredit = document.getElementById('total-credit');
const ctx = document.getElementById('expensesChart').getContext('2d');

// Gerenciamento e Filtros
const newCategoryNameInput = document.getElementById('new-category-name');
const addCategoryBtn = document.getElementById('add-category-btn');
const categoryListUl = document.getElementById('category-list');
const filterCategorySelect = document.getElementById('filter-category');
const filterPaymentSelect = document.getElementById('filter-payment');
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

// --- UTILITÁRIOS ---
function formatCurrency(v) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v); }
function formatDate(d) { if(!d) return '-'; const [y,m,day] = d.split('-'); return `${day}/${m}/${y}`; }
function showFeedback(msg, type='info') {
    feedbackMessage.textContent = msg; feedbackMessage.className = `show ${type}`;
    feedbackMessage.style.backgroundColor = type==='success'?'#28a745':(type==='error'?'#dc3545':'#17a2b8');
    setTimeout(()=>feedbackMessage.className='', 3000);
}
function generateDistinctColor(existing) {
    const letters='0123456789ABCDEF'; let c; let i=0;
    do { c='#'; for(let k=0;k<6;k++) c+=letters[Math.floor(Math.random()*16)]; i++; } while(existing.includes(c)&&i<100);
    return c;
}
function getPaymentClass(m) {
    const v=(m||'').toLowerCase(); 
    if(v==='crédito') return 'pgto-credito'; if(v==='débito') return 'pgto-debito';
    if(v==='pix') return 'pgto-pix'; if(v==='dinheiro') return 'pgto-dinheiro'; return 'pgto-outros';
}

// --- API ---
async function fetchCategories() { try{ return await(await fetch('/api/categories')).json(); }catch(e){return[];} }
async function fetchExpenses(c='', d='') { try{ const p=new URLSearchParams(); if(c)p.append('category',c); if(d)p.append('date',d); return await(await fetch(`/api/expenses?${p}`)).json(); }catch(e){return[];} }

// --- LÓGICA PRINCIPAL ---
async function loadAllData() {
    const cCat = filterCategorySelect.value, cPay = filterPaymentSelect.value;
    categories = await fetchCategories(); renderCategories();
    filterCategorySelect.value=cCat; filterPaymentSelect.value=cPay;
    await updateDashboardOnly();
}

async function updateDashboardOnly() {
    const catF=filterCategorySelect.value, dateF=filterDateInput.value, payF=filterPaymentSelect.value;
    let data = await fetchExpenses(catF, dateF);
    if(payF) data = data.filter(e => e.payment_method === payF);
    expenses = data;
    updateTotalsAndChart(); renderExpensesTable();
}

// --- CÁLCULOS E GRÁFICOS ---
function updateTotalsAndChart() {
    let tGen=0, tPaid=0, tPendingCredit=0;
    const catTotals = {};

    expenses.forEach(e => {
        const val = e.value;
        tGen += val;
        if (e.paid) tPaid += val; else tPendingCredit += val;
        if(!catTotals[e.category]) catTotals[e.category]=0; catTotals[e.category]+=val;
    });

    displayTotalGeneral.textContent = formatCurrency(tGen);
    displayTotalPaid.textContent = formatCurrency(tPaid);
    displayTotalCredit.textContent = formatCurrency(tPendingCredit);

    const labels = Object.keys(catTotals), data = Object.values(catTotals), bg = [];
    labels.forEach(() => bg.push(generateDistinctColor(bg)));
    if(myChart) myChart.destroy();
    if(tGen>0 || labels.length>0) {
        myChart = new Chart(ctx, {
            type: 'bar', data: { labels, datasets: [{ label:'Gasto', data, backgroundColor:bg, borderWidth:1, borderRadius:4, barPercentage:0.6 }] },
            options: { indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>formatCurrency(c.raw)}} }, scales:{x:{ticks:{callback:v=>'R$ '+v}}} }
        });
    }
}

// --- TABELA ---
function renderExpensesTable() {
    expenseTableBody.innerHTML = '';
    if(expenses.length===0) { expenseTableBody.innerHTML='<tr><td colspan="7" style="text-align:center; padding:20px;">Nada aqui.</td></tr>'; return; }

    expenses.forEach(e => {
        const row = expenseTableBody.insertRow();
        const method = e.payment_method || 'Outros';
        const cssClass = getPaymentClass(method);
        
        let statusHtml = '';
        if (e.paid) {
            statusHtml = '<span class="status-paid-badge">✔ Pago</span>';
        } else {
            statusHtml = `<button class="status-btn btn-pay-now" onclick="togglePaid('${e.id}')">Pagar Fatura</button>`;
        }

        row.innerHTML = `
            <td>${formatDate(e.date)}</td>
            <td>${e.description || '-'}</td>
            <td>${e.category}</td>
            <td><span class="badge-pgto ${cssClass}">${method}</span></td>
            <td style="color: #e74c3c; font-weight: 800; font-size: 1.1em;">${formatCurrency(e.value)}</td>
            <td>${statusHtml}</td>
            <td>
                <button class="btn-edit" onclick="editExpense('${e.id}')">✏️</button>
                <button class="btn-delete" onclick="deleteExpense('${e.id}')">🗑️</button>
            </td>
        `;
    });
}

// --- EVENTO DO SELETOR DE PAGAMENTO (MOSTRAR PARCELAS) ---
expensePaymentSelect.addEventListener('change', () => {
    if (expensePaymentSelect.value === 'Crédito') {
        installmentsGroup.style.display = 'block';
    } else {
        installmentsGroup.style.display = 'none';
        expenseInstallmentsSelect.value = '1';
    }
});

// --- AÇÕES CRUD ---
async function togglePaid(id) {
    try {
        const res = await fetch(`/api/expenses/${id}/toggle_paid`, { method: 'PATCH' });
        if(res.ok) { showFeedback('Status atualizado!', 'success'); await updateDashboardOnly(); } 
        else showFeedback('Erro ao atualizar.', 'error');
    } catch(e) { showFeedback('Erro de conexão.', 'error'); }
}

async function addOrUpdateExpense(ev) {
    ev.preventDefault();
    const id=expenseIdInput.value, val=parseFloat(expenseValueInput.value), dt=expenseDateInput.value, cat=expenseCategorySelect.value, pay=expensePaymentSelect.value, desc=expenseDescriptionInput.value.trim();
    // Captura Parcelas
    const installments = parseInt(expenseInstallmentsSelect.value);

    if(isNaN(val)||val<=0) return showFeedback('Valor inválido','error');
    if(!dt||!cat||!pay) return showFeedback('Preencha tudo','error');

    const data={
        value:val, date:dt, category:cat, payment_method:pay, description:desc,
        installments: installments // Envia parcelas
    };
    
    const url=id?`/api/expenses/${id}`:'/api/expenses', method=id?'PUT':'POST';
    
    try{
        if((await fetch(url,{method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)})).ok) {
            showFeedback('Salvo!','success'); 
            expenseForm.reset(); 
            expenseIdInput.value=''; 
            saveExpenseBtn.textContent='Salvar Gasto'; 
            expenseDateInput.value=new Date().toISOString().split('T')[0];
            // Reseta visual das parcelas
            installmentsGroup.style.display = 'none';
            expenseInstallmentsSelect.value = '1';

            await updateDashboardOnly();
        } else throw new Error();
    }catch(e){showFeedback('Erro','error');}
}

function editExpense(id) {
    const e=expenses.find(x=>x.id===id);
    if(e){ 
        expenseIdInput.value=e.id; 
        expenseValueInput.value=e.value; 
        expenseDateInput.value=e.date; 
        expenseCategorySelect.value=e.category; 
        expensePaymentSelect.value=e.payment_method||'Outros'; 
        expenseDescriptionInput.value=e.description;
        
        // Ao editar, esconde parcelamento para não "re-explodir" o gasto
        installmentsGroup.style.display = 'none';
        expenseInstallmentsSelect.value = '1';
        
        saveExpenseBtn.textContent='Atualizar Gasto'; 
        window.scrollTo({top:0, behavior:'smooth'}); 
    }
}

function deleteExpense(id) { showConfirmationModal('Excluir', 'Apagar?', async()=>{ await fetch(`/api/expenses/${id}`,{method:'DELETE'}); await updateDashboardOnly(); hideConfirmationModal(); }); }
async function addCategory(){ const n=newCategoryNameInput.value.trim(); if(!n)return showFeedback('Nome inválido','error'); if((await fetch('/api/categories',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n})})).ok){ newCategoryNameInput.value=''; await loadAllData(); showFeedback('Criado!','success'); }else showFeedback('Erro','info'); }
function deleteCategory(id,n){ showConfirmationModal('Excluir',`Apagar "${n}"?`,async()=>{await fetch(`/api/categories/${id}`,{method:'DELETE'}); await loadAllData(); hideConfirmationModal();}); }

// --- CONFIG INICIAL ---
function renderCategories(){
    categoryListUl.innerHTML=''; const saved=expenseCategorySelect.value; expenseCategorySelect.innerHTML=''; filterCategorySelect.innerHTML='<option value="">Categoria: Todas</option>';
    categories.forEach(c=>{
        const o1=document.createElement('option'); o1.value=c.name; o1.textContent=c.name; expenseCategorySelect.appendChild(o1);
        const o2=document.createElement('option'); o2.value=c.name; o2.textContent=c.name; filterCategorySelect.appendChild(o2);
        const li=document.createElement('li'); li.innerHTML=`<span>${c.name}</span>`;
        if(c.name!==DEFAULT_CATEGORY_NAME){ const b=document.createElement('button'); b.className='btn-delete'; b.textContent='Excluir'; b.onclick=()=>deleteCategory(c.id,c.name); li.appendChild(b); }
        categoryListUl.appendChild(li);
    });
    if(saved)expenseCategorySelect.value=saved;
}
function showConfirmationModal(t,m,a){ modalTitle.textContent=t; modalMessage.textContent=m; currentConfirmAction=a; confirmationModal.classList.add('show'); }
expenseForm.addEventListener('submit',addOrUpdateExpense); addCategoryBtn.addEventListener('click',addCategory);
filterCategorySelect.addEventListener('change',updateDashboardOnly); filterPaymentSelect.addEventListener('change',updateDashboardOnly); filterDateInput.addEventListener('change',updateDashboardOnly);
clearFiltersBtn.addEventListener('click',async()=>{filterCategorySelect.value='';filterPaymentSelect.value='';filterDateInput.value='';await updateDashboardOnly();});
resetDataBtn.addEventListener('click',()=>{showConfirmationModal('Zerar','Tudo?',async()=>{await fetch('/api/reset_data',{method:'DELETE'});await loadAllData();hideConfirmationModal();});});
modalConfirmBtn.addEventListener('click',()=>{if(currentConfirmAction)currentConfirmAction();}); modalCancelBtn.addEventListener('click',()=>confirmationModal.classList.remove('show'));
document.addEventListener('DOMContentLoaded',async()=>{await loadAllData();expenseDateInput.value=new Date().toISOString().split('T')[0];});