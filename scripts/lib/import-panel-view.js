/**
 * Import Panel View
 * 
 * Manages the drag-and-drop UI panel for the battlemap import workflow.
 * Handles panel creation, visibility, status updates, and user interactions.
 * This is a pure view component - it only manages DOM and emits events.
 * 
 * @module ImportPanelView
 */

/**
 * @typedef {Object} PanelCallbacks
 * @property {Function} onCreateSceneRequested - Called when user clicks "Create Scene"
 * @property {Function} onResetRequested - Called when user clicks "Reset"
 * @property {Function} onCloseRequested - Called when user clicks close button
 * @property {Function} onFilesDropped - Called when files are dropped on the panel
 * @property {Function} onNoGridPreferenceChanged - Called when no-grid checkbox changes
 */

/** CSS selectors for frequently accessed elements */
const PANEL_SELECTORS = {
    PANEL_ROOT: '#quick-battlemap-drop-area',
    CREATE_BUTTON: '.create-scene-button',
    RESET_BUTTON: '.reset-button',
    CLOSE_BUTTON: '.header-button.close',
    NO_GRID_CHECKBOX: 'input.ebm-no-grid',
    BACKGROUND_STATUS: '.background-status .status-value',
    WALL_DATA_STATUS: '.wall-data-status .status-value',
    PROGRESS_GROUP: '.progress-group',
    PROGRESS_TEXT: '.ebm-progress-text'
};

/** LocalStorage key for persisting no-grid preference */
const NO_GRID_STORAGE_KEY = 'quick-battlemap:no-grid';

/**
 * View class that manages the import panel DOM and user interactions.
 * Follows a callback pattern for communicating events to the controller.
 */
export class ImportPanelView {
    constructor() {
        /** @type {boolean} Whether the panel DOM has been created */
        this.isPanelCreated = false;

        /** @type {boolean} Whether the panel is currently visible */
        this.isCurrentlyVisible = false;

        /** @type {boolean} Whether a background operation is in progress */
        this.isShowingBusyState = false;

        // Event callbacks - set by the controller
        /** @type {Function|null} */
        this.onCreateSceneRequested = null;
        /** @type {Function|null} */
        this.onResetRequested = null;
        /** @type {Function|null} */
        this.onCloseRequested = null;
        /** @type {Function|null} */
        this.onFilesDropped = null;
        /** @type {Function|null} */
        this.onNoGridPreferenceChanged = null;
    }

    /**
     * Ensure the panel DOM structure exists.
     * Creates the panel if it doesn't exist, removes duplicates if found.
     */
    ensureCreated() {
        if (this.isPanelCreated) {
            return;
        }

        // Remove any existing panel to prevent duplicates
        const existingPanel = document.getElementById('quick-battlemap-drop-area');
        if (existingPanel) {
            existingPanel.remove();
        }

        // Create and insert the panel HTML
        const panelHtml = this.buildPanelHtml();
        document.body.insertAdjacentHTML('beforeend', panelHtml);

        // Set up event listeners
        this.attachButtonEventListeners();
        this.attachNoGridCheckboxListener();
        this.attachDragHandlers();
        this.attachDropZoneHandlers();

        this.isPanelCreated = true;
    }

    /**
     * Build the complete HTML structure for the import panel.
     * Uses Foundry's built-in styles and i18n for localization.
     * 
     * @returns {string} The complete panel HTML
     */
    buildPanelHtml() {
        const i18n = (key) => game.i18n.localize(key);
        const closeText = i18n('Close') ?? 'Close';

        return `
        <div id="quick-battlemap-drop-area" class="app window-app quick-battlemap" 
             style="left:72px; top:80px; z-index:100; display:none; width: 520px; position: absolute;">
            <header class="window-header flexrow draggable">
                <h4 class="window-title">${i18n('QUICKBATTLEMAP.DropAreaTitle')}</h4>
                <a class="header-button control close"><i class="fas fa-times"></i>${closeText}</a>
            </header>
            <section class="window-content">
                <form class="flexcol" autocomplete="off">
                    <p class="notes quick-battlemap-instructions">${i18n('QUICKBATTLEMAP.DropInstructions')}</p>
                    <div class="area"><div id="dropZone">Drop files here</div></div>
                    <p class="notes quick-battlemap-instructions">${i18n('QUICKBATTLEMAP.DropInstructionsMore')}</p>
                    <div class="form-group">
                        <label>${i18n('QUICKBATTLEMAP.BackgroundStatus')}</label>
                        <div class="form-fields"><span class="background-status"><span class="status-value">❌</span></span></div>
                    </div>
                    <div class="form-group">
                        <label>${i18n('QUICKBATTLEMAP.WallDataStatus')}</label>
                        <div class="form-fields"><span class="wall-data-status"><span class="status-value">❌</span></span></div>
                    </div>
                    <div class="form-group">
                        <label>${i18n('QUICKBATTLEMAP.Options')}</label>
                        <div class="form-fields ebm-no-grid">
                            <label class="checkbox"><input type="checkbox" class="ebm-no-grid" /><span>${i18n('QUICKBATTLEMAP.NoGridLabel')}</span></label>
                        </div>
                    </div>
                    <div class="form-group progress-group" style="display:none">
                        <label>${i18n('QUICKBATTLEMAP.ProgressLabel')}</label>
                        <div class="form-fields ebm-progress-row">
                            <div class="ebm-spinner" aria-hidden="true"><i class="fas fa-spinner fa-spin"></i></div>
                            <span class="ebm-progress-text">${i18n('QUICKBATTLEMAP.ProgressIdle')}</span>
                        </div>
                        <p class="notes ebm-progress-note">${i18n('QUICKBATTLEMAP.ProgressNote')}</p>
                    </div>
                    <footer class="sheet-footer flexrow">
                        <button type="button" class="reset-button"><i class="fas fa-undo"></i> ${i18n('QUICKBATTLEMAP.Reset')}</button>
                        <button type="button" class="create-scene-button" disabled><i class="fas fa-save"></i> ${i18n('QUICKBATTLEMAP.CreateScene')}</button>
                    </footer>
                </form>
            </section>
        </div>`;
    }

    /**
     * Attach click event listeners to the panel's action buttons.
     */
    attachButtonEventListeners() {
        const panel = this.getPanelElement();
        if (!panel) return;

        const createButton = panel.querySelector(PANEL_SELECTORS.CREATE_BUTTON);
        const resetButton = panel.querySelector(PANEL_SELECTORS.RESET_BUTTON);
        const closeButton = panel.querySelector(PANEL_SELECTORS.CLOSE_BUTTON);
        
        createButton?.addEventListener('click', () => {
            this.onCreateSceneRequested?.();
        });

        resetButton?.addEventListener('click', () => {
            this.onResetRequested?.();
        });

        closeButton?.addEventListener('click', () => {
            this.onCloseRequested?.();
        });
    }

    /**
     * Attach change listener to the no-grid checkbox.
     * Loads and applies the persisted preference.
     */
    attachNoGridCheckboxListener() {
        const panel = this.getPanelElement();
        if (!panel) return;

        // Load persisted preference
        const persistedValue = this.loadNoGridPreference();
        const checkbox = panel.querySelector(PANEL_SELECTORS.NO_GRID_CHECKBOX);

        if (checkbox) {
            checkbox.checked = persistedValue;

            checkbox.addEventListener('change', (event) => {
                const isChecked = !!event.currentTarget.checked;
                this.saveNoGridPreference(isChecked);
                this.onNoGridPreferenceChanged?.(isChecked);
            });
        }
    }

    /**
     * Attach drag event handlers to make the panel header draggable.
     */
    attachDragHandlers() {
        const panel = this.getPanelElement();
        const header = panel?.querySelector('header');
        
        if (!panel || !header) return;

        let isDragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let panelStartLeft = 0;
        let panelStartTop = 0;

        const handleMouseMove = (event) => {
            if (!isDragging) return;

            const deltaX = event.clientX - dragStartX;
            const deltaY = event.clientY - dragStartY;

            // Keep panel within viewport bounds
            const newLeft = Math.max(0, panelStartLeft + deltaX);
            const newTop = Math.max(0, panelStartTop + deltaY);

            panel.style.left = `${newLeft}px`;
            panel.style.top = `${newTop}px`;
        };

        const handleMouseUp = () => {
            isDragging = false;
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        header.addEventListener('mousedown', (event) => {
            // Only respond to left mouse button
            if (event.button !== 0) return;

            isDragging = true;

            const panelRect = panel.getBoundingClientRect();
            dragStartX = event.clientX;
            dragStartY = event.clientY;
            panelStartLeft = panelRect.left + window.scrollX;
            panelStartTop = panelRect.top + window.scrollY;

            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        });
    }

    /**
     * Attach drag-and-drop event handlers to the drop zone.
     */
    attachDropZoneHandlers() {
        const dropArea = this.getPanelElement();
        if (!dropArea) return;

        // Prevent default browser behavior for all drag events
        const preventDefaults = (event) => {
            event.preventDefault();
            event.stopPropagation();
        };

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropArea.addEventListener(eventName, preventDefaults, false);
        });

        // Add visual highlight during drag
        ['dragenter', 'dragover'].forEach(eventName => {
            dropArea.addEventListener(eventName, () => {
                dropArea.classList.add('highlight');
            }, false);
        });

        // Remove highlight when drag ends
        ['dragleave', 'drop'].forEach(eventName => {
            dropArea.addEventListener(eventName, () => {
                dropArea.classList.remove('highlight');
            }, false);
        });

        // Forward drop events to callback
        dropArea.addEventListener('drop', (event) => {
            this.onFilesDropped?.(event);
        }, false);
    }

    /**
     * Load the no-grid preference from localStorage.
     * @returns {boolean} Whether no-grid mode is enabled
     */
    loadNoGridPreference() {
        try {
            return localStorage.getItem(NO_GRID_STORAGE_KEY) === 'true';
        } catch (_error) {
            return false;
        }
    }

    /**
     * Save the no-grid preference to localStorage.
     * @param {boolean} isEnabled - Whether no-grid mode is enabled
     */
    saveNoGridPreference(isEnabled) {
        try {
            localStorage.setItem(NO_GRID_STORAGE_KEY, String(isEnabled));
        } catch (_error) {
            // localStorage may not be available
        }
    }

    /**
     * Get the panel's root DOM element.
     * @returns {HTMLElement|null} The panel element
     */
    getPanelElement() {
        return document.getElementById('quick-battlemap-drop-area');
    }

    /**
     * Show the import panel.
     */
    show() {
        this.ensureCreated();
        const panel = this.getPanelElement();
        
        if (panel) {
            panel.style.display = '';
            this.isCurrentlyVisible = true;
        }
    }

    /**
     * Hide the import panel.
     */
    hide() {
        const panel = this.getPanelElement();
        
        if (panel) {
            panel.style.display = 'none';
            this.isCurrentlyVisible = false;
        }
    }

    /**
     * Enable or disable the Create Scene button.
     * @param {boolean} isEnabled - Whether the button should be enabled
     */
    setCreateButtonEnabled(isEnabled) {
        const button = document.querySelector(PANEL_SELECTORS.CREATE_BUTTON);
        if (button) {
            button.disabled = !isEnabled;
        }
    }

    /**
     * Update the background media status indicator.
     * @param {boolean} isLoaded - Whether background media is loaded
     * @param {string} tooltipText - Tooltip text (usually the filename)
     */
    updateBackgroundMediaStatus(isLoaded, tooltipText) {
        const statusElement = document.querySelector(PANEL_SELECTORS.BACKGROUND_STATUS);
        
        if (statusElement) {
            statusElement.textContent = isLoaded ? '✅' : '❌';
            statusElement.title = tooltipText || '';
        }
    }

    /**
     * Update the wall/grid data status indicator.
     * @param {boolean} isLoaded - Whether wall data is loaded
     * @param {string} tooltipText - Tooltip text (usually the filename or "Auto-detected")
     */
    updateWallDataStatus(isLoaded, tooltipText) {
        const statusElement = document.querySelector(PANEL_SELECTORS.WALL_DATA_STATUS);
        
        if (statusElement) {
            statusElement.textContent = isLoaded ? '✅' : '❌';
            statusElement.title = tooltipText || '';
        }
    }

    /**
     * Show the progress/busy indicator with a message.
     * @param {string} statusMessage - Message to display
     */
    showBusyState(statusMessage) {
        const progressGroup = document.querySelector(`${PANEL_SELECTORS.PANEL_ROOT} ${PANEL_SELECTORS.PROGRESS_GROUP}`);
        const progressText = document.querySelector(`${PANEL_SELECTORS.PANEL_ROOT} ${PANEL_SELECTORS.PROGRESS_TEXT}`);

        if (progressGroup) {
            progressGroup.style.display = '';
        }

        if (progressText && statusMessage) {
            progressText.textContent = statusMessage;
        }

        this.isShowingBusyState = true;
    }

    /**
     * Hide the progress/busy indicator.
     */
    clearBusyState() {
        const progressGroup = document.querySelector(`${PANEL_SELECTORS.PANEL_ROOT} ${PANEL_SELECTORS.PROGRESS_GROUP}`);
        const progressText = document.querySelector(`${PANEL_SELECTORS.PANEL_ROOT} ${PANEL_SELECTORS.PROGRESS_TEXT}`);
        
        if (progressGroup) {
            progressGroup.style.display = 'none';
        }

        if (progressText) {
            progressText.textContent = game.i18n.localize('QUICKBATTLEMAP.ProgressIdle');
        }

        this.isShowingBusyState = false;
    }

    /**
     * Reset all status indicators to their default (empty) state.
     * @param {boolean} persistedNoGridValue - Whether to check the no-grid checkbox
     */
    resetAllStatuses(persistedNoGridValue) {
        this.updateBackgroundMediaStatus(false, '');
        this.updateWallDataStatus(false, '');
        this.setCreateButtonEnabled(false);

        // Hide and reset progress indicator
        const progressGroup = document.querySelector(`${PANEL_SELECTORS.PANEL_ROOT} ${PANEL_SELECTORS.PROGRESS_GROUP}`);
        const progressText = document.querySelector(`${PANEL_SELECTORS.PANEL_ROOT} ${PANEL_SELECTORS.PROGRESS_TEXT}`);

        if (progressGroup) {
            progressGroup.style.display = 'none';
        }

        if (progressText) {
            progressText.textContent = game.i18n.localize('QUICKBATTLEMAP.ProgressIdle');
        }

        // Restore no-grid checkbox to persisted value
        const noGridCheckbox = document.querySelector(`${PANEL_SELECTORS.PANEL_ROOT} ${PANEL_SELECTORS.NO_GRID_CHECKBOX}`);
        if (noGridCheckbox) {
            noGridCheckbox.checked = !!persistedNoGridValue;
        }
    }

    /**
     * Get the current state of the no-grid checkbox.
     * @returns {boolean} Whether no-grid mode is selected
     */
    getNoGridCheckboxState() {
        const checkbox = document.querySelector(`${PANEL_SELECTORS.PANEL_ROOT} ${PANEL_SELECTORS.NO_GRID_CHECKBOX}`);
        return !!checkbox?.checked;
    }

    /**
     * Set the state of the no-grid checkbox.
     * @param {boolean} isChecked - Whether the checkbox should be checked
     */
    setNoGridCheckboxState(isChecked) {
        const checkbox = document.querySelector(`${PANEL_SELECTORS.PANEL_ROOT} ${PANEL_SELECTORS.NO_GRID_CHECKBOX}`);
        if (checkbox) {
            checkbox.checked = !!isChecked;
        }
    }
}
