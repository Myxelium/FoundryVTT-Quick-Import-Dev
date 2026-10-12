![GitHub Downloads (specific asset, all releases)](https://img.shields.io/github/downloads/Myxelium/FoundryVTT-Quick-Import/quick-battlemap-importer.zip)


## Myxelium's Battlemap Importer

Effortlessly turn single images or exported map data into ready‑to‑play Foundry VTT scenes. Drop an image or video for the background, optionally drop a JSON export with walls and lights, and create a complete scene in seconds.

### What it is

Quick Battlemap Importer is a Foundry VTT module that adds a simple "Quick import" button to the Scenes sidebar. It opens a window where you can drag and drop a background image or video and, if you have it, a JSON configuration file. The module uploads the media, applies grid settings, creates walls, lights and doors etc, and builds a new scene for you automatically.

### Why it exists

Setting up scenes manually can be slow: uploading backgrounds, measuring grid size, placing walls, and configuring lights. This module removes repetitive steps so you can spend more time playing and less time navigating configuration windows.


### Inside foundry
<img width="629" height="497" alt="image" src="https://github.com/user-attachments/assets/a848543f-7a96-439a-8897-4971cf8a4cb5" />
<img width="538" height="422" alt="image" src="https://github.com/user-attachments/assets/d7672c2e-d241-4ced-8f6f-b5479e522287" />



### The problem it solves

- Converts a plain map image into a playable scene with minimal effort
- It attempts to apply grid settings automatically from submitted image
- Imports walls and lights from common JSON exports (ex, Dungeon Alchemist)
- Saves time for game masters managing many scenes

## Key features

- Drag-and-drop panel for images, videos, and JSON configuration files
- Automatic grid detection for images when no JSON is provided
- Imports walls and ambient lights from supported JSON, including Dungeon Alchemist and Foundry scene exports
- Creates and activates a new Foundry v14 scene, with the background on a scene level
- Optional "No grid" toggle for gridless maps
- GM-only quick access button in the Scenes directory
- Universal VTT import for Dungeondraft, DungeonFog, Arkenforge, and AutoWall (`.dd2vtt`, `.df2vtt`, `.uvtt`)
- Multi-file import as stacked levels, or stitched horizontally, vertically, or in a grid
- Cave-wall fidelity and offset, object walls, doors, windows, and lights
- WebP conversion, custom pixels-per-grid, scene padding, and User Data or S3 upload

## Compatibility

- Foundry VTT 14 (minimum 14, verified 14)

## Installation

1. Open Foundry VTT and go to the "Add-on Modules" tab
2. Click "Install Module"
3. Paste this Manifest URL:
  https://github.com/Myxelium/FoundryVTT-Quick-Import/releases/latest/download/module.json
4. Click "Install"

Manual download (optional):

- Download ZIP: https://github.com/Myxelium/FoundryVTT-Quick-Import/releases/latest/download/quick-battlemap-importer.zip

## Usage

1. Enable the module in your world
2. Open the Scenes sidebar
3. Click the "Quick import" button (GM only)
4. On the Quick Import tab, drag and drop one of the following:
  - Background image (png, jpg, jpeg, webp) or video (webm, mp4)
  - Optional JSON export with walls and lights (for example, from Dungeon Alchemist or a Foundry scene export)
5. Optionally enable "No grid" if the map is gridless
6. Click "Create Scene"

The module uploads the media to your world, applies grid settings (auto-detected if no JSON was supplied), and creates walls and lights when present. The background is stored on the scene's level, which is how Foundry v14 scenes are lit and displayed.

### Universal VTT

1. Export the map as Universal VTT from DungeonFog, Dungeondraft, Arkenforge, or AutoWall.
2. Open Quick import and switch to the Universal VTT tab.
3. Set the scene name, upload path, and options:
   - **Fidelity**: how many cave-wall points to keep. The left side uses fewer walls. The right side keeps every point.
   - **Offset**: nudges cave walls off the painted edge. Leave it at 0 if the walls already line up.
   - **Levels**: each file becomes its own elevation in one scene. Use this for multi-floor maps.
   - **Horizontal, vertical, or grid**: stitch several files into one image.
4. If you do not use S3, leave Storage Type on User Data.
5. Click Import Universal VTT.

Portals that block light become doors. Other portals become windows. Enable "Openable windows" in the module settings if every portal should be a door.

## Supported inputs

- Media: PNG, JPG/JPEG, WEBP, GIF, WEBM, MP4
- JSON configuration: walls and ambient lights in common Foundry-compatible formats; many Dungeon Alchemist exports should work out of the box
- Universal VTT: `.dd2vtt`, `.df2vtt`, and `.uvtt`

## Notes and limitations

- Grid auto-detection runs for images when no JSON is provided and may not succeed on all artwork
- Auto-detection is intentionally skipped for videos
- You can always create a scene with only a background; adjust grid later if needed
- Universal VTT levels mode gives each file its own elevation band. Those images should be the same size
- Very large Universal VTT maps are scaled down when they would exceed the browser canvas limit

## Credits

- Author: Myxelium (https://github.com/Myxelium)
- Universal VTT import is derived from [FVTT-DD-Import](https://github.com/moo-man/FVTT-DD-Import) by Moo Man (Russell), m42e, and jacquie, used under the MIT license. See `licenses/FVTT-DD-Import-MIT.txt`.

## License

MIT
