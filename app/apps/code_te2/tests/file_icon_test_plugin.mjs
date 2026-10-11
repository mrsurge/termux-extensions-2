import path from 'node:path';
const repo = path.resolve(import.meta.dirname, '../../../..');
export const fileIconTestPlugin = {
  name: 'shared-file-icon-assets',
  setup(build) {
    build.onResolve({ filter: /^\/static\/js\/file_icons\.js$/ }, () => ({ path: path.join(repo, 'app/static/js/file_icons.js') }));
    build.onResolve({ filter: /^\/static\/vendor\/seti-icons\/seti-icons\.js$/ }, () => ({ path: path.join(repo, 'app/static/vendor/seti-icons/seti-icons.js') }));
    build.onResolve({ filter: /^\/static\/vendor\/seti-icons\/language-icons\.js$/ }, () => ({ path: path.join(repo, 'app/static/vendor/seti-icons/language-icons.js') }));
  },
};
