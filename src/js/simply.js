/**
 * Simply.js
 * @namespace simply
 */

var ajax = require('ajax');
var util2 = require('util2');
var myutil = require('myutil');
var imagelib = require('image');

var Emitter = require('emitter');

var simply = module.exports;

simply.ui = {};

var Window = require('ui/window');
var Card = simply.ui.Card = require('ui/card');
var Menu = simply.ui.Menu = require('ui/menu');

var eventTypes = [
  'accelTap',
  'accelData',
];

var state = {};

simply.state = state;
simply.packages = {};
simply.listeners = {};

simply.settingsUrl = 'http://meiguro.com/simplyjs/settings.html';

simply.init = function() {
  if (!simply.inited) {
    simply.inited = new Date().getTime();

    ajax.onHandler = function(type, handler) {
      return simply.wrapHandler(handler, 2);
    };

    Emitter.onAddHandler = simply.onAddHandler;
    Emitter.onRemoveHandler = simply.onRemoveHandler;
  }

  simply.loadMainScript();
};

simply.wrapHandler = function(handler) {
  return simply.impl.wrapHandler.apply(this, arguments);
};

simply.reset = function() {
  if (state.emitter) {
    simply.off();
  }

  simply.state = state = {};
  simply.packages = {};

  state.run = true;
  state.numPackages = 0;
  state.options = {};

  var emitter = new Emitter();
  emitter.wrapHandler = simply.wrapHandler;
  state.emitter = emitter;

  state.card = new Card();

  state.image = {
    cache: {},
    nextId: 1,
  };

  state.webview = {
    listeners: [],
  };

  simply.accelInit();
};

/**
 * Simply.js event handler callback.
 * @callback simply.eventHandler
 * @param {simply.event} event - The event object with event specific information.
 */

simply.onAddHandler = function(type, subtype) {
  if (type === 'accelData') {
    simply.accelAutoSubscribe();
  }
};

simply.onRemoveHandler = function(type, subtype) {
  if (!type || type === 'accelData') {
    simply.accelAutoSubscribe();
  }
};

simply.listenerCount = function(type, subtype) {
  var count = 0;
  var listeners = state.emitter.listeners(type, subtype);
  count += (listeners ? listeners.length : 0);
  listeners = state.card && state.card.emitter.listeners(type, subtype);
  count += (listeners ? listeners.length : 0);
  return count;
};

var setWindow = function(wind, field) {
  field = field || 'window';
  var other = state[field];
  if (other) {
    other.forEachListener(other.onRemoveHandler);
    other.forEachListener(simply.onRemoveHandler);
  }
  state[field] = wind;
  if (wind) {
    wind.forEachListener(wind.onAddHandler);
    wind.forEachListener(simply.onAddHandler);
  }
  return wind;
};

var checkEventType = function(type) {
  if (eventTypes.indexOf(type) === -1) {
    throw new Error('Invalid event type: ' + type);
  }
};

/**
 * Subscribe to Pebble events.
 * See {@link simply.event} for the possible event types to subscribe to.
 * Subscribing to a Pebble event requires a handler. An event object will be passed to your handler with event information.
 * Events can have a subtype which can be used to filter events before the handler is called.
 * @memberOf simply
 * @param {string} type - The event type.
 * @param {string} [subtype] - The event subtype.
 * @param {simply.eventHandler} handler - The event handler. The handler will be called with corresponding event.
 * @see simply.event
 */
simply.on = function(type, subtype, handler) {
  if (type) {
    checkEventType(type);
  }
  if (!handler) {
    handler = subtype;
    subtype = 'all';
  }
  state.emitter.on(type, subtype, handler);
};

/**
 * Unsubscribe from Pebble events.
 * When called without a handler, all handlers of the type and subtype are unsubscribe.
 * When called with no parameters, all handlers are unsubscribed.
 * @memberOf simply
 * @param {string} type - The event type.
 * @param {string} [subtype] - The event subtype.
 * @param {function} [handler] - The event handler to unsubscribe.
 * @see simply.on
 */
simply.off = function(type, subtype, handler) {
  if (type) {
    checkEventType(type);
  }
  if (!handler) {
    handler = subtype;
    subtype = 'all';
  }
  state.emitter.off(type, subtype, handler);
};

simply.emit = function(type, subtype, handler) {
  state.emitter.emit(type, subtype, handler);
};

var pathToName = function(path) {
  var name = path;
  if (typeof name === 'string') {
    name = name.replace(simply.basepath(), '');
  }
  return name || simply.basename();
};

simply.getPackageByPath = function(path) {
  return simply.packages[pathToName(path)];
};

simply.makePackage = function(path) {
  var name = pathToName(path);
  var saveName = 'script:' + path;
  var pkg = simply.packages[name];

  if (!pkg) {
    pkg = simply.packages[name] = {
      name: name,
      saveName: saveName,
      filename: path
    };
  }

  return pkg;
};

simply.defun = function(fn, fargs, fbody) {
  if (!fbody) {
    fbody = fargs;
    fargs = [];
  }
  return new Function('return function ' + fn + '(' + fargs.join(', ') + ') {' + fbody + '}')();
};

var slog = function() {
  var args = [];
  for (var i = 0, ii = arguments.length; i < ii; ++i) {
    args[i] = util2.toString(arguments[i]);
  }
  return args.join(' ');
};

simply.fexecPackage = function(script, pkg) {
  // console shim
  var console2 = simply.console2 = {};
  for (var k in console) {
    console2[k] = console[k];
  }

  console2.log = function() {
    var msg = pkg.name + ': ' + slog.apply(this, arguments);
    var width = 45;
    var prefix = (new Array(width + 1)).join('\b'); // erase Simply.js source line
    var suffix = msg.length < width ? (new Array(width - msg.length + 1)).join(' ') : 0;
    console.log(prefix + msg + suffix);
  };

  // loader
  return function() {
    var exports = pkg.exports;
    var result = simply.defun(pkg.execName,
      ['module', 'require', 'console', 'Pebble', 'simply'], script)
      (pkg, simply.require, console2, Pebble, simply);

    // backwards compatibility for return-style modules
    if (pkg.exports === exports && result) {
      pkg.exports = result;
    }

    return pkg.exports;
  };
};

simply.loadScript = function(scriptUrl, async) {
  console.log('loading: ' + scriptUrl);

  var pkg = simply.makePackage(scriptUrl);
  pkg.exports = {};

  var loader = util2.noop;
  var useScript = function(script) {
    loader = simply.fexecPackage(script, pkg);
  };

  ajax({ url: scriptUrl, cache: false, async: async }, function(data) {
    if (data && data.length) {
      localStorage.setItem(pkg.saveName, data);
      useScript(data);
    }
  }, function(data, status) {
    data = localStorage.getItem(pkg.saveName);
    if (data && data.length) {
      console.log(status + ': failed, loading saved script instead');
      useScript(data);
    }
  });

  return simply.impl.loadPackage.call(this, pkg, loader);
};

simply.loadMainScriptUrl = function(scriptUrl) {
  if (typeof scriptUrl === 'string' && scriptUrl.length && !scriptUrl.match(/^(\w+:)?\/\//)) {
    scriptUrl = 'http://' + scriptUrl;
  }

  if (scriptUrl) {
    localStorage.setItem('mainJsUrl', scriptUrl);
  } else {
    scriptUrl = localStorage.getItem('mainJsUrl');
  }

  return scriptUrl;
};

simply.loadMainScript = function(scriptUrl) {
  simply.reset();
  scriptUrl = simply.loadMainScriptUrl(scriptUrl);
  if (!scriptUrl) {
    return;
  }
  simply.loadOptions();
  try {
    simply.loadScript(scriptUrl, false);
  } catch (e) {
    simply.text({
      title: 'Failed to load',
      body: scriptUrl,
    }, true);
    return;
  }
};

simply.basepath = function(path) {
  path = path || localStorage.getItem('mainJsUrl');
  return path.replace(/[^\/]*$/, '');
};

simply.basename = function(path) {
  path = path || localStorage.getItem('mainJsUrl');
  return path.match(/[^\/]*$/)[0];
};

/**
 * Loads external dependencies, allowing you to write a multi-file project.
 * Package loading loosely follows the CommonJS format.
 * Exporting is possible by modifying or setting module.exports within the required file.
 * The module path is also available as module.path.
 * This currently only supports a relative path to another JavaScript file.
 * @global
 * @param {string} path - The path to the dependency.
 */
simply.require = function(path) {
  if (!path.match(/\.js$/)) {
    path += '.js';
  }
  var package = simply.packages[path];
  if (package) {
    return package.value;
  }
  path = baseTransformPath(path);
  return simply.loadScript(path, false);
};

simply.window = function(field, value, clear) {
  var wind = state.window;
  var result;
  var windowDef = myutil.toObject(field, value);
  if (typeof clear === 'undefined') {
    clear = value;
  }
  clear = clear ? 'all' : clear;
  if (this instanceof Window) {
    result = this;
    if (wind !== this) {
      wind = this;
    }
  } else {
    result = wind.prop(windowDef, clear);
  }
  if (wind !== state.window) {
    wind = setWindow(wind);
    util2.copy(wind.state, windowDef);
    clear = 'all';
  }
  if (wind === result) {
    simply.impl.window(windowDef, clear);
  }
  return result;
};

simply.card = function(field, value, clear) {
  var card = state.card;
  var result;
  var cardDef = myutil.toObject(field, value);
  if (typeof clear === 'undefined') {
    clear = value;
  }
  clear = clear ? 'all' : clear;
  if (this instanceof Card) {
    result = this;
    if (card !== this) {
      card = this;
    }
  } else {
    result = card.prop(cardDef, clear);
  }
  if (card !== state.card) {
    card = setWindow(card, 'card');
    util2.copy(card.state, cardDef);
    clear = 'all';
  }
  if (card === result) {
    simply.impl.card(cardDef, clear);
  }
  return result;
};

simply.action = function(field, image, clear) {
  var card = state.card;
  var result = this instanceof Card ? this : card.action(field, image, clear);
  if (card === result) {
    simply.impl.card({ action: typeof field === 'boolean' ? field : card.state.action }, 'action');
  }
  return result;
};

/**
 * Vibrates the Pebble.
 * There are three support vibe types: short, long, and double.
 * @memberOf simply
 * @param {string} [type=short] - The vibe type.
 */
simply.vibe = function() {
  return simply.impl.vibe.apply(this, arguments);
};

var makeImageHash = function(image) {
  var url = image.url;
  var hashPart = '';
  if (image.width) {
    hashPart += ',width:' + image.width;
  }
  if (image.height) {
    hashPart += ',height:' + image.height;
  }
  if (image.dither) {
    hashPart += ',dither:' + image.dither;
  }
  if (hashPart) {
    url += '#' + hashPart.substr(1);
  }
  return url;
};

var parseImageHash = function(hash) {
  var image = {};
  hash = hash.split('#');
  image.url = hash[0];
  hash = hash[1];
  if (!hash) { return image; }
  var args = hash.split(',');
  for (var i = 0, ii = args.length; i < ii; ++i) {
    var arg = args[i];
    if (arg.match(':')) {
      arg = arg.split(':');
      var v = arg[1];
      image[arg[0]] = !isNaN(Number(v)) ? Number(v) : v;
    } else {
      image[arg] = true;
    }
  }
  return image;
};

var baseTransformPath = function(path) {
  var basepath = simply.basepath();
  if (path.match(/^\/\//)) {
    var m = basepath.match(/^(\w+:)\/\//);
    path = (m ? m[1] : 'http:') + path;
  }
  if (!path.match(/^\w+:\/\//)) {
    path = basepath + path;
  }
  return path;
};

simply.image = function(opt, reset, callback) {
  if (typeof opt === 'string') {
    opt = parseImageHash(opt);
  }
  if (typeof reset === 'function') {
    callback = reset;
    reset = null;
  }
  var url = baseTransformPath(opt.url);
  var hash = makeImageHash(opt);
  var image = state.image.cache[hash];
  if (image) {
    if ((opt.width && image.width !== opt.width) ||
        (opt.height && image.height !== opt.height) ||
        (opt.dither && image.dither !== opt.dither)) {
      reset = true;
    }
    if (reset !== true) {
      return image.id;
    }
  }
  image = {
    id: state.image.nextId++,
    url: url,
    width: opt.width,
    height: opt.height,
    dither: opt.dither,
  };
  state.image.cache[hash] = image;
  imagelib.load(image, function() {
    simply.impl.image(image.id, image.gbitmap);
    if (callback) {
      var e = {
        type: 'image',
        image: image.id,
        url: image.url,
      };
      callback(e);
    }
  });
  return image.id;
};

var getOptionsKey = function() {
  return 'options:' + simply.basename();
};

simply.saveOptions = function() {
  var options = state.options;
  localStorage.setItem(getOptionsKey(), JSON.stringify(options));
};

simply.loadOptions = function() {
  state.options = {};
  var options = localStorage.getItem(getOptionsKey());
  try {
    state.options = JSON.parse(options);
  } catch (e) {}
};

simply.option = function(key, value) {
  var options = state.options;
  if (arguments.length >= 2) {
    if (typeof value === 'undefined') {
      delete options[key];
    } else {
      try {
        value = JSON.stringify(value);
      } catch (e) {}
      options[key] = '' + value;
    }
    simply.saveOptions();
  }
  value = options[key];
  if (!isNaN(Number(value))) {
    return Number(value);
  }
  try {
    value = JSON.parse(value);
  } catch (e) {}
  return value;
};

simply.getBaseOptions = function() {
  return {
    scriptUrl: localStorage.getItem('mainJsUrl'),
  };
};

simply.settings = function(opt, open, close) {
  if (typeof opt === 'string') {
    opt = { url: opt };
  }
  if (typeof close === 'undefined') {
    close = open;
    open = util2.noop;
  }
  var listener = {
    params: opt,
    open: open,
    close: close,
  };
  state.webview.listeners.push(listener);
};

simply.openSettings = function(e) {
  var options;
  var url;
  var listener = util2.last(state.webview.listeners);
  if (listener) {
    url = listener.params.url;
    options = state.options;
    e = {
      originalEvent: e,
      options: options,
      url: listener.params.url,
    };
    listener.open(e);
  } else {
    url = simply.settingsUrl;
    options = simply.getBaseOptions();
  }
  var hash = encodeURIComponent(JSON.stringify(options));
  Pebble.openURL(url + '#' + hash);
};

simply.closeSettings = function(e) {
  var listener = util2.last(state.webview.listeners);
  var options = {};
  if (e.response) {
    options = JSON.parse(decodeURIComponent(e.response));
  }
  if (listener) {
    e = {
      originalEvent: e,
      options: options,
      url: listener.params.url,
    };
    return listener.close(e);
  }
  if (options.scriptUrl) {
    simply.loadMainScript(options.scriptUrl);
  }
};

simply.accelInit = function() {
  state.accel = {
    rate: 100,
    samples: 25,
    subscribe: false,
    subscribeMode: 'auto',
    listeners: [],
  };
};

simply.accelAutoSubscribe = function() {
  var accelState = state.accel;
  if (!accelState || accelState.subscribeMode !== 'auto') {
    return;
  }
  var subscribe = simply.listenerCount('accelData') > 0;
  if (subscribe !== state.accel.subscribe) {
    return simply.accelConfig(subscribe, true);
  }
};

/**
 * The accelerometer configuration parameter for {@link simply.accelConfig}.
 * The accelerometer data stream is useful for applications such as gesture recognition when accelTap is too limited.
 * However, keep in mind that smaller batch sample sizes and faster rates will drastically impact the battery life of both the Pebble and phone because of the taxing use of the processors and Bluetooth modules.
 * @typedef {object} simply.accelConf
 * @property {number} [rate] - The rate accelerometer data points are generated in hertz. Valid values are 10, 25, 50, and 100. Initializes as 100.
 * @property {number} [samples] - The number of accelerometer data points to accumulate in a batch before calling the event handler. Valid values are 1 to 25 inclusive. Initializes as 25.
 * @property {boolean} [subscribe] - Whether to subscribe to accelerometer data events. {@link simply.accelPeek} cannot be used when subscribed. Simply.js will automatically (un)subscribe for you depending on the amount of accelData handlers registered.
 */

/**
 * Changes the accelerometer configuration.
 * See {@link simply.accelConfig}
 * @memberOf simply
 * @param {simply.accelConfig} accelConf - An object defining the accelerometer configuration.
 */
simply.accelConfig = function(opt, auto) {
  var accelState = state.accel;
  if (typeof opt === 'undefined') {
    return {
      rate: accelState.rate,
      samples: accelState.samples,
      subscribe: accelState.subscribe,
    };
  } else if (typeof opt === 'boolean') {
    opt = { subscribe: opt };
  }
  for (var k in opt) {
    if (k === 'subscribe') {
      accelState.subscribeMode = opt[k] && !auto ? 'manual' : 'auto';
    }
    accelState[k] = opt[k];
  }
  return simply.impl.accelConfig.apply(this, arguments);
};

/**
 * Peeks at the current accelerometer values.
 * @memberOf simply
 * @param {simply.eventHandler} callback - A callback function that will be provided the accel data point as an event.
 */
simply.accelPeek = function(callback) {
  if (state.accel.subscribe) {
    throw new Error('Cannot use accelPeek when listening to accelData events');
  }
  return simply.impl.accelPeek.apply(this, arguments);
};

simply.menu = function(menuDef) {
  var menu = state.menu;
  if (arguments.length === 0) {
    return menu;
  }
  if (this instanceof Menu) {
    menu = this;
  } else if (menuDef instanceof Menu) {
    menu = menuDef;
  } else {
    menu = new Menu(menuDef);
  }
  if (menu !== state.menu) {
    menu = setWindow(menu, 'menu');
    util2.copy(menu.state, menuDef);
  }
  menu._resolveMenu();
  state.menu = menu;
  return simply.impl.menu(menu.state);
};

/**
 * Simply.js event. See all the possible event types. Subscribe to events using {@link simply.on}.
 * @typedef simply.event
 * @see simply.clickEvent
 * @see simply.accelTapEvent
 * @see simply.accelDataEvent
 */

/**
 * Simply.js button click event. This can either be a single click or long click.
 * Use the event type 'singleClick' or 'longClick' to subscribe to these events.
 * @typedef simply.clickEvent
 * @property {string} button - The button that was pressed: 'back', 'up', 'select', or 'down'. This is also the event subtype.
 */

simply.emitCard = function(type, subtype, e, globalType) {
  var card = e.card = state.card;
  if (card && card.emit(type, subtype, e) === false) {
    return false;
  }
  if (globalType) {
    return simply.emit(globalType, subtype, e);
  }
};

simply.emitClick = function(type, button) {
  var e = {
    button: button,
  };
  return simply.emitCard(type, button, e);
};

/**
 * Simply.js accel tap event.
 * Use the event type 'accelTap' to subscribe to these events.
 * @typedef simply.accelTapEvent
 * @property {string} axis - The axis the tap event occurred on: 'x', 'y', or 'z'. This is also the event subtype.
 * @property {number} direction - The direction of the tap along the axis: 1 or -1.
 */

simply.emitAccelTap = function(axis, direction) {
  var e = {
    axis: axis,
    direction: direction,
  };
  return simply.emitCard('accelTap', axis, e, 'accelTap');
};

/**
 * Simply.js accel data point.
 * Typical values for gravity is around -1000 on the z axis.
 * @typedef simply.accelPoint
 * @property {number} x - The acceleration across the x-axis.
 * @property {number} y - The acceleration across the y-axis.
 * @property {number} z - The acceleration across the z-axis.
 * @property {boolean} vibe - Whether the watch was vibrating when measuring this point.
 * @property {number} time - The amount of ticks in millisecond resolution when measuring this point.
 */

/**
 * Simply.js accel data event.
 * Use the event type 'accelData' to subscribe to these events.
 * @typedef simply.accelDataEvent
 * @property {number} samples - The number of accelerometer samples in this event.
 * @property {simply.accelPoint} accel - The first accel in the batch. This is provided for convenience.
 * @property {simply.accelPoint[]} accels - The accelerometer samples in an array.
 */

simply.emitAccelData = function(accels, callback) {
  var e = {
    samples: accels.length,
    accel: accels[0],
    accels: accels,
  };
  if (callback) {
    return callback(e);
  }
  return simply.emitCard('accelData', null, e, 'accelData');
};

simply.emitMenu = function(type, subtype, e, globalType) {
  var menu = e.menu = state.menu;
  if (menu && menu.emit(type, subtype, e) === false) {
    return false;
  }
  if (globalType) {
    return simply.emit(globalType, subtype, e);
  }
};

simply.emitMenuSection = function(section) {
  var menu = state.menu;
  var e = {
    menu: menu,
    section: section
  };
  if (simply.emitMenu('section', null, e) === false) {
    return false;
  }
  if (menu) {
    menu._resolveSection(e);
  }
};

simply.emitMenuItem = function(section, item) {
  var menu = state.menu;
  var e = {
    menu: menu,
    section: section,
    item: item,
  };
  if (simply.emitMenu('item', null, e) === false) {
    return false;
  }
  if (menu) {
    menu._resolveItem(e);
  }
};

simply.emitMenuSelect = function(type, section, item) {
  var menu = state.menu;
  var e = {
    menu: menu,
    section: section,
    item: item,
  };
  switch (type) {
    case 'menuSelect': type = 'select'; break;
    case 'menuLongSelect': type = 'longSelect'; break;
  }
  if (simply.emitMenu(type, null, e) === false) {
    return false;
  }
  if (menu) {
    menu._emitSelect(e);
  }
};

Pebble.require = require;
window.require = simply.require;
