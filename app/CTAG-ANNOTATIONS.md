 Universal Ctags, the nice “stdout-friendly” options.

Here are the least context-heavy one-liners that stay deterministic.

## 1) Emit a tiny `file:line<TAB>name` index (stdout only)

```bash
ctags -n --output-format=json -f - --languages=JavaScript /path/to/file.js 2>/dev/null \
| sed -n 's/.*"path":"\([^"]*\)".*"line":\([0-9]*\).*"name":"\([^"]*\)".*/\1:\2\t\3/p'
```

Now it’s just text you can `rg`:

```bash
… | rg -F $'\tsomeFn$' | head
```

## 2) Inject `/* @fn NAME */` into the prettified stream (no files written)

This is your “annotated view” generator:

```bash
awk 'FNR==NR{ann[$2]=$1;next}{ln=$1;$1="";sub(/^[ \t]+/,""); if(ln in ann)print "/* @fn "ann[ln]" */"; print ln"\t"$0}' \
<(ctags -n --output-format=json -f - --languages=JavaScript /path/to/file.js 2>/dev/null \
  | sed -n 's/.*"line":\([0-9]*\).*"name":"\([^"]*\)".*/\2 \1/p') \
<(prettier /path/to/file.js 2>/dev/null | nl -ba)
```

Then you keep your normal pattern:

```bash
… | rg -n "someCode" | head -3
```

## 3) “I don’t know which file” + still no tags file

Build a global index on stdout:

```bash
find /path/to/installed/code -type f -name '*.js' -print0 \
| xargs -0 ctags -n --output-format=json -f - --languages=JavaScript 2>/dev/null \
| sed -n 's/.*"path":"\([^"]*\)".*"line":\([0-9]*\).*"name":"\([^"]*\)".*/\1:\2\t\3/p'
```

Then:

```bash
… | rg -F $'\tsomeFn$' | head
```

### Why JSON output is the win here

With Universal Ctags, `--output-format=json` gives you a stable record shape you can strip down into one-liners without wrestling the classic tags format.
