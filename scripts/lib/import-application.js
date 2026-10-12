/**
 * Foundry V14 application for quick battlemap import.
 */

import { MODULE_ID, NO_GRID_STORAGE_KEY } from "./constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Drag-and-drop panel for images, videos, and wall JSON.
 * Universal VTT maps use the upstream importer in scripts/ddimport.js.
 */
export class QuickImportApplication extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: MODULE_ID,
        tag: "form",
        classes: ["quick-battlemap", "standard-form"],
        window: {
            title: "QUICKBATTLEMAP.DropAreaTitle",
            icon: "fa-solid fa-map",
            resizable: true
        },
        position: { width: 560 },
        actions: {
            createScene: this._onCreateScene,
            resetQuick: this._onResetQuick
        },
        form: {
            submitOnChange: false,
            closeOnSubmit: false,
            handler: this._onSubmit
        }
    };

    static PARTS = {
        form: {
            template: `modules/${MODULE_ID}/templates/importer.hbs`,
            scrollable: [""]
        }
    };

    constructor(options = {}) {
        super(options);
        this.noGrid = false;
        this.backgroundLoaded = false;
        this.backgroundTooltip = "";
        this.wallLoaded = false;
        this.wallStatusTooltip = "";
        this.createEnabled = false;
        this.busyMessage = "";
        this.onCreateSceneRequested = null;
        this.onResetRequested = null;
        this.onCloseRequested = null;
        this.onFilesDropped = null;
        this.onNoGridPreferenceChanged = null;
        this.onRendered = null;
    }

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.noGrid = this.noGrid;
        return context;
    }

    /** @override */
    async _onRender(context, options) {
        await super._onRender(context, options);
        this.#bindQuickControls();
        this.#applyQuickState();
        this.onRendered?.();
    }

    /**
     * Show the quick-import window.
     */
    async show() {
        if (!this.rendered) await this.render({ force: true });
        this.bringToFront?.();
        this.bringToTop?.();
        return this;
    }

    /**
     * Hide the window.
     */
    hide() {
        if (this.rendered) return this.close();
        return undefined;
    }

    /**
     * @param {boolean} isChecked
     */
    setNoGridCheckboxState(isChecked) {
        this.noGrid = !!isChecked;
        const checkbox = this.element?.querySelector("input.ebm-no-grid");
        if (checkbox) checkbox.checked = this.noGrid;
    }

    /**
     * @param {boolean} isEnabled
     */
    setCreateButtonEnabled(isEnabled) {
        this.createEnabled = !!isEnabled;
        const button = this.element?.querySelector(".create-scene-button");
        if (button) button.disabled = !this.createEnabled;
    }

    /**
     * @param {boolean} isLoaded
     * @param {string} tooltipText
     */
    updateBackgroundMediaStatus(isLoaded, tooltipText) {
        this.backgroundLoaded = !!isLoaded;
        this.backgroundTooltip = tooltipText || "";
        this.#setStatus(".background-status .status-value", this.backgroundLoaded, this.backgroundTooltip);
    }

    /**
     * @param {boolean} isLoaded
     * @param {string} tooltipText
     */
    updateWallDataStatus(isLoaded, tooltipText) {
        this.wallLoaded = !!isLoaded;
        this.wallStatusTooltip = tooltipText || "";
        this.#setStatus(".wall-data-status .status-value", this.wallLoaded, this.wallStatusTooltip);
    }

    /**
     * @param {string} statusMessage
     */
    showBusyState(statusMessage) {
        this.busyMessage = statusMessage || "";
        const group = this.element?.querySelector(".progress-group");
        const text = this.element?.querySelector(".ebm-progress-text");
        if (group) group.style.display = "";
        if (text && statusMessage) text.textContent = statusMessage;
        const button = this.element?.querySelector(".create-scene-button");
        if (button) button.disabled = true;
    }

    /**
     * Hide the quick-import progress row.
     */
    clearBusyState() {
        this.busyMessage = "";
        const group = this.element?.querySelector(".progress-group");
        const text = this.element?.querySelector(".ebm-progress-text");
        if (group) group.style.display = "none";
        if (text) text.textContent = game.i18n.localize("QUICKBATTLEMAP.ProgressIdle");
        this.setCreateButtonEnabled(this.createEnabled);
    }

    /**
     * @param {boolean} persistedNoGridValue
     */
    resetAllStatuses(persistedNoGridValue) {
        this.updateBackgroundMediaStatus(false, "");
        this.updateWallDataStatus(false, "");
        this.setCreateButtonEnabled(false);
        this.clearBusyState();
        this.setNoGridCheckboxState(!!persistedNoGridValue);
    }

    /**
     * @param {SubmitEvent} event
     */
    static async _onSubmit(event) {
        event.preventDefault();
    }

    /**
     * @param {PointerEvent} _event
     * @param {HTMLElement} _target
     */
    static _onCreateScene(_event, _target) {
        this.onCreateSceneRequested?.();
    }

    /**
     * @param {PointerEvent} _event
     * @param {HTMLElement} _target
     */
    static _onResetQuick(_event, _target) {
        this.onResetRequested?.();
    }

    #bindQuickControls() {
        const dropArea = this.element?.querySelector(".quick-import");
        if (!dropArea) return;
        const stop = (event) => {
            event.preventDefault();
            event.stopPropagation();
        };
        for (const eventName of ["dragenter", "dragover", "dragleave", "drop"]) {
            dropArea.addEventListener(eventName, stop);
        }
        dropArea.addEventListener("dragenter", () => dropArea.classList.add("highlight"));
        dropArea.addEventListener("dragover", () => dropArea.classList.add("highlight"));
        dropArea.addEventListener("dragleave", () => dropArea.classList.remove("highlight"));
        dropArea.addEventListener("drop", (event) => {
            dropArea.classList.remove("highlight");
            this.onFilesDropped?.(event);
        });

        const checkbox = this.element.querySelector("input.ebm-no-grid");
        checkbox?.addEventListener("change", (event) => {
            const isChecked = !!event.currentTarget.checked;
            this.noGrid = isChecked;
            try {
                localStorage.setItem(NO_GRID_STORAGE_KEY, String(isChecked));
            } catch (_error) { /* localStorage may be blocked */ }
            this.onNoGridPreferenceChanged?.(isChecked);
        });
    }

    #applyQuickState() {
        this.setNoGridCheckboxState(this.noGrid);
        this.updateBackgroundMediaStatus(this.backgroundLoaded, this.backgroundTooltip);
        this.updateWallDataStatus(this.wallLoaded, this.wallStatusTooltip);
        this.setCreateButtonEnabled(this.createEnabled);
        if (this.busyMessage) this.showBusyState(this.busyMessage);
    }

    /**
     * @param {string} selector
     * @param {boolean} isLoaded
     * @param {string} tooltipText
     */
    #setStatus(selector, isLoaded, tooltipText) {
        const statusElement = this.element?.querySelector(selector);
        if (!statusElement) return;
        statusElement.textContent = isLoaded ? "✅" : "❌";
        statusElement.title = tooltipText || "";
    }
}
