/**
 * The countdown before a script runs, drawn like iOS's download ring: a thin
 * track, an arc that fills it clockwise over the countdown, and a stop square
 * in the middle. Tapping it (the caller's Pressable) stops the run.
 *
 * The arc animates on the UI thread from the moment it mounts; it is mounted
 * fresh for each countdown.
 *
 * @internal
 */
import * as React from "react";
import { View } from "react-native";
import Animated, { Easing, useAnimatedProps, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Circle, Rect } from "react-native-svg";
import { colors } from "./colors";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export const RunCountdownRing = (props: { readonly size: number; readonly durationMs: number }): React.ReactElement => {
  const stroke = Math.max(2, Math.round(props.size / 11));
  const radius = (props.size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = useSharedValue(0);

  React.useEffect(() => {
    progress.value = withTiming(1, { duration: props.durationMs, easing: Easing.linear });
  }, [progress, props.durationMs]);

  const arc = useAnimatedProps(() => ({ strokeDashoffset: circumference * (1 - progress.value) }));
  const square = Math.round(props.size * 0.3);
  const center = props.size / 2;

  return (
    <View style={{ width: props.size, height: props.size }}>
      <Svg width={props.size} height={props.size}>
        <Circle cx={center} cy={center} r={radius} stroke={colors.fillBackground} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={center}
          cy={center}
          r={radius}
          stroke={colors.tint}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={arc}
          // Start at twelve o'clock and fill clockwise.
          transform={`rotate(-90 ${center} ${center})`}
        />
        <Rect x={center - square / 2} y={center - square / 2} width={square} height={square} rx={Math.max(1, square / 5)} fill={colors.tint} />
      </Svg>
    </View>
  );
};
