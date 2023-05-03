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


  describe('Style Resource', () => {
    // @gate enableFloat
    it('treats <style href="..." precedence="..."> elements as a style resource when server rendering', async () => {
      const css = `
body {
  background-color: red;
}`;
      await act(() => {
        renderToPipeableStream(
          <html>
            <body>
              <style href="foo" precedence="foo">
                {css}
              </style>
            </body>
          </html>,
        ).pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <style data-href="foo" data-precedence="foo">
              {css}
            </style>
          </head>
          <body />
        </html>,
      );
    });

    // @gate enableFloat
    it('can insert style resources as part of a boundary reveal', async () => {
      const cssRed = `
body {
  background-color: red;
}`;
      const cssBlue = `
body {
background-color: blue;
}`;
      const cssGreen = `
body {
background-color: green;
}`;
      await act(() => {
        renderToPipeableStream(
          <html>
            <body>
              <Suspense fallback="loading...">
                <BlockedOn value="blocked">
                  <style href="foo" precedence="foo">
                    {cssRed}
                  </style>
                  loaded
                </BlockedOn>
              </Suspense>
            </body>
          </html>,
        ).pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head />
          <body>loading...</body>
        </html>,
      );

      await act(() => {
        resolveText('blocked');
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <style data-href="foo" data-precedence="foo">
              {cssRed}
            </style>
          </head>
          <body>loaded</body>
        </html>,
      );

      const root = ReactDOMClient.hydrateRoot(
        document,
        <html>
          <body>
            <Suspense fallback="loading...">
              <style href="foo" precedence="foo">
                {cssRed}
              </style>
              loaded
            </Suspense>
          </body>
        </html>,
      );
      await waitForAll([]);

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <style data-href="foo" data-precedence="foo">
              {cssRed}
            </style>
          </head>
          <body>loaded</body>
        </html>,
      );

      root.render(
        <html>
          <body>
            <Suspense fallback="loading...">
              <style href="foo" precedence="foo">
                {cssRed}
              </style>
              loaded
            </Suspense>
            <style href="bar" precedence="bar">
              {cssBlue}
            </style>
            <style href="baz" precedence="foo">
              {cssGreen}
            </style>
          </body>
        </html>,
      );
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <style data-href="foo" data-precedence="foo">
              {cssRed}
            </style>
            <style data-href="baz" data-precedence="foo">
              {cssGreen}
            </style>
            <style data-href="bar" data-precedence="bar">
              {cssBlue}
            </style>
          </head>
          <body>loaded</body>
        </html>,
      );
    });

    // @gate enableFloat
    it('can emit styles early when a partial boundary flushes', async () => {
      const css = 'body { background-color: red; }';
      await act(() => {
        renderToPipeableStream(
          <html>
            <body>
              <Suspense>
                <BlockedOn value="first">
                  <div>first</div>
                  <style href="foo" precedence="default">
                    {css}
                  </style>
                  <BlockedOn value="second">
                    <div>second</div>
                    <style href="bar" precedence="default">
                      {css}
                    </style>
                  </BlockedOn>
                </BlockedOn>
              </Suspense>
            </body>
          </html>,
        ).pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head />
          <body />
        </html>,
      );

      await act(() => {
        resolveText('first');
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head />
          <body>
            <style data-href="foo" data-precedence="default" media="not all">
              {css}
            </style>
          </body>
        </html>,
      );

      await act(() => {
        resolveText('second');
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <style data-href="foo" data-precedence="default">
              {css}
            </style>
            <style data-href="bar" data-precedence="default">
              {css}
            </style>
          </head>
          <body>
            <div>first</div>
            <div>second</div>
          </body>
        </html>,
      );
    });

    it('can hoist styles flushed early even when no other style dependencies are flushed on completion', async () => {
      await act(() => {
        renderToPipeableStream(
          <html>
            <body>
              <Suspense fallback="loading...">
                <BlockedOn value="first">
                  <style href="foo" precedence="default">
                    some css
                  </style>
                  <div>first</div>
                  <BlockedOn value="second">
                    <div>second</div>
                  </BlockedOn>
                </BlockedOn>
              </Suspense>
            </body>
          </html>,
        ).pipe(writable);
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head />
          <body>loading...</body>
        </html>,
      );

      // When we resolve first we flush the style tag because it is ready but we aren't yet ready to
      // flush the entire boundary and reveal it.
      await act(() => {
        resolveText('first');
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head />
          <body>
            loading...
            <style data-href="foo" data-precedence="default" media="not all">
              some css
            </style>
          </body>
        </html>,
      );

      // When we resolve second we flush the rest of the boundary segments and reveal the boundary. The style tag
      // is hoisted during this reveal process even though no other styles flushed during this tick
      await act(() => {
        resolveText('second');
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <style data-href="foo" data-precedence="default">
              some css
            </style>
          </head>
          <body>
            <div>first</div>
            <div>second</div>
          </body>
        </html>,
      );
    });

    it('can emit multiple style rules into a single style tag for a given precedence', async () => {
      await act(() => {
        renderToPipeableStream(
          <html>
            <body>
              <style href="1" precedence="default">
                1
              </style>
              <style href="2" precedence="foo">
                foo2
              </style>
              <style href="3" precedence="default">
                3
              </style>
              <style href="4" precedence="default">
                4
              </style>
              <style href="5" precedence="foo">
                foo5
              </style>
              <div>initial</div>
              <Suspense fallback="loading...">
                <BlockedOn value="first">
                  <style href="6" precedence="default">
                    6
                  </style>
                  <style href="7" precedence="foo">
                    foo7
                  </style>
                  <style href="8" precedence="default">
                    8
                  </style>
                  <style href="9" precedence="default">
                    9
                  </style>
                  <style href="10" precedence="foo">
                    foo10
                  </style>
                  <div>first</div>
                  <BlockedOn value="second">
                    <style href="11" precedence="default">
                      11
                    </style>
                    <style href="12" precedence="foo">
                      foo12
                    </style>
                    <style href="13" precedence="default">
                      13
                    </style>
                    <style href="14" precedence="default">
                      14
                    </style>
                    <style href="15" precedence="foo">
                      foo15
                    </style>
                    <div>second</div>
                  </BlockedOn>
                </BlockedOn>
              </Suspense>
            </body>
          </html>,
        ).pipe(writable);
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <style data-href="1 3 4" data-precedence="default">
              134
            </style>
            <style data-href="2 5" data-precedence="foo">
              foo2foo5
            </style>
          </head>
          <body>
            <div>initial</div>loading...
          </body>
        </html>,
      );

      // When we resolve first we flush the style tag because it is ready but we aren't yet ready to
      // flush the entire boundary and reveal it.
      await act(() => {
        resolveText('first');
      });
      await act(() => {
        resolveText('second');
      });

      // Some sets of styles were ready before the entire boundary and they got emitted as early as they were
      // ready. The remaining styles were ready when the boundary finished and they got grouped as well
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <style data-href="1 3 4" data-precedence="default">
              134
            </style>
            <style data-href="6 8 9" data-precedence="default">
              689
            </style>
            <style data-href="11 13 14" data-precedence="default">
              111314
            </style>
            <style data-href="2 5" data-precedence="foo">
              foo2foo5
            </style>
            <style data-href="7 10" data-precedence="foo">
              foo7foo10
            </style>
            <style data-href="12 15" data-precedence="foo">
              foo12foo15
            </style>
          </head>
          <body>
            <div>initial</div>
            <div>first</div>
            <div>second</div>
          </body>
        </html>,
      );

      // Client inserted style tags are not grouped together but can hydrate against a grouped set
      ReactDOMClient.hydrateRoot(
        document,
        <html>
          <body>
            <style href="1" precedence="default">
              1
            </style>
            <style href="2" precedence="foo">
              foo2
            </style>
            <style href="16" precedence="default">
              16
            </style>
            <style href="17" precedence="default">
              17
            </style>
          </body>
        </html>,
      );
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <style data-href="1 3 4" data-precedence="default">
              134
            </style>
            <style data-href="6 8 9" data-precedence="default">
              689
            </style>
            <style data-href="11 13 14" data-precedence="default">
              111314
            </style>
            <style data-href="16" data-precedence="default">
              16
            </style>
            <style data-href="17" data-precedence="default">
              17
            </style>
            <style data-href="2 5" data-precedence="foo">
              foo2foo5
            </style>
            <style data-href="7 10" data-precedence="foo">
              foo7foo10
            </style>
            <style data-href="12 15" data-precedence="foo">
              foo12foo15
            </style>
          </head>
          <body>
            <div>initial</div>
            <div>first</div>
            <div>second</div>
          </body>
        </html>,
      );
    });

    it('warns if you render a <style> with an href with a space on the server', async () => {
      await expect(async () => {
        await act(() => {
          renderToPipeableStream(
            <html>
              <body>
                <style href="foo bar" precedence="default">
                  style
                </style>
              </body>
            </html>,
          ).pipe(writable);
        });
      }).toErrorDev(
        'React expected the `href` prop for a <style> tag opting into hoisting semantics using the `precedence` prop to not have any spaces but ecountered spaces instead. using spaces in this prop will cause hydration of this style to fail on the client. The href for the <style> where this ocurred is "foo bar".',
      );
    });
  });

  describe('Script Resources', () => {
    // @gate enableFloat
    it('treats async scripts without onLoad or onError as Resources', async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <html>
            <head />
            <body>
              <script src="foo" async={true} />
              <script src="bar" async={true} onLoad={() => {}} />
              <script src="baz" data-meaningful="" />
              hello world
            </body>
          </html>,
        );
        pipe(writable);
      });
      // The plain async script is converted to a resource and emitted as part of the shell
      // The async script with onLoad is preloaded in the shell but is expecting to be added
      // during hydration. This is novel, the script is NOT a HostHoistable but it also will
      // never hydrate
      // The regular script is just a normal html that should hydrate with a HostComponent
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script src="foo" async="" />
            <link rel="preload" href="bar" as="script" />
            <link rel="preload" href="baz" as="script" />
          </head>
          <body>
            <script src="baz" data-meaningful="" />
            hello world
          </body>
        </html>,
      );

      ReactDOMClient.hydrateRoot(
        document,
        <html>
          <head />
          <body>
            <script src="foo" async={true} />
            <script src="bar" async={true} onLoad={() => {}} />
            <script src="baz" data-meaningful="" />
            hello world
          </body>
        </html>,
      );
      await waitForAll([]);
      // The async script with onLoad is inserted in the right place but does not cause the hydration
      // to fail.
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script src="foo" async="" />
            <link rel="preload" href="bar" as="script" />
            <link rel="preload" href="baz" as="script" />
          </head>
          <body>
            <script src="bar" async="" />
            <script src="baz" data-meaningful="" />
            hello world
          </body>
        </html>,
      );
    });

    // @gate enableFloat
    it('does not create script resources when inside an <svg> context', async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <html>
            <body>
              <svg>
                <path>
                  <script async={true} src="foo" />
                </path>
                <foreignObject>
                  <script async={true} src="bar" />
                </foreignObject>
              </svg>
            </body>
          </html>,
        );
        pipe(writable);
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script async="" src="bar" />
          </head>
          <body>
            <svg>
              <path>
                <script async="" src="foo" />
              </path>
              <foreignobject />
            </svg>
          </body>
        </html>,
      );

      const root = ReactDOMClient.createRoot(document.body);
      root.render(
        <div>
          <svg>
            <path>
              <script async={true} src="foo" />
            </path>
            <foreignObject>
              <script async={true} src="bar" />
            </foreignObject>
          </svg>
        </div>,
      );
      await waitForAll([]);
      expect(getMeaningfulChildren(document.body)).toEqual(
        <div>
          <svg>
            <path>
              <script async="" src="foo" />
            </path>
            <foreignobject />
          </svg>
        </div>,
      );
    });

    // @gate enableFloat
    it('does not create script resources when inside a <noscript> context', async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <html>
            <body>
              <noscript>
                <script async={true} src="foo" />
              </noscript>
            </body>
          </html>,
        );
        pipe(writable);
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head />
          <body>
            <noscript>
              &lt;script async="" src="foo"&gt;&lt;/script&gt;
            </noscript>
          </body>
        </html>,
      );

      const root = ReactDOMClient.createRoot(document.body);
      root.render(
        <div>
          <noscript>
            <script async={true} src="foo" />
          </noscript>
        </div>,
      );
      await waitForAll([]);
      expect(getMeaningfulChildren(document.body)).toEqual(
        <div>
          {/* On the client, <noscript> never renders children */}
          <noscript />
        </div>,
      );
    });

    // @gate enableFloat
    it('warns if you provide different props between <script async={true} .../> and ReactDOM.preinit(..., {as: "script"}) for the same `href`', async () => {
      function App() {
        ReactDOM.preinit('foo', {as: 'script', integrity: 'some hash'});
        return (
          <html>
            <body>
              <script
                async={true}
                src="foo"
                integrity="different hash"
                data-foo=""
              />
              hello
            </body>
          </html>
        );
      }
      await expect(async () => {
        await act(() => {
          const {pipe} = renderToPipeableStream(<App />);
          pipe(writable);
        });
      }).toErrorDev([
        'Warning: React encountered a <script async={true} src="foo" .../> with props that conflict with the options provided to `ReactDOM.preinit("foo", { as: "script", ... })`. React will use the first props or preinitialization options encountered when rendering a hoistable script with a particular `src` and will ignore any newer props or options. The first instance of this script resource was created using the `ReactDOM.preinit()` function. Please note, `ReactDOM.preinit()` is modeled off of module import assertions capabilities and does not support arbitrary props. If you need to have props not included with the preinit options you will need to rely on rendering <script> tags only.\n  "data-foo" prop value: an empty string, option not available with ReactDOM.preinit()\n  "integrity" prop value: "different hash", option value: "some hash"',
      ]);
    });

    // @gate enableFloat
    it('warns if you provide different props between two <script async={true} .../> that share the same `src`', async () => {
      function App() {
        return (
          <html>
            <body>
              <script
                async={true}
                src="foo"
                integrity="some hash"
                data-foo=""
              />
              <script
                async={true}
                src="foo"
                integrity="different hash"
                data-bar=""
              />
              hello
            </body>
          </html>
        );
      }
      await expect(async () => {
        await act(() => {
          const {pipe} = renderToPipeableStream(<App />);
          pipe(writable);
        });
      }).toErrorDev([
        'React encountered a <script async={true} src="foo" .../> that has props that conflict with another hoistable script with the same `src`. When rendering hoistable scripts (async scripts without any loading handlers) the props from the first encountered instance will be used and props from later instances will be ignored. Update the props on both <script async={true} .../> instance so they agree.\n  "data-foo" missing for props, original value: an empty string\n  "data-bar" prop value: an empty string, missing from original props\n  "integrity" prop value: "different hash", original value: "some hash"',
      ]);
    });
  });

});
