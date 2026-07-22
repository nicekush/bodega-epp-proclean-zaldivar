// ==========================================================================
// Control de Usuarios y Sesión (RBAC con RUT y Clave) - src/auth.js
// ==========================================================================

import { showToast, showConfirmDialog } from './utils.js';
import { 
    dbVerificarCredenciales, 
    dbObtenerUsuarios, 
    dbCrearUsuario, 
    dbActualizarPassword, 
    dbActualizarUsuario,
    dbEliminarUsuario 
} from './db.js';

export let currentUser = null;


// Inicializa la sesión del usuario al cargar la página
export function initAuth() {
    // Formatear dinámicamente el RUT en el campo de login
    const loginRutInput = document.getElementById("login-rut");
    if (loginRutInput) {
        loginRutInput.addEventListener("input", (e) => {
            e.target.value = formatRut(e.target.value);
        });
    }

    // Formatear dinámicamente el RUT en el campo de crear usuario
    const newUserRutInput = document.getElementById("new-user-rut");
    if (newUserRutInput) {
        newUserRutInput.addEventListener("input", (e) => {
            e.target.value = formatRut(e.target.value);
        });
    }

    const savedUser = localStorage.getItem("epp_active_user");
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        hideLoginOverlay();
        applyRoleRestrictions();
        updateDisplayUser();
        window.scrollTo({ top: 0, behavior: 'instant' });
    } else {
        showLoginOverlay();
    }
}

// Formatear RUT Chileno dinámicamente (ej: 12.345.678-9 o 12345678-9)
export function formatRut(rut) {
    // Limpiar caracteres no permitidos
    let value = rut.replace(/[^0-9kK]/g, '');
    if (value.length <= 1) return value;
    
    // Extraer cuerpo y dígito verificador
    let body = value.slice(0, -1);
    let dv = value.slice(-1).toUpperCase();
    
    // Formatear cuerpo con puntos
    let formattedBody = "";
    while (body.length > 3) {
        formattedBody = "." + body.slice(-3) + formattedBody;
        body = body.slice(0, -3);
    }
    formattedBody = body + formattedBody;
    
    return `${formattedBody}-${dv}`;
}

export function showLoginOverlay() {
    const overlay = document.getElementById("login-overlay");
    if (overlay) overlay.classList.add("active");
}

export function hideLoginOverlay() {
    const overlay = document.getElementById("login-overlay");
    if (overlay) overlay.classList.remove("active");
}

export function openUserModal() {
    if (!currentUser) return;
    const modal = document.getElementById("user-modal");
    if (modal) modal.classList.add("active");
    
    // Rellenar perfil
    const nameEl = document.getElementById("profile-display-name");
    const rutEl = document.getElementById("profile-display-rut");
    const roleEl = document.getElementById("profile-display-role");
    
    if (nameEl) nameEl.textContent = currentUser.nombre;
    if (rutEl) rutEl.textContent = `RUT: ${currentUser.rut}`;
    if (roleEl) roleEl.textContent = currentUser.rol;
}

export function closeUserModal() {
    const modal = document.getElementById("user-modal");
    if (modal) modal.classList.remove("active");
}

// Acción de iniciar sesión
export async function handleLogin(event) {
    event.preventDefault();
    const rut = document.getElementById("login-rut").value.trim();
    const password = document.getElementById("login-password").value;
    console.log("Iniciando login con RUT:", rut);
    
    try {
        showToast("Verificando credenciales...", "info");
        console.log("Llamando a dbVerificarCredenciales...");
        const res = await dbVerificarCredenciales(rut, password);
        console.log("Resultado del servidor:", res);
        
        if (res && res.success) {
            console.log("Credenciales correctas. ¿Cambio pendiente?", res.cambio_clave_pendiente);
            if (res.cambio_clave_pendiente) {
                currentUser = { rut: res.rut, nombre: res.nombre, rol: res.rol };
                openForcePasswordModal();
            } else {
                currentUser = { rut: res.rut, nombre: res.nombre, rol: res.rol };
                localStorage.setItem("epp_active_user", JSON.stringify(currentUser));
                hideLoginOverlay();
                applyRoleRestrictions();
                updateDisplayUser();
                window.scrollTo({ top: 0, behavior: 'instant' });
                showToast(`¡Bienvenido de vuelta, ${res.nombre}!`, "success");
            }
        } else {
            console.warn("Respuesta de éxito false del servidor:", res);
            showToast("RUT o contraseña incorrectos.", "danger");
        }
    } catch (e) {
        console.error("EXCEPCIÓN EN HANDLELOGIN:", e);
        showToast("Error de conexión al iniciar sesión.", "danger");
    }
}

// Cerrar sesión
export function handleLogout() {
    currentUser = null;
    localStorage.removeItem("epp_active_user");
    closeUserModal();
    
    // Limpiar inputs de login
    const loginForm = document.getElementById("login-form");
    if (loginForm) loginForm.reset();
    
    showLoginOverlay();
    showToast("Sesión cerrada correctamente.", "info");
}

// Cambio de contraseña forzado
function openForcePasswordModal() {
    console.log("Abriendo force-password-modal...");
    const modal = document.getElementById("force-password-modal");
    if (modal) {
        modal.classList.add("active");
        modal.style.display = "flex"; // Forzar la visualización
        console.log("Clase 'active' añadida a force-password-modal.");
    }
    
    // Ocultar login overlay para que no se superponga
    hideLoginOverlay();
}

function closeForcePasswordModal() {
    const modal = document.getElementById("force-password-modal");
    if (modal) {
        modal.classList.remove("active");
        modal.style.display = "none";
    }
}

export async function handleForcePasswordChange(event) {
    event.preventDefault();
    const newPass = document.getElementById("new-force-password").value;
    const confirmPass = document.getElementById("confirm-force-password").value;
    
    if (newPass !== confirmPass) {
        showToast("Las contraseñas no coinciden.", "danger");
        return;
    }
    
    try {
        showToast("Actualizando contraseña...", "info");
        const success = await dbActualizarPassword(currentUser.rut, newPass);
        if (success) {
            localStorage.setItem("epp_active_user", JSON.stringify(currentUser));
            closeForcePasswordModal();
            hideLoginOverlay();
            applyRoleRestrictions();
            updateDisplayUser();
            showToast("Contraseña actualizada con éxito. Bienvenido.", "success");
        } else {
            showToast("No se pudo actualizar la contraseña.", "danger");
        }
    } catch (e) {
        console.error(e);
        showToast("Error de conexión al guardar nueva contraseña.", "danger");
    }
}

// Cambio de contraseña voluntaria
export async function handleOwnPasswordChange(event) {
    event.preventDefault();
    const newPass = document.getElementById("my-new-password").value;
    
    try {
        showToast("Actualizando contraseña...", "info");
        const success = await dbActualizarPassword(currentUser.rut, newPass);
        if (success) {
            document.getElementById("change-my-password-form").reset();
            closeUserModal();
            showToast("Contraseña cambiada con éxito.", "success");
        } else {
            showToast("No se pudo actualizar la contraseña.", "danger");
        }
    } catch (e) {
        console.error(e);
        showToast("Error al intentar cambiar la contraseña.", "danger");
    }
}

// Cargar la lista de usuarios en la tabla de administración
export async function renderUsersTable() {
    const tbody = document.getElementById("users-table-tbody");
    if (!tbody) return;
    
    try {
        const users = await dbObtenerUsuarios();
        tbody.innerHTML = "";
        
        users.forEach(user => {
            const tr = document.createElement("tr");
            
            const isPending = user.cambio_clave_pendiente;
            const badgeClass = isPending ? "warning" : "success";
            const badgeText = isPending ? "Pendiente Primer Inicio" : "Activa y Configurada";
            
            // Botón de eliminar deshabilitado para sí mismo
            const isSelf = user.rut === currentUser.rut;
            const deleteBtn = isSelf 
                ? `<button class="btn btn-danger-outline btn-sm" disabled style="opacity: 0.5; cursor: not-allowed;" title="No puedes eliminarte a ti mismo">Eliminar</button>`
                : `<button class="btn btn-danger-outline btn-sm delete-user-row-btn" data-rut="${user.rut}" data-nombre="${user.nombre}">Eliminar</button>`;
            
            const editBtn = `<button class="btn btn-secondary btn-sm edit-user-row-btn" data-rut="${user.rut}" data-nombre="${user.nombre}" data-rol="${user.rol}">Editar</button>`;

            tr.innerHTML = `
                <td><strong>${user.rut}</strong></td>
                <td>${user.nombre}</td>
                <td><span class="badge" style="background: var(--bg-tertiary); border: 1px solid var(--border-color); color: var(--text-primary); font-size: 0.75rem;">${user.rol}</span></td>
                <td><span class="badge ${badgeClass}" style="font-size: 0.75rem;">${badgeText}</span></td>
                <td style="text-align: center;">
                    <div style="display:flex; gap:8px; justify-content:center;">
                        ${editBtn}
                        ${deleteBtn}
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Event listeners
        tbody.querySelectorAll(".edit-user-row-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                openEditUserModal(btn.dataset.rut, btn.dataset.nombre, btn.dataset.rol);
            });
        });

        tbody.querySelectorAll(".delete-user-row-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                handleEliminarUsuario(btn.dataset.rut, btn.dataset.nombre);
            });
        });

    } catch (e) {
        console.error(e);
        showToast("Error al cargar la lista de usuarios.", "danger");
    }
}

// Modales de Edición de Usuario
export function openEditUserModal(rut, nombre, rol) {
    const modal = document.getElementById("edit-user-modal");
    const rutInput = document.getElementById("edit-user-rut");
    const rutDisplay = document.getElementById("edit-user-rut-display");
    const nameInput = document.getElementById("edit-user-name");
    const roleSelect = document.getElementById("edit-user-role");
    const passInput = document.getElementById("edit-user-new-password");

    if (rutInput) rutInput.value = rut;
    if (rutDisplay) rutDisplay.value = rut;
    if (nameInput) nameInput.value = nombre;
    if (roleSelect) roleSelect.value = rol;
    if (passInput) passInput.value = "";

    if (modal) modal.classList.add("active");
}

export function closeEditUserModal() {
    const modal = document.getElementById("edit-user-modal");
    if (modal) modal.classList.remove("active");
}

export async function saveEditUser(event) {
    event.preventDefault();
    const rut = document.getElementById("edit-user-rut").value;
    const nombre = document.getElementById("edit-user-name").value.trim();
    const rol = document.getElementById("edit-user-role").value;
    const password = document.getElementById("edit-user-new-password").value;

    try {
        showToast("Guardando cambios de operador...", "info");
        await dbActualizarUsuario(rut, nombre, rol, password);

        // Si se actualizan los datos del propio usuario con sesión activa
        if (currentUser && currentUser.rut === rut) {
            currentUser.nombre = nombre;
            currentUser.rol = rol;
            localStorage.setItem("epp_active_user", JSON.stringify(currentUser));
            updateDisplayUser();
            applyRoleRestrictions();
        }

        closeEditUserModal();
        await renderUsersTable();
        showToast("Datos de operador y permisos actualizados con éxito.", "success");
    } catch (error) {
        console.error("Error al actualizar operador:", error);
        showToast("Error al actualizar operador: " + (error.message || "Verifique las políticas de la base de datos."), "danger");
    }
}


// Crear un usuario nuevo (función del Admin)
export async function handleCreateUser(event) {
    event.preventDefault();
    if (!currentUser || currentUser.rol !== "Administrador") {
        showToast("Solo administradores pueden crear usuarios.", "danger");
        return;
    }
    
    const rut = document.getElementById("new-user-rut").value.trim();
    const nombre = document.getElementById("new-user-name").value.trim();
    const rol = document.getElementById("new-user-role").value;
    const password = document.getElementById("new-user-password").value;
    
    try {
        showToast("Creando usuario...", "info");
        await dbCrearUsuario({ rut, nombre, rol, password });
        document.getElementById("create-user-form").reset();
        await renderUsersTable();
        showToast(`Usuario ${nombre} creado con éxito.`, "success");
    } catch (e) {
        console.error(e);
        showToast("Error al crear el usuario. ¿RUT duplicado o falta de permisos?", "danger");
    }
}

// Eliminar usuario
export async function handleEliminarUsuario(rut, nombre) {
    if (!currentUser || currentUser.rol !== "Administrador") {
        showToast("Solo administradores pueden eliminar usuarios.", "danger");
        return;
    }

    if (currentUser.rut === rut) {
        showToast("No puedes eliminar tu propia cuenta en uso.", "warning");
        return;
    }
    
    const confirmDel = await showConfirmDialog(
        "Eliminar Usuario",
        `¿Está seguro de que desea eliminar permanentemente al operador ${nombre} (${rut})?`
    );
    if (!confirmDel) return;

    try {
        showToast("Eliminando usuario...", "info");
        await dbEliminarUsuario(rut);
        await renderUsersTable();
        showToast(`Usuario ${nombre} eliminado correctamente.`, "success");
    } catch (e) {
        console.error("Error al eliminar usuario:", e);
        showToast("Error al eliminar el usuario: " + (e.message || "Verifique restricciones RLS en Supabase."), "danger");
    }
}

// Restricciones de interfaz basadas en Roles de Usuario
export function applyRoleRestrictions() {
    if (!currentUser) return;
    
    const role = currentUser.rol;
    
    const userManagementCard = document.getElementById("user-management-card");
    const areaKitsManagementCard = document.getElementById("area-kits-management-card");
    const serialManagementCard = document.getElementById("serial-management-card");
    const reconciliationManagementCard = document.getElementById("reconciliation-management-card");
    const adminActionsContainer = document.getElementById("admin-actions-container");
    const adminDeniedMessage = document.getElementById("admin-denied-message");
    const adminCurrentRole = document.getElementById("admin-current-role");
    
    // Elementos de la barra de navegación lateral
    const navInflow = document.querySelector('.nav-item[data-view="view-inflow"]');
    const navLoans = document.querySelector('.nav-item[data-view="view-loans"]');
    const navSupplies = document.querySelector('.nav-item[data-view="view-supplies"]');
    const navSettings = document.querySelector('.nav-item[data-view="view-settings"]');
    const navReports = document.querySelector('.nav-item[data-view="view-reports"]');
    
    // Botones de acción del catálogo
    const btnNewEpp = document.getElementById("btn-new-epp");
    const btnManageCats = document.getElementById("btn-manage-cats");
    const btnManageAreas = document.getElementById("btn-manage-areas");
    
    // Ajustar visualización del rol en Configuración
    if (adminCurrentRole) adminCurrentRole.textContent = role;
    
    if (role === "Administrador") {
        // Administrador: Acceso total
        if (userManagementCard) userManagementCard.style.display = "block";
        if (areaKitsManagementCard) areaKitsManagementCard.style.display = "block";
        if (serialManagementCard) serialManagementCard.style.display = "block";
        if (reconciliationManagementCard) reconciliationManagementCard.style.display = "block";
        if (adminActionsContainer) adminActionsContainer.style.display = "flex";
        if (adminDeniedMessage) adminDeniedMessage.style.display = "none";
        
        // Mostrar todos los menús laterales
        if (navInflow) navInflow.style.display = "flex";
        if (navLoans) navLoans.style.display = "flex";
        if (navSupplies) navSupplies.style.display = "flex";
        if (navSettings) navSettings.style.display = "flex";
        if (navReports) navReports.style.display = "flex";
        
        // Mostrar botones de creación y gestión de catálogo
        if (btnNewEpp) btnNewEpp.style.display = "inline-flex";
        if (btnManageCats) btnManageCats.style.display = "inline-flex";
        if (btnManageAreas) btnManageAreas.style.display = "inline-flex";
        
        // Cargar tabla de usuarios
        renderUsersTable();
        
    } else if (role === "Supervisor") {
        // Supervisor: Acceso medio
        if (userManagementCard) userManagementCard.style.display = "none";
        if (areaKitsManagementCard) areaKitsManagementCard.style.display = "block";
        if (serialManagementCard) serialManagementCard.style.display = "block";
        if (reconciliationManagementCard) reconciliationManagementCard.style.display = "block";
        if (adminActionsContainer) adminActionsContainer.style.display = "none";
        if (adminDeniedMessage) adminDeniedMessage.style.display = "block";
        
        if (navInflow) navInflow.style.display = "flex";
        if (navLoans) navLoans.style.display = "flex";
        if (navSupplies) navSupplies.style.display = "flex";
        if (navSettings) navSettings.style.display = "flex";
        if (navReports) navReports.style.display = "flex";
        
        if (btnNewEpp) btnNewEpp.style.display = "inline-flex";
        if (btnManageCats) btnManageCats.style.display = "inline-flex";
        if (btnManageAreas) btnManageAreas.style.display = "inline-flex";
        
    } else if (role === "Bodeguero") {
        // Bodeguero: Operación acotada y esencial
        if (userManagementCard) userManagementCard.style.display = "none";
        if (areaKitsManagementCard) areaKitsManagementCard.style.display = "none";
        if (serialManagementCard) serialManagementCard.style.display = "none";
        if (reconciliationManagementCard) reconciliationManagementCard.style.display = "none";
        if (adminActionsContainer) adminActionsContainer.style.display = "none";
        if (adminDeniedMessage) adminDeniedMessage.style.display = "block";
        
        if (navSettings) navSettings.style.display = "flex"; 
        if (navReports) navReports.style.display = "none"; 
        if (navInflow) navInflow.style.display = "flex"; 
        if (navLoans) navLoans.style.display = "flex"; 
        if (navSupplies) navSupplies.style.display = "flex"; 
        
        if (btnNewEpp) btnNewEpp.style.display = "none";
        if (btnManageCats) btnManageCats.style.display = "none";
        if (btnManageAreas) btnManageAreas.style.display = "none";
        
        const activeNav = document.querySelector(".nav-item.active");
        if (activeNav && activeNav.getAttribute("data-view") === "view-reports") {
            const defaultNav = document.querySelector('.nav-item[data-view="view-inventory"]');
            if (defaultNav) defaultNav.click();
        }
    }
}

function updateDisplayUser() {
    const displayName = document.getElementById("display-user-name");
    const displayRole = document.getElementById("display-user-role");
    
    if (displayName && currentUser) displayName.textContent = currentUser.nombre;
    if (displayRole && currentUser) displayRole.textContent = currentUser.rol;
}
