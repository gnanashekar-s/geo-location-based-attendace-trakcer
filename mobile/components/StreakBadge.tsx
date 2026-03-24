import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, ViewStyle, Animated } from 'react-native';
import { Text } from 'react-native-paper';

interface Props {
  streakCount: number;
  size?: 'small' | 'large';
  style?: ViewStyle;
}

export function StreakBadge({ streakCount, size = 'large', style }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.9)).current;
  const isLegendary = streakCount >= 30;
  const isSmall = size === 'small';

  useEffect(() => {
    if (streakCount === 0) return;
    const anim = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, { toValue: isSmall ? 1.1 : 1.15, duration: 600, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1.0, duration: 600, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1.0, duration: 600, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.8, duration: 600, useNativeDriver: true }),
        ]),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [streakCount]);

  if (streakCount === 0) return null;

  return (
    <View style={[styles.container, isLegendary && styles.legendary, isSmall && styles.small, style]}>
      <Animated.Text style={[styles.flame, isSmall && styles.flameSmall, { transform: [{ scale }], opacity }]}>
        🔥
      </Animated.Text>
      <View style={styles.textContainer}>
        <Text style={[styles.count, isSmall && styles.countSmall, isLegendary && styles.countLegendary]}>
          {streakCount}
        </Text>
        <Text style={[styles.label, isSmall && styles.labelSmall]}>
          {isSmall ? 'days' : 'day streak'}
        </Text>
      </View>
      {isLegendary && !isSmall && (
        <Text style={styles.legendaryIcon}>🏆</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF7ED',
    borderRadius: 16,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  legendary: {
    backgroundColor: '#FEF9C3',
    borderColor: '#FDE047',
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  small: {
    padding: 8,
    gap: 6,
    borderRadius: 12,
  },
  flame: {
    fontSize: 32,
  },
  flameSmall: {
    fontSize: 20,
  },
  textContainer: {
    alignItems: 'flex-start',
  },
  count: {
    fontSize: 22,
    fontWeight: '900',
    color: '#EA580C',
    lineHeight: 26,
  },
  countSmall: {
    fontSize: 16,
    lineHeight: 20,
  },
  countLegendary: {
    color: '#D97706',
  },
  label: {
    fontSize: 12,
    color: '#9A3412',
    fontWeight: '500',
  },
  labelSmall: {
    fontSize: 10,
  },
  legendaryIcon: {
    fontSize: 22,
    marginLeft: 4,
  },
});
