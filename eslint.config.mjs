// eslint.config.mjs
const browserGlobals = {
    window: "readonly",
    document: "readonly",
    navigator: "readonly",
    location: "readonly",
    localStorage: "readonly",
    sessionStorage: "readonly",
    fetch: "readonly",
    WebSocket: "readonly",
    Event: "readonly",
    console: "readonly",
    setTimeout: "readonly",
    clearTimeout: "readonly",
    setInterval: "readonly",
    clearInterval: "readonly",
    requestAnimationFrame: "readonly",
    cancelAnimationFrame: "readonly",
    MutationObserver: "readonly",
    URL: "readonly",
    URLSearchParams: "readonly"
};

export default [
    {
        rules: {
            "no-unused-vars": "warn",   // 
            "no-undef": "warn",         // Catches those "missing" variable warnings
            "no-unreachable": "warn",   // Catches dead code as a warning
            "no-const-assign": "warn"   // 
        },
        languageOptions: {
            globals: browserGlobals,
            ecmaVersion: "latest",
            sourceType: "module"
        }
    }
];
