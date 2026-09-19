import { describe, expect, it } from 'vitest';
import * as UI from '@wms/ui';
import { PANEL_DESCRIPTORS } from '../../src/dock/layoutDefaults';

describe('module resolution', () => {
  it('every @wms/ui symbol the shell imports is defined', () => {
    for (const name of ['DockRoot','LayoutStore','PanelRegistry','useDockApi','Menu','MenuBar','ContextMenu','useContextMenu','Spinner','Toaster','Badge','Button','IconButton','Slider','Tooltip','ThemeToggle','StatusDot','cn']) {
      expect((UI as Record<string, unknown>)[name], `@wms/ui.${name} is undefined`).toBeDefined();
    }
  });
  it('every registered panel has a real component', () => {
    expect(PANEL_DESCRIPTORS).toHaveLength(6);
    for (const d of PANEL_DESCRIPTORS) {
      expect(typeof d.component, `${d.id} component`).toBe('function');
      expect(d.icon, `${d.id} icon`).toBeDefined();
    }
  });
});
