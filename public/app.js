const state = {
  token: localStorage.getItem("token") || "",
  actor: null
};

const el = {
  dashboardCard: document.getElementById("dashboardCard"),
  teamCard: document.getElementById("teamCard"),
  productCard: document.getElementById("productCard"),
  transactionCard: document.getElementById("transactionCard"),
  auditCard: document.getElementById("auditCard"),
  registerForm: document.getElementById("registerForm"),
  loginForm: document.getElementById("loginForm"),
  teamForm: document.getElementById("teamForm"),
  productForm: document.getElementById("productForm"),
  transactionForm: document.getElementById("transactionForm"),
  teamBody: document.getElementById("teamBody"),
  productsBody: document.getElementById("productsBody"),
  transactionsBody: document.getElementById("transactionsBody"),
  auditBody: document.getElementById("auditBody"),
  merchantInfo: document.getElementById("merchantInfo"),
  stats: document.getElementById("stats"),
  message: document.getElementById("message"),
  qrisResult: document.getElementById("qrisResult")
};

function setMessage(text, isError = false) {
  el.message.textContent = text;
  el.message.style.color = isError ? "#a21d2f" : "#1d7e42";
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(state.token ? { Authorization: "Bearer " + state.token } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Request gagal");
  }

  if (response.status === 204) return null;
  return response.json();
}

function currency(value) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
}

function isOwner() {
  return state.actor?.role === "owner";
}

function toggleAuth(isLoggedIn) {
  [el.dashboardCard, el.teamCard, el.productCard, el.transactionCard, el.auditCard].forEach((node) =>
    node.classList.toggle("hidden", !isLoggedIn)
  );
}

function applyRoleVisibility() {
  document.querySelectorAll(".owner-only").forEach((node) => {
    node.classList.toggle("hidden", !isOwner());
  });
}

function saveToken(token) {
  state.token = token;
  localStorage.setItem("token", token);
}

async function refreshDashboard() {
  const data = await api("/api/dashboard");
  state.actor = data.actor;
  applyRoleVisibility();

  const summary = data.summary;
  el.merchantInfo.innerHTML = `<b>${data.merchant.businessName}</b> · ${data.merchant.city} · ${data.merchant.category} · <span class="badge">${data.actor.role}</span> ${data.actor.name}`;
  el.stats.innerHTML = [
    ["Total Produk", summary.totalProducts],
    ["Total Transaksi", summary.totalTransactions],
    ["Pending", summary.pendingTransactions],
    ["Tim Aktif", summary.teamMembers],
    ["Omzet", currency(summary.revenue)]
  ]
    .map(([label, value]) => `<div class="stat"><small>${label}</small><div>${value}</div></div>`)
    .join("");
}

async function refreshTeamMembers() {
  if (!isOwner()) {
    el.teamBody.innerHTML = "";
    return;
  }

  const members = await api("/api/team-members");
  el.teamBody.innerHTML = members
    .map(
      (item) => `
      <tr>
        <td>${item.name}</td>
        <td>${item.email}</td>
        <td><span class="badge">${item.role}</span></td>
        <td><button class="delete" data-deactivate-member="${item.id}">Nonaktifkan</button></td>
      </tr>
    `
    )
    .join("");
}

async function refreshProducts() {
  const products = await api("/api/products");
  el.productsBody.innerHTML = products
    .map(
      (item) => `
      <tr>
        <td>${item.name}</td>
        <td>${item.sku}</td>
        <td>${currency(item.price)}</td>
        <td>${isOwner() ? `<button class="delete" data-delete-product="${item.id}">Hapus</button>` : "-"}</td>
      </tr>
    `
    )
    .join("");
}

async function refreshTransactions() {
  const transactions = await api("/api/transactions");
  el.transactionsBody.innerHTML = transactions
    .map(
      (item) => `
      <tr>
        <td>${item.id.slice(0, 8)}</td>
        <td>${currency(item.amount)}</td>
        <td>${item.status}</td>
        <td>${item.customerName}</td>
        <td>${item.status === "pending" && isOwner() ? `<button class="secondary" data-pay-transaction="${item.id}">Set Lunas</button>` : "-"}</td>
      </tr>
    `
    )
    .join("");
}

async function refreshAuditLogs() {
  const logs = await api("/api/audit-logs?limit=30");
  el.auditBody.innerHTML = logs
    .map(
      (item) => `
      <tr>
        <td>${new Date(item.createdAt).toLocaleString("id-ID")}</td>
        <td>${item.actorName} <span class="badge">${item.actorRole}</span></td>
        <td>${item.action}</td>
        <td>${item.targetType}:${item.targetId.slice(0, 8)}</td>
        <td>${item.details}</td>
      </tr>
    `
    )
    .join("");
}

async function bootLoggedInView() {
  toggleAuth(true);
  await refreshDashboard();
  await Promise.all([refreshProducts(), refreshTransactions(), refreshAuditLogs(), refreshTeamMembers()]);
}

el.registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const form = new FormData(el.registerForm);
    const payload = Object.fromEntries(form.entries());
    const result = await api("/api/auth/register", { method: "POST", body: JSON.stringify(payload) });
    saveToken(result.token);
    setMessage("Registrasi owner berhasil");
    await bootLoggedInView();
  } catch (error) {
    setMessage(error.message, true);
  }
});

el.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const form = new FormData(el.loginForm);
    const payload = Object.fromEntries(form.entries());
    const result = await api("/api/auth/login", { method: "POST", body: JSON.stringify(payload) });
    saveToken(result.token);
    setMessage("Login berhasil");
    await bootLoggedInView();
  } catch (error) {
    setMessage(error.message, true);
  }
});

el.teamForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const form = new FormData(el.teamForm);
    const payload = Object.fromEntries(form.entries());
    await api("/api/team-members", { method: "POST", body: JSON.stringify(payload) });
    el.teamForm.reset();
    setMessage("Cashier ditambahkan");
    await Promise.all([refreshDashboard(), refreshTeamMembers(), refreshAuditLogs()]);
  } catch (error) {
    setMessage(error.message, true);
  }
});

el.productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const form = new FormData(el.productForm);
    const payload = Object.fromEntries(form.entries());
    payload.price = Number(payload.price);
    await api("/api/products", { method: "POST", body: JSON.stringify(payload) });
    el.productForm.reset();
    setMessage("Produk ditambahkan");
    await Promise.all([refreshDashboard(), refreshProducts(), refreshAuditLogs()]);
  } catch (error) {
    setMessage(error.message, true);
  }
});

el.transactionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const form = new FormData(el.transactionForm);
    const payload = Object.fromEntries(form.entries());
    payload.amount = Number(payload.amount);
    const transaction = await api("/api/transactions", { method: "POST", body: JSON.stringify(payload) });
    const qris = await api(`/api/transactions/${transaction.id}/qris`);

    el.qrisResult.innerHTML = `<p>Payload: ${qris.payload}</p><img src="${qris.imageUrl}" alt="QRIS" />`;
    el.transactionForm.reset();
    setMessage("Transaksi pending berhasil dibuat");
    await Promise.all([refreshDashboard(), refreshTransactions(), refreshAuditLogs()]);
  } catch (error) {
    setMessage(error.message, true);
  }
});

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;

  const memberId = target.dataset.deactivateMember;
  if (memberId) {
    try {
      await api(`/api/team-members/${memberId}/deactivate`, { method: "POST" });
      setMessage("Member dinonaktifkan");
      await Promise.all([refreshDashboard(), refreshTeamMembers(), refreshAuditLogs()]);
    } catch (error) {
      setMessage(error.message, true);
    }
    return;
  }

  const deleteId = target.dataset.deleteProduct;
  if (deleteId) {
    try {
      await api(`/api/products/${deleteId}`, { method: "DELETE" });
      setMessage("Produk dihapus");
      await Promise.all([refreshDashboard(), refreshProducts(), refreshAuditLogs()]);
    } catch (error) {
      setMessage(error.message, true);
    }
    return;
  }

  const payId = target.dataset.payTransaction;
  if (payId) {
    try {
      await api(`/api/transactions/${payId}/pay`, { method: "POST" });
      setMessage("Transaksi diset lunas");
      await Promise.all([refreshDashboard(), refreshTransactions(), refreshAuditLogs()]);
    } catch (error) {
      setMessage(error.message, true);
    }
  }
});

(async () => {
  if (!state.token) {
    setMessage("Silakan register atau login");
    return;
  }

  try {
    await api("/api/me");
    setMessage("Sesi aktif");
    await bootLoggedInView();
  } catch {
    localStorage.removeItem("token");
    state.token = "";
    state.actor = null;
    setMessage("Sesi berakhir, login ulang", true);
  }
})();
