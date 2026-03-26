import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Radius, Shadow } from '@/constants/theme';

interface GradientCardProps {
  children: React.ReactNode;
  colors?: readonly [string, string, ...string[]];
  style?: ViewStyle;
  innerStyle?: ViewStyle;
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  glow?: string;
}

export function GradientCard({
  children,
  colors = ['#1E293B', '#162032'],
  style,
  innerStyle,
  start = { x: 0, y: 0 },
  end = { x: 1, y: 1 },
  glow,
}: GradientCardProps) {
  return (
    <LinearGradient
      colors={colors}
      start={start}
      end={end}
      style={[
        styles.card,
        glow ? Shadow.glow(glow) : Shadow.md,
        style,
      ]}
    >
      <View style={[styles.inner, innerStyle]}>{children}</View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  inner: {
    padding: 16,
  },
});
