// ==========================================================================
// Controlador Principal y Router SPA (src/main.js)
// ==========================================================================

import { 
    initDatabase, 
    dbResetTransactions,
    dbInventario,
    dbCategorias,
    dbAreas
} from './db.js';

import { 
    initAuth, 
    openUserModal, 
    closeUserModal, 
    currentUser, 
    handleLogin, 
    handleLogout, 
    handleForcePasswordChange, 
    handleOwnPasswordChange, 
    handleCreateUser, 
    handleEliminarUsuario, 
    applyRoleRestrictions,
    closeEditUserModal,
    saveEditUser
} from './auth.js';

import { 
    updateDashboardStats, 
    renderInventoryTable, 
    filterInventoryTable, 
    openNewEPPModal, 
    closeNewEPPModal, 
    saveNewEPP, 
    populateCategoryDropdowns, 
    openCategoryModal, 
    closeCategoryModal, 
    saveNewCategory, 
    exportStockCSV, 
    printStockReport,
    changeInventoryPage,
    changeInventoryPageSize,
    handleInventorySort,
    closeAdjustStockModal,
    saveAdjustStock,
    closeEditEPPModal,
    saveEditEPP
} from './inventory.js';

import { 
    setupInflowForm, 
    addInflowRow, 
    resetInflowForm, 
    saveInflow 
} from './inflow.js';

import { 
    setupOutflowForm, 
    addOutflowRow, 
    resetOutflowForm, 
    saveOutflowAndPrint, 
    showVoucherDetails, 
    closeVoucherModal, 
    printVoucher, 
    populateAreasDropdown, 
    openAreasModal, 
    closeAreasModal, 
    saveNewArea,
    clearSignatureCanvas,
    openTurnosModal,
    closeTurnosModal,
    saveNewTurno,
    populateTurnosDropdowns
} from './outflow.js';

import { 
    updateSuppliesStats, 
    renderSuppliesTable, 
    filterSuppliesTable, 
    openNewSupplyModal, 
    closeNewSupplyModal, 
    addNewSupplyItemRow, 
    saveNewSupply, 
    saveReceiveSupply, 
    closeReceiveSupplyModal 
} from './supplies.js';

import { 
    renderHistoryTable, 
    filterHistoryTable, 
    exportHistoryCSV,
    changeHistoryPage,
    changeHistoryPageSize,
    renderStockAuditTable
} from './reports.js';

import { searchWorkerProfile } from './workers.js';
import { renderAnalyticsDashboard } from './analytics.js';
import { 
    initReplenishment, 
    updateReplenishmentStats, 
    renderReplenishmentsTable 
} from './replenishment.js';
 
import { initLoans, renderLoansTable } from './loans.js';
import { initSettingsView } from './settings.js';
import { initReconciliationView } from './reconciliation.js';
import {
    initGuiasView,
    updateGuiasDashboardStats,
    renderGuiasTable,
    filterGuiasByState,
    handleGuiasSearch,
    changeGuiasPage,
    changeGuiasPageSize,
    openNewGuiaModal,
    closeNewGuiaModal,
    addWizardItemRow,
    removeWizardItemRow,
    selectDestinoQuick,
    saveNewGuia,
    openGuiaDrawer,
    closeGuiaDrawer,
    cambiarEstadoDirecto,
    openEditGuiaModal,
    closeEditGuiaModal,
    addEditItemRow,
    saveEditGuia,
    openDeliverModal,
    closeDeliverModal,
    clearGuiaSignature,
    saveDeliverModal,
    openDeleteGuiaModal,
    closeDeleteGuiaModal,
    confirmDeleteGuia,
    openPrintRemitoModal,
    closePrintRemitoModal,
    printRemito,
    exportGuiasCSV
} from './guias.js';
 
import { showToast, setCurrentDates, showConfirmDialog } from './utils.js';

// Inicializar la aplicación al cargar el DOM (Asíncrono para Supabase)
document.addEventListener("DOMContentLoaded", async () => {
    showToast("Conectando con Supabase...", "info");
    
    // Inicializar autenticación de inmediato para registrar eventos UI y Login
    initAuth();
    
    // Inicializar base de datos de manera segura
    try {
        await initDatabase();
        populateCategoryDropdowns();
        populateAreasDropdown();
        populateTurnosDropdowns();
        setupInflowForm();
        setupOutflowForm();
        setCurrentDates();
        initReplenishment();
        initLoans();
        await initGuiasView();
 
        // Renderizar vistas iniciales
        updateDashboardStats();
        renderInventoryTable();
        renderHistoryTable();
        updateReplenishmentStats();

        showToast("Base de datos cargada correctamente.", "success");
    } catch (dbError) {
        console.error("Error al cargar la base de datos:", dbError);
        showToast("Error de conexión a la base de datos. Verifique su conexión.", "danger");
    }

    // Aplicar tema guardado en localStorage
    if (localStorage.getItem("theme") === "light") {
        document.body.classList.remove("dark-mode");
        document.body.classList.add("light-mode");
        const themeSwitch = document.getElementById("theme-switch");
        if (themeSwitch) themeSwitch.checked = false;
    }
});

// SPA view router
function switchView(viewId, targetParam = null) {
    toggleMobileSidebar(false);
    document.querySelectorAll(".view-panel").forEach(panel => {
        panel.classList.remove("active");
    });
    
    document.querySelectorAll(".nav-item").forEach(item => {
        item.classList.remove("active");
    });

    const selectedPanel = document.getElementById(viewId);
    if (selectedPanel) selectedPanel.classList.add("active");

    const selectedNavItem = document.querySelector(`.nav-item[data-view="${viewId}"]`);
    if (selectedNavItem) selectedNavItem.classList.add("active");

    const viewTitle = document.getElementById("view-title");
    const viewSubtitle = document.getElementById("view-subtitle");

    if (!viewTitle || !viewSubtitle) return;

    switch(viewId) {
        case "view-inventory":
            viewTitle.textContent = "Inventario de Stock";
            viewSubtitle.textContent = "Supervise los niveles de equipo de protección personal disponibles.";
            renderInventoryTable();
            updateDashboardStats();
            break;
        case "view-inflow":
            viewTitle.textContent = "Ingreso de EPP (Entradas por Guía)";
            viewSubtitle.textContent = "Registre guías de despacho o actas de recepción para aumentar el inventario.";
            setCurrentDates();
            break;
        case "view-outflow":
            viewTitle.textContent = "Entrega de EPP (Salidas)";
            viewSubtitle.textContent = "Asigne equipos a colaboradores y registre la firma de conformidad.";
            break;
        case "view-loans":
            viewTitle.textContent = "Préstamos y Retornos de Equipos";
            viewSubtitle.textContent = "Registre el préstamo y devolución diaria de radios, detectores Dräger, linternas y otros.";
            renderLoansTable();
            break;
        case "view-supplies":
            viewTitle.textContent = "Requerimientos de Personal";
            viewSubtitle.textContent = "Gestión de requerimientos del personal, control de SLA y entregas de repuestos o EPP.";
            renderSuppliesTable();
            updateSuppliesStats();
            break;
        case "view-workers":
            viewTitle.textContent = "Ficha de Colaborador";
            viewSubtitle.textContent = "Consulte el historial de EPP activos y entregas firmadas del trabajador.";
            const workerSearchInput = document.getElementById("worker-search-rut");
            const workerProfileContainer = document.getElementById("worker-profile-container");
            if (targetParam) {
                if (workerSearchInput) {
                    workerSearchInput.value = targetParam;
                }
                searchWorkerProfile();
            } else {
                if (workerSearchInput) {
                    workerSearchInput.value = "";
                }
                if (workerProfileContainer) {
                    workerProfileContainer.style.display = "none";
                }
            }
            break;
        case "view-analytics":
            viewTitle.textContent = "Analíticas de EPP";
            viewSubtitle.textContent = "Monitoree el consumo de EPP, desvíos y cumplimiento de SLA.";
            renderAnalyticsDashboard();
            break;
        case "view-guias":
            viewTitle.textContent = "Guías de Despacho";
            viewSubtitle.textContent = "Control integral de remitos de carga, transporte y recepción conforme.";
            updateGuiasDashboardStats();
            renderGuiasTable();
            break;
        case "view-reports":
            viewTitle.textContent = "Historial y Reportes";
            viewSubtitle.textContent = "Consulte y exporte el historial de transacciones, auditoría y conciliación semanal de stock.";
            renderHistoryTable();
            renderStockAuditTable();
            initReconciliationView();
            break;
        case "view-replenishments":
            viewTitle.textContent = "Solicitudes de Compra y Abastecimiento";
            viewSubtitle.textContent = "Control de pedidos de reposición por quiebres o stock mínimo.";
            renderReplenishmentsTable();
            updateReplenishmentStats();
            break;
        case "view-settings":
            viewTitle.textContent = "Configuración del Sistema";
            viewSubtitle.textContent = "Acciones administrativas y control de seguridad de la base de datos.";
            applyRoleRestrictions();
            initSettingsView();
            break;
    }
}

function toggleTheme() {
    const isChecked = document.getElementById("theme-switch").checked;
    if (isChecked) {
        document.body.classList.remove("light-mode");
        document.body.classList.add("dark-mode");
        localStorage.setItem("theme", "dark");
    } else {
        document.body.classList.remove("dark-mode");
        document.body.classList.add("light-mode");
        localStorage.setItem("theme", "light");
    }
}

async function confirmResetDatabase() {
    if (!currentUser || currentUser.rol !== "Administrador") {
        showToast("Acceso denegado: Se requiere rango exclusivo de Administrador para reiniciar la base de datos.", "danger");
        return;
    }
    
    const confirmReset = await showConfirmDialog(
        "Reiniciar Base de Datos",
        "¿Está seguro de reiniciar la base de datos de bodega? Se borrarán todos los ingresos, salidas y firmas registradas."
    );
    if (!confirmReset) return;

    showToast("Restableciendo transacciones en Supabase...", "info");
    try {
        await dbResetTransactions();
        
        updateDashboardStats();
        renderInventoryTable();
        renderHistoryTable();
        resetInflowForm();
        resetOutflowForm();
        showToast("Bodega reiniciada correctamente en la nube.", "success");
        
        // Volver a cargar la vista
        switchView("view-settings");
    } catch (error) {
        showToast("Error al reiniciar la bodega: " + error.message, "danger");
    }
}

// Vincular funciones al objeto global 'window' para no romper los handlers inline del index.html
window.switchView = switchView;
window.toggleTheme = toggleTheme;
window.confirmResetDatabase = confirmResetDatabase;

window.openNewEPPModal = openNewEPPModal;
window.closeNewEPPModal = closeNewEPPModal;
window.saveNewEPP = (event) => saveNewEPP(event, () => { setupInflowForm(); setupOutflowForm(); });
window.filterInventoryTable = filterInventoryTable;
window.exportStockCSV = exportStockCSV;
window.printStockReport = printStockReport;

window.openCategoryModal = openCategoryModal;
window.closeCategoryModal = closeCategoryModal;
window.saveNewCategory = saveNewCategory;

window.addInflowRow = addInflowRow;
window.resetInflowForm = resetInflowForm;
window.saveInflow = (event) => saveInflow(event, switchView);

window.addOutflowRow = addOutflowRow;
window.resetOutflowForm = resetOutflowForm;
window.clearSignatureCanvas = clearSignatureCanvas;
window.saveOutflowAndPrint = (event) => saveOutflowAndPrint(event, (outflow) => {
    renderInventoryTable();
    renderHistoryTable();
    updateDashboardStats();
    
    // Si hay un requerimiento activo que se estaba despachando, cerrarlo
    if (window.activeDispatchRequirementId && window.resolveRequirementOnDelivery) {
        window.resolveRequirementOnDelivery(window.activeDispatchRequirementId);
    }
});
window.closeVoucherModal = closeVoucherModal;
window.printVoucher = printVoucher;

window.openAreasModal = openAreasModal;
window.closeAreasModal = closeAreasModal;
window.saveNewArea = saveNewArea;

window.openTurnosModal = openTurnosModal;
window.closeTurnosModal = closeTurnosModal;
window.saveNewTurno = saveNewTurno;

window.filterSuppliesTable = filterSuppliesTable;
window.openNewSupplyModal = openNewSupplyModal;
window.closeNewSupplyModal = closeNewSupplyModal;
window.addNewSupplyItemRow = addNewSupplyItemRow;
window.saveNewSupply = saveNewSupply;
window.closeReceiveSupplyModal = closeReceiveSupplyModal;
window.saveReceiveSupply = (event) => saveReceiveSupply(event, () => {
    renderHistoryTable();
});

window.openUserModal = openUserModal;
window.closeUserModal = closeUserModal;
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
window.handleForcePasswordChange = handleForcePasswordChange;
window.handleOwnPasswordChange = handleOwnPasswordChange;
window.handleCreateUser = handleCreateUser;
window.deleteSystemUser = handleEliminarUsuario;
window.closeEditUserModal = closeEditUserModal;
window.saveEditUser = saveEditUser;

window.filterHistoryTable = filterHistoryTable;
window.exportHistoryCSV = exportHistoryCSV;

window.searchWorkerProfile = searchWorkerProfile;
window.renderAnalyticsDashboard = renderAnalyticsDashboard;

function toggleMobileSidebar(show) {
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebar-overlay");
    if (sidebar && overlay) {
        if (show) {
            sidebar.classList.add("active");
            overlay.classList.add("active");
        } else {
            sidebar.classList.remove("active");
            overlay.classList.remove("active");
        }
    }
}

window.toggleMobileSidebar = toggleMobileSidebar;
window.changeInventoryPage = changeInventoryPage;
window.changeInventoryPageSize = changeInventoryPageSize;
window.changeHistoryPage = changeHistoryPage;
window.changeHistoryPageSize = changeHistoryPageSize;

window.handleInventorySort = handleInventorySort;
window.closeAdjustStockModal = closeAdjustStockModal;
window.saveAdjustStock = saveAdjustStock;
window.closeEditEPPModal = closeEditEPPModal;
window.saveEditEPP = saveEditEPP;
window.showConfirmDialog = showConfirmDialog;

// ==========================================================================
// Window Bindings: Guías de Despacho
// ==========================================================================
window.filterGuiasByState = filterGuiasByState;
window.handleGuiasSearch = handleGuiasSearch;
window.changeGuiasPage = changeGuiasPage;
window.changeGuiasPageSize = changeGuiasPageSize;
window.openNewGuiaModal = openNewGuiaModal;
window.closeNewGuiaModal = closeNewGuiaModal;
window.addWizardItemRow = addWizardItemRow;
window.removeWizardItemRow = removeWizardItemRow;
window.selectDestinoQuick = selectDestinoQuick;
window.saveNewGuia = saveNewGuia;
window.openGuiaDrawer = openGuiaDrawer;
window.closeGuiaDrawer = closeGuiaDrawer;
window.cambiarEstadoDirecto = cambiarEstadoDirecto;
window.openEditGuiaModal = openEditGuiaModal;
window.closeEditGuiaModal = closeEditGuiaModal;
window.addEditItemRow = addEditItemRow;
window.saveEditGuia = saveEditGuia;
window.openDeliverModal = openDeliverModal;
window.closeDeliverModal = closeDeliverModal;
window.clearGuiaSignature = clearGuiaSignature;
window.saveDeliverModal = saveDeliverModal;
window.openDeleteGuiaModal = openDeleteGuiaModal;
window.closeDeleteGuiaModal = closeDeleteGuiaModal;
window.confirmDeleteGuia = confirmDeleteGuia;
window.openPrintRemitoModal = openPrintRemitoModal;
window.closePrintRemitoModal = closePrintRemitoModal;
window.printRemito = printRemito;
window.exportGuiasCSV = exportGuiasCSV;

