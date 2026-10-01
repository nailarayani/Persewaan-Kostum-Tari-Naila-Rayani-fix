const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const SUPABASE_URL = "https://sdqxtrwqjbjgsgcfgzve.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_jVxd9Oin5c0GzqAI03R2cA_g--JqI7i";

const frontendDirectory = path.resolve(__dirname, "../frontend");
const port = Number(process.env.PORT || 3000);
const contentTypes = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
const configurationReady = !SUPABASE_URL.includes("YOUR_PROJECT_REF") && !SUPABASE_PUBLISHABLE_KEY.includes("YOUR_SUPABASE_PUBLISHABLE_KEY");

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error("Ukuran permintaan terlalu besar."));
    });
    request.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error("Format JSON tidak valid.")); }
    });
    request.on("error", reject);
  });
}

async function supabase(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(data?.message || data?.hint || "Supabase menolak permintaan.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function serveStatic(pathname, response) {
  const requestedPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = path.resolve(frontendDirectory, `.${requestedPath}`);
  if (!filePath.startsWith(`${frontendDirectory}${path.sep}`)) {
    sendJson(response, 403, { error: "Akses tidak diizinkan." });
    return;
  }
  fs.readFile(filePath, (error, contents) => {
    if (error) {
      sendJson(response, 404, { error: "Halaman tidak ditemukan." });
      return;
    }
    response.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
    response.end(contents);
  });
}

async function handleApi(request, response, url) {
  if (!configurationReady) {
    sendJson(response, 503, { error: "Lengkapi SUPABASE_URL dan SUPABASE_PUBLISHABLE_KEY di backend/app.js terlebih dahulu." });
    return;
  }

  if (url.pathname === "/api/dashboard" && request.method === "GET") {
    const [costumes, renters, rentals] = await Promise.all([
      supabase("costumes?select=*&order=created_at.desc"),
      supabase("renters?select=id,full_name,phone&order=created_at.desc"),
      supabase("rentals?select=id,renter_id,start_date,due_date,status,created_at,returned_at,renter:renters(full_name,phone),items:rental_items(id,costume_id,quantity,daily_rate,costume:costumes(name))&order=created_at.desc"),
    ]);
    sendJson(response, 200, { costumes, renters, rentals });
    return;
  }

  if (url.pathname === "/api/costumes" && request.method === "POST") {
    const body = await readJson(request);
    const [costume] = await supabase("costumes", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        name: String(body.name || "").trim(),
        category: String(body.category || "").trim(),
        size: String(body.size || "").trim(),
        stock_total: Number(body.stock_total),
        daily_rate: Number(body.daily_rate),
        condition: String(body.condition || "Baik"),
      }),
    });
    sendJson(response, 201, costume);
    return;
  }

  const costumeMatch = url.pathname.match(/^\/api\/costumes\/([0-9a-f-]+)$/i);
  if (costumeMatch && request.method === "PUT") {
    const body = await readJson(request);
    const [costume] = await supabase(`costumes?id=eq.${encodeURIComponent(costumeMatch[1])}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        name: String(body.name || "").trim(),
        category: String(body.category || "").trim(),
        size: String(body.size || "").trim(),
        stock_total: Number(body.stock_total),
        daily_rate: Number(body.daily_rate),
        condition: String(body.condition || "Baik"),
      }),
    });
    if (!costume) {
      sendJson(response, 404, { error: "Kostum tidak ditemukan." });
      return;
    }
    sendJson(response, 200, costume);
    return;
  }

  if (costumeMatch && request.method === "DELETE") {
    await supabase(`costumes?id=eq.${encodeURIComponent(costumeMatch[1])}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    sendJson(response, 200, { deleted: true });
    return;
  }

  if (url.pathname === "/api/rentals" && request.method === "POST") {
    const body = await readJson(request);
    const today = new Date();
    const localToday = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const rental = await supabase("rpc/create_rental", {
      method: "POST",
      body: JSON.stringify({
        p_full_name: String(body.full_name || "").trim(),
        p_phone: String(body.phone || "").trim(),
        p_start_date: body.start_date || localToday,
        p_due_date: body.due_date,
        p_items: body.items,
      }),
    });
    sendJson(response, 201, { id: rental });
    return;
  }

  const rentalMatch = url.pathname.match(/^\/api\/rentals\/([0-9a-f-]+)$/i);
  if (rentalMatch && request.method === "PATCH") {
    const body = await readJson(request);
    if (body.status !== "returned") {
      sendJson(response, 400, { error: "Status penyewaan tidak valid." });
      return;
    }
    const [rental] = await supabase(`rentals?id=eq.${encodeURIComponent(rentalMatch[1])}&status=eq.active`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: "returned", returned_at: new Date().toISOString() }),
    });
    if (!rental) {
      sendJson(response, 404, { error: "Penyewaan aktif tidak ditemukan." });
      return;
    }
    sendJson(response, 200, rental);
    return;
  }

  sendJson(response, 404, { error: "Endpoint tidak ditemukan." });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    serveStatic(url.pathname, response);
  } catch (error) {
    console.error(error);
    sendJson(response, error.status || 500, { error: error.message || "Terjadi kesalahan pada server." });
  }
});

server.listen(port, () => console.log(`Ruang Tari berjalan di http://localhost:${port}`));