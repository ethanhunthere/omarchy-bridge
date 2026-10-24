import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Keyboard, Platform, View } from 'react-native';
import { ThemeTokens, useThemedStyles } from '../../shared/theme';
import { BridgeController } from '../../entities/bridge';
import { KeycapRibbon, TerminalInput } from '../../widgets/composer';
import type { TerminalInputHandle } from '../../widgets/composer';
import { TerminalBody } from './ui/TerminalBody';

// ==========================================
// Terminal tab composition
// ==========================================
export default function TerminalView({ bridge }: { bridge: BridgeController }) {
  const styles = useThemedStyles(makeStyles);
  const inputHandleRef = useRef<TerminalInputHandle>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const {
    screenLines,
    terminalText,
    autoScroll,
    setAutoScroll,
    status,
    sendCommand,
    sendSignal,
    clearScreen,
    nextHistoryValue,
    scrollViewRef,
    scrollRafRef,
  } = bridge;

  const onContentSizeChange = useCallback(() => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      scrollViewRef.current?.scrollToEnd({ animated: false });
    });
  }, [scrollRafRef, scrollViewRef]);

  // Keyboard insets land after a layout pass; pin to the newest line then.
  useEffect(() => {
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const show = Keyboard.addListener('keyboardDidShow', () => {
      if (!autoScroll) return;
      scrollViewRef.current?.scrollToEnd({ animated: true });
      // The inset animation runs ~250ms; settle once more after it lands.
      settleTimer = setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 300);
    });
    return () => {
      if (settleTimer) clearTimeout(settleTimer);
      show.remove();
    };
  }, [autoScroll, scrollViewRef]);

  // Animate the inset ourselves instead of jumping: KeyboardAvoidingView
  // applies its padding in one frame, which makes the keycap row appear to
  // flash above the keyboard while iOS is still sliding it up.
  const anchorRef = useRef<View>(null);
  const anchorBottomRef = useRef(0);
  const keyboardInset = useRef(new Animated.Value(0)).current;

  const measureAnchor = useCallback(() => {
    anchorRef.current?.measureInWindow?.((_x: number, y: number, _w: number, h: number) => {
      if (typeof y === 'number' && typeof h === 'number') anchorBottomRef.current = y + h;
    });
  }, []);

  useEffect(() => {
    measureAnchor();
    const dims = Dimensions.addEventListener('change', measureAnchor);
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', measureAnchor);
    return () => {
      dims.remove();
      show.remove();
    };
  }, [measureAnchor]);

  useEffect(() => {
    // Android resizes the window itself (softwareKeyboardLayoutMode=resize),
    // so only iOS needs the animated inset.
    if (Platform.OS !== 'ios') return;
    const sub = Keyboard.addListener('keyboardWillChangeFrame', (e) => {
      if (!e.endCoordinates) return;
      const overlap = Math.max(0, anchorBottomRef.current - e.endCoordinates.screenY);
      Animated.timing(keyboardInset, {
        toValue: overlap,
        duration: e.duration || 250,
        easing: Easing.bezier(0.17, 0.59, 0.4, 0.99),
        useNativeDriver: false,
      }).start();
    });
    return () => sub.remove();
  }, [keyboardInset]);

  // Tap the output: open the keyboard, or close it if it is already up.
  const onTerminalPress = useCallback(() => {
    if (inputFocused) {
      Keyboard.dismiss();
    } else {
      inputHandleRef.current?.focus();
    }
  }, [inputFocused]);
  const onInputFocused = useCallback(() => setInputFocused(true), []);
  const onInputBlurred = useCallback(() => setInputFocused(false), []);

  const onToggleAutoScroll = useCallback(() => setAutoScroll((p) => !p), [setAutoScroll]);
  const onHistory = useCallback(
    (direction: 'up' | 'down') => {
      const next = nextHistoryValue(direction);
      if (next !== null) inputHandleRef.current?.setValue(next);
      inputHandleRef.current?.focus();
    },
    [nextHistoryValue]
  );
  const onPrefill = useCallback(() => {
    inputHandleRef.current?.setValue('agy');
    inputHandleRef.current?.focus();
  }, []);

  return (
    <View ref={anchorRef} style={styles.flexOne} collapsable={false} onLayout={measureAnchor}>
      <Animated.View style={[styles.flexOne, { paddingBottom: keyboardInset }]}>
        <View style={styles.flexOne}>
          <TerminalBody
            screenLines={screenLines}
            terminalText={terminalText}
            autoScroll={autoScroll}
            onPress={onTerminalPress}
            onContentSizeChange={onContentSizeChange}
            scrollViewRef={scrollViewRef}
          />
          <KeycapRibbon
            autoScroll={autoScroll}
            onToggleAutoScroll={onToggleAutoScroll}
            onSignal={sendSignal}
            onHistory={onHistory}
            onClear={clearScreen}
            onPrefill={onPrefill}
          />
          <TerminalInput
            ref={inputHandleRef}
            status={status}
            onSend={sendCommand}
            onFocused={onInputFocused}
            onBlurred={onInputBlurred}
          />
        </View>
      </Animated.View>
    </View>
  );
}

const makeStyles = (t: ThemeTokens) =>
  ({
    flexOne: {
      flex: 1,
    },
  }) as const;
