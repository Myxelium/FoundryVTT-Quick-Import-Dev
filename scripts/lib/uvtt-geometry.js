/**
 * Universal VTT geometry.
 *
 * Wall simplification, cave-wall offset, and coordinate conversion follow
 * the Universal Battlemap Importer (FVTT-DD-Import, Copyright (c) 2020 Russell),
 * which is MIT licensed. See licenses/FVTT-DD-Import-MIT.txt.
 *
 * These functions stay free of Foundry globals so they can be tested on their own.
 */

/** Conservative canvas ceiling used by the Universal Battlemap Importer. */
export const BROWSER_CANVAS_LIMITS = {
    maxDim: 11000,
    maxArea: 11000 * 11000
};

/** Numeric wall sense types. Matches CONST.WALL_SENSE_TYPES. */
export const DEFAULT_SENSE_TYPES = {
    NONE: 0,
    LIMITED: 10,
    NORMAL: 20,
    PROXIMITY: 30,
    DISTANCE: 40
};

/**
 * @param {number} fidelity Slider value from 1 (fewest cave walls) to 6 (keep all).
 * @returns {number}
 */
export function skipCountForFidelity(fidelity) {
    const value = Number(fidelity);
    const clamped = Number.isFinite(value) ? Math.min(6, Math.max(1, Math.round(value))) : 1;
    return 6 - clamped;
}

/**
 * @param {number} mapSizeX Grid squares across the stitched map.
 * @param {number} mapSizeY Grid squares down the stitched map.
 * @param {number} requestedPpg Requested pixels per grid square.
 * @returns {{ ppg: number, scaled: boolean, originalPpg: number }}
 */
export function computeEffectivePpg(mapSizeX, mapSizeY, requestedPpg) {
    const maxSide = Math.max(mapSizeX, mapSizeY);
    const otherSide = Math.min(mapSizeX, mapSizeY);
    let ppg = requestedPpg;
    let scaled = false;

    if (maxSide * ppg > BROWSER_CANVAS_LIMITS.maxDim) {
        ppg = Math.floor(BROWSER_CANVAS_LIMITS.maxDim / maxSide);
        scaled = true;
    }
    if ((maxSide * ppg) * (otherSide * ppg) > BROWSER_CANVAS_LIMITS.maxArea) {
        const areaPpg = Math.floor(Math.sqrt(BROWSER_CANVAS_LIMITS.maxArea / (maxSide * otherSide)));
        if (areaPpg < ppg) {
            ppg = areaPpg;
            scaled = true;
        }
    }

    if (ppg < 10) {
        throw new Error(
            `Map is too large to import in this browser: even at PPI ${ppg}, the canvas would exceed limits. Grid extent: ${mapSizeX} x ${mapSizeY}.`
        );
    }
    return { ppg, scaled, originalPpg: requestedPpg };
}

/**
 * Identify a bitmap from the first bytes of its decoded header.
 * @param {string} bytes Binary string, not base64.
 * @returns {"png"|"webp"|"jpeg"}
 */
export function getImageType(bytes) {
    const magic = bytes.substr(0, 4);
    if (magic === "\u0089PNG") return "png";
    if (magic === "RIFF") return "webp";
    // JFIF (\u00e0) and EXIF (\u00e1) both start with the JPEG SOI marker.
    if (bytes.charCodeAt(0) === 0xff && bytes.charCodeAt(1) === 0xd8 && bytes.charCodeAt(2) === 0xff) return "jpeg";
    return "png";
}

/**
 * Dungeondraft stores light colors as AARRGGBB. Foundry wants #RRGGBB.
 * @param {string} color
 * @returns {string}
 */
export function normalizeLightColor(color) {
    if (typeof color !== "string" || color.length === 0) return "#ffffff";
    const hex = color.startsWith("#") ? color.slice(1) : color;
    if (hex.length >= 8) return `#${hex.slice(2, 8)}`;
    if (hex.length >= 6) return `#${hex.slice(0, 6)}`;
    return "#ffffff";
}

/**
 * @param {object|null|undefined} data
 * @returns {boolean}
 */
export function isUniversalVttData(data) {
    return !!data
        && typeof data === "object"
        && !!data.resolution?.map_size
        && Number.isFinite(Number(data.resolution.map_size.x))
        && Number.isFinite(Number(data.resolution.map_size.y))
        && (Array.isArray(data.line_of_sight) || typeof data.image === "string");
}

/**
 * @param {object} file
 * @param {{x: number, y: number}} position
 * @returns {boolean}
 */
export function isWithinMap(file, position) {
    const originX = file.resolution.map_origin.x;
    const originY = file.resolution.map_origin.y;
    const sizeX = file.resolution.map_size.x;
    const sizeY = file.resolution.map_size.y;
    return position.x >= originX
        && position.x <= originX + sizeX
        && position.y >= originY
        && position.y <= originY + sizeY;
}

/**
 * @param {{x: number, y: number}} p1
 * @param {{x: number, y: number}} p2
 * @returns {number}
 */
export function distance(p1, p2) {
    return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
}

/**
 * Drop intermediate points on very short segments.
 * The removal loop matches Universal Battlemap Importer, including which index it keeps.
 *
 * @param {Array<{x: number, y: number}>} wallSet
 * @param {number} numToSkip
 * @returns {Array<{x: number, y: number}>}
 */
export function preprocessWalls(wallSet, numToSkip) {
    const toRemove = [];
    let skipCounter = 0;
    for (let i = 0; i < wallSet.length - 2; i++) {
        if (i !== 0 && i !== wallSet.length - 2 && distance(wallSet[i], wallSet[i + 1]) < 0.3) {
            if (skipCounter === numToSkip) {
                skipCounter = 0;
            } else {
                skipCounter++;
                toRemove.push(i);
            }
        } else {
            skipCounter = 0;
        }
    }
    if (toRemove.length) {
        for (let i = toRemove.length - 1; i > 0; i--) {
            wallSet.splice(toRemove[i], 1);
        }
    }
    return wallSet;
}

/**
 * @param {Array<{x: number, y: number}>} wallSet
 * @param {number} shortWallThreshold
 * @returns {number}
 */
export function getShortWallCount(wallSet, shortWallThreshold) {
    let shortCount = 0;
    for (let i = 0; i < wallSet.length - 1; i++) {
        if (distance(wallSet[i], wallSet[i + 1]) < shortWallThreshold) shortCount++;
    }
    return shortCount;
}

/**
 * @param {number} slope
 * @param {number} offset
 * @param {boolean} dir
 * @returns {{x: number, y: number}}
 */
export function getOffset(slope, offset, dir) {
    const yoffset = Math.sqrt((offset * offset) / (1 + slope * slope));
    const xoffset = slope * yoffset;
    if ((slope <= 0 && dir) || (slope > 0 && dir)) return { x: xoffset, y: -yoffset };
    return { x: -xoffset, y: yoffset };
}

/**
 * @param {object} wallinfo1
 * @param {object} wallinfo2
 * @returns {{x: number, y: number}}
 */
export function interception(wallinfo1, wallinfo2) {
    if (wallinfo1.slope === undefined && wallinfo2.slope === undefined) {
        return { x: wallinfo1.x, y: (wallinfo1.y + wallinfo2.y) / 2 };
    } else if (wallinfo1.slope === undefined) {
        const m2 = wallinfo2.y - wallinfo2.slope * wallinfo2.x;
        return { x: wallinfo1.x, y: wallinfo2.slope * wallinfo1.x + m2 };
    } else if (wallinfo2.slope === undefined) {
        const m1 = wallinfo1.y - wallinfo1.slope * wallinfo1.x;
        return { x: wallinfo2.x, y: wallinfo1.slope * wallinfo2.x + m1 };
    } else if (wallinfo1.slope === wallinfo2.slope) {
        if (wallinfo1.slope === 0) {
            return { x: wallinfo1.x + (wallinfo2.x - wallinfo1.x) / 2, y: wallinfo1.y };
        }
        return { x: wallinfo1.x, y: wallinfo1.y + (wallinfo2.y - wallinfo1.y) / 2 };
    }
    const m1 = wallinfo1.y - wallinfo1.slope * wallinfo1.x;
    const m2 = wallinfo2.y - wallinfo2.slope * wallinfo2.x;
    const x = (m2 - m1) / (wallinfo1.slope - wallinfo2.slope);
    return { x, y: wallinfo1.slope * x + m1 };
}

/**
 * Push cave wall polylines inward so they sit off the painted edge.
 * Straight or sparse polylines are returned unchanged.
 *
 * @param {Array<{x: number, y: number}>} wallSet
 * @param {number} offset
 * @param {number} [shortWallThreshold]
 * @param {number} [shortWallAmountThreshold]
 * @returns {Array<{x: number, y: number}>}
 */
export function makeOffsetWalls(wallSet, offset, shortWallThreshold = 0.3, shortWallAmountThreshold = 70) {
    const shortWalls = getShortWallCount(wallSet, shortWallThreshold);
    const shortWallAmount = Math.round((shortWalls / wallSet.length) * 100);
    if (wallSet.length < 10 || shortWallAmount < shortWallAmountThreshold) return wallSet;

    if (wallSet[0].x === wallSet[wallSet.length - 1].x && wallSet[0].y === wallSet[wallSet.length - 1].y) {
        wallSet.push(wallSet[1]);
        wallSet.push(wallSet[2]);
    }

    const wallinfo = [];
    for (let i = 0; i < wallSet.length - 1; i++) {
        let slope;
        let woffset;
        let m;
        if ((wallSet[i + 1].x - wallSet[i].x) === 0) {
            slope = undefined;
            let myoffset = offset;
            if (wallSet[i + 1].y < wallSet[i].y) myoffset = -myoffset;
            woffset = { x: myoffset, y: 0 };
            m = 0;
        } else {
            slope = (wallSet[i + 1].y - wallSet[i].y) / (wallSet[i + 1].x - wallSet[i].x);
            const dir = (wallSet[i + 1].x - wallSet[i].x) >= 0;
            woffset = getOffset(slope, offset, dir);
            m = wallSet[i].x + woffset.x - wallSet[i].y + woffset.y;
        }
        wallinfo.push({
            x: wallSet[i].x + woffset.x,
            y: wallSet[i].y + woffset.y,
            slope,
            m
        });
    }

    const newWallSet = [];
    for (let i = 0; i < wallSet.length - 2; i++) {
        newWallSet.push(interception(wallinfo[i], wallinfo[i + 1]));
    }
    return newWallSet;
}

/**
 * Copy line-of-sight polylines and, when requested, append object-blocking polylines.
 * @param {object} file
 * @param {boolean} includeObjectWalls
 * @returns {Array<Array<{x: number, y: number}>>}
 */
export function collectLineOfSight(file, includeObjectWalls) {
    const lines = (file.line_of_sight ?? []).map((polyline) => polyline.map((point) => ({ x: point.x, y: point.y })));
    if (includeObjectWalls && Array.isArray(file.objects_line_of_sight)) {
        for (const polyline of file.objects_line_of_sight) {
            lines.push(polyline.map((point) => ({ x: point.x, y: point.y })));
        }
    }
    return lines;
}

/**
 * @param {object} file
 * @param {{x: number, y: number}} pointA
 * @param {{x: number, y: number}} pointB
 * @param {number} pixelsPerGrid
 * @param {{x: number, y: number}} sceneOffset
 * @returns {number[]|null}
 */
export function wallCoordinates(file, pointA, pointB, pixelsPerGrid, sceneOffset) {
    const originX = file.resolution.map_origin.x;
    const originY = file.resolution.map_origin.y;
    const offsetX = sceneOffset?.x ?? 0;
    const offsetY = sceneOffset?.y ?? 0;
    const coordinates = [
        ((pointA.x - originX) * pixelsPerGrid) + offsetX,
        ((pointA.y - originY) * pixelsPerGrid) + offsetY,
        ((pointB.x - originX) * pixelsPerGrid) + offsetX,
        ((pointB.y - originY) * pixelsPerGrid) + offsetY
    ];
    if (coordinates.some((value) => !Number.isFinite(value))) return null;
    if (coordinates[0] === coordinates[2] && coordinates[1] === coordinates[3]) return null;
    return coordinates;
}

/**
 * @param {object} file
 * @param {object} options
 * @param {number} options.skipNum
 * @param {number} options.offset
 * @param {number} options.pixelsPerGrid
 * @param {{x: number, y: number}} [options.sceneOffset]
 * @param {boolean} [options.includeObjectWalls]
 * @returns {Array<{c: number[]}>}
 */
export function buildWallData(file, options) {
    const ddWalls = collectLineOfSight(file, !!options.includeObjectWalls);
    const walls = [];
    const sceneOffset = options.sceneOffset ?? { x: 0, y: 0 };

    for (let wsIndex = 0; wsIndex < ddWalls.length; wsIndex++) {
        let wallSet = ddWalls[wsIndex];
        const connectTo = [];
        const connectedTo = [];

        for (let i = 0; i < ddWalls.length; i++) {
            if (i === wsIndex) continue;
            const other = ddWalls[i];
            if (!other?.length || !wallSet?.length) continue;
            if (wallSet[wallSet.length - 1].x === other[0].x && wallSet[wallSet.length - 1].y === other[0].y) {
                connectTo.push(other[0]);
            }
            if (wallSet[0].x === other[other.length - 1].x && wallSet[0].y === other[other.length - 1].y) {
                connectedTo.push(wallSet[0]);
            }
        }

        if (options.offset) {
            wallSet = makeOffsetWalls(wallSet, options.offset);
        }
        wallSet = preprocessWalls(wallSet, options.skipNum);

        const pushSegment = (pointA, pointB) => {
            if (!pointA || !pointB) return;
            if (!(isWithinMap(file, pointA) || isWithinMap(file, pointB))) return;
            const coordinates = wallCoordinates(file, pointA, pointB, options.pixelsPerGrid, sceneOffset);
            if (coordinates) walls.push({ c: coordinates });
        };

        for (let i = 0; i < connectedTo.length; i++) pushSegment(connectedTo[i], wallSet[0]);
        for (let i = 0; i < wallSet.length - 1; i++) pushSegment(wallSet[i], wallSet[i + 1]);
        for (let i = 0; i < connectTo.length; i++) pushSegment(wallSet[wallSet.length - 1], connectTo[i]);
    }

    return walls;
}

/**
 * Portals become doors. Portals that do not block light become windows
 * (proximity sight/light) unless the "openable windows" setting forces every portal to be a door.
 *
 * Door bounds are not run through cave-wall offset. That routine expects a long polyline of
 * points, and applying it to portal records drops or corrupts the doors.
 *
 * @param {object} file
 * @param {object} options
 * @returns {Array<object>}
 */
export function buildDoorData(file, options) {
    const sense = options.senseTypes ?? DEFAULT_SENSE_TYPES;
    const sceneOffset = options.sceneOffset ?? { x: 0, y: 0 };
    const doors = [];

    for (const portal of file.portals ?? []) {
        if (!portal?.bounds || portal.bounds.length < 2) continue;
        const coordinates = wallCoordinates(
            file,
            portal.bounds[0],
            portal.bounds[1],
            options.pixelsPerGrid,
            sceneOffset
        );
        if (!coordinates) continue;
        const blocksLight = !!portal.closed;
        doors.push({
            c: coordinates,
            door: options.openableWindows ? 1 : (blocksLight ? 1 : 0),
            light: blocksLight ? sense.NORMAL : sense.PROXIMITY,
            sight: blocksLight ? sense.NORMAL : sense.PROXIMITY,
            threshold: blocksLight ? {} : { attenuation: true, light: 10, sight: 10 }
        });
    }

    return doors;
}

/**
 * @param {object} file
 * @param {object} options
 * @param {number} options.pixelsPerGrid
 * @param {{x: number, y: number}} [options.sceneOffset]
 * @param {number} [options.gridDistance]
 * @returns {Array<object>}
 */
export function buildLightData(file, options) {
    const sceneOffset = options.sceneOffset ?? { x: 0, y: 0 };
    const gridDistance = options.gridDistance || 1;
    const lights = [];

    for (const light of file.lights ?? []) {
        if (!light?.position || !isWithinMap(file, light.position)) continue;
        const x = ((light.position.x - file.resolution.map_origin.x) * options.pixelsPerGrid) + sceneOffset.x;
        const y = ((light.position.y - file.resolution.map_origin.y) * options.pixelsPerGrid) + sceneOffset.y;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const range = Number(light.range) * gridDistance;
        lights.push({
            x,
            y,
            rotation: 0,
            config: {
                angle: 360,
                color: normalizeLightColor(light.color),
                dim: range,
                bright: range / 2,
                alpha: 0.05 * Number(light.intensity ?? 0)
            }
        });
    }

    return lights;
}

/**
 * Place each file inside a stitched image.
 * @param {object[]} files
 * @param {"x"|"y"|"g"} mode
 * @param {number} pixelsPerGrid
 * @returns {{ width: number, height: number, gridWidth: number, gridHeight: number }}
 */
export function layoutStitchedFiles(files, mode, pixelsPerGrid) {
    const gridSize = {
        x: files[0].resolution.map_size.x,
        y: files[0].resolution.map_size.y
    };
    const size = {
        x: gridSize.x * pixelsPerGrid,
        y: gridSize.y * pixelsPerGrid
    };
    const count = files.length;
    let gridWidth = gridSize.x;
    let gridHeight = gridSize.y;

    if (mode === "y") {
        gridWidth = gridSize.x;
        gridHeight = count * gridSize.y;
        files.forEach((file, index) => {
            file.pos_in_image = { x: 0, y: index * size.y };
            file.pos_in_grid = { x: 0, y: index * gridSize.y };
        });
    } else if (mode === "x") {
        gridWidth = count * gridSize.x;
        gridHeight = gridSize.y;
        files.forEach((file, index) => {
            file.pos_in_image = { y: 0, x: index * size.x };
            file.pos_in_grid = { y: 0, x: index * gridSize.x };
        });
    } else {
        const rowWidth = Math.ceil(Math.sqrt(count));
        let row = 0;
        let remaining = count;
        let index = 0;
        while (remaining > 0) {
            const nextRow = index + rowWidth;
            while (index < Math.min(nextRow, files.length)) {
                files[index].pos_in_image = { y: row * size.y, x: (index - row * rowWidth) * size.x };
                files[index].pos_in_grid = { y: row * gridSize.y, x: (index - row * rowWidth) * gridSize.x };
                index += 1;
            }
            remaining -= rowWidth;
            row += 1;
        }
        gridWidth = rowWidth * gridSize.x;
        gridHeight = row * gridSize.y;
    }

    return {
        width: gridWidth * pixelsPerGrid,
        height: gridHeight * pixelsPerGrid,
        gridWidth,
        gridHeight
    };
}

/**
 * Shift walls, portals, and lights into stitched grid space and optionally frame each file.
 * @param {object[]} files
 * @param {boolean} wallsAroundFiles
 * @returns {object}
 */
export function aggregateStitchedFiles(files, wallsAroundFiles, mapSize = null) {
    const aggregated = {
        resolution: {
            map_origin: {
                x: files[0].resolution.map_origin.x,
                y: files[0].resolution.map_origin.y
            },
            map_size: mapSize ? { x: mapSize.x, y: mapSize.y } : { x: 0, y: 0 },
            pixels_per_grid: files[0].resolution.pixels_per_grid
        },
        line_of_sight: [],
        portals: [],
        lights: []
    };

    let maxX = 0;
    let maxY = 0;
    for (const file of files) {
        const shiftX = file.pos_in_grid?.x ?? 0;
        const shiftY = file.pos_in_grid?.y ?? 0;
        for (const polyline of file.line_of_sight ?? []) {
            aggregated.line_of_sight.push(polyline.map((point) => ({
                x: point.x + shiftX,
                y: point.y + shiftY
            })));
        }
        if (wallsAroundFiles && files.length > 1) {
            const x = shiftX;
            const y = shiftY;
            const w = file.resolution.map_size.x;
            const h = file.resolution.map_size.y;
            aggregated.line_of_sight.push([
                { x, y },
                { x: x + w, y },
                { x: x + w, y: y + h },
                { x, y: y + h },
                { x, y }
            ]);
        }
        for (const portal of file.portals ?? []) {
            aggregated.portals.push({
                ...portal,
                position: portal.position
                    ? { x: portal.position.x + shiftX, y: portal.position.y + shiftY }
                    : portal.position,
                bounds: (portal.bounds ?? []).map((point) => ({ x: point.x + shiftX, y: point.y + shiftY }))
            });
        }
        for (const light of file.lights ?? []) {
            aggregated.lights.push({
                ...light,
                position: {
                    x: light.position.x + shiftX,
                    y: light.position.y + shiftY
                }
            });
        }
        maxX = Math.max(maxX, shiftX + file.resolution.map_size.x);
        maxY = Math.max(maxY, shiftY + file.resolution.map_size.y);
    }

    if (!mapSize) aggregated.resolution.map_size = { x: maxX, y: maxY };
    return aggregated;
}
