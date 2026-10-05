import semver from 'semver';
import type { Requirement, ToolState } from '../../shared/types';

// Unknown syntax is never treated as a successful compatibility check.
export function normalizeRange(input: string): string | null {
  const value = input
    .trim()
    .replace(/^v(?=\d)/, '')
    .replace(/,/g, ' ')
    .replace(/==(?!=)/g, '=');
  if (!value || value === '*' || value === 'any') return '*';
  if (
    /^(stable|latest|lts\/.*|system|workspace:.*)$/i.test(value) ||
    /[!;@]|\$\{|\b(or|and)\b/.test(value)
  )
    return null;
  const compatible = value.match(/^~=(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (compatible) {
    const [, major, minor, patch] = compatible;
    return patch === undefined
      ? `>=${major}.${minor}.0 <${Number(major) + 1}.0.0`
      : `>=${major}.${minor}.${patch} <${major}.${Number(minor) + 1}.0`;
  }
  return semver.validRange(value, { loose: true });
}
export function assess(requirement: Requirement, tools: ToolState[]): Requirement {
  const tool = tools.find((t) => t.id === requirement.tool);
  if (!tool?.path)
    return { ...requirement, installed: null, status: 'missing', detail: tool?.error };
  const installed = tool.version;
  if (tool.error) return { ...requirement, installed, status: 'unknown', detail: tool.error };
  if (!installed)
    return {
      ...requirement,
      installed,
      status: 'unknown',
      detail: tool.error || 'Installed, but its version could not be read.',
    };
  const range = normalizeRange(requirement.range);
  const version = semver.coerce(installed);
  if (range === null || !version)
    return {
      ...requirement,
      installed,
      status: 'unknown',
      detail: 'This version constraint needs a manual check.',
    };
  return {
    ...requirement,
    installed,
    status: semver.satisfies(version, range) ? 'ready' : 'mismatch',
  };
}
export function conflicts(requirements: Requirement[]): string[] {
  const messages = new Set<string>();
  for (let i = 0; i < requirements.length; i++)
    for (let j = i + 1; j < requirements.length; j++) {
      const a = requirements[i],
        b = requirements[j];
      const ar = normalizeRange(a.range),
        br = normalizeRange(b.range);
      if (a.tool === b.tool && ar && br && !semver.intersects(ar, br))
        messages.add(
          `${a.name} has conflicting requirements: ${a.range} in ${a.source} and ${b.range} in ${b.source}. These projects may need separate runtime versions.`,
        );
    }
  return [...messages];
}
