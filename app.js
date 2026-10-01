const moneyFormatter = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" });
const supabaseUrl = "https://sdqxtrwqjbjgsgcfgzve.supabase.co";
const supabasePublishableKey = "sb_publishable_jVxd9Oin5c0GzqAI03R2cA_g--JqI7i";
const state = { costumes: [], renters: [], rentals: [], page: 1, pageSize: 8, rentalStep: 1 };
const byId = (id) => document.getElementById(id);
const today = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function formatMoney(value) {
  return `Rp${moneyFormatter.format(Number(value) || 0)}`;
}

function formatDate(value) {
  if (!value) return "-";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : dateFormatter.format(date);
}

async function api(path, options = {}) {
  if (location.hostname.endsWith("github.io")) return githubPagesApi(path, options);
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Permintaan belum berhasil. Coba lagi.");
  return result;
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: supabasePublishableKey,
      Authorization: `Bearer ${supabasePublishableKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const result = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(result?.message || result?.hint || "Permintaan ke Supabase belum berhasil.");
  return result;
}

async function githubPagesApi(path, options = {}) {
  const body = options.body ? JSON.parse(options.body) : {};
  if (path === "/dashboard") {
    const [costumes, renters, rentals] = await Promise.all([
      supabaseRequest("costumes?select=*&order=created_at.desc"),
      supabaseRequest("renters?select=id,full_name,phone&order=created_at.desc"),
      supabaseRequest("rentals?select=id,renter_id,start_date,due_date,status,created_at,returned_at,renter:renters(full_name,phone),items:rental_items(id,costume_id,quantity,daily_rate,costume:costumes(name))&order=created_at.desc"),
    ]);
    return { costumes, renters, rentals };
  }

  if (path === "/costumes" && options.method === "POST") {
    return supabaseRequest("costumes", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body),
    });
  }

  const costumeMatch = path.match(/^\/costumes\/([0-9a-f-]+)$/i);
  if (costumeMatch && options.method === "PUT") {
    return supabaseRequest(`costumes?id=eq.${encodeURIComponent(costumeMatch[1])}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body),
    });
  }
  if (costumeMatch && options.method === "DELETE") {
    return supabaseRequest(`costumes?id=eq.${encodeURIComponent(costumeMatch[1])}`, { method: "DELETE" });
  }

  if (path === "/rentals" && options.method === "POST") {
    return supabaseRequest("rpc/create_rental", {
      method: "POST",
      body: JSON.stringify({
        p_full_name: body.full_name,
        p_phone: body.phone,
        p_start_date: body.start_date || today(),
        p_due_date: body.due_date,
        p_items: body.items,
      }),
    });
  }

  const rentalMatch = path.match(/^\/rentals\/([0-9a-f-]+)$/i);
  if (rentalMatch && options.method === "PATCH" && body.status === "returned") {
    return supabaseRequest(`rentals?id=eq.${encodeURIComponent(rentalMatch[1])}&status=eq.active`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: "returned", returned_at: new Date().toISOString() }),
    });
  }

  throw new Error("Endpoint tidak ditemukan.");
}

function rentedStock(costume) {
  return state.rentals
    .filter((rental) => rental.status === "active")
    .flatMap((rental) => rental.items || [])
    .filter((item) => item.costume_id === costume.id)
    .reduce((total, item) => total + Number(item.quantity || 0), 0);
}

function availableStock(costume) {
  if (costume.condition === "Dalam perbaikan") return 0;
  return Math.max(0, Number(costume.stock_total) - rentedStock(costume));
}

function conditionClass(condition) {
  if (condition === "Dalam perbaikan") return "repair";
  if (condition === "Perlu perawatan") return "needs-care";
  return "good";
}

function stockStatus(costume) {
  if (costume.condition !== "Baik") return { label: "Perawatan", className: "maintenance" };
  if (rentedStock(costume) > 0) return { label: "Disewa", className: "rented" };
  return { label: "Tersedia", className: "available" };
}

function renderFilterOptions() {
  const filters = [
    ["category-filter", [...new Set(state.costumes.map((item) => item.category).filter(Boolean))], "Kategori"],
    ["size-filter", [...new Set(state.costumes.map((item) => item.size).filter(Boolean))], "Ukuran"],
    ["condition-filter", [...new Set(state.costumes.map((item) => item.condition).filter(Boolean))], "Kondisi"],
  ];
  for (const [id, options, label] of filters) {
    const select = byId(id);
    const selected = select.value;
    select.innerHTML = `<option value="">${label}</option>` + options.sort((a, b) => a.localeCompare(b, "id")).map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
    if (options.includes(selected)) select.value = selected;
  }
}

function costumeRow(costume) {
  const available = availableStock(costume);
  const status = stockStatus(costume);
  return `<tr>
    <td><button class="costume-name-button" type="button" data-detail="${escapeHtml(costume.id)}">${escapeHtml(costume.name)}</button><span class="costume-sub">ID ${escapeHtml(costume.id.slice(0, 8).toUpperCase())}</span></td>
    <td>${escapeHtml(costume.category)}</td>
    <td>${escapeHtml(costume.size || "Belum dicatat")}</td>
    <td><span class="condition-badge ${conditionClass(costume.condition)}">${escapeHtml(costume.condition || "Baik")}</span><span class="inventory-status ${status.className}">${status.label}</span></td>
    <td class="stock-cell">${available}<small> / ${Number(costume.stock_total)}</small></td>
    <td>${formatMoney(costume.daily_rate)}</td>
    <td><div class="row-actions"><button type="button" data-detail="${escapeHtml(costume.id)}">Detail</button><button type="button" data-edit="${escapeHtml(costume.id)}">Edit</button><button type="button" class="danger-action" data-delete="${escapeHtml(costume.id)}" aria-label="Hapus ${escapeHtml(costume.name)}">Hapus</button></div></td>
  </tr>`;
}

function getFilteredCostumes() {
  const search = byId("costume-search").value.trim().toLowerCase();
  const category = byId("category-filter").value;
  const size = byId("size-filter").value;
  const condition = byId("condition-filter").value;
  const filtered = state.costumes.filter((costume) => {
    const matchesSearch = `${costume.name} ${costume.category} ${costume.size} ${costume.condition}`.toLowerCase().includes(search);
    return matchesSearch && (!category || costume.category === category) && (!size || costume.size === size) && (!condition || costume.condition === condition);
  });
  const sort = byId("sort-filter").value;
  filtered.sort((first, second) => sort === "stock" ? availableStock(second) - availableStock(first) : sort === "rate" ? Number(second.daily_rate) - Number(first.daily_rate) : first.name.localeCompare(second.name, "id"));
  return filtered;
}

function renderCostumes() {
  renderFilterOptions();
  const filtered = getFilteredCostumes();
  const pages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
  state.page = Math.min(state.page, pages);
  const paged = filtered.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
  const message = state.costumes.length ? "Tidak ada kostum yang cocok dengan filter." : "Belum ada kostum dalam koleksi.";
  byId("inventory-count").textContent = `${filtered.length} kostum`;
  byId("page-label").textContent = `${state.page} / ${pages}`;
  byId("page-prev").disabled = state.page <= 1;
  byId("page-next").disabled = state.page >= pages;
  byId("costume-rows").innerHTML = paged.length ? paged.slice(0, 5).map(costumeRow).join("") : `<tr><td colspan="6" class="table-message">${message}</td></tr>`;
  byId("inventory-all-rows").innerHTML = paged.length ? paged.map(costumeRow).join("") : `<tr><td colspan="7" class="empty-cell"><div class="empty-state"><img class="empty-illustration" src="./assets/illustrations/costume.svg" alt="Penari Jawa berdiri di samping koleksi kostum"><strong>${state.costumes.length ? "Kostum tidak ditemukan" : "Belum ada kostum"}</strong><span>${state.costumes.length ? "Coba ubah kata kunci atau filter." : "Belum ada koleksi kostum yang terdaftar."}</span>${state.costumes.length ? "" : '<button class="button button-dark button-small" type="button" data-open-costume><span class="plus-mark" aria-hidden="true">+</span> Tambah Kostum</button>'}</div></td></tr>`;
}

function unitsIn(rental) {
  return (rental.items || []).reduce((total, item) => total + Number(item.quantity || 0), 0);
}

function rentalItemsLabel(rental) {
  return (rental.items || []).map((item) => `${item.costume?.name || "Kostum"} ×${item.quantity}`).join(", ") || "Rincian kostum tidak tersedia";
}

function rentalStage(rental) {
  if (rental.status === "returned") return "returned";
  if (rental.start_date > today()) return "upcoming";
  if (rental.due_date < today()) return "overdue";
  if (rental.due_date === today()) return "due";
  return "active";
}

function stageLabel(stage) {
  return ({ upcoming: "Akan keluar", active: "Dipinjam", due: "Jatuh tempo", overdue: "Terlambat", returned: "Selesai" })[stage] || stage;
}

function renderRentals() {
  const active = state.rentals.filter((rental) => rental.status === "active");
  byId("rental-count-pill").textContent = `${active.length} aktif`;
  byId("nav-active-count").textContent = active.length;
  byId("rental-list").innerHTML = state.rentals.length ? state.rentals.slice(0, 6).map((rental) => {
    const renter = rental.renter?.full_name || "Penyewa";
    const stage = rentalStage(rental);
    return `<div class="rental-item">
      <span class="rental-avatar">${escapeHtml(renter.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase())}</span>
      <div class="rental-detail"><strong>${escapeHtml(renter)}</strong><small>${escapeHtml(rentalItemsLabel(rental))} · Kembali ${formatDate(rental.due_date)}</small></div>
      <div class="rental-side"><span class="status-tag ${stage}">${stageLabel(stage)}</span>${rental.status === "active" ? `<button class="return-button" type="button" data-return="${escapeHtml(rental.id)}">Proses kembali</button>` : ""}</div>
    </div>`;
  }).join("") : '<div class="empty-inline"><strong>Belum ada transaksi</strong><span>Penyewaan baru akan muncul di sini.</span></div>';
}

function renderFlowAndMetrics() {
  const total = state.costumes.reduce((sum, costume) => sum + Number(costume.stock_total || 0), 0);
  const available = state.costumes.reduce((sum, costume) => sum + availableStock(costume), 0);
  const active = state.rentals.filter((rental) => rental.status === "active");
  const rented = active.reduce((sum, rental) => sum + unitsIn(rental), 0);
  const due = active.filter((rental) => rental.due_date <= today()).reduce((sum, rental) => sum + unitsIn(rental), 0);
  const maintenance = state.costumes.filter((costume) => costume.condition !== "Baik").reduce((sum, costume) => sum + Number(costume.stock_total || 0), 0);
  const outTodayOrEarlier = active.filter((rental) => rental.start_date <= today()).reduce((sum, rental) => sum + unitsIn(rental), 0);
  const returnedToday = state.rentals.filter((rental) => rental.status === "returned" && rental.returned_at?.slice(0, 10) === today()).reduce((sum, rental) => sum + unitsIn(rental), 0);

  byId("metric-costumes").textContent = total;
  byId("metric-available").textContent = available;
  byId("metric-rentals").textContent = rented;
  byId("metric-due").textContent = due;
  byId("metric-maintenance").textContent = maintenance;
  byId("flow-available").textContent = available;
  byId("flow-rented").textContent = rented;
  byId("flow-out").textContent = outTodayOrEarlier;
  byId("flow-in-use").textContent = "—";
  byId("flow-returned").textContent = returnedToday;
  byId("flow-inspection").textContent = "—";
  byId("flow-ready").textContent = available;
}

function renderOutgoing() {
  const search = byId("outgoing-search").value.trim().toLowerCase();
  const filter = byId("outgoing-filter").value;
  const rentals = state.rentals.filter((rental) => rental.status === "active").filter((rental) => {
    const stage = rentalStage(rental);
    const text = `${rental.id} ${rental.renter?.full_name || ""} ${rental.renter?.phone || ""} ${rentalItemsLabel(rental)}`.toLowerCase();
    return text.includes(search) && (filter === "all" || filter === "today" && rental.start_date === today() || filter === "upcoming" && stage === "upcoming" || filter === "active" && ["active", "due"].includes(stage) || filter === "overdue" && stage === "overdue");
  });
  byId("outgoing-count").textContent = `${rentals.length} transaksi`;
  byId("outgoing-rows").innerHTML = rentals.length ? rentals.map((rental) => {
    const stage = rentalStage(rental);
    return `<tr><td><span class="transaction-id">${escapeHtml(rental.id.slice(0, 8).toUpperCase())}</span></td><td>${escapeHtml(rental.renter?.full_name || "Penyewa")}</td><td>${escapeHtml(rentalItemsLabel(rental))}</td><td>${unitsIn(rental)}</td><td>${formatDate(rental.start_date)}</td><td>${formatDate(rental.due_date)}</td><td><span class="status-tag ${stage}">${stageLabel(stage)}</span></td><td><button class="table-action" type="button" data-return="${escapeHtml(rental.id)}">Kembali</button></td></tr>`;
  }).join("") : '<tr><td colspan="8" class="table-message">Tidak ada transaksi untuk filter ini.</td></tr>';
}

function renderReturnQueue() {
  const active = state.rentals.filter((rental) => rental.status === "active");
  byId("return-queue").innerHTML = active.length ? active.map((rental) => `<article class="return-card"><div><strong>${escapeHtml(rental.renter?.full_name || "Penyewa")}</strong><span>${escapeHtml(rentalItemsLabel(rental))}</span><small>Keluar ${formatDate(rental.start_date)} · Rencana kembali ${formatDate(rental.due_date)}</small></div><button class="return-action" type="button" data-return="${escapeHtml(rental.id)}" aria-label="Tandai transaksi kembali"><img src="./assets/illustrations/returning.svg" alt=""><span>Tandai kembali</span></button></article>`).join("") : '<div class="empty-inline"><img src="./assets/illustrations/returning.svg" alt="Ilustrasi karakter mengembalikan jarik" class="empty-illustration"><strong>Tidak ada kostum di luar studio</strong><span>Transaksi aktif akan tampil di sini.</span></div>';
}

function renderConditions() {
  const conditions = ["Baik", "Perlu perawatan", "Dalam perbaikan"];
  byId("condition-summary").innerHTML = conditions.map((condition) => {
    const count = state.costumes.filter((costume) => (costume.condition || "Baik") === condition).reduce((sum, costume) => sum + Number(costume.stock_total || 0), 0);
    return `<div class="condition-line"><span class="condition-badge ${conditionClass(condition)}">${escapeHtml(condition)}</span><strong>${count}<small> unit</small></strong></div>`;
  }).join("");
}

function renderCustomers() {
  const rentalCounts = new Map();
  for (const rental of state.rentals) rentalCounts.set(rental.renter_id, (rentalCounts.get(rental.renter_id) || 0) + 1);
  byId("customer-count").textContent = `${state.renters.length} pelanggan`;
  byId("customer-rows").innerHTML = state.renters.length ? state.renters.map((renter) => `<tr><td><strong>${escapeHtml(renter.full_name)}</strong></td><td>${escapeHtml(renter.phone)}</td><td>${rentalCounts.get(renter.id) || 0}</td></tr>`).join("") : '<tr><td colspan="3" class="table-message">Belum ada data pelanggan.</td></tr>';
}

function renderHistory() {
  const filter = byId("history-filter").value;
  const rentals = state.rentals.filter((rental) => filter === "all" || rental.status === filter).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  byId("history-rows").innerHTML = rentals.length ? rentals.map((rental) => {
    const returned = rental.status === "returned";
    return `<tr><td><span class="transaction-id">${escapeHtml(rental.id.slice(0, 8).toUpperCase())}</span></td><td>${escapeHtml(rental.renter?.full_name || "Penyewa")}</td><td>${returned ? "Penyewaan dikembalikan" : "Penyewaan dicatat"}<small class="table-subline">${escapeHtml(rentalItemsLabel(rental))}</small></td><td>${formatDate(returned ? rental.returned_at : rental.created_at)}</td><td><span class="status-tag ${returned ? "returned" : rentalStage(rental)}">${returned ? "Selesai" : stageLabel(rentalStage(rental))}</span></td></tr>`;
  }).join("") : '<tr><td colspan="5" class="table-message">Belum ada aktivitas transaksi.</td></tr>';
}

function renderDashboard() {
  renderFlowAndMetrics();
  renderCostumes();
  renderRentals();
  renderOutgoing();
  renderReturnQueue();
  renderConditions();
  renderCustomers();
  renderHistory();
  renderRentalOptions();
}

function renderRentalOptions() {
  const select = byId("rental-costume");
  const current = select.value;
  const categoryFilter = byId("rental-category-filter");
  const sizeFilter = byId("rental-size-filter");
  const selectedCategory = categoryFilter.value;
  const selectedSize = sizeFilter.value;
  const available = state.costumes.filter((costume) => availableStock(costume) > 0);
  const categories = [...new Set(available.map((costume) => costume.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "id"));
  const sizes = [...new Set(available.map((costume) => costume.size).filter(Boolean))].sort((a, b) => a.localeCompare(b, "id"));
  categoryFilter.innerHTML = '<option value="">Semua kategori</option>' + categories.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  sizeFilter.innerHTML = '<option value="">Semua ukuran</option>' + sizes.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  if (categories.includes(selectedCategory)) categoryFilter.value = selectedCategory;
  if (sizes.includes(selectedSize)) sizeFilter.value = selectedSize;
  const search = byId("rental-costume-search").value.trim().toLowerCase();
  const filtered = available.filter((costume) => `${costume.name} ${costume.category} ${costume.size}`.toLowerCase().includes(search)
    && (!categoryFilter.value || costume.category === categoryFilter.value)
    && (!sizeFilter.value || costume.size === sizeFilter.value));
  select.innerHTML = available.length
    ? filtered.length ? filtered.map((costume) => `<option value="${escapeHtml(costume.id)}" data-rate="${Number(costume.daily_rate)}" data-stock="${availableStock(costume)}">${escapeHtml(costume.name)} · ${escapeHtml(costume.category)} · ${escapeHtml(costume.size || "All size")} · ${availableStock(costume)} tersedia</option>`).join("") : '<option value="">Tidak ada kostum cocok</option>'
    : '<option value="">Belum ada kostum tersedia</option>';
  if (filtered.some((costume) => costume.id === current)) select.value = current;
  select.disabled = filtered.length === 0;
  byId("rental-quantity").max = select.selectedOptions[0]?.dataset.stock || "1";
  updateRentalRate();
}

function rentalDayCount() {
  const start = byId("rental-start-date").value;
  const due = byId("rental-due-date").value;
  if (!start || !due) return 1;
  return Math.max(1, Math.ceil((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000));
}

function updateRentalRate() {
  const option = byId("rental-costume").selectedOptions[0];
  if (!option || !option.value) {
    byId("rental-rate-hint").textContent = "Belum ada kostum tersedia untuk disewa.";
    byId("rental-total").textContent = formatMoney(0);
    return;
  }
  const quantity = Math.max(1, Number(byId("rental-quantity").value) || 1);
  const rate = Number(option.dataset.rate) || 0;
  byId("rental-quantity").max = option.dataset.stock;
  byId("rental-rate-hint").textContent = `${formatMoney(rate)} per hari · ${option.dataset.stock} tersedia`;
  byId("rental-total").textContent = formatMoney(rate * quantity * rentalDayCount());
}

async function loadDashboard() {
  const connection = byId("connection-status");
  try {
    const result = await api("/dashboard");
    state.costumes = result.costumes;
    state.renters = result.renters;
    state.rentals = result.rentals;
    connection.hidden = true;
    renderDashboard();
  } catch (error) {
    connection.hidden = false;
    connection.textContent = location.protocol === "file:"
      ? "Aplikasi dibuka langsung dari file. Jalankan node backend/app.js untuk memuat data dan menyimpan perubahan."
      : error.message.includes("SUPABASE_") || error.message.includes("placeholder")
      ? "Supabase belum terhubung. Periksa SUPABASE_URL dan SUPABASE_PUBLISHABLE_KEY di backend/app.js."
      : `Data belum dapat dimuat: ${error.message}`;
    byId("costume-rows").innerHTML = '<tr><td colspan="6" class="table-message">Data persediaan belum tersedia.</td></tr>';
    byId("inventory-all-rows").innerHTML = '<tr><td colspan="7" class="table-message">Data persediaan belum tersedia.</td></tr>';
    byId("rental-list").innerHTML = '<div class="empty-inline"><strong>Belum ada data transaksi</strong><span>Periksa koneksi Supabase untuk memuat data studio.</span></div>';
  }
}

let toastTimer;
function showToast(message) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
}

function openCostumeDialog(costume = null) {
  const form = byId("costume-form");
  form.reset();
  form.elements.id.value = costume?.id || "";
  if (costume) {
    for (const field of ["name", "category", "size", "stock_total", "daily_rate", "condition"]) form.elements[field].value = costume[field] ?? "";
  }
  byId("costume-dialog-title").textContent = costume ? "Edit kostum" : "Tambah kostum";
  byId("costume-submit").textContent = costume ? "Simpan perubahan" : "Simpan kostum";
  byId("costume-error").textContent = "";
  byId("costume-dialog").showModal();
}

function openCostumeDetail(id) {
  const costume = state.costumes.find((item) => item.id === id);
  if (!costume) return;
  const rented = rentedStock(costume);
  const events = [{ date: costume.created_at, title: "Kostum ditambahkan", detail: "Koleksi tercatat di studio." }];
  for (const rental of state.rentals) {
    const item = (rental.items || []).find((entry) => entry.costume_id === id);
    if (!item) continue;
    events.push({ date: rental.start_date, title: rental.status === "active" ? "Kostum disewa" : "Transaksi penyewaan", detail: `${rental.renter?.full_name || "Penyewa"} · ${item.quantity} unit` });
    if (rental.returned_at) events.push({ date: rental.returned_at, title: "Kostum dikembalikan", detail: `Transaksi ${rental.id.slice(0, 8).toUpperCase()}` });
  }
  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  byId("costume-detail-content").innerHTML = `<div class="detail-hero"><div class="detail-fabric" aria-hidden="true"></div><div><span class="condition-badge ${conditionClass(costume.condition)}">${escapeHtml(costume.condition || "Baik")}</span><h3>${escapeHtml(costume.name)}</h3><p>${escapeHtml(costume.category)} · ${escapeHtml(costume.size || "Ukuran belum dicatat")}</p></div></div>
    <div class="detail-stats"><div><small>STOK TOTAL</small><strong>${Number(costume.stock_total)}</strong></div><div><small>TERSEDIA</small><strong>${availableStock(costume)}</strong></div><div><small>SEDANG DISEWA</small><strong>${rented}</strong></div></div>
    <dl class="detail-facts"><div><dt>ID kostum</dt><dd>${escapeHtml(costume.id.slice(0, 8).toUpperCase())}</dd></div><div><dt>Tarif sewa</dt><dd>${formatMoney(costume.daily_rate)} / hari</dd></div><div><dt>Lokasi simpan</dt><dd>Belum dicatat di database</dd></div><div><dt>Foto</dt><dd>Belum tersedia</dd></div></dl>
    <div class="detail-history"><h3>Riwayat kostum</h3><ol>${events.map((event) => `<li><span class="timeline-dot"></span><div><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.detail)} · ${formatDate(event.date)}</small></div></li>`).join("")}<li class="untracked-event"><span class="timeline-dot"></span><div><strong>Pemeriksaan / perawatan</strong><small>Riwayat pemeriksaan belum dicatat di database.</small></div></li></ol></div>`;
  byId("costume-detail-dialog").showModal();
}

function setRentalStep(step) {
  state.rentalStep = Math.max(1, Math.min(4, step));
  document.querySelectorAll("[data-rental-step]").forEach((section) => { section.hidden = Number(section.dataset.rentalStep) !== state.rentalStep; });
  document.querySelectorAll("[data-step-indicator]").forEach((indicator) => {
    indicator.classList.toggle("active", Number(indicator.dataset.stepIndicator) === state.rentalStep);
    indicator.classList.toggle("complete", Number(indicator.dataset.stepIndicator) < state.rentalStep);
  });
  byId("rental-prev").hidden = state.rentalStep === 1;
  byId("rental-next").hidden = state.rentalStep === 4;
  byId("rental-submit").hidden = state.rentalStep !== 4;
  if (state.rentalStep === 4) renderRentalSummary();
}

function renderRentalSummary() {
  const form = byId("rental-form");
  const costume = state.costumes.find((item) => item.id === form.elements.costume_id.value);
  const days = rentalDayCount();
  const total = (Number(costume?.daily_rate) || 0) * Number(form.elements.quantity.value || 1) * days;
  byId("rental-summary").innerHTML = `<div><span>Penyewa</span><strong>${escapeHtml(form.elements.full_name.value)}</strong><small>${escapeHtml(form.elements.phone.value)}</small></div><div><span>Kostum</span><strong>${escapeHtml(costume?.name || "Kostum")}</strong><small>${Number(form.elements.quantity.value || 1)} unit × ${formatMoney(costume?.daily_rate)} × ${days} hari</small></div><div><span>Tanggal sewa</span><strong>${formatDate(form.elements.start_date.value)} – ${formatDate(form.elements.due_date.value)}</strong></div><div class="summary-total"><span>Estimasi total</span><strong>${formatMoney(total)}</strong></div>`;
}

function openRentalDialog() {
  const form = byId("rental-form");
  form.reset();
  renderRentalOptions();
  setDefaultRentalDates();
  byId("rental-error").textContent = "";
  setRentalStep(1);
  byId("rental-dialog").showModal();
}

function setDefaultRentalDates() {
  const start = new Date();
  const due = new Date(start);
  due.setDate(due.getDate() + 1);
  const toInputDate = (date) => {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  };
  byId("rental-start-date").min = toInputDate(start);
  byId("rental-start-date").value = toInputDate(start);
  byId("rental-due-date").min = toInputDate(start);
  byId("rental-due-date").value = toInputDate(due);
  updateRentalRate();
}

async function processReturn(button) {
  const rental = state.rentals.find((item) => item.id === button.dataset.return);
  if (!rental || !window.confirm(`Catat pengembalian ${rentalItemsLabel(rental)} dari ${rental.renter?.full_name || "penyewa"}?`)) return;
  button.disabled = true;
  try {
    await api(`/rentals/${encodeURIComponent(rental.id)}`, { method: "PATCH", body: JSON.stringify({ status: "returned" }) });
    showToast("Pengembalian berhasil dicatat.");
    await loadDashboard();
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  }
}

byId("today-label").textContent = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
byId("new-costume-button").addEventListener("click", () => openCostumeDialog());
byId("new-rental-button").addEventListener("click", openRentalDialog);
byId("refresh-button").addEventListener("click", loadDashboard);
byId("costume-search").addEventListener("input", () => { state.page = 1; renderCostumes(); });
for (const id of ["category-filter", "size-filter", "condition-filter", "sort-filter"]) byId(id).addEventListener("change", () => { state.page = 1; renderCostumes(); });
byId("page-prev").addEventListener("click", () => { state.page = Math.max(1, state.page - 1); renderCostumes(); });
byId("page-next").addEventListener("click", () => { state.page += 1; renderCostumes(); });
byId("outgoing-search").addEventListener("input", renderOutgoing);
byId("outgoing-filter").addEventListener("change", renderOutgoing);
byId("history-filter").addEventListener("change", renderHistory);
byId("rental-costume").addEventListener("change", updateRentalRate);
byId("rental-costume-search").addEventListener("input", renderRentalOptions);
byId("rental-category-filter").addEventListener("change", renderRentalOptions);
byId("rental-size-filter").addEventListener("change", renderRentalOptions);
byId("rental-quantity").addEventListener("input", updateRentalRate);
byId("rental-start-date").addEventListener("change", updateRentalRate);
byId("rental-due-date").addEventListener("change", updateRentalRate);
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => byId(button.dataset.close).close()));
document.querySelectorAll(".nav-link").forEach((link) => link.addEventListener("click", () => {
  document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
  link.classList.add("active");
  byId("breadcrumb-title").textContent = link.textContent.trim().replace(/\s+\d+$/, "");
  document.body.classList.remove("sidebar-open");
}));
byId("sidebar-toggle").addEventListener("click", () => document.body.classList.toggle("sidebar-open"));

document.addEventListener("click", async (event) => {
  const detail = event.target.closest("[data-detail]");
  const edit = event.target.closest("[data-edit]");
  const remove = event.target.closest("[data-delete]");
  const returned = event.target.closest("[data-return]");
  if (detail) openCostumeDetail(detail.dataset.detail);
  if (edit) openCostumeDialog(state.costumes.find((item) => item.id === edit.dataset.edit));
  if (remove) {
    const costume = state.costumes.find((item) => item.id === remove.dataset.delete);
    if (!costume || !window.confirm(`Hapus kostum “${costume.name}”? Kostum yang memiliki riwayat penyewaan tidak dapat dihapus.`)) return;
    remove.disabled = true;
    try {
      await api(`/costumes/${encodeURIComponent(costume.id)}`, { method: "DELETE" });
      showToast("Kostum berhasil dihapus.");
      await loadDashboard();
    } catch (error) {
      remove.disabled = false;
      showToast(error.message);
    }
  }
  if (returned) processReturn(returned);
  if (event.target.closest("[data-open-costume]")) openCostumeDialog();
});

byId("costume-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const id = values.id;
  values.stock_total = Number(values.stock_total);
  values.daily_rate = Number(values.daily_rate);
  delete values.id;
  byId("costume-error").textContent = "";
  if (id) {
    const current = state.costumes.find((item) => item.id === id);
    const rented = Number(current?.stock_total || 0) - availableStock(current || { stock_total: 0, id });
    if (values.stock_total < rented) {
      byId("costume-error").textContent = `Stok tidak boleh kurang dari ${rented} unit yang sedang disewa.`;
      return;
    }
  }
  const submit = byId("costume-submit");
  submit.disabled = true;
  try {
    await api(id ? `/costumes/${encodeURIComponent(id)}` : "/costumes", { method: id ? "PUT" : "POST", body: JSON.stringify(values) });
    form.reset();
    byId("costume-dialog").close();
    showToast(id ? "Perubahan kostum tersimpan." : "Kostum berhasil ditambahkan.");
    await loadDashboard();
  } catch (error) {
    byId("costume-error").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

byId("rental-next").addEventListener("click", () => {
  const current = document.querySelector(`[data-rental-step="${state.rentalStep}"]`);
  const inputs = [...current.querySelectorAll("input, select")];
  for (const input of inputs) {
    if (!input.checkValidity()) { input.reportValidity(); return; }
  }
  if (state.rentalStep === 2 && Number(byId("rental-quantity").value) > Number(byId("rental-quantity").max)) {
    byId("rental-error").textContent = "Jumlah melebihi stok yang tersedia.";
    return;
  }
  if (state.rentalStep === 2 && !byId("rental-costume").value) {
    byId("rental-error").textContent = "Pilih kostum yang tersedia untuk melanjutkan.";
    return;
  }
  if (state.rentalStep === 3 && byId("rental-due-date").value < byId("rental-start-date").value) {
    byId("rental-error").textContent = "Tanggal kembali tidak boleh sebelum tanggal sewa.";
    return;
  }
  byId("rental-error").textContent = "";
  setRentalStep(state.rentalStep + 1);
});
byId("rental-prev").addEventListener("click", () => setRentalStep(state.rentalStep - 1));

byId("rental-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  if (!values.costume_id) {
    byId("rental-error").textContent = "Belum ada kostum yang tersedia.";
    return;
  }
  byId("rental-error").textContent = "";
  byId("rental-submit").disabled = true;
  try {
    await api("/rentals", {
      method: "POST",
      body: JSON.stringify({ full_name: values.full_name, phone: values.phone, start_date: values.start_date, due_date: values.due_date, items: [{ costume_id: values.costume_id, quantity: Number(values.quantity) }] }),
    });
    form.reset();
    byId("rental-dialog").close();
    showToast("Penyewaan berhasil dicatat.");
    await loadDashboard();
  } catch (error) {
    byId("rental-error").textContent = error.message;
  } finally {
    byId("rental-submit").disabled = false;
  }
});

function addConnectionBanner() {
  if (byId("connection-status")) return;
  const banner = document.createElement("div");
  banner.id = "connection-status";
  banner.className = "connection-status";
  banner.hidden = true;
  byId("dashboard").querySelector(".topbar").after(banner);
}

addConnectionBanner();
setDefaultRentalDates();
loadDashboard();