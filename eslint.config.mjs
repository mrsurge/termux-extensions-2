// eslint.config.js
export default [
    {
        // This is a plain JS object. No imports = no "Module Not Found" errors.
        rules: {
            "no-unused-vars": "warn",   // Your "invisible" hint is now a Yellow Warning
            "no-undef": "warn",         // Catches those "missing" variable warnings
            "no-unreachable": "warn",   // Catches dead code as a warning
            "no-const-assign": "warn"   // That C++ style "read-only" check
        },
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module"
        }
    }
];
