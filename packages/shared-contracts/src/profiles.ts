import type { ToolKind } from './constants.js';

export type ProfileVisibility = 'public' | 'private' | 'team';
export type ProfileTargetSdk = 'claude_code' | 'codex' | 'both';

export type ProfileInstallMode = 'plan_only' | 'apply_verify';

export type ProfileInstallRunStatus =
  | 'pending'
  | 'in_progress'
  | 'succeeded'
  | 'partially_failed'
  | 'failed';

export type ProfileInstallRunPlanStatus =
  | 'pending'
  | 'planned'
  | 'applied'
  | 'verified'
  | 'failed'
  | 'skipped';

export type ProfileAuditAction =
  | 'created'
  | 'updated'
  | 'package_added'
  | 'package_removed'
  | 'install_started'
  | 'install_completed'
  | 'exported'
  | 'imported';

export interface ProfilePackageEntry {
  package_id: string;
  package_slug: string | null;
  version_pinned: string | null;
  required: boolean;
  install_order: number;
  config_overrides: Record<string, unknown>;
}

export interface ProfileRecord {
  profile_id: string;
  name: string;
  description: string;
  author_id: string;
  visibility: ProfileVisibility;
  target_sdk: ProfileTargetSdk;
  tags: string[];
  version: string;
  profile_hash: string;
  packages: ProfilePackageEntry[];
  created_at: string;
  updated_at: string;
}

export interface ProfileCreateInput {
  name: string;
  description?: string;
  author_id: string;
  visibility?: ProfileVisibility;
  target_sdk?: ProfileTargetSdk;
  tags?: string[];
  packages: Array<{
    package_id: string;
    package_slug?: string | null;
    version_pinned?: string | null;
    required?: boolean;
    install_order: number;
    config_overrides?: Record<string, unknown>;
  }>;
}

export interface ProfileExportPayload {
  format_version: '1.0.0';
  profile: {
    profile_id: string;
    name: string;
    description: string;
    author_id: string;
    visibility: ProfileVisibility;
    target_sdk: ProfileTargetSdk;
    tags: string[];
    version: string;
    packages: ProfilePackageEntry[];
  };
  exported_at: string;
}

export interface ProfileImportInput {
  format_version: '1.0.0';
  profile: {
    name: string;
    description?: string;
    author_id: string;
    visibility?: ProfileVisibility;
    target_sdk?: ProfileTargetSdk;
    tags?: string[];
    version?: string;
    packages: Array<{
      package_id: string;
      package_slug?: string | null;
      version_pinned?: string | null;
      required?: boolean;
      install_order: number;
      config_overrides?: Record<string, unknown>;
    }>;
  };
}

export interface ProfileInstallRunRecord {
  run_id: string;
  profile_id: string;
  status: ProfileInstallRunStatus;
  total_packages: number;
  succeeded_count: number;
  failed_count: number;
  skipped_count: number;
  correlation_id: string | null;
  started_at: string;
  completed_at: string | null;
  plans: Array<{
    plan_id: string;
    package_id: string;
    install_order: number;
    status: ProfileInstallRunPlanStatus;
  }>;
}

export interface ProfileInstallInput {
  org_id: string;
  org_policy: {
    mcp_enabled: boolean;
    server_allowlist: string[];
    block_flagged: boolean;
    permission_caps: {
      maxPermissions: number;
      disallowedPermissions: string[];
    };
  };
  mode?: ProfileInstallMode;
  correlation_id?: string | null;
}
