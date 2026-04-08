"use strict";
// Copyright (c) 2012 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

var Config = require("hterm/config")["default"];
var Terminal = require("hterm/terminal")["default"];

var hterm = {
  Config: Config,
  Terminal: Terminal
};
exports.hterm = hterm;
exports["default"] = hterm;