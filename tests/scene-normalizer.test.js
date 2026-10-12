import assert from "node:assert/strict";
import test from "node:test";
import { SceneDataNormalizer } from "../scripts/lib/scene-data-normalizer.js";

const normalizer = new SceneDataNormalizer();

test("normalizes Dungeon Alchemist style exports into the v14 scene shape", () => {
    const normalized = normalizer.normalizeToFoundryFormat({
        name: "Crypt",
        width: 2000,
        height: 1500,
        grid: 128,
        gridType: 1,
        shiftX: 10,
        shiftY: 20,
        globalLight: true,
        darkness: 0.4,
        padding: 0.1,
        walls: [{ c: [0, 0, 10, 0], door: 1, move: "normal", sense: "limited" }],
        lights: [{ x: 5, y: 6, bright: 2, dim: 4, tintColor: "#ff0000", tintAlpha: 0.5 }]
    });

    assert.equal(normalized.grid.size, 128);
    assert.equal(normalized.grid.type, 1);
    assert.equal(normalized.grid.offset.x, 10);
    assert.equal(normalized.grid.offset.y, 20);
    assert.equal(normalized.shiftX, 10);
    assert.equal(normalized.shiftY, 20);
    assert.equal(normalized.environment.globalLight.enabled, true);
    assert.equal(normalized.environment.darknessLevel, 0.4);
    assert.equal(normalized.globalLight, undefined);
    assert.equal(normalized.walls[0].move, 20);
    assert.equal(normalized.walls[0].sight, 10);
    assert.equal(normalized.walls[0].door, 1);
    assert.equal(normalized.lights[0].config.bright, 2);
    assert.equal(normalized.lights[0].config.dim, 4);
    assert.equal(normalized.lights[0].config.color, "#ff0000");
    assert.equal(normalized.lights[0].config.alpha, 0.5);
});

test("keeps Foundry light config and v14 environment fields", () => {
    const normalized = normalizer.normalizeToFoundryFormat({
        environment: { darknessLevel: 0.2, globalLight: { enabled: false } },
        grid: { size: 70, type: 1, distance: 5, units: "ft", offset: { x: 3, y: 4 } },
        lights: [{
            x: 8,
            y: 9,
            rotation: 15,
            config: { bright: 10, dim: 20, color: "#00ff00", angle: 90 }
        }]
    });

    assert.equal(normalized.environment.darknessLevel, 0.2);
    assert.equal(normalized.environment.globalLight.enabled, false);
    assert.equal(normalized.shiftX, 3);
    assert.equal(normalized.shiftY, 4);
    assert.equal(normalized.lights[0].config.bright, 10);
    assert.equal(normalized.lights[0].config.angle, 90);
    assert.equal(normalized.lights[0].rotation, 15);
    assert.equal(normalized.lights[0].elevation, undefined);
});
