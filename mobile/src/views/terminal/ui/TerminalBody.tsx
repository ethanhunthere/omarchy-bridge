import React, { memo, useMemo } from 'react';
import { Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { ThemeTokens, useTheme, useThemedStyles } from '../../../shared/theme';
import { parseAnsi, StyledSegment } from '../../../entities/bridge';
import { TerminalLine } from './TerminalLine';

// ==========================================
// Terminal body — memoized so typing never re-renders the output.
// ==========================================
export const TerminalBody = memo(function TerminalBody({
  screenLines,
  terminalText,
  autoScroll,
  onPress,
  onContentSizeChange,
  scrollViewRef,
}: {
  screenLines: string[];
  terminalText: string;
  autoScroll: boolean;
  onPress: () => void;
  onContentSizeChange: () => void;
  scrollViewRef: React.RefObject<ScrollView | null>;
}) {
  const styles = useThemedStyles(makeStyles);
  const { theme } = useTheme();

  const parsedSegments: StyledSegment[] = useMemo(() => {
    if (screenLines.length > 0 || !terminalText) return [];
    return parseAnsi(terminalText, theme.terminalText, theme.ansi);
  }, [screenLines.length, terminalText, theme]);

  const renderedScreenLines = useMemo(
    () => screenLines.map((line, idx) => <TerminalLine key={idx} line={line} />),
    [screenLines]
  );

  const renderedParsedSegments = useMemo(
    () =>
      parsedSegments.map((seg, idx) => (
        <Text
          key={idx}
          allowFontScaling={false}
          style={{
            color: seg.color || theme.terminalText,
            fontWeight: seg.bold ? '700' : '400',
            fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
            fontSize: 12,
            lineHeight: 18,
          }}
        >
          {seg.text}
        </Text>
      )),
    [parsedSegments, theme]
  );

  return (
    <ScrollView
      ref={scrollViewRef}
      style={styles.terminalViewport}
      contentContainerStyle={styles.terminalContent}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="none"
      onContentSizeChange={() => {
        if (autoScroll) onContentSizeChange();
      }}
    >
      <TouchableOpacity activeOpacity={1} onPress={onPress} style={styles.touchableTerminal}>
        {screenLines.length === 0 && !terminalText ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyPrompt}>[omarchy-remote ready]</Text>
            <Text style={styles.emptySub}>Tap anywhere to start typing...</Text>
          </View>
        ) : screenLines.length > 0 ? (
          renderedScreenLines
        ) : (
          renderedParsedSegments
        )}
      </TouchableOpacity>
    </ScrollView>
  );
});

const makeStyles = (t: ThemeTokens) =>
  ({
    terminalViewport: {
      flex: 1,
      backgroundColor: t.bg,
      paddingHorizontal: 8,
    },
    terminalContent: {
      flexGrow: 1,
      paddingTop: 8,
      paddingBottom: 24,
    },
    touchableTerminal: {
      flex: 1,
      minHeight: '100%',
    },
    emptyContainer: {
      paddingVertical: 50,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyPrompt: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 14,
      color: t.textMuted,
      fontWeight: '700',
    },
    emptySub: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12,
      color: t.textMuted,
      marginTop: 6,
    },
  }) as const;
