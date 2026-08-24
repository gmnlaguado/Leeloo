import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Svg, { G, Path, Rect, Defs, Pattern } from 'react-native-svg';

const { width: W, height: H } = Dimensions.get('window');

// Single wave cell — replicates the Leeloo brand motif from the Figma pattern sheet
function WaveCell({ x, y, size = 32, color }: { x: number; y: number; size?: number; color: string }) {
  const s = size;
  return (
    <G transform={`translate(${x},${y})`}>
      <Path
        d={`M2,${s * 0.2} Q${s * 0.25},${s * 0.08} ${s * 0.5},${s * 0.2} Q${s * 0.75},${s * 0.32} ${s - 2},${s * 0.2}`}
        stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round"
      />
      <Path
        d={`M2,${s * 0.38} Q${s * 0.25},${s * 0.26} ${s * 0.5},${s * 0.38} Q${s * 0.75},${s * 0.5} ${s - 2},${s * 0.38}`}
        stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round"
      />
      <Path
        d={`M2,${s * 0.56} Q${s * 0.25},${s * 0.44} ${s * 0.5},${s * 0.56} Q${s * 0.75},${s * 0.68} ${s - 2},${s * 0.56}`}
        stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round"
      />
      <Path
        d={`M2,${s * 0.74} Q${s * 0.25},${s * 0.62} ${s * 0.5},${s * 0.74} Q${s * 0.75},${s * 0.86} ${s - 2},${s * 0.74}`}
        stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round"
      />
    </G>
  );
}

interface WaveBackgroundProps {
  opacity?: number;
  cellSize?: number;
  color?: string;
}

const MAX_WAVE_CELLS = 120; // Cap to avoid memory pressure with many SVG nodes

export function WaveBackground({ opacity = 0.13, cellSize = 44, color = '#2D266C' }: WaveBackgroundProps) {
  const cols = Math.ceil(W / cellSize) + 1;
  const rows = Math.ceil(H / cellSize) + 1;
  const cells: { x: number; y: number; key: string }[] = [];
  outer: for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (cells.length >= MAX_WAVE_CELLS) break outer;
      cells.push({ x: c * cellSize, y: r * cellSize, key: `${r}-${c}` });
    }
  }

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <Svg width={W} height={H} style={{ opacity }}>
        {cells.map(({ x, y, key }) => (
          <WaveCell key={key} x={x} y={y} size={cellSize - 4} color={color} />
        ))}
      </Svg>
    </View>
  );
}
