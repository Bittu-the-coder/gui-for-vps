import { useEffect, useRef } from 'react';
import type { MenuItem } from '../components/menu/menuItems';

/** What an app adds to the menu bar while its window is focused. */
export interface AppMenus {
  file?: MenuItem[];
  edit?: MenuItem[];
  view?: MenuItem[];
}

// Not reactive on purpose: the menu bar asks for the items at the moment a menu is OPENED, so enabled/
// disabled states are always current without re-rendering the whole bar on every keystroke in an app.
const getters = new Map<string, () => AppMenus>();

export function appMenusFor(windowId: string | undefined): AppMenus {
  return (windowId && getters.get(windowId)?.()) || {};
}

/**
 * Call once in an app, then call the returned function on every render with a getter for the latest items:
 *
 *     const provide = useAppMenus(windowId);
 *     provide(() => ({ file: [{ label: 'Save', onSelect: save }] }));
 */
export function useAppMenus(windowId: string): (get: () => AppMenus) => void {
  const latest = useRef<() => AppMenus>(() => ({}));
  useEffect(() => {
    getters.set(windowId, () => latest.current());
    return () => {
      getters.delete(windowId);
    };
  }, [windowId]);
  return (get) => {
    latest.current = get;
  };
}
