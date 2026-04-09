"use strict";
// Copyright (c) 2014 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

var msg = require("hterm/i18n/msg")["default"];
var utf8 = require("hterm/i18n/utf8")["default"];
var wc = require("hterm/i18n/wc")["default"];

var i18n = {
  msg: msg,
  utf8: utf8,
  wc: wc
};
exports.i18n = i18n;
exports["default"] = i18n;