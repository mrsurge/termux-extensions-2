"use strict";
// Copyright (c) 2014 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

var colors = require("hterm/util/colors")["default"];
var dom = require("hterm/util/dom")["default"];
var f = require("hterm/util/f")["default"];
var PubSub = require("hterm/util/pubsub")["default"];
var string = require("hterm/util/string")["default"];

var util = {
  colors: colors,
  dom: dom,
  f: f,
  PubSub: PubSub,
  string: string
};
exports.util = util;
exports["default"] = util;