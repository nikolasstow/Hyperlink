/**
 * An invisible, full-screen tap catcher shown only while the keyboard is up.
 * The first tap anywhere outside the composer is *consumed* and only dismisses
 * the keyboard (collapsing the composer) — instead of falling through to a list
 * row or button and navigating away when the user just wanted to collapse.
 *
 * Purely behavioral: no background, no visual change. Place it directly below
 * the (absolutely-positioned) composer in the screen tree so the composer's own
 * controls stay on top and tappable, while everything behind it is covered.
 *
 * @internal
 */
import * as React from "react";
import { Keyboard, Pressable, StyleSheet } from "react-native";

export const KeyboardDismissOverlay = (props: { readonly active: boolean }): React.ReactElement | null =>
  props.active ? (
    <Pressable
      style={StyleSheet.absoluteFill}
      onPress={() => Keyboard.dismiss()}
      accessible={false}
      // A dismiss gesture, not a control — keep it out of the a11y tree.
      importantForAccessibility="no-hide-descendants"
    />
  ) : null;
