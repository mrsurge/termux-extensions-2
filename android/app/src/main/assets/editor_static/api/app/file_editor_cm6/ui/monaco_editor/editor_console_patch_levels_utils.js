export function patchConsoleLevels(levels, emitLogFn) {
  var originals = {};
  for (var i = 0; i < levels.length; i++) {
    (function(level) {
      originals[level] = console[level].bind(console);
      console[level] = function() {
        var args = Array.prototype.slice.call(arguments);
        try { emitLogFn(level, args); } catch(_) {}
        return originals[level].apply(console, args);
      };
    })(levels[i]);
  }
  return originals;
}
