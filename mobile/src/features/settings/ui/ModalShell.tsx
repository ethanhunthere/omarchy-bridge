import React from 'react';
import { Animated, KeyboardAvoidingView, Platform } from 'react-native';

// iOS animates the inset in step with the keyboard; Android lets the dialog
// KeyboardAvoidingView shrink instead.
export function ModalShell({ style, children }: { style: any; children: React.ReactNode }) {
  if (Platform.OS === 'ios') return <Animated.View style={style}>{children}</Animated.View>;
  return (
    <KeyboardAvoidingView style={style} behavior="height">
      {children}
    </KeyboardAvoidingView>
  );
}

