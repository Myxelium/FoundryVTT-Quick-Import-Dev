/**
 * Upload Universal VTT art and create the Foundry scene described by the planner.
 */

import { MODULE_LOG_PREFIX } from "./constants.js";
import { MediaStorageService } from "./media-storage-service.js";
import { SceneBuilder } from "./scene-builder.js";
import { imageKind, planUniversalImport } from "./universal-map.js";

const LAYOUTS = new Set(["levels", "horizontal", "vertical", "tiled"]);

/**
 * @param {object} data
 * @param {object} [extras]
 * @returns {object}
 */
export function optionsFromForm(data, extras = {}) {
    const number = (value, fallback) => {
        const raw = Array.isArray(value) ? value[value.length - 1] : value;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : fallback;
    };
    const enabled = (value, fallback) => {
        if (value == null) return fallback;
        return value === true || value === "on" || value === "true";
    };
    return {
        sceneName: String(data.sceneName || "").trim(),
        combinedName: String(data.combinedName || "").trim(),
        source: data.source === "s3" ? "s3" : "data",
        bucket: data.bucket || "",
        path: String(data.path || "").trim(),
        detail: Math.min(6, Math.max(1, Math.round(number(data.detail, 3)))),
        nudge: number(data.nudge, 0),
        padding: number(data.padding, 0.25),
        layout: LAYOUTS.has(data.layout) ? data.layout : "levels",
        webp: enabled(data.toWebp, true),
        webpQuality: Math.min(1, Math.max(0.1, number(data.webpQuality, 0.8))),
        objectWalls: enabled(data.objectWalls, true),
        frameMaps: enabled(data.frameMaps, true),
        customCellSize: enabled(data.customCellSize, false),
        cellSize: number(data.cellSize, 100),
        windowsAreDoors: !!extras.windowsAreDoors,
        gridDistance: number(extras.gridDistance, 5),
        gridUnits: extras.gridUnits || "ft"
    };
}

/**
 * @param {object} params
 * @param {object[]} params.rawMaps
 * @param {string[]} [params.names]
 * @param {object} params.options
 * @param {(update:{label?:string, ratio?:number|null, detail?:string}) => void} [params.onProgress]
 * @returns {Promise<Scene>}
 */
export async function importUniversalMaps({ rawMaps, names, options, onProgress }) {
    const plan = planUniversalImport(rawMaps, { ...options, names });
    if (plan.reduced) {
        ui.notifications?.warn?.(game.i18n.format("QUICKBATTLEMAP.CellSizeReduced", {
            from: plan.requestedPixels,
            to: plan.pixelsPerCell
        }));
    }

    onProgress?.({
        label: game.i18n.localize("QUICKBATTLEMAP.MapProgressImages"),
        ratio: 0.05,
        detail: ""
    });
    const stored = await storeImages(plan, options, onProgress);
    for (const output of plan.outputs) {
        const path = stored.get(output.id);
        if (!path) throw new Error(`Missing uploaded image for ${output.name}.`);
        plan.scene.levels[output.levelIndex].background.src = path;
    }

    onProgress?.({
        label: game.i18n.localize("QUICKBATTLEMAP.MapProgressScene"),
        ratio: null,
        detail: plan.scene.name
    });
    const builder = new SceneBuilder();
    plan.scene.walls = builder.filterValidWalls(plan.scene.walls);
    plan.scene.lights = builder.filterValidLights(plan.scene.lights);
    let scene;
    try {
        scene = await builder.createSceneDocument(plan.scene);
    } catch (error) {
        console.warn(`${MODULE_LOG_PREFIX} | Scene create rejected embedded placeables; retrying`, error);
        const walls = plan.scene.walls;
        const lights = plan.scene.lights;
        scene = await builder.createSceneDocument({ ...plan.scene, walls: [], lights: [] });
        await builder.createWalls(scene, walls);
        await builder.createLights(scene, lights);
    }
    try {
        await builder.activateAndWaitForCanvas(scene);
    } catch (error) {
        console.warn(`${MODULE_LOG_PREFIX} | Scene was created but could not be activated`, error);
    }
    return scene;
}

/**
 * @param {object} plan
 * @param {object} options
 * @param {Function} [onProgress]
 * @returns {Promise<Map<string, string>>}
 */
async function storeImages(plan, options, onProgress) {
    const storage = new MediaStorageService();
    const stored = new Map();
    if (plan.directUpload) {
        for (let index = 0; index < plan.jobs.length; index += 1) {
            const job = plan.jobs[index];
            const output = plan.outputs.find((item) => item.id === job.outputId);
            const bytes = bytesFromImageField(plan.maps[job.sourceIndex].image);
            const kind = imageKind(bytes);
            const file = new File([bytes], `${output.name}.${kind}`, { type: `image/${kind}` });
            onProgress?.({
                label: game.i18n.localize("QUICKBATTLEMAP.MapProgressImages"),
                ratio: (index + 1) / plan.jobs.length * 0.8,
                detail: file.name
            });
            stored.set(output.id, await storage.uploadNamedFile(file, options.path, options.source, options.bucket));
        }
        return stored;
    }

    const jobsByOutput = new Map();
    for (const job of plan.jobs) {
        const list = jobsByOutput.get(job.outputId) ?? [];
        list.push(job);
        jobsByOutput.set(job.outputId, list);
    }

    let finished = 0;
    for (const output of plan.outputs) {
        const canvas = document.createElement("canvas");
        canvas.width = output.width;
        canvas.height = output.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Could not prepare a canvas for the map image.");
        for (const job of jobsByOutput.get(output.id) ?? []) {
            const bytes = bytesFromImageField(plan.maps[job.sourceIndex].image);
            const kind = imageKind(bytes);
            const bitmap = await bitmapFromBytes(bytes, `image/${kind}`);
            context.drawImage(bitmap, job.x, job.y, job.width, job.height);
            bitmap.close?.();
            finished += 1;
            onProgress?.({
                label: game.i18n.localize("QUICKBATTLEMAP.MapProgressImages"),
                ratio: finished / Math.max(1, plan.jobs.length) * 0.8,
                detail: output.name
            });
        }
        const useWebp = !!options.webp;
        const mime = useWebp ? "image/webp" : "image/png";
        const extension = useWebp ? "webp" : "png";
        const blob = await canvasToBlob(canvas, mime, useWebp ? options.webpQuality : undefined);
        const file = new File([blob], `${output.name}.${extension}`, { type: mime });
        stored.set(output.id, await storage.uploadNamedFile(file, options.path, options.source, options.bucket));
    }
    return stored;
}

/**
 * @param {string} image
 * @returns {Uint8Array}
 */
function bytesFromImageField(image) {
    if (!image) throw new Error("The map file does not include an image.");
    const payload = image.includes(",") ? image.slice(image.indexOf(",") + 1) : image;
    let binary;
    try {
        binary = atob(payload);
    } catch (_error) {
        throw new Error("The map image could not be decoded.");
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

/**
 * @param {Uint8Array} bytes
 * @param {string} mime
 * @returns {Promise<CanvasImageSource>}
 */
function bitmapFromBytes(bytes, mime) {
    const blob = new Blob([bytes], { type: mime });
    if (typeof createImageBitmap === "function") return createImageBitmap(blob);
    const url = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(url);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Could not read the map image."));
        };
        image.src = url;
    });
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} mime
 * @param {number|undefined} quality
 * @returns {Promise<Blob>}
 */
function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error(`Could not encode a ${canvas.width} by ${canvas.height} image.`));
        }, mime, quality);
    });
}
