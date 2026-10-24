import React from 'react';
import { Platform, StatusBar, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, useThemedStyles } from '../theme';
import { ThemeTokens } from '../theme';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

function ErrorFallback({ message, onReload }: { message?: string; onReload: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { theme } = useTheme();
  return (
    <SafeAreaView style={styles.errorContainer}>
      <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
      <View style={styles.errorCard}>
        <Text style={styles.errorBadge}>CRASH INTERCEPTED</Text>
        <Text style={styles.errorTitle}>Session Recovered</Text>
        <Text style={styles.errorDesc}>
          {message || 'An unexpected rendering anomaly occurred and was safely caught.'}
        </Text>
        <TouchableOpacity style={styles.errorReloadBtn} onPress={onReload} activeOpacity={0.8}>
          <Text style={styles.errorReloadText}>RELOAD BRIDGE</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[CRITICAL] Unhandled UI error caught by ErrorBoundary:', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return <ErrorFallback message={this.state.error?.message} onReload={this.handleReload} />;
    }
    return this.props.children;
  }
}

const makeStyles = (t: ThemeTokens) =>
  ({
    errorContainer: {
      flex: 1,
      backgroundColor: t.bg,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    errorCard: {
      backgroundColor: t.surfaceElevated,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.dangerBorder,
      padding: 20,
      width: '100%',
      maxWidth: 420,
      alignItems: 'center',
    },
    errorBadge: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 10.5,
      fontWeight: '800',
      color: t.danger,
      backgroundColor: t.dangerBg,
      borderWidth: 1,
      borderColor: t.dangerBorder,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 4,
      marginBottom: 12,
      letterSpacing: 1,
      overflow: 'hidden',
    },
    errorTitle: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 16,
      fontWeight: '800',
      color: t.textPrimary,
      marginBottom: 8,
    },
    errorDesc: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12,
      lineHeight: 18,
      color: t.textSecondary,
      textAlign: 'center',
      marginBottom: 20,
    },
    errorReloadBtn: {
      backgroundColor: t.accent,
      paddingHorizontal: 20,
      paddingVertical: 12,
      minHeight: 44,
      justifyContent: 'center',
      borderRadius: 6,
      alignItems: 'center',
    },
    errorReloadText: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12,
      fontWeight: '800',
      color: t.accentText,
      letterSpacing: 0.5,
    },
  }) as const;
