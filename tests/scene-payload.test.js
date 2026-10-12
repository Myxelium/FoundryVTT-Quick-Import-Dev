import assert from "node:assert/strict";
import test from "node:test";
import { buildV14SceneData } from "../scripts/lib/scene-payload.js";

test("v14 scene data puts the background on a level and illumination on the environment", () => {
    const data = buildV14SceneData({
        sceneName: "Crypt",
        backgroundPath: "worlds/demo/quick-battlemap/crypt.png",
        width: 2000,
        height: 1500,
        normalized: {
            padding: 0.25,
            backgroundColor: "#112233",
            shiftX: 12,
            shiftY: 34,
            grid: {
                size: 128,
                type: 1,
                distance: 5,
                units: "ft",
                color: "#ffffff",
                alpha: 0.4
            },
            environment: {
                darknessLevel: 0.35,
                globalLight: { enabled: true }
            },
            walls: [{ c: [0, 0, 10, 0] }],
            lights: [{ x: 5, y: 6, config: { bright: 10, dim: 20 } }]
        }
    });

    assert.equal(data.name, "Crypt");
    assert.equal(data.img, undefined);
    assert.equal(data.background, undefined);
    assert.equal(data.globalLight, undefined);
    assert.equal(data.darkness, undefined);
    assert.equal(data.grid.offset, undefined);
    assert.equal(data.shiftX, 12);
    assert.equal(data.shiftY, 34);
    assert.equal(data.grid.size, 128);
    assert.equal(data.grid.type, 1);
    assert.equal(data.environment.darknessLevel, 0.35);
    assert.equal(data.environment.globalLight.enabled, true);
    assert.equal(data.initialLevel, "defaultLevel0000");
    assert.equal(data.levels[0]._id, "defaultLevel0000");
    assert.equal(data.levels[0].background.src, "worlds/demo/quick-battlemap/crypt.png");
    assert.deepEqual(data.walls[0].levels, ["defaultLevel0000"]);
    assert.deepEqual(data.lights[0].levels, ["defaultLevel0000"]);
});

test("placeables that already name a level keep that level", () => {
    const data = buildV14SceneData({
        sceneName: "Tower",
        backgroundPath: "tower.webp",
        width: 100,
        height: 100,
        levelId: "defaultLevel0000",
        normalized: {
            grid: { size: 100, type: 0, distance: 5, units: "ft", color: "#000000", alpha: 0.2 },
            walls: [{ c: [1, 1, 2, 2], levels: ["upper"] }]
        }
    });

    assert.deepEqual(data.walls[0].levels, ["upper"]);
});
