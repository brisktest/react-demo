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
  stripExternalRuntimeInNodes,
  withLoadingReadyState,
} from '../test-utils/FizzTestUtils';

let JSDOM;
let Stream;
let Scheduler;
let React;
let ReactDOMClient;
let ReactDOMFizzServer;
let Suspense;
let SuspenseList;
let useSyncExternalStore;
let useSyncExternalStoreWithSelector;
let use;
let PropTypes;
let textCache;
let writable;
let CSPnonce = null;
let container;
let buffer = '';
let hasErrored = false;
let fatalError = undefined;
let renderOptions;
let waitFor;
let waitForAll;
let assertLog;
let waitForPaint;
let clientAct;
let streamingContainer;

describe('ReactDOMFizzServer', () => {
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

    Scheduler = require('scheduler');
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ReactDOMFizzServer = require('react-dom/server');
    Stream = require('stream');
    Suspense = React.Suspense;
    use = React.use;
    if (gate(flags => flags.enableSuspenseList)) {
      SuspenseList = React.SuspenseList;
    }

    PropTypes = require('prop-types');

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    waitFor = InternalTestUtils.waitFor;
    waitForPaint = InternalTestUtils.waitForPaint;
    assertLog = InternalTestUtils.assertLog;
    clientAct = InternalTestUtils.act;

    if (gate(flags => flags.source)) {
      // The `with-selector` module composes the main `use-sync-external-store`
      // entrypoint. In the compiled artifacts, this is resolved to the `shim`
      // implementation by our build config, but when running the tests against
      // the source files, we need to tell Jest how to resolve it. Because this
      // is a source module, this mock has no affect on the build tests.
      jest.mock('use-sync-external-store/src/useSyncExternalStore', () =>
        jest.requireActual('react'),
      );
    }
    useSyncExternalStore = React.useSyncExternalStore;
    useSyncExternalStoreWithSelector =
      require('use-sync-external-store/with-selector').useSyncExternalStoreWithSelector;

    textCache = new Map();

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
        'react-dom-bindings/src/server/ReactDOMServerExternalRuntime.js';
    }
  });

  function expectErrors(errorsArr, toBeDevArr, toBeProdArr) {
    const mappedErrows = errorsArr.map(({error, errorInfo}) => {
      const stack = errorInfo && errorInfo.componentStack;
      const digest = error.digest;
      if (stack) {
        return [error.message, digest, normalizeCodeLocInfo(stack)];
      } else if (digest) {
        return [error.message, digest];
      }
      return error.message;
    });
    if (__DEV__) {
      expect(mappedErrows).toEqual(toBeDevArr);
    } else {
      expect(mappedErrows).toEqual(toBeProdArr);
    }
  }

  function componentStack(components) {
    return components
      .map(component => `\n    in ${component} (at **)`)
      .join('');
  }

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

  function getVisibleChildren(element) {
    const children = [];
    let node = element.firstChild;
    while (node) {
      if (node.nodeType === 1) {
        if (
          node.tagName !== 'SCRIPT' &&
          node.tagName !== 'script' &&
          node.tagName !== 'TEMPLATE' &&
          node.tagName !== 'template' &&
          !node.hasAttribute('hidden') &&
          !node.hasAttribute('aria-hidden')
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
          props.children = getVisibleChildren(node);
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

  function rejectText(text, error) {
    const record = textCache.get(text);
    if (record === undefined) {
      const newRecord = {
        status: 'rejected',
        value: error,
      };
      textCache.set(text, newRecord);
    } else if (record.status === 'pending') {
      const thenable = record.value;
      record.status = 'rejected';
      record.value = error;
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

  function Text({text}) {
    return text;
  }

  function AsyncText({text}) {
    return readText(text);
  }

  function AsyncTextWrapped({as, text}) {
    const As = as;
    return <As>{readText(text)}</As>;
  }
  function renderToPipeableStream(jsx, options) {
    // Merge options with renderOptions, which may contain featureFlag specific behavior
    return ReactDOMFizzServer.renderToPipeableStream(
      jsx,
      mergeOptions(options, renderOptions),
    );
  }

  describe('text separators', () => {
    // To force performWork to start before resolving AsyncText but before piping we need to wait until
    // after scheduleWork which currently uses setImmediate to delay performWork
    function afterImmediate() {
      return new Promise(resolve => {
        setImmediate(resolve);
      });
    }

    it('it only includes separators between adjacent text nodes', async () => {
      function App({name}) {
        return (
          <div>
            hello<b>world, {name}</b>!
          </div>
        );
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App name="Foo" />);
        pipe(writable);
      });

      expect(container.innerHTML).toEqual(
        '<div>hello<b>world, <!-- -->Foo</b>!</div>',
      );
      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App name="Foo" />, {
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(container)).toEqual(
        <div>
          hello<b>world, {'Foo'}</b>!
        </div>,
      );
    });

    it('it does not insert text separators even when adjacent text is in a delayed segment', async () => {
      function App({name}) {
        return (
          <Suspense fallback={'loading...'}>
            <div id="app-div">
              hello
              <b>
                world, <AsyncText text={name} />
              </b>
              !
            </div>
          </Suspense>
        );
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App name="Foo" />);
        pipe(writable);
      });

      expect(document.getElementById('app-div').outerHTML).toEqual(
        '<div id="app-div">hello<b>world, <template id="P:1"></template></b>!</div>',
      );

      await act(() => resolveText('Foo'));

      const div = stripExternalRuntimeInNodes(
        container.children,
        renderOptions.unstable_externalRuntimeSrc,
      )[0];
      expect(div.outerHTML).toEqual(
        '<div id="app-div">hello<b>world, Foo</b>!</div>',
      );

      // there may be either:
      //  - an external runtime script and deleted nodes with data attributes
      //  - extra script nodes containing fizz instructions at the end of container
      expect(
        Array.from(container.childNodes).filter(e => e.tagName !== 'SCRIPT')
          .length,
      ).toBe(3);

      expect(div.childNodes.length).toBe(3);
      const b = div.childNodes[1];
      expect(b.childNodes.length).toBe(2);
      expect(b.childNodes[0]).toMatchInlineSnapshot('world, ');
      expect(b.childNodes[1]).toMatchInlineSnapshot('Foo');

      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App name="Foo" />, {
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(container)).toEqual(
        <div id="app-div">
          hello<b>world, {'Foo'}</b>!
        </div>,
      );
    });

    it('it works with multiple adjacent segments', async () => {
      function App() {
        return (
          <Suspense fallback={'loading...'}>
            <div id="app-div">
              h<AsyncText text={'ello'} />
              w<AsyncText text={'orld'} />
            </div>
          </Suspense>
        );
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });

      expect(document.getElementById('app-div').outerHTML).toEqual(
        '<div id="app-div">h<template id="P:1"></template>w<template id="P:2"></template></div>',
      );

      await act(() => resolveText('orld'));

      expect(document.getElementById('app-div').outerHTML).toEqual(
        '<div id="app-div">h<template id="P:1"></template>world</div>',
      );

      await act(() => resolveText('ello'));
      expect(
        stripExternalRuntimeInNodes(
          container.children,
          renderOptions.unstable_externalRuntimeSrc,
        )[0].outerHTML,
      ).toEqual('<div id="app-div">helloworld</div>');

      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App name="Foo" />, {
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(container)).toEqual(
        <div id="app-div">{['h', 'ello', 'w', 'orld']}</div>,
      );
    });

    it('it works when some segments are flushed and others are patched', async () => {
      function App() {
        return (
          <Suspense fallback={'loading...'}>
            <div id="app-div">
              h<AsyncText text={'ello'} />
              w<AsyncText text={'orld'} />
            </div>
          </Suspense>
        );
      }

      await act(async () => {
        const {pipe} = renderToPipeableStream(<App />);
        await afterImmediate();
        await act(() => resolveText('ello'));
        pipe(writable);
      });

      expect(document.getElementById('app-div').outerHTML).toEqual(
        '<div id="app-div">h<!-- -->ello<!-- -->w<template id="P:1"></template></div>',
      );

      await act(() => resolveText('orld'));

      expect(
        stripExternalRuntimeInNodes(
          container.children,
          renderOptions.unstable_externalRuntimeSrc,
        )[0].outerHTML,
      ).toEqual('<div id="app-div">h<!-- -->ello<!-- -->world</div>');

      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App />, {
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(container)).toEqual(
        <div id="app-div">{['h', 'ello', 'w', 'orld']}</div>,
      );
    });

    it('it does not prepend a text separators if the segment follows a non-Text Node', async () => {
      function App() {
        return (
          <Suspense fallback={'loading...'}>
            <div>
              hello
              <b>
                <AsyncText text={'world'} />
              </b>
            </div>
          </Suspense>
        );
      }

      await act(async () => {
        const {pipe} = renderToPipeableStream(<App />);
        await afterImmediate();
        await act(() => resolveText('world'));
        pipe(writable);
      });

      expect(container.firstElementChild.outerHTML).toEqual(
        '<div>hello<b>world<!-- --></b></div>',
      );

      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App />, {
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(container)).toEqual(
        <div>
          hello<b>world</b>
        </div>,
      );
    });

    it('it does not prepend a text separators if the segments first emission is a non-Text Node', async () => {
      function App() {
        return (
          <Suspense fallback={'loading...'}>
            <div>
              hello
              <AsyncTextWrapped as={'b'} text={'world'} />
            </div>
          </Suspense>
        );
      }

      await act(async () => {
        const {pipe} = renderToPipeableStream(<App />);
        await afterImmediate();
        await act(() => resolveText('world'));
        pipe(writable);
      });

      expect(container.firstElementChild.outerHTML).toEqual(
        '<div>hello<b>world</b></div>',
      );

      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App />, {
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(container)).toEqual(
        <div>
          hello<b>world</b>
        </div>,
      );
    });

    it('should not insert separators for text inside Suspense boundaries even if they would otherwise be considered text-embedded', async () => {
      function App() {
        return (
          <Suspense fallback={'loading...'}>
            <div id="app-div">
              start
              <Suspense fallback={'[loading first]'}>
                firststart
                <AsyncText text={'first suspended'} />
                firstend
              </Suspense>
              <Suspense fallback={'[loading second]'}>
                secondstart
                <b>
                  <AsyncText text={'second suspended'} />
                </b>
              </Suspense>
              end
            </div>
          </Suspense>
        );
      }

      await act(async () => {
        const {pipe} = renderToPipeableStream(<App />);
        await afterImmediate();
        await act(() => resolveText('world'));
        pipe(writable);
      });

      expect(document.getElementById('app-div').outerHTML).toEqual(
        '<div id="app-div">start<!--$?--><template id="B:0"></template>[loading first]<!--/$--><!--$?--><template id="B:1"></template>[loading second]<!--/$-->end</div>',
      );

      await act(() => {
        resolveText('first suspended');
      });

      expect(document.getElementById('app-div').outerHTML).toEqual(
        '<div id="app-div">start<!--$-->firststartfirst suspendedfirstend<!--/$--><!--$?--><template id="B:1"></template>[loading second]<!--/$-->end</div>',
      );

      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App />, {
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(container)).toEqual(
        <div id="app-div">
          {'start'}
          {'firststart'}
          {'first suspended'}
          {'firstend'}
          {'[loading second]'}
          {'end'}
        </div>,
      );

      await act(() => {
        resolveText('second suspended');
      });

      expect(
        stripExternalRuntimeInNodes(
          container.children,
          renderOptions.unstable_externalRuntimeSrc,
        )[0].outerHTML,
      ).toEqual(
        '<div id="app-div">start<!--$-->firststartfirst suspendedfirstend<!--/$--><!--$-->secondstart<b>second suspended</b><!--/$-->end</div>',
      );

      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(container)).toEqual(
        <div id="app-div">
          {'start'}
          {'firststart'}
          {'first suspended'}
          {'firstend'}
          {'secondstart'}
          <b>second suspended</b>
          {'end'}
        </div>,
      );
    });

    it('(only) includes extraneous text separators in segments that complete before flushing, followed by nothing or a non-Text node', async () => {
      function App() {
        return (
          <div>
            <Suspense fallback={'text before, nothing after...'}>
              hello
              <AsyncText text="world" />
            </Suspense>
            <Suspense fallback={'nothing before or after...'}>
              <AsyncText text="world" />
            </Suspense>
            <Suspense fallback={'text before, element after...'}>
              hello
              <AsyncText text="world" />
              <br />
            </Suspense>
            <Suspense fallback={'nothing before, element after...'}>
              <AsyncText text="world" />
              <br />
            </Suspense>
          </div>
        );
      }

      await act(async () => {
        const {pipe} = renderToPipeableStream(<App />);
        await afterImmediate();
        await act(() => resolveText('world'));
        pipe(writable);
      });

      expect(container.innerHTML).toEqual(
        '<div><!--$-->hello<!-- -->world<!-- --><!--/$--><!--$-->world<!-- --><!--/$--><!--$-->hello<!-- -->world<!-- --><br><!--/$--><!--$-->world<!-- --><br><!--/$--></div>',
      );

      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App />, {
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(container)).toEqual(
        <div>
          {/* first boundary */}
          {'hello'}
          {'world'}
          {/* second boundary */}
          {'world'}
          {/* third boundary */}
          {'hello'}
          {'world'}
          <br />
          {/* fourth boundary */}
          {'world'}
          <br />
        </div>,
      );
    });
  });

  describe('title children', () => {
    it('should accept a single string child', async () => {
      // a Single string child
      function App() {
        return (
          <head>
            <title>hello</title>
          </head>
        );
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });
      expect(getVisibleChildren(document.head)).toEqual(<title>hello</title>);

      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App />, {
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(document.head)).toEqual(<title>hello</title>);
    });

    it('should accept children array of length 1 containing a string', async () => {
      // a Single string child
      function App() {
        return (
          <head>
            <title>{['hello']}</title>
          </head>
        );
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });
      expect(getVisibleChildren(document.head)).toEqual(<title>hello</title>);

      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App />, {
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(document.head)).toEqual(<title>hello</title>);
    });

    it('should warn in dev when given an array of length 2 or more', async () => {
      function App() {
        return (
          <head>
            <title>{['hello1', 'hello2']}</title>
          </head>
        );
      }

      await expect(async () => {
        await act(() => {
          const {pipe} = renderToPipeableStream(<App />);
          pipe(writable);
        });
      }).toErrorDev([
        'React expects the `children` prop of <title> tags to be a string, number, or object with a novel `toString` method but found an Array with length 2 instead. Browsers treat all child Nodes of <title> tags as Text content and React expects to be able to convert `children` of <title> tags to a single string value which is why Arrays of length greater than 1 are not supported. When using JSX it can be commong to combine text nodes and value nodes. For example: <title>hello {nameOfUser}</title>. While not immediately apparent, `children` in this case is an Array with length 2. If your `children` prop is using this form try rewriting it using a template string: <title>{`hello ${nameOfUser}`}</title>.',
      ]);

      if (gate(flags => flags.enableFloat)) {
        expect(getVisibleChildren(document.head)).toEqual(<title />);
      } else {
        expect(getVisibleChildren(document.head)).toEqual(
          <title>{'hello1<!-- -->hello2'}</title>,
        );
      }

      const errors = [];
      ReactDOMClient.hydrateRoot(document.head, <App />, {
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      if (gate(flags => flags.enableFloat)) {
        expect(errors).toEqual([]);
        // with float, the title doesn't render on the client or on the server
        expect(getVisibleChildren(document.head)).toEqual(<title />);
      } else {
        expect(errors).toEqual(
          [
            gate(flags => flags.enableClientRenderFallbackOnTextMismatch)
              ? 'Text content does not match server-rendered HTML.'
              : null,
            'Hydration failed because the initial UI does not match what was rendered on the server.',
            'There was an error while hydrating. Because the error happened outside of a Suspense boundary, the entire root will switch to client rendering.',
          ].filter(Boolean),
        );
        expect(getVisibleChildren(document.head)).toEqual(
          <title>{['hello1', 'hello2']}</title>,
        );
      }
    });

    it('should warn in dev if you pass a React Component as a child to <title>', async () => {
      function IndirectTitle() {
        return 'hello';
      }

      function App() {
        return (
          <head>
            <title>
              <IndirectTitle />
            </title>
          </head>
        );
      }

      if (gate(flags => flags.enableFloat)) {
        await expect(async () => {
          await act(() => {
            const {pipe} = renderToPipeableStream(<App />);
            pipe(writable);
          });
        }).toErrorDev([
          'React expects the `children` prop of <title> tags to be a string, number, or object with a novel `toString` method but found an object that appears to be a React element which never implements a suitable `toString` method. Browsers treat all child Nodes of <title> tags as Text content and React expects to be able to convert children of <title> tags to a single string value which is why rendering React elements is not supported. If the `children` of <title> is a React Component try moving the <title> tag into that component. If the `children` of <title> is some HTML markup change it to be Text only to be valid HTML.',
        ]);
      } else {
        await expect(async () => {
          await act(() => {
            const {pipe} = renderToPipeableStream(<App />);
            pipe(writable);
          });
        }).toErrorDev([
          'A title element received a React element for children. In the browser title Elements can only have Text Nodes as children. If the children being rendered output more than a single text node in aggregate the browser will display markup and comments as text in the title and hydration will likely fail and fall back to client rendering',
        ]);
      }

      if (gate(flags => flags.enableFloat)) {
        // object titles are toStringed when float is on
        expect(getVisibleChildren(document.head)).toEqual(
          <title>{'[object Object]'}</title>,
        );
      } else {
        expect(getVisibleChildren(document.head)).toEqual(<title>hello</title>);
      }

      const errors = [];
      ReactDOMClient.hydrateRoot(document.head, <App />, {
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      if (gate(flags => flags.enableFloat)) {
        // object titles are toStringed when float is on
        expect(getVisibleChildren(document.head)).toEqual(
          <title>{'[object Object]'}</title>,
        );
      } else {
        expect(getVisibleChildren(document.head)).toEqual(<title>hello</title>);
      }
    });
  });

  it('basic use(promise)', async () => {
    const promiseA = Promise.resolve('A');
    const promiseB = Promise.resolve('B');
    const promiseC = Promise.resolve('C');

    function Async() {
      return use(promiseA) + use(promiseB) + use(promiseC);
    }

    function App() {
      return (
        <Suspense fallback="Loading...">
          <Async />
        </Suspense>
      );
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });

    // TODO: The `act` implementation in this file doesn't unwrap microtasks
    // automatically. We can't use the same `act` we use for Fiber tests
    // because that relies on the mock Scheduler. Doesn't affect any public
    // API but we might want to fix this for our own internal tests.
    //
    // For now, wait for each promise in sequence.
    await act(async () => {
      await promiseA;
    });
    await act(async () => {
      await promiseB;
    });
    await act(async () => {
      await promiseC;
    });

    expect(getVisibleChildren(container)).toEqual('ABC');

    ReactDOMClient.hydrateRoot(container, <App />);
    await waitForAll([]);
    expect(getVisibleChildren(container)).toEqual('ABC');
  });

  it('basic use(context)', async () => {
    const ContextA = React.createContext('default');
    const ContextB = React.createContext('B');
    const ServerContext = React.createServerContext('ServerContext', 'default');
    function Client() {
      return use(ContextA) + use(ContextB);
    }
    function ServerComponent() {
      return use(ServerContext);
    }
    function Server() {
      return (
        <ServerContext.Provider value="C">
          <ServerComponent />
        </ServerContext.Provider>
      );
    }
    function App() {
      return (
        <>
          <ContextA.Provider value="A">
            <Client />
          </ContextA.Provider>
          <Server />
        </>
      );
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(['AB', 'C']);

    // Hydration uses a different renderer runtime (Fiber instead of Fizz).
    // We reset _currentRenderer here to not trigger a warning about multiple
    // renderers concurrently using these contexts
    ContextA._currentRenderer = null;
    ServerContext._currentRenderer = null;
    ReactDOMClient.hydrateRoot(container, <App />);
    await waitForAll([]);
    expect(getVisibleChildren(container)).toEqual(['AB', 'C']);
  });

  it('use(promise) in multiple components', async () => {
    const promiseA = Promise.resolve('A');
    const promiseB = Promise.resolve('B');
    const promiseC = Promise.resolve('C');
    const promiseD = Promise.resolve('D');

    function Child({prefix}) {
      return prefix + use(promiseC) + use(promiseD);
    }

    function Parent() {
      return <Child prefix={use(promiseA) + use(promiseB)} />;
    }

    function App() {
      return (
        <Suspense fallback="Loading...">
          <Parent />
        </Suspense>
      );
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });

    // TODO: The `act` implementation in this file doesn't unwrap microtasks
    // automatically. We can't use the same `act` we use for Fiber tests
    // because that relies on the mock Scheduler. Doesn't affect any public
    // API but we might want to fix this for our own internal tests.
    //
    // For now, wait for each promise in sequence.
    await act(async () => {
      await promiseA;
    });
    await act(async () => {
      await promiseB;
    });
    await act(async () => {
      await promiseC;
    });
    await act(async () => {
      await promiseD;
    });

    expect(getVisibleChildren(container)).toEqual('ABCD');

    ReactDOMClient.hydrateRoot(container, <App />);
    await waitForAll([]);
    expect(getVisibleChildren(container)).toEqual('ABCD');
  });

  it('using a rejected promise will throw', async () => {
    const promiseA = Promise.resolve('A');
    const promiseB = Promise.reject(new Error('Oops!'));
    const promiseC = Promise.resolve('C');

    // Jest/Node will raise an unhandled rejected error unless we await this. It
    // works fine in the browser, though.
    await expect(promiseB).rejects.toThrow('Oops!');

    function Async() {
      return use(promiseA) + use(promiseB) + use(promiseC);
    }

    class ErrorBoundary extends React.Component {
      state = {error: null};
      static getDerivedStateFromError(error) {
        return {error};
      }
      render() {
        if (this.state.error) {
          return this.state.error.message;
        }
        return this.props.children;
      }
    }

    function App() {
      return (
        <Suspense fallback="Loading...">
          <ErrorBoundary>
            <Async />
          </ErrorBoundary>
        </Suspense>
      );
    }

    const reportedServerErrors = [];
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />, {
        onError(error) {
          reportedServerErrors.push(error);
        },
      });
      pipe(writable);
    });

    // TODO: The `act` implementation in this file doesn't unwrap microtasks
    // automatically. We can't use the same `act` we use for Fiber tests
    // because that relies on the mock Scheduler. Doesn't affect any public
    // API but we might want to fix this for our own internal tests.
    //
    // For now, wait for each promise in sequence.
    await act(async () => {
      await promiseA;
    });
    await act(async () => {
      await expect(promiseB).rejects.toThrow('Oops!');
    });
    await act(async () => {
      await promiseC;
    });

    expect(getVisibleChildren(container)).toEqual('Loading...');
    expect(reportedServerErrors.length).toBe(1);
    expect(reportedServerErrors[0].message).toBe('Oops!');

    const reportedClientErrors = [];
    ReactDOMClient.hydrateRoot(container, <App />, {
      onRecoverableError(error) {
        reportedClientErrors.push(error);
      },
    });
    await waitForAll([]);
    expect(getVisibleChildren(container)).toEqual('Oops!');
    expect(reportedClientErrors.length).toBe(1);
    if (__DEV__) {
      expect(reportedClientErrors[0].message).toBe('Oops!');
    } else {
      expect(reportedClientErrors[0].message).toBe(
        'The server could not finish this Suspense boundary, likely due to ' +
          'an error during server rendering. Switched to client rendering.',
      );
    }
  });

  it("use a promise that's already been instrumented and resolved", async () => {
    const thenable = {
      status: 'fulfilled',
      value: 'Hi',
      then() {},
    };

    // This will never suspend because the thenable already resolved
    function App() {
      return use(thenable);
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual('Hi');

    ReactDOMClient.hydrateRoot(container, <App />);
    await waitForAll([]);
    expect(getVisibleChildren(container)).toEqual('Hi');
  });

  it('unwraps thenable that fulfills synchronously without suspending', async () => {
    function App() {
      const thenable = {
        then(resolve) {
          // This thenable immediately resolves, synchronously, without waiting
          // a microtask.
          resolve('Hi');
        },
      };
      try {
        return <Text text={use(thenable)} />;
      } catch {
        throw new Error(
          '`use` should not suspend because the thenable resolved synchronously.',
        );
      }
    }
    // Because the thenable resolves synchronously, we should be able to finish
    // rendering synchronously, with no fallback.
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual('Hi');
  });

  it('promise as node', async () => {
    const promise = Promise.resolve('Hi');
    await act(async () => {
      const {pipe} = renderToPipeableStream(promise);
      pipe(writable);
    });

    // TODO: The `act` implementation in this file doesn't unwrap microtasks
    // automatically. We can't use the same `act` we use for Fiber tests
    // because that relies on the mock Scheduler. Doesn't affect any public
    // API but we might want to fix this for our own internal tests.
    await act(async () => {
      await promise;
    });

    expect(getVisibleChildren(container)).toEqual('Hi');
  });

  it('context as node', async () => {
    const Context = React.createContext('Hi');
    await act(async () => {
      const {pipe} = renderToPipeableStream(Context);
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual('Hi');
  });

  it('recursive Usable as node', async () => {
    const Context = React.createContext('Hi');
    const promiseForContext = Promise.resolve(Context);
    await act(async () => {
      const {pipe} = renderToPipeableStream(promiseForContext);
      pipe(writable);
    });

    // TODO: The `act` implementation in this file doesn't unwrap microtasks
    // automatically. We can't use the same `act` we use for Fiber tests
    // because that relies on the mock Scheduler. Doesn't affect any public
    // API but we might want to fix this for our own internal tests.
    await act(async () => {
      await promiseForContext;
    });

    expect(getVisibleChildren(container)).toEqual('Hi');
  });

  describe('useEffectEvent', () => {
    // @gate enableUseEffectEventHook
    it('can server render a component with useEffectEvent', async () => {
      const ref = React.createRef();
      function App() {
        const [count, setCount] = React.useState(0);
        const onClick = React.experimental_useEffectEvent(() => {
          setCount(c => c + 1);
        });
        return (
          <button ref={ref} onClick={() => onClick()}>
            {count}
          </button>
        );
      }
      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });
      expect(getVisibleChildren(container)).toEqual(<button>0</button>);

      ReactDOMClient.hydrateRoot(container, <App />);
      await waitForAll([]);
      expect(getVisibleChildren(container)).toEqual(<button>0</button>);

      ref.current.dispatchEvent(
        new window.MouseEvent('click', {bubbles: true}),
      );
      await jest.runAllTimers();
      expect(getVisibleChildren(container)).toEqual(<button>1</button>);
    });

    // @gate enableUseEffectEventHook
    it('throws if useEffectEvent is called during a server render', async () => {
      const logs = [];
      function App() {
        const onRender = React.experimental_useEffectEvent(() => {
          logs.push('rendered');
        });
        onRender();
        return <p>Hello</p>;
      }

      const reportedServerErrors = [];
      let caughtError;
      try {
        await act(() => {
          const {pipe} = renderToPipeableStream(<App />, {
            onError(e) {
              reportedServerErrors.push(e);
            },
          });
          pipe(writable);
        });
      } catch (err) {
        caughtError = err;
      }
      expect(logs).toEqual([]);
      expect(caughtError.message).toContain(
        "A function wrapped in useEffectEvent can't be called during rendering.",
      );
      expect(reportedServerErrors).toEqual([caughtError]);
    });

    // @gate enableUseEffectEventHook
    it('does not guarantee useEffectEvent return values during server rendering are distinct', async () => {
      function App() {
        const onClick1 = React.experimental_useEffectEvent(() => {});
        const onClick2 = React.experimental_useEffectEvent(() => {});
        if (onClick1 === onClick2) {
          return <div />;
        } else {
          return <span />;
        }
      }
      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });
      expect(getVisibleChildren(container)).toEqual(<div />);

      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App />, {
        onRecoverableError(error) {
          errors.push(error);
        },
      });
      await expect(async () => {
        await waitForAll([]);
      }).toErrorDev(
        [
          'Expected server HTML to contain a matching <span> in <div>',
          'An error occurred during hydration',
        ],
        {withoutStack: 1},
      );
      expect(errors.length).toEqual(2);
      expect(getVisibleChildren(container)).toEqual(<span />);
    });
  });

  it('can render scripts with simple children', async () => {
    await act(async () => {
      const {pipe} = renderToPipeableStream(
        <html>
          <body>
            <script>{'try { foo() } catch (e) {} ;'}</script>
          </body>
        </html>,
      );
      pipe(writable);
    });

    expect(document.documentElement.outerHTML).toEqual(
      '<html><head></head><body><script>try { foo() } catch (e) {} ;</script></body></html>',
    );
  });

  function normalizeCodeLocInfo(str) {
    return (
      str &&
      String(str).replace(/\n +(?:at|in) ([\S]+)[^\n]*/g, function (m, name) {
        return '\n    in ' + name + ' (at **)';
      })
    );
  }
  // @gate enableFloat
  it('warns if script has complex children', async () => {
    function MyScript() {
      return 'bar();';
    }
    const originalConsoleError = console.error;
    const mockError = jest.fn();
    console.error = (...args) => {
      mockError(...args.map(normalizeCodeLocInfo));
    };

    try {
      await act(async () => {
        const {pipe} = renderToPipeableStream(
          <html>
            <body>
              <script>{2}</script>
              <script>
                {[
                  'try { foo() } catch (e) {} ;',
                  'try { bar() } catch (e) {} ;',
                ]}
              </script>
              <script>
                <MyScript />
              </script>
            </body>
          </html>,
        );
        pipe(writable);
      });

      if (__DEV__) {
        expect(mockError.mock.calls.length).toBe(3);
        expect(mockError.mock.calls[0]).toEqual([
          'Warning: A script element was rendered with %s. If script element has children it must be a single string. Consider using dangerouslySetInnerHTML or passing a plain string as children.%s',
          'a number for children',
          componentStack(['script', 'body', 'html']),
        ]);
        expect(mockError.mock.calls[1]).toEqual([
          'Warning: A script element was rendered with %s. If script element has children it must be a single string. Consider using dangerouslySetInnerHTML or passing a plain string as children.%s',
          'an array for children',
          componentStack(['script', 'body', 'html']),
        ]);
        expect(mockError.mock.calls[2]).toEqual([
          'Warning: A script element was rendered with %s. If script element has children it must be a single string. Consider using dangerouslySetInnerHTML or passing a plain string as children.%s',
          'something unexpected for children',
          componentStack(['script', 'body', 'html']),
        ]);
      } else {
        expect(mockError.mock.calls.length).toBe(0);
      }
    } finally {
      console.error = originalConsoleError;
    }
  });
});
