/**
 * Wallpapers are generated with CSS gradients, so there are no image files to download or ship.
 * Every wallpaper has a light and a dark variant; the Wallpaper component crossfades between them
 * when the theme changes ("dynamic" wallpaper).
 */
export interface WallpaperDef {
  id: string;
  name: string;
  light: string; // a CSS `background` value
  dark: string;
}

export const WALLPAPERS: WallpaperDef[] = [
  {
    id: 'aurora',
    name: 'Aurora',
    light:
      'radial-gradient(60% 55% at 15% 20%, #8ecbff 0%, transparent 70%),' +
      'radial-gradient(55% 60% at 85% 15%, #c9b6ff 0%, transparent 70%),' +
      'radial-gradient(70% 60% at 70% 90%, #9be7d8 0%, transparent 70%),' +
      'linear-gradient(135deg, #dbe8ff, #efe7ff)',
    dark:
      'radial-gradient(60% 55% at 15% 20%, #1d4e89 0%, transparent 70%),' +
      'radial-gradient(55% 60% at 85% 15%, #4b2f8f 0%, transparent 70%),' +
      'radial-gradient(70% 60% at 70% 90%, #0f5a57 0%, transparent 70%),' +
      'linear-gradient(135deg, #0b1226, #160f2e)',
  },
  {
    id: 'dusk',
    name: 'Dusk',
    light:
      'radial-gradient(60% 55% at 20% 85%, #ffc59e 0%, transparent 70%),' +
      'radial-gradient(60% 60% at 80% 20%, #ffb3d1 0%, transparent 70%),' +
      'radial-gradient(50% 50% at 50% 50%, #ffe3b8 0%, transparent 75%),' +
      'linear-gradient(160deg, #ffe9dc, #f6dcff)',
    dark:
      'radial-gradient(60% 55% at 20% 85%, #8a3a1f 0%, transparent 70%),' +
      'radial-gradient(60% 60% at 80% 20%, #7a2552 0%, transparent 70%),' +
      'radial-gradient(50% 50% at 50% 50%, #4a2a1a 0%, transparent 75%),' +
      'linear-gradient(160deg, #1d0f1c, #12101f)',
  },
  {
    id: 'meadow',
    name: 'Meadow',
    light:
      'radial-gradient(65% 55% at 10% 90%, #b6f0b0 0%, transparent 70%),' +
      'radial-gradient(60% 60% at 90% 20%, #a8e6f0 0%, transparent 70%),' +
      'radial-gradient(50% 50% at 50% 40%, #e8f7b8 0%, transparent 75%),' +
      'linear-gradient(150deg, #e2f6e6, #d6f0f6)',
    dark:
      'radial-gradient(65% 55% at 10% 90%, #1d5a2c 0%, transparent 70%),' +
      'radial-gradient(60% 60% at 90% 20%, #124e5b 0%, transparent 70%),' +
      'radial-gradient(50% 50% at 50% 40%, #31501a 0%, transparent 75%),' +
      'linear-gradient(150deg, #0c1a12, #0a1a20)',
  },
  {
    id: 'graphite',
    name: 'Graphite',
    light:
      'radial-gradient(70% 60% at 30% 20%, #ffffff 0%, transparent 70%),' +
      'radial-gradient(60% 60% at 80% 90%, #d6d6dc 0%, transparent 70%),' +
      'linear-gradient(135deg, #ececf0, #dcdce2)',
    dark:
      'radial-gradient(70% 60% at 30% 20%, #3a3a40 0%, transparent 70%),' +
      'radial-gradient(60% 60% at 80% 90%, #1a1a1f 0%, transparent 70%),' +
      'linear-gradient(135deg, #1c1c20, #101013)',
  },
];

export const DEFAULT_WALLPAPER = WALLPAPERS[0]!.id;

export function wallpaperById(id: string): WallpaperDef {
  return WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0]!;
}
