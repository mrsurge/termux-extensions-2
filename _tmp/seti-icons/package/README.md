[![Travis (.com)](https://img.shields.io/travis/com/elviswolcott/seti-icons?logo=travis)](https://travis-ci.com/elviswolcott/seti-icons)
[![npm](https://img.shields.io/npm/v/seti-icons?label=seti-icons&logo=npm)](https://www.npmjs.com/package/seti-icons)
# seti-icons

> File icons from Seti-UI

All of the icons come from [jesseweed/seti-ui](https://github.com/jesseweed/seti-ui). 
This repo just packages them up so you can use them with `npm install`.

This package is primarily intended for use in static sites.
All of the icons are stored in a JSON file as SVG strings.
For most static sites, you only want a few icons on a page (and will likely reuse the same few icons across the entire site).
As a result, it is best to inline the icons in the pages.

In other cases, this approach does not make sense. 
For example, in a webapp where the icons are used dynamically, it would likely be better to use an SVG spritesheet to enable caching of the icons instead of bundling 100K of SVG strings.

# Usage

By default, the color name from Seti-UI is returned for icons.

```js
import { getIcon } from "seti-icons";

const { svg, color } = getIcon("README.md");
```

To replace the color keywords, use `themeIcons`.

```js
import { themeIcons } from "seti-icons";

const getIcon = themeIcons({
  blue: "#268bd2";
  grey: "#657b83";
  "grey-light": "#839496";
  green: "#859900";
  orange: "#cb4b16";
  pink: "#d33682";
  purple: "#6c71c4";
  red: "#dc322f";
  white: "#fdf6e3";
  yellow: "#b58900";
  ignore: "#586e75";
})

const { svg, color } = getIcon("README.md");
```

# Development

## Available Scripts

In the project directory, you can run:

### `./build/build.sh`

Runs a complete build from a fresh install

### `npm run build`

Builds the package using typescript into `./lib`

### `npm run build:scripts`

Builds the build scripts

### `npm run extract`

Processes the icons and styles in `seti-ui` into JSON files

### `npm test`

Launches the Jest to run tests.

### `npm run lint`

Checks code for style issues and syntax errors with TSLint and Prettier.

### `npm run lint:fix`

Checks code for style issues and syntax errors with TSLint and Prettier, attempting to fix them when possible.

## Publishing a new version

Travis is configured to run deploys on tags.