import {
  initCommand,
  parseArgs,
  searchCommand,
  showCommand,
  listCommand,
  freshnessCommand,
  planCommand,
  installCommand,
  verifyCommand,
  updateCommand,
  removeCommand,
  rollbackCommand,
  statusCommand,
  profileListCommand,
  profileShowCommand,
  profileExportCommand,
  profileImportCommand,
  profileInstallCommand,
  healthCommand,
} from './commands.js';

const VERSION = '0.1.0';

const HELP = `Usage: forge <command> [options]

Commands:
  init                   Write first-run solo developer config
  search <query>         Search the addon catalog
  show <package_id>      Show package details
  list                   List available packages
  freshness              Show catalog source freshness
  plan <package>         Create an install plan
  install <plan_id>      Apply an install plan
  verify <plan_id>       Verify an installed addon
  update <plan_id>       Update an installed addon
  remove <plan_id>       Remove an installed addon
  rollback <plan_id>     Rollback a failed operation
  status <plan_id>       Show plan status and actions
  profile list           List profiles
  profile show <id>      Show profile details
  profile export <id>    Export a profile
  profile import <file>  Import a profile
  profile install <id>   Install a profile
  health                 Check control-plane health

Options:
  --path <file>          Config path for init/config loading (default: FORGE_CONFIG or ~/.forge/config.json)
  --force                Overwrite existing config for init
  --url <url>            Control-plane URL override (default: FORGE_URL, config, or http://localhost:8787)
  --org-id <id>          Org ID override for plan/profile install
  --org-policy-file <file>
                          Org policy JSON override for plan/profile install
  --permissions <p1,p2>  Override declared package permissions for plan
  --json                 Output raw JSON
  --help                 Show this help
  --version              Show version`;

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const args = parseArgs(rawArgs);

  // Handle global flags
  if (args.booleans.has('help') && args.positional.length === 0) {
    process.stdout.write(HELP + '\n');
    return;
  }

  if (args.booleans.has('version')) {
    process.stdout.write(`forge ${VERSION}\n`);
    return;
  }

  const command = args.positional[0];
  if (!command) {
    process.stdout.write(HELP + '\n');
    return;
  }

  // Strip the command (and subcommand for profile) from positional args
  const restArgs: string[] = [];
  const flags = new Map(args.flags);
  const booleans = new Set(args.booleans);

  // Rebuild positional args without the command/subcommand
  const commandArgs = {
    positional: args.positional.slice(1),
    flags,
    booleans,
  };

  try {
    switch (command) {
      case 'init':
        await initCommand(commandArgs);
        break;
      case 'search':
        await searchCommand(commandArgs);
        break;
      case 'show':
        await showCommand(commandArgs);
        break;
      case 'list':
        await listCommand(commandArgs);
        break;
      case 'freshness':
        await freshnessCommand(commandArgs);
        break;
      case 'plan':
        await planCommand(commandArgs);
        break;
      case 'install':
        await installCommand(commandArgs);
        break;
      case 'verify':
        await verifyCommand(commandArgs);
        break;
      case 'update':
        await updateCommand(commandArgs);
        break;
      case 'remove':
        await removeCommand(commandArgs);
        break;
      case 'rollback':
        await rollbackCommand(commandArgs);
        break;
      case 'status':
        await statusCommand(commandArgs);
        break;
      case 'profile': {
        const subcommand = commandArgs.positional[0];
        const profileArgs = {
          positional: commandArgs.positional.slice(1),
          flags,
          booleans,
        };
        switch (subcommand) {
          case 'list':
            await profileListCommand(profileArgs);
            break;
          case 'show':
            await profileShowCommand(profileArgs);
            break;
          case 'export':
            await profileExportCommand(profileArgs);
            break;
          case 'import':
            await profileImportCommand(profileArgs);
            break;
          case 'install':
            await profileInstallCommand(profileArgs);
            break;
          default:
            process.stdout.write(`Unknown profile subcommand: ${subcommand ?? '(none)'}\n\n${HELP}\n`);
            process.exitCode = 1;
            break;
        }
        break;
      }
      case 'health':
        await healthCommand(commandArgs);
        break;
      default:
        process.stdout.write(`Unknown command: ${command}\n\n${HELP}\n`);
        process.exitCode = 1;
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`forge: ${message}\n`);
    process.exitCode = 1;
  }
}

main();
