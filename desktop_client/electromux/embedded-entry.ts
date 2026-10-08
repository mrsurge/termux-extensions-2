import {runRuntime} from '../../vendor/electromux/runtime/src/runtime-host';
import {createLocalFrameworkConsumer} from './local-framework-consumer';

// This entry is bundled by TE2 and chosen only by its native consumer declaration.
await runRuntime((_root, mode) => async (_signal, emit) => {
  if (mode !== 'standalone' && mode !== 'termux') throw new Error('Invalid native execution lane');
  const environment = {...process.env};
  if (mode === 'termux') {
    const home = '/data/data/com.termux/files/home', prefix = '/data/data/com.termux/files/usr';
    Object.assign(environment, {HOME: home, PREFIX: prefix, TMPDIR: `${prefix}/tmp`,
      PATH: `${prefix}/bin:${prefix}/bin/applets:/system/bin`,
      LD_PRELOAD: `${prefix}/lib/libtermux-exec.so`,
      TE2_ELECTROMUX_CONFIG_HOME: `${home}/.config/te2/te2-termux`});
  }
  return createLocalFrameworkConsumer({environment, emit, enableInstaller: mode === 'termux',
    log: (lane, text) => { process.stderr.write(`[framework:${lane}] ${text}`); }});
});
