import assert from "node:assert/strict";
import test from "node:test";
import {
    aggregateStitchedFiles,
    buildDoorData,
    buildLightData,
    buildWallData,
    computeEffectivePpg,
    getImageType,
    isUniversalVttData,
    isWithinMap,
    layoutStitchedFiles,
    makeOffsetWalls,
    normalizeLightColor,
    preprocessWalls,
    skipCountForFidelity,
    wallCoordinates
} from "../scripts/lib/uvtt-geometry.js";

const mapFile = {
    resolution: {
        map_origin: { x: 0, y: 0 },
        map_size: { x: 10, y: 8 },
        pixels_per_grid: 100
    },
    line_of_sight: [
        [{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 3 }]
    ],
    objects_line_of_sight: [
        [{ x: 2, y: 2 }, { x: 3, y: 2 }]
    ],
    portals: [
        { closed: true, bounds: [{ x: 4, y: 1 }, { x: 4, y: 2 }] },
        { closed: false, bounds: [{ x: 1, y: 3 }, { x: 2, y: 3 }] }
    ],
    lights: [
        { position: { x: 2, y: 2 }, range: 4, intensity: 2, color: "ff112233" },
        { position: { x: 20, y: 20 }, range: 1, intensity: 1, color: "ffffffff" }
    ],
    image: "iVBORw0K"
};

test("pixels per grid shrinks to the browser canvas limit", () => {
    const fitted = computeEffectivePpg(200, 100, 100);
    assert.equal(fitted.scaled, true);
    assert.equal(fitted.ppg, 55);
    assert.equal(fitted.originalPpg, 100);
});

test("pixels per grid is unchanged when the image fits", () => {
    const fitted = computeEffectivePpg(40, 30, 100);
    assert.equal(fitted.scaled, false);
    assert.equal(fitted.ppg, 100);
});

test("maps that cannot fit even at a tiny PPI are rejected", () => {
    assert.throws(() => computeEffectivePpg(2000, 2000, 100), /too large/i);
});

test("image magic bytes and light colors", () => {
    assert.equal(getImageType("\u0089PNG\r\n"), "png");
    assert.equal(getImageType("RIFF...."), "webp");
    assert.equal(getImageType("\u00ff\u00d8\u00ff\u00e0"), "jpeg");
    assert.equal(getImageType("\u00ff\u00d8\u00ff\u00e1"), "jpeg");
    assert.equal(normalizeLightColor("ff112233"), "#112233");
    assert.equal(normalizeLightColor("#abcdef"), "#abcdef");
});

test("universal vtt detection ignores ordinary wall json", () => {
    assert.equal(isUniversalVttData(mapFile), true);
    assert.equal(isUniversalVttData({ walls: [], lights: [], grid: 100 }), false);
});

test("wall coordinates include the scene padding offset", () => {
    assert.deepEqual(
        wallCoordinates(mapFile, { x: 1, y: 1 }, { x: 2, y: 1 }, 100, { x: 50, y: 25 }),
        [150, 125, 250, 125]
    );
});

test("walls, object walls, doors, and in-bounds lights are converted", () => {
    const walls = buildWallData(mapFile, {
        skipNum: 0,
        offset: 0,
        pixelsPerGrid: 100,
        sceneOffset: { x: 0, y: 0 },
        includeObjectWalls: true
    });
    assert.equal(walls.length, 3);
    assert.deepEqual(walls[0].c, [100, 100, 400, 100]);

    const doors = buildDoorData(mapFile, {
        pixelsPerGrid: 100,
        sceneOffset: { x: 0, y: 0 },
        openableWindows: false
    });
    assert.equal(doors[0].door, 1);
    assert.equal(doors[0].sight, 20);
    assert.equal(doors[1].door, 0);
    assert.equal(doors[1].sight, 30);
    assert.equal(doors[1].light, 30);
    assert.deepEqual(doors[1].threshold, { attenuation: true, light: 10, sight: 10 });

    const openable = buildDoorData(mapFile, {
        pixelsPerGrid: 100,
        openableWindows: true
    });
    assert.equal(openable[1].door, 1);

    const lights = buildLightData(mapFile, {
        pixelsPerGrid: 100,
        sceneOffset: { x: 0, y: 0 },
        gridDistance: 5
    });
    assert.equal(lights.length, 1);
    assert.equal(lights[0].x, 200);
    assert.equal(lights[0].config.dim, 20);
    assert.equal(lights[0].config.bright, 10);
    assert.equal(lights[0].config.color, "#112233");
    assert.equal(lights[0].config.alpha, 0.1);
});

test("points outside the cropped map are rejected", () => {
    assert.equal(isWithinMap(mapFile, { x: 0, y: 0 }), true);
    assert.equal(isWithinMap(mapFile, { x: 10, y: 8 }), true);
    assert.equal(isWithinMap(mapFile, { x: 10.1, y: 8 }), false);
});

test("fidelity skip count and short-segment simplification stay stable", () => {
    assert.equal(skipCountForFidelity(1), 5);
    assert.equal(skipCountForFidelity(6), 0);
    const points = Array.from({ length: 8 }, (_, index) => ({ x: index * 0.1, y: 0 }));
    const simplified = preprocessWalls(points.map((point) => ({ ...point })), 1);
    assert.ok(simplified.length < points.length);
    assert.equal(simplified[0].x, 0);
});

test("short polylines are not cave-offset", () => {
    const wall = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
    assert.equal(makeOffsetWalls(wall, 0.4), wall);
});

test("a dense cave polyline is offset instead of returned unchanged", () => {
    const wall = Array.from({ length: 12 }, (_, index) => ({ x: index * 0.1, y: (index % 2) * 0.1 }));
    const offset = makeOffsetWalls(wall.map((point) => ({ ...point })), 0.5);
    assert.notDeepEqual(offset, wall);
    assert.ok(offset.length > 0);
});

test("horizontal stitching shifts the second file and can frame each image", () => {
    const files = [
        {
            name: "a",
            resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 4, y: 2 }, pixels_per_grid: 50 },
            line_of_sight: [[{ x: 0, y: 0 }, { x: 1, y: 0 }]],
            portals: [],
            lights: [{ position: { x: 1, y: 1 }, range: 1, intensity: 1, color: "ff000000" }],
            pos_in_grid: { x: 0, y: 0 }
        },
        {
            name: "b",
            resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 4, y: 2 }, pixels_per_grid: 50 },
            line_of_sight: [[{ x: 0, y: 0 }, { x: 1, y: 0 }]],
            portals: [],
            lights: [],
            pos_in_grid: { x: 4, y: 0 }
        }
    ];
    const layout = layoutStitchedFiles(files, "x", 50);
    assert.equal(layout.width, 400);
    assert.equal(layout.height, 100);
    assert.deepEqual(files[1].pos_in_grid, { x: 4, y: 0 });

    const aggregated = aggregateStitchedFiles(files, true, { x: layout.gridWidth, y: layout.gridHeight });
    assert.deepEqual(aggregated.resolution.map_size, { x: 8, y: 2 });
    assert.equal(aggregated.line_of_sight.length, 4);
    assert.deepEqual(aggregated.line_of_sight[2][0], { x: 4, y: 0 });
    assert.equal(aggregated.lights[0].position.x, 1);
});
