import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "TE2 Desktop",
    identifier: "dev.te2.desktop",
    version: "0.2.323",
  },
  build: {
    views: {
      mainview: {
        entrypoint: "src/mainview/index.ts",
      },
    },
    copy: {
      "src/mainview/index.html": "views/mainview/index.html",
      "src/mainview/index.css": "views/mainview/index.css",
      "../android_shell": "views/mainview/android_shell",
    },
    mac: {
      bundleCEF: false,
    },
    linux: {
      bundleCEF: true,
      defaultRenderer: "cef",
      chromiumFlags: {
        "disable-gpu": false,
        "disable-gpu-compositing": false,
        "disable-accelerated-video-decode": false,
        "disable-accelerated-video-encode": false,
        "disable-dev-shm-usage": false,
      },
    },
    win: {
      bundleCEF: false,
    },
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
} satisfies ElectrobunConfig;
