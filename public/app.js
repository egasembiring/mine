const state = {
  token: localStorage.getItem("token") || ""
};

const el = {
  authCard: document.getElementById("authCard"),
  dashboardCard: document.getElementById("dashboardCard"),
  productCard: document.getElementById("productCard"),
  transactionCard: document.getElementById("transactionCard"),
  registerForm: document.getElementById("registerForm"),
  loginForm: document.getElementById("loginForm"),
  productForm: document.getElementById("productForm"),
  transactionForm: document.getElementById("transactionForm"),
  productsBody: document.getElementById("productsBody"),
  transactionsBody: document.getElementById("transactionsBody"),
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

function toggleAuth(isLoggedIn) {
  [el.dashboardCard, el.productCard, el.transactionCard].forEach((node) => node.classList.toggle("hidden", !isLoggedIn));
}

function saveToken(token) {
  state.token = token;
  localStorage.setItem("token", token);
}

async function refreshDashboard() {
  const data = await api("/api/dashboard");
  const summary = data.summary;

  el.merchantInfo.innerHTML = `<b>${data.merchant.businessName}</b> · ${data.merchant.city} · ${data.merchant.category}`;
  el.stats.innerHTML = [
    ["Total Produk", summary.totalProducts],
    ["Total Transaksi", summary.totalTransactions],
    ["Pending", summary.pendingTransactions],
    ["Omzet", currency(summary.revenue)]
  ]
    .map(([label, value]) => `<div class="stat"><small>${label}</small><div>${value}</div></div>`)
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
        <td><button class="delete" data-delete-product="${item.id}">Hapus</button></td>
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
        <td>
          ${
            item.status === "pending"
              ? `<button class="secondary" data-pay-transaction="${item.id}">Set Lunas</button>`
              : "-"
          }
        </td>
      </tr>
    `
    )
    .join("");
}

async function bootLoggedInView() {
  toggleAuth(true);
  await Promise.all([refreshDashboard(), refreshProducts(), refreshTransactions()]);
}

el.registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const form = new FormData(el.registerForm);
    const payload = Object.fromEntries(form.entries());
    const result = await api("/api/auth/register", { method: "POST", body: JSON.stringify(payload) });
    saveToken(result.token);
    setMessage("Registrasi berhasil");
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

el.productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const form = new FormData(el.productForm);
    const payload = Object.fromEntries(form.entries());
    payload.price = Number(payload.price);
    await api("/api/products", { method: "POST", body: JSON.stringify(payload) });
    el.productForm.reset();
    setMessage("Produk ditambahkan");
    await Promise.all([refreshDashboard(), refreshProducts()]);
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
    await Promise.all([refreshDashboard(), refreshTransactions()]);
  } catch (error) {
    setMessage(error.message, true);
  }
});

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;

  const deleteId = target.dataset.deleteProduct;
  if (deleteId) {
    try {
      await api(`/api/products/${deleteId}`, { method: "DELETE" });
      setMessage("Produk dihapus");
      await Promise.all([refreshDashboard(), refreshProducts()]);
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
      await Promise.all([refreshDashboard(), refreshTransactions()]);
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
    setMessage("Sesi berakhir, login ulang", true);
  }
})();
