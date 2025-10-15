# Monaco Editor Assets

These files are vendored copies of the Monaco code editor (VS Code’s editor component) for use in the Code OSS mobile wrapper. They were generated with the following steps:

```bash
npm pack monaco-editor@0.51.0
tar -xzf monaco-editor-0.51.0.tgz package/min package/LICENSE package/ThirdPartyNotices.txt
rsync -a package/min/ app/apps/code_oss/static/vendor/monaco/min/
cp package/LICENSE app/apps/code_oss/static/vendor/monaco/
cp package/ThirdPartyNotices.txt app/apps/code_oss/static/vendor/monaco/
rm -r package monaco-editor-0.51.0.tgz
```

Only the prebuilt `min` bundle is included to minimise footprint; it provides the loader, core editor, TypeScript/JSON/HTML/CSS workers, language bundles, and localisation files. If you need to refresh the version, rerun the commands above with the desired `monaco-editor@<version>` and update this README accordingly.
