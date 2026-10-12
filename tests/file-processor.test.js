import assert from "node:assert/strict";
import test from "node:test";
import { FileProcessor, isUniversalVttData } from "../scripts/lib/file-processor.js";

const processor = new FileProcessor();

test("classifies quick-import media and universal vtt exports", () => {
    assert.equal(processor.getFileType({ name: "map.png", type: "" }), "image");
    assert.equal(processor.getFileType({ name: "map.WEBM", type: "" }), "video");
    assert.equal(processor.getFileType({ name: "walls.json", type: "" }), "json");
    assert.equal(processor.getFileType({ name: "crypt.dd2vtt", type: "application/json" }), "uvtt");
    assert.equal(processor.getFileType({ name: "crypt.df2vtt", type: "" }), "uvtt");
    assert.equal(processor.getFileType({ name: "crypt.uvtt", type: "application/octet-stream" }), "uvtt");
    assert.equal(processor.getFileType({ name: "notes.txt", type: "text/plain" }), "unknown");
});

test("recognizes universal vtt json without treating wall exports as maps", () => {
    assert.equal(isUniversalVttData({
        resolution: { map_size: { x: 10, y: 8 } },
        line_of_sight: []
    }), true);
    assert.equal(isUniversalVttData({ walls: [], lights: [], grid: 100 }), false);
});
