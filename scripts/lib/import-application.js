/**
 * Foundry V14 window for quick battlemap import and Universal VTT maps.
 */

import { MODULE_ID, MODULE_LOG_PREFIX, NO_GRID_STORAGE_KEY } from "./constants.js";
import { MapImportProgress } from "./map-progress.js";
import { defaultUniversalSettings } from "./universal-map.js";
import { importUniversalMaps, optionsFromForm } from "./universal-map-import.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Drag-and-drop quick import, plus this module's Universal VTT importer.
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
        position: { width: 580 },
        actions: {
            createScene: this._onCreateScene,
            resetQuick: this._onResetQuick,
            addMap: this._onAddMap,
            removeMap: this._onRemoveMap,
            toggleCellSize: this._onToggleCellSize
        },
        form: {
            submitOnChange: false,
            closeOnSubmit: false,
            handler: this._onSubmit
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
                { id: "universal", icon: "fa-solid fa-layer-group" }
            ],
            initial: "quick"
        }
    };

    constructor(options = {}) {
        super(options);
        this.mapCounter = 1;
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
        const saved = game.settings.get(MODULE_ID, "universalMap") ?? {};
        const settings = { ...defaultUniversalSettings(game.world?.id), ...saved };
        context.noGrid = this.noGrid;
        context.sources = {
            data: game.i18n.localize("QUICKBATTLEMAP.UserData"),
            s3: "S3"
        };
        context.source = settings.source || "data";
        context.bucket = settings.bucket || "";
        context.bucketOptions = { "": "-" };
        try {
            const listing = await FilePicker.browse("s3", "");
            for (const dir of listing.dirs ?? []) context.bucketOptions[dir] = dir;
        } catch (_error) {
            console.log(`${MODULE_LOG_PREFIX} | No S3 buckets found`);
        }
        context.path = settings.path || "";
        context.detail = settings.detail ?? 3;
        context.nudge = settings.nudge ?? 0;
        context.padding = settings.padding ?? 0.25;
        context.layout = settings.layout || "levels";
        context.layouts = {
            levels: game.i18n.localize("QUICKBATTLEMAP.LayoutLevels"),
            horizontal: game.i18n.localize("QUICKBATTLEMAP.LayoutHorizontal"),
            vertical: game.i18n.localize("QUICKBATTLEMAP.LayoutVertical"),
            tiled: game.i18n.localize("QUICKBATTLEMAP.LayoutTiled")
        };
        context.webp = settings.webp !== false;
        context.webpQuality = settings.webpQuality || 0.8;
        context.objectWalls = settings.objectWalls !== false;
        context.frameMaps = settings.frameMaps !== false;
        context.customCellSize = !!settings.customCellSize;
        context.cellSize = settings.cellSize || 100;
        return context;
    }

    /** @override */
    async _onRender(context, options) {
        await super._onRender(context, options);
        this.mapCounter = Math.max(this.mapCounter, this.element?.querySelectorAll(".map-file").length || 1);
        this.#bindQuickControls();
        this.#bindUniversalControls();
        this.#applyQuickState();
        this.onRendered?.();
    }

    /**
     * @param {"quick"|"universal"} [tab]
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
            } catch (_error) { /* The tab group is applied on the next render. */ }
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
     * Put a dropped Universal VTT file into the next empty picker.
     * @param {File} file
     */
    addMapFile(file) {
        if (!this.element || !file) return;
        let input = [...this.element.querySelectorAll(".map-file input[type=file]")].find((entry) => !entry.files?.length);
        if (!input) input = this.#insertMapRow();
        if (!input) return;
        try {
            const transfer = new DataTransfer();
            transfer.items.add(file);
            input.files = transfer.files;
        } catch (error) {
            console.warn(`${MODULE_LOG_PREFIX} | Could not attach the dropped map`, error);
            ui.notifications.warn(game.i18n.localize("QUICKBATTLEMAP.AttachFailed"));
            return;
        }
        const baseName = file.name.replace(/\.[^.]+$/, "");
        const nameInput = input.closest(".map-file")?.querySelector(".map-name");
        if (nameInput && !nameInput.value) nameInput.value = baseName;
        const sceneName = this.element.querySelector("[name='sceneName']");
        if (sceneName && !sceneName.value) sceneName.value = baseName;
        this.#refreshUniversalOptions();
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
    static _onAddMap(_event, _target) {
        this.#insertMapRow();
        this.#refreshUniversalOptions();
    }

    /**
     * @param {PointerEvent} _event
     * @param {HTMLElement} target
     */
    static _onRemoveMap(_event, target) {
        target.closest(".map-file")?.remove();
        if (!this.element?.querySelector(".map-file")) this.#insertMapRow();
        this.#refreshUniversalOptions();
    }

    /**
     * @param {PointerEvent} _event
     * @param {HTMLElement} _target
     */
    static _onToggleCellSize(_event, _target) {
        this.#refreshUniversalOptions();
    }

    /**
     * @param {SubmitEvent} event
     * @param {HTMLFormElement} _form
     * @param {object} formData
     */
    static async _onSubmit(event, _form, formData) {
        event.preventDefault();
        const active = this.element?.querySelector(".tab.active")?.dataset.tab ?? this.tabGroups?.primary;
        if (active !== "universal") return;

        const submitted = { ...(formData.object ?? {}) };
        for (const name of ["toWebp", "objectWalls", "frameMaps", "customCellSize"]) {
            const box = this.element.querySelector(`[name="${name}"]`);
            if (box) submitted[name] = box.checked;
        }
        const options = optionsFromForm(submitted, {
            windowsAreDoors: game.settings.get(MODULE_ID, "windowsAreDoors"),
            gridDistance: game.system?.grid?.distance || 5,
            gridUnits: game.system?.grid?.units || "ft"
        });
        if (options.source === "s3" && !options.bucket) {
            ui.notifications.error(game.i18n.localize("QUICKBATTLEMAP.BucketRequired"));
            return;
        }

        let selection;
        try {
            selection = await this.#readSelectedMaps();
        } catch (error) {
            console.error(`${MODULE_LOG_PREFIX} | Could not read map files`, error);
            ui.notifications.error(`${game.i18n.localize("QUICKBATTLEMAP.ReadFailed")}: ${error?.message || error}`);
            return;
        }
        if (!selection.rawMaps.length) {
            ui.notifications.error(game.i18n.localize("QUICKBATTLEMAP.NoMaps"));
            return;
        }

        await game.settings.set(MODULE_ID, "universalMap", {
            source: options.source,
            bucket: options.bucket,
            path: options.path,
            detail: options.detail,
            nudge: options.nudge,
            padding: options.padding,
            layout: options.layout,
            webp: options.webp,
            webpQuality: options.webpQuality,
            objectWalls: options.objectWalls,
            frameMaps: options.frameMaps,
            customCellSize: options.customCellSize,
            cellSize: options.cellSize
        });

        const progress = new MapImportProgress();
        await progress.render({ force: true });
        progress.report(game.i18n.localize("QUICKBATTLEMAP.MapProgressStart"), 0, "");
        try {
            const scene = await importUniversalMaps({
                rawMaps: selection.rawMaps,
                names: selection.names,
                options,
                onProgress: (update) => progress.report(update.label, update.ratio, update.detail)
            });
            progress.report(game.i18n.localize("QUICKBATTLEMAP.MapProgressDone"), 1, scene?.name || "");
            ui.notifications.info(game.i18n.localize("QUICKBATTLEMAP.MapImported"));
            setTimeout(() => progress.close(), 700);
            await this.close();
        } catch (error) {
            console.error(`${MODULE_LOG_PREFIX} | Universal VTT import failed`, error);
            ui.notifications.error(`${game.i18n.localize("QUICKBATTLEMAP.ImportFailed")}: ${error?.message || error}`);
            progress.close();
        }
    }

    /**
     * @returns {Promise<{rawMaps:object[], names:string[]}>}
     */
    async #readSelectedMaps() {
        const rows = [...(this.element?.querySelectorAll(".map-file") ?? [])];
        const rawMaps = [];
        const names = [];
        for (const row of rows) {
            const file = row.querySelector("input[type=file]")?.files?.[0];
            if (!file) continue;
            const name = row.querySelector(".map-name")?.value?.trim() || file.name.replace(/\.[^.]+$/, "");
            try {
                rawMaps.push(JSON.parse(await file.text()));
                names.push(name);
            } catch (error) {
                if (rows.length > 1) {
                    ui.notifications.warn(`${game.i18n.localize("QUICKBATTLEMAP.SkipFile")}: ${file.name}`);
                } else {
                    throw error;
                }
            }
        }
        return { rawMaps, names };
    }

    /**
     * @returns {HTMLInputElement|null}
     */
    #insertMapRow() {
        const button = this.element?.querySelector(".map-add");
        if (!button) return null;
        const index = this.mapCounter;
        const row = document.createElement("div");
        row.className = "map-file";
        const placeholder = game.i18n.localize("QUICKBATTLEMAP.LevelName");
        row.innerHTML = `
            <input type="text" name="mapName${index}" class="map-name" placeholder="${placeholder}">
            <input type="file" name="mapFile${index}" accept=".dd2vtt,.df2vtt,.uvtt,.json">
            <a data-action="removeMap"><i class="fa-solid fa-xmark"></i></a>
        `;
        button.insertAdjacentElement("beforebegin", row);
        this.mapCounter += 1;
        return row.querySelector("input[type=file]");
    }

    #bindQuickControls() {
        const dropArea = this.element?.querySelector(".quick-import");
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
    }

    #bindUniversalControls() {
        const panel = this.element?.querySelector(".universal-import");
        panel?.addEventListener("dragover", (event) => event.preventDefault());
        panel?.addEventListener("drop", (event) => {
            event.preventDefault();
            for (const file of event.dataTransfer?.files ?? []) this.addMapFile(file);
        });
        this.element?.querySelector("[name='path']")?.addEventListener("keyup", () => this.#refreshUniversalOptions());
        this.element?.querySelector(".detail-input")?.addEventListener("input", () => this.#refreshUniversalOptions());
        this.element?.querySelector(".source-choice")?.addEventListener("change", () => this.#refreshUniversalOptions());
        this.element?.querySelector(".webp-toggle")?.addEventListener("change", () => this.#refreshUniversalOptions());
        this.element?.querySelector("[name='layout']")?.addEventListener("change", () => this.#refreshUniversalOptions());
        this.#refreshUniversalOptions();
    }

    #refreshUniversalOptions() {
        const root = this.element;
        if (!root) return;
        const pathValue = root.querySelector("[name='path']")?.value ?? "";
        const pathWarning = root.querySelector(".warning.path");
        if (pathWarning) pathWarning.style.display = pathValue[1] === ":" ? "" : "none";

        const detail = Number(root.querySelector("[name='detail']")?.value);
        const detailWarning = root.querySelector(".warning.detail");
        if (detailWarning) detailWarning.style.display = detail >= 5 ? "" : "none";

        const custom = !!root.querySelector("[name='customCellSize']")?.checked;
        const cellFields = root.querySelector(".cell-size-fields");
        if (cellFields) cellFields.style.display = custom ? "" : "none";

        const webp = !!root.querySelector("[name='toWebp']")?.checked;
        const quality = root.querySelector(".webp-quality");
        if (quality) quality.style.display = webp ? "" : "none";

        const source = root.querySelector("[name='source']")?.value;
        const buckets = root.querySelector(".bucket-fields");
        if (buckets) buckets.style.display = source === "s3" ? "" : "none";

        const stitch = root.querySelector(".stitch-options");
        const several = root.querySelectorAll(".map-file").length > 1;
        if (stitch) stitch.style.display = several ? "" : "none";
        const layout = root.querySelector("[name='layout']")?.value;
        const stitchOnly = several && layout !== "levels";
        for (const node of root.querySelectorAll(".stitch-only")) {
            node.style.display = stitchOnly ? "" : "none";
        }
        const levelsNote = root.querySelector(".levels-note");
        if (levelsNote) levelsNote.style.display = several && layout === "levels" ? "" : "none";
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
}
