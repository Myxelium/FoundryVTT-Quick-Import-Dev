/**
 * Build a Foundry V14 Scene document from normalized import data.
 * Background art lives on a Level. Illumination lives on environment.
 * Grid alignment lives on shiftX / shiftY, not on grid.offset.
 */

import { DEFAULT_LEVEL_ID } from "./constants.js";

/**
 * @param {object} options
 * @param {string} options.sceneName
 * @param {string} options.backgroundPath
 * @param {number} options.width
 * @param {number} options.height
 * @param {object} [options.normalized]
 * @param {string} [options.levelName]
 * @param {string} [options.levelId]
 * @returns {object}
 */
export function buildV14SceneData(options) {
    const normalized = options.normalized ?? {};
    const grid = normalized.grid ?? {};
    const levelId = options.levelId || DEFAULT_LEVEL_ID;
    const environment = normalized.environment ?? {};
    const globalLightEnabled = environment.globalLight?.enabled ?? normalized.globalLight ?? false;
    const darknessLevel = environment.darknessLevel ?? normalized.darkness ?? 0;

    return {
        name: options.sceneName,
        width: options.width,
        height: options.height,
        padding: normalized.padding ?? 0,
        backgroundColor: normalized.backgroundColor ?? "#000000",
        shiftX: normalized.shiftX ?? grid.offset?.x ?? 0,
        shiftY: normalized.shiftY ?? grid.offset?.y ?? 0,
        initialLevel: levelId,
        grid: {
            size: grid.size,
            type: grid.type,
            distance: grid.distance,
            units: grid.units,
            color: grid.color,
            alpha: grid.alpha
        },
        environment: {
            darknessLevel,
            globalLight: {
                enabled: !!globalLightEnabled
            }
        },
        levels: [
            {
                _id: levelId,
                name: options.levelName || "Background",
                background: {
                    src: options.backgroundPath
                }
            }
        ],
        walls: assignLevel(normalized.walls, levelId),
        lights: assignLevel(normalized.lights, levelId)
    };
}

/**
 * Build a v14 scene that can hold several Universal VTT levels.
 * Placeables that already name a level keep it. Others attach to the first level.
 *
 * @param {object} options
 * @param {string} options.sceneName
 * @param {number} options.width
 * @param {number} options.height
 * @param {number} [options.padding]
 * @param {string} [options.backgroundColor]
 * @param {object} [options.grid]
 * @param {object} [options.environment]
 * @param {object[]} options.levels
 * @param {object[]} [options.walls]
 * @param {object[]} [options.lights]
 * @returns {object}
 */
export function buildLayeredSceneData(options) {
    const grid = options.grid ?? {};
    const environment = options.environment ?? {};
    const levels = options.levels ?? [];
    const levelId = levels[0]?._id || DEFAULT_LEVEL_ID;

    return {
        name: options.sceneName,
        width: options.width,
        height: options.height,
        padding: options.padding ?? 0,
        backgroundColor: options.backgroundColor ?? "#000000",
        shiftX: 0,
        shiftY: 0,
        initialLevel: levelId,
        grid: {
            size: grid.size,
            type: grid.type ?? 1,
            distance: grid.distance ?? 5,
            units: grid.units ?? "ft",
            color: grid.color ?? "#000000",
            alpha: grid.alpha ?? 0.2
        },
        environment: {
            darknessLevel: environment.darknessLevel ?? 0,
            globalLight: {
                enabled: !!environment.globalLight?.enabled
            }
        },
        levels,
        walls: assignLevel(options.walls, levelId),
        lights: assignLevel(options.lights, levelId)
    };
}

/**
 * Tag placeables with a level id when they do not already name one.
 * An empty levels list in V14 means "every level", which is wrong once
 * another level is added later.
 *
 * @param {Array|undefined} documents
 * @param {string} levelId
 * @returns {Array}
 */
function assignLevel(documents, levelId) {
    return (documents ?? []).map((document) => {
        if (Array.isArray(document.levels) && document.levels.length > 0) {
            return document;
        }
        return { ...document, levels: [levelId] };
    });
}
