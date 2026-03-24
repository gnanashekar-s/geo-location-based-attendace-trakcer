// Web stub for react-native-maps — native maps not available on web
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const MapPlaceholder = ({ style, children }) => (
  <View style={[styles.placeholder, style]}>
    <Text style={styles.text}>🗺 Map view not available on web</Text>
    {children}
  </View>
);

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    minHeight: 200,
  },
  text: { color: '#64748B', fontSize: 14 },
});

export default MapPlaceholder;
export const Marker = ({ children }) => children ?? null;
export const Circle = () => null;
export const Polygon = () => null;
export const Polyline = () => null;
export const Callout = ({ children }) => children ?? null;
export const PROVIDER_GOOGLE = 'google';
export const PROVIDER_DEFAULT = null;
