import eruda from "./vendor/eruda.js";

const key = Symbol.for("te2.mobile-inspector");
eruda.init();
eruda.get("entryBtn").hide();
Object.defineProperty(window, key, {
  configurable: true,
  value: {
    toggle: () => eruda.get().toggle(),
    destroy: () => {
      eruda.destroy();
      Reflect.deleteProperty(window, key);
    },
  },
});
eruda.show("console");
eruda.show();
