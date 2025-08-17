import { EasyBattlemapDropHandler } from './lib/drop-handler.js';

Hooks.once('init', async function() {
  console.log('Easy Battlemap | Initializing Easy Battlemap');
});

Hooks.once('ready', async function() {
  console.log('Easy Battlemap | Ready');
  
  // Register the drop handler when Foundry is ready
  new EasyBattlemapDropHandler().registerDropHandler();
  
  ui.notifications.info(game.i18n.localize("EASYBATTLEMAP.Ready"));
});