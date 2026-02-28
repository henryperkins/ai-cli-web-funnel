// ---------------------------------------------------------------------------
// Dependency graph types for install planning
// ---------------------------------------------------------------------------

export interface DependencyEdge {
  /** Package that declares the dependency */
  from_package_id: string;
  /** Package that is depended upon */
  to_package_id: string;
  /** Constraint on the dependency (e.g. version range or 'any') */
  constraint: string;
  /** Whether the dependency is required or optional */
  required: boolean;
}

export interface DependencyGraphInput {
  /** Root package(s) requested for install */
  root_package_ids: string[];
  /** All known dependency edges available for resolution */
  edges: DependencyEdge[];
  /** Set of package IDs that exist in the registry (resolvable) */
  known_package_ids: Set<string>;
}

export type DependencyConflictKind =
  | 'cycle_detected'
  | 'missing_dependency'
  | 'duplicate_edge';

export interface DependencyConflict {
  kind: DependencyConflictKind;
  package_ids: string[];
  message: string;
}

export interface DependencyResolutionResult {
  /** true if resolution succeeded with no conflicts */
  ok: boolean;
  /** Deterministic topologically sorted list of package IDs (dependencies first) */
  resolved_order: string[];
  /** All package IDs that are reachable from the roots (including roots) */
  resolved_set: Set<string>;
  /** Any conflicts encountered during resolution */
  conflicts: DependencyConflict[];
}

// ---------------------------------------------------------------------------
// Resolver (pure, no I/O)
// ---------------------------------------------------------------------------

/**
 * Builds an adjacency list from edges, filtered to known packages only.
 * Returns adjacency map (from → to[]) and reverse map (to → from[]).
 */
function buildAdjacency(
  edges: DependencyEdge[],
  knownIds: Set<string>
): {
  adjacency: Map<string, string[]>;
  inDegree: Map<string, number>;
  conflicts: DependencyConflict[];
} {
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const conflicts: DependencyConflict[] = [];
  const seenEdges = new Set<string>();

  for (const edge of edges) {
    const edgeKey = `${edge.from_package_id}→${edge.to_package_id}`;

    if (seenEdges.has(edgeKey)) {
      conflicts.push({
        kind: 'duplicate_edge',
        package_ids: [edge.from_package_id, edge.to_package_id],
        message: `Duplicate dependency edge: ${edge.from_package_id} → ${edge.to_package_id}`
      });
      continue;
    }
    seenEdges.add(edgeKey);

    if (!knownIds.has(edge.to_package_id) && edge.required) {
      conflicts.push({
        kind: 'missing_dependency',
        package_ids: [edge.from_package_id, edge.to_package_id],
        message: `Required dependency ${edge.to_package_id} not found in registry (required by ${edge.from_package_id})`
      });
      continue;
    }

    if (!knownIds.has(edge.to_package_id)) {
      // Optional and missing — skip silently
      continue;
    }

    if (!adjacency.has(edge.from_package_id)) {
      adjacency.set(edge.from_package_id, []);
    }
    adjacency.get(edge.from_package_id)!.push(edge.to_package_id);

    if (!inDegree.has(edge.to_package_id)) {
      inDegree.set(edge.to_package_id, 0);
    }
    inDegree.set(edge.to_package_id, inDegree.get(edge.to_package_id)! + 1);

    // Ensure from node exists in inDegree map
    if (!inDegree.has(edge.from_package_id)) {
      inDegree.set(edge.from_package_id, 0);
    }
  }

  return { adjacency, inDegree, conflicts };
}

/**
 * Collects all reachable package IDs from roots via BFS.
 */
function collectReachable(
  roots: string[],
  adjacency: Map<string, string[]>
): Set<string> {
  const visited = new Set<string>();
  const queue = [...roots];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const neighbors = adjacency.get(current);
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }
  }

  return visited;
}

/**
 * Kahn's algorithm for topological sort with deterministic tie-breaking.
 * Uses reversed edges so dependencies come before dependents.
 * Returns sorted order or detects cycles.
 */
function topologicalSort(
  nodes: Set<string>,
  adjacency: Map<string, string[]>,
  _inDegree: Map<string, number>
): { sorted: string[]; hasCycle: boolean; cycleNodes: string[] } {
  // Build reverse adjacency: if A→B (A depends on B), reverse to B→A
  // so B is processed before A in topological order.
  const reverseAdj = new Map<string, string[]>();
  const localInDegree = new Map<string, number>();

  for (const node of nodes) {
    localInDegree.set(node, 0);
  }

  for (const node of nodes) {
    const neighbors = adjacency.get(node);
    if (!neighbors) continue;
    for (const neighbor of neighbors) {
      if (!nodes.has(neighbor)) continue;
      // Reverse: neighbor → node (neighbor must be installed before node)
      if (!reverseAdj.has(neighbor)) {
        reverseAdj.set(neighbor, []);
      }
      reverseAdj.get(neighbor)!.push(node);
      localInDegree.set(node, (localInDegree.get(node) ?? 0) + 1);
    }
  }

  // Collect zero-in-degree nodes, sorted for determinism
  const queue: string[] = [];
  for (const node of nodes) {
    if ((localInDegree.get(node) ?? 0) === 0) {
      queue.push(node);
    }
  }
  queue.sort();

  const sorted: string[] = [];

  while (queue.length > 0) {
    // Sort for deterministic tie-breaking (lexicographic)
    queue.sort();
    const current = queue.shift()!;
    sorted.push(current);

    const neighbors = reverseAdj.get(current);
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!nodes.has(neighbor)) continue;
        const deg = (localInDegree.get(neighbor) ?? 1) - 1;
        localInDegree.set(neighbor, deg);
        if (deg === 0) {
          queue.push(neighbor);
        }
      }
    }
  }

  if (sorted.length < nodes.size) {
    // Cycle: nodes not in sorted are part of cycle(s)
    const cycleNodes = [...nodes].filter((n) => !sorted.includes(n)).sort();
    return { sorted, hasCycle: true, cycleNodes };
  }

  return { sorted, hasCycle: false, cycleNodes: [] };
}

/**
 * Resolve dependencies for the given root packages.
 *
 * Pure function — no I/O. Produces a deterministic topological ordering
 * of all transitive dependencies (dependencies first), detects cycles
 * and missing required dependencies.
 */
export function resolveDependencyGraph(
  input: DependencyGraphInput
): DependencyResolutionResult {
  const { root_package_ids, edges, known_package_ids } = input;

  // Validate roots exist
  const conflicts: DependencyConflict[] = [];
  for (const rootId of root_package_ids) {
    if (!known_package_ids.has(rootId)) {
      conflicts.push({
        kind: 'missing_dependency',
        package_ids: [rootId],
        message: `Root package ${rootId} not found in registry`
      });
    }
  }

  if (conflicts.length > 0) {
    return {
      ok: false,
      resolved_order: [],
      resolved_set: new Set(),
      conflicts
    };
  }

  // Build adjacency and detect edge-level conflicts
  const { adjacency, inDegree, conflicts: edgeConflicts } = buildAdjacency(edges, known_package_ids);
  conflicts.push(...edgeConflicts);

  // Only fail-fast on missing_dependency conflicts (required deps not found)
  const hasMissingRequired = conflicts.some((c) => c.kind === 'missing_dependency');
  if (hasMissingRequired) {
    return {
      ok: false,
      resolved_order: [],
      resolved_set: new Set(),
      conflicts
    };
  }

  // Collect reachable set from roots
  const reachable = collectReachable(root_package_ids, adjacency);

  // Add roots to reachable (they may have no outgoing edges)
  for (const rootId of root_package_ids) {
    reachable.add(rootId);
  }

  // Topological sort
  const { sorted, hasCycle, cycleNodes } = topologicalSort(reachable, adjacency, inDegree);

  if (hasCycle) {
    conflicts.push({
      kind: 'cycle_detected',
      package_ids: cycleNodes,
      message: `Dependency cycle detected among: ${cycleNodes.join(', ')}`
    });

    return {
      ok: false,
      resolved_order: [],
      resolved_set: reachable,
      conflicts
    };
  }

  return {
    ok: true,
    resolved_order: sorted,
    resolved_set: reachable,
    conflicts // may contain duplicate_edge warnings
  };
}
