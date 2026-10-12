/**
 * World settings for Universal VTT import.
 * Stored values are merged over the defaults so new options apply to existing worlds.
 */

import { MODULE_ID } from "./constants.js";

/**
 * @returns {object}
 */
export function defaultImportSettings() {
    const worldId = globalThis.game?.world?.id ?? "";
    return {
        source: "data",
        bucket: "",
        path: worldId ? `worlds/${worldId}` : "worlds",
        offset: 0,
        padding: 0.25,
        fidelity: 1,
        multiImageMode: "l",
        webpConversion: true,
        webpQuality: 0.8,
        wallsAroundFiles: true,
        useCustomPixelsPerGrid: false,
        customPixelsPerGrid: 100
    };
}

/**
 * @returns {object}
 */
export function readImportSettings() {
    const defaults = defaultImportSettings();
    try {
        const stored = game.settings.get(MODULE_ID, "importSettings");
        return { ...defaults, ...(stored && typeof stored === "object" ? stored : {}) };
    } catch (_error) {
        return defaults;
    }
}
