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

    describe('newline-eating elements', function () {
        itRenders(
          'a newline-eating tag with content not starting with \\n',
          async render => {
            const e = await render(<pre>Hello</pre>);
            expect(e.textContent).toBe('Hello');
          },
        );
        itRenders(
          'a newline-eating tag with content starting with \\n',
          async render => {
            const e = await render(<pre>{'\nHello'}</pre>);
            expect(e.textContent).toBe('\nHello');
          },
        );
        itRenders('a normal tag with content starting with \\n', async render => {
          const e = await render(<div>{'\nHello'}</div>);
          expect(e.textContent).toBe('\nHello');
        });
      });
  
      describe('different component implementations', function () {
        function checkFooDiv(e) {
          expect(e.childNodes.length).toBe(1);
          expectNode(e.firstChild, TEXT_NODE_TYPE, 'foo');
        }
  
        itRenders('stateless components', async render => {
          const FunctionComponent = () => <div>foo</div>;
          checkFooDiv(await render(<FunctionComponent />));
        });
  
        itRenders('ES6 class components', async render => {
          class ClassComponent extends React.Component {
            render() {
              return <div>foo</div>;
            }
          }
          checkFooDiv(await render(<ClassComponent />));
        });
  
        if (require('shared/ReactFeatureFlags').disableModulePatternComponents) {
          itThrowsWhenRendering(
            'factory components',
            async render => {
              const FactoryComponent = () => {
                return {
                  render: function () {
                    return <div>foo</div>;
                  },
                };
              };
              await render(<FactoryComponent />, 1);
            },
            'Objects are not valid as a React child (found: object with keys {render})',
          );
        } else {
          itRenders('factory components', async render => {
            const FactoryComponent = () => {
              return {
                render: function () {
                  return <div>foo</div>;
                },
              };
            };
            checkFooDiv(await render(<FactoryComponent />, 1));
          });
        }
      });
  
      describe('component hierarchies', function () {
        itRenders('single child hierarchies of components', async render => {
          const Component = props => <div>{props.children}</div>;
          let e = await render(
            <Component>
              <Component>
                <Component>
                  <Component />
                </Component>
              </Component>
            </Component>,
          );
          for (let i = 0; i < 3; i++) {
            expect(e.tagName).toBe('DIV');
            expect(e.childNodes.length).toBe(1);
            e = e.firstChild;
          }
          expect(e.tagName).toBe('DIV');
          expect(e.childNodes.length).toBe(0);
        });
  
        itRenders('multi-child hierarchies of components', async render => {
          const Component = props => <div>{props.children}</div>;
          const e = await render(
            <Component>
              <Component>
                <Component />
                <Component />
              </Component>
              <Component>
                <Component />
                <Component />
              </Component>
            </Component>,
          );
          expect(e.tagName).toBe('DIV');
          expect(e.childNodes.length).toBe(2);
          for (let i = 0; i < 2; i++) {
            const child = e.childNodes[i];
            expect(child.tagName).toBe('DIV');
            expect(child.childNodes.length).toBe(2);
            for (let j = 0; j < 2; j++) {
              const grandchild = child.childNodes[j];
              expect(grandchild.tagName).toBe('DIV');
              expect(grandchild.childNodes.length).toBe(0);
            }
          }
        });
  
        itRenders('a div with a child', async render => {
          const e = await render(
            <div id="parent">
              <div id="child" />
            </div>,
          );
          expect(e.id).toBe('parent');
          expect(e.childNodes.length).toBe(1);
          expect(e.childNodes[0].id).toBe('child');
          expect(e.childNodes[0].childNodes.length).toBe(0);
        });
  
        itRenders('a div with multiple children', async render => {
          const e = await render(
            <div id="parent">
              <div id="child1" />
              <div id="child2" />
            </div>,
          );
          expect(e.id).toBe('parent');
          expect(e.childNodes.length).toBe(2);
          expect(e.childNodes[0].id).toBe('child1');
          expect(e.childNodes[0].childNodes.length).toBe(0);
          expect(e.childNodes[1].id).toBe('child2');
          expect(e.childNodes[1].childNodes.length).toBe(0);
        });
  
        itRenders(
          'a div with multiple children separated by whitespace',
          async render => {
            const e = await render(
              <div id="parent">
                <div id="child1" /> <div id="child2" />
              </div>,
            );
            expect(e.id).toBe('parent');
            expect(e.childNodes.length).toBe(3);
            const child1 = e.childNodes[0];
            const textNode = e.childNodes[1];
            const child2 = e.childNodes[2];
            expect(child1.id).toBe('child1');
            expect(child1.childNodes.length).toBe(0);
            expectTextNode(textNode, ' ');
            expect(child2.id).toBe('child2');
            expect(child2.childNodes.length).toBe(0);
          },
        );
  
        itRenders(
          'a div with a single child surrounded by whitespace',
          async render => {
            // prettier-ignore
            const e = await render(<div id="parent">  <div id="child" />   </div>); // eslint-disable-line no-multi-spaces
            expect(e.childNodes.length).toBe(3);
            const textNode1 = e.childNodes[0];
            const child = e.childNodes[1];
            const textNode2 = e.childNodes[2];
            expect(e.id).toBe('parent');
            expectTextNode(textNode1, '  ');
            expect(child.id).toBe('child');
            expect(child.childNodes.length).toBe(0);
            expectTextNode(textNode2, '   ');
          },
        );
  
        itRenders('a composite with multiple children', async render => {
          const Component = props => props.children;
          const e = await render(
            <Component>{['a', 'b', [undefined], [[false, 'c']]]}</Component>,
          );
  
          const parent = e.parentNode;
          if (
            render === serverRender ||
            render === clientRenderOnServerString ||
            render === streamRender
          ) {
            // For plain server markup result we have comments between.
            // If we're able to hydrate, they remain.
            expect(parent.childNodes.length).toBe(5);
            expectTextNode(parent.childNodes[0], 'a');
            expectTextNode(parent.childNodes[2], 'b');
            expectTextNode(parent.childNodes[4], 'c');
          } else {
            expect(parent.childNodes.length).toBe(3);
            expectTextNode(parent.childNodes[0], 'a');
            expectTextNode(parent.childNodes[1], 'b');
            expectTextNode(parent.childNodes[2], 'c');
          }
        });
      });
  
      describe('escaping >, <, and &', function () {
        itRenders('>,<, and & as single child', async render => {
          const e = await render(<div>{'<span>Text&quot;</span>'}</div>);
          expect(e.childNodes.length).toBe(1);
          expectNode(e.firstChild, TEXT_NODE_TYPE, '<span>Text&quot;</span>');
        });
  
        itRenders('>,<, and & as multiple children', async render => {
          const e = await render(
            <div>
              {'<span>Text1&quot;</span>'}
              {'<span>Text2&quot;</span>'}
            </div>,
          );
          if (
            render === serverRender ||
            render === clientRenderOnServerString ||
            render === streamRender
          ) {
            expect(e.childNodes.length).toBe(3);
            expectTextNode(e.childNodes[0], '<span>Text1&quot;</span>');
            expectTextNode(e.childNodes[2], '<span>Text2&quot;</span>');
          } else {
            expect(e.childNodes.length).toBe(2);
            expectTextNode(e.childNodes[0], '<span>Text1&quot;</span>');
            expectTextNode(e.childNodes[1], '<span>Text2&quot;</span>');
          }
        });
      });
  
      describe('carriage return and null character', () => {
        // HTML parsing normalizes CR and CRLF to LF.
        // It also ignores null character.
        // https://www.w3.org/TR/html5/single-page.html#preprocessing-the-input-stream
        // If we have a mismatch, it might be caused by that (and should not be reported).
        // We won't be patching up in this case as that matches our past behavior.
  
        itRenders(
          'an element with one text child with special characters',
          async render => {
            const e = await render(<div>{'foo\rbar\r\nbaz\nqux\u0000'}</div>);
            if (render === serverRender || render === streamRender) {
              expect(e.childNodes.length).toBe(1);
              // Everything becomes LF when parsed from server HTML.
              // Null character is ignored.
              expectNode(e.childNodes[0], TEXT_NODE_TYPE, 'foo\nbar\nbaz\nqux');
            } else {
              expect(e.childNodes.length).toBe(1);
              // Client rendering (or hydration) uses JS value with CR.
              // Null character stays.
              expectNode(
                e.childNodes[0],
                TEXT_NODE_TYPE,
                'foo\rbar\r\nbaz\nqux\u0000',
              );
            }
          },
        );
  
        itRenders(
          'an element with two text children with special characters',
          async render => {
            const e = await render(
              <div>
                {'foo\rbar'}
                {'\r\nbaz\nqux\u0000'}
              </div>,
            );
            if (render === serverRender || render === streamRender) {
              // We have three nodes because there is a comment between them.
              expect(e.childNodes.length).toBe(3);
              // Everything becomes LF when parsed from server HTML.
              // Null character is ignored.
              expectNode(e.childNodes[0], TEXT_NODE_TYPE, 'foo\nbar');
              expectNode(e.childNodes[2], TEXT_NODE_TYPE, '\nbaz\nqux');
            } else if (render === clientRenderOnServerString) {
              // We have three nodes because there is a comment between them.
              expect(e.childNodes.length).toBe(3);
              // Hydration uses JS value with CR and null character.
              expectNode(e.childNodes[0], TEXT_NODE_TYPE, 'foo\rbar');
              expectNode(e.childNodes[2], TEXT_NODE_TYPE, '\r\nbaz\nqux\u0000');
            } else {
              expect(e.childNodes.length).toBe(2);
              // Client rendering uses JS value with CR and null character.
              expectNode(e.childNodes[0], TEXT_NODE_TYPE, 'foo\rbar');
              expectNode(e.childNodes[1], TEXT_NODE_TYPE, '\r\nbaz\nqux\u0000');
            }
          },
        );
  
        itRenders(
          'an element with an attribute value with special characters',
          async render => {
            const e = await render(<a title={'foo\rbar\r\nbaz\nqux\u0000'} />);
            if (
              render === serverRender ||
              render === streamRender ||
              render === clientRenderOnServerString
            ) {
              // Everything becomes LF when parsed from server HTML.
              // Null character in an attribute becomes the replacement character.
              // Hydration also ends up with LF because we don't patch up attributes.
              expect(e.title).toBe('foo\nbar\nbaz\nqux\uFFFD');
            } else {
              // Client rendering uses JS value with CR and null character.
              expect(e.title).toBe('foo\rbar\r\nbaz\nqux\u0000');
            }
          },
        );
      });
  
      describe('components that render nullish', function () {
        itRenders('a function returning null', async render => {
          const NullComponent = () => null;
          await render(<NullComponent />);
        });
  
        itRenders('a class returning null', async render => {
          class NullComponent extends React.Component {
            render() {
              return null;
            }
          }
          await render(<NullComponent />);
        });
  
        itRenders('a function returning undefined', async render => {
          const UndefinedComponent = () => undefined;
          await render(<UndefinedComponent />);
        });
  
        itRenders('a class returning undefined', async render => {
          class UndefinedComponent extends React.Component {
            render() {
              return undefined;
            }
          }
          await render(<UndefinedComponent />);
        });
      });
  
      describe('components that throw errors', function () {
        itThrowsWhenRendering(
          'a function returning an object',
          async render => {
            const ObjectComponent = () => ({x: 123});
            await render(<ObjectComponent />, 1);
          },
          'Objects are not valid as a React child (found: object with keys {x}).' +
            (__DEV__
              ? ' If you meant to render a collection of children, use ' +
                'an array instead.'
              : ''),
        );
  
        itThrowsWhenRendering(
          'a class returning an object',
          async render => {
            class ObjectComponent extends React.Component {
              render() {
                return {x: 123};
              }
            }
            await render(<ObjectComponent />, 1);
          },
          'Objects are not valid as a React child (found: object with keys {x}).' +
            (__DEV__
              ? ' If you meant to render a collection of children, use ' +
                'an array instead.'
              : ''),
        );
  
        itThrowsWhenRendering(
          'top-level object',
          async render => {
            await render({x: 123});
          },
          'Objects are not valid as a React child (found: object with keys {x}).' +
            (__DEV__
              ? ' If you meant to render a collection of children, use ' +
                'an array instead.'
              : ''),
        );
      });
  
      describe('badly-typed elements', function () {
        itThrowsWhenRendering(
          'object',
          async render => {
            let EmptyComponent = {};
            expect(() => {
              EmptyComponent = <EmptyComponent />;
            }).toErrorDev(
              'Warning: React.createElement: type is invalid -- expected a string ' +
                '(for built-in components) or a class/function (for composite ' +
                'components) but got: object. You likely forgot to export your ' +
                "component from the file it's defined in, or you might have mixed up " +
                'default and named imports.',
              {withoutStack: true},
            );
            await render(EmptyComponent);
          },
          'Element type is invalid: expected a string (for built-in components) or a class/function ' +
            '(for composite components) but got: object.' +
            (__DEV__
              ? " You likely forgot to export your component from the file it's defined in, " +
                'or you might have mixed up default and named imports.'
              : ''),
        );
  
        itThrowsWhenRendering(
          'null',
          async render => {
            let NullComponent = null;
            expect(() => {
              NullComponent = <NullComponent />;
            }).toErrorDev(
              'Warning: React.createElement: type is invalid -- expected a string ' +
                '(for built-in components) or a class/function (for composite ' +
                'components) but got: null.',
              {withoutStack: true},
            );
            await render(NullComponent);
          },
          'Element type is invalid: expected a string (for built-in components) or a class/function ' +
            '(for composite components) but got: null',
        );
  
        itThrowsWhenRendering(
          'undefined',
          async render => {
            let UndefinedComponent = undefined;
            expect(() => {
              UndefinedComponent = <UndefinedComponent />;
            }).toErrorDev(
              'Warning: React.createElement: type is invalid -- expected a string ' +
                '(for built-in components) or a class/function (for composite ' +
                'components) but got: undefined. You likely forgot to export your ' +
                "component from the file it's defined in, or you might have mixed up " +
                'default and named imports.',
              {withoutStack: true},
            );
  
            await render(UndefinedComponent);
          },
          'Element type is invalid: expected a string (for built-in components) or a class/function ' +
            '(for composite components) but got: undefined.' +
            (__DEV__
              ? " You likely forgot to export your component from the file it's defined in, " +
                'or you might have mixed up default and named imports.'
              : ''),
        );
      });
  });
});
