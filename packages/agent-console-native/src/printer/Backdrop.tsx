/**
 * The printer pages' backdrop: the print's slicer render, blurred and
 * darkened, with a wash of the theme's colour while the printer exposes.
 * The printer page and the pages it opens (Files, Health, Settings) share it.
 *
 * @internal
 */
import { LinearGradient } from "expo-linear-gradient";
import * as React from "react";
import { Animated, Image, StyleSheet, useColorScheme, useWindowDimensions, View } from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { useScreenBackground, useTheme } from "../theme";
import { authedSource } from "../auth/serverTokens";

/** The page's backdrop: the print's slicer render, blurred and darkened, with a wash of the theme's colour while the printer exposes. */
export const Backdrop = (props: { readonly uri: string | undefined; readonly glow: number }): React.ReactElement => {
  const background = useScreenBackground("grouped");
  const { colors: themeColors } = useTheme();
  const dark = useColorScheme() === "dark";
  const { width, height } = useWindowDimensions();
  const glow = React.useRef(new Animated.Value(props.glow)).current;
  React.useEffect(() => {
    Animated.timing(glow, { toValue: props.glow, duration: 900, useNativeDriver: true }).start();
  }, [glow, props.glow]);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: background }]} pointerEvents="none">
      {props.uri !== undefined ? <Image source={authedSource(props.uri)} style={[StyleSheet.absoluteFill, { opacity: dark ? 0.55 : 0.4 }]} resizeMode="cover" blurRadius={60} /> : null}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: glow }]}>
        <Svg width={width} height={height}>
          <Defs>
            <RadialGradient id="uv" cx="30%" cy="22%" r="70%">
              <Stop offset="0" stopColor={themeColors.primary} stopOpacity={0.55} />
              <Stop offset="1" stopColor={themeColors.primary} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={width} height={height} fill="url(#uv)" />
        </Svg>
      </Animated.View>
      <LinearGradient
        colors={dark ? ["rgba(6,7,11,0.35)", "rgba(6,7,11,0.82)"] : ["rgba(240,242,248,0.25)", "rgba(240,242,248,0.8)"]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
};
