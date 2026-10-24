import { useCallback } from 'react';
import * as Haptics from 'expo-haptics';

export type HapticKind = 'light' | 'medium' | 'warning';

export function useHaptics() {
  return useCallback((type: HapticKind = 'light') => {
    try {
      if (type === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      else if (type === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      else if (type === 'warning') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch (e) {}
  }, []);
}
