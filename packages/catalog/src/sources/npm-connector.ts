import type { CatalogSourceAliasCandidate, CatalogSourceCandidate } from '../index.js';
import { normalizeGithubRepoLocator, type ToolKind } from '@forge/shared-contracts';

export interface NpmConnectorOptions {
  toolKind?: ToolKind;
  registryBaseUrl?: string;
  downloadRange?: 'last-day' | 'last-week' | 'last-month';
  fetchImpl?: typeof fetch;
}

export interface NpmPackageRepositoryObject {
  type?: string;
  url?: string;
  directory?: string;
}

export interface NpmPackageMetadata {
  name?: string;
  description?: string | null;
  homepage?: string | null;
  repository?: string | NpmPackageRepositoryObject | null;
  keywords?: string[] | string | null;
  time?: Record<string, string>;
  'dist-tags'?: {
    latest?: string;
  };
  _downloads?: number | null;
}

export interface NpmDownloadMetadata {
  downloads: number;
  package: string;
  start?: string;
  end?: string;
}

export interface NpmConnectorNormalized {
  candidates: CatalogSourceCandidate[];
  skipped: Array<{
    package: string;
    reason: string;
  }>;
}

const DEFAULT_REGISTRY_BASE_URL = 'https://registry.npmjs.org';

function normalizePackageName(value: unknown): string | null {
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

function normalizeKeywords(value: unknown): string[] | undefined {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      : [];

  const normalized = [...new Set(raw.map((entry) => entry.toLowerCase().trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeDownloadCount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return undefined;
}

function normalizeRepositoryToGithub(locator: string): string | null {
  const trimmed = locator.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const normalizedLocator = trimmed
    .replace(/^git\+/i, '')
    .replace(/^git@github\.com:/i, 'https://github.com/')
    .replace(/^ssh:\/\/git@github\.com\//i, 'https://github.com/')
    .replace(/^github:/i, 'https://github.com/');

  try {
    const normalized = normalizeGithubRepoLocator(normalizedLocator);
    return `https://${normalized}`;
  } catch {
    return null;
  }
}

function extractRepositoryUrl(repository: NpmPackageMetadata['repository']): string | null {
  if (!repository) {
    return null;
  }

  if (typeof repository === 'string') {
    return repository;
  }

  return repository.url ?? null;
}

function deriveSourceUpdatedAt(pkg: NpmPackageMetadata): string | null {
  const modified = normalizeIso(pkg.time?.modified);
  if (modified) {
    return modified;
  }

  const latestTag = pkg['dist-tags']?.latest;
  if (latestTag && pkg.time?.[latestTag]) {
    return normalizeIso(pkg.time[latestTag]);
  }

  return null;
}

function buildAliases(pkg: NpmPackageMetadata, repositoryUrl: string | null): CatalogSourceAliasCandidate[] {
  const aliases: CatalogSourceAliasCandidate[] = [];

  if (pkg.homepage && pkg.homepage.trim().length > 0) {
    aliases.push({
      alias_type: 'url_alias',
      alias_value: pkg.homepage,
      source_name: 'npm',
      active: true
    });
  }

  if (repositoryUrl && repositoryUrl.trim().length > 0) {
    aliases.push({
      alias_type: 'url_alias',
      alias_value: repositoryUrl,
      source_name: 'npm',
      active: true
    });
  }

  return aliases;
}

export function normalizeNpmPackages(
  packages: NpmPackageMetadata[],
  options?: {
    toolKind?: ToolKind;
    downloadsByPackage?: Record<string, number>;
  }
): NpmConnectorNormalized {
  const toolKind: ToolKind = options?.toolKind ?? 'mcp';
  const candidates: CatalogSourceCandidate[] = [];
  const skipped: Array<{ package: string; reason: string }> = [];

  for (const pkg of packages) {
    const packageName = normalizePackageName(pkg.name);
    if (!packageName) {
      skipped.push({ package: String(pkg.name ?? 'unknown'), reason: 'missing_package_name' });
      continue;
    }

    const repositoryUrl = extractRepositoryUrl(pkg.repository);
    const githubRepoLocator = repositoryUrl ? normalizeRepositoryToGithub(repositoryUrl) : null;
    const sourceUpdatedAt = deriveSourceUpdatedAt(pkg);
    const downloads =
      normalizeDownloadCount(options?.downloadsByPackage?.[packageName]) ??
      normalizeDownloadCount(pkg._downloads);

    const keywords = normalizeKeywords(pkg.keywords);

    const fields: Record<string, unknown> = {
      name: packageName,
      ...(pkg.description ? { description: pkg.description } : {}),
      ...(sourceUpdatedAt ? { lastUpdated: sourceUpdatedAt } : {}),
      ...(downloads !== undefined ? { downloads } : {}),
      ...(keywords ? { tags: keywords } : {}),
      ...(pkg['dist-tags']?.latest ? { latestVersion: pkg['dist-tags']?.latest } : {}),
      runtimeRequirements: {
        registry: 'npm',
        package_manager: 'npm'
      },
      installCommand: `npm install ${packageName}`
    };

    candidates.push({
      source_name: 'npm',
      source_updated_at: sourceUpdatedAt,
      ...(githubRepoLocator ? { github_repo_locator: githubRepoLocator } : {}),
      registry_package_locator: `https://registry.npmjs.org/${encodeURIComponent(packageName)}`,
      tool_kind: toolKind,
      primary_registry_name: 'npm',
      package_slug: packageName,
      ...(githubRepoLocator ? { canonical_repo: githubRepoLocator.replace(/^https:\/\//, '') } : {}),
      aliases: buildAliases(pkg, repositoryUrl),
      fields
    });
  }

  return { candidates, skipped };
}

export async function fetchNpmPackageMetadata(
  packageName: string,
  options?: NpmConnectorOptions
): Promise<NpmPackageMetadata> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const baseUrl = options?.registryBaseUrl ?? DEFAULT_REGISTRY_BASE_URL;
  const response = await fetchImpl(
    `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(packageName)}`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'forge-catalog-connector/1.0'
      }
    }
  );

  if (!response.ok) {
    throw new Error(`npm_connector_fetch_error:${packageName}:HTTP_${response.status}`);
  }

  return (await response.json()) as NpmPackageMetadata;
}

export async function fetchNpmDownloadMetadata(
  packageName: string,
  options?: NpmConnectorOptions
): Promise<NpmDownloadMetadata | null> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const range = options?.downloadRange ?? 'last-week';
  const response = await fetchImpl(
    `https://api.npmjs.org/downloads/point/${range}/${encodeURIComponent(packageName)}`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'forge-catalog-connector/1.0'
      }
    }
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`npm_connector_download_fetch_error:${packageName}:HTTP_${response.status}`);
  }

  return (await response.json()) as NpmDownloadMetadata;
}

export async function runNpmConnector(
  packageNames: string[],
  options?: NpmConnectorOptions
): Promise<{
  normalized: NpmConnectorNormalized;
  fetch_metadata: {
    total_fetched: number;
    missing_downloads: number;
  };
}> {
  const metadataList: NpmPackageMetadata[] = [];
  const downloadsByPackage: Record<string, number> = {};
  let missingDownloads = 0;

  for (const packageName of packageNames) {
    const metadata = await fetchNpmPackageMetadata(packageName, options);
    metadataList.push(metadata);

    const downloads = await fetchNpmDownloadMetadata(packageName, options);
    if (downloads) {
      downloadsByPackage[packageName.toLowerCase()] = downloads.downloads;
    } else {
      missingDownloads += 1;
    }
  }

  const normalized = normalizeNpmPackages(metadataList, {
    ...(options?.toolKind !== undefined ? { toolKind: options.toolKind } : {}),
    downloadsByPackage
  });

  return {
    normalized,
    fetch_metadata: {
      total_fetched: metadataList.length,
      missing_downloads: missingDownloads
    }
  };
}
