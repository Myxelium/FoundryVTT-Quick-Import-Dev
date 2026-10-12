/**
 * Small progress window used while a Universal VTT map is imported.
 */

import { MODULE_ID } from "./constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class MapImportProgress extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "quick-battlemap-map-progress",
        classes: ["quick-battlemap-map-progress"],
        window: {
            title: "QUICKBATTLEMAP.MapProgressTitle",
            icon: "fa-solid fa-image",
            resizable: false
        },
        position: { width: 420 }
    };

    static PARTS = {
        body: {
            template: `modules/${MODULE_ID}/templates/map-progress.hbs`
        }
    };

    /**
     * @param {string} [label]
     * @param {number|null|undefined} ratio 0 to 1, or null for an indeterminate bar
     * @param {string} [detail]
     */
    report(label, ratio, detail) {
        if (!this.element) return;
        const phase = this.element.querySelector(".map-progress-label");
        const note = this.element.querySelector(".map-progress-detail");
        const bar = this.element.querySelector("progress");
        if (phase && label) phase.textContent = label;
        if (note && detail != null) note.textContent = detail;
        if (!bar) return;
        if (ratio == null) {
            bar.removeAttribute("value");
            return;
        }
        bar.max = 100;
        bar.value = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
    }
}
