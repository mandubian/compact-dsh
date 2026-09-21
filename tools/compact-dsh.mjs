#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdir, open, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const binName = 'compact-dsh';
const rootUrl = new URL('../package.json', import.meta.url).href;
const execute = promisify(execFile);

function absolutePath(value) {
  if (value === '~') return homedir();
  return resolve(value.startsWith('~/') ? join(homedir(), value.slice(2)) : value);
}

async function ensureDirectory(path) {
  try {
    if (!(await stat(path)).isDirectory()) throw new Error(`not a directory: ${path}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await ensureDirectory(dirname(path));
    await mkdir(path, { mode: 0o700 }).catch(error => {
      if (error.code !== 'EEXIST') throw error;
    });
    if (!(await stat(path)).isDirectory()) throw new Error(`not a directory: ${path}`);
  }
}

async function emptyRoot(path) {
  let file;
  try {
    file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    await file.writeFile('[]\n');
    await file.sync();
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await file.stat();
    if (!info.isFile() || info.size > 64 || (await file.readFile('utf8')).trim() !== '[]') {
      throw new Error(`refusing non-empty generated root: ${path}; move it aside explicitly before retrying`);
    }
  } finally {
    await file?.close();
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      smoke: { type: 'boolean' },
      attended: { type: 'boolean' },
      web: { type: 'boolean' },
      workspace: { type: 'string' },
      'state-dir': { type: 'string' },
    },
  });
  if (values.help) {
    console.log('Usage: npm run compact -- [--attended] [--workspace PATH] [--state-dir PATH] "task"\n       npm run compact -- --web [--workspace PATH] [--state-dir PATH]\n       npm run compact -- --smoke [--workspace PATH] [--state-dir PATH]\nState defaults to ~/.compact-dsh (COMPACT_STATE_DIR overrides); DSH_HOME is isolated there.\nTask mode inherits DEEPSEEK_API_KEY; default model: deepseek-flash.\n--web serves the browser UI (default 127.0.0.1:3080; COMPACT_WEB_PORT / COMPACT_WEB_HOST override): chat in the browser, approval prompts fall through to this terminal. No task argument; takes no --smoke.\n--attended prompts the operator on the terminal for uncovered gated calls (default deny; stderr only); implied by --web.\n--smoke never prompts and forbids --attended.\nDocker image must already exist locally: COMPACT_SANDBOX_IMAGE (default ubuntu:24.04).');
    return;
  }
  if (values.attended && values.smoke) {
    throw new Error('--attended prompts the operator; --smoke forbids prompts and model calls — pick one');
  }
  if (values.web && values.smoke) {
    throw new Error('--web serves live browser sessions; --smoke forbids model calls and prompts — pick one');
  }
  const task = positionals.join(' ');
  if (values.web || values.smoke) {
    if (positionals.length > 0) {
      throw new Error(values.web ? '--web takes no task; sessions start from the browser' : '--smoke takes no task; use --help for usage');
    }
  } else if (!task.trim()) {
    throw new Error('supply a task, or --smoke for a no-model boot; use --help for usage');
  }
  for (const key of ['workspace', 'state-dir']) {
    if (values[key] !== undefined && !values[key].trim()) throw new Error(`--${key} must not be empty`);
  }
  const workspace = await realpath(absolutePath(values.workspace ?? process.cwd()));
  if (!(await stat(workspace)).isDirectory()) throw new Error(`not a workspace directory: ${workspace}`);
  const stateDir = absolutePath(values['state-dir'] ?? (process.env.COMPACT_STATE_DIR || join(homedir(), '.compact-dsh')));
  const image = process.env.COMPACT_SANDBOX_IMAGE || 'ubuntu:24.04';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(image)) throw new Error('COMPACT_SANDBOX_IMAGE must be a Docker image reference');
  let digest;
  try {
    const result = await execute('docker', ['image', 'inspect', '--format', '{{.Id}}', image], { timeout: 10_000 });
    digest = result.stdout.trim();
  } catch {
    throw new Error(`cannot inspect local Docker image ${image}; ensure Docker is installed/running and accessible, then run: docker pull ${image}. No image was pulled.`);
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error('Docker image inspect did not return a valid .Id digest');
  const webArgs = ['--no-open'];
  if (values.web) {
    const port = process.env.COMPACT_WEB_PORT;
    if (port !== undefined && !/^\d+$/.test(port)) throw new Error('COMPACT_WEB_PORT must be a port number');
    const host = process.env.COMPACT_WEB_HOST;
    // mirrored from dsh-web-app/startup: 0.0.0.0 would expose the surface to the network
    if (host === '0.0.0.0') throw new Error('COMPACT_WEB_HOST 0.0.0.0 is refused: the pilot is single-user local, not a network service');
    if (host !== undefined) webArgs.push('--host', host);
    if (port !== undefined) webArgs.push('--port', port);
  }
  const paths = {
    COMPACT_STATE_DIR: stateDir,
    COMPACT_WORKSPACE: workspace,
    COMPACT_RECORD_ROOT: absolutePath(process.env.COMPACT_RECORD_ROOT || join(stateDir, 'sessions')),
    COMPACT_CHAIN_DIR: absolutePath(process.env.COMPACT_CHAIN_DIR || join(stateDir, 'chains')),
    COMPACT_APPROVAL_PERSIST_PATH: absolutePath(process.env.COMPACT_APPROVAL_PERSIST_PATH || join(stateDir, 'approvals.json')),
  };
  const allowlist = process.env.COMPACT_ALLOWLIST || '[]';
  let rules;
  try {
    rules = JSON.parse(allowlist);
  } catch {
    throw new Error('COMPACT_ALLOWLIST must be a JSON array of non-empty strings');
  }
  if (!Array.isArray(rules) || rules.some(rule => typeof rule !== 'string' || !rule.trim())) {
    throw new Error('COMPACT_ALLOWLIST must be a JSON array of non-empty strings');
  }
  Object.assign(process.env, paths, {
    DSH_HOME: stateDir,
    DSH_TELEMETRY_DISABLED: '1',
    COMPACT_ALLOWLIST: allowlist,
    COMPACT_SANDBOX_IMAGE: image,
    COMPACT_SANDBOX_IMAGE_DIGEST: digest,
    COMPACT_SANDBOX_RECORDED_BY: process.env.COMPACT_SANDBOX_RECORDED_BY || 'compact-dsh launcher operator',
    COMPACT_SANDBOX_PROVENANCE_NOTE: process.env.COMPACT_SANDBOX_PROVENANCE_NOTE || 'Operator-declared use of an existing local image; digest observed via docker image inspect .Id. Acquisition and build history are not verified.',
  });
  for (const path of [stateDir, paths.COMPACT_RECORD_ROOT, paths.COMPACT_CHAIN_DIR, dirname(paths.COMPACT_APPROVAL_PERSIST_PATH)]) {
    await ensureDirectory(path);
  }
  const configFile = join(stateDir, 'compact.generated.cordis.yml');
  await emptyRoot(configFile);
  process.chdir(workspace);

  const { boot, loadOverlayPatches, installFailLoud } = await import('@deepseek-ai/dsh-app-boot');
  const { provideCmdline } = await import('@deepseek-ai/dsh-cmdline');
  const { webRows, PRESET_ID, ensureInstallAnchor, alignWorkspaceRegistry, ASIDE_RETENTION } = await import('compact-dsh-blessed/web');
  if (values.web) {
    ensureInstallAnchor(stateDir);
    // one boot, one exposed workspace: a registry naming another directory
    // would attach browser sessions to files this boot never exposed
    const aligned = alignWorkspaceRegistry(stateDir, workspace);
    if (aligned.foreign.length > 0) {
      console.error(`${binName}: the workspace registry named ${aligned.foreign.length} director${aligned.foreign.length === 1 ? 'y' : 'ies'} this boot does not expose (${aligned.foreign.join(', ')}); removed from the registry — browser sessions attach to ${workspace}`);
    }
    if (aligned.aside) {
      const prunedNote = aligned.pruned?.length ? `; pruned ${aligned.pruned.length} older aside(s) beyond the kept ${ASIDE_RETENTION}` : '';
      console.error(`${binName}: the workspace registry was unreadable and moved to ${aligned.aside}${prunedNote}; the first session bootstrap may re-register directories from session history — remove them in the UI workspace settings`);
    }
  }
  const bundle = name => loadOverlayPatches(binName, fileURLToPath(new URL('./cordis.patch.yml', import.meta.resolve(`${name}/package.json`))));
  const patches = [
    ...bundle('@deepseek-ai/dsh-base'),
    ...values.smoke ? [] : values.web ? bundle('@deepseek-ai/dsh-web-app') : bundle('@deepseek-ai/dsh-headless'),
    ...bundle('compact-dsh-blessed'),
    { id: 'tools', config: { mode: 'native' } },
    ...values.web ? webRows() : values.smoke ? [] : [
      { id: 'headless-startup', disabled: true },
      { id: 'code-runtime', disabled: true },
      { id: 'headless-runner', inject: ['compact-ready'], config: { task } },
    ],
  ];
  let ctx;
  let disposal;
  let exitCode;
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  const dispose = () => {
    if (!ctx) return Promise.resolve();
    return disposal ??= (async () => {
      const timeout = setTimeout(() => {
        console.error(`${binName}: disposal timed out`);
        process.exit(exitCode || 1);
      }, 10_000);
      try {
        await ctx.fiber.dispose();
      } finally {
        clearTimeout(timeout);
      }
    })();
  };
  const requestExit = code => {
    if (exitCode !== undefined) return;
    exitCode = code;
    finish();
  };
  const interrupt = code => {
    requestExit(code);
    void dispose().catch(() => { process.exitCode = 1; });
  };
  const onInterrupt = () => interrupt(130);
  const onTerminate = () => interrupt(143);
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  const uninstallFailLoud = installFailLoud(binName, process, dispose);
  const keepAlive = setInterval(() => {}, 60_000);
  let modelRequests = 0;
  try {
    ctx = await boot(binName, configFile, patches, host => {
      ctx = host;
      if (exitCode !== undefined) throw new Error('startup interrupted');
      provideCmdline(host, { args: values.web ? webArgs : [], exit: requestExit });
      if (values.smoke) host.on('llm/stream', () => {
        modelRequests++;
        throw new Error('compact smoke forbids model requests');
      }, { prepend: true });
    }, rootUrl);
    if (exitCode === undefined) {
      if (values.attended || values.web) {
        // appended on the settled context, downstream of the composition's
        // recorded answerer — it claims compact asks first; the operator
        // decides what it delegates. Never mounted under --smoke (rejected
        // above). In web mode the browser may surface the ask first over the
        // gateway; this answerer is the fall-through decider on the terminal.
        const { operatorAnswerer } = await import('./operator-answerer.mjs');
        operatorAnswerer(ctx);
      }
      if (ctx.get('compact-ready')?.ready !== true) throw new Error('compact-ready was not provided; refusing to run');
      console.error(`${binName}: ready${values.smoke ? ' (smoke; no LLM request)' : values.web ? ' (web; approval prompts fall through to this terminal)' : ''}; draft Compact, no Compact standing.`);
      console.error(`State: ${stateDir}; records: ${paths.COMPACT_RECORD_ROOT}; chains: ${paths.COMPACT_CHAIN_DIR}; approvals: ${paths.COMPACT_APPROVAL_PERSIST_PATH}`);
      if (values.web) {
        console.error(`${binName}: browser sessions compose the '${PRESET_ID}' agent preset — confined bash only; the dynamic-plugin runner is absent by declaration (A-4/DYN)`);
      }
      if (values.smoke) {
        if (modelRequests !== 0) throw new Error('smoke attempted a model request');
        requestExit(0);
      }
    }
    await finished;
    process.exitCode = exitCode;
  } catch (error) {
    if (exitCode !== 130 && exitCode !== 143) throw error;
    process.exitCode = exitCode;
  } finally {
    try {
      await dispose();
    } finally {
      clearInterval(keepAlive);
      uninstallFailLoud();
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
    }
  }
}

main().catch(error => {
  console.error(`${binName}: ${error.message}`);
  process.exitCode = 1;
});
