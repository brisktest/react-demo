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
  describe('property to attribute mapping', function () {
    describe('string properties', function () {
      itRenders('simple numbers', async render => {
          const e = await render(<div width={30} />);
          expect(e.getAttribute('width')).toBe('30');
      });

      itRenders('simple strings', async render => {
          const e = await render(<div width={'30'} />);
          expect(e.getAttribute('width')).toBe('30');
      });

      itRenders('no string prop with true value', async render => {
          const e = await render(<a href={true} />, 1);
          expect(e.hasAttribute('href')).toBe(false);
      });

      itRenders('no string prop with false value', async render => {
          const e = await render(<a href={false} />, 1);
          expect(e.hasAttribute('href')).toBe(false);
      });

      itRenders('no string prop with null value', async render => {
          const e = await render(<div width={null} />);
          expect(e.hasAttribute('width')).toBe(false);
      });

      itRenders('no string prop with function value', async render => {
          const e = await render(<div width={function () { }} />, 1);
          expect(e.hasAttribute('width')).toBe(false);
      });

      itRenders('no string prop with symbol value', async render => {
          const e = await render(<div width={Symbol('foo')} />, 1);
          expect(e.hasAttribute('width')).toBe(false);
      });
  });

  describe('boolean properties', function () {
      itRenders('boolean prop with true value', async render => {
          const e = await render(<div hidden={true} />);
          expect(e.getAttribute('hidden')).toBe('');
      });

      itRenders('boolean prop with false value', async render => {
          const e = await render(<div hidden={false} />);
          expect(e.getAttribute('hidden')).toBe(null);
      });

      itRenders('boolean prop with self value', async render => {
          const e = await render(<div hidden="hidden" />);
          expect(e.getAttribute('hidden')).toBe('');
      });

      // this does not seem like correct behavior, since hidden="" in HTML indicates
      // that the boolean property is present. however, it is how the current code
      // behaves, so the test is included here.
      itRenders('boolean prop with "" value', async render => {
          const e = await render(<div hidden="" />);
          expect(e.getAttribute('hidden')).toBe(null);
      });

      // this seems like it might mask programmer error, but it's existing behavior.
      itRenders('boolean prop with string value', async render => {
          const e = await render(<div hidden="foo" />);
          expect(e.getAttribute('hidden')).toBe('');
      });

      // this seems like it might mask programmer error, but it's existing behavior.
      itRenders('boolean prop with array value', async render => {
          const e = await render(<div hidden={['foo', 'bar']} />);
          expect(e.getAttribute('hidden')).toBe('');
      });

      // this seems like it might mask programmer error, but it's existing behavior.
      itRenders('boolean prop with object value', async render => {
          const e = await render(<div hidden={{ foo: 'bar' }} />);
          expect(e.getAttribute('hidden')).toBe('');
      });

      // this seems like it might mask programmer error, but it's existing behavior.
      itRenders('boolean prop with non-zero number value', async render => {
          const e = await render(<div hidden={10} />);
          expect(e.getAttribute('hidden')).toBe('');
      });

      // this seems like it might mask programmer error, but it's existing behavior.
      itRenders('boolean prop with zero value', async render => {
          const e = await render(<div hidden={0} />);
          expect(e.getAttribute('hidden')).toBe(null);
      });

      itRenders('no boolean prop with null value', async render => {
          const e = await render(<div hidden={null} />);
          expect(e.hasAttribute('hidden')).toBe(false);
      });

      itRenders('no boolean prop with function value', async render => {
          const e = await render(<div hidden={function () { }} />, 1);
          expect(e.hasAttribute('hidden')).toBe(false);
      });

      itRenders('no boolean prop with symbol value', async render => {
          const e = await render(<div hidden={Symbol('foo')} />, 1);
          expect(e.hasAttribute('hidden')).toBe(false);
      });
  });

  describe('download property (combined boolean/string attribute)', function () {
      itRenders('download prop with true value', async render => {
          const e = await render(<a download={true} />);
          expect(e.getAttribute('download')).toBe('');
      });

      itRenders('download prop with false value', async render => {
          const e = await render(<a download={false} />);
          expect(e.getAttribute('download')).toBe(null);
      });

      itRenders('download prop with string value', async render => {
          const e = await render(<a download="myfile" />);
          expect(e.getAttribute('download')).toBe('myfile');
      });

      itRenders('download prop with string "false" value', async render => {
          const e = await render(<a download="false" />);
          expect(e.getAttribute('download')).toBe('false');
      });

      itRenders('download prop with string "true" value', async render => {
          const e = await render(<a download={'true'} />);
          expect(e.getAttribute('download')).toBe('true');
      });

      itRenders('download prop with number 0 value', async render => {
          const e = await render(<a download={0} />);
          expect(e.getAttribute('download')).toBe('0');
      });

      itRenders('no download prop with null value', async render => {
          const e = await render(<div download={null} />);
          expect(e.hasAttribute('download')).toBe(false);
      });

      itRenders('no download prop with undefined value', async render => {
          const e = await render(<div download={undefined} />);
          expect(e.hasAttribute('download')).toBe(false);
      });

      itRenders('no download prop with function value', async render => {
          const e = await render(<div download={function () { }} />, 1);
          expect(e.hasAttribute('download')).toBe(false);
      });

      itRenders('no download prop with symbol value', async render => {
          const e = await render(<div download={Symbol('foo')} />, 1);
          expect(e.hasAttribute('download')).toBe(false);
      });
  });

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
