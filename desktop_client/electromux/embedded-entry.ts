import {runElectronRuntime} from '../../vendor/electromux/runtime/src/electron-runtime-host';
import {createLocalFrameworkConsumer} from './local-framework-consumer';
import {createElectronNavigation} from './electron-navigation';

// This entry is bundled by TE2 and chosen only by its native consumer declaration.
await runElectronRuntime((_root, mode, apply) => async (_signal, emit) => {
  if (mode !== 'standalone' && mode !== 'termux') throw new Error('Invalid native execution lane');
  const environment = {...process.env};
  if (mode === 'termux') {
    const home = '/data/data/com.termux/files/home', prefix = '/data/data/com.termux/files/usr';
    Object.assign(environment, {HOME: home, PREFIX: prefix, TMPDIR: `${prefix}/tmp`,
      PATH: `${prefix}/bin:${prefix}/bin/applets:/system/bin`,
      LD_PRELOAD: `${prefix}/lib/libtermux-exec.so`,
      TE2_ELECTROMUX_CONFIG_HOME: `${home}/.config/te2/te2-termux`});
  }
  const consumer = await createLocalFrameworkConsumer({environment, emit, enableInstaller: mode === 'termux',
    log: (lane, text) => { process.stderr.write(`[framework:${lane}] ${text}`); }});
  // Version is metadata from this consumer's build, never a claimed Electron version.
  const navigate = createElectronNavigation(apply, TE2_CONSUMER_VERSION);
  return {...consumer, methods: [...consumer.methods, 'electron.window.action'],
    dispatch: (method, params) => method === 'electron.window.action' ? navigate(params) : consumer.dispatch(method, params)};
}, ['local-framework-state']);

declare const TE2_CONSUMER_VERSION: string;
