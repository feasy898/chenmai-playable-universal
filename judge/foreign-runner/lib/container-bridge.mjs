/**
 * Container bridge stub (三层钩子之一/二：全局函数 + 属性描述符).
 *
 * 注入方式：page.addInitScript({ content: bridgeSource() })。
 * 作用：在宿主容器环境缺失时，为外来广告提供 instrumented 桩；
 *      记录退出调用并抑制导航，不阻止页面继续运行。
 */

export function bridgeSource() {
  return `
(function() {
  window.__exit_api_log = window.__exit_api_log || [];
  window.__exit_api_hit_counts = window.__exit_api_hit_counts || { mraid: 0, fbplayable: 0, exitapi: 0, openappstore: 0, implicit_store_nav: 0 };

  function record(cls, api, detail) {
    window.__exit_api_log.push({
      api: api,
      cls: cls,
      t_ms: performance.now(),
      url: window.location.href,
      arg_count: detail ? (detail.args ? detail.args.length : 0) : 0,
      suppressed_navigation: true,
      provenance: 'fixture'
    });
    window.__exit_api_hit_counts[cls] = (window.__exit_api_hit_counts[cls] || 0) + 1;
  }

  window.openAppStore = function (...args) {
    record('openappstore', 'openAppStore', { args });
    return undefined;
  };

  var mraidDesc = Object.getOwnPropertyDescriptor(window, 'mraid');
  if (!mraidDesc || mraidDesc.value === undefined) {
    Object.defineProperty(window, 'mraid', {
      value: { open: function (...args) { record('mraid', 'mraid.open', { args }); } },
      writable: true,
      configurable: true
    });
  } else if (mraidDesc.value && typeof mraidDesc.value.open === 'function') {
    var orig = mraidDesc.value.open.bind(mraidDesc.value);
    mraidDesc.value.open = function (...args) { record('mraid', 'mraid.open', { args }); return orig(...args); };
    Object.defineProperty(window, 'mraid', mraidDesc);
  }

  var fbDesc = Object.getOwnPropertyDescriptor(window, 'FbPlayableAd');
  if (!fbDesc || fbDesc.value === undefined) {
    Object.defineProperty(window, 'FbPlayableAd', {
      value: {},
      writable: true,
      configurable: true
    });
  }
  var fb = window.FbPlayableAd || {};
  var fbProxy = new Proxy(fb, {
    get: function(target, prop) {
      if (typeof prop === 'string' && prop.startsWith('open')) {
        return function (...args) {
          record('fbplayable', 'FbPlayableAd.' + prop, { args });
        };
      }
      var val = target[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    }
  });
  Object.defineProperty(window, 'FbPlayableAd', {
    value: fbProxy,
    writable: true,
    configurable: true
  });

  var exitDesc = Object.getOwnPropertyDescriptor(window, 'ExitApi');
  if (!exitDesc || exitDesc.value === undefined) {
    Object.defineProperty(window, 'ExitApi', {
      value: { exit: function () { record('exitapi', 'ExitApi.exit', {}); } },
      writable: true,
      configurable: true
    });
  } else if (exitDesc.value && typeof exitDesc.value.exit === 'function') {
    var origExit = exitDesc.value.exit.bind(exitDesc.value);
    exitDesc.value.exit = function (...args) { record('exitapi', 'ExitApi.exit', { args }); return origExit(...args); };
    Object.defineProperty(window, 'ExitApi', exitDesc);
  }

  var origPush = history.pushState.bind(history);
  var origReplace = history.replaceState.bind(history);
  var origAssign = location.assign.bind(location);

  history.pushState = function (...args) {
    try {
      var url = typeof args[2] === 'string' ? args[2] : '';
      if (url && (url.indexOf('market://') !== -1 || url.indexOf('app-store') !== -1 || url.indexOf('itunes.apple.com') !== -1)) {
        window.__exit_api_hit_counts.implicit_store_nav += 1;
        return;
      }
    } catch {}
    return origPush(...args);
  };
  history.replaceState = function (...args) {
    try {
      var url = typeof args[2] === 'string' ? args[2] : '';
      if (url && (url.indexOf('market://') !== -1 || url.indexOf('app-store') !== -1 || url.indexOf('itunes.apple.com') !== -1)) {
        window.__exit_api_hit_counts.implicit_store_nav += 1;
        return;
      }
    } catch {}
    return origReplace(...args);
  };
  location.assign = function (url) {
    if (typeof url === 'string' && (url.indexOf('market://') !== -1 || url.indexOf('app-store') !== -1 || url.indexOf('itunes.apple.com') !== -1)) {
      window.__exit_api_hit_counts.implicit_store_nav += 1;
      return undefined;
    }
    return origAssign(url);
  };
})();
`;
}
