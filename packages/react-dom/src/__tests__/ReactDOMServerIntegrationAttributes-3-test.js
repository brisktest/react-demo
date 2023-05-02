/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment ./scripts/jest/ReactDOMServerIntegrationEnvironment
 */

'use strict';

const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');
const ReactFeatureFlags = require('shared/ReactFeatureFlags');

let React;
let ReactDOM;
let ReactTestUtils;
let ReactDOMServer;

function initModules() {
  // Reset warning cache.
  jest.resetModules();
  React = require('react');
  ReactDOM = require('react-dom');
  ReactDOMServer = require('react-dom/server');
  ReactTestUtils = require('react-dom/test-utils');

  // Make them available to the helpers.
  return {
    ReactDOM,
    ReactDOMServer,
    ReactTestUtils,
  };
}

const {resetModules, itRenders, clientCleanRender} =
  ReactDOMServerIntegrationUtils(initModules);

describe('ReactDOMServerIntegration', () => {
  beforeEach(() => {
    resetModules();
  });

  // These tests mostly verify the existing behavior.
  // It may not always make sense but we can't change it in minors.
  describe('custom elements', () => {
    itRenders('class for custom elements', async render => {
      const e = await render(<div is="custom-element" class="test" />, 0);
      expect(e.getAttribute('class')).toBe('test');
    });

    itRenders('className for is elements', async render => {
      const e = await render(<div is="custom-element" className="test" />, 0);
      expect(e.getAttribute('className')).toBe(null);
      expect(e.getAttribute('class')).toBe('test');
    });

    itRenders('className for custom elements', async render => {
      const e = await render(<custom-element className="test" />, 0);
      if (ReactFeatureFlags.enableCustomElementPropertySupport) {
        expect(e.getAttribute('className')).toBe(null);
        expect(e.getAttribute('class')).toBe('test');
      } else {
        expect(e.getAttribute('className')).toBe('test');
        expect(e.getAttribute('class')).toBe(null);
      }
    });

    itRenders('htmlFor property on is elements', async render => {
      const e = await render(<div is="custom-element" htmlFor="test" />);
      expect(e.getAttribute('htmlFor')).toBe(null);
      expect(e.getAttribute('for')).toBe('test');
    });

    itRenders('htmlFor attribute on custom elements', async render => {
      const e = await render(<custom-element htmlFor="test" />);
      expect(e.getAttribute('htmlFor')).toBe('test');
      expect(e.getAttribute('for')).toBe(null);
    });

    itRenders('for attribute on custom elements', async render => {
      const e = await render(<div is="custom-element" for="test" />);
      expect(e.getAttribute('htmlFor')).toBe(null);
      expect(e.getAttribute('for')).toBe('test');
    });

    itRenders('unknown attributes for custom elements', async render => {
      const e = await render(<custom-element foo="bar" />);
      expect(e.getAttribute('foo')).toBe('bar');
    });

    itRenders('unknown `on*` attributes for custom elements', async render => {
      const e = await render(<custom-element onunknown="bar" />);
      expect(e.getAttribute('onunknown')).toBe('bar');
    });

    itRenders('unknown boolean `true` attributes as strings', async render => {
      const e = await render(<custom-element foo={true} />);
      if (ReactFeatureFlags.enableCustomElementPropertySupport) {
        expect(e.getAttribute('foo')).toBe('');
      } else {
        expect(e.getAttribute('foo')).toBe('true');
      }
    });

    itRenders('unknown boolean `false` attributes as strings', async render => {
      const e = await render(<custom-element foo={false} />);
      if (ReactFeatureFlags.enableCustomElementPropertySupport) {
        expect(e.getAttribute('foo')).toBe(null);
      } else {
        expect(e.getAttribute('foo')).toBe('false');
      }
    });

    itRenders(
      'no unknown attributes for custom elements with null value',
      async render => {
        const e = await render(<custom-element foo={null} />);
        expect(e.hasAttribute('foo')).toBe(false);
      },
    );

    itRenders(
      'unknown attributes for custom elements using is',
      async render => {
        const e = await render(<div is="custom-element" foo="bar" />);
        expect(e.getAttribute('foo')).toBe('bar');
      },
    );

    itRenders(
      'no unknown attributes for custom elements using is with null value',
      async render => {
        const e = await render(<div is="custom-element" foo={null} />);
        expect(e.hasAttribute('foo')).toBe(false);
      },
    );
  });
});
