import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Svg, { G, Path, Rect, Defs, Pattern } from 'react-native-svg';

const { width: W, height: H } = Dimensions.get('window');

// Single wave cell — replicates the Leeloo brand motif from the Figma pattern sheet
function WaveCell({ x, y, size = 32 }: { x: number; y: number; size?: number }) {
  const s = size;
  return (
    <G transform={`translate(${x},${y})`}>
      {/* 4 wavy lines stacked, mimicking the brand pattern */}
      <Path
        d={`M2,${s * 0.2} Q${s * 0.25},${s * 0.08} ${s * 0.5},${s * 0.2} Q${s * 0.75},${s * 0.32} ${s - 2},${s * 0.2}`}
        stroke="#2D266C" strokeWidth="1.5" fill="none" strokeLinecap="round"
      />
      <Path
        d={`M2,${s * 0.38} Q${s * 0.25},${s * 0.26} ${s * 0.5},${s * 0.38} Q${s * 0.75},${s * 0.5} ${s - 2},${s * 0.38}`}
        stroke="#2D266C" strokeWidth="1.5" fill="none" strokeLinecap="round"
      />
      <Path
        d={`M2,${s * 0.56} Q${s * 0.25},${s * 0.44} ${s * 0.5},${s * 0.56} Q${s * 0.75},${s * 0.68} ${s - 2},${s * 0.56}`}
        stroke="#2D266C" strokeWidth="1.5" fill="none" strokeLinecap="round"
      />
      <Path
        d={`M2,${s * 0.74} Q${s * 0.25},${s * 0.62} ${s * 0.5},${s * 0.74} Q${s * 0.75},${s * 0.86} ${s - 2},${s * 0.74}`}
        stroke="#2D266C" strokeWidth="1.5" fill="none" strokeLinecap="round"
      />
    </G>
  );
}

interface WaveBackgroundProps {
  opacity?: number;
  cellSize?: number;
}

export function WaveBackground({ opacity = 0.08, cellSize = 36 }: WaveBackgroundProps) {
  const cols = Math.ceil(W / cellSize) + 1;
  const rows = Math.ceil(H / cellSize) + 1;
  const cells: { x: number; y: number; key: string }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ x: c * cellSize, y: r * cellSize, key: `${r}-${c}` });
    }
  }

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <Svg width={W} height={H} style={{ opacity }}>
        {cells.map(({ x, y, key }) => (
          <WaveCell key={key} x={x} y={y} size={cellSize - 4} />
        ))}
      </Svg>
    </View>
  );
}
