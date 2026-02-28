import { describe, expect, it } from 'vitest';
import {
  resolveDependencyGraph,
  type DependencyEdge,
  type DependencyGraphInput
} from '../src/dependency-graph.js';

function edge(from: string, to: string, required = true): DependencyEdge {
  return { from_package_id: from, to_package_id: to, constraint: 'any', required };
}

function input(
  roots: string[],
  edges: DependencyEdge[],
  knownIds: string[]
): DependencyGraphInput {
  return {
    root_package_ids: roots,
    edges,
    known_package_ids: new Set(knownIds)
  };
}

describe('resolveDependencyGraph', () => {
  it('resolves a single root with no dependencies', () => {
    const result = resolveDependencyGraph(input(['A'], [], ['A']));

    expect(result.ok).toBe(true);
    expect(result.resolved_order).toEqual(['A']);
    expect(result.resolved_set.has('A')).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  it('resolves a linear dependency chain', () => {
    // A → B → C
    const result = resolveDependencyGraph(
      input(['A'], [edge('A', 'B'), edge('B', 'C')], ['A', 'B', 'C'])
    );

    expect(result.ok).toBe(true);
    expect(result.resolved_order).toEqual(['C', 'B', 'A']);
    expect(result.conflicts).toHaveLength(0);
  });

  it('resolves a diamond dependency graph', () => {
    // A → B, A → C, B → D, C → D
    const result = resolveDependencyGraph(
      input(
        ['A'],
        [edge('A', 'B'), edge('A', 'C'), edge('B', 'D'), edge('C', 'D')],
        ['A', 'B', 'C', 'D']
      )
    );

    expect(result.ok).toBe(true);
    expect(result.resolved_order[0]).toBe('D');
    // B and C are ordered deterministically (lexicographic)
    expect(result.resolved_order[result.resolved_order.length - 1]).toBe('A');
    expect(result.resolved_set.size).toBe(4);
  });

  it('produces deterministic order across repeated runs', () => {
    const inp = input(
      ['root'],
      [edge('root', 'x'), edge('root', 'y'), edge('root', 'z')],
      ['root', 'x', 'y', 'z']
    );

    const first = resolveDependencyGraph(inp);
    const second = resolveDependencyGraph(inp);

    expect(first.resolved_order).toEqual(second.resolved_order);
    expect(first.ok).toBe(second.ok);
  });

  it('uses lexicographic tie-breaking for determinism', () => {
    // root → alpha, root → beta, root → gamma (all independent)
    const result = resolveDependencyGraph(
      input(
        ['root'],
        [edge('root', 'alpha'), edge('root', 'beta'), edge('root', 'gamma')],
        ['root', 'alpha', 'beta', 'gamma']
      )
    );

    expect(result.ok).toBe(true);
    // Independent deps sorted lexicographically before root
    expect(result.resolved_order).toEqual(['alpha', 'beta', 'gamma', 'root']);
  });

  it('detects a simple cycle', () => {
    // A → B → C → A
    const result = resolveDependencyGraph(
      input(['A'], [edge('A', 'B'), edge('B', 'C'), edge('C', 'A')], ['A', 'B', 'C'])
    );

    expect(result.ok).toBe(false);
    expect(result.conflicts.some((c) => c.kind === 'cycle_detected')).toBe(true);
    const cycleConflict = result.conflicts.find((c) => c.kind === 'cycle_detected')!;
    expect(cycleConflict.package_ids.sort()).toEqual(['A', 'B', 'C']);
  });

  it('detects a self-referencing cycle', () => {
    // A → A
    const result = resolveDependencyGraph(
      input(['A'], [edge('A', 'A')], ['A'])
    );

    expect(result.ok).toBe(false);
    expect(result.conflicts.some((c) => c.kind === 'cycle_detected')).toBe(true);
  });

  it('reports missing required dependency', () => {
    // A → B, but B is not in known_package_ids
    const result = resolveDependencyGraph(
      input(['A'], [edge('A', 'B', true)], ['A'])
    );

    expect(result.ok).toBe(false);
    expect(result.conflicts.some((c) => c.kind === 'missing_dependency')).toBe(true);
    const conflict = result.conflicts.find((c) => c.kind === 'missing_dependency')!;
    expect(conflict.package_ids).toContain('B');
  });

  it('silently skips optional missing dependency', () => {
    // A → B (optional), B not in known
    const result = resolveDependencyGraph(
      input(['A'], [edge('A', 'B', false)], ['A'])
    );

    expect(result.ok).toBe(true);
    expect(result.resolved_order).toEqual(['A']);
    expect(result.conflicts).toHaveLength(0);
  });

  it('reports missing root package', () => {
    const result = resolveDependencyGraph(
      input(['not-existing'], [], ['A'])
    );

    expect(result.ok).toBe(false);
    expect(result.conflicts[0]!.kind).toBe('missing_dependency');
    expect(result.conflicts[0]!.package_ids).toContain('not-existing');
  });

  it('detects duplicate edges', () => {
    const result = resolveDependencyGraph(
      input(
        ['A'],
        [edge('A', 'B'), edge('A', 'B')],
        ['A', 'B']
      )
    );

    // Duplicate edges are warnings, not fatal
    expect(result.ok).toBe(true);
    expect(result.conflicts.some((c) => c.kind === 'duplicate_edge')).toBe(true);
    expect(result.resolved_order).toEqual(['B', 'A']);
  });

  it('resolves multiple roots with shared dependencies', () => {
    // X → C, Y → C, both X and Y are roots
    const result = resolveDependencyGraph(
      input(['X', 'Y'], [edge('X', 'C'), edge('Y', 'C')], ['X', 'Y', 'C'])
    );

    expect(result.ok).toBe(true);
    expect(result.resolved_order[0]).toBe('C');
    expect(result.resolved_set.size).toBe(3);
  });

  it('handles deep transitive chains', () => {
    // A → B → C → D → E
    const result = resolveDependencyGraph(
      input(
        ['A'],
        [edge('A', 'B'), edge('B', 'C'), edge('C', 'D'), edge('D', 'E')],
        ['A', 'B', 'C', 'D', 'E']
      )
    );

    expect(result.ok).toBe(true);
    expect(result.resolved_order).toEqual(['E', 'D', 'C', 'B', 'A']);
  });

  it('handles empty edge list for single root', () => {
    const result = resolveDependencyGraph(input(['A'], [], ['A']));

    expect(result.ok).toBe(true);
    expect(result.resolved_order).toEqual(['A']);
  });

  it('handles multiple roots with no edges', () => {
    const result = resolveDependencyGraph(input(['A', 'B', 'C'], [], ['A', 'B', 'C']));

    expect(result.ok).toBe(true);
    expect(result.resolved_order).toEqual(['A', 'B', 'C']);
  });

  it('partial cycle does not affect independent branches', () => {
    // A → B → C → B (cycle), A → D (no cycle)
    const result = resolveDependencyGraph(
      input(
        ['A'],
        [edge('A', 'B'), edge('B', 'C'), edge('C', 'B'), edge('A', 'D')],
        ['A', 'B', 'C', 'D']
      )
    );

    expect(result.ok).toBe(false);
    expect(result.conflicts.some((c) => c.kind === 'cycle_detected')).toBe(true);
  });
});
