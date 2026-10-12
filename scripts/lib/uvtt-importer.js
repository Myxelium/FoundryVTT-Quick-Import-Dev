/**
 * Import Universal VTT maps (.dd2vtt, .df2vtt, .uvtt) into Foundry V14 scenes.
 *
 * Image stitching, wall fidelity, cave offset, lights, and portals follow
 * the Universal Battlemap Importer (FVTT-DD-Import, Copyright (c) 2020 Russell).
 * See licenses/FVTT-DD-Import-MIT.txt.
 */

import { DEFAULT_LEVEL_ID, LEVEL_ELEVATION_STEP, MODULE_ID, MODULE_LOG_PREFIX } from "./constants.js";
import { MediaStorageService } from "./media-storage-service.js";
import {
    aggregateStitchedFiles,
    buildDoorData,
    buildLightData,
    buildWallData,
    collectLineOfSight,
    computeEffectivePpg,
    getImageType,
    layoutStitchedFiles,
    skipCountForFidelity
} from "./uvtt-geometry.js";

const storageService = new MediaStorageService();

/**
 * @param {object} content Universal VTT JSON with an `image` base64 field.
 * @returns {ArrayBuffer}
 */
export function decodeImage(content) {
    const byteString = atob(content.image);
    const buffer = new ArrayBuffer(byteString.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);
    return buffer;
}

/**
 * @param {object} content
 * @returns {"png"|"webp"|"jpeg"}
 */
export function imageTypeOf(content) {
    return getImageType(atob(content.image.substr(0, 8)));
}

/**
 * Read padding-aware scene origin from an unsaved Scene, matching Foundry's canvas placement.
 * @param {object} sceneData
 * @returns {{x: number, y: number}}
 */
export function measureSceneOffset(sceneData) {
    const SceneDocument = globalThis.Scene;
    if (typeof SceneDocument !== "function") return { x: 0, y: 0 };
    const tempScene = new SceneDocument(foundry.utils.deepClone(sceneData));
    const dimensions = tempScene.getDimensions();
    return { x: dimensions.sceneX ?? 0, y: dimensions.sceneY ?? 0 };
}

/**
 * @param {Function|undefined} documentClass
 * @param {object} data
 * @returns {object|null}
 */
function asEmbeddedData(documentClass, data) {
    if (typeof documentClass !== "function") return data;
    try {
        const document = new documentClass(data);
        const plain = typeof document.toObject === "function" ? document.toObject() : data;
        if (data.levels) plain.levels = data.levels;
        return plain;
    } catch (error) {
        console.error(`${MODULE_LOG_PREFIX} | Skipping invalid document`, error);
        return null;
    }
}

/**
 * @param {Array<object>} walls
 * @param {Array<object>} lights
 * @param {string} levelId
 * @returns {{walls: Array<object>, lights: Array<object>}}
 */
function materializePlaceables(walls, lights, levelId) {
    const WallDocument = globalThis.WallDocument ?? globalThis.foundry?.documents?.WallDocument;
    const AmbientLightDocument = globalThis.AmbientLightDocument ?? globalThis.foundry?.documents?.AmbientLightDocument;
    const preparedWalls = walls
        .map((wall) => asEmbeddedData(WallDocument, { ...wall, levels: [levelId] }))
        .filter(Boolean);
    const preparedLights = lights
        .map((light) => asEmbeddedData(AmbientLightDocument, { ...light, levels: [levelId] }))
        .filter(Boolean);
    return { walls: preparedWalls, lights: preparedLights };
}

/**
 * @returns {number}
 */
function systemGridDistance() {
    return globalThis.game?.system?.grid?.distance || 1;
}

/**
 * @returns {object}
 */
function senseTypes() {
    return globalThis.CONST?.WALL_SENSE_TYPES ?? {
        NONE: 0,
        LIMITED: 10,
        NORMAL: 20,
        PROXIMITY: 30,
        DISTANCE: 40
    };
}

/**
 * @returns {boolean}
 */
function openableWindows() {
    try {
        return !!game.settings.get(MODULE_ID, "openableWindows");
    } catch (_error) {
        return false;
    }
}

/**
 * @param {string} source
 * @param {string} path
 * @param {string} [bucket]
 */
async function ensureUploadDirectory(source, path, bucket) {
    if (!path || source !== "data") return;
    await storageService.ensureDirectoryExists(source, path.replace(/\/$/, ""), bucket);
}

/**
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {string} name
 * @param {string} path
 * @param {string} source
 * @param {string} extension
 * @param {string} [bucket]
 */
export async function uploadImage(buffer, name, path, source, extension, bucket) {
    await ensureUploadDirectory(source, path, bucket);
    const file = new File([buffer], `${name}.${extension}`, { type: `image/${extension}` });
    const options = {};
    if (bucket) options.bucket = bucket;
    await FilePicker.upload(source, path, file, options);
}

/**
 * @param {object} content
 * @param {object} importData
 * @returns {Promise<string>} Saved extension.
 */
async function uploadSourceImage(content, importData) {
    const extension = imageTypeOf(content);
    await uploadImage(
        decodeImage(content),
        content.name,
        importData.path,
        importData.source,
        extension,
        importData.bucket
    );
    return extension;
}

/**
 * @param {CanvasRenderingContext2D} context
 * @param {object} file
 * @param {string} extension
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @returns {Promise<void>}
 */
function drawImageToCanvas(context, file, extension, imageWidth, imageHeight) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = "sync";
        const blob = new Blob([decodeImage(file)], { type: `image/${extension}` });
        const url = URL.createObjectURL(blob);
        const finish = () => URL.revokeObjectURL(url);
        const paint = () => {
            context.drawImage(image, file.pos_in_image?.x || 0, file.pos_in_image?.y || 0, imageWidth, imageHeight);
            finish();
            resolve();
        };
        image.addEventListener("load", () => {
            image.decode().then(paint).catch(paint);
        });
        image.addEventListener("error", () => {
            finish();
            reject(new Error(`Could not decode the map image for ${file.name || "this file"}.`));
        });
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
            if (!blob) {
                reject(new Error(`Canvas encoding failed. Dimensions ${canvas.width}x${canvas.height}.`));
                return;
            }
            resolve(blob);
        }, mime, quality);
    });
}

/**
 * @param {object} file
 * @param {object} importData
 * @returns {string}
 */
export function imagePathFor(file, importData) {
    let path = importData.path || "";
    let extension = imageTypeOf(file);
    if (importData.toWebp) extension = "webp";
    if (path && !path.endsWith("/")) path += "/";

    let imagePath = `${path}${file.name}.${extension}`;
    if (importData.source === "s3") {
        const endpoint = game.data?.files?.s3?.endpoint;
        if (!endpoint) throw new Error("S3 is selected, but this world has no S3 endpoint configured.");
        if (imagePath.startsWith("/")) imagePath = imagePath.slice(1);
        const bucket = importData.bucket;
        imagePath = `${endpoint.protocol}//${bucket}.${endpoint.host}${endpoint.path}${imagePath}`;
    }
    return imagePath;
}

/**
 * @param {object} file
 * @param {object} importData
 * @param {number} pixelsPerGrid
 * @param {{x: number, y: number}} sceneOffset
 * @param {string} levelId
 * @returns {{walls: Array<object>, lights: Array<object>}}
 */
function placeablesForFile(file, importData, pixelsPerGrid, sceneOffset, levelId) {
    const working = {
        ...file,
        line_of_sight: collectLineOfSight(file, !!importData.objectWalls)
    };
    const options = {
        skipNum: skipCountForFidelity(importData.fidelity),
        offset: Number(importData.offset) || 0,
        pixelsPerGrid,
        sceneOffset,
        includeObjectWalls: false,
        openableWindows: openableWindows(),
        senseTypes: senseTypes(),
        gridDistance: systemGridDistance()
    };
    const walls = buildWallData(working, options).concat(buildDoorData(file, options));
    const lights = buildLightData(file, options);
    return materializePlaceables(walls, lights, levelId);
}

/**
 * @param {object} sceneData
 * @returns {Promise<object>}
 */
async function createSceneWithThumbnail(sceneData) {
    const scene = await Scene.create(sceneData);
    try {
        const thumb = await scene.createThumbnail();
        if (thumb?.thumb) await scene.update({ thumb: thumb.thumb });
    } catch (error) {
        console.warn(`${MODULE_LOG_PREFIX} | Thumbnail generation failed`, error);
    }
    return scene;
}

/**
 * @param {string} index
 * @returns {string}
 */
function levelIdFor(index) {
    if (index === 0) return DEFAULT_LEVEL_ID;
    return foundry.utils.randomID();
}

/**
 * Stack one Universal VTT file per Foundry level.
 * @param {object} importData
 * @param {object[]} files
 * @param {{update: Function}} progress
 */
export async function importAsLevels(importData, files, progress) {
    const requestedPpg = importData.useCustomPixelsPerGrid
        ? Number(importData.customPixelsPerGrid)
        : Number(files[0]?.resolution?.pixels_per_grid || 100);

    let effectivePpg = requestedPpg;
    for (const file of files) {
        const fitted = computeEffectivePpg(file.resolution.map_size.x, file.resolution.map_size.y, requestedPpg);
        if (fitted.ppg < effectivePpg) effectivePpg = fitted.ppg;
    }
    if (effectivePpg < requestedPpg) {
        ui.notifications.warn(`Image downscaled (browser canvas limit): PPI ${requestedPpg} -> ${effectivePpg}`);
    }

    let largestX = 0;
    let largestY = 0;
    for (const file of files) {
        largestX = Math.max(largestX, file.resolution.map_size.x * effectivePpg);
        largestY = Math.max(largestY, file.resolution.map_size.y * effectivePpg);
    }

    const sceneData = {
        name: importData.sceneName || files[0].levelName || files[0].name || "New Scene",
        padding: Number(importData.padding) || 0,
        width: largestX,
        height: largestY,
        shiftX: 0,
        shiftY: 0,
        grid: { size: effectivePpg },
        levels: [],
        walls: [],
        lights: []
    };

    const total = files.length;
    for (let index = 0; index < files.length; index++) {
        const content = files[index];
        const levelId = levelIdFor(index);
        progress?.update(`Level ${index + 1}/${total}: ${content.levelName}`, index, total, "preparing");

        const offset = measureSceneOffset(sceneData);
        const placeables = placeablesForFile(content, importData, effectivePpg, offset, levelId);
        sceneData.walls = sceneData.walls.concat(placeables.walls);
        sceneData.lights = sceneData.lights.concat(placeables.lights);
        sceneData.levels.push({
            _id: levelId,
            name: content.levelName || content.name,
            sort: index,
            elevation: {
                bottom: index * LEVEL_ELEVATION_STEP,
                top: (index + 1) * LEVEL_ELEVATION_STEP
            },
            background: { src: imagePathFor(content, importData) }
        });

        progress?.update(`Level ${index + 1}/${total}: ${content.levelName}`, index + 0.3, total, "processing image");
        content.pos_in_image = { x: 0, y: 0 };
        if (importData.toWebp) {
            await encodeLevelImage(content, effectivePpg, importData, progress);
        } else {
            progress?.update(null, "indeterminate", null, `Direct upload ${content.name}`);
            await uploadSourceImage(content, importData);
        }
        progress?.update(`Level ${index + 1}/${total}: ${content.levelName}`, index + 1, total, "done");
    }

    sceneData.initialLevel = sceneData.levels[0]?._id ?? DEFAULT_LEVEL_ID;
    progress?.update("Creating scene", "indeterminate", null, sceneData.name);
    return createSceneWithThumbnail(sceneData);
}

/**
 * @param {object} content
 * @param {number} pixelsPerGrid
 * @param {object} importData
 * @param {{update: Function}} [progress]
 */
async function encodeLevelImage(content, pixelsPerGrid, importData, progress) {
    progress?.update(null, "indeterminate", null, `WebP encoding ${content.name}`);
    const width = content.resolution.map_size.x * pixelsPerGrid;
    const height = content.resolution.map_size.y * pixelsPerGrid;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const sourceExtension = imageTypeOf(content);
    await drawImageToCanvas(canvas.getContext("2d"), content, sourceExtension, width, height);
    const blob = await canvasToBlob(canvas, "image/webp", Number(importData.webpQuality) || 0.8);
    const buffer = await blob.arrayBuffer();
    await uploadImage(buffer, content.name, importData.path, importData.source, "webp", importData.bucket);
}

/**
 * Stitch several Universal VTT files into one image and one level.
 * Modes: "x" horizontal, "y" vertical, "g" grid.
 *
 * @param {object} importData
 * @param {object[]} files
 * @param {{update: Function}} progress
 */
export async function importStitched(importData, files, progress) {
    const mode = importData.mode;
    let fileName = files.length === 1 ? files[0].name : `combined-${files.map((file) => file.name).join("-")}`;
    let sceneName = importData.sceneName || files[0].name;
    if (importData.imageFileName) {
        fileName = importData.imageFileName;
        if (!importData.sceneName) sceneName = importData.imageFileName;
    }
    if (files.length > 1) {
        ui.notifications.notify("Combining images may take quite some time, be patient");
    }

    let pixelsPerGrid = importData.useCustomPixelsPerGrid
        ? Number(importData.customPixelsPerGrid)
        : Number(files[0].resolution.pixels_per_grid);

    let totalGridX = files[0].resolution.map_size.x;
    let totalGridY = files[0].resolution.map_size.y;
    if (mode === "x") totalGridX *= files.length;
    else if (mode === "y") totalGridY *= files.length;
    else if (mode === "g") {
        const rowWidth = Math.ceil(Math.sqrt(files.length));
        totalGridX *= rowWidth;
        totalGridY *= Math.ceil(files.length / rowWidth);
    }

    const fitted = computeEffectivePpg(totalGridX, totalGridY, pixelsPerGrid);
    if (fitted.scaled) {
        ui.notifications.warn(`Image downscaled (browser canvas limit): PPI ${fitted.originalPpg} -> ${fitted.ppg}`);
        pixelsPerGrid = fitted.ppg;
    }

    const layout = layoutStitchedFiles(files, mode, pixelsPerGrid);
    const canvas = document.createElement("canvas");
    canvas.width = layout.width;
    canvas.height = layout.height;
    const context = canvas.getContext("2d");

    let imageType = "png";
    for (let index = 0; index < files.length; index++) {
        const file = files[index];
        progress?.update(`Tile ${index + 1}/${files.length}`, index, files.length, "drawing to canvas");
        imageType = imageTypeOf(file);
        const tileWidth = file.resolution.map_size.x * pixelsPerGrid;
        const tileHeight = file.resolution.map_size.y * pixelsPerGrid;
        await drawImageToCanvas(context, file, imageType, tileWidth, tileHeight);
    }
    if (importData.toWebp) imageType = "webp";

    progress?.update("Upload", "indeterminate", null, `${fileName}.${imageType}`);
    const blob = await canvasToBlob(
        canvas,
        `image/${imageType}`,
        importData.toWebp ? Number(importData.webpQuality) || 0.8 : undefined
    );
    await uploadImage(await blob.arrayBuffer(), fileName, importData.path, importData.source, imageType, importData.bucket);

    const copies = files.map((file) => ({
        ...file,
        line_of_sight: collectLineOfSight(file, !!importData.objectWalls),
        portals: file.portals ?? [],
        lights: file.lights ?? []
    }));
    const aggregated = aggregateStitchedFiles(
        copies,
        !!importData.wallsAroundFiles,
        { x: layout.gridWidth, y: layout.gridHeight }
    );
    aggregated.resolution.pixels_per_grid = pixelsPerGrid;

    const sceneData = {
        name: sceneName,
        grid: { size: pixelsPerGrid },
        width: layout.width,
        height: layout.height,
        padding: Number(importData.padding) || 0,
        shiftX: 0,
        shiftY: 0,
        levels: [
            {
                _id: DEFAULT_LEVEL_ID,
                name: "Level",
                background: { src: buildPlainPath(fileName, imageType, importData) }
            }
        ],
        initialLevel: DEFAULT_LEVEL_ID
    };

    const offset = measureSceneOffset(sceneData);
    const options = {
        skipNum: skipCountForFidelity(importData.fidelity),
        offset: Number(importData.offset) || 0,
        pixelsPerGrid,
        sceneOffset: offset,
        includeObjectWalls: false,
        openableWindows: openableWindows(),
        senseTypes: senseTypes(),
        gridDistance: systemGridDistance()
    };
    const walls = buildWallData(aggregated, options).concat(buildDoorData(aggregated, options));
    const lights = buildLightData(aggregated, options);
    const placeables = materializePlaceables(walls, lights, DEFAULT_LEVEL_ID);
    sceneData.walls = placeables.walls;
    sceneData.lights = placeables.lights;

    progress?.update("Creating scene", "indeterminate", null, sceneName);
    return createSceneWithThumbnail(sceneData);
}

/**
 * @param {string} fileName
 * @param {string} extension
 * @param {object} importData
 * @returns {string}
 */
function buildPlainPath(fileName, extension, importData) {
    let path = importData.path || "";
    if (path && !path.endsWith("/")) path += "/";
    let imagePath = `${path}${fileName}.${extension}`;
    if (importData.source === "s3") {
        const endpoint = game.data?.files?.s3?.endpoint;
        if (!endpoint) throw new Error("S3 is selected, but this world has no S3 endpoint configured.");
        if (imagePath.startsWith("/")) imagePath = imagePath.slice(1);
        imagePath = `${endpoint.protocol}//${importData.bucket}.${endpoint.host}${endpoint.path}${imagePath}`;
    }
    return imagePath;
}

/**
 * Import one or more Universal VTT files.
 * A single file, or multi-file mode "l", becomes one scene with a level per file.
 * Modes x, y, and g stitch the files into one image.
 *
 * @param {object} importData
 * @param {object[]} files
 * @param {{update: Function}} [progress]
 * @returns {Promise<object>}
 */
export async function importUniversalVtt(importData, files, progress) {
    if (!files?.length) throw new Error("No valid files to import.");
    for (const file of files) {
        if (!file?.resolution?.map_size || typeof file.image !== "string") {
            throw new Error(`${file?.name || "File"} is not a Universal VTT map.`);
        }
        file.line_of_sight ??= [];
        file.portals ??= [];
        file.lights ??= [];
    }

    const mode = files.length <= 1 ? "l" : (importData.mode || "l");
    if (mode === "x" || mode === "y" || mode === "g") {
        return importStitched({ ...importData, mode }, files, progress);
    }
    return importAsLevels(importData, files, progress);
}
