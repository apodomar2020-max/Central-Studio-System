export type PushEligibilityDevice = {
  provider: string;
  isActive: boolean;
};

export function isPushDeviceEligible(device: PushEligibilityDevice): boolean {
  return device.provider === "expo" && device.isActive === true;
}
