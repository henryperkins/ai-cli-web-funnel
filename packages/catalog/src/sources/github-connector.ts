import type { CatalogSourceCandidate, CatalogSourceAliasCandidate } from '../index.js';
import type { ToolKind } from '@forge/shared-contracts';

// ---------------------------------------------------------------------------
// GitHub connector types  ---------------------------------------------------
// ---------------------------------------------------------------------------

export interface GitHubConnectorOptions {
  token?: string;
  baseUrl?: string;
  perPage?: number;
  maxPages?: number;
  toolKind?: ToolKind;
}

export interface GitHubRepoMetadata {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  homepage: string | null;
  stargazers_count: number;
  topics: string[];
  updated_at: string;
  pushed_at: string;
  default_branch: string;
  language: string | null;
  license: { spdx_id: string | null } | null;
  fork: boolean;
  archived: boolean;
}

export interface GitHubReleaseMetadata {
  tag_name: string;
  name: string | null;
  published_at: string | null;
  prerelease: boolean;
  draft: boolean;
}

export interface GitHubConnectorFetchResult {
  repos: GitHubRepoMetadata[];
  rate_limit_remaining: number | null;
  truncated: boolean;
}

export interface GitHubConnectorNormalized {
  candidates: CatalogSourceCandidate[];
  skipped: Array<{ full_name: string; reason: string }>;
}

// ---------------------------------------------------------------------------
// Normalization (pure, no I/O)  ---------------------------------------------
// ---------------------------------------------------------------------------

function normalizeRepoUrl(htmlUrl: string): string {
  try {
    const parsed = new URL(htmlUrl);
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase().replace(/\/+$/, '');
  } catch {
    return htmlUrl.toLowerCase().replace(/\/+$/, '');
  }
}

function extractSlug(fullName: string): string {
  return fullName.toLowerCase().trim();
}

function buildAliases(repo: GitHubRepoMetadata): CatalogSourceAliasCandidate[] {
  const aliases: CatalogSourceAliasCandidate[] = [];

  if (repo.homepage) {
    aliases.push({
      alias_type: 'url_alias',
      alias_value: repo.homepage,
      source_name: 'github',
      active: true
    });
  }

  return aliases;
}

export function normalizeGitHubRepos(
  repos: GitHubRepoMetadata[],
  options?: {
    toolKind?: ToolKind;
    latestReleases?: Map<string, GitHubReleaseMetadata>;
  }
): GitHubConnectorNormalized {
  const toolKind: ToolKind = options?.toolKind ?? 'mcp';
  const candidates: CatalogSourceCandidate[] = [];
  const skipped: Array<{ full_name: string; reason: string }> = [];

  for (const repo of repos) {
    if (repo.archived) {
      skipped.push({ full_name: repo.full_name, reason: 'archived' });
      continue;
    }

    if (repo.fork) {
      skipped.push({ full_name: repo.full_name, reason: 'fork' });
      continue;
    }

    const latestRelease = options?.latestReleases?.get(repo.full_name);

    const fields: Record<string, unknown> = {
      githubRepoId: repo.id,
      name: repo.full_name.split('/').pop() ?? repo.full_name,
      description: repo.description,
      stars: repo.stargazers_count,
      lastUpdated: repo.pushed_at ?? repo.updated_at,
      tags: repo.topics.length > 0 ? [...new Set(repo.topics)].sort() : undefined
    };

    if (repo.language) {
      fields.runtimeRequirements = { language: repo.language };
    }

    if (repo.license?.spdx_id && repo.license.spdx_id !== 'NOASSERTION') {
      fields.license = repo.license.spdx_id;
    }

    if (latestRelease && !latestRelease.prerelease && !latestRelease.draft) {
      fields.latestVersion = latestRelease.tag_name;
    }

    candidates.push({
      source_name: 'github',
      source_updated_at: repo.pushed_at ?? repo.updated_at,
      github_repo_id: repo.id,
      github_repo_locator: repo.html_url,
      tool_kind: toolKind,
      package_slug: extractSlug(repo.full_name),
      canonical_repo: normalizeRepoUrl(repo.html_url),
      aliases: buildAliases(repo),
      fields
    });
  }

  return { candidates, skipped };
}

// ---------------------------------------------------------------------------
// Fetch layer (I/O)  --------------------------------------------------------
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'https://api.github.com';
const DEFAULT_PER_PAGE = 30;
const DEFAULT_MAX_PAGES = 5;
const RATE_LIMIT_FLOOR = 5;

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'forge-catalog-connector/1.0'
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

function parseRateLimitRemaining(headers: Headers): number | null {
  const value = headers.get('x-ratelimit-remaining');
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLinkNext(headers: Headers): string | null {
  const link = headers.get('link');
  if (!link) return null;
  const match = link.match(/<([^>]+)>;\s*rel="next"/);
  return match?.[1] ?? null;
}

export interface GitHubSearchQuery {
  topic?: string;
  query?: string;
  sort?: 'stars' | 'updated' | 'best-match';
  language?: string;
}

export async function fetchGitHubRepos(
  search: GitHubSearchQuery,
  options?: GitHubConnectorOptions
): Promise<GitHubConnectorFetchResult> {
  const baseUrl = options?.baseUrl ?? DEFAULT_BASE_URL;
  const perPage = options?.perPage ?? DEFAULT_PER_PAGE;
  const maxPages = options?.maxPages ?? DEFAULT_MAX_PAGES;
  const headers = buildHeaders(options?.token);

  const queryParts: string[] = [];
  if (search.topic) queryParts.push(`topic:${search.topic}`);
  if (search.query) queryParts.push(search.query);
  if (search.language) queryParts.push(`language:${search.language}`);
  if (queryParts.length === 0) queryParts.push('mcp server');

  const q = encodeURIComponent(queryParts.join(' '));
  const sort = search.sort ?? 'stars';

  const allRepos: GitHubRepoMetadata[] = [];
  let rateLimitRemaining: number | null = null;
  let truncated = false;
  let nextUrl: string | null = `${baseUrl}/search/repositories?q=${q}&sort=${sort}&per_page=${perPage}&page=1`;

  for (let page = 0; page < maxPages && nextUrl; page++) {
    const response = await fetch(nextUrl, { headers });

    rateLimitRemaining = parseRateLimitRemaining(response.headers);
    if (rateLimitRemaining !== null && rateLimitRemaining <= RATE_LIMIT_FLOOR) {
      truncated = true;
      break;
    }

    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        truncated = true;
        break;
      }
      throw new Error(`github_connector_fetch_error: HTTP ${response.status}`);
    }

    const body = (await response.json()) as { items?: GitHubRepoMetadata[]; total_count?: number };
    const items = body.items ?? [];
    allRepos.push(...items);

    if (items.length < perPage) break;
    nextUrl = parseLinkNext(response.headers);
    if (!nextUrl) {
      const nextPage = page + 2;
      nextUrl = `${baseUrl}/search/repositories?q=${q}&sort=${sort}&per_page=${perPage}&page=${nextPage}`;
    }
  }

  return { repos: allRepos, rate_limit_remaining: rateLimitRemaining, truncated };
}

export async function fetchLatestRelease(
  repoFullName: string,
  options?: GitHubConnectorOptions
): Promise<GitHubReleaseMetadata | null> {
  const baseUrl = options?.baseUrl ?? DEFAULT_BASE_URL;
  const headers = buildHeaders(options?.token);

  const response = await fetch(
    `${baseUrl}/repos/${encodeURIComponent(repoFullName.split('/')[0] ?? '')}/` +
      `${encodeURIComponent(repoFullName.split('/')[1] ?? '')}/releases/latest`,
    { headers }
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`github_connector_release_fetch_error: HTTP ${response.status}`);
  }

  return (await response.json()) as GitHubReleaseMetadata;
}

// ---------------------------------------------------------------------------
// Connector entry point  ----------------------------------------------------
// ---------------------------------------------------------------------------

export interface GitHubConnectorResult {
  normalized: GitHubConnectorNormalized;
  fetch_metadata: {
    rate_limit_remaining: number | null;
    truncated: boolean;
    total_fetched: number;
  };
}

export async function runGitHubConnector(
  search: GitHubSearchQuery,
  options?: GitHubConnectorOptions
): Promise<GitHubConnectorResult> {
  const fetchResult = await fetchGitHubRepos(search, options);
  const normalized = normalizeGitHubRepos(fetchResult.repos, {
    ...(options?.toolKind !== undefined ? { toolKind: options.toolKind } : {})
  });

  return {
    normalized,
    fetch_metadata: {
      rate_limit_remaining: fetchResult.rate_limit_remaining,
      truncated: fetchResult.truncated,
      total_fetched: fetchResult.repos.length
    }
  };
}
