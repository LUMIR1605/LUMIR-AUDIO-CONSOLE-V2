const centerDefinitions = [
  "subwoofer", "cosmic-portal", "galaxy", "black-hole",
  "ai-core", "plasma", "particle-core", "off"
];

export function createCenterRegistry() {
  const modules = new Map(centerDefinitions.map((id) => [id, { id, status: "reserved" }]));
  return Object.freeze({ count: () => modules.size, has: (id) => modules.has(id) });
}
