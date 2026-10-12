/**
 * Foundry V14 application for quick battlemap import and Universal VTT import.
 */

import { MODULE_ID, MODULE_LOG_PREFIX, NO_GRID_STORAGE_KEY } from "./constants.js";
import { ImportProgressApplication } from "./import-progress.js";
import { readImportSettings } from "./import-settings.js";
import { importUniversalVtt } from "./uvtt-importer.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Drag-and-drop quick import, plus the Universal VTT options from FVTT-DD-Import.
 */
export class QuickImportApplication extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: MODULE_ID,
        tag: "form",
        classes: ["quick-battlemap", "standard-form"],
        window: {
            title: "QUICKBATTLEMAP.DropAreaTitle",
            icon: "fa-solid fa-map",
            resizable: true
        },
        position: { width: 560 },
        actions: {
            createScene: this._onCreateScene,
            resetQuick: this._onResetQuick,
            addFile: this._onAddFile,
            removeLevel: this._onRemoveLevel,
            usePPI: this._onUsePPI
        },
        form: {
            submitOnChange: false,
            closeOnSubmit: false,
            handler: this._onSubmitUvtt
        }
    };

    static PARTS = {
        form: {
            template: `modules/${MODULE_ID}/templates/importer.hbs`,
            scrollable: [""]
        }
    };

    static TABS = {
        primary: {
            tabs: [
                { id: "quick", icon: "fa-solid fa-image" },
                { id: "uvtt", icon: "fa-solid fa-file-import" }
            ],
            initial: "quick"
        }
    };

    constructor(options = {}) {
        super(options);
        this.fileCounter = 1;
        this.noGrid = false;
        this.backgroundLoaded = false;
        this.backgroundTooltip = "";
        this.wallLoaded = false;
        this.wallStatusTooltip = "";
        this.createEnabled = false;
        this.busyMessage = "";
        this.onCreateSceneRequested = null;
        this.onResetRequested = null;
        this.onCloseRequested = null;
        this.onFilesDropped = null;
        this.onNoGridPreferenceChanged = null;
        this.onRendered = null;
    }

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const settings = readImportSettings();
        context.noGrid = this.noGrid;
        context.dataSources = {
            data: game.i18n.localize("QUICKBATTLEMAP.UserData"),
            s3: "S3"
        };
        context.defaultSource = settings.source || "data";
        context.s3Bucket = settings.bucket || "";
        context.bucketOptions = { "": "-" };
        try {
            const listing = await FilePicker.browse("s3", "");
            for (const dir of listing.dirs ?? []) context.bucketOptions[dir] = dir;
        } catch (_error) {
            console.log(`${MODULE_LOG_PREFIX} | No S3 buckets found`);
        }
        context.path = settings.path || "";
        context.offset = settings.offset ?? 0;
        context.padding = settings.padding ?? 0.25;
        context.fidelity = settings.fidelity ?? 1;
        context.multiImageModes = {
            l: game.i18n.localize("QUICKBATTLEMAP.ModeLevels"),
            g: game.i18n.localize("QUICKBATTLEMAP.ModeGrid"),
            y: game.i18n.localize("QUICKBATTLEMAP.ModeVertical"),
            x: game.i18n.localize("QUICKBATTLEMAP.ModeHorizontal")
        };
        context.multiImageMode = settings.multiImageMode || "l";
        context.webpConversion = settings.webpConversion !== false;
        context.webpQuality = settings.webpQuality || 0.8;
        context.wallsAroundFiles = settings.wallsAroundFiles !== false;
        context.useCustomPixelsPerGrid = !!settings.useCustomPixelsPerGrid;
        context.customPixelsPerGrid = settings.customPixelsPerGrid || 100;
        return context;
    }

    /** @override */
    async _onRender(context, options) {
        await super._onRender(context, options);
        this.fileCounter = Math.max(1, this.element?.querySelectorAll(".level").length || 1);
        this.#bindQuickControls();
        this.#bindUvttControls();
        this.#applyQuickState();
        this.onRendered?.();
    }

    /**
     * @param {"quick"|"uvtt"} [tab]
     */
    async show(tab) {
        if (tab) {
            this.tabGroups ??= {};
            this.tabGroups.primary = tab;
        }
        if (!this.rendered) await this.render({ force: true });
        if (tab && this.rendered && this.element) {
            try {
                this.changeTab(tab, "primary", { force: true });
            } catch (_error) { /* Tab group is applied on the next render. */ }
        }
        this.bringToFront?.();
        this.bringToTop?.();
        return this;
    }

    /**
     * Hide the window.
     */
    hide() {
        if (this.rendered) return this.close();
        return undefined;
    }

    /**
     * @param {boolean} isChecked
     */
    setNoGridCheckboxState(isChecked) {
        this.noGrid = !!isChecked;
        const checkbox = this.element?.querySelector("input.ebm-no-grid");
        if (checkbox) checkbox.checked = this.noGrid;
    }

    /**
     * @param {boolean} isEnabled
     */
    setCreateButtonEnabled(isEnabled) {
        this.createEnabled = !!isEnabled;
        const button = this.element?.querySelector(".create-scene-button");
        if (button) button.disabled = !this.createEnabled;
    }

    /**
     * @param {boolean} isLoaded
     * @param {string} tooltipText
     */
    updateBackgroundMediaStatus(isLoaded, tooltipText) {
        this.backgroundLoaded = !!isLoaded;
        this.backgroundTooltip = tooltipText || "";
        this.#setStatus(".background-status .status-value", this.backgroundLoaded, this.backgroundTooltip);
    }

    /**
     * @param {boolean} isLoaded
     * @param {string} tooltipText
     */
    updateWallDataStatus(isLoaded, tooltipText) {
        this.wallLoaded = !!isLoaded;
        this.wallStatusTooltip = tooltipText || "";
        this.#setStatus(".wall-data-status .status-value", this.wallLoaded, this.wallStatusTooltip);
    }

    /**
     * @param {string} statusMessage
     */
    showBusyState(statusMessage) {
        this.busyMessage = statusMessage || "";
        const group = this.element?.querySelector(".progress-group");
        const text = this.element?.querySelector(".ebm-progress-text");
        if (group) group.style.display = "";
        if (text && statusMessage) text.textContent = statusMessage;
        const button = this.element?.querySelector(".create-scene-button");
        if (button) button.disabled = true;
    }

    /**
     * Hide the quick-import progress row.
     */
    clearBusyState() {
        this.busyMessage = "";
        const group = this.element?.querySelector(".progress-group");
        const text = this.element?.querySelector(".ebm-progress-text");
        if (group) group.style.display = "none";
        if (text) text.textContent = game.i18n.localize("QUICKBATTLEMAP.ProgressIdle");
        this.setCreateButtonEnabled(this.createEnabled);
    }

    /**
     * @param {boolean} persistedNoGridValue
     */
    resetAllStatuses(persistedNoGridValue) {
        this.updateBackgroundMediaStatus(false, "");
        this.updateWallDataStatus(false, "");
        this.setCreateButtonEnabled(false);
        this.clearBusyState();
        this.setNoGridCheckboxState(!!persistedNoGridValue);
    }

    /**
     * Place a Universal VTT file into the next empty file input.
     * @param {File} file
     */
    addUvttFile(file) {
        if (!this.element || !file) return;
        let input = [...this.element.querySelectorAll(".file-input")].find((entry) => !entry.files?.length);
        if (!input) input = this.#insertLevelRow();
        if (!input) return;

        try {
            const transfer = new DataTransfer();
            transfer.items.add(file);
            input.files = transfer.files;
        } catch (error) {
            console.warn(`${MODULE_LOG_PREFIX} | Could not attach dropped file`, error);
            ui.notifications.warn(game.i18n.localize("QUICKBATTLEMAP.AttachFailed"));
            return;
        }

        const baseName = file.name.replace(/\.[^.]+$/, "");
        const nameInput = input.parentElement?.querySelector(".level-name");
        if (nameInput && !nameInput.value) nameInput.value = baseName;
        const sceneName = this.element.querySelector("[name='sceneName']");
        if (sceneName && !sceneName.value) sceneName.value = baseName;
        this.#checkMultiMode();
        this.changeTab("uvtt", "primary", { force: true });
    }

    /**
     * @param {PointerEvent} _event
     * @param {HTMLElement} _target
     */
    static _onCreateScene(_event, _target) {
        this.onCreateSceneRequested?.();
    }

    /**
     * @param {PointerEvent} _event
     * @param {HTMLElement} _target
     */
    static _onResetQuick(_event, _target) {
        this.onResetRequested?.();
    }

    /**
     * @param {PointerEvent} _event
     * @param {HTMLElement} _target
     */
    static _onAddFile(_event, _target) {
        this.#insertLevelRow();
        this.#checkMultiMode();
    }

    /**
     * @param {PointerEvent} _event
     * @param {HTMLElement} target
     */
    static _onRemoveLevel(_event, target) {
        target.closest(".level")?.remove();
        this.#checkMultiMode();
    }

    /**
     * @param {PointerEvent} _event
     * @param {HTMLElement} _target
     */
    static _onUsePPI(_event, _target) {
        this.#checkCustomPpi();
    }

    /**
     * @param {SubmitEvent} event
     * @param {HTMLFormElement} _form
     * @param {object} formData
     */
    static async _onSubmitUvtt(event, _form, formData) {
        event.preventDefault();
        const activeTab = this.element?.querySelector(".tab.active")?.dataset.tab
            ?? this.tabGroups?.primary;
        if (activeTab !== "uvtt") return;

        const submitData = this.#coerceUvttForm(formData.object ?? {});
        if (!submitData.bucket && submitData.source === "s3") {
            ui.notifications.error(game.i18n.localize("QUICKBATTLEMAP.BucketRequired"));
            return;
        }

        let files;
        try {
            files = await this.#readSelectedFiles();
        } catch (error) {
            console.error(`${MODULE_LOG_PREFIX} | Error reading files`, error);
            ui.notifications.error(`${game.i18n.localize("QUICKBATTLEMAP.ReadFailed")}: ${error?.message || error}`);
            return;
        }
        if (!files.length) {
            ui.notifications.error(game.i18n.localize("QUICKBATTLEMAP.NoValidFiles"));
            return;
        }

        await game.settings.set(MODULE_ID, "importSettings", {
            source: submitData.source,
            bucket: submitData.bucket,
            path: submitData.path,
            offset: submitData.offset,
            padding: submitData.padding,
            fidelity: submitData.fidelity,
            multiImageMode: submitData.mode,
            webpConversion: submitData.toWebp,
            webpQuality: submitData.webpQuality,
            wallsAroundFiles: submitData.wallsAroundFiles,
            useCustomPixelsPerGrid: submitData.useCustomPixelsPerGrid,
            customPixelsPerGrid: submitData.customPixelsPerGrid
        });

        const progress = new ImportProgressApplication();
        await progress.render({ force: true });
        progress.update(game.i18n.localize("QUICKBATTLEMAP.ProgressStarting"), 0, 100, "");
        try {
            await importUniversalVtt(submitData, files, progress);
            progress.update(game.i18n.localize("QUICKBATTLEMAP.ProgressDone"), 100, 100, "");
            setTimeout(() => progress.close(), 800);
            ui.notifications.info(game.i18n.localize("QUICKBATTLEMAP.UvttImported"));
            await this.close();
        } catch (error) {
            console.error(`${MODULE_LOG_PREFIX} | Universal VTT import failed`, error);
            ui.notifications.error(`${game.i18n.localize("QUICKBATTLEMAP.ImportFailed")}: ${error?.message || error}`);
            progress.close();
        }
    }

    /**
     * @param {object} data
     * @returns {object}
     */
    #coerceUvttForm(data) {
        const number = (value, fallback) => {
            const raw = Array.isArray(value) ? value[value.length - 1] : value;
            const parsed = Number(raw);
            return Number.isFinite(parsed) ? parsed : fallback;
        };
        return {
            ...data,
            source: data.source || "data",
            bucket: data.bucket || "",
            path: data.path || "",
            sceneName: data.sceneName || "",
            imageFileName: data.imageFileName || "",
            mode: data.mode || "l",
            offset: number(data.offset, 0),
            padding: number(data.padding, 0.25),
            fidelity: number(data.fidelity, 1),
            webpQuality: number(data.webpQuality, 0.8),
            customPixelsPerGrid: number(data.customPixelsPerGrid ?? data.defaultCustomPixelsPerGrid, 100),
            toWebp: !!data.toWebp,
            objectWalls: data.objectWalls !== false,
            wallsAroundFiles: !!data.wallsAroundFiles,
            useCustomPixelsPerGrid: !!data.useCustomPixelsPerGrid
        };
    }

    /**
     * @returns {Promise<object[]>}
     */
    async #readSelectedFiles() {
        const files = [];
        const inputs = [...(this.element?.querySelectorAll(".file-input") ?? [])];
        for (const input of inputs) {
            const file = input.files?.[0];
            if (!file) continue;
            const nameInput = input.parentElement?.querySelector(".level-name");
            try {
                const content = JSON.parse(await file.text());
                content.name = file.name.replace(/\.[^.]+$/, "");
                content.levelName = nameInput?.value || content.name;
                files.push(content);
            } catch (error) {
                if (inputs.length > 1) {
                    ui.notifications.warn(`${game.i18n.localize("QUICKBATTLEMAP.SkipFile")}: ${file.name}`);
                } else {
                    throw error;
                }
            }
        }
        return files;
    }

    /**
     * @returns {HTMLInputElement|null}
     */
    #insertLevelRow() {
        const button = this.element?.querySelector(".add-file");
        if (!button) return null;
        const index = this.fileCounter;
        const row = document.createElement("div");
        row.className = "level";
        const placeholder = game.i18n.localize("QUICKBATTLEMAP.LevelName");
        row.innerHTML = `
            <input type="text" name="levelName${index}" class="level-name" placeholder="${placeholder}">
            <input class="file-input" type="file" name="file${index}" accept=".dd2vtt,.df2vtt,.uvtt,.json">
            <a data-action="removeLevel"><i class="fa-solid fa-xmark"></i></a>
        `;
        button.insertAdjacentElement("beforebegin", row);
        this.fileCounter += 1;
        return row.querySelector(".file-input");
    }

    #bindQuickControls() {
        const dropArea = this.element?.querySelector(".quick-tab");
        if (!dropArea) return;
        const stop = (event) => {
            event.preventDefault();
            event.stopPropagation();
        };
        for (const eventName of ["dragenter", "dragover", "dragleave", "drop"]) {
            dropArea.addEventListener(eventName, stop);
        }
        dropArea.addEventListener("dragenter", () => dropArea.classList.add("highlight"));
        dropArea.addEventListener("dragover", () => dropArea.classList.add("highlight"));
        dropArea.addEventListener("dragleave", () => dropArea.classList.remove("highlight"));
        dropArea.addEventListener("drop", (event) => {
            dropArea.classList.remove("highlight");
            this.onFilesDropped?.(event);
        });

        const checkbox = this.element.querySelector("input.ebm-no-grid");
        checkbox?.addEventListener("change", (event) => {
            const isChecked = !!event.currentTarget.checked;
            this.noGrid = isChecked;
            try {
                localStorage.setItem(NO_GRID_STORAGE_KEY, String(isChecked));
            } catch (_error) { /* localStorage may be blocked */ }
            this.onNoGridPreferenceChanged?.(isChecked);
        });

        const uvttTab = this.element.querySelector(".uvtt-tab");
        uvttTab?.addEventListener("dragover", (event) => {
            event.preventDefault();
        });
        uvttTab?.addEventListener("drop", (event) => {
            event.preventDefault();
            const files = [...(event.dataTransfer?.files ?? [])];
            for (const file of files) this.addUvttFile(file);
        });
    }

    #bindUvttControls() {
        this.element?.querySelector("[name='path']")?.addEventListener("keyup", () => this.#checkPath());
        this.element?.querySelector(".fidelity-input")?.addEventListener("change", () => this.#checkFidelity());
        this.element?.querySelector(".source-selector")?.addEventListener("change", () => this.#checkSource());
        this.element?.querySelector(".convert-to-webp")?.addEventListener("change", () => this.#checkWebp());
        this.element?.querySelector("[name='useCustomPixelsPerGrid']")?.addEventListener("change", () => this.#checkCustomPpi());
        this.element?.querySelector("[name='mode']")?.addEventListener("change", () => this.#checkMultiMode());
        this.#checkPath();
        this.#checkFidelity();
        this.#checkSource();
        this.#checkWebp();
        this.#checkCustomPpi();
        this.#checkMultiMode();
    }

    #applyQuickState() {
        this.setNoGridCheckboxState(this.noGrid);
        this.updateBackgroundMediaStatus(this.backgroundLoaded, this.backgroundTooltip);
        this.updateWallDataStatus(this.wallLoaded, this.wallStatusTooltip);
        this.setCreateButtonEnabled(this.createEnabled);
        if (this.busyMessage) this.showBusyState(this.busyMessage);
    }

    /**
     * @param {string} selector
     * @param {boolean} isLoaded
     * @param {string} tooltipText
     */
    #setStatus(selector, isLoaded, tooltipText) {
        const statusElement = this.element?.querySelector(selector);
        if (!statusElement) return;
        statusElement.textContent = isLoaded ? "✅" : "❌";
        statusElement.title = tooltipText || "";
    }

    #checkPath() {
        const pathValue = this.element?.querySelector("[name='path']")?.value ?? "";
        const warning = this.element?.querySelector(".warning.path");
        if (warning) warning.style.display = pathValue[1] === ":" ? "" : "none";
    }

    #checkFidelity() {
        const fidelity = Number(this.element?.querySelector("[name='fidelity']")?.value);
        const warning = this.element?.querySelector(".warning.fidelity");
        if (warning) warning.style.display = fidelity > 1 ? "" : "none";
    }

    #checkWebp() {
        const enabled = !!this.element?.querySelector("[name='toWebp']")?.checked;
        const quality = this.element?.querySelector(".conversion-quality");
        if (quality) quality.style.display = enabled ? "" : "none";
    }

    #checkSource() {
        const source = this.element?.querySelector("[name='source']")?.value;
        const section = this.element?.querySelector(".s3-section");
        if (section) section.style.display = source === "s3" ? "" : "none";
    }

    #checkCustomPpi() {
        const enabled = !!this.element?.querySelector("[name='useCustomPixelsPerGrid']")?.checked;
        const section = this.element?.querySelector(".custom-gridPPI-section");
        if (section) section.style.display = enabled ? "" : "none";
    }

    #checkMultiMode() {
        const section = this.element?.querySelector(".multi-mode-section");
        if (!section) return;
        const levelCount = this.element.querySelectorAll(".level").length;
        if (levelCount <= 1) {
            section.style.display = "none";
            return;
        }
        section.style.display = "";
        const mode = this.element.querySelector("[name='mode']")?.value;
        const stitchOnly = mode !== "l";
        const walls = this.element.querySelector("[name='wallsAroundFiles']")?.closest(".form-group");
        const imageName = this.element.querySelector("[name='imageFileName']")?.closest(".form-group");
        const note = this.element.querySelector(".levels-note");
        if (walls) walls.style.display = stitchOnly ? "" : "none";
        if (imageName) imageName.style.display = stitchOnly ? "" : "none";
        if (note) note.style.display = stitchOnly ? "none" : "";
    }
}
