import usStates from "../lib/us-states.json";

export interface RegionOption { countryCode: "US" | "CA"; id: string; name: string; areaCodes: string[] }

const canada: RegionOption[] = [
  { countryCode: "CA", id: "on", name: "安大略省", areaCodes: ["416", "647", "437", "905", "289", "365", "519", "226", "548", "613", "343", "705", "249", "807"] },
  { countryCode: "CA", id: "bc", name: "不列颠哥伦比亚省", areaCodes: ["604", "778", "236", "250", "672"] },
  { countryCode: "CA", id: "qc", name: "魁北克省", areaCodes: ["514", "438", "450", "579", "418", "581", "819", "873", "367"] },
  { countryCode: "CA", id: "ab", name: "阿尔伯塔省", areaCodes: ["403", "587", "825", "780", "368"] },
];
/** Every region an operator can file a number under. */
export const regionOptions: RegionOption[] = [
  ...usStates.map(state => ({ countryCode: "US" as const, id: state.id, name: state.name, areaCodes: state.areaCodes })),
  ...canada,
];
export const countryNames = { US: "美国", CA: "加拿大" } as const;

export function areaCode(number: string) {
  const digits = number.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1, 4) : digits.length === 10 ? digits.slice(0, 3) : "";
}
/** Region for a number from an explicit name/code, or from its area code when left blank. */
export function resolveRegion(input: string, number: string): RegionOption | undefined {
  const value = input.trim().toLowerCase();
  if (value) return regionOptions.find(region => region.id === value || region.name.toLowerCase() === value || region.name.replace(/[州省]$/, "") === value);
  const area = areaCode(number);
  return area ? regionOptions.find(region => region.areaCodes.includes(area)) : undefined;
}
