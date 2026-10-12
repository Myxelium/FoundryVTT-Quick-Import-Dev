/**
 * Scene Import Controller
 * 
 * Main orchestration class that coordinates the battlemap import workflow.
 * Handles file drops, manages state, and delegates to specialized services
 * for grid detection, data normalization, storage, and UI updates.
 * 
 * @module SceneImportController
 */

import { QuickImportApplication } from './import-application.js';
import { SceneDataNormalizer } from './scene-data-normalizer.js';
import { MediaStorageService } from './media-storage-service.js';
import { GridDetectionService } from './grid-detection-service.js';
import { FileProcessor, isUniversalVttData } from './file-processor.js';
import { SceneBuilder } from './scene-builder.js';
import { MODULE_LOG_PREFIX, NO_GRID_STORAGE_KEY } from './constants.js';

/**
 * @typedef {Object} BackgroundMediaData
 * @property {string} data - Base64 data URL or blob URL for the media
 * @property {string} filename - Original filename of the media
 * @property {File} file - The original File object
 * @property {boolean} isVideo - Whether the media is a video file
 */


/**
 * Controller class that manages the battlemap import process.
 * Coordinates between the UI panel, storage service, and data processing.
 */
export class SceneImportController {
    constructor() {
        /** @type {BackgroundMediaData|null} Currently loaded background media */
        this.backgroundMediaData = null;

        /** @type {Object|null} Parsed scene configuration from JSON */
        this.importedSceneStructure = null;

        /** @type {boolean} Enable verbose console logging for debugging */
        this.isDebugLoggingEnabled = false;

        /** @type {number} Counter for tracking concurrent async operations */
        this.pendingOperationCount = 0;

        /** @type {boolean} User preference to skip grid detection/application */
        this.isNoGridModeEnabled = false;

        // Initialize services
        this.panelView = new QuickImportApplication();
        this.dataNormalizer = new SceneDataNormalizer();
        this.storageService = new MediaStorageService();
        this.gridDetectionService = new GridDetectionService();
        this.fileProcessor = new FileProcessor();
        this.sceneBuilder = new SceneBuilder(this.isDebugLoggingEnabled);
    }

    /**
     * Initialize the controller by setting up event handlers and loading preferences.
     */
    initialize() {
        this.registerCanvasDropHandler();
        this.setupPanelEventCallbacks();
    }

    /**
     * Show the import panel to the user. Validates GM permissions before displaying.
     * @param {"quick"|"universal"} [tab]
     */
    showImportPanel(tab) {
        if (!game.user?.isGM) {
            ui.notifications?.warn?.(game.i18n.localize('QUICKBATTLEMAP.GMOnly'));
            return;
        }
        return this.panelView.show(tab);
    }

    /**
     * Hide the import panel from view.
     */
    hideImportPanel() {
        this.panelView.hide();
    }

    /**
     * Register a drop event handler on the Foundry canvas.
     */
    registerCanvasDropHandler() {
        Hooks.on('canvasReady', () => this.bindCanvasDrop());
        this.bindCanvasDrop();
    }

    /**
     * Listen for files dropped on the canvas. Safe to call more than once.
     */
    bindCanvasDrop() {
        const stage = canvas.stage;
        if (!stage?.on || stage === this.canvasDropStage) return;
        stage.on('drop', (event) => {
            const nativeEvent = event?.data?.originalEvent || event?.nativeEvent || event?.data?.nativeEvent || event;
            this.processDroppedFiles(nativeEvent);
        });
        this.canvasDropStage = stage;
    }

    /**
     * Wire up all callback functions for the panel view.
     */
    setupPanelEventCallbacks() {
        this.isNoGridModeEnabled = this.loadNoGridPreference();
        this.panelView.setNoGridCheckboxState(this.isNoGridModeEnabled);

        this.panelView.onCreateSceneRequested = () => this.executeSceneCreation();
        this.panelView.onResetRequested = () => this.resetImportState();
        this.panelView.onCloseRequested = () => this.hideImportPanel();
        this.panelView.onFilesDropped = (event) => this.processDroppedFiles(event);
        this.panelView.onNoGridPreferenceChanged = (isEnabled) => this.handleNoGridPreferenceChange(isEnabled);
        this.panelView.onRendered = () => this.reflectImportState();
    }

    /**
     * Load the no-grid preference from browser localStorage.
     * @returns {boolean} True if no-grid mode was previously enabled
     */
    loadNoGridPreference() {
        try {
            return localStorage.getItem(NO_GRID_STORAGE_KEY) === 'true';
        } catch (_error) {
            return false;
        }
    }

    /**
     * Handle changes to the no-grid preference checkbox.
     * @param {boolean} isEnabled - Whether no-grid mode is now enabled
     */
    handleNoGridPreferenceChange(isEnabled) {
        this.isNoGridModeEnabled = !!isEnabled;
        try {
            localStorage.setItem(NO_GRID_STORAGE_KEY, String(this.isNoGridModeEnabled));
        } catch (_error) { /* localStorage may not be available */ }

        if (this.isNoGridModeEnabled && this.panelView.wallStatusTooltip === 'Auto-detected grid') {
            this.panelView.updateWallDataStatus(false, '');
        }
    }

    /**
     * Process files dropped onto the panel or canvas.
     * @param {DragEvent} dropEvent - The native drag-and-drop event
     */
    async processDroppedFiles(dropEvent) {
        if (!game.user?.isGM) return;
        const droppedFiles = [...(dropEvent?.dataTransfer?.files ?? [])];
        if (!droppedFiles.length) return;

        const universalFiles = [];
        for (const file of droppedFiles) {
            const fileType = this.fileProcessor.getFileType(file);

            if (fileType === 'image') {
                await this.showImportPanel('quick');
                await this.handleImageFile(file);
            } else if (fileType === 'video') {
                await this.showImportPanel('quick');
                this.handleVideoFile(file);
            } else if (fileType === 'uvtt') {
                universalFiles.push(file);
            } else if (fileType === 'json') {
                const universal = await this.readUniversalVttOrConfig(file);
                if (universal) universalFiles.push(file);
            }
        }

        if (universalFiles.length) {
            await this.showImportPanel('universal');
            for (const file of universalFiles) this.panelView.addMapFile(file);
        }
    }

    /**
     * Parse a JSON file. Universal VTT documents are returned to the caller.
     * Other JSON is stored as quick-import wall and light data.
     * @param {File} jsonFile
     * @returns {Promise<boolean>} True when the file is a Universal VTT map
     */
    async readUniversalVttOrConfig(jsonFile) {
        try {
            const processedJson = await this.fileProcessor.processJsonFile(jsonFile);
            if (isUniversalVttData(processedJson.parsedContent)) return true;
            await this.showImportPanel('quick');
            this.importedSceneStructure = processedJson.parsedContent;
            this.panelView.updateWallDataStatus(true, jsonFile.name);
            this.updateCreateButtonState();
            return false;
        } catch (error) {
            console.error(`${MODULE_LOG_PREFIX} | JSON parse error:`, error);
            ui.notifications.error(game.i18n.localize('QUICKBATTLEMAP.InvalidJSON'));
            return false;
        }
    }

    /**
     * Process an image file for use as scene background.
     * @param {File} imageFile - The dropped image file
     */
    async handleImageFile(imageFile) {
        try {
            const processedImage = await this.fileProcessor.processImageFile(imageFile);
            this.backgroundMediaData = {
                data: processedImage.dataUrl,
                filename: processedImage.filename,
                file: processedImage.file,
                isVideo: false
            };
            
            this.panelView.updateBackgroundMediaStatus(true, imageFile.name);
            this.updateCreateButtonState();

            if (!this.isNoGridModeEnabled) {
                await this.runGridAutoDetection(imageFile);
            }
        } catch (error) {
            console.error(`${MODULE_LOG_PREFIX} | Image processing failed:`, error);
        }
    }

    /**
     * Run automatic grid detection on an image file.
     * @param {File} imageFile - The image file to analyze
     */
    async runGridAutoDetection(imageFile) {
        this.showProgressIndicator(game.i18n.localize('QUICKBATTLEMAP.ProgressAnalyzing'));
        try {
            await this.detectAndApplyGridFromImage(imageFile);
        } catch (error) {
            if (this.isDebugLoggingEnabled) {
                console.warn(`${MODULE_LOG_PREFIX} | Auto grid detection failed:`, error);
            }
        } finally {
            this.hideProgressIndicator();
        }
    }

    /**
     * Process a video file for use as scene background.
     * @param {File} videoFile - The dropped video file
     */
    handleVideoFile(videoFile) {
        const processedVideo = this.fileProcessor.processVideoFile(videoFile);
        this.backgroundMediaData = {
            data: processedVideo.blobUrl,
            filename: processedVideo.filename,
            file: processedVideo.file,
            isVideo: true
        };
        this.panelView.updateBackgroundMediaStatus(true, videoFile.name);
        this.updateCreateButtonState();
    }

    /**
     * Update the enabled state of the "Create Scene" button.
     */
    updateCreateButtonState() {
        this.panelView.setCreateButtonEnabled(!!this.backgroundMediaData);
    }

    /**
     * Push the current quick-import state into the panel after it renders.
     */
    reflectImportState() {
        this.panelView.setNoGridCheckboxState(this.isNoGridModeEnabled);
        this.panelView.updateBackgroundMediaStatus(
            !!this.backgroundMediaData,
            this.backgroundMediaData?.filename || ''
        );
        const wallLabel = this.importedSceneStructure ? (this.panelView.wallStatusTooltip || 'Loaded') : '';
        this.panelView.updateWallDataStatus(!!this.importedSceneStructure, wallLabel);
        if (!this.panelView.busyMessage) this.updateCreateButtonState();
    }

    /**
     * Main scene creation workflow.
     */
    async executeSceneCreation() {
        if (!this.backgroundMediaData) {
            ui.notifications.error(game.i18n.localize("QUICKBATTLEMAP.MissingFiles"));
            return;
        }

        await this.ensureGridDataExists();
        this.warnIfGridDataMissing();

        try {
            ui.notifications.info(game.i18n.localize("QUICKBATTLEMAP.CreatingScene"));

            const uploadResult = await this.uploadBackgroundMedia();
            if (!uploadResult?.path) {
                ui.notifications.error(game.i18n.localize("QUICKBATTLEMAP.UploadFailed"));
                return;
            }

            const mediaDimensions = await this.fileProcessor.getMediaDimensions(this.backgroundMediaData);
            const normalizedData = this.dataNormalizer.normalizeToFoundryFormat(this.importedSceneStructure);
            if (this.isNoGridModeEnabled) normalizedData.grid.type = 0;

            this.logNormalizedData(normalizedData);

            const sceneName = this.determineSceneName(normalizedData.name);
            const createdScene = await this.sceneBuilder.createScene({
                backgroundPath: uploadResult.path,
                sceneName: sceneName,
                width: normalizedData.width || mediaDimensions.width || 1920,
                height: normalizedData.height || mediaDimensions.height || 1080,
                normalized: normalizedData
            });

            await this.sceneBuilder.activateAndWaitForCanvas(createdScene);

            this.cleanupAfterCreation(sceneName);

        } catch (error) {
            console.error(`${MODULE_LOG_PREFIX} | Scene creation failed:`, error);
            ui.notifications.error(game.i18n.localize("QUICKBATTLEMAP.SceneCreationFailed"));
        }
    }

    /**
     * Ensure grid data exists before scene creation.
     */
    async ensureGridDataExists() {
        const shouldDetect = !this.isNoGridModeEnabled && 
                            !this.importedSceneStructure && 
                            this.backgroundMediaData?.file && 
                            !this.backgroundMediaData?.isVideo;

        if (shouldDetect) {
            try {
                this.showProgressIndicator(game.i18n.localize('QUICKBATTLEMAP.ProgressAnalyzing'));
                await this.detectAndApplyGridFromImage(this.backgroundMediaData.file);
            } catch (_error) { /* handled below */ } 
            finally {
                this.hideProgressIndicator();
            }
        }
    }

    /**
     * Display a warning if grid data is missing.
     */
    warnIfGridDataMissing() {
        if (this.isNoGridModeEnabled || this.importedSceneStructure) return;

        const message = this.backgroundMediaData?.isVideo
            ? "No grid data provided for video. Drop a JSON export or enable the No Grid option."
            : "Grid data missing and auto-detection failed. Drop a JSON export or set grid manually.";
        ui.notifications.error(message);
    }

    /**
     * Upload the background media to Foundry's storage.
     * @returns {Promise<{path: string}|null>} Upload result
     */
    async uploadBackgroundMedia() {
        this.showProgressIndicator(game.i18n.localize('QUICKBATTLEMAP.ProgressUploading'));
        try {
            return await this.storageService.uploadBackgroundMedia(this.backgroundMediaData, game.world.id);
        } finally {
            this.hideProgressIndicator();
        }
    }

    /**
     * Log normalized scene data for debugging.
     * @param {Object} data - The normalized scene configuration
     */
    logNormalizedData(data) {
        if (!this.isDebugLoggingEnabled) return;
        console.log(`${MODULE_LOG_PREFIX} | Normalized grid:`, data.grid);
        console.log(`${MODULE_LOG_PREFIX} | First wall:`, data.walls?.[0]);
        console.log(`${MODULE_LOG_PREFIX} | First light:`, data.lights?.[0]);
    }

    /**
     * Determine the scene name from config or filename.
     * @param {string|undefined} configuredName - Name from JSON config
     * @returns {string} The scene name to use
     */
    determineSceneName(configuredName) {
        if (configuredName) return configuredName;
        const nameFromFile = this.backgroundMediaData.filename.split('.').slice(0, -1).join('.');
        return nameFromFile || game.i18n.localize("QUICKBATTLEMAP.DefaultSceneName");
    }

    /**
     * Clean up state after successful scene creation.
     * @param {string} sceneName - Name of the created scene
     */
    cleanupAfterCreation(sceneName) {
        this.fileProcessor.revokeBlobUrl(this.backgroundMediaData?.data);
        this.backgroundMediaData = null;
        this.importedSceneStructure = null;

        this.panelView.updateBackgroundMediaStatus(false, '');
        this.panelView.updateWallDataStatus(false, '');
        this.panelView.setCreateButtonEnabled(false);

        ui.notifications.info(`${game.i18n.localize("QUICKBATTLEMAP.SceneCreated")}: ${sceneName}`);
    }

    /**
     * Detect grid settings from an image file.
     * @param {File} imageFile - The image file to analyze
     */
    async detectAndApplyGridFromImage(imageFile) {
        if (this.importedSceneStructure) return;

        const result = await this.gridDetectionService.detectGridFromImage(imageFile);
        if (this.importedSceneStructure) return;
        if (!result || !Number.isFinite(result.gridSize) || result.gridSize <= 0) return;

        this.importedSceneStructure = {
            grid: {
                size: Math.round(result.gridSize),
                type: 1, distance: 5, units: 'ft', alpha: 0.2, color: '#000000'
            },
            shiftX: Math.round(result.xOffset || 0),
            shiftY: Math.round(result.yOffset || 0),
            walls: [], lights: []
        };

        this.panelView.updateWallDataStatus(true, 'Auto-detected grid');
        this.updateCreateButtonState();
        
        if (this.isDebugLoggingEnabled) {
            console.log(`${MODULE_LOG_PREFIX} | Auto grid detection success:`, this.importedSceneStructure);
        }
    }

    /**
     * Show progress indicator with a status message.
     * @param {string} message - Message to display
     */
    showProgressIndicator(message) {
        this.pendingOperationCount = Math.max(0, this.pendingOperationCount) + 1;
        this.panelView.showBusyState(message);
    }

    /**
     * Hide progress indicator when operation completes.
     */
    hideProgressIndicator() {
        this.pendingOperationCount = Math.max(0, this.pendingOperationCount - 1);
        if (this.pendingOperationCount === 0) {
            this.panelView.clearBusyState();
        }
    }

    /**
     * Reset all import state to initial values.
     */
    resetImportState() {
        this.fileProcessor.revokeBlobUrl(this.backgroundMediaData?.data);
        this.backgroundMediaData = null;
        this.importedSceneStructure = null;
        this.pendingOperationCount = 0;
        this.isNoGridModeEnabled = this.loadNoGridPreference();
        this.panelView.resetAllStatuses(this.isNoGridModeEnabled);
    }
}
