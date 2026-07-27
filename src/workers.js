// ==========================================================================
// Módulo de Ficha Histórica del Colaborador (src/workers.js)
// ==========================================================================

import { dbSalidas, dbInventario, dbAreas, dbTurnos, dbUpdateWorkerProfile } from './db.js';
import { formatRut, currentUser } from './auth.js';
import { showToast } from './utils.js';

let smartWorkerSearchInitialized = false;

export function setupSmartWorkerSearch() {
    const container = document.getElementById("worker-search-container");
    if (!container || smartWorkerSearchInitialized) return;

    const searchInput = document.getElementById("worker-search-rut");
    const dropdown = document.getElementById("worker-search-dropdown");
    const clearBtn = document.getElementById("worker-clear-icon");

    if (!searchInput || !dropdown) return;

    smartWorkerSearchInitialized = true;

    function renderDropdown(filterText = "") {
        const query = filterText.toLowerCase().trim();
        if (!query) {
            dropdown.innerHTML = "";
            dropdown.classList.remove("active");
            return;
        }

        const workersMap = {};
        dbSalidas.forEach(s => {
            if (s.rut && !workersMap[s.rut]) {
                workersMap[s.rut] = {
                    rut: s.rut,
                    nombre: s.trabajador || "Nombre no registrado",
                    area: s.area || "Sin Área",
                    turno: s.turno || "Turno A"
                };
            }
        });

        const workers = Object.values(workersMap);
        const matches = workers.filter(w => {
            const r = (w.rut || "").toLowerCase();
            const n = (w.nombre || "").toLowerCase();
            return r.includes(query) || n.includes(query);
        }).slice(0, 8);

        if (matches.length === 0) {
            dropdown.innerHTML = `<div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">No se encontraron colaboradores registrados.</div>`;
        } else {
            dropdown.innerHTML = matches.map(w => `
                <div class="epp-search-option" data-rut="${w.rut}">
                    <div class="epp-search-option-info">
                        <span class="epp-search-option-code">RUT: ${w.rut}</span>
                        <span class="epp-search-option-title">${w.nombre}</span>
                        <span class="epp-search-option-category"><i class="fa-solid fa-briefcase"></i> ${w.area} (${w.turno})</span>
                    </div>
                </div>
            `).join("");

            dropdown.querySelectorAll(".epp-search-option").forEach(opt => {
                opt.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const rut = opt.dataset.rut;
                    searchInput.value = rut;
                    if (clearBtn) clearBtn.style.display = "block";
                    dropdown.classList.remove("active");
                    searchWorkerProfile();
                });
            });
        }

        dropdown.classList.add("active");
    }

    searchInput.addEventListener("input", (e) => {
        let val = e.target.value;
        if (formatRut) {
            val = formatRut(val);
            e.target.value = val;
        }
        if (clearBtn) clearBtn.style.display = val ? "block" : "none";
        renderDropdown(val);
    });

    searchInput.addEventListener("focus", () => {
        if (searchInput.value.trim().length > 0) {
            renderDropdown(searchInput.value);
        }
    });

    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            searchInput.value = "";
            clearBtn.style.display = "none";
            dropdown.innerHTML = "";
            dropdown.classList.remove("active");
            const profileContainer = document.getElementById("worker-profile-container");
            if (profileContainer) profileContainer.style.display = "none";
            searchInput.focus();
        });
    }

    document.addEventListener("click", (e) => {
        if (!container.contains(e.target)) {
            dropdown.classList.remove("active");
        }
    });
}
window.setupSmartWorkerSearch = setupSmartWorkerSearch;

export function searchWorkerProfile() {
    setupSmartWorkerSearch();
    const rutInput = document.getElementById("worker-search-rut");
    if (!rutInput) return;
    const rut = rutInput.value.trim();

    if (!rut || rut.length < 5) {
        showToast("Por favor, ingrese un RUT válido para buscar.", "warning");
        return;
    }

    // Filtrar entregas del trabajador
    const workerDeliveries = dbSalidas.filter(s => s.rut === rut);
    const container = document.getElementById("worker-profile-container");

    if (workerDeliveries.length === 0) {
        showToast(`No se encontraron registros de entregas para el RUT ${rut}.`, "warning");
        if (container) container.style.display = "none";
        return;
    }

    // Mostrar contenedor
    if (container) container.style.display = "block";

    // Obtener información del colaborador de su entrega más reciente
    workerDeliveries.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    const recent = workerDeliveries[0];

    document.getElementById("w-profile-name").textContent = recent.trabajador || "Nombre no registrado";
    document.getElementById("w-profile-rut").textContent = `RUT: ${recent.rut}`;
    document.getElementById("w-profile-area").innerHTML = `<i class="fa-solid fa-briefcase"></i> ${recent.area || "Sin área asignada"}`;
    document.getElementById("w-profile-turno").textContent = recent.turno || "Turno A";

    const lastClothesDelivery = workerDeliveries.find(d => d.talla_ropa);
    const lastTalla = lastClothesDelivery ? lastClothesDelivery.talla_ropa : "No registra";
    const tallaEl = document.getElementById("w-profile-talla-ropa");
    if (tallaEl) tallaEl.innerHTML = `<i class="fa-solid fa-shirt"></i> Talla Ropa: ${lastTalla}`;

    // Mostrar/ocultar botón de edición según el rol (sólo Administrador)
    const editBtn = document.querySelector("#worker-profile-container .btn-secondary");
    if (editBtn) {
        if (currentUser && currentUser.rol === "Administrador") {
            editBtn.style.display = "flex";
        } else {
            editBtn.style.display = "none";
        }
    }

    // 1. Calcular EPPs Vigentes (Activos)
    // Agrupar por eppId y encontrar la última fecha de entrega de cada SKU
    const latestEPPDeliveries = {};
    workerDeliveries.forEach(del => {
        const delDate = new Date(del.fecha);
        del.items.forEach(item => {
            const eppId = item.eppId;
            const catalogEPP = dbInventario.find(i => i.id === eppId);
            const eppName = catalogEPP ? catalogEPP.nombre : "EPP Desconocido";
            const eppCode = catalogEPP ? catalogEPP.codigo : "N/A";
            if (!latestEPPDeliveries[eppId] || delDate > new Date(latestEPPDeliveries[eppId].fecha)) {
                latestEPPDeliveries[eppId] = {
                    fecha: del.fecha,
                    cantidad: item.cantidad,
                    nombre: eppName,
                    codigo: eppCode
                };
            }
        });
    });

    const eppsTbody = document.getElementById("worker-epps-tbody");
    if (eppsTbody) {
        eppsTbody.innerHTML = "";
        const activeEPPEntries = [];

        Object.keys(latestEPPDeliveries).forEach(eppId => {
            const deliveryInfo = latestEPPDeliveries[eppId];
            const epp = dbInventario.find(i => i.id === eppId);
            const lifespanMonths = (epp && epp.duracion_meses !== undefined && epp.duracion_meses !== null) ? Number(epp.duracion_meses) : 6;
            const lifespanDays = lifespanMonths * 30;

            const dateDelivered = new Date(deliveryInfo.fecha);
            const elapsedDays = Math.floor((new Date() - dateDelivered) / (1000 * 60 * 60 * 24));
            const remainingDays = lifespanDays - elapsedDays;

            // Se considera activo si aún le quedan días de vida útil
            if (remainingDays > 0) {
                const pct = Math.round((remainingDays / lifespanDays) * 100);
                
                let progressColor = "progress-fill-received"; // Verde
                let statusBadge = `<span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> Óptimo</span>`;
                
                if (pct < 30) {
                    progressColor = "progress-fill-pending"; // Rojo
                    statusBadge = `<span class="badge badge-danger"><i class="fa-solid fa-triangle-exclamation"></i> Por vencer</span>`;
                } else if (pct < 70) {
                    progressColor = "progress-fill-partial"; // Amarillo
                    statusBadge = `<span class="badge badge-warning"><i class="fa-solid fa-circle-exclamation"></i> Intermedio</span>`;
                }

                activeEPPEntries.push({
                    codigo: deliveryInfo.codigo || "N/A",
                    nombre: deliveryInfo.nombre,
                    fecha: dateDelivered.toLocaleDateString('es-CL'),
                    sugerido: `${lifespanMonths} meses (${lifespanDays} días)`,
                    elapsed: `Hace ${elapsedDays} d. (Quedan ${remainingDays} d.)`,
                    pct: pct,
                    progressColor: progressColor,
                    statusBadge: statusBadge
                });
            }
        });

        if (activeEPPEntries.length === 0) {
            eppsTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">El colaborador no posee EPP vigentes (todos expirados o sin entregas).</td></tr>`;
        } else {
            activeEPPEntries.forEach(entry => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>
                        <span style="font-family: monospace; font-size: 0.72rem; color: var(--text-muted); display: block; font-weight: 600;">${entry.codigo}</span>
                        <strong>${entry.nombre}</strong>
                    </td>
                    <td>${entry.fecha}</td>
                    <td style="text-align: center;">${entry.sugerido}</td>
                    <td>
                        <div class="supply-progress-container">
                            <div style="display:flex; justify-content:space-between; font-size:0.75rem; font-weight:600;">
                                <span>${entry.elapsed}</span>
                                <span>${entry.pct}%</span>
                            </div>
                            <div class="supply-progress-bar">
                                <div class="supply-progress-fill ${entry.progressColor}" style="width:${entry.pct}%;"></div>
                            </div>
                        </div>
                    </td>
                    <td>${entry.statusBadge}</td>
                `;
                eppsTbody.appendChild(tr);
            });
        }
    }

    // 2. Renderizar Historial de Entregas Firmadas
    const historyTbody = document.getElementById("worker-history-tbody");
    if (historyTbody) {
        historyTbody.innerHTML = "";
        
        workerDeliveries.forEach(del => {
            const itemsText = del.items.map(it => {
                const catalogEPP = dbInventario.find(i => i.id === it.eppId);
                const eppName = catalogEPP ? catalogEPP.nombre : "EPP Desconocido";
                const eppCode = catalogEPP ? catalogEPP.codigo : "???";
                return `[${eppCode}] ${eppName} (x${it.cantidad})`;
            }).join(", ");
            const hasSignature = del.firma && del.firma.startsWith("data:");
            const signatureHTML = hasSignature 
                ? `<img src="${del.firma}" alt="Firma" style="max-height: 28px; background: #fff; border-radius: var(--radius-sm); border: 1px solid var(--border-color); padding: 2px;">` 
                : `<span style="font-size:0.72rem; color:var(--text-muted);">Física / Acta</span>`;

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${new Date(del.fecha).toLocaleDateString('es-CL')}</strong></td>
                <td>${del.registrado_por || del.registradoPor || "Sistema"}</td>
                <td><span class="badge" style="background: rgba(30, 144, 255, 0.1); color: #1e90ff;"><i class="fa-solid fa-briefcase"></i> ${del.area || "N/A"}</span></td>
                <td><span class="badge" style="background: rgba(255, 122, 0, 0.1); color: var(--color-primary);"><i class="fa-solid fa-clock"></i> ${del.turno || recent.turno || "Turno A"}</span></td>
                <td style="font-size: 0.8rem; color: var(--text-secondary); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${itemsText}">${itemsText}</td>
                <td style="text-align: center;">${signatureHTML}</td>
                <td style="text-align: center;">
                    <button class="btn btn-secondary btn-sm w-profile-view-voucher" data-id="${del.id}" title="Ver Vale de Entrega">
                        <i class="fa-solid fa-file-invoice text-primary"></i> Vale
                    </button>
                </td>
            `;
            historyTbody.appendChild(tr);
        });

        // Configurar clics del botón vale
        historyTbody.querySelectorAll(".w-profile-view-voucher").forEach(button => {
            button.addEventListener("click", () => {
                if (window.showVoucherDetailsById) {
                    window.showVoucherDetailsById(button.dataset.id);
                }
            });
        });
    }
}
window.searchWorkerProfile = searchWorkerProfile;

export function openEditWorkerModal() {
    const rutInput = document.getElementById("worker-search-rut");
    if (!rutInput) return;
    const rut = rutInput.value.trim();

    if (!rut) {
        showToast("Busque un colaborador antes de editar sus datos.", "warning");
        return;
    }

    const workerDeliveries = dbSalidas.filter(s => s.rut === rut);
    if (workerDeliveries.length === 0) {
        showToast("No se encontraron registros de entregas para este RUT.", "warning");
        return;
    }

    // Obtener información más reciente
    workerDeliveries.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    const recent = workerDeliveries[0];

    const modal = document.getElementById("edit-worker-modal");
    const editRut = document.getElementById("edit-worker-profile-rut");
    const editName = document.getElementById("edit-worker-profile-name");
    const editArea = document.getElementById("edit-worker-profile-area");
    const editTurno = document.getElementById("edit-worker-profile-turno");

    if (editRut) editRut.value = recent.rut;
    if (editName) editName.value = recent.trabajador || "";

    // Poblar Areas select
    if (editArea) {
        editArea.innerHTML = `<option value="" disabled>Seleccione área...</option>`;
        dbAreas.forEach(a => {
            const opt = document.createElement("option");
            opt.value = a;
            opt.textContent = a;
            if (a === recent.area) opt.selected = true;
            editArea.appendChild(opt);
        });
    }

    // Poblar Turnos select
    if (editTurno) {
        editTurno.innerHTML = `<option value="" disabled>Seleccione turno...</option>`;
        dbTurnos.forEach(t => {
            const opt = document.createElement("option");
            opt.value = t;
            opt.textContent = t;
            if (t === recent.turno) opt.selected = true;
            editTurno.appendChild(opt);
        });
    }

    if (modal) modal.classList.add("active");
}

export function closeEditWorkerModal() {
    const modal = document.getElementById("edit-worker-modal");
    if (modal) modal.classList.remove("active");
}

export async function saveEditWorker(event) {
    event.preventDefault();
    const rut = document.getElementById("edit-worker-profile-rut").value;
    const name = document.getElementById("edit-worker-profile-name").value.trim();
    const area = document.getElementById("edit-worker-profile-area").value;
    const turno = document.getElementById("edit-worker-profile-turno").value;

    try {
        showToast("Actualizando datos del colaborador...", "info");
        await dbUpdateWorkerProfile(rut, {
            trabajador: name,
            area: area,
            turno: turno
        });

        closeEditWorkerModal();
        
        // Refrescar ficha del colaborador actual
        searchWorkerProfile();
        
        showToast("Datos de colaborador actualizados correctamente.", "success");
    } catch (error) {
        console.error(error);
        showToast("Error al actualizar datos del colaborador: " + error.message, "danger");
    }
}

window.openEditWorkerModal = openEditWorkerModal;
window.closeEditWorkerModal = closeEditWorkerModal;
window.saveEditWorker = saveEditWorker;
