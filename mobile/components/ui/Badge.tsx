import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Colors, Radius } from '@/constants/theme';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'purple' | 'default';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  style?: ViewStyle;
}

const variantMap: Record<BadgeVariant, { bg: string; text: string }> = {
  success: { bg: Colors.successBg, text: Colors.success },
  warning: { bg: Colors.warningBg, text: Colors.warning },
  danger: { bg: Colors.dangerBg, text: Colors.danger },
  info: { bg: Colors.infoBg, text: Colors.info },
  primary: { bg: Colors.primaryBg, text: Colors.primary },
  purple: { bg: 'rgba(139,92,246,0.12)', text: '#8B5CF6' },
  default: { bg: 'rgba(113,113,122,0.15)', text: Colors.textSub },
};

export function Badge({ label, variant = 'default', style }: BadgeProps) {
  const { bg, text } = variantMap[variant];
  return (
    <View style={[styles.badge, { backgroundColor: bg }, style]}>
      <Text style={[styles.text, { color: text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
