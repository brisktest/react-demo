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
import {
  insertNodesAndExecuteScripts,
  mergeOptions,
  withLoadingReadyState,
} from '../test-utils/FizzTestUtils';

let JSDOM;
let Stream;
let React;
let ReactDOM;
let ReactDOMClient;
let ReactDOMFizzServer;
let Suspense;
let textCache;
let loadCache;
let writable;
const CSPnonce = null;
let container;
let buffer = '';
let hasErrored = false;
let fatalError = undefined;
let renderOptions;
let waitForAll;
let waitForThrow;
let assertLog;
let Scheduler;
let clientAct;
let streamingContainer;

describe('ReactDOMFloat', () => {
  beforeEach(() => {
    jest.resetModules();
    JSDOM = require('jsdom').JSDOM;

    const jsdom = new JSDOM(
      '<!DOCTYPE html><html><head></head><body><div id="container">',
      {
        runScripts: 'dangerously',
      },
    );
    // We mock matchMedia. for simplicity it only matches 'all' or '' and misses everything else
    Object.defineProperty(jsdom.window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation(query => ({
        matches: query === 'all' || query === '',
        media: query,
      })),
    });
    streamingContainer = null;
    global.window = jsdom.window;
    global.document = global.window.document;
    global.navigator = global.window.navigator;
    global.Node = global.window.Node;
    global.addEventListener = global.window.addEventListener;
    global.MutationObserver = global.window.MutationObserver;
    container = document.getElementById('container');

    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ReactDOMFizzServer = require('react-dom/server');
    Stream = require('stream');
    Suspense = React.Suspense;
    Scheduler = require('scheduler/unstable_mock');

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    waitForThrow = InternalTestUtils.waitForThrow;
    assertLog = InternalTestUtils.assertLog;
    clientAct = InternalTestUtils.act;

    textCache = new Map();
    loadCache = new Set();

    buffer = '';
    hasErrored = false;

    writable = new Stream.PassThrough();
    writable.setEncoding('utf8');
    writable.on('data', chunk => {
      buffer += chunk;
    });
    writable.on('error', error => {
      hasErrored = true;
      fatalError = error;
    });

    renderOptions = {};
    if (gate(flags => flags.enableFizzExternalRuntime)) {
      renderOptions.unstable_externalRuntimeSrc =
        'react-dom/unstable_server-external-runtime';
    }
  });

  const bodyStartMatch = /<body(?:>| .*?>)/;
  const headStartMatch = /<head(?:>| .*?>)/;

  async function act(callback) {
    await callback();
    // Await one turn around the event loop.
    // This assumes that we'll flush everything we have so far.
    await new Promise(resolve => {
      setImmediate(resolve);
    });
    if (hasErrored) {
      throw fatalError;
    }
    // JSDOM doesn't support stream HTML parser so we need to give it a proper fragment.
    // We also want to execute any scripts that are embedded.
    // We assume that we have now received a proper fragment of HTML.
    let bufferedContent = buffer;
    buffer = '';

    if (!bufferedContent) {
      return;
    }

    await withLoadingReadyState(async () => {
      const bodyMatch = bufferedContent.match(bodyStartMatch);
      const headMatch = bufferedContent.match(headStartMatch);

      if (streamingContainer === null) {
        // This is the first streamed content. We decide here where to insert it. If we get <html>, <head>, or <body>
        // we abandon the pre-built document and start from scratch. If we get anything else we assume it goes into the
        // container. This is not really production behavior because you can't correctly stream into a deep div effectively
        // but it's pragmatic for tests.

        if (
          bufferedContent.startsWith('<head>') ||
          bufferedContent.startsWith('<head ') ||
          bufferedContent.startsWith('<body>') ||
          bufferedContent.startsWith('<body ')
        ) {
          // wrap in doctype to normalize the parsing process
          bufferedContent = '<!DOCTYPE html><html>' + bufferedContent;
        } else if (
          bufferedContent.startsWith('<html>') ||
          bufferedContent.startsWith('<html ')
        ) {
          throw new Error(
            'Recieved <html> without a <!DOCTYPE html> which is almost certainly a bug in React',
          );
        }

        if (bufferedContent.startsWith('<!DOCTYPE html>')) {
          // we can just use the whole document
          const tempDom = new JSDOM(bufferedContent);

          // Wipe existing head and body content
          document.head.innerHTML = '';
          document.body.innerHTML = '';

          // Copy the <html> attributes over
          const tempHtmlNode = tempDom.window.document.documentElement;
          for (let i = 0; i < tempHtmlNode.attributes.length; i++) {
            const attr = tempHtmlNode.attributes[i];
            document.documentElement.setAttribute(attr.name, attr.value);
          }

          if (headMatch) {
            // We parsed a head open tag. we need to copy head attributes and insert future
            // content into <head>
            streamingContainer = document.head;
            const tempHeadNode = tempDom.window.document.head;
            for (let i = 0; i < tempHeadNode.attributes.length; i++) {
              const attr = tempHeadNode.attributes[i];
              document.head.setAttribute(attr.name, attr.value);
            }
            const source = document.createElement('head');
            source.innerHTML = tempHeadNode.innerHTML;
            await insertNodesAndExecuteScripts(source, document.head, CSPnonce);
          }

          if (bodyMatch) {
            // We parsed a body open tag. we need to copy head attributes and insert future
            // content into <body>
            streamingContainer = document.body;
            const tempBodyNode = tempDom.window.document.body;
            for (let i = 0; i < tempBodyNode.attributes.length; i++) {
              const attr = tempBodyNode.attributes[i];
              document.body.setAttribute(attr.name, attr.value);
            }
            const source = document.createElement('body');
            source.innerHTML = tempBodyNode.innerHTML;
            await insertNodesAndExecuteScripts(source, document.body, CSPnonce);
          }

          if (!headMatch && !bodyMatch) {
            throw new Error('expected <head> or <body> after <html>');
          }
        } else {
          // we assume we are streaming into the default container'
          streamingContainer = container;
          const div = document.createElement('div');
          div.innerHTML = bufferedContent;
          await insertNodesAndExecuteScripts(div, container, CSPnonce);
        }
      } else if (streamingContainer === document.head) {
        bufferedContent = '<!DOCTYPE html><html><head>' + bufferedContent;
        const tempDom = new JSDOM(bufferedContent);

        const tempHeadNode = tempDom.window.document.head;
        const source = document.createElement('head');
        source.innerHTML = tempHeadNode.innerHTML;
        await insertNodesAndExecuteScripts(source, document.head, CSPnonce);

        if (bodyMatch) {
          streamingContainer = document.body;

          const tempBodyNode = tempDom.window.document.body;
          for (let i = 0; i < tempBodyNode.attributes.length; i++) {
            const attr = tempBodyNode.attributes[i];
            document.body.setAttribute(attr.name, attr.value);
          }
          const bodySource = document.createElement('body');
          bodySource.innerHTML = tempBodyNode.innerHTML;
          await insertNodesAndExecuteScripts(
            bodySource,
            document.body,
            CSPnonce,
          );
        }
      } else {
        const div = document.createElement('div');
        div.innerHTML = bufferedContent;
        await insertNodesAndExecuteScripts(div, streamingContainer, CSPnonce);
      }
    }, document);
  }

  function getMeaningfulChildren(element) {
    const children = [];
    let node = element.firstChild;
    while (node) {
      if (node.nodeType === 1) {
        if (
          // some tags are ambiguous and might be hidden because they look like non-meaningful children
          // so we have a global override where if this data attribute is included we also include the node
          node.hasAttribute('data-meaningful') ||
          (node.tagName === 'SCRIPT' &&
            node.hasAttribute('src') &&
            node.getAttribute('src') !==
              renderOptions.unstable_externalRuntimeSrc &&
            node.hasAttribute('async')) ||
          (node.tagName !== 'SCRIPT' &&
            node.tagName !== 'TEMPLATE' &&
            node.tagName !== 'template' &&
            !node.hasAttribute('hidden') &&
            !node.hasAttribute('aria-hidden'))
        ) {
          const props = {};
          const attributes = node.attributes;
          for (let i = 0; i < attributes.length; i++) {
            if (
              attributes[i].name === 'id' &&
              attributes[i].value.includes(':')
            ) {
              // We assume this is a React added ID that's a non-visual implementation detail.
              continue;
            }
            props[attributes[i].name] = attributes[i].value;
          }
          props.children = getMeaningfulChildren(node);
          children.push(React.createElement(node.tagName.toLowerCase(), props));
        }
      } else if (node.nodeType === 3) {
        children.push(node.data);
      }
      node = node.nextSibling;
    }
    return children.length === 0
      ? undefined
      : children.length === 1
      ? children[0]
      : children;
  }

  function BlockedOn({value, children}) {
    readText(value);
    return children;
  }

  function resolveText(text) {
    const record = textCache.get(text);
    if (record === undefined) {
      const newRecord = {
        status: 'resolved',
        value: text,
      };
      textCache.set(text, newRecord);
    } else if (record.status === 'pending') {
      const thenable = record.value;
      record.status = 'resolved';
      record.value = text;
      thenable.pings.forEach(t => t());
    }
  }

  function readText(text) {
    const record = textCache.get(text);
    if (record !== undefined) {
      switch (record.status) {
        case 'pending':
          throw record.value;
        case 'rejected':
          throw record.value;
        case 'resolved':
          return record.value;
      }
    } else {
      const thenable = {
        pings: [],
        then(resolve) {
          if (newRecord.status === 'pending') {
            thenable.pings.push(resolve);
          } else {
            Promise.resolve().then(() => resolve(newRecord.value));
          }
        },
      };

      const newRecord = {
        status: 'pending',
        value: thenable,
      };
      textCache.set(text, newRecord);

      throw thenable;
    }
  }

  function AsyncText({text}) {
    return readText(text);
  }

  function renderToPipeableStream(jsx, options) {
    // Merge options with renderOptions, which may contain featureFlag specific behavior
    return ReactDOMFizzServer.renderToPipeableStream(
      jsx,
      mergeOptions(options, renderOptions),
    );
  }

  function loadPreloads(hrefs) {
    const event = new window.Event('load');
    const nodes = document.querySelectorAll('link[rel="preload"]');
    resolveLoadables(hrefs, nodes, event, href =>
      Scheduler.log('load preload: ' + href),
    );
  }

  function errorPreloads(hrefs) {
    const event = new window.Event('error');
    const nodes = document.querySelectorAll('link[rel="preload"]');
    resolveLoadables(hrefs, nodes, event, href =>
      Scheduler.log('error preload: ' + href),
    );
  }

  function loadStylesheets(hrefs) {
    const event = new window.Event('load');
    const nodes = document.querySelectorAll('link[rel="stylesheet"]');
    resolveLoadables(hrefs, nodes, event, href =>
      Scheduler.log('load stylesheet: ' + href),
    );
  }

  function errorStylesheets(hrefs) {
    const event = new window.Event('error');
    const nodes = document.querySelectorAll('link[rel="stylesheet"]');
    resolveLoadables(hrefs, nodes, event, href => {
      Scheduler.log('error stylesheet: ' + href);
    });
  }

  function resolveLoadables(hrefs, nodes, event, onLoad) {
    const hrefSet = hrefs ? new Set(hrefs) : null;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (loadCache.has(node)) {
        continue;
      }
      const href = node.getAttribute('href');
      if (!hrefSet || hrefSet.has(href)) {
        loadCache.add(node);
        onLoad(href);
        node.dispatchEvent(event);
      }
    }
  }



  describe('ReactDOM.preload(href, { as: ... })', () => {
    // @gate enableFloat
    it('creates a preload resource when called', async () => {
      function App() {
        ReactDOM.preload('foo', {as: 'style'});
        return (
          <html>
            <body>
              <Suspense fallback="loading...">
                <BlockedOn value="blocked">
                  <Component />
                </BlockedOn>
              </Suspense>
            </body>
          </html>
        );
      }
      function Component() {
        ReactDOM.preload('bar', {as: 'script'});
        return <div>hello</div>;
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="preload" as="style" href="foo" />
          </head>
          <body>loading...</body>
        </html>,
      );

      await act(() => {
        resolveText('blocked');
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="preload" as="style" href="foo" />
          </head>
          <body>
            <div>hello</div>
            <link rel="preload" as="script" href="bar" />
          </body>
        </html>,
      );

      function ClientApp() {
        ReactDOM.preload('foo', {as: 'style'});
        ReactDOM.preload('font', {as: 'font', type: 'font/woff2'});
        React.useInsertionEffect(() => ReactDOM.preload('bar', {as: 'script'}));
        React.useLayoutEffect(() => ReactDOM.preload('baz', {as: 'font'}));
        React.useEffect(() => ReactDOM.preload('qux', {as: 'style'}));
        return (
          <html>
            <body>
              <Suspense fallback="loading...">
                <div>hello</div>
              </Suspense>
            </body>
          </html>
        );
      }
      ReactDOMClient.hydrateRoot(document, <ClientApp />);
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="preload" as="style" href="foo" />
            <link
              rel="preload"
              as="font"
              href="font"
              crossorigin=""
              type="font/woff2"
            />
            <link rel="preload" as="font" href="baz" crossorigin="" />
            <link rel="preload" as="style" href="qux" />
          </head>
          <body>
            <div>hello</div>
            <link rel="preload" as="script" href="bar" />
          </body>
        </html>,
      );
    });

    // @gate enableFloat
    it('can seed connection props for stylesheet and script resources', async () => {
      function App() {
        ReactDOM.preload('foo', {
          as: 'style',
          crossOrigin: 'use-credentials',
          integrity: 'some hash',
        });
        return (
          <html>
            <body>
              <div>hello</div>
              <link rel="stylesheet" href="foo" precedence="default" />
            </body>
          </html>
        );
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link
              rel="stylesheet"
              href="foo"
              data-precedence="default"
              crossorigin="use-credentials"
              integrity="some hash"
            />
          </head>
          <body>
            <div>hello</div>
          </body>
        </html>,
      );
    });

    // @gate enableFloat
    it('warns if you do not pass in a valid href argument or options argument', async () => {
      function App() {
        ReactDOM.preload();
        ReactDOM.preload('');
        ReactDOM.preload('foo', null);
        ReactDOM.preload('foo', {});
        ReactDOM.preload('foo', {as: 'foo'});
        return <div>foo</div>;
      }

      await expect(async () => {
        await act(() => {
          renderToPipeableStream(<App />).pipe(writable);
        });
      }).toErrorDev([
        'ReactDOM.preload(): Expected the `href` argument (first) to be a non-empty string but encountered `undefined` instead.',
        'ReactDOM.preload(): Expected the `href` argument (first) to be a non-empty string but encountered an empty string instead.',
        'ReactDOM.preload(): Expected the `options` argument (second) to be an object with an `as` property describing the type of resource to be preloaded but encountered `null` instead.',
        'ReactDOM.preload(): Expected the `as` property in the `options` argument (second) to contain a string value describing the type of resource to be preloaded but encountered `undefined` instead. Values that are valid in for the `as` attribute of a `<link rel="preload" as="..." />` tag are valid here.',
      ]);
    });

    // @gate enableFloat
    it('warns if you pass incompatible options to two `ReactDOM.preload(...)` with the same href', async () => {
      function Component() {
        ReactDOM.preload('foo', {
          as: 'font',
          crossOrigin: 'use-credentials',
        });
        ReactDOM.preload('foo', {
          as: 'font',
          integrity: 'some hash',
          crossOrigin: 'anonymous',
        });
        ReactDOM.preload('foo', {
          as: 'font',
          extra: 'ignored',
        });
      }

      await expect(async () => {
        await act(() => {
          renderToPipeableStream(
            <html>
              <body>
                <Component />
              </body>
            </html>,
          );
        });
      }).toErrorDev([
        'Warning: ReactDOM.preload(): The options provided conflict with another call to `ReactDOM.preload("foo", { as: "font", ...})`. React will always use the options it first encounters when preloading a resource for a given `href` and `as` type, and any later options will be ignored if different. Try updating all calls to `ReactDOM.preload()` with the same `href` and `as` type to use the same options, or eliminate one of the calls.\n  "integrity" option value: "some hash", missing from original options\n  "crossOrigin" option value: "anonymous", original option value: "use-credentials"',
        'Warning: ReactDOM.preload(): The options provided conflict with another call to `ReactDOM.preload("foo", { as: "font", ...})`. React will always use the options it first encounters when preloading a resource for a given `href` and `as` type, and any later options will be ignored if different. Try updating all calls to `ReactDOM.preload()` with the same `href` and `as` type to use the same options, or eliminate one of the calls.\n  "crossOrigin" missing from options, original option value: "use-credentials"',
      ]);
    });

    // @gate enableFloat
    it('warns if you pass incompatible options to two `ReactDOM.preload(...)` when an implicit preload already exists with the same href', async () => {
      function Component() {
        ReactDOM.preload('foo', {
          as: 'style',
          crossOrigin: 'use-credentials',
        });
      }

      await expect(async () => {
        await act(() => {
          renderToPipeableStream(
            <html>
              <body>
                <link
                  rel="stylesheet"
                  href="foo"
                  integrity="some hash"
                  media="print"
                />
                <Component />
              </body>
            </html>,
          );
        });
      }).toErrorDev([
        'ReactDOM.preload(): For `href` "foo", The options provided conflict with props on a matching <link rel="stylesheet" ... /> element. When the preload options disagree with the underlying resource it usually means the browser will not be able to use the preload when the resource is fetched, negating any benefit the preload would provide. React will preload the resource using props derived from the resource instead and ignore the options provided to the `ReactDOM.preload()` call. In general, preloading is useful when you expect to render a resource soon but have not yet done so. In this case since the underlying resource was already rendered the preload call may be extraneous. Try removing the call, otherwise try adjusting both the props on the <link rel="stylesheet" ... /> and the options passed to `ReactDOM.preload()` to agree.\n  "integrity" missing from options, underlying prop value: "some hash"\n  "media" missing from options, underlying prop value: "print"\n  "crossOrigin" option value: "use-credentials", missing from underlying props',
      ]);
    });
  });

  describe('ReactDOM.preinit(href, { as: ... })', () => {
    // @gate enableFloat
    it('creates a stylesheet resource when ReactDOM.preinit(..., {as: "style" }) is called', async () => {
      function App() {
        ReactDOM.preinit('foo', {as: 'style'});
        return (
          <html>
            <body>
              <Suspense fallback="loading...">
                <BlockedOn value="bar">
                  <Component />
                </BlockedOn>
              </Suspense>
            </body>
          </html>
        );
      }

      function Component() {
        ReactDOM.preinit('bar', {as: 'style'});
        return <div>hello</div>;
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="foo" data-precedence="default" />
          </head>
          <body>loading...</body>
        </html>,
      );

      await act(() => {
        resolveText('bar');
      });
      // The reason we do not see the "bar" stylesheet here is that ReactDOM.preinit is not about
      // encoding a resource dependency but is a hint that a resource will be used in the near future.
      // If we call preinit on the server after the shell has flushed the best we can do is emit a preload
      // because any flushing suspense boundaries are not actually dependent on that resource and we don't
      // want to delay reveal based on when that resource loads.
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="foo" data-precedence="default" />
          </head>
          <body>
            <div>hello</div>
            <link rel="preload" href="bar" as="style" />
          </body>
        </html>,
      );

      function ClientApp() {
        ReactDOM.preinit('bar', {as: 'style'});
        return (
          <html>
            <body>
              <Suspense fallback="loading...">
                <div>hello</div>
              </Suspense>
            </body>
          </html>
        );
      }

      ReactDOMClient.hydrateRoot(document, <ClientApp />);
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="foo" data-precedence="default" />
            <link rel="stylesheet" href="bar" data-precedence="default" />
          </head>
          <body>
            <div>hello</div>
            <link rel="preload" href="bar" as="style" />
          </body>
        </html>,
      );
    });

    // @gate enableFloat
    it('creates a stylesheet resource in the ownerDocument when ReactDOM.preinit(..., {as: "style" }) is called outside of render on the client', async () => {
      function App() {
        React.useEffect(() => {
          ReactDOM.preinit('foo', {as: 'style'});
        }, []);
        return (
          <html>
            <body>foo</body>
          </html>
        );
      }

      const root = ReactDOMClient.createRoot(document);
      root.render(<App />);
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="foo" data-precedence="default" />
          </head>
          <body>foo</body>
        </html>,
      );
    });

    // @gate enableFloat
    it('creates a stylesheet resource in the ownerDocument when ReactDOM.preinit(..., {as: "style" }) is called outside of render on the client', async () => {
      // This is testing behavior, but it shows that it is not a good idea to preinit inside a shadowRoot. The point is we are asserting a behavior
      // you would want to avoid in a real app.
      const shadow = document.body.attachShadow({mode: 'open'});
      function ShadowComponent() {
        ReactDOM.preinit('bar', {as: 'style'});
        return null;
      }
      function App() {
        React.useEffect(() => {
          ReactDOM.preinit('foo', {as: 'style'});
        }, []);
        return (
          <html>
            <body>
              foo
              {ReactDOM.createPortal(
                <div>
                  <ShadowComponent />
                  shadow
                </div>,
                shadow,
              )}
            </body>
          </html>
        );
      }

      const root = ReactDOMClient.createRoot(document);
      root.render(<App />);
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="bar" data-precedence="default" />
            <link rel="stylesheet" href="foo" data-precedence="default" />
          </head>
          <body>foo</body>
        </html>,
      );
      expect(getMeaningfulChildren(shadow)).toEqual(<div>shadow</div>);
    });

    // @gate enableFloat
    it('creates a script resource when ReactDOM.preinit(..., {as: "script" }) is called', async () => {
      function App() {
        ReactDOM.preinit('foo', {as: 'script'});
        return (
          <html>
            <body>
              <Suspense fallback="loading...">
                <BlockedOn value="bar">
                  <Component />
                </BlockedOn>
              </Suspense>
            </body>
          </html>
        );
      }

      function Component() {
        ReactDOM.preinit('bar', {as: 'script'});
        return <div>hello</div>;
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script async="" src="foo" />
          </head>
          <body>loading...</body>
        </html>,
      );

      await act(() => {
        resolveText('bar');
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script async="" src="foo" />
          </head>
          <body>
            <div>hello</div>
            <script async="" src="bar" />
          </body>
        </html>,
      );

      function ClientApp() {
        ReactDOM.preinit('bar', {as: 'script'});
        return (
          <html>
            <body>
              <Suspense fallback="loading...">
                <div>hello</div>
              </Suspense>
            </body>
          </html>
        );
      }

      ReactDOMClient.hydrateRoot(document, <ClientApp />);
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script async="" src="foo" />
          </head>
          <body>
            <div>hello</div>
            <script async="" src="bar" />
          </body>
        </html>,
      );
    });

    // @gate enableFloat
    it('creates a script resource when ReactDOM.preinit(..., {as: "script" }) is called outside of render on the client', async () => {
      function App() {
        React.useEffect(() => {
          ReactDOM.preinit('foo', {as: 'script'});
        }, []);
        return (
          <html>
            <body>foo</body>
          </html>
        );
      }

      const root = ReactDOMClient.createRoot(document);
      root.render(<App />);
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script async="" src="foo" />
          </head>
          <body>foo</body>
        </html>,
      );
    });

    // @gate enableFloat
    it('warns if you do not pass in a valid href argument or options argument', async () => {
      function App() {
        ReactDOM.preinit();
        ReactDOM.preinit('');
        ReactDOM.preinit('foo', null);
        ReactDOM.preinit('foo', {});
        ReactDOM.preinit('foo', {as: 'foo'});
        return <div>foo</div>;
      }

      await expect(async () => {
        await act(() => {
          renderToPipeableStream(<App />).pipe(writable);
        });
      }).toErrorDev([
        'ReactDOM.preinit(): Expected the `href` argument (first) to be a non-empty string but encountered `undefined` instead',
        'ReactDOM.preinit(): Expected the `href` argument (first) to be a non-empty string but encountered an empty string instead',
        'ReactDOM.preinit(): Expected the `options` argument (second) to be an object with an `as` property describing the type of resource to be preinitialized but encountered `null` instead',
        'ReactDOM.preinit(): Expected the `as` property in the `options` argument (second) to contain a valid value describing the type of resource to be preinitialized but encountered `undefined` instead. Valid values for `as` are "style" and "script".',
        'ReactDOM.preinit(): Expected the `as` property in the `options` argument (second) to contain a valid value describing the type of resource to be preinitialized but encountered "foo" instead. Valid values for `as` are "style" and "script".',
      ]);
    });

    // @gate enableFloat
    it('warns if you pass options to `ReactDOM.preinit(..., { as: "style", ... })` incompatible with props from an existing <link rel="stylesheet" .../>', async () => {
      function Component() {
        ReactDOM.preinit('foo', {
          as: 'style',
          integrity: 'some hash',
          crossOrigin: 'use-credentials',
        });
      }

      await expect(async () => {
        await act(() => {
          renderToPipeableStream(
            <html>
              <body>
                <link
                  rel="stylesheet"
                  href="foo"
                  precedence="foo"
                  crossOrigin="anonymous"
                />
                <Component />
              </body>
            </html>,
          );
        });
      }).toErrorDev([
        'ReactDOM.preinit(): For `href` "foo", the options provided conflict with props found on a <link rel="stylesheet" precedence="foo" href="foo" .../> that was already rendered. React will always use the props or options it first encounters for a hoistable stylesheet for a given `href` and any later props or options will be ignored if different. Generally, ReactDOM.preinit() is useful when you are not yet rendering a stylesheet but you anticipate it will be used soon. In this case the stylesheet was already rendered so preinitializing it does not provide any additional benefit. To resolve, try making the props and options agree between the <link rel="stylesheet" .../> and the `ReactDOM.preinit()` call or remove the `ReactDOM.preinit()` call.\n  "precedence" missing from options, prop value: "foo"\n  "integrity" option value: "some hash", missing from props\n  "crossOrigin" option value: "use-credentials", prop value: "anonymous"',
      ]);
    });

    // @gate enableFloat
    it('warns if you pass incompatible options to two `ReactDOM.preinit(..., { as: "style", ... })` with the same href', async () => {
      function Component() {
        ReactDOM.preinit('foo', {
          as: 'style',
          precedence: 'foo',
          crossOrigin: 'use-credentials',
        });
        ReactDOM.preinit('foo', {
          as: 'style',
          integrity: 'some hash',
          crossOrigin: 'anonymous',
        });
      }

      await expect(async () => {
        await act(() => {
          renderToPipeableStream(
            <html>
              <body>
                <Component />
              </body>
            </html>,
          );
        });
      }).toErrorDev([
        'ReactDOM.preinit(): For `href` "foo", the options provided conflict with another call to `ReactDOM.preinit("foo", { as: "style", ... })`. React will always use the options it first encounters when preinitializing a hoistable stylesheet for a given `href` and any later options will be ignored if different. Try updating all calls to `ReactDOM.preinit()` for a given `href` to use the same options, or only call `ReactDOM.preinit()` once per `href`.\n  "precedence" missing from options, original option value: "foo"\n  "integrity" option value: "some hash", missing from original options\n  "crossOrigin" option value: "anonymous", original option value: "use-credentials"',
      ]);
    });

    // @gate enableFloat
    it('warns if you pass options to `ReactDOM.preinit(..., { as: "script", ... })` incompatible with props from an existing <script async={true} .../>', async () => {
      function Component() {
        ReactDOM.preinit('foo', {
          as: 'script',
          integrity: 'some hash',
          crossOrigin: 'use-credentials',
        });
      }

      await expect(async () => {
        await act(() => {
          renderToPipeableStream(
            <html>
              <body>
                <script async={true} src="foo" crossOrigin="anonymous" />
                <Component />
              </body>
            </html>,
          );
        });
      }).toErrorDev([
        'ReactDOM.preinit(): For `href` "foo", the options provided conflict with props found on a <script async={true} src="foo" .../> that was already rendered. React will always use the props or options it first encounters for a hoistable script for a given `href` and any later props or options will be ignored if different. Generally, ReactDOM.preinit() is useful when you are not yet rendering a script but you anticipate it will be used soon and want to go beyond preloading it and have it execute early. In this case the script was already rendered so preinitializing it does not provide any additional benefit. To resolve, try making the props and options agree between the <script .../> and the `ReactDOM.preinit()` call or remove the `ReactDOM.preinit()` call.\n  "integrity" option value: "some hash", missing from props\n  "crossOrigin" option value: "use-credentials", prop value: "anonymous"',
      ]);
    });

    // @gate enableFloat
    it('warns if you pass incompatible options to two `ReactDOM.preinit(..., { as: "script", ... })` with the same href', async () => {
      function Component() {
        ReactDOM.preinit('foo', {
          as: 'script',
          crossOrigin: 'use-credentials',
        });
        ReactDOM.preinit('foo', {
          as: 'script',
          integrity: 'some hash',
          crossOrigin: 'anonymous',
        });
      }

      await expect(async () => {
        await act(() => {
          renderToPipeableStream(
            <html>
              <body>
                <Component />
              </body>
            </html>,
          );
        });
      }).toErrorDev([
        'ReactDOM.preinit(): For `href` "foo", the options provided conflict with another call to `ReactDOM.preinit("foo", { as: "script", ... })`. React will always use the options it first encounters when preinitializing a hoistable script for a given `href` and any later options will be ignored if different. Try updating all calls to `ReactDOM.preinit()` for a given `href` to use the same options, or only call `ReactDOM.preinit()` once per `href`.\n  "integrity" option value: "some hash", missing from original options\n  "crossOrigin" option value: "anonymous", original option value: "use-credentials"',
      ]);
    });

    it('accepts a `nonce` option for `as: "script"`', async () => {
      function Component({src}) {
        ReactDOM.preinit(src, {as: 'script', nonce: 'R4nD0m'});
        return 'hello';
      }

      await act(() => {
        renderToPipeableStream(
          <html>
            <body>
              <Component src="foo" />
            </body>
          </html>,
          {
            nonce: 'R4nD0m',
          },
        ).pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script async="" src="foo" nonce="R4nD0m" />
          </head>
          <body>hello</body>
        </html>,
      );

      await clientAct(() => {
        ReactDOMClient.hydrateRoot(
          document,
          <html>
            <body>
              <Component src="bar" />
            </body>
          </html>,
        );
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script async="" src="foo" nonce="R4nD0m" />
            <script async="" src="bar" nonce="R4nD0m" />
          </head>
          <body>hello</body>
        </html>,
      );
    });

    it('accepts an `integrity` option for `as: "script"`', async () => {
      function Component({src, hash}) {
        ReactDOM.preinit(src, {as: 'script', integrity: hash});
        return 'hello';
      }

      await act(() => {
        renderToPipeableStream(
          <html>
            <body>
              <Component src="foo" hash="foo hash" />
            </body>
          </html>,
          {
            nonce: 'R4nD0m',
          },
        ).pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script async="" src="foo" integrity="foo hash" />
          </head>
          <body>hello</body>
        </html>,
      );

      await clientAct(() => {
        ReactDOMClient.hydrateRoot(
          document,
          <html>
            <body>
              <Component src="bar" hash="bar hash" />
            </body>
          </html>,
        );
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script async="" src="foo" integrity="foo hash" />
            <script async="" src="bar" integrity="bar hash" />
          </head>
          <body>hello</body>
        </html>,
      );
    });
  });

 
});
