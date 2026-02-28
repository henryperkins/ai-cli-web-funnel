import { createHash } from 'node:crypto';
import { FORGE_PACKAGE_NAMESPACE, type IdentityState, type ToolKind } from './constants.js';

export interface PackageIdentityInput {
  githubRepoId?: number | string;
  githubRepoLocator?: string;
  subpath?: string | null;
  toolKind: ToolKind;
  primaryRegistryName?: string | null;
}

export interface ResolvePackageIdentityInput extends PackageIdentityInput {
  registryPackageLocator?: string | null;
}

export interface PackageIdentityResolutionOptions {
  registryToGithubMap?: Record<string, string>;
}

export interface PackageIdentityResult {
  packageId: string;
  identityState: IdentityState;
  canonicalLocator: string;
  locatorInputs: {
    githubRepoId: string | null;
    githubRepoLocator: string | null;
    registryPackageLocator: string | null;
    subpath: string;
    toolKind: ToolKind;
    primaryRegistryName: string;
  };
}

export type IdentityResolutionPath = 'canonical_repo_id' | 'github_locator' | 'registry_map' | 'manual_review';

export interface PackageIdentityResolved extends PackageIdentityResult {
  requiresManualReview: false;
  resolutionPath: Exclude<IdentityResolutionPath, 'manual_review'>;
}

export type PackageIdentityManualReviewReason = 'unmapped_registry_locator' | 'insufficient_identity';

export interface PackageIdentityManualReview {
  requiresManualReview: true;
  identityState: 'provisional';
  resolutionPath: 'manual_review';
  reason: PackageIdentityManualReviewReason;
  conflictFingerprint: string;
  canonicalLocatorCandidate: string;
  githubRepoLocator: string | null;
  registryPackageLocator: string | null;
}

export type PackageIdentityResolution = PackageIdentityResolved | PackageIdentityManualReview;

export interface IdentityConflictRecord {
  conflictFingerprint: string;
  canonicalLocatorCandidate: string;
  conflictingAliases: string[];
  detectedBy: string;
  status: 'open';
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeSubpath(subpath?: string | null): string {
  if (!subpath) {
    return 'root';
  }

  const trimmed = subpath.trim().replace(/^\/+|\/+$/g, '');
  return trimmed.length > 0 ? trimmed.toLowerCase() : 'root';
}

function normalizeRegistryName(primaryRegistryName?: string | null): string {
  if (!primaryRegistryName) {
    return 'none';
  }

  const normalized = primaryRegistryName.trim().toLowerCase();
  return normalized.length > 0 ? normalized : 'none';
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function normalizeRegistryPackageLocator(locator: string): string {
  const trimmed = locator.trim();
  if (!trimmed) {
    throw new Error('Registry package locator cannot be empty.');
  }

  if (/^[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(trimmed) || /^@[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase();
    return `${host}/${path}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

function buildManualReviewCandidate(
  input: ResolvePackageIdentityInput,
  reason: PackageIdentityManualReviewReason
): PackageIdentityManualReview {
  const normalizedRegistry = input.registryPackageLocator
    ? normalizeRegistryPackageLocator(input.registryPackageLocator)
    : null;
  const subpath = normalizeSubpath(input.subpath);
  const canonicalLocatorCandidate = `${normalizedRegistry ?? 'unresolved'}:${subpath}:${input.toolKind}:none`;
  const conflictFingerprint = sha256Hex(`${reason}:${canonicalLocatorCandidate}`).slice(0, 32);

  return {
    requiresManualReview: true,
    identityState: 'provisional',
    resolutionPath: 'manual_review',
    reason,
    conflictFingerprint,
    canonicalLocatorCandidate,
    githubRepoLocator: null,
    registryPackageLocator: normalizedRegistry
  };
}

export function buildIdentityConflictRecord(
  manualReview: PackageIdentityManualReview,
  detectedBy = 'identity-resolver',
  conflictingAliases: string[] = []
): IdentityConflictRecord {
  return {
    conflictFingerprint: manualReview.conflictFingerprint,
    canonicalLocatorCandidate: manualReview.canonicalLocatorCandidate,
    conflictingAliases,
    detectedBy,
    status: 'open'
  };
}

export function normalizeGithubRepoLocator(locator: string): string {
  const trimmed = locator.trim();

  const directMatch = trimmed.match(/^github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (directMatch) {
    const owner = directMatch[1];
    const repo = directMatch[2];
    if (!owner || !repo) {
      throw new Error(`Invalid GitHub repository locator: ${locator}`);
    }

    return `github.com/${owner.toLowerCase()}/${repo.toLowerCase()}`;
  }

  const parsed = new URL(trimmed);
  if (!/github\.com$/i.test(parsed.hostname)) {
    throw new Error(`Unsupported repository host: ${parsed.hostname}`);
  }

  const path = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`Invalid GitHub repository locator: ${locator}`);
  }

  const owner = parts[0];
  const repoPart = parts[1];
  if (!owner || !repoPart) {
    throw new Error(`Invalid GitHub repository locator: ${locator}`);
  }

  const repo = repoPart.replace(/\.git$/i, '').toLowerCase();
  return `github.com/${owner.toLowerCase()}/${repo}`;
}

function ensurePositiveInteger(value: number | string): string {
  const asNumber = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(asNumber) || asNumber <= 0) {
    throw new Error(`githubRepoId must be a positive integer. Received: ${value}`);
  }

  return String(asNumber);
}

function uuidToBytes(uuid: string): Uint8Array {
  if (!UUID_REGEX.test(uuid)) {
    throw new Error(`Invalid UUID format: ${uuid}`);
  }

  const compact = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);

  for (let index = 0; index < 16; index += 1) {
    const byteHex = compact.slice(index * 2, index * 2 + 2);
    bytes[index] = Number.parseInt(byteHex, 16);
  }

  return bytes;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join('-');
}

export function uuidv5(name: string, namespace: string): string {
  const namespaceBytes = uuidToBytes(namespace);
  const nameBytes = Buffer.from(name, 'utf8');

  const hash = createHash('sha1')
    .update(namespaceBytes)
    .update(nameBytes)
    .digest();

  const bytes = new Uint8Array(hash.subarray(0, 16));
  const byte6 = bytes.at(6);
  const byte8 = bytes.at(8);
  if (byte6 === undefined || byte8 === undefined) {
    throw new Error('Failed to construct UUIDv5 bytes.');
  }

  bytes[6] = (byte6 & 0x0f) | 0x50;
  bytes[8] = (byte8 & 0x3f) | 0x80;

  return bytesToUuid(bytes);
}

export function buildCanonicalLocator(input: PackageIdentityInput): string {
  if (input.githubRepoId === undefined || input.githubRepoId === null) {
    throw new Error('Canonical locator requires githubRepoId.');
  }

  const githubRepoId = ensurePositiveInteger(input.githubRepoId);
  const subpath = normalizeSubpath(input.subpath);
  const primaryRegistryName = normalizeRegistryName(input.primaryRegistryName);

  return `${githubRepoId}:${subpath}:${input.toolKind}:${primaryRegistryName}`;
}

export function buildProvisionalLocator(input: PackageIdentityInput): string {
  if (!input.githubRepoLocator) {
    throw new Error('Provisional locator requires githubRepoLocator when githubRepoId is not available.');
  }

  const normalizedLocator = normalizeGithubRepoLocator(input.githubRepoLocator);
  const subpath = normalizeSubpath(input.subpath);

  return `${normalizedLocator}:${subpath}:${input.toolKind}:none`;
}

export function createPackageIdentity(input: PackageIdentityInput): PackageIdentityResult {
  const locatorInputs = {
    githubRepoId:
      input.githubRepoId === undefined || input.githubRepoId === null
        ? null
        : ensurePositiveInteger(input.githubRepoId),
    githubRepoLocator: input.githubRepoLocator ? normalizeGithubRepoLocator(input.githubRepoLocator) : null,
    registryPackageLocator: null,
    subpath: normalizeSubpath(input.subpath),
    toolKind: input.toolKind,
    primaryRegistryName: normalizeRegistryName(input.primaryRegistryName)
  };

  const identityState: IdentityState = locatorInputs.githubRepoId ? 'canonical' : 'provisional';
  const canonicalLocator =
    identityState === 'canonical' ? buildCanonicalLocator(input) : buildProvisionalLocator(input);

  return {
    packageId: uuidv5(canonicalLocator, FORGE_PACKAGE_NAMESPACE),
    identityState,
    canonicalLocator,
    locatorInputs
  };
}

export function resolvePackageIdentity(
  input: ResolvePackageIdentityInput,
  options: PackageIdentityResolutionOptions = {}
): PackageIdentityResolution {
  if (input.githubRepoId !== undefined && input.githubRepoId !== null) {
    const resolved = createPackageIdentity(input);
    return {
      ...resolved,
      requiresManualReview: false,
      resolutionPath: 'canonical_repo_id'
    };
  }

  if (input.githubRepoLocator) {
    const resolved = createPackageIdentity(input);
    return {
      ...resolved,
      requiresManualReview: false,
      resolutionPath: 'github_locator'
    };
  }

  if (input.registryPackageLocator) {
    const normalizedRegistry = normalizeRegistryPackageLocator(input.registryPackageLocator);
    const mappedGithubLocator = options.registryToGithubMap?.[normalizedRegistry];

    if (mappedGithubLocator) {
      const resolved = createPackageIdentity({
        ...input,
        githubRepoLocator: mappedGithubLocator
      });

      return {
        ...resolved,
        locatorInputs: {
          ...resolved.locatorInputs,
          registryPackageLocator: normalizedRegistry
        },
        requiresManualReview: false,
        resolutionPath: 'registry_map'
      };
    }

    return buildManualReviewCandidate(input, 'unmapped_registry_locator');
  }

  return buildManualReviewCandidate(input, 'insufficient_identity');
}

export function promoteProvisionalIdentity(
  provisionalIdentity: PackageIdentityResult,
  authoritativeGithubRepoId: number | string
): PackageIdentityResult {
  if (provisionalIdentity.identityState !== 'provisional') {
    throw new Error('Only provisional identities can be promoted.');
  }

  const registryName = provisionalIdentity.locatorInputs.primaryRegistryName;
  const githubRepoLocator = provisionalIdentity.locatorInputs.githubRepoLocator;

  const promotionInput: PackageIdentityInput = {
    githubRepoId: authoritativeGithubRepoId,
    subpath: provisionalIdentity.locatorInputs.subpath,
    toolKind: provisionalIdentity.locatorInputs.toolKind
  };

  if (registryName !== 'none') {
    promotionInput.primaryRegistryName = registryName;
  }

  if (githubRepoLocator) {
    promotionInput.githubRepoLocator = githubRepoLocator;
  }

  return createPackageIdentity(promotionInput);
}
