import { launchableFor } from '../apps/registry';
import { useAuth } from './authStore';

/** The apps this person may open (account management is for administrators of a hosted install only). */
export function useLaunchable() {
  const status = useAuth((s) => s.status);
  return launchableFor(!!status?.hosted, status?.user?.role === 'admin');
}
