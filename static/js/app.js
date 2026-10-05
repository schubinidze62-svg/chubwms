/**
 * საწყობის WMS ვებ რუკა - Interactive Map & Warehouse Management Client
 */

let state = {
    locations: [],
    banks: [],
    banks_summary: {},
    scores: {},
    scores_text: "",
    catalog_size: 0,
    occupied: 0,
    empty_locations: 0,
    total_qty: 0,
    unknown_categories: []
};

// UI State
let activeTab = "mapPage";
let viewMode = "floor"; // "floor" (All banks), "matrix" (Rack elevation), "list" (Cards)
let selectedBank = "";
let searchQuery = "";
let selectedColor = "";
let onlyOccupied = false;
let sortMode = "bank";

// Pagination for List & Table
let mapPage = 1;
let mapPageSize = 50;
let locPage = 1;
let locPageSize = 50;
let renderTimer = null;

// ==========================================
// Initialization
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    initFilters();
    reloadData();
});

function initTabs() {
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
            
            btn.classList.add("active");
            activeTab = btn.dataset.tab;
            const targetPage = document.getElementById(activeTab);
            if (targetPage) targetPage.classList.add("active");

            if (activeTab === "mapPage") renderActiveMapView();
            if (activeTab === "locationsPage") renderLocationsTable();
            if (activeTab === "scoresPage") renderScoresView();
        });
    });
}

function initFilters() {
    const searchEl = document.getElementById("searchBox");
    if (searchEl) {
        searchEl.addEventListener("input", (e) => {
            searchQuery = e.target.value.trim().toLowerCase();
            scheduleRender();
        });
    }

    const bankEl = document.getElementById("bankFilter");
    if (bankEl) {
        bankEl.addEventListener("change", (e) => {
            selectedBank = e.target.value;
            if (selectedBank) {
                setViewMode("matrix");
            } else {
                setViewMode("floor");
            }
        });
    }

    const colorEl = document.getElementById("colorFilter");
    if (colorEl) {
        colorEl.addEventListener("change", (e) => {
            selectedColor = e.target.value;
            scheduleRender();
        });
    }

    const sortEl = document.getElementById("sortMode");
    if (sortEl) {
        sortEl.addEventListener("change", (e) => {
            sortMode = e.target.value;
            scheduleRender();
        });
    }
}

// ==========================================
// Data Fetching & Sync
// ==========================================
function reloadData() {
    showStatusBanner("მონაცემები იტვირთება...", "warn");
    fetch("/api/data")
        .then(res => {
            if (!res.ok) throw new Error("სერვერმა დააბრუნა შეცდომა: " + res.status);
            return res.json();
        })
        .then(data => {
            state = data;
            
            renderStats();
            populateBankSelector();
            renderScoresView();
            renderActiveMapView();
            if (activeTab === "locationsPage") renderLocationsTable();

            hideStatusBanner();
        })
        .catch(err => {
            showStatusBanner("მონაცემების ჩატვირთვის შეცდომა: " + err.message, "error");
        });
}

function loadSampleData() {
    if (!confirm("ნამდვილად გსურთ სადემონსტრაციო საწყობის მონაცემების ჩატვირთვა? არსებული მონაცემები შეიცვლება.")) return;
    
    showStatusBanner("სადემონსტრაციო მონაცემები იტვირთება...", "warn");
    fetch("/api/sample-data", { method: "POST" })
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                showStatusBanner("შეცდომა: " + data.error, "error");
                return;
            }
            state = data;
            selectedBank = "";
            viewMode = "floor";
            renderStats();
            populateBankSelector();
            renderScoresView();
            renderActiveMapView();
            showStatusBanner((data.messages || ["დემო საწყობი ჩაიტვირთა!"]).join("\n"), "success");
        })
        .catch(err => {
            showStatusBanner("შეცდომა: " + err.message, "error");
        });
}

// ==========================================
// UI Rendering - Stats & Selectors
// ==========================================
function renderStats() {
    setElText("statLocations", state.locations ? state.locations.length : 0);
    setElText("statOccupied", state.occupied || 0);
    setElText("statEmpty", state.empty_locations || 0);
    setElText("statQty", formatNum(state.total_qty || 0));
    setElText("statCatalog", state.catalog_size || 0);

    const redCount = (state.locations || []).filter(l => l.status === "red").length;
    setElText("statRed", redCount);
}

function populateBankSelector() {
    const select = document.getElementById("bankFilter");
    if (!select) return;

    const currentVal = selectedBank;
    select.innerHTML = '<option value="">🏢 ყველა რიგი (Floorplan)</option>';

    (state.banks || []).forEach(bank => {
        const opt = document.createElement("option");
        opt.value = bank;
        const bs = (state.banks_summary || {})[bank];
        const count = bs ? bs.total_locations : 0;
        opt.textContent = `რიგი ${bank} (${count} უჯრა)`;
        select.appendChild(opt);
    });

    if (currentVal && (state.banks || []).includes(currentVal)) {
        select.value = currentVal;
    } else {
        select.value = "";
    }
}

// ==========================================
// View Mode Switching
// ==========================================
function setViewMode(mode) {
    viewMode = mode;
    document.querySelectorAll(".view-mode-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.mode === mode);
    });

    const paginationRow = document.getElementById("mapPaginationRow");
    if (paginationRow) {
        paginationRow.style.display = (mode === "list") ? "flex" : "none";
    }

    renderActiveMapView();
}

function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
        renderActiveMapView();
        if (activeTab === "locationsPage") renderLocationsTable();
    }, 200);
}

function renderActiveMapView() {
    const container = document.getElementById("mapContainer");
    if (!container) return;

    if (viewMode === "floor" || !selectedBank) {
        renderFloorPlan(container);
    } else if (viewMode === "matrix") {
        renderRackMatrix(container);
    } else {
        renderClassicList(container);
    }
}

// ==========================================
// View 1: Floor Plan Overview (All Banks) — Real 2D Visual Map
// ==========================================
function renderFloorPlan(container) {
    container.innerHTML = "";
    const banks = state.banks || [];
    const summary = state.banks_summary || {};

    if (banks.length === 0) {
        container.innerHTML = `
            <div style="padding: 40px; text-align: center; color: var(--text-muted);">
                <h3>საწყობის მონაცემები ჯერ არ არის ატვირთული</h3>
                <p style="margin-top: 8px;">დააჭირეთ <b>"🚀 რუკის აგება"</b>-ს Excel-ის ასატვირთად ან <b>"🧪 დემო საწყობის ჩატვირთვა"</b>-ს საჩვენებელი მონაცემებისთვის.</p>
            </div>
        `;
        return;
    }

    // Build a fast lookup: bank -> Map of "bay_level" -> loc
    const bankLocMap = {};
    const bankDims = {}; // bank -> {maxBay, maxLevel}
    (state.locations || []).forEach(loc => {
        const b = loc.bank || "";
        if (!b) return;
        if (!bankLocMap[b]) { bankLocMap[b] = new Map(); bankDims[b] = {maxBay: 1, maxLevel: 1}; }
        const bay = Number(loc.bay || 1);
        const level = Number(loc.level || 1);
        if (bay > bankDims[b].maxBay) bankDims[b].maxBay = bay;
        if (level > bankDims[b].maxLevel) bankDims[b].maxLevel = level;
        bankLocMap[b].set(`${bay}_${level}`, loc);
    });

    // Filter state
    const srch = searchQuery.toLowerCase();

    const outerWrap = document.createElement("div");
    outerWrap.className = "visual-floorplan";

    banks.forEach(bankName => {
        const bs = summary[bankName] || { total_locations: 0, occupied: 0, empty: 0, total_qty: 0, status_counts: {} };
        const locMap = bankLocMap[bankName] || new Map();
        const dims = bankDims[bankName] || { maxBay: 1, maxLevel: 1 };

        const bankCard = document.createElement("div");
        bankCard.className = "vf-bank";

        // Header — click to open rack matrix
        const header = document.createElement("div");
        header.className = "vf-bank-header";
        header.innerHTML = `
            <span class="vf-bank-name" title="თაროს გახსნა">${escapeHtml(bankName)}</span>
            <span class="vf-bank-info">${bs.occupied}/${bs.total_locations}</span>
        `;
        header.addEventListener("click", () => selectBankAndOpenRack(bankName));
        bankCard.appendChild(header);

        // Mini grid: rows = levels (top to bottom descending), cols = bays
        const gridEl = document.createElement("div");
        gridEl.className = "vf-grid";
        gridEl.style.gridTemplateColumns = `repeat(${dims.maxBay}, 1fr)`;

        for (let lvl = dims.maxLevel; lvl >= 1; lvl--) {
            for (let bay = 1; bay <= dims.maxBay; bay++) {
                const cell = document.createElement("div");
                const loc = locMap.get(`${bay}_${lvl}`);

                if (loc) {
                    let status = loc.status || "gray";
                    // Apply search highlight
                    const matchesSrch = srch ? locationMatchesSearch(loc, srch) : false;
                    const dimmed = (selectedColor && status !== selectedColor) ||
                                   (onlyOccupied && Number(loc.qty || 0) === 0);

                    cell.className = "vf-cell " + status;
                    if (dimmed) cell.style.opacity = "0.15";
                    if (matchesSrch) cell.classList.add("vf-cell-highlight");

                    cell.title = `${loc.name || loc.std_code}\nBay ${bay} / Level ${lvl}\nQty: ${formatNum(loc.qty || 0)}`;
                    cell.addEventListener("click", (e) => {
                        e.stopPropagation();
                        openLocationDrawer(loc.std_code || loc.name);
                    });
                } else {
                    cell.className = "vf-cell vf-cell-empty";
                    cell.style.opacity = "0";
                }
                gridEl.appendChild(cell);
            }
        }

        bankCard.appendChild(gridEl);

        // Footer bar: occupancy
        const total = bs.total_locations || 1;
        const occ = bs.occupied || 0;
        const occPct = Math.round((occ / total) * 100);
        const footer = document.createElement("div");
        footer.className = "vf-bank-footer";
        footer.innerHTML = `<div class="vf-occ-bar"><div class="vf-occ-fill" style="width:${occPct}%"></div></div>`;
        bankCard.appendChild(footer);

        outerWrap.appendChild(bankCard);
    });

    container.appendChild(outerWrap);
}

function selectBankAndOpenRack(bankName) {
    selectedBank = bankName;
    const bankSelect = document.getElementById("bankFilter");
    if (bankSelect) bankSelect.value = bankName;
    if (bankName) {
        setViewMode("matrix");
    } else {
        setViewMode("floor");
    }
}

// ==========================================
// View 2: Rack Elevation Matrix (Bay × Level)
// ==========================================
function renderRackMatrix(container) {
    container.innerHTML = "";

    const bankName = selectedBank;
    if (!bankName) {
        renderFloorPlan(container);
        return;
    }

    // Filter locations for this bank
    let bankLocations = (state.locations || []).filter(l => (l.bank || "") === bankName);
    if (bankLocations.length === 0) {
        container.innerHTML = `<div style="padding: 30px; color: var(--text-muted);">რიგში "${escapeHtml(bankName)}" ლოკაციები არ მოიძებნა.</div>`;
        return;
    }

    // Find dimensions
    let maxBay = 1;
    let maxLevel = 1;
    const locMap = new Map();

    bankLocations.forEach(loc => {
        const bay = Number(loc.bay || 0);
        const level = Number(loc.level || 0);
        if (bay > maxBay) maxBay = bay;
        if (level > maxLevel) maxLevel = level;
        locMap.set(`${bay}_${level}`, loc);
    });

    const wrapper = document.createElement("div");
    wrapper.className = "rack-matrix-wrapper";

    const card = document.createElement("div");
    card.className = "rack-elevation-card";

    // Header info
    card.innerHTML = `
        <div class="rack-title-row">
            <div>
                <h2 style="font-size: 18px; font-weight: 800; color: var(--text-main); margin-bottom: 4px;">
                    🏭 თაროს მატრიცა — რიგი: <span style="color: var(--primary);">${escapeHtml(bankName)}</span>
                </h2>
                <div style="font-size: 12px; color: var(--text-muted);">
                    სექციები (Bays): <b>1 – ${maxBay}</b> · იარუსები (Levels): <b>1 – ${maxLevel}</b> · სულ ლოკაცია: <b>${bankLocations.length}</b>
                </div>
            </div>
            <div style="display: flex; gap: 8px;">
                <button class="btn btn-sm" onclick="selectBankAndOpenRack('')">⟨ ყველა რიგის ხედი</button>
            </div>
        </div>
    `;

    // Table builder: Rows = Levels (from maxLevel down to 1), Cols = Bays (1 to maxBay)
    const table = document.createElement("table");
    table.className = "rack-grid-table";

    const tbody = document.createElement("tbody");

    // Render levels from top to bottom
    for (let lvl = maxLevel; lvl >= 1; lvl--) {
        const tr = document.createElement("tr");

        // Level label on left
        const th = document.createElement("th");
        th.className = "rack-level-label";
        th.textContent = `იარუსი ${lvl}`;
        tr.appendChild(th);

        // Cells for each bay
        for (let bay = 1; bay <= maxBay; bay++) {
            const td = document.createElement("td");
            const loc = locMap.get(`${bay}_${lvl}`);

            if (loc) {
                const cell = createRackCellElement(loc);
                td.appendChild(cell);
            } else {
                td.innerHTML = `<div style="width:90px; height:68px; border:1px dashed #e2e8f0; border-radius:8px; opacity:0.3;"></div>`;
            }

            tr.appendChild(td);
        }

        tbody.appendChild(tr);
    }

    // Bottom row: Bay numbers header
    const tfoot = document.createElement("tr");
    const emptyCorner = document.createElement("td");
    tfoot.appendChild(emptyCorner);

    for (let bay = 1; bay <= maxBay; bay++) {
        const th = document.createElement("th");
        th.className = "rack-bay-header";
        th.textContent = `Bay ${bay}`;
        tfoot.appendChild(th);
    }
    tbody.appendChild(tfoot);

    table.appendChild(tbody);
    card.appendChild(table);
    wrapper.appendChild(card);
    container.appendChild(wrapper);
}

function createRackCellElement(loc) {
    const div = document.createElement("div");
    const status = loc.status || "gray";
    const qty = Number(loc.qty || 0);
    const score = Number(loc.score || 0);
    const limit = Number(loc.limit || 0);

    // Check filters
    const matchesColor = !selectedColor || status === selectedColor;
    const matchesOccupied = !onlyOccupied || qty > 0;
    const matchesSearch = locationMatchesSearch(loc, searchQuery);

    const isDimmed = !(matchesColor && matchesOccupied);
    const isHighlight = Boolean(searchQuery && matchesSearch);

    div.className = `rack-cell ${status}` + (isHighlight ? " highlight" : "");
    if (isDimmed) div.style.opacity = "0.2";

    const fillPct = limit > 0 ? Math.min(100, Math.round((score / limit) * 100)) : 0;
    const meterColor = status === "red" ? "#ef4444" : (status === "yellow" ? "#f59e0b" : "#10b981");

    div.innerHTML = `
        <div class="cell-loc" title="${escapeHtml(loc.name || loc.std_code)}">${escapeHtml(loc.name || loc.std_code)}</div>
        <div class="cell-meta">
            <span>📦 ${formatNum(qty)}</span>
            <span>⭐ ${formatNum(score)}</span>
        </div>
        <div class="cell-meter" title="ქულა: ${formatNum(score)} / ${formatNum(limit)} (${fillPct}%)">
            <div class="cell-meter-fill" style="width: ${fillPct}%; background: ${meterColor};"></div>
        </div>
    `;

    div.addEventListener("click", () => {
        openLocationDrawer(loc.std_code || loc.name);
    });

    return div;
}

// ==========================================
// View 3: Classic Paginated Card List
// ==========================================
function renderClassicList(container) {
    container.innerHTML = "";

    let rows = filterLocations(state.locations || []);
    rows = sortLocations(rows);

    if (rows.length === 0) {
        container.innerHTML = `<div style="padding:30px; color:var(--text-muted);">ფილტრებით ლოკაცია არ მოიძებნა.</div>`;
        updateListPagination(0, 1, 1);
        return;
    }

    const totalRows = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / mapPageSize));
    if (mapPage > totalPages) mapPage = totalPages;
    if (mapPage < 1) mapPage = 1;

    const start = (mapPage - 1) * mapPageSize;
    const end = Math.min(start + mapPageSize, totalRows);
    const pageRows = rows.slice(start, end);

    updateListPagination(totalRows, mapPage, totalPages, start, end);

    const listDiv = document.createElement("div");
    listDiv.className = "map-list";

    pageRows.forEach(loc => {
        const div = document.createElement("div");
        const status = loc.status || "gray";
        const qty = Number(loc.qty || 0);
        const score = Number(loc.score || 0);
        const limit = Number(loc.limit || 0);
        const isHighlight = searchQuery && locationMatchesSearch(loc, searchQuery);

        div.className = `loc-card ${status}` + (isHighlight ? " highlight" : "");
        div.innerHTML = `
            <div>
                <div style="font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    ${escapeHtml(loc.name || loc.std_code)}
                </div>
                <div style="font-size:10px; opacity:0.85;">Bank: ${escapeHtml(loc.bank||"-")} · B:${loc.bay} · L:${loc.level}</div>
            </div>
            <div style="font-size:10px; font-weight:700; margin-top:4px; display:flex; justify-content:space-between;">
                <span>Q: ${formatNum(qty)}</span>
                <span>S: ${formatNum(score)} / ${formatNum(limit)}</span>
            </div>
        `;

        div.addEventListener("click", () => {
            openLocationDrawer(loc.std_code || loc.name);
        });

        listDiv.appendChild(div);
    });

    container.appendChild(listDiv);
}

function updateListPagination(total, page, totalPages, start = 0, end = 0) {
    const info = document.getElementById("mapPageInfo");
    if (info) {
        info.textContent = total === 0 ? "0 ჩანაწერი" : `გვერდი ${page} / ${totalPages} · ${start + 1}-${end} / ${total}`;
    }
}

function prevListPage() {
    mapPage = Math.max(1, mapPage - 1);
    renderActiveMapView();
}

function nextListPage() {
    mapPage += 1;
    renderActiveMapView();
}

// ==========================================
// Slide-over Location Detail Drawer
// ==========================================
function openLocationDrawer(locCode) {
    const drawer = document.getElementById("locationDrawer");
    const backdrop = document.getElementById("drawerBackdrop");
    const body = document.getElementById("drawerBody");
    const title = document.getElementById("drawerTitle");

    if (!drawer || !backdrop || !body || !title) return;

    title.textContent = `📍 ${locCode}`;
    body.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-muted);">დეტალები იტვირთება...</div>`;

    backdrop.classList.add("active");
    drawer.classList.add("active");

    fetch(`/api/location/${encodeURIComponent(locCode)}`)
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                body.innerHTML = `<div style="color: var(--status-red);">${escapeHtml(data.error)}</div>`;
                return;
            }

            const limit = Number(data.limit || 0);
            const score = Number(data.total_score || 0);
            const qty = Number(data.total_qty || 0);
            const pct = limit > 0 ? Math.min(100, Math.round((score / limit) * 100)) : 0;
            const items = data.items || [];

            let itemsTableHtml = "";
            if (items.length > 0) {
                itemsTableHtml = `
                    <div style="margin-top: 18px;">
                        <h4 style="font-size: 13px; font-weight: 800; margin-bottom: 8px;">📦 პროდუქციის სია (${items.length} პოზიცია)</h4>
                        <div class="table-wrap" style="max-height: 280px;">
                            <table>
                                <thead>
                                    <tr>
                                        <th>შტრიხკოდი</th>
                                        <th>კატეგორია</th>
                                        <th>რაოდენობა</th>
                                        <th>ქულა</th>
                                        <th>ჯამი</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${items.map(it => `
                                        <tr>
                                            <td style="font-family:monospace; font-weight:700;">${escapeHtml(it.barcode)}</td>
                                            <td>${escapeHtml(it.category)}</td>
                                            <td style="font-weight:700;">${formatNum(it.qty)}</td>
                                            <td>${formatNum(it.score_per_unit)}</td>
                                            <td style="font-weight:700;">${formatNum(it.subtotal_score)}</td>
                                        </tr>
                                    `).join("")}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;
            } else {
                itemsTableHtml = `
                    <div style="margin-top: 20px; padding: 16px; background: #f8fafc; border-radius: 8px; text-align: center; color: var(--text-muted);">
                        ამ ლოკაციაზე პროდუქცია არ ინახება (ცარიელია).
                    </div>
                `;
            }

            body.innerHTML = `
                <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 16px;">
                    <span class="badge badge-${data.status}">${escapeHtml(data.status_label)}</span>
                    <span style="font-size: 12px; color: var(--text-muted);">ლიმიტი: <b>${limit}</b></span>
                </div>

                <div class="panel" style="margin-bottom: 14px;">
                    <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 6px;">
                        <span>დატვირთულობის ქულა: <b>${formatNum(score)} / ${limit}</b></span>
                        <span><b>${pct}%</b></span>
                    </div>
                    <div class="bank-bar">
                        <div class="bar-segment" style="width: ${pct}%; background: var(--status-${data.status});"></div>
                    </div>
                    <div style="font-size: 12px; color: var(--text-muted); margin-top: 6px;">
                        სულ ერთეული ამ უჯრაში: <b>${formatNum(qty)}</b> ცალი
                    </div>
                </div>

                ${itemsTableHtml}
            `;
        })
        .catch(err => {
            body.innerHTML = `<div style="color: var(--status-red);">შეცდომა: ${err.message}</div>`;
        });
}

function closeLocationDrawer() {
    const drawer = document.getElementById("locationDrawer");
    const backdrop = document.getElementById("drawerBackdrop");
    if (drawer) drawer.classList.remove("active");
    if (backdrop) backdrop.classList.remove("active");
}

// ==========================================
// Locations Table Tab
// ==========================================
function renderLocationsTable() {
    const tbody = document.getElementById("locationsTableBody");
    if (!tbody) return;

    let rows = filterLocations(state.locations || []);
    rows = sortLocations(rows);

    const totalRows = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / locPageSize));
    if (locPage > totalPages) locPage = totalPages;
    if (locPage < 1) locPage = 1;

    const start = (locPage - 1) * locPageSize;
    const end = Math.min(start + locPageSize, totalRows);
    const pageRows = rows.slice(start, end);

    const info = document.getElementById("locPageInfo");
    if (info) {
        info.textContent = totalRows === 0 ? "0 ჩანაწერი" : `გვერდი ${locPage} / ${totalPages} · ${start + 1}-${end} / ${totalRows}`;
    }

    if (pageRows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:var(--text-muted);">ლოკაციები არ მოიძებნა</td></tr>`;
        return;
    }

    tbody.innerHTML = pageRows.map((loc, idx) => `
        <tr onclick="openLocationDrawer('${escapeHtml(loc.std_code || loc.name)}')" style="cursor:pointer;">
            <td>${start + idx + 1}</td>
            <td style="font-weight:800; color:var(--primary);">${escapeHtml(loc.name || loc.std_code)}</td>
            <td>${escapeHtml(loc.bank || "-")}</td>
            <td>${loc.bay}</td>
            <td>${loc.level}</td>
            <td style="font-weight:700;">${formatNum(loc.qty)}</td>
            <td>${formatNum(loc.score)} / ${formatNum(loc.limit)}</td>
            <td><span class="badge badge-${loc.status}">${escapeHtml(loc.status_label)}</span></td>
            <td>${escapeHtml((loc.categories || []).join(", "))}</td>
        </tr>
    `).join("");
}

function prevLocPage() {
    locPage = Math.max(1, locPage - 1);
    renderLocationsTable();
}

function nextLocPage() {
    locPage += 1;
    renderLocationsTable();
}

// ==========================================
// Scores View Tab
// ==========================================
function renderScoresView() {
    const txt1 = document.getElementById("scoresText");
    const txt2 = document.getElementById("scoresText2");
    if (txt1) txt1.value = state.scores_text || "";
    if (txt2) txt2.value = state.scores_text || "";

    const tbody = document.getElementById("scoresTableBody");
    if (!tbody) return;

    const entries = Object.entries(state.scores || {}).sort((a, b) => a[0].localeCompare(b[0]));
    if (entries.length === 0) {
        tbody.innerHTML = `<tr><td colspan="2" style="text-align:center; padding:20px; color:var(--text-muted);">ქულები ცარიელია</td></tr>`;
        return;
    }

    tbody.innerHTML = entries.map(([cat, score]) => `
        <tr>
            <td style="font-weight:700;">${escapeHtml(cat)}</td>
            <td style="font-weight:800; color:var(--primary);">${score === null ? "N/A" : formatNum(score)}</td>
        </tr>
    `).join("");
}

function saveScoresFromTab() {
    const txt = document.getElementById("scoresText2")?.value || "";
    const scores = parseScoresFromText(txt);

    showStatusBanner("ქულები ინახება...", "warn");
    fetch("/save_scores_manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scores)
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        reloadData();
        showStatusBanner("ქულები წარმატებით შეინახა და რუკა განახლდა!", "success");
    })
    .catch(err => {
        showStatusBanner("შენახვის შეცდომა: " + err.message, "error");
    });
}

function parseScoresFromText(text) {
    const scores = {};
    (text || "").split(/\r?\n/).forEach(line => {
        line = line.trim();
        if (!line) return;
        let cat = "", val = "";
        if (line.includes(":")) {
            const idx = line.indexOf(":");
            cat = line.slice(0, idx).trim();
            val = line.slice(idx + 1).trim();
        } else if (line.includes("\t")) {
            const parts = line.split("\t");
            cat = parts.slice(0, -1).join(" ").trim();
            val = parts[parts.length - 1].trim();
        } else {
            const parts = line.split(/\s+/);
            val = parts.pop();
            cat = parts.join(" ").trim();
        }

        if (cat && ["N/A", "NA", "NONE"].includes(String(val).toUpperCase())) {
            scores[cat] = null;
        } else {
            const num = parseFloat(String(val).replace(",", "."));
            if (cat && !isNaN(num)) scores[cat] = num;
        }
    });
    return scores;
}

// ==========================================
// Excel Upload & Build Modal
// ==========================================
function openUploadModal() {
    const m = document.getElementById("uploadModal");
    if (m) m.classList.add("active");
}

function closeUploadModal() {
    const m = document.getElementById("uploadModal");
    if (m) m.classList.remove("active");
}

function executeBuild() {
    const fd = new FormData();
    const locFile = document.getElementById("modalLocationsFile")?.files[0];
    const invFile = document.getElementById("modalInventoryFile")?.files[0];
    const catFile = document.getElementById("modalCatalogFile")?.files[0];
    const scoresTxt = document.getElementById("modalScoresText")?.value || "";

    if (!locFile && !invFile && !catFile && !scoresTxt) {
        alert("გთხოვთ აირჩიოთ ასატვირთი ფაილი ან შეიყვანოთ ქულები.");
        return;
    }

    if (locFile) fd.append("locations_file", locFile);
    if (invFile) fd.append("inventory_file", invFile);
    if (catFile) fd.append("catalog_file", catFile);
    if (scoresTxt) fd.append("scores_text", scoresTxt);

    const btn = document.getElementById("buildSubmitBtn");
    if (btn) {
        btn.disabled = true;
        btn.textContent = "⏳ მუშავდება...";
    }

    showStatusBanner("ფაილები მუშავდება... გთხოვთ დაელოდოთ.", "warn");

    fetch("/api/build", {
        method: "POST",
        body: fd
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            showStatusBanner("შეცდომა: " + data.error, "error");
            return;
        }
        state = data;
        selectedBank = "";
        viewMode = "floor";
        renderStats();
        populateBankSelector();
        renderScoresView();
        renderActiveMapView();
        closeUploadModal();
        showStatusBanner((data.messages || ["მონაცემები წარმატებით განახლდა!"]).join("\n"), "success");
    })
    .catch(err => {
        showStatusBanner("რუკის აგება ვერ მოხერხდა: " + err.message, "error");
    })
    .finally(() => {
        if (btn) {
            btn.disabled = false;
            btn.textContent = "🚀 რუკის აგება";
        }
    });
}

// ==========================================
// Filtering & Search Helpers
// ==========================================
function filterLocations(locations) {
    let rows = [...(locations || [])];
    if (selectedBank) {
        rows = rows.filter(l => (l.bank || "") === selectedBank);
    }
    if (onlyOccupied) {
        rows = rows.filter(l => Number(l.qty || 0) > 0);
    }
    if (selectedColor) {
        rows = rows.filter(l => (l.status || "gray") === selectedColor);
    }
    if (searchQuery) {
        rows = rows.filter(l => locationMatchesSearch(l, searchQuery));
    }
    return rows;
}

function locationMatchesSearch(loc, search) {
    if (!search) return true;
    const name = String(loc.name || loc.std_code || "").toLowerCase();
    const bank = String(loc.bank || "").toLowerCase();
    const cats = (loc.categories || []).join(" ").toLowerCase();
    return name.includes(search) || bank.includes(search) || cats.includes(search);
}

function sortLocations(rows) {
    const statusOrder = { green: 0, yellow: 1, red: 2, gray: 3 };
    return [...rows].sort((a, b) => {
        if (sortMode === "qty_desc") return Number(b.qty || 0) - Number(a.qty || 0);
        if (sortMode === "qty_asc") return Number(a.qty || 0) - Number(b.qty || 0);
        if (sortMode === "score_desc") return Number(b.score || 0) - Number(a.score || 0);
        if (sortMode === "score_asc") return Number(a.score || 0) - Number(b.score || 0);
        if (sortMode === "status") {
            const sa = statusOrder[a.status || "gray"] ?? 99;
            const sb = statusOrder[b.status || "gray"] ?? 99;
            if (sa !== sb) return sa - sb;
        }
        if ((a.bank || "") !== (b.bank || "")) return String(a.bank || "").localeCompare(String(b.bank || ""));
        if ((a.bay || 0) !== (b.bay || 0)) return Number(a.bay || 0) - Number(b.bay || 0);
        return Number(a.level || 0) - Number(b.level || 0);
    });
}

function toggleOnlyOccupied() {
    onlyOccupied = !onlyOccupied;
    const btn = document.getElementById("onlyOccupiedBtn");
    if (btn) {
        btn.textContent = `🟢 მხოლოდ დაკავებული: ${onlyOccupied ? "ON" : "OFF"}`;
        btn.classList.toggle("btn-primary", onlyOccupied);
    }
    scheduleRender();
}

function saveCurrentMap() {
    fetch("/save_map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locations: state.locations || [] })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) showStatusBanner(data.error, "error");
        else showStatusBanner("რუკა წარმატებით შეინახა!", "success");
    })
    .catch(err => {
        showStatusBanner("შენახვის შეცდომა: " + err.message, "error");
    });
}

// ==========================================
// Utilities
// ==========================================
function formatNum(value) {
    const n = Number(value || 0);
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function escapeHtml(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function setElText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function showStatusBanner(text, type = "success") {
    const el = document.getElementById("statusBanner");
    if (!el) return;
    el.style.display = "block";
    el.className = `status-banner ${type}`;
    el.textContent = text;
    if (type === "success") {
        setTimeout(() => { el.style.display = "none"; }, 6000);
    }
}

function hideStatusBanner() {
    const el = document.getElementById("statusBanner");
    if (el && el.className.includes("warn")) {
        el.style.display = "none";
    }
}
