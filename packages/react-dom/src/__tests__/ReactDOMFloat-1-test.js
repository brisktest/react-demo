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

  // @gate enableFloat
  it('can render resources before singletons', async () => {
    const root = ReactDOMClient.createRoot(document);
    root.render(
      <>
        <title>foo</title>
        <html>
          <head>
            <link rel="foo" href="foo" />
          </head>
          <body>hello world</body>
        </html>
      </>,
    );
    try {
      await waitForAll([]);
    } catch (e) {
      // for DOMExceptions that happen when expecting this test to fail we need
      // to clear the scheduler first otherwise the expected failure will fail
      await waitForAll([]);
      throw e;
    }
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <title>foo</title>
          <link rel="foo" href="foo" />
        </head>
        <body>hello world</body>
      </html>,
    );
  });

  // @gate enableFloat
  it('can hydrate non Resources in head when Resources are also inserted there', async () => {
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head>
            <meta property="foo" content="bar" />
            <link rel="foo" href="bar" onLoad={() => {}} />
            <title>foo</title>
            <noscript>
              <link rel="icon" href="icon" />
            </noscript>
            <base target="foo" href="bar" />
            <script async={true} src="foo" onLoad={() => {}} />
          </head>
          <body>foo</body>
        </html>,
      );
      pipe(writable);
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="preload" href="foo" as="script" />
          <meta property="foo" content="bar" />
          <title>foo</title>
          <link rel="foo" href="bar" />
          <noscript>&lt;link rel="icon" href="icon"&gt;</noscript>
          <base target="foo" href="bar" />
        </head>
        <body>foo</body>
      </html>,
    );

    ReactDOMClient.hydrateRoot(
      document,
      <html>
        <head>
          <meta property="foo" content="bar" />
          <link rel="foo" href="bar" onLoad={() => {}} />
          <title>foo</title>
          <noscript>
            <link rel="icon" href="icon" />
          </noscript>
          <base target="foo" href="bar" />
          <script async={true} src="foo" onLoad={() => {}} />
        </head>
        <body>foo</body>
      </html>,
    );
    await waitForAll([]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="preload" href="foo" as="script" />
          <meta property="foo" content="bar" />
          <title>foo</title>
          <link rel="foo" href="bar" />
          <noscript>&lt;link rel="icon" href="icon"&gt;</noscript>
          <base target="foo" href="bar" />
          <script async="" src="foo" />
        </head>
        <body>foo</body>
      </html>,
    );
  });

  // @gate enableFloat || !__DEV__
  it('warns if you render resource-like elements above <head> or <body>', async () => {
    const root = ReactDOMClient.createRoot(document);

    await expect(async () => {
      root.render(
        <>
          <noscript>foo</noscript>
          <html>
            <body>foo</body>
          </html>
        </>,
      );
      const aggregateError = await waitForThrow();
      expect(aggregateError.errors.length).toBe(2);
      expect(aggregateError.errors[0].message).toContain(
        'Invalid insertion of NOSCRIPT',
      );
      expect(aggregateError.errors[1].message).toContain(
        'The node to be removed is not a child of this node',
      );
    }).toErrorDev(
      [
        'Cannot render <noscript> outside the main document. Try moving it into the root <head> tag.',
        'Warning: validateDOMNesting(...): <noscript> cannot appear as a child of <#document>.',
      ],
      {withoutStack: 1},
    );

    await expect(async () => {
      root.render(
        <html>
          <template>foo</template>
          <body>foo</body>
        </html>,
      );
      await waitForAll([]);
    }).toErrorDev([
      'Cannot render <template> outside the main document. Try moving it into the root <head> tag.',
      'Warning: validateDOMNesting(...): <template> cannot appear as a child of <html>.',
    ]);

    await expect(async () => {
      root.render(
        <html>
          <body>foo</body>
          <style>foo</style>
        </html>,
      );
      await waitForAll([]);
    }).toErrorDev([
      'Cannot render a <style> outside the main document without knowing its precedence and a unique href key. React can hoist and deduplicate <style> tags if you provide a `precedence` prop along with an `href` prop that does not conflic with the `href` values used in any other hoisted <style> or <link rel="stylesheet" ...> tags.  Note that hoisting <style> tags is considered an advanced feature that most will not use directly. Consider moving the <style> tag to the <head> or consider adding a `precedence="default"` and `href="some unique resource identifier"`, or move the <style> to the <style> tag.',
      'Warning: validateDOMNesting(...): <style> cannot appear as a child of <html>.',
    ]);

    await expect(async () => {
      root.render(
        <>
          <html>
            <body>foo</body>
          </html>
          <link rel="stylesheet" href="foo" />
        </>,
      );
      const aggregateError = await waitForThrow();
      expect(aggregateError.errors.length).toBe(2);
      expect(aggregateError.errors[0].message).toContain(
        'Invalid insertion of LINK',
      );
      expect(aggregateError.errors[1].message).toContain(
        'The node to be removed is not a child of this node',
      );
    }).toErrorDev(
      [
        'Cannot render a <link rel="stylesheet" /> outside the main document without knowing its precedence. Consider adding precedence="default" or moving it into the root <head> tag.',
        'Warning: validateDOMNesting(...): <link> cannot appear as a child of <#document>.',
      ],
      {withoutStack: 1},
    );

    await expect(async () => {
      root.render(
        <>
          <html>
            <body>foo</body>
            <script href="foo" />
          </html>
        </>,
      );
      await waitForAll([]);
    }).toErrorDev([
      'Cannot render a sync or defer <script> outside the main document without knowing its order. Try adding async="" or moving it into the root <head> tag.',
      'Warning: validateDOMNesting(...): <script> cannot appear as a child of <html>.',
    ]);

    await expect(async () => {
      root.render(
        <html>
          <script async={true} onLoad={() => {}} href="bar" />
          <body>foo</body>
        </html>,
      );
      await waitForAll([]);
    }).toErrorDev([
      'Cannot render a <script> with onLoad or onError listeners outside the main document. Try removing onLoad={...} and onError={...} or moving it into the root <head> tag or somewhere in the <body>.',
    ]);

    await expect(async () => {
      root.render(
        <>
          <link rel="foo" onLoad={() => {}} href="bar" />
          <html>
            <body>foo</body>
          </html>
        </>,
      );
      const aggregateError = await waitForThrow();
      expect(aggregateError.errors.length).toBe(2);
      expect(aggregateError.errors[0].message).toContain(
        'Invalid insertion of LINK',
      );
      expect(aggregateError.errors[1].message).toContain(
        'The node to be removed is not a child of this node',
      );
    }).toErrorDev(
      [
        'Cannot render a <link> with onLoad or onError listeners outside the main document. Try removing onLoad={...} and onError={...} or moving it into the root <head> tag or somewhere in the <body>.',
      ],
      {withoutStack: 1},
    );
  });

  // @gate enableFloat
  it('can acquire a resource after releasing it in the same commit', async () => {
    const root = ReactDOMClient.createRoot(container);
    root.render(
      <>
        <script async={true} src="foo" />
      </>,
    );
    await waitForAll([]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <script async="" src="foo" />
        </head>
        <body>
          <div id="container" />
        </body>
      </html>,
    );

    root.render(
      <>
        {null}
        <script data-new="new" async={true} src="foo" />
      </>,
    );
    await waitForAll([]);
    // we don't see the attribute because the resource is the same and was not reconstructed
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <script async="" src="foo" />
        </head>
        <body>
          <div id="container" />
        </body>
      </html>,
    );
  });

  // @gate enableFloat
  it('emits resources before everything else when rendering with no head', async () => {
    function App() {
      return (
        <>
          <title>foo</title>
          <link rel="preload" href="foo" as="style" />
        </>
      );
    }

    await act(() => {
      buffer = `<!DOCTYPE html><html><head>${ReactDOMFizzServer.renderToString(
        <App />,
      )}</head><body>foo</body></html>`;
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="preload" href="foo" as="style" />
          <title>foo</title>
        </head>
        <body>foo</body>
      </html>,
    );
  });

  // @gate enableFloat
  it('emits resources before everything else when rendering with just a head', async () => {
    function App() {
      return (
        <head>
          <title>foo</title>
          <link rel="preload" href="foo" as="style" />
        </head>
      );
    }

    await act(() => {
      buffer = `<!DOCTYPE html><html>${ReactDOMFizzServer.renderToString(
        <App />,
      )}<body>foo</body></html>`;
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="preload" href="foo" as="style" />
          <title>foo</title>
        </head>
        <body>foo</body>
      </html>,
    );
  });

  // @gate enableFloat
  it('emits an implicit <head> element to hold resources when none is rendered but an <html> is rendered', async () => {
    const chunks = [];

    writable.on('data', chunk => {
      chunks.push(chunk);
    });

    await act(() => {
      const {pipe} = renderToPipeableStream(
        <>
          <title>foo</title>
          <html>
            <body>bar</body>
          </html>
          <script async={true} src="foo" />
        </>,
      );
      pipe(writable);
    });
    expect(chunks).toEqual([
      '<!DOCTYPE html><html><head><script async="" src="foo"></script><title>foo</title></head><body>bar',
      '</body></html>',
    ]);
  });

  // @gate enableFloat
  it('dedupes if the external runtime is explicitly loaded using preinit', async () => {
    const unstable_externalRuntimeSrc = 'src-of-external-runtime';
    function App() {
      ReactDOM.preinit(unstable_externalRuntimeSrc, {as: 'script'});
      return (
        <div>
          <Suspense fallback={<h1>Loading...</h1>}>
            <AsyncText text="Hello" />
          </Suspense>
        </div>
      );
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head />
          <body>
            <App />
          </body>
        </html>,
        {
          unstable_externalRuntimeSrc,
        },
      );
      pipe(writable);
    });

    expect(
      Array.from(document.getElementsByTagName('script')).map(n => n.outerHTML),
    ).toEqual(['<script src="src-of-external-runtime" async=""></script>']);
  });

  // @gate enableFloat
  it('can avoid inserting a late stylesheet if it already rendered on the client', async () => {
    await act(() => {
      renderToPipeableStream(
        <html>
          <body>
            <Suspense fallback="loading foo...">
              <BlockedOn value="foo">
                <link rel="stylesheet" href="foo" precedence="foo" />
                foo
              </BlockedOn>
            </Suspense>
            <Suspense fallback="loading bar...">
              <BlockedOn value="bar">
                <link rel="stylesheet" href="bar" precedence="bar" />
                bar
              </BlockedOn>
            </Suspense>
          </body>
        </html>,
      ).pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>
          {'loading foo...'}
          {'loading bar...'}
        </body>
      </html>,
    );

    ReactDOMClient.hydrateRoot(
      document,
      <html>
        <body>
          <link rel="stylesheet" href="foo" precedence="foo" />
          <Suspense fallback="loading foo...">
            <link rel="stylesheet" href="foo" precedence="foo" />
            foo
          </Suspense>
          <Suspense fallback="loading bar...">
            <link rel="stylesheet" href="bar" precedence="bar" />
            bar
          </Suspense>
        </body>
      </html>,
    );
    await waitForAll([]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="foo" />
          <link as="style" href="foo" rel="preload" />
        </head>
        <body>
          {'loading foo...'}
          {'loading bar...'}
        </body>
      </html>,
    );

    await act(() => {
      resolveText('bar');
    });
    await act(() => {
      const sheets = document.querySelectorAll(
        'link[rel="stylesheet"][data-precedence]',
      );
      const event = document.createEvent('Event');
      event.initEvent('load', true, true);
      for (let i = 0; i < sheets.length; i++) {
        sheets[i].dispatchEvent(event);
      }
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="foo" />
          <link rel="stylesheet" href="bar" data-precedence="bar" />
          <link as="style" href="foo" rel="preload" />
        </head>
        <body>
          {'loading foo...'}
          {'bar'}
          <link as="style" href="bar" rel="preload" />
        </body>
      </html>,
    );

    await act(() => {
      resolveText('foo');
    });
    await act(() => {
      const sheets = document.querySelectorAll(
        'link[rel="stylesheet"][data-precedence]',
      );
      const event = document.createEvent('Event');
      event.initEvent('load', true, true);
      for (let i = 0; i < sheets.length; i++) {
        sheets[i].dispatchEvent(event);
      }
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="foo" />
          <link rel="stylesheet" href="bar" data-precedence="bar" />
          <link as="style" href="foo" rel="preload" />
        </head>
        <body>
          {'foo'}
          {'bar'}
          <link as="style" href="bar" rel="preload" />
          <link as="style" href="foo" rel="preload" />
        </body>
      </html>,
    );
  });

  // @gate enableFloat
  it('can hoist <link rel="stylesheet" .../> and <style /> tags together, respecting order of discovery', async () => {
    const css = `
body {
  background-color: red;
}`;

    await act(() => {
      renderToPipeableStream(
        <html>
          <body>
            <link rel="stylesheet" href="one1" precedence="one" />
            <style href="two1" precedence="two">
              {css}
            </style>
            <link rel="stylesheet" href="three1" precedence="three" />
            <style href="four1" precedence="four">
              {css}
            </style>
            <Suspense>
              <BlockedOn value="block">
                <link rel="stylesheet" href="one2" precedence="one" />
                <link rel="stylesheet" href="two2" precedence="two" />
                <style href="three2" precedence="three">
                  {css}
                </style>
                <style href="four2" precedence="four">
                  {css}
                </style>
                <link rel="stylesheet" href="five1" precedence="five" />
              </BlockedOn>
            </Suspense>
            <Suspense>
              <BlockedOn value="block2">
                <style href="one3" precedence="one">
                  {css}
                </style>
                <style href="two3" precedence="two">
                  {css}
                </style>
                <link rel="stylesheet" href="three3" precedence="three" />
                <link rel="stylesheet" href="four3" precedence="four" />
                <style href="six1" precedence="six">
                  {css}
                </style>
              </BlockedOn>
            </Suspense>
            <Suspense>
              <BlockedOn value="block again">
                <link rel="stylesheet" href="one2" precedence="one" />
                <link rel="stylesheet" href="two2" precedence="two" />
                <style href="three2" precedence="three">
                  {css}
                </style>
                <style href="four2" precedence="four">
                  {css}
                </style>
                <link rel="stylesheet" href="five1" precedence="five" />
              </BlockedOn>
            </Suspense>
          </body>
        </html>,
      ).pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="one1" data-precedence="one" />
          <style data-href="two1" data-precedence="two">
            {css}
          </style>
          <link rel="stylesheet" href="three1" data-precedence="three" />
          <style data-href="four1" data-precedence="four">
            {css}
          </style>
        </head>
        <body />
      </html>,
    );

    await act(() => {
      resolveText('block');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="one1" data-precedence="one" />
          <link rel="stylesheet" href="one2" data-precedence="one" />
          <style data-href="two1" data-precedence="two">
            {css}
          </style>
          <link rel="stylesheet" href="two2" data-precedence="two" />
          <link rel="stylesheet" href="three1" data-precedence="three" />
          <style data-href="three2" data-precedence="three">
            {css}
          </style>
          <style data-href="four1" data-precedence="four">
            {css}
          </style>
          <style data-href="four2" data-precedence="four">
            {css}
          </style>
          <link rel="stylesheet" href="five1" data-precedence="five" />
        </head>
        <body>
          <link rel="preload" href="one2" as="style" />
          <link rel="preload" href="two2" as="style" />
          <link rel="preload" href="five1" as="style" />
        </body>
      </html>,
    );

    await act(() => {
      resolveText('block2');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="one1" data-precedence="one" />
          <link rel="stylesheet" href="one2" data-precedence="one" />
          <style data-href="one3" data-precedence="one">
            {css}
          </style>
          <style data-href="two1" data-precedence="two">
            {css}
          </style>
          <link rel="stylesheet" href="two2" data-precedence="two" />
          <style data-href="two3" data-precedence="two">
            {css}
          </style>
          <link rel="stylesheet" href="three1" data-precedence="three" />
          <style data-href="three2" data-precedence="three">
            {css}
          </style>
          <link rel="stylesheet" href="three3" data-precedence="three" />
          <style data-href="four1" data-precedence="four">
            {css}
          </style>
          <style data-href="four2" data-precedence="four">
            {css}
          </style>
          <link rel="stylesheet" href="four3" data-precedence="four" />
          <link rel="stylesheet" href="five1" data-precedence="five" />
          <style data-href="six1" data-precedence="six">
            {css}
          </style>
        </head>
        <body>
          <link rel="preload" href="one2" as="style" />
          <link rel="preload" href="two2" as="style" />
          <link rel="preload" href="five1" as="style" />
          <link rel="preload" href="three3" as="style" />
          <link rel="preload" href="four3" as="style" />
        </body>
      </html>,
    );

    await act(() => {
      resolveText('block again');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="one1" data-precedence="one" />
          <link rel="stylesheet" href="one2" data-precedence="one" />
          <style data-href="one3" data-precedence="one">
            {css}
          </style>
          <style data-href="two1" data-precedence="two">
            {css}
          </style>
          <link rel="stylesheet" href="two2" data-precedence="two" />
          <style data-href="two3" data-precedence="two">
            {css}
          </style>
          <link rel="stylesheet" href="three1" data-precedence="three" />
          <style data-href="three2" data-precedence="three">
            {css}
          </style>
          <link rel="stylesheet" href="three3" data-precedence="three" />
          <style data-href="four1" data-precedence="four">
            {css}
          </style>
          <style data-href="four2" data-precedence="four">
            {css}
          </style>
          <link rel="stylesheet" href="four3" data-precedence="four" />
          <link rel="stylesheet" href="five1" data-precedence="five" />
          <style data-href="six1" data-precedence="six">
            {css}
          </style>
        </head>
        <body>
          <link rel="preload" href="one2" as="style" />
          <link rel="preload" href="two2" as="style" />
          <link rel="preload" href="five1" as="style" />
          <link rel="preload" href="three3" as="style" />
          <link rel="preload" href="four3" as="style" />
        </body>
      </html>,
    );

    ReactDOMClient.hydrateRoot(
      document,
      <html>
        <body>
          <link rel="stylesheet" href="one4" precedence="one" />
          <style href="two4" precedence="two">
            {css}
          </style>
          <link rel="stylesheet" href="three4" precedence="three" />
          <style href="four4" precedence="four">
            {css}
          </style>
          <link rel="stylesheet" href="seven1" precedence="seven" />
          <style href="eight1" precedence="eight">
            {css}
          </style>
        </body>
      </html>,
    );
    await waitForAll([]);

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="one1" data-precedence="one" />
          <link rel="stylesheet" href="one2" data-precedence="one" />
          <style data-href="one3" data-precedence="one">
            {css}
          </style>
          <link rel="stylesheet" href="one4" data-precedence="one" />
          <style data-href="two1" data-precedence="two">
            {css}
          </style>
          <link rel="stylesheet" href="two2" data-precedence="two" />
          <style data-href="two3" data-precedence="two">
            {css}
          </style>
          <style data-href="two4" data-precedence="two">
            {css}
          </style>
          <link rel="stylesheet" href="three1" data-precedence="three" />
          <style data-href="three2" data-precedence="three">
            {css}
          </style>
          <link rel="stylesheet" href="three3" data-precedence="three" />
          <link rel="stylesheet" href="three4" data-precedence="three" />
          <style data-href="four1" data-precedence="four">
            {css}
          </style>
          <style data-href="four2" data-precedence="four">
            {css}
          </style>
          <link rel="stylesheet" href="four3" data-precedence="four" />
          <style data-href="four4" data-precedence="four">
            {css}
          </style>
          <link rel="stylesheet" href="five1" data-precedence="five" />
          <style data-href="six1" data-precedence="six">
            {css}
          </style>
          <link rel="stylesheet" href="seven1" data-precedence="seven" />
          <style data-href="eight1" data-precedence="eight">
            {css}
          </style>
          <link rel="preload" href="one4" as="style" />
          <link rel="preload" href="three4" as="style" />
          <link rel="preload" href="seven1" as="style" />
        </head>
        <body>
          <link rel="preload" href="one2" as="style" />
          <link rel="preload" href="two2" as="style" />
          <link rel="preload" href="five1" as="style" />
          <link rel="preload" href="three3" as="style" />
          <link rel="preload" href="four3" as="style" />
        </body>
      </html>,
    );
  });

  // @gate enableFloat
  it('client renders a boundary if a style Resource dependency fails to load', async () => {
    function App() {
      return (
        <html>
          <head />
          <body>
            <Suspense fallback="loading...">
              <BlockedOn value="unblock">
                <link rel="stylesheet" href="foo" precedence="arbitrary" />
                <link rel="stylesheet" href="bar" precedence="arbitrary" />
                Hello
              </BlockedOn>
            </Suspense>
          </body>
        </html>
      );
    }
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });

    await act(() => {
      resolveText('unblock');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="arbitrary" />
          <link rel="stylesheet" href="bar" data-precedence="arbitrary" />
        </head>
        <body>
          loading...
          <link rel="preload" href="foo" as="style" />
          <link rel="preload" href="bar" as="style" />
        </body>
      </html>,
    );

    errorStylesheets(['bar']);
    assertLog(['error stylesheet: bar']);

    await waitForAll([]);

    const boundaryTemplateInstance = document.getElementById('B:0');
    const suspenseInstance = boundaryTemplateInstance.previousSibling;

    expect(suspenseInstance.data).toEqual('$!');
    expect(boundaryTemplateInstance.dataset.dgst).toBe(
      'Resource failed to load',
    );

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="arbitrary" />
          <link rel="stylesheet" href="bar" data-precedence="arbitrary" />
        </head>
        <body>
          loading...
          <link rel="preload" href="foo" as="style" />
          <link rel="preload" href="bar" as="style" />
        </body>
      </html>,
    );

    const errors = [];
    ReactDOMClient.hydrateRoot(document, <App />, {
      onRecoverableError(err, errInfo) {
        errors.push(err.message);
        errors.push(err.digest);
      },
    });
    await waitForAll([]);
    // When binding a stylesheet that was SSR'd in a boundary reveal there is a loadingState promise
    // We need to use that promise to resolve the suspended commit because we don't know if the load or error
    // events have already fired. This requires the load to be awaited for the commit to have a chance to flush
    // We could change this by tracking the loadingState's fulfilled status directly on the loadingState similar
    // to thenables however this slightly increases the fizz runtime code size.
    await clientAct(() => loadStylesheets());
    assertLog(['load stylesheet: foo']);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="arbitrary" />
          <link rel="stylesheet" href="bar" data-precedence="arbitrary" />
        </head>
        <body>
          <link rel="preload" href="foo" as="style" />
          <link rel="preload" href="bar" as="style" />
          Hello
        </body>
      </html>,
    );
    expect(errors).toEqual([
      'The server could not finish this Suspense boundary, likely due to an error during server rendering. Switched to client rendering.',
      'Resource failed to load',
    ]);
  });

  // @gate enableFloat
  it('treats stylesheet links with a precedence as a resource', async () => {
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head />
          <body>
            <link rel="stylesheet" href="foo" precedence="arbitrary" />
            Hello
          </body>
        </html>,
      );
      pipe(writable);
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="arbitrary" />
        </head>
        <body>Hello</body>
      </html>,
    );

    ReactDOMClient.hydrateRoot(
      document,
      <html>
        <head />
        <body>Hello</body>
      </html>,
    );
    await waitForAll([]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="arbitrary" />
        </head>
        <body>Hello</body>
      </html>,
    );
  });

  // @gate enableFloat
  it('inserts text separators following text when followed by an element that is converted to a resource and thus removed from the html inline', async () => {
    // If you render many of these as siblings the values get emitted as a single text with no separator sometimes
    // because the link gets elided as a resource
    function AsyncTextWithResource({text, href, precedence}) {
      const value = readText(text);
      return (
        <>
          {value}
          <link rel="stylesheet" href={href} precedence={precedence} />
        </>
      );
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head />
          <body>
            <AsyncTextWithResource text="foo" href="foo" precedence="one" />
            <AsyncTextWithResource text="bar" href="bar" precedence="two" />
            <AsyncTextWithResource text="baz" href="baz" precedence="three" />
          </body>
        </html>,
      );
      pipe(writable);
      resolveText('foo');
      resolveText('bar');
      resolveText('baz');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="one" />
          <link rel="stylesheet" href="bar" data-precedence="two" />
          <link rel="stylesheet" href="baz" data-precedence="three" />
        </head>
        <body>
          {'foo'}
          {'bar'}
          {'baz'}
        </body>
      </html>,
    );
  });

  // @gate enableFloat
  it('hoists late stylesheets the correct precedence', async () => {
    function PresetPrecedence() {
      ReactDOM.preinit('preset', {as: 'style', precedence: 'preset'});
    }
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head />
          <body>
            <link rel="stylesheet" href="initial" precedence="one" />
            <PresetPrecedence />
            <div>
              <Suspense fallback="loading foo bar...">
                <div>foo</div>
                <link rel="stylesheet" href="foo" precedence="one" />
                <BlockedOn value="bar">
                  <div>bar</div>
                  <link rel="stylesheet" href="bar" precedence="default" />
                </BlockedOn>
              </Suspense>
            </div>
            <div>
              <Suspense fallback="loading bar baz qux...">
                <BlockedOn value="bar">
                  <div>bar</div>
                  <link rel="stylesheet" href="bar" precedence="default" />
                </BlockedOn>
                <BlockedOn value="baz">
                  <div>baz</div>
                  <link rel="stylesheet" href="baz" precedence="two" />
                </BlockedOn>
                <BlockedOn value="qux">
                  <div>qux</div>
                  <link rel="stylesheet" href="qux" precedence="one" />
                </BlockedOn>
              </Suspense>
            </div>
            <div>
              <Suspense fallback="loading bar baz qux...">
                <BlockedOn value="unblock">
                  <BlockedOn value="bar">
                    <div>bar</div>
                    <link rel="stylesheet" href="bar" precedence="default" />
                  </BlockedOn>
                  <BlockedOn value="baz">
                    <div>baz</div>
                    <link rel="stylesheet" href="baz" precedence="two" />
                  </BlockedOn>
                  <BlockedOn value="qux">
                    <div>qux</div>
                    <link rel="stylesheet" href="qux" precedence="one" />
                  </BlockedOn>
                </BlockedOn>
              </Suspense>
            </div>
          </body>
        </html>,
      );
      pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="initial" data-precedence="one" />
          <link rel="stylesheet" href="foo" data-precedence="one" />
          <link rel="stylesheet" href="preset" data-precedence="preset" />
        </head>
        <body>
          <div>loading foo bar...</div>
          <div>loading bar baz qux...</div>
          <div>loading bar baz qux...</div>
        </body>
      </html>,
    );

    await act(() => {
      resolveText('foo');
      resolveText('bar');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="initial" data-precedence="one" />
          <link rel="stylesheet" href="foo" data-precedence="one" />
          <link rel="stylesheet" href="preset" data-precedence="preset" />
          <link rel="stylesheet" href="bar" data-precedence="default" />
        </head>
        <body>
          <div>loading foo bar...</div>
          <div>loading bar baz qux...</div>
          <div>loading bar baz qux...</div>
          <link rel="preload" href="bar" as="style" />
        </body>
      </html>,
    );

    await act(() => {
      const link = document.querySelector('link[rel="stylesheet"][href="foo"]');
      const event = document.createEvent('Events');
      event.initEvent('load', true, true);
      link.dispatchEvent(event);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="initial" data-precedence="one" />
          <link rel="stylesheet" href="foo" data-precedence="one" />
          <link rel="stylesheet" href="preset" data-precedence="preset" />
          <link rel="stylesheet" href="bar" data-precedence="default" />
        </head>
        <body>
          <div>loading foo bar...</div>
          <div>loading bar baz qux...</div>
          <div>loading bar baz qux...</div>
          <link rel="preload" href="bar" as="style" />
        </body>
      </html>,
    );

    await act(() => {
      const link = document.querySelector('link[rel="stylesheet"][href="bar"]');
      const event = document.createEvent('Events');
      event.initEvent('load', true, true);
      link.dispatchEvent(event);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="initial" data-precedence="one" />
          <link rel="stylesheet" href="foo" data-precedence="one" />
          <link rel="stylesheet" href="preset" data-precedence="preset" />
          <link rel="stylesheet" href="bar" data-precedence="default" />
        </head>
        <body>
          <div>
            <div>foo</div>
            <div>bar</div>
          </div>
          <div>loading bar baz qux...</div>
          <div>loading bar baz qux...</div>
          <link rel="preload" href="bar" as="style" />
        </body>
      </html>,
    );

    await act(() => {
      resolveText('baz');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="initial" data-precedence="one" />
          <link rel="stylesheet" href="foo" data-precedence="one" />
          <link rel="stylesheet" href="preset" data-precedence="preset" />
          <link rel="stylesheet" href="bar" data-precedence="default" />
        </head>
        <body>
          <div>
            <div>foo</div>
            <div>bar</div>
          </div>
          <div>loading bar baz qux...</div>
          <div>loading bar baz qux...</div>
          <link rel="preload" as="style" href="bar" />
          <link rel="preload" as="style" href="baz" />
        </body>
      </html>,
    );

    await act(() => {
      resolveText('qux');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="initial" data-precedence="one" />
          <link rel="stylesheet" href="foo" data-precedence="one" />
          <link rel="stylesheet" href="qux" data-precedence="one" />
          <link rel="stylesheet" href="preset" data-precedence="preset" />
          <link rel="stylesheet" href="bar" data-precedence="default" />
          <link rel="stylesheet" href="baz" data-precedence="two" />
        </head>
        <body>
          <div>
            <div>foo</div>
            <div>bar</div>
          </div>
          <div>loading bar baz qux...</div>
          <div>loading bar baz qux...</div>
          <link rel="preload" as="style" href="bar" />
          <link rel="preload" as="style" href="baz" />
          <link rel="preload" as="style" href="qux" />
        </body>
      </html>,
    );

    await act(() => {
      const bazlink = document.querySelector(
        'link[rel="stylesheet"][href="baz"]',
      );
      const quxlink = document.querySelector(
        'link[rel="stylesheet"][href="qux"]',
      );
      const presetLink = document.querySelector(
        'link[rel="stylesheet"][href="preset"]',
      );
      const event = document.createEvent('Events');
      event.initEvent('load', true, true);
      bazlink.dispatchEvent(event);
      quxlink.dispatchEvent(event);
      presetLink.dispatchEvent(event);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="initial" data-precedence="one" />
          <link rel="stylesheet" href="foo" data-precedence="one" />
          <link rel="stylesheet" href="qux" data-precedence="one" />
          <link rel="stylesheet" href="preset" data-precedence="preset" />
          <link rel="stylesheet" href="bar" data-precedence="default" />
          <link rel="stylesheet" href="baz" data-precedence="two" />
        </head>
        <body>
          <div>
            <div>foo</div>
            <div>bar</div>
          </div>
          <div>
            <div>bar</div>
            <div>baz</div>
            <div>qux</div>
          </div>
          <div>loading bar baz qux...</div>
          <link rel="preload" as="style" href="bar" />
          <link rel="preload" as="style" href="baz" />
          <link rel="preload" as="style" href="qux" />
        </body>
      </html>,
    );

    await act(() => {
      resolveText('unblock');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="initial" data-precedence="one" />
          <link rel="stylesheet" href="foo" data-precedence="one" />
          <link rel="stylesheet" href="qux" data-precedence="one" />
          <link rel="stylesheet" href="preset" data-precedence="preset" />
          <link rel="stylesheet" href="bar" data-precedence="default" />
          <link rel="stylesheet" href="baz" data-precedence="two" />
        </head>
        <body>
          <div>
            <div>foo</div>
            <div>bar</div>
          </div>
          <div>
            <div>bar</div>
            <div>baz</div>
            <div>qux</div>
          </div>
          <div>
            <div>bar</div>
            <div>baz</div>
            <div>qux</div>
          </div>
          <link rel="preload" as="style" href="bar" />
          <link rel="preload" as="style" href="baz" />
          <link rel="preload" as="style" href="qux" />
        </body>
      </html>,
    );
  });

  // @gate enableFloat
  it('normalizes stylesheet resource precedence for all boundaries inlined as part of the shell flush', async () => {
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head />
          <body>
            <div>
              outer
              <link rel="stylesheet" href="1one" precedence="one" />
              <link rel="stylesheet" href="1two" precedence="two" />
              <link rel="stylesheet" href="1three" precedence="three" />
              <link rel="stylesheet" href="1four" precedence="four" />
              <Suspense fallback={null}>
                <div>
                  middle
                  <link rel="stylesheet" href="2one" precedence="one" />
                  <link rel="stylesheet" href="2two" precedence="two" />
                  <link rel="stylesheet" href="2three" precedence="three" />
                  <link rel="stylesheet" href="2four" precedence="four" />
                  <Suspense fallback={null}>
                    <div>
                      inner
                      <link rel="stylesheet" href="3five" precedence="five" />
                      <link rel="stylesheet" href="3one" precedence="one" />
                      <link rel="stylesheet" href="3two" precedence="two" />
                      <link rel="stylesheet" href="3three" precedence="three" />
                      <link rel="stylesheet" href="3four" precedence="four" />
                    </div>
                  </Suspense>
                </div>
              </Suspense>
              <Suspense fallback={null}>
                <div>middle</div>
                <link rel="stylesheet" href="4one" precedence="one" />
                <link rel="stylesheet" href="4two" precedence="two" />
                <link rel="stylesheet" href="4three" precedence="three" />
                <link rel="stylesheet" href="4four" precedence="four" />
              </Suspense>
            </div>
          </body>
        </html>,
      );
      pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="1one" data-precedence="one" />
          <link rel="stylesheet" href="2one" data-precedence="one" />
          <link rel="stylesheet" href="3one" data-precedence="one" />
          <link rel="stylesheet" href="4one" data-precedence="one" />

          <link rel="stylesheet" href="1two" data-precedence="two" />
          <link rel="stylesheet" href="2two" data-precedence="two" />
          <link rel="stylesheet" href="3two" data-precedence="two" />
          <link rel="stylesheet" href="4two" data-precedence="two" />

          <link rel="stylesheet" href="1three" data-precedence="three" />
          <link rel="stylesheet" href="2three" data-precedence="three" />
          <link rel="stylesheet" href="3three" data-precedence="three" />
          <link rel="stylesheet" href="4three" data-precedence="three" />

          <link rel="stylesheet" href="1four" data-precedence="four" />
          <link rel="stylesheet" href="2four" data-precedence="four" />
          <link rel="stylesheet" href="3four" data-precedence="four" />
          <link rel="stylesheet" href="4four" data-precedence="four" />

          <link rel="stylesheet" href="3five" data-precedence="five" />
        </head>
        <body>
          <div>
            outer
            <div>
              middle<div>inner</div>
            </div>
            <div>middle</div>
          </div>
        </body>
      </html>,
    );
  });


});
