"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
var rawDefinitions = require("./definitions.json");
var rawIcons = require("./icons.json");
var definitions = rawDefinitions;
var icons = rawIcons;
var getDetails = function (fileName) {
    if (definitions.files.hasOwnProperty(fileName)) {
        return definitions.files[fileName];
    }
    var extension = fileName.slice(fileName.indexOf("."));
    while (extension !== "") {
        if (definitions.extensions.hasOwnProperty(extension)) {
            return definitions.extensions[extension];
        }
        // look for next "."
        extension = extension.slice(1);
        extension = extension.slice(extension.indexOf("."));
    }
    for (var _i = 0, _a = definitions.partials; _i < _a.length; _i++) {
        var partial = _a[_i];
        if (fileName.indexOf(partial[0]) > -1) {
            return partial[1];
        }
    }
    return definitions.default;
};
var getIcon = function (fileName) {
    var _a = getDetails(fileName), icon = _a[0], color = _a[1];
    return {
        svg: icons[icon],
        color: color,
    };
};
exports.getIcon = getIcon;
var themeIcons = function (theme) {
    return function (fileName) {
        var icon = getIcon(fileName);
        return __assign(__assign({}, icon), { color: theme[icon.color] });
    };
};
exports.themeIcons = themeIcons;
