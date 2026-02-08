// VARIÁVEIS E DOM
let expenses = [],
  categories = [];
let incomeData = { income_15: 0, income_30: 0 };
const DEFAULT_CATEGORY_NAME = "Outros";
let myChart = null;

// Form
const expenseForm = document.getElementById("expense-form");
const expenseIdInput = document.getElementById("expense-id");
const expenseValueInput = document.getElementById("expense-value");
const expenseDateInput = document.getElementById("expense-date");
const expenseCategorySelect = document.getElementById("expense-category");
const expensePaymentSelect = document.getElementById("expense-payment");
const expenseDescriptionInput = document.getElementById("expense-description");
const saveExpenseBtn = document.getElementById("save-expense-btn");

const installmentsGroup = document.getElementById("installments-group");
const expenseInstallmentsSelect = document.getElementById(
  "expense-installments",
);
const cycleHint = document.getElementById("cycle-hint");

const income15Input = document.getElementById("income-15");
const income30Input = document.getElementById("income-30");

const expenseTableBody = document.getElementById("expense-table-body");
const exportBtn = document.getElementById("export-btn");
const feedbackMessage = document.getElementById("feedback-message");
const ctx = document.getElementById("expensesChart").getContext("2d");

const newCategoryNameInput = document.getElementById("new-category-name");
const addCategoryBtn = document.getElementById("add-category-btn");
const categoryListUl = document.getElementById("category-list");
const filterCategorySelect = document.getElementById("filter-category");
const filterPaymentSelect = document.getElementById("filter-payment");
const filterDateInput = document.getElementById("filter-date");
const clearFiltersBtn = document.getElementById("clear-filters-btn");

// BOTAO NOVO
const manageCyclesBtn = document.getElementById("manage-cycles-btn");
const cyclesModal = document.getElementById("cycles-modal");

// MODAL CONFIRMACAO
const confirmationModal = document.getElementById("confirmation-modal");
const modalTitle = document.getElementById("modal-title");
const modalMessage = document.getElementById("modal-message");
const modalConfirmBtn = document.getElementById("modal-confirm-btn");
const modalCancelBtn = document.getElementById("modal-cancel-btn");
let currentConfirmAction = null;

// UTILITÁRIOS
function formatCurrency(v) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(v);
}
function formatDate(d) {
  if (!d) return "-";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}
function showFeedback(msg, type = "info") {
  feedbackMessage.textContent = msg;
  feedbackMessage.className = `show ${type}`;
  feedbackMessage.style.backgroundColor =
    type === "success" ? "#28a745" : type === "error" ? "#dc3545" : "#17a2b8";
  setTimeout(() => (feedbackMessage.className = ""), 3000);
}
function generateDistinctColor(existing) {
  const letters = "0123456789ABCDEF";
  let c;
  let i = 0;
  do {
    c = "#";
    for (let k = 0; k < 6; k++) c += letters[Math.floor(Math.random() * 16)];
    i++;
  } while (existing.includes(c) && i < 100);
  return c;
}
function maskCurrency(input) {
  let value = input.value.replace(/\D/g, "");
  value = (value / 100).toFixed(2) + "";
  value = value.replace(".", ",");
  value = value.replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1.");
  input.value = value;
}
function parseMoney(str) {
  if (!str) return 0;
  return parseFloat(str.toString().replace(/\./g, "").replace(",", ".")) || 0;
}

// API
async function fetchCategories() {
  try {
    return await (await fetch("/api/categories")).json();
  } catch (e) {
    return [];
  }
}
async function fetchExpenses(c = "", d = "") {
  try {
    const p = new URLSearchParams();
    if (c) p.append("category", c);
    if (d) p.append("date", d);
    return await (await fetch(`/api/expenses?${p}`)).json();
  } catch (e) {
    return [];
  }
}
async function fetchIncome() {
  try {
    return await (await fetch("/api/income")).json();
  } catch (e) {
    return { income_15: 0, income_30: 0 };
  }
}

// LÓGICA PRINCIPAL
async function loadAllData() {
  const cCat = filterCategorySelect.value,
    cPay = filterPaymentSelect.value;
  categories = await fetchCategories();
  renderCategories();
  incomeData = await fetchIncome();
  income15Input.value = (incomeData.income_15 || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
  });
  income30Input.value = (incomeData.income_30 || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
  });
  filterCategorySelect.value = cCat;
  filterPaymentSelect.value = cPay;
  await updateDashboardOnly();
}

async function updateDashboardOnly() {
  const catF = filterCategorySelect.value,
    dateF = filterDateInput.value,
    payF = filterPaymentSelect.value;
  let data = await fetchExpenses(catF, dateF);
  if (payF === "Crédito")
    data = data.filter((e) => e.payment_method.includes("Crédito"));
  else if (payF === "Pix")
    data = data.filter((e) => !e.payment_method.includes("Crédito"));
  expenses = data;
  calculateCycles();
  renderChart();
  renderExpensesTable();
}

function calculateCycles() {
  let card15 = 0,
    other15 = 0;
  let card30 = 0,
    other30 = 0;
  expenses.forEach((e) => {
    let cycle = e.cycle;
    if (!e.payment_method.includes("Crédito")) {
      const day = parseInt(e.date.split("-")[2]);
      cycle = day <= 15 ? 15 : 30;
    }
    if (cycle === 15) {
      if (e.payment_method.includes("Crédito")) card15 += e.value;
      else other15 += e.value;
    } else {
      if (e.payment_method.includes("Crédito")) card30 += e.value;
      else other30 += e.value;
    }
  });
  document.getElementById("card-total-15").textContent = formatCurrency(card15);
  document.getElementById("other-total-15").textContent =
    formatCurrency(other15);
  const total15 = card15 + other15;
  document.getElementById("total-cycle-15").textContent =
    formatCurrency(total15);
  const balance15 = incomeData.income_15 - total15;
  const elBal15 = document.getElementById("balance-15");
  elBal15.textContent = formatCurrency(balance15);
  elBal15.className = `balance-final ${balance15 >= 0 ? "positive" : "negative"}`;

  document.getElementById("card-total-30").textContent = formatCurrency(card30);
  document.getElementById("other-total-30").textContent =
    formatCurrency(other30);
  const total30 = card30 + other30;
  document.getElementById("total-cycle-30").textContent =
    formatCurrency(total30);
  const balance30 = incomeData.income_30 - total30;
  const elBal30 = document.getElementById("balance-30");
  elBal30.textContent = formatCurrency(balance30);
  elBal30.className = `balance-final ${balance30 >= 0 ? "positive" : "negative"}`;
}

async function updateIncome() {
  const inc15 = parseMoney(income15Input.value);
  const inc30 = parseMoney(income30Input.value);
  await fetch("/api/income", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ income_15: inc15, income_30: inc30 }),
  });
  incomeData.income_15 = inc15;
  incomeData.income_30 = inc30;
  calculateCycles();
}

function renderChart() {
  let totals = {};
  expenses.forEach((e) => {
    if (!totals[e.category]) totals[e.category] = 0;
    totals[e.category] += e.value;
  });
  const labels = Object.keys(totals),
    data = Object.values(totals),
    bg = [];
  labels.forEach(() => bg.push(generateDistinctColor(bg)));
  if (myChart) myChart.destroy();
  if (labels.length > 0) {
    myChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Gasto",
            data,
            backgroundColor: bg,
            borderWidth: 1,
            borderRadius: 4,
            barPercentage: 0.6,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => formatCurrency(c.raw) } },
        },
        scales: {
          x: {
            ticks: { callback: (v) => "R$ " + v, color: "#141414" },
            grid: { color: "#333" },
          },
          y: {
            ticks: { color: "#1b1b1b", font: { size: 14 } },
            grid: { color: "#525252d7" },
          },
        },
      },
    });
  }
}

function renderExpensesTable() {
  expenseTableBody.innerHTML = "";
  if (expenses.length === 0) {
    expenseTableBody.innerHTML =
      '<tr><td colspan="6" style="text-align:center; padding:20px; color: #888;">Nenhum gasto encontrado.</td></tr>';
    return;
  }
  expenses.forEach((e) => {
    const row = expenseTableBody.insertRow();
    let statusHtml = "";
    if (e.paid) statusHtml = '<span class="status-paid-badge">✔ Pago</span>';
    else
      statusHtml = `<button class="status-btn btn-pay-now" onclick="togglePaid('${e.id}')">Pagar</button>`;
    let displayCycle = e.cycle === 15 ? "Dia 15" : "Dia 30";
    if (!e.payment_method.includes("Crédito")) {
      const day = parseInt(e.date.split("-")[2]);
      displayCycle = day <= 15 ? "Dia 15" : "Dia 30";
    }
    row.innerHTML = `<td>${formatDate(e.date)}</td><td>${e.description}</td><td><span style="background:#e0e0e0; color:#000; font-weight:bold; padding:2px 8px; border-radius:4px; font-size:0.8em;">${displayCycle}</span></td><td style="color:#ff5252; font-weight:800;">${formatCurrency(e.value)}</td><td>${statusHtml}</td><td><button class="btn-edit" onclick="editExpense('${e.id}')">✏️</button><button class="btn-delete" onclick="deleteExpense('${e.id}')">🗑️</button></td>`;
  });
}

expensePaymentSelect.addEventListener("change", () => {
  const val = expensePaymentSelect.value;
  if (val.includes("Crédito")) {
    installmentsGroup.style.display = "block";
  } else {
    installmentsGroup.style.display = "none";
    expenseInstallmentsSelect.value = "1";
  }
  if (val === "Crédito15")
    cycleHint.textContent = "Será descontado do Saldo do dia 15.";
  else if (val === "Crédito30")
    cycleHint.textContent = "Será descontado do Saldo do dia 30.";
  else if (val === "Pix" || val === "Débito")
    cycleHint.textContent = "Descontado do ciclo conforme a data escolhida.";
  else cycleHint.textContent = "";
});

async function togglePaid(id) {
  if (
    (await fetch(`/api/expenses/${id}/toggle_paid`, { method: "PATCH" })).ok
  ) {
    showFeedback("Atualizado!", "success");
    await updateDashboardOnly();
  }
}

async function addOrUpdateExpense(ev) {
  ev.preventDefault();
  const id = expenseIdInput.value,
    val = parseFloat(expenseValueInput.value),
    dt = expenseDateInput.value,
    cat = expenseCategorySelect.value,
    payRaw = expensePaymentSelect.value,
    desc = expenseDescriptionInput.value.trim();
  const installments = parseInt(expenseInstallmentsSelect.value);
  let finalPayMethod = payRaw;
  let cycle = 15;
  if (payRaw === "Crédito15") {
    finalPayMethod = "Crédito";
    cycle = 15;
  } else if (payRaw === "Crédito30") {
    finalPayMethod = "Crédito";
    cycle = 30;
  } else {
    const day = parseInt(dt.split("-")[2]);
    cycle = day <= 15 ? 15 : 30;
  }
  const data = {
    value: val,
    date: dt,
    category: cat,
    payment_method: finalPayMethod,
    description: desc,
    installments: installments,
    cycle: cycle,
  };
  const url = id ? `/api/expenses/${id}` : "/api/expenses",
    method = id ? "PUT" : "POST";
  if (
    (
      await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
    ).ok
  ) {
    showFeedback("Salvo!", "success");
    expenseForm.reset();
    expenseIdInput.value = "";
    saveExpenseBtn.textContent = "Salvar Gasto";
    expenseDateInput.value = new Date().toISOString().split("T")[0];
    installmentsGroup.style.display = "none";
    expenseInstallmentsSelect.value = "1";
    await updateDashboardOnly();
  }
}

function editExpense(id) {
  const e = expenses.find((x) => x.id === id);
  if (e) {
    expenseIdInput.value = e.id;
    expenseValueInput.value = e.value;
    expenseDateInput.value = e.date;
    expenseCategorySelect.value = e.category;
    expenseDescriptionInput.value = e.description;
    if (e.payment_method === "Crédito") {
      expensePaymentSelect.value = e.cycle === 15 ? "Crédito15" : "Crédito30";
      installmentsGroup.style.display = "none";
    } else {
      expensePaymentSelect.value = e.payment_method;
      installmentsGroup.style.display = "none";
    }
    saveExpenseBtn.textContent = "Atualizar";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}
function deleteExpense(id) {
  showConfirmationModal("Excluir", "Apagar?", async () => {
    await fetch(`/api/expenses/${id}`, { method: "DELETE" });
    await updateDashboardOnly();
    hideConfirmationModal();
  });
}
async function addCategory() {
  const n = newCategoryNameInput.value.trim();
  if (
    (
      await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n }),
      })
    ).ok
  ) {
    newCategoryNameInput.value = "";
    await loadAllData();
  }
}
function deleteCategory(id, n) {
  showConfirmationModal("Excluir", `Apagar "${n}"?`, async () => {
    await fetch(`/api/categories/${id}`, { method: "DELETE" });
    await loadAllData();
    hideConfirmationModal();
  });
}

// --- GERENCIAMENTO DE CICLOS ---
manageCyclesBtn.addEventListener("click", () => {
  cyclesModal.classList.add("show");
});

async function closeCycle(cycleId) {
  showConfirmationModal(
    `Encerrar Ciclo ${cycleId}`,
    "Apagar gastos antigos?",
    async () => {
      const response = await fetch(`/api/cycles/close/${cycleId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        showFeedback(`Ciclo ${cycleId} encerrado com sucesso!`, "success");
        await loadAllData();
        cyclesModal.classList.remove("show");
      } else {
        showFeedback("Erro ao encerrar ciclo.", "error");
      }
      hideConfirmationModal();
    },
  );
}

async function resetAllData() {
  showConfirmationModal("⚠️ APAGAR TUDO?", "Isso é irreversível.", async () => {
    await fetch("/api/reset_data", { method: "DELETE" });
    await fetchIncome();
    income15Input.value = "0,00";
    income30Input.value = "0,00";
    await loadAllData();
    cyclesModal.classList.remove("show");
    hideConfirmationModal();
  });
}

function renderCategories() {
  categoryListUl.innerHTML = "";
  expenseCategorySelect.innerHTML = "";
  filterCategorySelect.innerHTML = '<option value="">Categoria: Todas</option>';
  categories.forEach((c) => {
    const o = document.createElement("option");
    o.value = c.name;
    o.textContent = c.name;
    expenseCategorySelect.appendChild(o);
    const o2 = document.createElement("option");
    o2.value = c.name;
    o2.textContent = c.name;
    filterCategorySelect.appendChild(o2);
    const li = document.createElement("li");
    li.innerHTML = `<span>${c.name}</span>`;
    if (c.name !== DEFAULT_CATEGORY_NAME) {
      const b = document.createElement("button");
      b.className = "btn-delete";
      b.textContent = "Excluir";
      b.onclick = () => deleteCategory(c.id, c.name);
      li.appendChild(b);
    }
    categoryListUl.appendChild(li);
  });
}
function showConfirmationModal(t, m, a) {
  modalTitle.textContent = t;
  modalMessage.textContent = m;
  currentConfirmAction = a;
  confirmationModal.classList.add("show");
}
function hideConfirmationModal() {
  confirmationModal.classList.remove("show");
}
expenseForm.addEventListener("submit", addOrUpdateExpense);
addCategoryBtn.addEventListener("click", addCategory);
filterCategorySelect.addEventListener("change", updateDashboardOnly);
filterPaymentSelect.addEventListener("change", updateDashboardOnly);
filterDateInput.addEventListener("change", updateDashboardOnly);
clearFiltersBtn.addEventListener("click", async () => {
  filterCategorySelect.value = "";
  filterPaymentSelect.value = "";
  filterDateInput.value = "";
  await updateDashboardOnly();
});
exportBtn.addEventListener("click", () => {
  window.location.href = "/api/export_csv";
});
modalConfirmBtn.addEventListener("click", () => {
  if (currentConfirmAction) currentConfirmAction();
});
modalCancelBtn.addEventListener("click", hideConfirmationModal);
document.addEventListener("DOMContentLoaded", async () => {
  await loadAllData();
  expenseDateInput.value = new Date().toISOString().split("T")[0];
});
