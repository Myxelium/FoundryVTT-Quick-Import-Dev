/**
 * Read Universal VTT map files (.dd2vtt, .df2vtt, .uvtt) and turn them into
 * Foundry v14 scene data. The JSON shape is the published map format used by
 * several battlemap tools. The conversion here belongs to this module.
 */

import { DEFAULT_LEVEL_ID } from "./constants.js";
import { buildLayeredSceneData } from "./scene-payload.js";

/** Largest canvas side this importer will allocate. */
const MAX_CANVAS_SIDE = 8192;

/** Largest canvas area this importer will allocate. */
const MAX_CANVAS_PIXELS = 8192 * 8192;

/** Smallest pixels-per-cell that still produces a usable scene. */
const MIN_PIXELS_PER_CELL = 10;

/**
 * Saved defaults for the Universal VTT tab.
 * @param {string} [worldId]
 * @returns {object}
 */
export function defaultUniversalSettings(worldId = "") {
    const folder = worldId ? `worlds/${worldId}/quick-battlemap` : "quick-battlemap";
    return {
        source: "data",
        bucket: "",
        path: folder,
        detail: 3,
        nudge: 0,
        padding: 0.25,
        layout: "levels",
        webp: true,
        webpQuality: 0.8,
        objectWalls: true,
        frameMaps: true,
        customCellSize: false,
        cellSize: 100
    };
}

/**
 * @param {object|null|undefined} data
 * @returns {boolean}
 */
export function isUniversalMap(data) {
    const size = data?.resolution?.map_size;
    return !!data
        && typeof data === "object"
        && Number.isFinite(Number(size?.x))
        && Number.isFinite(Number(size?.y))
        && (Array.isArray(data.line_of_sight) || typeof data.image === "string");
}

/**
 * @param {Uint8Array} bytes
 * @returns {"png"|"jpeg"|"webp"}
 */
export function imageKind(bytes) {
    if (bytes?.[0] === 0x89 && bytes?.[1] === 0x50 && bytes?.[2] === 0x4e && bytes?.[3] === 0x47) {
        return "png";
    }
    if (bytes?.[0] === 0xff && bytes?.[1] === 0xd8) return "jpeg";
    if (bytes?.[0] === 0x52 && bytes?.[1] === 0x49 && bytes?.[2] === 0x46 && bytes?.[3] === 0x46) {
        return "webp";
    }
    return "png";
}

/**
 * Universal VTT colors are often AARRGGBB. Foundry wants RRGGBB.
 * @param {string} value
 * @returns {string}
 */
export function cssColor(value) {
    if (typeof value !== "string") return "#ffffff";
    const hex = value.trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{8}$/.test(hex)) return `#${hex.slice(2).toLowerCase()}`;
    if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toLowerCase()}`;
    return "#ffffff";
}

/**
 * @param {object} raw
 * @param {string} [levelName]
 * @returns {object}
 */
export function interpretMap(raw, levelName) {
    const width = Number(raw?.resolution?.map_size?.x);
    const height = Number(raw?.resolution?.map_size?.y);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error("This file is not a Universal VTT map.");
    }
    const origin = raw.resolution?.map_origin ?? {};
    return {
        levelName: levelName || "Map",
        origin: { x: numberOr(origin.x, 0), y: numberOr(origin.y, 0) },
        cells: { x: width, y: height },
        pixelsPerCell: numberOr(raw.resolution?.pixels_per_grid, 100),
        image: typeof raw.image === "string" ? raw.image : "",
        chains: asChains(raw.line_of_sight),
        objectChains: asChains(raw.objects_line_of_sight),
        portals: Array.isArray(raw.portals) ? raw.portals : [],
        lights: Array.isArray(raw.lights) ? raw.lights : []
    };
}

/**
 * Drop points that sit on the straight line between their neighbors.
 * `detail` runs from 1 (coarse) to 6 (keep every bend).
 *
 * @param {{x:number,y:number}[]} points
 * @param {number} detail
 * @returns {{x:number,y:number}[]}
 */
export function simplifyChain(points, detail) {
    const source = (points ?? []).map(copyPoint);
    if (source.length < 3) return source;
    const closed = samePoint(source[0], source[source.length - 1]);
    const open = closed ? source.slice(0, -1) : source;
    const simplified = simplifyOpen(open, epsilonForDetail(detail));
    if (closed && simplified.length) simplified.push(copyPoint(simplified[0]));
    return simplified;
}

/**
 * Shift a polyline to its left by `distance` grid cells.
 * A negative distance shifts it to the right. Joins are mitered, and a wild
 * miter falls back to the shifted endpoint.
 *
 * @param {{x:number,y:number}[]} points
 * @param {number} distance
 * @returns {{x:number,y:number}[]}
 */
export function nudgeChain(points, distance) {
    const source = (points ?? []).map(copyPoint);
    if (!distance || source.length < 2) return source;
    return offsetPolyline(source, distance);
}

/**
 * Choose a pixels-per-cell value that fits the browser canvas.
 * @param {number} cellsWide
 * @param {number} cellsHigh
 * @param {number} requested
 * @returns {{pixelsPerCell:number, reduced:boolean, requested:number}}
 */
export function fitPixelsPerCell(cellsWide, cellsHigh, requested) {
    const wide = Math.max(1, cellsWide);
    const high = Math.max(1, cellsHigh);
    let pixels = Math.max(1, Math.floor(numberOr(requested, 100)));
    let reduced = false;

    const longest = Math.max(wide, high);
    if (longest * pixels > MAX_CANVAS_SIDE) {
        pixels = Math.floor(MAX_CANVAS_SIDE / longest);
        reduced = true;
    }
    if (wide * high * pixels * pixels > MAX_CANVAS_PIXELS) {
        const fromArea = Math.floor(Math.sqrt(MAX_CANVAS_PIXELS / (wide * high)));
        if (fromArea < pixels) {
            pixels = fromArea;
            reduced = true;
        }
    }
    if (pixels < MIN_PIXELS_PER_CELL) {
        const error = new Error(`This map is too large to import (${wide} by ${high} cells).`);
        error.code = "MAP_TOO_LARGE";
        throw error;
    }
    return { pixelsPerCell: pixels, reduced, requested };
}

/**
 * Turn one or more Universal VTT documents into a v14 scene plus image jobs.
 *
 * @param {object[]} rawMaps
 * @param {object} [options]
 * @returns {object}
 */
export function planUniversalImport(rawMaps, options = {}) {
    if (!rawMaps?.length) throw new Error("No maps to import.");
    const maps = rawMaps.map((raw, index) => interpretMap(raw, options.names?.[index]));
    const layout = maps.length > 1 ? (options.layout || "levels") : "levels";
    const grid = measureLayout(maps, layout);
    const requested = options.customCellSize
        ? numberOr(options.cellSize, maps[0].pixelsPerCell)
        : maps[0].pixelsPerCell;
    const fit = fitPixelsPerCell(grid.cellsWide, grid.cellsHigh, requested);
    const pixels = fit.pixelsPerCell;
    const width = Math.round(grid.cellsWide * pixels);
    const height = Math.round(grid.cellsHigh * pixels);
    const padding = numberOr(options.padding, 0);
    const pad = {
        x: Math.ceil(width * padding),
        y: Math.ceil(height * padding)
    };
    const combined = grid.layout !== "levels";
    const frame = !!options.frameMaps && combined && maps.length > 1;
    const levels = [];
    const walls = [];
    const lights = [];
    const jobs = [];

    for (const slot of grid.slots) {
        const map = maps[slot.index];
        const levelId = levelIdFor(slot.level, options.levelIds);
        if (!levels[slot.level]) {
            levels[slot.level] = {
                _id: levelId,
                name: combined ? (options.sceneName || map.levelName) : map.levelName,
                background: { src: "" }
            };
        }
        const built = placeablesForMap(map, {
            slot,
            pixels,
            pad,
            levelId,
            detail: options.detail ?? 3,
            nudge: numberOr(options.nudge, 0),
            objectWalls: options.objectWalls !== false,
            frame,
            windowsAreDoors: !!options.windowsAreDoors,
            gridDistance: numberOr(options.gridDistance, 5)
        });
        walls.push(...built.walls);
        lights.push(...built.lights);
        jobs.push({
            sourceIndex: slot.index,
            outputId: combined ? "combined" : `level-${slot.level}`,
            x: Math.round(slot.x * pixels),
            y: Math.round(slot.y * pixels),
            width: Math.round(map.cells.x * pixels),
            height: Math.round(map.cells.y * pixels)
        });
    }

    const outputs = combined
        ? [{
            id: "combined",
            levelIndex: 0,
            width,
            height,
            name: fileStem(options.combinedName || options.sceneName || maps.map((map) => map.levelName).join("-"))
        }]
        : levels.map((level, index) => ({
            id: `level-${index}`,
            levelIndex: index,
            width,
            height,
            name: fileStem(level.name)
        }));

    const uniform = maps.every((map) => map.cells.x === maps[0].cells.x && map.cells.y === maps[0].cells.y);
    const scene = buildLayeredSceneData({
        sceneName: options.sceneName || maps[0].levelName || "Imported map",
        width,
        height,
        padding,
        grid: {
            size: pixels,
            type: 1,
            distance: numberOr(options.gridDistance, 5),
            units: options.gridUnits || "ft"
        },
        levels,
        walls,
        lights
    });

    return {
        scene,
        maps,
        jobs,
        outputs,
        combined,
        pixelsPerCell: pixels,
        requestedPixels: fit.requested,
        reduced: fit.reduced,
        directUpload: !combined && !fit.reduced && !options.webp && uniform
    };
}

/**
 * @param {object[]} maps
 * @param {string} layout
 * @returns {{layout:string, cellsWide:number, cellsHigh:number, slots:object[]}}
 */
function measureLayout(maps, layout) {
    if (layout === "horizontal") {
        let cursor = 0;
        const slots = maps.map((map, index) => {
            const slot = { index, x: cursor, y: 0, level: 0 };
            cursor += map.cells.x;
            return slot;
        });
        return {
            layout,
            cellsWide: cursor,
            cellsHigh: Math.max(...maps.map((map) => map.cells.y)),
            slots
        };
    }
    if (layout === "vertical") {
        let cursor = 0;
        const slots = maps.map((map, index) => {
            const slot = { index, x: 0, y: cursor, level: 0 };
            cursor += map.cells.y;
            return slot;
        });
        return {
            layout,
            cellsWide: Math.max(...maps.map((map) => map.cells.x)),
            cellsHigh: cursor,
            slots
        };
    }
    if (layout === "tiled") {
        const columns = Math.ceil(Math.sqrt(maps.length));
        const cellW = Math.max(...maps.map((map) => map.cells.x));
        const cellH = Math.max(...maps.map((map) => map.cells.y));
        const rows = Math.ceil(maps.length / columns);
        const slots = maps.map((map, index) => ({
            index,
            x: (index % columns) * cellW,
            y: Math.floor(index / columns) * cellH,
            level: 0
        }));
        return { layout, cellsWide: columns * cellW, cellsHigh: rows * cellH, slots };
    }
    return {
        layout: "levels",
        cellsWide: Math.max(...maps.map((map) => map.cells.x)),
        cellsHigh: Math.max(...maps.map((map) => map.cells.y)),
        slots: maps.map((map, index) => ({ index, x: 0, y: 0, level: index }))
    };
}

/**
 * @param {object} map
 * @param {object} placement
 * @returns {{walls:object[], lights:object[]}}
 */
function placeablesForMap(map, placement) {
    const chains = map.chains.slice();
    if (placement.objectWalls) chains.push(...map.objectChains);
    const walls = [];
    for (const chain of chains) {
        if (!chainTouchesMap(chain, map)) continue;
        const simplified = simplifyChain(chain, placement.detail);
        const nudged = nudgeChain(simplified, placement.nudge);
        walls.push(...segmentsToWalls(nudged, map, placement, false));
    }
    for (const portal of map.portals) {
        const bounds = portal?.bounds;
        if (!Array.isArray(bounds) || bounds.length < 2) continue;
        walls.push(...segmentsToWalls(bounds.slice(0, 2), map, placement, true, portal));
    }
    if (placement.frame) {
        const x0 = placement.slot.x;
        const y0 = placement.slot.y;
        const x1 = x0 + map.cells.x;
        const y1 = y0 + map.cells.y;
        const frame = [
            [{ x: x0, y: y0 }, { x: x1, y: y0 }],
            [{ x: x1, y: y0 }, { x: x1, y: y1 }],
            [{ x: x1, y: y1 }, { x: x0, y: y1 }],
            [{ x: x0, y: y1 }, { x: x0, y: y0 }]
        ];
        for (const segment of frame) {
            walls.push(wallFromPixels(
                toPixel(segment[0], map, placement, true),
                toPixel(segment[1], map, placement, true),
                placement.levelId
            ));
        }
    }

    const lights = [];
    for (const light of map.lights) {
        const position = light?.position;
        if (!position || !insideMap(map, position)) continue;
        const pixel = toPixel(position, map, placement, false);
        const reach = Math.max(0, Number(light.range) || 0) * placement.gridDistance;
        lights.push({
            x: pixel.x,
            y: pixel.y,
            rotation: 0,
            hidden: false,
            walls: true,
            vision: false,
            config: {
                angle: 360,
                color: cssColor(light.color),
                dim: reach,
                bright: reach / 2,
                alpha: Math.min(1, Math.max(0, (Number(light.intensity) || 0) * 0.05))
            },
            levels: [placement.levelId]
        });
    }
    return { walls, lights };
}

/**
 * @param {{x:number,y:number}[]} points
 * @param {object} map
 * @param {object} placement
 * @param {boolean} alreadyPlaced
 * @param {object} [portal]
 * @returns {object[]}
 */
function segmentsToWalls(points, map, placement, alreadyPlaced, portal) {
    const walls = [];
    for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        if (!start || !end || samePoint(start, end)) continue;
        const pixelA = toPixel(start, map, placement, alreadyPlaced);
        const pixelB = toPixel(end, map, placement, alreadyPlaced);
        if (![pixelA.x, pixelA.y, pixelB.x, pixelB.y].every(Number.isFinite)) continue;
        walls.push(portal
            ? portalToWall(portal, pixelA, pixelB, placement)
            : wallFromPixels(pixelA, pixelB, placement.levelId));
    }
    return walls;
}

/**
 * Frame coordinates are already in placed cell space. Map coordinates are not.
 * @param {{x:number,y:number}} point
 * @param {object} map
 * @param {object} placement
 * @param {boolean} alreadyPlaced
 * @returns {{x:number,y:number}}
 */
function toPixel(point, map, placement, alreadyPlaced) {
    const localX = alreadyPlaced ? point.x : (point.x - map.origin.x + placement.slot.x);
    const localY = alreadyPlaced ? point.y : (point.y - map.origin.y + placement.slot.y);
    return {
        x: localX * placement.pixels + placement.pad.x,
        y: localY * placement.pixels + placement.pad.y
    };
}

/**
 * @param {{x:number,y:number}} start
 * @param {{x:number,y:number}} end
 * @param {string} levelId
 * @returns {object}
 */
function wallFromPixels(start, end, levelId) {
    const sense = wallSenses();
    return {
        c: [start.x, start.y, end.x, end.y],
        door: 0,
        ds: 0,
        dir: 0,
        move: sense.NORMAL,
        sight: sense.NORMAL,
        sound: sense.NORMAL,
        light: sense.NORMAL,
        levels: [levelId]
    };
}

/**
 * @param {object} portal
 * @param {{x:number,y:number}} start
 * @param {{x:number,y:number}} end
 * @param {object} placement
 * @returns {object}
 */
function portalToWall(portal, start, end, placement) {
    const sense = wallSenses();
    const blocksLight = !!portal.closed;
    const asDoor = blocksLight || placement.windowsAreDoors;
    const passage = blocksLight ? sense.NORMAL : sense.PROXIMITY;
    const wall = {
        c: [start.x, start.y, end.x, end.y],
        door: asDoor ? 1 : 0,
        ds: 0,
        dir: 0,
        move: sense.NORMAL,
        sight: passage,
        sound: blocksLight ? sense.NORMAL : sense.NONE,
        light: passage,
        levels: [placement.levelId]
    };
    if (!blocksLight) wall.threshold = { attenuation: true, light: 10, sight: 10 };
    return wall;
}

/**
 * @returns {object}
 */
function wallSenses() {
    return globalThis.CONST?.WALL_SENSE_TYPES ?? {
        NONE: 0,
        LIMITED: 10,
        NORMAL: 20,
        PROXIMITY: 30,
        DISTANCE: 40
    };
}

/**
 * @param {number} levelIndex
 * @param {string[]|undefined} provided
 * @returns {string}
 */
function levelIdFor(levelIndex, provided) {
    if (levelIndex === 0) return DEFAULT_LEVEL_ID;
    return provided?.[levelIndex] || `quick-battlemap-level-${levelIndex + 1}`;
}

/**
 * @param {object} map
 * @param {{x:number,y:number}} point
 * @returns {boolean}
 */
function insideMap(map, point) {
    return point.x >= map.origin.x
        && point.x <= map.origin.x + map.cells.x
        && point.y >= map.origin.y
        && point.y <= map.origin.y + map.cells.y;
}

/**
 * @param {{x:number,y:number}[]} chain
 * @param {object} map
 * @returns {boolean}
 */
function chainTouchesMap(chain, map) {
    return chain.some((point) => point && insideMap(map, point));
}

/**
 * @param {number} detail
 * @returns {number}
 */
function epsilonForDetail(detail) {
    const level = Math.min(6, Math.max(1, Math.round(numberOr(detail, 3))));
    if (level >= 6) return 0;
    return (6 - level) * 0.15;
}

/**
 * @param {{x:number,y:number}[]} points
 * @param {number} epsilon
 * @returns {{x:number,y:number}[]}
 */
function simplifyOpen(points, epsilon) {
    if (points.length < 3) return points.map(copyPoint);
    let farthest = 0;
    let farthestIndex = 0;
    for (let index = 1; index < points.length - 1; index += 1) {
        const span = distanceToSegment(points[index], points[0], points[points.length - 1]);
        if (span > farthest) {
            farthest = span;
            farthestIndex = index;
        }
    }
    if (farthest <= epsilon) return [copyPoint(points[0]), copyPoint(points[points.length - 1])];
    const left = simplifyOpen(points.slice(0, farthestIndex + 1), epsilon);
    const right = simplifyOpen(points.slice(farthestIndex), epsilon);
    return left.slice(0, -1).concat(right);
}

/**
 * @param {{x:number,y:number}[]} points
 * @param {number} distance
 * @returns {{x:number,y:number}[]}
 */
function offsetPolyline(points, distance) {
    const closed = points.length > 2 && samePoint(points[0], points[points.length - 1]);
    const ring = closed ? points.slice(0, -1) : points;
    if (ring.length < 2) return points.map(copyPoint);

    const shifted = [];
    const segmentCount = closed ? ring.length : ring.length - 1;
    for (let index = 0; index < segmentCount; index += 1) {
        const start = ring[index];
        const end = ring[(index + 1) % ring.length];
        const normal = leftNormal(start, end, distance);
        shifted.push({
            a: { x: start.x + normal.x, y: start.y + normal.y },
            b: { x: end.x + normal.x, y: end.y + normal.y }
        });
    }

    const vertices = [];
    if (!closed) vertices.push(copyPoint(shifted[0].a));
    const joins = closed ? shifted.length : shifted.length - 1;
    for (let index = 0; index < joins; index += 1) {
        const current = shifted[index];
        const next = shifted[(index + 1) % shifted.length];
        const anchor = ring[(index + 1) % ring.length];
        const hit = lineIntersection(current.a, current.b, next.a, next.b);
        if (!hit || Math.hypot(hit.x - anchor.x, hit.y - anchor.y) > Math.abs(distance) * 4) {
            vertices.push(copyPoint(current.b));
        } else {
            vertices.push(hit);
        }
    }
    if (!closed) vertices.push(copyPoint(shifted[shifted.length - 1].b));
    if (closed && vertices.length) vertices.push(copyPoint(vertices[0]));
    return vertices;
}

/**
 * @param {{x:number,y:number}} start
 * @param {{x:number,y:number}} end
 * @param {number} distance
 * @returns {{x:number,y:number}}
 */
function leftNormal(start, end, distance) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: (-dy / length) * distance, y: (dx / length) * distance };
}

/**
 * @param {{x:number,y:number}} p1
 * @param {{x:number,y:number}} p2
 * @param {{x:number,y:number}} p3
 * @param {{x:number,y:number}} p4
 * @returns {{x:number,y:number}|null}
 */
function lineIntersection(p1, p2, p3, p4) {
    const dx1 = p2.x - p1.x;
    const dy1 = p2.y - p1.y;
    const dx2 = p4.x - p3.x;
    const dy2 = p4.y - p3.y;
    const denom = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(denom) < 1e-9) return null;
    const t = ((p3.x - p1.x) * dy2 - (p3.y - p1.y) * dx2) / denom;
    return { x: p1.x + t * dx1, y: p1.y + t * dy1 };
}

/**
 * @param {{x:number,y:number}} point
 * @param {{x:number,y:number}} start
 * @param {{x:number,y:number}} end
 * @returns {number}
 */
function distanceToSegment(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq === 0) return Math.hypot(point.x - start.x, point.y - start.y);
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq));
    return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

/**
 * @param {unknown} value
 * @returns {{x:number,y:number}[][]}
 */
function asChains(value) {
    if (!Array.isArray(value)) return [];
    return value.filter((chain) => Array.isArray(chain));
}

/**
 * @param {{x:number,y:number}} point
 * @returns {{x:number,y:number}}
 */
function copyPoint(point) {
    return { x: Number(point?.x) || 0, y: Number(point?.y) || 0 };
}

/**
 * @param {{x:number,y:number}} a
 * @param {{x:number,y:number}} b
 * @returns {boolean}
 */
function samePoint(a, b) {
    return a.x === b.x && a.y === b.y;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function numberOr(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * @param {string} name
 * @returns {string}
 */
function fileStem(name) {
    const cleaned = String(name || "map").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
    return cleaned || "map";
}
