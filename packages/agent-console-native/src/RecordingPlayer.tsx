/**
 * Plays one Frigate recording (HLS, through the server's `/cameras/frigate`
 * proxy) in AVPlayer, with the system's own controls and Picture in Picture.
 *
 * Load this file only when the build has expo-video (`hasVideoPlayer`): its
 * import needs the native module.
 *
 * @internal
 */
import { useVideoPlayer, VideoView } from "expo-video";
import * as React from "react";
import { StyleSheet } from "react-native";

export interface RecordingPlayerProps {
  readonly uri: string;
  readonly headers: Readonly<Record<string, string>>;
}

export const RecordingPlayer = (props: RecordingPlayerProps): React.ReactElement => {
  const player = useVideoPlayer(
    {
      uri: props.uri,
      headers: { ...props.headers },
    },
    (created) => {
      // Recordings mix with the owner's music, like the live view.
      created.audioMixingMode = "mixWithOthers";
      created.play();
    },
  );
  return <VideoView style={StyleSheet.absoluteFill} player={player} nativeControls allowsPictureInPicture contentFit="contain" />;
};
