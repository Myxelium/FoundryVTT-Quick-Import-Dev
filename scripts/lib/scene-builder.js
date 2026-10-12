/**
 * Scene Builder
 * 
 * Handles the creation and configuration of Foundry VTT Scene documents.
 * Extracts scene-specific logic for cleaner separation from the import controller.
 * 
 * @module SceneBuilder
 */

import { MODULE_LOG_PREFIX } from './constants.js';
import { buildV14SceneData } from './scene-payload.js';

/** Maximum time to wait for canvas to be ready (milliseconds) */
const CANVAS_READY_TIMEOUT_MS = 8000;

/** Interval between canvas ready checks (milliseconds) */
const CANVAS_READY_CHECK_INTERVAL_MS = 100;

/**
 * @typedef {Object} SceneCreationOptions
 * @property {string} backgroundPath - Path to the uploaded background media
 * @property {string} sceneName - Name for the new scene
 * @property {number} width - Scene width in pixels
 * @property {number} height - Scene height in pixels
 * @property {number} [padding=0] - Scene padding multiplier
 * @property {string} [backgroundColor='#000000'] - Background color
 * @property {boolean} [globalLight=false] - Enable global illumination
 * @property {number} [darkness=0] - Darkness level (0-1)
 */

/**
 * @typedef {Object} GridSettings
 * @property {number} size - Grid cell size in pixels
 * @property {number} type - Grid type (0=none, 1=square, etc.)
 * @property {number} distance - Distance per grid cell
 * @property {string} units - Distance units
 * @property {string} color - Grid line color
 * @property {number} alpha - Grid line opacity
 * @property {Object} offset - Grid offset
 * @property {number} offset.x - Horizontal offset
 * @property {number} offset.y - Vertical offset
 */

/**
 * Service class responsible for building and configuring Foundry scenes.
 * Handles scene creation, grid settings, walls, and lights.
 */
export class SceneBuilder {
    
    /**
     * Create a new scene builder instance.
     * 
     * @param {boolean} [enableDebugLogging=false] - Whether to log debug information
     */
    constructor(enableDebugLogging = false) {
        /** @type {boolean} Enable verbose console logging */
        this.isDebugLoggingEnabled = enableDebugLogging;
    }

    /**
     * Create a new Foundry Scene document with the specified options.
     * 
     * @param {SceneCreationOptions} options - Scene creation options
     * @returns {Promise<Scene>} The created Scene document
     * 
     * @example
     * const builder = new SceneBuilder();
     * const scene = await builder.createScene({
     *   backgroundPath: 'worlds/myworld/maps/dungeon.png',
     *   sceneName: 'Dungeon Level 1',
     *   width: 2048,
     *   height: 2048
     * });
     */
    async createScene(options) {
        const normalized = {
            ...(options.normalized ?? {}),
            width: options.width,
            height: options.height
        };
        const sceneDocumentData = buildV14SceneData({
            sceneName: options.sceneName,
            backgroundPath: options.backgroundPath,
            width: options.width,
            height: options.height,
            normalized,
            levelName: options.levelName || 'Background'
        });
        sceneDocumentData.walls = this.filterValidWalls(sceneDocumentData.walls);
        sceneDocumentData.lights = this.filterValidLights(sceneDocumentData.lights);

        try {
            return await this.createSceneDocument(sceneDocumentData);
        } catch (creationError) {
            console.warn(`${MODULE_LOG_PREFIX} | Scene create rejected embedded placeables; retrying`, creationError);
            const withoutPlaceables = { ...sceneDocumentData, walls: [], lights: [] };
            const createdScene = await this.createSceneDocument(withoutPlaceables);
            await this.createWalls(createdScene, sceneDocumentData.walls);
            await this.createLights(createdScene, sceneDocumentData.lights);
            return createdScene;
        }
    }

    /**
     * Persist a scene and refresh its sidebar thumbnail.
     * Thumbnail generation is best-effort: a missing thumb does not fail the import.
     *
     * @param {object} sceneDocumentData
     * @returns {Promise<Scene>}
     */
    async createSceneDocument(sceneDocumentData) {
        const createdScene = await Scene.create(sceneDocumentData);
        try {
            const thumbnail = await createdScene.createThumbnail();
            if (thumbnail?.thumb) await createdScene.update({ thumb: thumbnail.thumb });
        } catch (thumbnailError) {
            console.warn(`${MODULE_LOG_PREFIX} | Thumbnail generation failed`, thumbnailError);
        }

        if (this.isDebugLoggingEnabled) {
            console.log(`${MODULE_LOG_PREFIX} | Created scene:`, createdScene.name);
        }

        return createdScene;
    }

    /**
     * Activate a scene and wait for the canvas to be fully ready.
     * 
     * @param {Scene} scene - The scene to activate
     * @returns {Promise<void>} Resolves when canvas is ready
     */
    async activateAndWaitForCanvas(scene) {
        await scene.activate();
        await this.waitForCanvasReady(scene);
    }

    /**
     * Wait for the canvas to be fully ready after scene activation.
     * Times out after CANVAS_READY_TIMEOUT_MS to prevent infinite waiting.
     * 
     * @param {Scene} targetScene - The scene to wait for
     * @returns {Promise<void>} Resolves when canvas is ready or timeout reached
     */
    async waitForCanvasReady(targetScene) {
        const timeoutDeadline = Date.now() + CANVAS_READY_TIMEOUT_MS;

        while (Date.now() < timeoutDeadline) {
            const isCanvasReady = this.checkCanvasReadyState(targetScene);

            if (isCanvasReady) {
                return;
            }

            await this.delay(CANVAS_READY_CHECK_INTERVAL_MS);
        }

        if (this.isDebugLoggingEnabled) {
            console.warn(`${MODULE_LOG_PREFIX} | Canvas ready timeout reached`);
        }
    }

    /**
     * Check if the canvas is fully initialized for a scene.
     * 
     * @param {Scene} targetScene - The scene to check
     * @returns {boolean} True if canvas is ready
     */
    checkCanvasReadyState(targetScene) {
        const lightingReady = canvas?.lighting?.initialized ?? canvas?.effects?.initialized;
        return (
            canvas?.ready &&
            canvas?.scene?.id === targetScene.id &&
            canvas?.walls?.initialized !== false &&
            lightingReady !== false
        );
    }

    /**
     * Apply grid settings to a scene, handling different Foundry versions.
     * 
     * @param {Scene} scene - The scene to update
     * @param {GridSettings} gridSettings - Grid configuration to apply
     * @param {boolean} [useNoGridMode=false] - Override grid type to 0 (none)
     */
    async applyGridSettings(scene, gridSettings, useNoGridMode = false) {
        const effectiveGridSettings = { ...gridSettings };
        if (useNoGridMode) {
            effectiveGridSettings.type = 0;
        }

        const gridUpdateData = {
            size: effectiveGridSettings.size,
            type: effectiveGridSettings.type,
            distance: effectiveGridSettings.distance,
            units: effectiveGridSettings.units,
            color: effectiveGridSettings.color,
            alpha: effectiveGridSettings.alpha
        };
        const shiftX = effectiveGridSettings.shiftX ?? effectiveGridSettings.offset?.x ?? 0;
        const shiftY = effectiveGridSettings.shiftY ?? effectiveGridSettings.offset?.y ?? 0;

        if (this.isDebugLoggingEnabled) {
            console.log(`${MODULE_LOG_PREFIX} | Applying grid`, gridUpdateData, { shiftX, shiftY });
        }

        await scene.update({
            grid: gridUpdateData,
            shiftX,
            shiftY
        });
    }

    /**
     * Create wall documents in a scene.
     * Filters invalid walls and retries once on failure.
     * 
     * @param {Scene} scene - The scene to add walls to
     * @param {Array} wallsData - Array of wall document data
     * @returns {Promise<void>}
     */
    async createWalls(scene, wallsData) {
        const validWalls = this.filterValidWalls(wallsData || []);
        
        if (!validWalls.length) {
            return;
        }

        if (this.isDebugLoggingEnabled) {
            console.log(`${MODULE_LOG_PREFIX} | Creating ${validWalls.length} walls`);
        }

        const wallCountBefore = scene.walls?.size ?? 0;

        try {
            await scene.createEmbeddedDocuments('Wall', validWalls);
        } catch (firstAttemptError) {
            console.warn(`${MODULE_LOG_PREFIX} | Wall creation failed, retrying...`, firstAttemptError);
            await this.retryWallCreation(scene, validWalls, wallCountBefore);
        }
    }

    /**
     * Filter wall data to remove invalid entries.
     * Walls must have valid coordinates and non-zero length.
     * 
     * @param {Array} wallsData - Raw wall data array
     * @returns {Array} Filtered array of valid walls
     */
    filterValidWalls(wallsData) {
        return wallsData.filter(wall => {
            // Must have coordinate array with at least 4 values
            if (!Array.isArray(wall.c) || wall.c.length < 4) {
                return false;
            }

            const [startX, startY, endX, endY] = wall.c.map(n => Number(n));
            const coordinates = [startX, startY, endX, endY];

            // All coordinates must be finite numbers
            if (coordinates.some(coord => !Number.isFinite(coord))) {
                return false;
            }

            // Wall must have non-zero length (not a point)
            if (startX === endX && startY === endY) {
                return false;
            }

            return true;
        });
    }

    /**
     * Retry wall creation after waiting for canvas stability.
     * 
     * @param {Scene} scene - The scene to add walls to
     * @param {Array} validWalls - Valid wall data array
     * @param {number} wallCountBefore - Wall count before first attempt
     */
    async retryWallCreation(scene, validWalls, wallCountBefore) {
        await this.waitForCanvasReady(scene);
        await this.delay(200);

        try {
            await scene.createEmbeddedDocuments('Wall', validWalls);
        } catch (retryError) {
            const wallCountAfter = scene.walls?.size ?? 0;

            if (wallCountAfter > wallCountBefore) {
                // Walls were actually created despite the error
                console.warn(`${MODULE_LOG_PREFIX} | Walls created despite error`);
            } else {
                console.error(`${MODULE_LOG_PREFIX} | Failed to create walls:`, validWalls.slice(0, 5));
                console.error(retryError);
                ui.notifications.warn('Some walls could not be created. See console.');
            }
        }
    }

    /**
     * Drop lights that do not have a finite position.
     *
     * @param {Array} lightsData
     * @returns {Array}
     */
    filterValidLights(lightsData) {
        return (lightsData || []).filter((light) => {
            return Number.isFinite(Number(light?.x)) && Number.isFinite(Number(light?.y));
        });
    }

    async createLights(scene, lightsData) {
        const lights = this.filterValidLights(lightsData);
        
        if (!lights.length) {
            return;
        }

        if (this.isDebugLoggingEnabled) {
            console.log(`${MODULE_LOG_PREFIX} | Creating ${lights.length} lights`);
        }

        try {
            await scene.createEmbeddedDocuments('AmbientLight', lights);
        } catch (creationError) {
            console.error(`${MODULE_LOG_PREFIX} | Failed to create lights:`, lights.slice(0, 5));
            console.error(creationError);
            ui.notifications.warn('Some lights could not be created. See console.');
        }
    }

    /**
     * Utility method to create a delay.
     * 
     * @param {number} milliseconds - Duration to wait
     * @returns {Promise<void>} Resolves after the delay
     */
    delay(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }
}
