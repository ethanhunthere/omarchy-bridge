import React, { memo } from 'react';
import { Platform, Text } from 'react-native';
import { ThemeTokens, useTheme, useThemedStyles } from '../../../shared/theme';

type Styles = ReturnType<typeof makeStyles>;

// ==========================================
// Line-level memoization + theme-aware pure cache
// ==========================================
const styledLineCache = new Map<string, React.ReactNode>();
const MAX_STYLED_LINE_CACHE = 500;

function renderStyledLine(line: string, styles: Styles): React.ReactNode {
  if (!line || line.trim() === '') {
    return <Text style={styles.textMuted}>{' '}</Text>;
  }

  // 1. Starship prompt line: "~ ❯ cmd" or "❯ cmd"
  if (line.includes(' ❯ ') || line.startsWith('❯ ') || line.startsWith('~ ❯')) {
    const parts = line.split(/(❯)/);
    return (
      <Text>
        <Text style={styles.promptPath}>{parts[0]}</Text>
        <Text style={styles.promptArrow}>❯</Text>
        <Text style={styles.promptCmd}>{parts.slice(2).join('')}</Text>
      </Text>
    );
  }

  // 2. Failed exit code Starship prompt: "~ ✗ cmd"
  if (line.includes(' ✗ ') || line.startsWith('✗ ') || line.startsWith('~ ✗')) {
    const parts = line.split(/(✗)/);
    return (
      <Text>
        <Text style={styles.promptPath}>{parts[0]}</Text>
        <Text style={styles.promptFail}>✗</Text>
        <Text style={styles.promptCmd}>{parts.slice(2).join('')}</Text>
      </Text>
    );
  }

  // 3. Antigravity prompt: ">" or "> "
  if (line.startsWith('>') || line.startsWith(' > ')) {
    return (
      <Text>
        <Text style={styles.promptArrow}>&gt; </Text>
        <Text style={styles.textWhite}>{line.replace(/^>\s*/, '')}</Text>
      </Text>
    );
  }

  // 4. Antigravity logo characters (▄▀)
  if (line.includes('▄▀') || line.includes('▀▀')) {
    return <Text style={styles.logoText}>{line}</Text>;
  }

  // 5. Section dividers (───)
  if (/^[─━\-_=]{3,}$/.test(line.trim())) {
    return <Text style={styles.dividerLine}>{line}</Text>;
  }

  // 6. Errors or failures
  if (/^(error|fatal|fail|exception):/i.test(line.trim()) || line.includes('error:')) {
    return <Text style={styles.textRed}>{line}</Text>;
  }

  // 7. Warnings or notices
  if (/^(warning|notice):/i.test(line.trim())) {
    return <Text style={styles.textAmber}>{line}</Text>;
  }

  // 8. Success / Pass
  if (/^(\[PASS\]|success)/i.test(line.trim())) {
    return <Text style={styles.textGreen}>{line}</Text>;
  }

  // 9. Status bar (e.g. "? for shortcuts ... Gemini")
  if (line.includes('? for shortcuts') || line.includes('Gemini')) {
    return <Text style={styles.statusBarText}>{line}</Text>;
  }

  // 10. Default clean text
  return <Text style={styles.textNormal}>{line}</Text>;
}

function getCachedStyledLine(themeId: string, line: string, styles: Styles): React.ReactNode {
  const key = `${themeId}|${line}`;
  let cached = styledLineCache.get(key);
  if (cached === undefined) {
    if (styledLineCache.size >= MAX_STYLED_LINE_CACHE) {
      let count = 0;
      for (const k of styledLineCache.keys()) {
        styledLineCache.delete(k);
        if (++count >= 100) break;
      }
    }
    cached = renderStyledLine(line, styles);
    styledLineCache.set(key, cached);
  }
  return cached;
}

export const TerminalLine = memo(function TerminalLine({ line }: { line: string }) {
  const styles = useThemedStyles(makeStyles);
  const { themeId } = useTheme();
  return (
    <Text style={styles.terminalLine} selectable allowFontScaling={false}>
      {getCachedStyledLine(themeId, line, styles)}
    </Text>
  );
});

const makeStyles = (t: ThemeTokens) =>
  ({
    terminalLine: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13.5,
      lineHeight: 20,
      color: t.terminalText,
      letterSpacing: 0.2,
    },
    promptPath: {
      color: t.promptPath,
      fontWeight: '700',
    },
    promptArrow: {
      color: t.promptArrow,
      fontWeight: '800',
    },
    promptFail: {
      color: t.promptFail,
      fontWeight: '800',
    },
    promptCmd: {
      color: t.textPrimary,
      fontWeight: '600',
    },
    textWhite: {
      color: t.textPrimary,
    },
    textNormal: {
      color: t.terminalText,
    },
    textMuted: {
      color: t.textMuted,
    },
    textRed: {
      color: t.danger,
    },
    textAmber: {
      color: t.warning,
    },
    textGreen: {
      color: t.success,
    },
    logoText: {
      color: t.logo,
      fontWeight: '700',
    },
    dividerLine: {
      color: t.divider,
    },
    statusBarText: {
      color: t.textSecondary,
      fontSize: 11,
    },
  }) as const;
