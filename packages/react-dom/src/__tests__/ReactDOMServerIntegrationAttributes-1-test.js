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
        const e = await render(<div width={function () {}} />, 1);
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
        const e = await render(<div hidden={{foo: 'bar'}} />);
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
        const e = await render(<div hidden={function () {}} />, 1);
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
        const e = await render(<div download={function () {}} />, 1);
        expect(e.hasAttribute('download')).toBe(false);
      });

      itRenders('no download prop with symbol value', async render => {
        const e = await render(<div download={Symbol('foo')} />, 1);
        expect(e.hasAttribute('download')).toBe(false);
      });
    });

    describe('className property', function () {
      itRenders('className prop with string value', async render => {
        const e = await render(<div className="myClassName" />);
        expect(e.getAttribute('class')).toBe('myClassName');
      });

      itRenders('className prop with empty string value', async render => {
        const e = await render(<div className="" />);
        expect(e.getAttribute('class')).toBe('');
      });

      itRenders('no className prop with true value', async render => {
        const e = await render(<div className={true} />, 1);
        expect(e.hasAttribute('class')).toBe(false);
      });

      itRenders('no className prop with false value', async render => {
        const e = await render(<div className={false} />, 1);
        expect(e.hasAttribute('class')).toBe(false);
      });

      itRenders('no className prop with null value', async render => {
        const e = await render(<div className={null} />);
        expect(e.hasAttribute('className')).toBe(false);
      });

      itRenders('badly cased className with a warning', async render => {
        const e = await render(<div classname="test" />, 1);
        expect(e.hasAttribute('class')).toBe(false);
        expect(e.hasAttribute('classname')).toBe(true);
      });

      itRenders(
        'className prop when given the alias with a warning',
        async render => {
          const e = await render(<div class="test" />, 1);
          expect(e.className).toBe('test');
        },
      );

      itRenders(
        'className prop when given a badly cased alias',
        async render => {
          const e = await render(<div cLASs="test" />, 1);
          expect(e.className).toBe('test');
        },
      );
    });

 

  });


});
