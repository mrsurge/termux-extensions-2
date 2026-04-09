"use strict";
// Copyright (c) 2014 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

var cursorShape = require("hterm/struct/cursor_shape")["default"];
var keyActions = require("hterm/struct/key_actions")["default"];

var RowCol = require("hterm/struct/rowcol")["default"];
var Size = require("hterm/struct/size")["default"];
var TerminalOptions = require("hterm/struct/terminal_options")["default"];

var struct = {
  cursorShape: cursorShape,
  keyActions: keyActions,
  RowCol: RowCol,
  Size: Size,
  TerminalOptions: TerminalOptions
};
exports.struct = struct;
exports["default"] = struct;