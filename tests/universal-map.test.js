import assert from "node:assert/strict";
import test from "node:test";
import { optionsFromForm } from "../scripts/lib/universal-map-import.js";
import {
    cssColor,
    fitPixelsPerCell,
    imageKind,
    isUniversalMap,
    nudgeChain,
    planUniversalImport,
    simplifyChain
} from "../scripts/lib/universal-map.js";

function mapFile(overrides = {}) {
    return {
        resolution: {
            map_origin: { x: 0, y: 0 },
            map_size: { x: 10, y: 8 },
            pixels_per_grid: 100,
            ...overrides.resolution
        },
        line_of_sight: overrides.line_of_sight ?? [[{ x: 0, y: 0 }, { x: 1, y: 0 }]],
        objects_line_of_sight: overrides.objects_line_of_sight ?? [],
        portals: overrides.portals ?? [],
        lights: overrides.lights ?? [],
        image: overrides.image ?? "abc"
    };
}

test("recognizes a universal vtt document", () => {
    assert.equal(isUniversalMap(mapFile()), true);
    assert.equal(isUniversalMap({ walls: [], grid: 100 }), false);
});

test("keeps every bend at full detail and drops a shallow bump when coarse", () => {
    const chain = [{ x: 0, y: 0 }, { x: 1, y: 0.01 }, { x: 2, y: 0 }];
    assert.equal(simplifyChain(chain, 6).length, 3);
    assert.equal(simplifyChain(chain, 1).length, 2);
});

test("nudges a horizontal segment to the left of its direction", () => {
    const moved = nudgeChain([{ x: 0, y: 0 }, { x: 2, y: 0 }], 1);
    assert.deepEqual(moved, [{ x: 0, y: 1 }, { x: 2, y: 1 }]);
    assert.deepEqual(nudgeChain([{ x: 0, y: 0 }, { x: 2, y: 0 }], 0), [{ x: 0, y: 0 }, { x: 2, y: 0 }]);
});

test("shrinks pixels per cell when the raster would exceed the canvas", () => {
    const fit = fitPixelsPerCell(100, 80, 200);
    assert.equal(fit.reduced, true);
    assert.ok(fit.pixelsPerCell * 100 <= 8192);
    assert.throws(() => fitPixelsPerCell(2000, 2000, 100), /too large/);
});

test("reads image signatures and map colors", () => {
    assert.equal(imageKind(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])), "png");
    assert.equal(imageKind(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1])), "jpeg");
    assert.equal(imageKind(Uint8Array.from([0x52, 0x49, 0x46, 0x46])), "webp");
    assert.equal(cssColor("ff112233"), "#112233");
    assert.equal(cssColor("#abcdef"), "#abcdef");
});

test("builds a v14 scene from one map", () => {
    const plan = planUniversalImport([mapFile({
        lights: [{ position: { x: 2, y: 3 }, range: 4, intensity: 1, color: "ff112233" }],
        portals: [{ closed: true, bounds: [{ x: 4, y: 1 }, { x: 4, y: 2 }] }]
    })], {
        sceneName: "Crypt",
        names: ["Cellar"],
        padding: 0,
        webp: false,
        gridDistance: 5
    });

    assert.equal(plan.scene.name, "Crypt");
    assert.equal(plan.scene.img, undefined);
    assert.equal(plan.scene.grid.offset, undefined);
    assert.equal(plan.scene.grid.size, 100);
    assert.equal(plan.scene.initialLevel, "defaultLevel0000");
    assert.equal(plan.scene.levels[0]._id, "defaultLevel0000");
    assert.equal(plan.scene.levels[0].name, "Cellar");
    assert.equal(plan.scene.environment.globalLight.enabled, false);
    assert.deepEqual(plan.scene.walls[0].c, [0, 0, 100, 0]);
    assert.deepEqual(plan.scene.walls[0].levels, ["defaultLevel0000"]);
    const door = plan.scene.walls.find((wall) => wall.door === 1);
    assert.equal(door.sight, 20);
    assert.equal(plan.scene.lights[0].config.color, "#112233");
    assert.equal(plan.scene.lights[0].config.dim, 20);
    assert.equal(plan.scene.lights[0].config.bright, 10);
    assert.equal(plan.directUpload, true);
});

test("accounts for map origin and scene padding", () => {
    const plan = planUniversalImport([mapFile({
        resolution: { map_origin: { x: 2, y: 1 }, map_size: { x: 4, y: 4 }, pixels_per_grid: 50 },
        line_of_sight: [[{ x: 2, y: 1 }, { x: 3, y: 1 }]]
    })], { padding: 0.25, webp: false, names: ["Room"] });

    const padX = Math.ceil(plan.scene.width * 0.25);
    const padY = Math.ceil(plan.scene.height * 0.25);
    assert.deepEqual(plan.scene.walls[0].c, [padX, padY, padX + 50, padY]);
});

test("includes object walls only when asked, and treats open portals as windows", () => {
    const raw = mapFile({
        objects_line_of_sight: [[{ x: 0, y: 2 }, { x: 2, y: 2 }]],
        portals: [{ closed: false, bounds: [{ x: 1, y: 1 }, { x: 2, y: 1 }] }]
    });
    const without = planUniversalImport([raw], { objectWalls: false, padding: 0, webp: false });
    const withObjects = planUniversalImport([raw], { objectWalls: true, padding: 0, webp: false });
    assert.equal(without.scene.walls.length, 2);
    assert.equal(withObjects.scene.walls.length, 3);
    const windowWall = without.scene.walls.find((wall) => wall.sight === 30);
    assert.equal(windowWall.door, 0);
    assert.equal(windowWall.threshold.sight, 10);

    const openable = planUniversalImport([raw], {
        objectWalls: false,
        windowsAreDoors: true,
        padding: 0,
        webp: false
    });
    assert.equal(openable.scene.walls.find((wall) => wall.sight === 30).door, 1);
});

test("places several maps side by side, stacked, tiled, or on separate levels", () => {
    const first = mapFile({ resolution: { map_size: { x: 2, y: 4 }, pixels_per_grid: 10 } });
    const second = mapFile({ resolution: { map_size: { x: 3, y: 4 }, pixels_per_grid: 10 } });
    const third = mapFile({ resolution: { map_size: { x: 2, y: 2 }, pixels_per_grid: 10 } });
    const options = { padding: 0, webp: true, frameMaps: false, objectWalls: false };

    const side = planUniversalImport([first, second], { ...options, layout: "horizontal" });
    assert.equal(side.scene.width, 50);
    assert.equal(side.scene.levels.length, 1);
    assert.equal(side.combined, true);
    assert.equal(side.jobs[1].x, 20);

    const stacked = planUniversalImport([first, second], { ...options, layout: "vertical" });
    assert.equal(stacked.scene.height, 80);
    assert.equal(stacked.jobs[1].y, 40);

    const tiled = planUniversalImport([first, second, third], { ...options, layout: "tiled" });
    assert.equal(tiled.scene.width, 60);
    assert.equal(tiled.scene.height, 80);

    const levels = planUniversalImport([first, second], { ...options, layout: "levels", names: ["A", "B"] });
    assert.equal(levels.scene.levels.length, 2);
    assert.equal(levels.scene.levels[0]._id, "defaultLevel0000");
    assert.equal(levels.scene.levels[1].name, "B");
    assert.deepEqual(levels.scene.walls[0].levels, ["defaultLevel0000"]);
    assert.notDeepEqual(levels.scene.walls.at(-1).levels, ["defaultLevel0000"]);
    assert.equal(levels.directUpload, false);
});

test("reads the universal vtt form into import options", () => {
    const options = optionsFromForm({
        sceneName: "Crypt",
        source: "data",
        detail: "6",
        nudge: "0.5",
        padding: "0.1",
        layout: "tiled",
        toWebp: false,
        objectWalls: false,
        frameMaps: true,
        customCellSize: true,
        cellSize: "128"
    }, { windowsAreDoors: true, gridDistance: 5, gridUnits: "ft" });
    assert.equal(options.detail, 6);
    assert.equal(options.nudge, 0.5);
    assert.equal(options.layout, "tiled");
    assert.equal(options.webp, false);
    assert.equal(options.objectWalls, false);
    assert.equal(options.customCellSize, true);
    assert.equal(options.cellSize, 128);
    assert.equal(options.windowsAreDoors, true);
});

test("adds a frame around each stitched map", () => {
    const raw = mapFile({ resolution: { map_size: { x: 2, y: 2 }, pixels_per_grid: 10 }, line_of_sight: [] });
    const plan = planUniversalImport([raw, raw], {
        layout: "horizontal",
        frameMaps: true,
        padding: 0,
        webp: true
    });
    assert.equal(plan.scene.walls.length, 8);
});
