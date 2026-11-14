import { create } from 'zustand';
import { z } from 'zod';
import { DEFAULT_WALLPAPER, wallpaperById } from '../desktop/wallpapers';
import { readJson, writeJson } from '../lib/storage';

// Look-and-feel preferences that are not window layout. (The light/dark theme itself still lives in
// the window store, next to the layout that was saved with it.)

const KEY = 'gfv.appearance.v1';
const Schema = z.object({
  wallpaper: z.string(),
  /** Replace blur/translucency with solid colours (also automatic with prefers-reduced-transparency). */
  reduceTransparency: z.boolean(),
});

interface AppearanceState {
  wallpaper: string;
  reduceTransparency: boolean;
  setWallpaper: (id: string) => void;
  setReduceTransparency: (on: boolean) => void;
}

function initial(): Pick<AppearanceState, 'wallpaper' | 'reduceTransparency'> {
  const parsed = Schema.safeParse(readJson(KEY));
  if (!parsed.success) return { wallpaper: DEFAULT_WALLPAPER, reduceTransparency: false };
  return { ...parsed.data, wallpaper: wallpaperById(parsed.data.wallpaper).id };
}

export const useAppearance = create<AppearanceState>((set) => ({
  ...initial(),
  setWallpaper: (id) => set({ wallpaper: wallpaperById(id).id }),
  setReduceTransparency: (on) => set({ reduceTransparency: on }),
}));

useAppearance.subscribe((s) => {
  const { wallpaper, reduceTransparency } = s;
  writeJson(KEY, { wallpaper, reduceTransparency });
});
