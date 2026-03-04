// ── Snapshot Utilities ──
// Pure functions for Map serialization (no fs dependency).

export const mapToJson = <K, V>(map: Map<K, V>): [K, V][] => [...map.entries()];

export const jsonToMap = <K, V>(entries: [K, V][]): Map<K, V> => new Map(entries);
