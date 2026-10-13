import { defineToolbarApp } from 'astro/toolbar';
import { mountEditor, setVisible, canHideEditor } from './client.js';

export default defineToolbarApp({
  init(canvas, app) {
    const editor = mountEditor(canvas);
    app.onToolbarPlacementUpdated(({ placement }) => { editor.placement = placement; });
    app.onToggled(({ state }) => setVisible(state));
    window.addEventListener('astro-copyedit:visibility', event => app.toggleState({ state: event.detail.visible }));
  },
  beforeTogglingOff() { return canHideEditor(); },
});
