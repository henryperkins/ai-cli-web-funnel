import type { CatalogSourceAliasCandidate, CatalogSourceCandidate } from '../index.js';
import { normalizeGithubRepoLocator, type ToolKind } from '@forge/shared-contracts';

export type DocsSourceFailureClass =
  | 'docs_source_inaccessible'
  | 'docs_source_invalid'
  | 'docs_source_timeout';

export class DocsSourceConnectorError extends Error {
  readonly failure_class: DocsSourceFailureClass;

  constructor(message: string, failureClass: DocsSourceFailureClass) {
    super(message);
    this.name = 'DocsSourceConnectorError';
    this.failure_class = failureClass;
  }
}

export class DocsSourceInaccessibleError extends DocsSourceConnectorError {
  constructor(message: string) {
    super(message, 'docs_source_inaccessible');
    this.name = 'DocsSourceInaccessibleError';
  }
}

export class DocsSourceInvalidError extends DocsSourceConnectorError {
  constructor(message: string) {
    super(message, 'docs_source_invalid');
    this.name = 'DocsSourceInvalidError';
  }
}

export class DocsSourceTimeoutError extends DocsSourceConnectorError {
  constructor(message: string) {
    super(message, 'docs_source_timeout');
    this.name = 'DocsSourceTimeoutError';
  }
}

export interface DocsSourceInput {
  url?: string | null;
  title?: string | null;
  summary?: string | null;
  content?: string | null;
  updated_at?: string | null;
  tags?: string[] | string | null;
  package_slug?: string | null;
  source_name?: string | null;
  tool_kind?: ToolKind;
  canonical_repo?: string | null;
  github_repo_locator?: string | null;
  install_command?: string | null;
  aliases?: string[];
}

export interface DocsConnectorNormalized {
  candidates: CatalogSourceCandidate[];
  skipped: Array<{
    url: string;
    reason: string;
  }>;
}

export interface DocsConnectorOptions {
  toolKind?: ToolKind;
  defaultSourceName?: string;
}

export interface DocsConnectorFetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalizeIso(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function slugFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
    if (path.length === 0) {
      return parsed.hostname.toLowerCase();
    }

    return `${parsed.hostname}/${path}`
      .toLowerCase()
      .replace(/\.md$/i, '')
      .replace(/[^a-z0-9/_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/\/$/, '');
  } catch {
    return url
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\.md$/i, '')
      .replace(/[^a-z0-9/_-]+/g, '-')
      .replace(/-+/g, '-');
  }
}

function normalizeTags(value: DocsSourceInput['tags']): string[] | undefined {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value
          .split(/[\s,]+/)
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      : [];

  const normalized = [...new Set(source.map((entry) => entry.toLowerCase().trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeAliases(input: DocsSourceInput): CatalogSourceAliasCandidate[] {
  const aliases = new Set<string>();

  const url = normalizeNullableString(input.url);
  if (url) {
    aliases.add(url);
  }

  for (const alias of input.aliases ?? []) {
    const normalized = normalizeNullableString(alias);
    if (normalized) {
      aliases.add(normalized);
    }
  }

  return [...aliases]
    .sort((left, right) => left.localeCompare(right))
    .map((alias) => ({
      alias_type: 'url_alias' as const,
      alias_value: alias,
      source_name: 'docs',
      active: true
    }));
}

function normalizeDescription(input: DocsSourceInput): string | null {
  const summary = normalizeNullableString(input.summary);
  if (summary) {
    return summary;
  }

  const content = normalizeNullableString(input.content);
  if (!content) {
    return null;
  }

  return content
    .replace(/\s+/g, ' ')
    .slice(0, 280)
    .trim();
}

function resolveCanonicalRepo(input: DocsSourceInput): string | null {
  const canonicalRepo = normalizeNullableString(input.canonical_repo);
  if (canonicalRepo) {
    return canonicalRepo.replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase();
  }

  const githubRepoLocator = normalizeNullableString(input.github_repo_locator);
  if (githubRepoLocator) {
    try {
      return normalizeGithubRepoLocator(githubRepoLocator);
    } catch {
      // fall through
    }
  }

  const sourceUrl = normalizeNullableString(input.url);
  if (!sourceUrl) {
    return null;
  }

  try {
    const normalized = normalizeGithubRepoLocator(sourceUrl);
    return normalized;
  } catch {
    return sourceUrl.replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase();
  }
}

function buildName(input: DocsSourceInput): string {
  const title = normalizeNullableString(input.title);
  if (title) {
    return title;
  }

  const slug = normalizeNullableString(input.package_slug);
  if (slug) {
    return slug;
  }

  const url = normalizeNullableString(input.url);
  if (url) {
    return slugFromUrl(url);
  }

  return 'docs-source';
}

export function normalizeDocsSources(
  docs: DocsSourceInput[],
  options?: DocsConnectorOptions
): DocsConnectorNormalized {
  const toolKind: ToolKind = options?.toolKind ?? 'mcp';
  const defaultSourceName = options?.defaultSourceName ?? 'docs';
  const skipped: DocsConnectorNormalized['skipped'] = [];
  const candidates: CatalogSourceCandidate[] = [];

  const orderedDocs = [...docs].sort((left, right) => {
    const leftUrl = normalizeNullableString(left.url) ?? '';
    const rightUrl = normalizeNullableString(right.url) ?? '';
    const urlDelta = leftUrl.localeCompare(rightUrl);
    if (urlDelta !== 0) {
      return urlDelta;
    }

    const leftTitle = normalizeNullableString(left.title) ?? '';
    const rightTitle = normalizeNullableString(right.title) ?? '';
    return leftTitle.localeCompare(rightTitle);
  });

  for (const doc of orderedDocs) {
    const url = normalizeNullableString(doc.url);
    if (!url) {
      skipped.push({ url: '', reason: 'missing_url' });
      continue;
    }

    try {
      // Validate URL format for deterministic canonicalization.
      new URL(url);
    } catch {
      skipped.push({ url, reason: 'invalid_url' });
      continue;
    }

    const name = buildName(doc);
    const description = normalizeDescription(doc);

    if (!description) {
      skipped.push({ url, reason: 'missing_content' });
      continue;
    }

    const sourceUpdatedAt = normalizeIso(normalizeNullableString(doc.updated_at));
    const packageSlug =
      normalizeNullableString(doc.package_slug) ??
      normalizeNullableString(doc.title)?.toLowerCase().replace(/\s+/g, '-') ??
      slugFromUrl(url);
    const tags = normalizeTags(doc.tags);

    const fields: Record<string, unknown> = {
      name,
      description,
      ...(sourceUpdatedAt ? { lastUpdated: sourceUpdatedAt } : {}),
      ...(tags ? { tags } : {}),
      runtimeRequirements: {
        source: 'docs',
        source_name: normalizeNullableString(doc.source_name) ?? defaultSourceName
      },
      ...(normalizeNullableString(doc.install_command)
        ? { installCommand: normalizeNullableString(doc.install_command) }
        : {})
    };

    const githubRepoLocator = normalizeNullableString(doc.github_repo_locator);

    candidates.push({
      source_name: normalizeNullableString(doc.source_name) ?? defaultSourceName,
      source_updated_at: sourceUpdatedAt,
      ...(githubRepoLocator ? { github_repo_locator: githubRepoLocator } : {}),
      registry_package_locator: url,
      tool_kind: doc.tool_kind ?? toolKind,
      primary_registry_name: defaultSourceName,
      package_slug: packageSlug,
      canonical_repo: resolveCanonicalRepo(doc),
      aliases: normalizeAliases(doc),
      fields
    });
  }

  return {
    candidates,
    skipped
  };
}

function summarizeContentToText(content: string): string {
  return content
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchDocsSources(
  urls: string[],
  options?: DocsConnectorFetchOptions
): Promise<DocsSourceInput[]> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const timeoutMs = Math.max(1, Math.trunc(options?.timeoutMs ?? 8_000));
  const maxBytes = Math.max(1024, Math.trunc(options?.maxBytes ?? 1_048_576));
  const results: DocsSourceInput[] = [];

  for (const url of [...urls].sort((left, right) => left.localeCompare(right))) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: {
          Accept: 'text/html, text/markdown, text/plain;q=0.9, application/json;q=0.8',
          'User-Agent': 'forge-docs-connector/1.0'
        }
      });

      if (!response.ok) {
        throw new DocsSourceInaccessibleError(`docs_source_inaccessible:${url}:HTTP_${response.status}`);
      }

      const contentType = response.headers.get('content-type') ?? '';
      const rawBody = await response.text();
      const truncatedBody = rawBody.slice(0, maxBytes);
      const normalizedBody =
        /text\/html/i.test(contentType) ? summarizeContentToText(truncatedBody) : truncatedBody;

      const title = /text\/html/i.test(contentType)
        ? (() => {
            const match = rawBody.match(/<title>([^<]+)<\/title>/i);
            return match?.[1]?.trim() ?? null;
          })()
        : null;

      results.push({
        url,
        title,
        content: normalizedBody,
        updated_at: new Date().toISOString(),
        source_name: 'docs'
      });
    } catch (error) {
      if (error instanceof DocsSourceConnectorError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new DocsSourceTimeoutError(`docs_source_timeout:${url}:timeout_${timeoutMs}ms`);
      }

      throw new DocsSourceInvalidError(
        `docs_source_invalid:${url}:${error instanceof Error ? error.message : 'unknown_error'}`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return results;
}

export async function runDocsConnector(
  input: {
    docs?: DocsSourceInput[];
    urls?: string[];
  },
  options?: DocsConnectorOptions & DocsConnectorFetchOptions
): Promise<{
  normalized: DocsConnectorNormalized;
  fetch_metadata: {
    total_fetched: number;
    mode: 'docs' | 'urls';
  };
}> {
  const docsInput = input.docs ?? [];
  const urlInput = input.urls ?? [];

  if (docsInput.length === 0 && urlInput.length === 0) {
    throw new DocsSourceInvalidError('docs_source_invalid: no docs or urls were provided');
  }

  const docs =
    docsInput.length > 0
      ? docsInput
      : await fetchDocsSources(urlInput, {
          ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
          ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
          ...(options?.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {})
        });

  const normalized = normalizeDocsSources(docs, options);

  return {
    normalized,
    fetch_metadata: {
      total_fetched: docs.length,
      mode: docsInput.length > 0 ? 'docs' : 'urls'
    }
  };
}
