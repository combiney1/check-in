// input: document
// output: CK.dom — h() element builder (text-only, no innerHTML), $(), clear(), hhmm()
// pos: UI utility layer; all guest data is rendered through textContent to avoid HTML injection
// Once I am updated, update my header comments and my folder's md doc.
(function (root) {
  'use strict';

  // Build an element: h('div', {class:'x', onclick: fn, dataset:{id}}, ['text', child]).
  function h(tag, props = {}, children = []) {
    const el = document.createElement(tag);
    Object.entries(props).forEach(([key, value]) => {
      if (value === null || value === undefined || value === false) return;
      if (key === 'class') el.className = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (key in el && typeof value !== 'string') el[key] = value;
      else el.setAttribute(key, value === true ? '' : String(value));
    });
    [].concat(children).forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return el;
  }

  function $(selector, scope = document) {
    return scope.querySelector(selector);
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  function hhmm(ms) {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  root.CK = Object.assign(root.CK || {}, { dom: { h, $, clear, hhmm } });
})(self);
