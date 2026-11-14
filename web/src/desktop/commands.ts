import { appById } from '../apps/registry';
import { useRecording } from '../stores/recordingStore';
import { useServers } from '../stores/serverStore';
import { toast } from '../stores/toastStore';
import { useTour } from '../tour/tourStore';
import { openApp } from './openApp';
import { useOverlays } from './overlayStore';

/**
 * Things you can do from more than one place (menu bar, Control Center, Spotlight). Each one lives here
 * once, so they all behave identically and report the same notifications.
 */
export const commands = {
  async toggleRecording(): Promise<void> {
    const rec = useRecording.getState();
    if (rec.active) {
      const id = await rec.stop();
      if (id) {
        openApp(appById('recipes')!);
        toast({ kind: 'success', title: 'Recording saved', body: 'Find it in Recipes.' });
      }
      return;
    }
    const { activeId, servers } = useServers.getState();
    if (!activeId) {
      toast({ kind: 'error', title: 'Pick a server first' });
      return;
    }
    try {
      await rec.start(activeId);
      const name = servers.find((s) => s.id === activeId)?.name ?? 'the server';
      toast({
        title: 'Recording started',
        body: `Actions you run on ${name} are saved as steps of a recipe.`,
      });
    } catch {
      toast({ kind: 'error', title: 'Could not start recording' });
    }
  },
  lock: () => void useServers.getState().lock(),
  tour: () => useTour.getState().start(),
  changePassword: () => useOverlays.getState().setPasswordDialog(true),
  missionControl: () => useOverlays.getState().setOverview(!useOverlays.getState().overview),
  controlCenter: () =>
    useOverlays.getState().setControlCenter(!useOverlays.getState().controlCenter),
  spotlight: () => useOverlays.getState().setSpotlight(!useOverlays.getState().spotlight),
};
