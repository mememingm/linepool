import type { PhoneNumber } from "./models";
import usStates from "./us-states.json";

function shuffled<T>(values: T[], random: () => number) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function interleave<T>(groups: T[][]) {
  const result: T[] = [];
  const longest = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < longest; index++) {
    for (const group of groups) {
      if (index < group.length) result.push(group[index]);
    }
  }
  return result;
}

export function inventoryForSelection(
  inventory: PhoneNumber[],
  country: string,
  region: string,
  random = Math.random,
) {
  const states = new Map<string, Map<string, PhoneNumber[]>>();
  for (const original of inventory) {
    if (original.countryCode !== country) continue;
    const area = original.number.replace(/\D/g, "").slice(1, 4);
    // Legacy demo inventory used "all" as a region, even for a specific area code.
    const state = original.countryCode === "US" && original.regionId === "all"
      ? usStates.find((item) => item.areaCodes.includes(area))
      : undefined;
    const item = state
      ? { ...original, regionId: state.id, regionName: state.name }
      : original;
    if (region !== "all" && item.regionId !== region) continue;
    const stateKey = item.regionId || item.regionName;
    if (!states.has(stateKey)) states.set(stateKey, new Map());
    const areas = states.get(stateKey)!;
    if (!areas.has(area)) areas.set(area, []);
    areas.get(area)!.push(item);
  }
  const groups = shuffled([...states.values()], random).map((areas) =>
    interleave(shuffled([...areas.values()], random).map((items) => shuffled(items, random))),
  );
  return interleave(groups);
}
