/**
 * Quick Battlemap Importer
 *
 * Drop a background image or video and optional wall JSON to create a
 * Foundry V14 scene. Universal VTT maps are handled by scripts/ddimport.js.
 *
 * @module QuickBattlemap
 * @author Myxelium
 * @license MIT
 */

import { SceneImportController } from "./lib/scene-import-controller.js";
import { MODULE_ID } from "./lib/constants.js";

/** @type {SceneImportController|null} */
let sceneImportController = null;

const QUICK_IMPORT_BUTTON_CLASS = "quick-battlemap-quick-import";

Hooks.once("init", () => {
    console.log(`${MODULE_ID} | Initializing module`);
});

Hooks.once("ready", () => {
    console.log(`${MODULE_ID} | Module ready`);
    sceneImportController = new SceneImportController();
    sceneImportController.initialize();
    ui.notifications.info(game.i18n.localize("QUICKBATTLEMAP.Ready"));
});

/**
 * Add the Quick import button to the Scenes directory.
 * V14 renders the directory as ApplicationV2, so the footer may arrive as the
 * hook element itself or as a child of the application.
 *
 * @param {Application} app
 * @param {HTMLElement|jQuery} html
 */
Hooks.on("renderSceneDirectory", (app, html) => {
    if (!game.user?.isGM) return;

    const host = findButtonHost(app, html);
    if (!host) return;
    if (host.querySelector(`button.${QUICK_IMPORT_BUTTON_CLASS}`)) return;
    if (app?.element?.querySelector?.(`button.${QUICK_IMPORT_BUTTON_CLASS}`)) return;

    host.appendChild(createQuickImportButton());
});

/**
 * @param {Application} app
 * @param {HTMLElement|jQuery} html
 * @returns {HTMLElement|null}
 */
function findButtonHost(app, html) {
    const candidates = [];
    const element = html instanceof HTMLElement ? html : html?.[0];
    if (element instanceof HTMLElement) candidates.push(element);
    if (app?.element instanceof HTMLElement) candidates.push(app.element);

    const selectors = [".directory-footer", "footer.action-buttons", ".action-buttons", ".header-actions"];
    for (const root of candidates) {
        for (const selector of selectors) {
            if (root.matches?.(selector)) return root;
            const found = root.querySelector(selector);
            if (found) return found;
        }
    }
    return null;
}

/**
 * @returns {HTMLButtonElement}
 */
function createQuickImportButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = QUICK_IMPORT_BUTTON_CLASS;
    button.innerHTML = `<i class="fa-solid fa-map"></i> <span>${game.i18n.localize("QUICKBATTLEMAP.ControlTitle")}</span>`;
    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!sceneImportController) {
            sceneImportController = new SceneImportController();
            sceneImportController.initialize();
        }
        sceneImportController.showImportPanel();
    });
    return button;
}
