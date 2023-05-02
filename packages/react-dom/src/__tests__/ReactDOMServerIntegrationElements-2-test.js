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

const TEXT_NODE_TYPE = 3;

let React;
let ReactDOM;
let ReactDOMServer;
let ReactTestUtils;

function initModules() {
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

const {
  resetModules,
  itRenders,
  itThrowsWhenRendering,
  serverRender,
  streamRender,
  clientCleanRender,
  clientRenderOnServerString,
} = ReactDOMServerIntegrationUtils(initModules);

describe('ReactDOMServerIntegration', () => {
  beforeEach(() => {
    resetModules();
  });

  describe('elements and children', function () {
    function expectNode(node, type, value) {
      expect(node).not.toBe(null);
      expect(node.nodeType).toBe(type);
      expect(node.nodeValue).toMatch(value);
    }

    function expectTextNode(node, text) {
      expectNode(node, TEXT_NODE_TYPE, text);
    }

    itRenders('a div with dangerouslySetInnerHTML number', async render => {
      // Put dangerouslySetInnerHTML one level deeper because otherwise
      // hydrating from a bad markup would cause a mismatch (since we don't
      // patch dangerouslySetInnerHTML as text content).
      const e = (
        await render(
          <div>
            <span dangerouslySetInnerHTML={{__html: 0}} />
          </div>,
        )
      ).firstChild;
      expect(e.childNodes.length).toBe(1);
      expect(e.firstChild.nodeType).toBe(TEXT_NODE_TYPE);
      expect(e.textContent).toBe('0');
    });

    itRenders('a div with dangerouslySetInnerHTML boolean', async render => {
      // Put dangerouslySetInnerHTML one level deeper because otherwise
      // hydrating from a bad markup would cause a mismatch (since we don't
      // patch dangerouslySetInnerHTML as text content).
      const e = (
        await render(
          <div>
            <span dangerouslySetInnerHTML={{__html: false}} />
          </div>,
        )
      ).firstChild;
      expect(e.childNodes.length).toBe(1);
      expect(e.firstChild.nodeType).toBe(TEXT_NODE_TYPE);
      expect(e.firstChild.data).toBe('false');
    });

    itRenders(
      'a div with dangerouslySetInnerHTML text string',
      async render => {
        // Put dangerouslySetInnerHTML one level deeper because otherwise
        // hydrating from a bad markup would cause a mismatch (since we don't
        // patch dangerouslySetInnerHTML as text content).
        const e = (
          await render(
            <div>
              <span dangerouslySetInnerHTML={{__html: 'hello'}} />
            </div>,
          )
        ).firstChild;
        expect(e.childNodes.length).toBe(1);
        expect(e.firstChild.nodeType).toBe(TEXT_NODE_TYPE);
        expect(e.textContent).toBe('hello');
      },
    );

    itRenders(
      'a div with dangerouslySetInnerHTML element string',
      async render => {
        const e = await render(
          <div dangerouslySetInnerHTML={{__html: "<span id='child'/>"}} />,
        );
        expect(e.childNodes.length).toBe(1);
        expect(e.firstChild.tagName).toBe('SPAN');
        expect(e.firstChild.getAttribute('id')).toBe('child');
        expect(e.firstChild.childNodes.length).toBe(0);
      },
    );

    itRenders('a div with dangerouslySetInnerHTML object', async render => {
      const obj = {
        toString() {
          return "<span id='child'/>";
        },
      };
      const e = await render(<div dangerouslySetInnerHTML={{__html: obj}} />);
      expect(e.childNodes.length).toBe(1);
      expect(e.firstChild.tagName).toBe('SPAN');
      expect(e.firstChild.getAttribute('id')).toBe('child');
      expect(e.firstChild.childNodes.length).toBe(0);
    });

    itRenders(
      'a div with dangerouslySetInnerHTML set to null',
      async render => {
        const e = await render(
          <div dangerouslySetInnerHTML={{__html: null}} />,
        );
        expect(e.childNodes.length).toBe(0);
      },
    );

    itRenders(
      'a div with dangerouslySetInnerHTML set to undefined',
      async render => {
        const e = await render(
          <div dangerouslySetInnerHTML={{__html: undefined}} />,
        );
        expect(e.childNodes.length).toBe(0);
      },
    );

    itRenders('a noscript with children', async render => {
      const e = await render(
        <noscript>
          <div>Enable JavaScript to run this app.</div>
        </noscript>,
      );
      if (render === clientCleanRender) {
        // On the client we ignore the contents of a noscript
        expect(e.childNodes.length).toBe(0);
      } else {
        // On the server or when hydrating the content should be correct
        expect(e.childNodes.length).toBe(1);
        expect(e.firstChild.textContent).toBe(
          '<div>Enable JavaScript to run this app.</div>',
        );
      }
    });

  });
});
