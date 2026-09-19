/**
 * Refuses installs from any package manager other than pnpm.
 *
 * This repo is a **pnpm workspace**, declared in `pnpm-workspace.yaml`. npm and
 * yarn do not read that file — they only understand the `workspaces` field in
 * `package.json`, which we deliberately do not have. So `npm install` at the
 * root "succeeds", installs only the root devDependencies, and silently leaves
 * every `apps/*` and `packages/*` without its `node_modules`.
 *
 * The result is the genuinely baffling:
 *
 *     > @wms/web@0.1.0 dev
 *     > vite
 *     sh: vite: command not found
 *
 * ...because `vite` is a dependency of `apps/web`, not of the root. npm even
 * prints "up to date", because from its point of view it is.
 *
 * Failing loudly here costs one confusing minute; not failing costs an hour of
 * debugging an app that was never installed.
 */

const agent = process.env.npm_config_user_agent ?? '';
const manager = agent.split('/')[0];

// `npm_config_user_agent` is set by every major package manager. If it is
// absent the script was probably run directly, which is fine — do not block.
if (agent === '') process.exit(0);

if (manager !== 'pnpm') {
  const red = '\u001b[31m';
  const bold = '\u001b[1m';
  const dim = '\u001b[2m';
  const reset = '\u001b[0m';

  process.stderr.write(
    `\n${red}${bold}✖ This repository requires pnpm.${reset}\n\n` +
      `  You ran ${bold}${manager || 'another package manager'}${reset}, but this is a pnpm workspace\n` +
      `  (see ${bold}pnpm-workspace.yaml${reset}). npm and yarn ignore that file, so they\n` +
      `  install only the root dependencies and leave ${bold}apps/*${reset} and ${bold}packages/*${reset}\n` +
      `  empty — which later fails as ${bold}"vite: command not found"${reset}.\n\n` +
      `  ${bold}To fix:${reset}\n\n` +
      `    corepack enable\n` +
      `    rm -rf node_modules package-lock.json\n` +
      `    pnpm install\n` +
      `    pnpm dev\n\n` +
      `  ${dim}corepack ships with Node 20+ and will fetch the pinned pnpm version\n` +
      `  from the "packageManager" field automatically.${reset}\n\n`,
  );
  process.exit(1);
}
