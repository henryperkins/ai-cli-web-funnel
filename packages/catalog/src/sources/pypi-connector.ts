import type { CatalogSourceAliasCandidate, CatalogSourceCandidate } from '../index.js';
import { normalizeGithubRepoLocator, type ToolKind } from '@forge/shared-contracts';

export interface PyPiConnectorOptions {
  toolKind?: ToolKind;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface PyPiReleaseFile {
  upload_time_iso_8601?: string;
  upload_time?: string;
}

export interface PyPiProjectInfo {
  name?: string;
  summary?: string | null;
  home_page?: string | null;
  project_urls?: Record<string, string> | null;
  keywords?: string | null;
  version?: string | null;
  requires_python?: string | null;
  downloads?: {
    last_month?: number;
  } | null;
}

export interface PyPiProjectMetadata {
  info: PyPiProjectInfo;
  releases?: Record<string, PyPiReleaseFile[]>;
}

export interface PyPiConnectorNormalized {
  candidates: CatalogSourceCandidate[];
  skipped: Array<{ project: string; reason: string }>;
}

const DEFAULT_PYPI_BASE_URL = 'https://pypi.org/pypi';

function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.toLowerCase();
}

function normalizeIso(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function parseKeywords(value: unknown): string[] | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = [...new Set(value
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0))].sort((left, right) => left.localeCompare(right));

  return normalized.length > 0 ? normalized : undefined;
}

function findGithubUrl(project: PyPiProjectMetadata): string | null {
  const candidates: string[] = [];

  if (project.info.project_urls) {
    for (const value of Object.values(project.info.project_urls)) {
      if (typeof value === 'string' && value.trim().length > 0) {
        candidates.push(value);
      }
    }
  }

  if (project.info.home_page && project.info.home_page.trim().length > 0) {
    candidates.push(project.info.home_page);
  }

  for (const candidate of candidates) {
    try {
      const normalized = normalizeGithubRepoLocator(candidate);
      return `https://${normalized}`;
    } catch {
      continue;
    }
  }

  return null;
}

function deriveSourceUpdatedAt(project: PyPiProjectMetadata): string | null {
  const releases = project.releases ?? {};
  const timestamps: string[] = [];

  for (const files of Object.values(releases)) {
    for (const file of files) {
      const normalized = normalizeIso(file.upload_time_iso_8601 ?? file.upload_time ?? null);
      if (normalized) {
        timestamps.push(normalized);
      }
    }
  }

  if (timestamps.length === 0) {
    return null;
  }

  return timestamps.sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

function buildAliases(project: PyPiProjectMetadata): CatalogSourceAliasCandidate[] {
  const aliases: CatalogSourceAliasCandidate[] = [];

  if (project.info.home_page && project.info.home_page.trim().length > 0) {
    aliases.push({
      alias_type: 'url_alias',
      alias_value: project.info.home_page,
      source_name: 'pypi',
      active: true
    });
  }

  if (project.info.project_urls) {
    for (const value of Object.values(project.info.project_urls)) {
      if (typeof value !== 'string' || value.trim().length === 0) {
        continue;
      }

      aliases.push({
        alias_type: 'url_alias',
        alias_value: value,
        source_name: 'pypi',
        active: true
      });
    }
  }

  return aliases;
}

export function normalizePyPiProjects(
  projects: PyPiProjectMetadata[],
  options?: {
    toolKind?: ToolKind;
  }
): PyPiConnectorNormalized {
  const toolKind: ToolKind = options?.toolKind ?? 'mcp';
  const candidates: CatalogSourceCandidate[] = [];
  const skipped: Array<{ project: string; reason: string }> = [];

  for (const project of projects) {
    const projectName = normalizeName(project.info.name);
    if (!projectName) {
      skipped.push({ project: 'unknown', reason: 'missing_project_name' });
      continue;
    }

    const sourceUpdatedAt = deriveSourceUpdatedAt(project);
    const githubRepoLocator = findGithubUrl(project);
    const tags = parseKeywords(project.info.keywords);
    const downloads = project.info.downloads?.last_month;

    const fields: Record<string, unknown> = {
      name: projectName,
      ...(project.info.summary ? { description: project.info.summary } : {}),
      ...(sourceUpdatedAt ? { lastUpdated: sourceUpdatedAt } : {}),
      ...(project.info.version ? { latestVersion: project.info.version } : {}),
      ...(typeof downloads === 'number' && Number.isFinite(downloads) && downloads >= 0
        ? { downloads: Math.trunc(downloads) }
        : {}),
      ...(tags ? { tags } : {}),
      runtimeRequirements: {
        registry: 'pypi',
        package_manager: 'pip',
        ...(project.info.requires_python ? { requires_python: project.info.requires_python } : {})
      },
      installCommand: `pip install ${projectName}`
    };

    candidates.push({
      source_name: 'pypi',
      source_updated_at: sourceUpdatedAt,
      ...(githubRepoLocator ? { github_repo_locator: githubRepoLocator } : {}),
      registry_package_locator: `https://pypi.org/project/${encodeURIComponent(projectName)}`,
      tool_kind: toolKind,
      primary_registry_name: 'pypi',
      package_slug: projectName,
      ...(githubRepoLocator ? { canonical_repo: githubRepoLocator.replace(/^https:\/\//, '') } : {}),
      aliases: buildAliases(project),
      fields
    });
  }

  return { candidates, skipped };
}

export async function fetchPyPiProjectMetadata(
  projectName: string,
  options?: PyPiConnectorOptions
): Promise<PyPiProjectMetadata> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const baseUrl = options?.baseUrl ?? DEFAULT_PYPI_BASE_URL;

  const response = await fetchImpl(
    `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(projectName)}/json`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'forge-catalog-connector/1.0'
      }
    }
  );

  if (!response.ok) {
    throw new Error(`pypi_connector_fetch_error:${projectName}:HTTP_${response.status}`);
  }

  return (await response.json()) as PyPiProjectMetadata;
}

export async function runPyPiConnector(
  projectNames: string[],
  options?: PyPiConnectorOptions
): Promise<{
  normalized: PyPiConnectorNormalized;
  fetch_metadata: {
    total_fetched: number;
  };
}> {
  const projects: PyPiProjectMetadata[] = [];

  for (const projectName of projectNames) {
    const metadata = await fetchPyPiProjectMetadata(projectName, options);
    projects.push(metadata);
  }

  const normalized = normalizePyPiProjects(projects, {
    ...(options?.toolKind !== undefined ? { toolKind: options.toolKind } : {})
  });

  return {
    normalized,
    fetch_metadata: {
      total_fetched: projects.length
    }
  };
}
