export class EasyBattlemapDropHandler {
  constructor() {
    this.backgroundImage = null;
    this.wallData = null;
    this.processingQueue = {};
  }

  registerDropHandler() {
    // Add the drop area to the sidebar
    this._addDropArea();
    
    // Register the drop handler on the canvas
    this._registerCanvasDropHandler();
    
    // Register the drop handler for the custom drop area
    this._registerDropAreaHandler();
  }

  _addDropArea() {
    const dropAreaHTML = `
      <div id="easy-battlemap-drop-area" class="app">
        <header class="app-header flexrow">
          <h4>${game.i18n.localize("EASYBATTLEMAP.DropAreaTitle")}</h4>
        </header>
        <section class="easy-battlemap-dropzone">
          <div class="easy-battlemap-instructions">
            ${game.i18n.localize("EASYBATTLEMAP.DropInstructions")}
          </div>
          <div class="easy-battlemap-status">
            <div class="background-status">
              ${game.i18n.localize("EASYBATTLEMAP.BackgroundStatus")}: <span class="status-value">❌</span>
            </div>
            <div class="wall-data-status">
              ${game.i18n.localize("EASYBATTLEMAP.WallDataStatus")}: <span class="status-value">❌</span>
            </div>
          </div>
          <button class="create-scene-button" disabled>
            ${game.i18n.localize("EASYBATTLEMAP.CreateScene")}
          </button>
        </section>
      </div>
    `;

    // Add to sidebar
    const sidebarTab = document.getElementById('scenes');
    if (sidebarTab) {
      sidebarTab.insertAdjacentHTML('afterend', dropAreaHTML);
      
      // Add click handler for the create button
      document.querySelector('.create-scene-button').addEventListener('click', () => {
        this._createScene();
      });
    }
  }

  _registerCanvasDropHandler() {
    // Handle drops on the canvas
    canvas.stage.on('drop', (event) => {
      this._handleDrop(event.data.originalEvent);
    });
  }

  _registerDropAreaHandler() {
    const dropArea = document.getElementById('easy-battlemap-drop-area');
    if (!dropArea) return;
    
    // Add event listeners for drag and drop
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dropArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      }, false);
    });
    
    // Handle drag enter/over
    ['dragenter', 'dragover'].forEach(eventName => {
      dropArea.addEventListener(eventName, () => {
        dropArea.classList.add('highlight');
      }, false);
    });
    
    // Handle drag leave/drop
    ['dragleave', 'drop'].forEach(eventName => {
      dropArea.addEventListener(eventName, () => {
        dropArea.classList.remove('highlight');
      }, false);
    });
    
    // Handle drop
    dropArea.addEventListener('drop', (e) => {
      this._handleDrop(e);
    }, false);
  }

  _handleDrop(event) {
    const files = event.dataTransfer.files;
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      if (file.type.match('image.*')) {
        this._processImageFile(file);
      } else if (file.name.endsWith('.json')) {
        this._processJSONFile(file);
      }
    }
  }

  _processImageFile(file) {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      this.backgroundImage = {
        data: e.target.result,
        filename: file.name
      };
      
      // Update the UI to show the background is ready
      document.querySelector('.background-status .status-value').textContent = '✅';
      document.querySelector('.background-status .status-value').title = file.name;
      
      this._checkReadyToCreate();
    };
    
    reader.readAsDataURL(file);
  }

  _processJSONFile(file) {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const jsonData = JSON.parse(e.target.result);
        this.wallData = jsonData;
        
        // Update the UI to show the wall data is ready
        document.querySelector('.wall-data-status .status-value').textContent = '✅';
        document.querySelector('.wall-data-status .status-value').title = file.name;
        
        this._checkReadyToCreate();
      } catch (error) {
        ui.notifications.error(game.i18n.localize("EASYBATTLEMAP.InvalidJSON"));
      }
    };
    
    reader.readAsText(file);
  }

  _checkReadyToCreate() {
    const createButton = document.querySelector('.create-scene-button');
    if (this.backgroundImage && this.wallData) {
      createButton.disabled = false;
    } else {
      createButton.disabled = true;
    }
  }

  async _createScene() {
    if (!this.backgroundImage || !this.wallData) {
      ui.notifications.error(game.i18n.localize("EASYBATTLEMAP.MissingFiles"));
      return;
    }
    
    try {
      ui.notifications.info(game.i18n.localize("EASYBATTLEMAP.CreatingScene"));
      
      // First, we need to upload the background image to the server
      const uploadResponse = await this._uploadImage(this.backgroundImage);
      
      if (!uploadResponse.path) {
        ui.notifications.error(game.i18n.localize("EASYBATTLEMAP.UploadFailed"));
        return;
      }
      
      // Extract scene name from the image filename
      const sceneName = this.backgroundImage.filename.split('.').slice(0, -1).join('.');
      
      // Get image dimensions
      const img = new Image();
      img.src = this.backgroundImage.data;
      
      await new Promise(resolve => {
        img.onload = resolve;
      });
      
      // Create the scene
      const sceneData = {
        name: sceneName,
        img: uploadResponse.path,
        width: img.width,
        height: img.height,
        padding: 0,
        backgroundColor: "#000000",
        grid: {
          type: 1, // Square grid
          size: 100,
          color: "#000000",
          alpha: 0.2
        },
        walls: this.wallData.walls || [],
        lights: this.wallData.lights || [],
        notes: this.wallData.notes || [],
        tokens: this.wallData.tokens || [],
        drawings: this.wallData.drawings || []
      };
      
      const scene = await Scene.create(sceneData);
      
      // Reset the data after creating the scene
      this.backgroundImage = null;
      this.wallData = null;
      
      // Reset the UI
      document.querySelector('.background-status .status-value').textContent = '❌';
      document.querySelector('.wall-data-status .status-value').textContent = '❌';
      document.querySelector('.create-scene-button').disabled = true;
      
      ui.notifications.success(`${game.i18n.localize("EASYBATTLEMAP.SceneCreated")}: ${sceneName}`);
      
      // Activate the scene
      await scene.activate();
      
    } catch (error) {
      console.error(error);
      ui.notifications.error(game.i18n.localize("EASYBATTLEMAP.SceneCreationFailed"));
    }
  }

  async _uploadImage(imageData) {
    const formData = new FormData();
    
    // Convert base64 to a blob
    const base64Response = await fetch(imageData.data);
    const blob = await base64Response.blob();
    
    formData.append('file', blob, imageData.filename);
    formData.append('path', 'scenes');
    
    const response = await fetch('/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${game.data.session}`
      },
      body: formData
    });
    
    if (!response.ok) {
      throw new Error('Upload failed');
    }
    
    return await response.json();
  }
}