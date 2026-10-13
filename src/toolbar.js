import { defineToolbarApp } from 'astro/toolbar';
import { mountEditor, setEnabled, isEditing, isEnabled } from './client.js';

export default defineToolbarApp({
  init(canvas, app) {
    const editor = mountEditor(canvas);
    app.onToolbarPlacementUpdated(({ placement }) => { editor.placement = placement; });
    app.onToggled(({ state }) => setEnabled(state));
    window.addEventListener('astro-copyedit:state', event => app.toggleState({ state: event.detail.enabled }));
    if (isEnabled()) app.toggleState({ state: true });
  },
  beforeTogglingOff() { return !isEditing(); },
});
