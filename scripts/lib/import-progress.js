/**
 * Modal progress window used while a Universal VTT import is running.
 */

import { MODULE_ID } from "./constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Blocks the table while an import reports its phase.
 */
export class ImportProgressApplication extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: `${MODULE_ID}-progress`,
        classes: ["quick-battlemap-progress", "standard-form"],
        window: {
            title: "QUICKBATTLEMAP.ImportingMap",
            resizable: false,
            controls: []
        },
        position: { width: 420 }
    };

    static PARTS = {
        form: { template: `modules/${MODULE_ID}/templates/progress.hbs` }
    };

    /** @type {HTMLElement|null} */
    backdrop = null;

    /** @override */
    async _onRender(context, options) {
        await super._onRender(context, options);
        if (!this.backdrop) {
            this.backdrop = document.createElement("div");
            this.backdrop.className = "quick-battlemap-modal-backdrop";
            document.body.appendChild(this.backdrop);
        }
        const frame = this.element?.closest(".application") ?? this.element;
        const closeButton = frame?.querySelector("[data-action='close']");
        if (closeButton) closeButton.hidden = true;
    }

    /** @override */
    async close(options) {
        this.backdrop?.remove();
        this.backdrop = null;
        return super.close(options);
    }

    /**
     * @param {string|null|undefined} phase
     * @param {number|string|null|undefined} valueOrIndeterminate
     * @param {number|null|undefined} max
     * @param {string|null|undefined} detail
     */
    update(phase, valueOrIndeterminate, max, detail) {
        if (!this.element) return;
        const phaseElement = this.element.querySelector(".qb-progress-phase");
        const detailElement = this.element.querySelector(".qb-progress-detail");
        const bar = this.element.querySelector(".qb-progress-bar");
        if (phase != null && phaseElement) phaseElement.textContent = phase;
        if (detail != null && detailElement) detailElement.textContent = detail;
        if (!bar) return;
        if (valueOrIndeterminate === "indeterminate") {
            bar.removeAttribute("value");
            bar.removeAttribute("max");
        } else if (valueOrIndeterminate != null) {
            bar.value = Number(valueOrIndeterminate);
            bar.max = Number(max ?? 100);
        }
    }
}
