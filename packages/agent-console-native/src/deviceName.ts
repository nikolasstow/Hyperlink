/**
 * This phone as servers see it: its name ("Nikolas's iPhone") and whether it
 * is a real device (a simulator cannot get push tokens). Read from
 * expo-device's native module, optionally: a build without it is "iOS",
 * taken as a real device.
 *
 * @internal
 */
import { requireOptionalNativeModule } from "expo";

export interface DeviceInfo {
  readonly name: string;
  readonly physical: boolean;
}

/** The two constants used of expo-device's native module. */
interface ExpoDevice {
  readonly deviceName?: string | null;
  readonly isDevice?: boolean;
}

const device = requireOptionalNativeModule<ExpoDevice>("ExpoDevice");

export const deviceInfo = (): DeviceInfo => ({
  name: device?.deviceName ?? "iOS",
  physical: device?.isDevice !== false,
});
