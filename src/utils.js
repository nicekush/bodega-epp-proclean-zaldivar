// ==========================================================================
// Utilidades de Interfaz (Toasts, Fechas, Impresión)
// ==========================================================================

export function showToast(message, type = "success") {
    const container = document.getElementById("toast-container");
    if (!container) return;
    
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    
    let iconClass = "fa-circle-check";
    if (type === "danger") iconClass = "fa-circle-xmark";
    if (type === "warning") iconClass = "fa-triangle-exclamation";
    if (type === "info") iconClass = "fa-circle-info";

    toast.innerHTML = `
        <i class="fa-solid ${iconClass}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = "slideIn 0.3s reverse forwards";
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 4000);
}

export function setCurrentDates() {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(Date.now() - tzOffset)).toISOString().slice(0, 16);
    
    const inflowDateInput = document.getElementById("inflow-date");
    if (inflowDateInput) inflowDateInput.value = localISOTime;
}

// Diálogo de Confirmación Asíncrono (Popup Premium en reemplazo de confirm())
export function showConfirmDialog(title, message) {
    return new Promise((resolve) => {
        const modal = document.getElementById("confirm-action-modal");
        const titleEl = document.getElementById("confirm-modal-title");
        const msgEl = document.getElementById("confirm-modal-message");
        const btnYes = document.getElementById("confirm-modal-btn-yes");
        const btnNo = document.getElementById("confirm-modal-btn-no");

        if (!modal || !titleEl || !msgEl || !btnYes || !btnNo) {
            // Fallback en caso de que no exista el HTML
            resolve(confirm(message));
            return;
        }

        titleEl.textContent = title;
        msgEl.textContent = message;

        modal.classList.add("active");
        modal.style.display = "flex";
        modal.style.zIndex = "999999";

        const cleanUp = (value) => {
            modal.classList.remove("active");
            modal.style.display = "none";
            // Quitar event listeners para evitar fugas de memoria
            btnYes.replaceWith(btnYes.cloneNode(true));
            btnNo.replaceWith(btnNo.cloneNode(true));
            resolve(value);
        };

        document.getElementById("confirm-modal-btn-yes").addEventListener("click", () => cleanUp(true));
        document.getElementById("confirm-modal-btn-no").addEventListener("click", () => cleanUp(false));
    });
}

export function debounce(func, delay = 200) {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}
window.debounce = debounce;

