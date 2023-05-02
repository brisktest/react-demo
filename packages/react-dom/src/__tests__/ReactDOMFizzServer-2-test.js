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

  describe('error escaping', () => {
    it('escapes error hash, message, and component stack values in directly flushed errors (html escaping)', async () => {
      window.__outlet = {};

      const dangerousErrorString =
        '"></template></div><script>window.__outlet.message="from error"</script><div><template data-foo="';

      function Erroring() {
        throw new Error(dangerousErrorString);
      }

      // We can't test newline in component stacks because the stack always takes just one line and we end up
      // dropping the first part including the \n character
      Erroring.displayName =
        'DangerousName' +
        dangerousErrorString.replace(
          'message="from error"',
          'stack="from_stack"',
        );

      function App() {
        return (
          <div>
            <Suspense fallback={<div>Loading...</div>}>
              <Erroring />
            </Suspense>
          </div>
        );
      }

      function onError(x) {
        return `dangerous hash ${x.message.replace(
          'message="from error"',
          'hash="from hash"',
        )}`;
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />, {
          onError,
        });
        pipe(writable);
      });
      expect(window.__outlet).toEqual({});
    });

    it('escapes error hash, message, and component stack values in clientRenderInstruction (javascript escaping)', async () => {
      window.__outlet = {};

      const dangerousErrorString =
        '");window.__outlet.message="from error";</script><script>(() => {})("';

      let rejectComponent;
      const SuspensyErroring = React.lazy(() => {
        return new Promise((resolve, reject) => {
          rejectComponent = reject;
        });
      });

      // We can't test newline in component stacks because the stack always takes just one line and we end up
      // dropping the first part including the \n character
      SuspensyErroring.displayName =
        'DangerousName' +
        dangerousErrorString.replace(
          'message="from error"',
          'stack="from_stack"',
        );

      function App() {
        return (
          <div>
            <Suspense fallback={<div>Loading...</div>}>
              <SuspensyErroring />
            </Suspense>
          </div>
        );
      }

      function onError(x) {
        return `dangerous hash ${x.message.replace(
          'message="from error"',
          'hash="from hash"',
        )}`;
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />, {
          onError,
        });
        pipe(writable);
      });

      await act(() => {
        rejectComponent(new Error(dangerousErrorString));
      });
      expect(window.__outlet).toEqual({});
    });

    it('escapes such that attributes cannot be masked', async () => {
      const dangerousErrorString = '" data-msg="bad message" data-foo="';
      const theError = new Error(dangerousErrorString);

      function Erroring({isClient}) {
        if (isClient) return 'Hello';
        throw theError;
      }

      function App({isClient}) {
        return (
          <div>
            <Suspense fallback={<div>Loading...</div>}>
              <Erroring isClient={isClient} />
            </Suspense>
          </div>
        );
      }

      const loggedErrors = [];
      function onError(x) {
        loggedErrors.push(x);
        return x.message.replace('bad message', 'bad hash');
      }
      const expectedDigest = onError(theError);
      loggedErrors.length = 0;

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />, {
          onError,
        });
        pipe(writable);
      });

      expect(loggedErrors).toEqual([theError]);

      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {
        onRecoverableError(error, errorInfo) {
          errors.push({error, errorInfo});
        },
      });
      await waitForAll([]);

      // If escaping were not done we would get a message that says "bad hash"
      expectErrors(
        errors,
        [
          [
            theError.message,
            expectedDigest,
            componentStack(['Erroring', 'Suspense', 'div', 'App']),
          ],
        ],
        [
          [
            'The server could not finish this Suspense boundary, likely due to an error during server rendering. Switched to client rendering.',
            expectedDigest,
          ],
        ],
      );
    });
  });

  it('accepts an integrity property for bootstrapScripts and bootstrapModules', async () => {
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head />
          <body>
            <div>hello world</div>
          </body>
        </html>,
        {
          bootstrapScripts: [
            'foo',
            {
              src: 'bar',
            },
            {
              src: 'baz',
              integrity: 'qux',
            },
          ],
          bootstrapModules: [
            'quux',
            {
              src: 'corge',
            },
            {
              src: 'grault',
              integrity: 'garply',
            },
          ],
        },
      );
      pipe(writable);
    });

    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <div>hello world</div>
        </body>
      </html>,
    );
    expect(
      stripExternalRuntimeInNodes(
        document.getElementsByTagName('script'),
        renderOptions.unstable_externalRuntimeSrc,
      ).map(n => n.outerHTML),
    ).toEqual([
      '<script src="foo" async=""></script>',
      '<script src="bar" async=""></script>',
      '<script src="baz" integrity="qux" async=""></script>',
      '<script type="module" src="quux" async=""></script>',
      '<script type="module" src="corge" async=""></script>',
      '<script type="module" src="grault" integrity="garply" async=""></script>',
    ]);
  });

  describe('bootstrapScriptContent escaping', () => {
    it('the "S" in "</?[Ss]cript" strings are replaced with unicode escaped lowercase s or S depending on case, preserving case sensitivity of nearby characters', async () => {
      window.__test_outlet = '';
      const stringWithScriptsInIt =
        'prescription pre<scription pre<Scription pre</scRipTion pre</ScripTion </script><script><!-- <script> -->';
      await act(() => {
        const {pipe} = renderToPipeableStream(<div />, {
          bootstrapScriptContent:
            'window.__test_outlet = "This should have been replaced";var x = "' +
            stringWithScriptsInIt +
            '";\nwindow.__test_outlet = x;',
        });
        pipe(writable);
      });
      expect(window.__test_outlet).toMatch(stringWithScriptsInIt);
    });

    it('does not escape \\u2028, or \\u2029 characters', async () => {
      // these characters are ignored in engines support https://github.com/tc39/proposal-json-superset
      // in this test with JSDOM the characters are silently dropped and thus don't need to be encoded.
      // if you send these characters to an older browser they could fail so it is a good idea to
      // sanitize JSON input of these characters
      window.__test_outlet = '';
      const el = document.createElement('p');
      el.textContent = '{"one":1,\u2028\u2029"two":2}';
      const stringWithLSAndPSCharacters = el.textContent;
      await act(() => {
        const {pipe} = renderToPipeableStream(<div />, {
          bootstrapScriptContent:
            'let x = ' +
            stringWithLSAndPSCharacters +
            '; window.__test_outlet = x;',
        });
        pipe(writable);
      });
      const outletString = JSON.stringify(window.__test_outlet);
      expect(outletString).toBe(
        stringWithLSAndPSCharacters.replace(/[\u2028\u2029]/g, ''),
      );
    });

    it('does not escape <, >, or & characters', async () => {
      // these characters valid javascript and may be necessary in scripts and won't be interpretted properly
      // escaped outside of a string context within javascript
      window.__test_outlet = null;
      // this boolean expression will be cast to a number due to the bitwise &. we will look for a truthy value (1) below
      const booleanLogicString = '1 < 2 & 3 > 1';
      await act(() => {
        const {pipe} = renderToPipeableStream(<div />, {
          bootstrapScriptContent:
            'let x = ' + booleanLogicString + '; window.__test_outlet = x;',
        });
        pipe(writable);
      });
      expect(window.__test_outlet).toBe(1);
    });
  });

  // @gate enableFizzExternalRuntime
  it('supports option to load runtime as an external script', async () => {
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head />
          <body>
            <Suspense fallback={'loading...'}>
              <AsyncText text="Hello" />
            </Suspense>
          </body>
        </html>,
        {
          unstable_externalRuntimeSrc: 'src-of-external-runtime',
        },
      );
      pipe(writable);
    });

    // We want the external runtime to be sent in <head> so the script can be
    // fetched and executed as early as possible. For SSR pages using Suspense,
    // this script execution would be render blocking.
    expect(
      Array.from(document.head.getElementsByTagName('script')).map(
        n => n.outerHTML,
      ),
    ).toEqual(['<script src="src-of-external-runtime" async=""></script>']);

    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>loading...</body>
      </html>,
    );
  });

  // @gate enableFizzExternalRuntime
  it('does not send script tags for SSR instructions when using the external runtime', async () => {
    function App() {
      return (
        <div>
          <Suspense fallback="Loading...">
            <div>
              <AsyncText text="Hello" />
            </div>
          </Suspense>
        </div>
      );
    }
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });
    await act(() => {
      resolveText('Hello');
    });

    // The only script elements sent should be from unstable_externalRuntimeSrc
    expect(document.getElementsByTagName('script').length).toEqual(1);
  });

  it('does not send the external runtime for static pages', async () => {
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head />
          <body>
            <p>hello world!</p>
          </body>
        </html>,
      );
      pipe(writable);
    });

    // no scripts should be sent
    expect(document.getElementsByTagName('script').length).toEqual(0);

    // the html should be as-is
    expect(document.documentElement.innerHTML).toEqual(
      '<head></head><body><p>hello world!</p></body>',
    );
  });

  it('#24384: Suspending should halt hydration warnings and not emit any if hydration completes successfully after unsuspending', async () => {
    const makeApp = () => {
      let resolve, resolved;
      const promise = new Promise(r => {
        resolve = () => {
          resolved = true;
          return r();
        };
      });
      function ComponentThatSuspends() {
        if (!resolved) {
          throw promise;
        }
        return <p>A</p>;
      }

      const App = () => {
        return (
          <div>
            <Suspense fallback={<h1>Loading...</h1>}>
              <ComponentThatSuspends />
              <h2 name="hello">world</h2>
            </Suspense>
          </div>
        );
      };

      return [App, resolve];
    };

    const [ServerApp, serverResolve] = makeApp();
    await act(() => {
      const {pipe} = renderToPipeableStream(<ServerApp />);
      pipe(writable);
    });
    await act(() => {
      serverResolve();
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>A</p>
        <h2 name="hello">world</h2>
      </div>,
    );

    const [ClientApp, clientResolve] = makeApp();
    ReactDOMClient.hydrateRoot(container, <ClientApp />, {
      onRecoverableError(error) {
        Scheduler.log('Logged recoverable error: ' + error.message);
      },
    });
    await waitForAll([]);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>A</p>
        <h2 name="hello">world</h2>
      </div>,
    );

    // Now that the boundary resolves to it's children the hydration completes and discovers that there is a mismatch requiring
    // client-side rendering.
    await clientResolve();
    await waitForAll([]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>A</p>
        <h2 name="hello">world</h2>
      </div>,
    );
  });

  // @gate enableClientRenderFallbackOnTextMismatch
  it('#24384: Suspending should halt hydration warnings but still emit hydration warnings after unsuspending if mismatches are genuine', async () => {
    const makeApp = () => {
      let resolve, resolved;
      const promise = new Promise(r => {
        resolve = () => {
          resolved = true;
          return r();
        };
      });
      function ComponentThatSuspends() {
        if (!resolved) {
          throw promise;
        }
        return <p>A</p>;
      }

      const App = ({text}) => {
        return (
          <div>
            <Suspense fallback={<h1>Loading...</h1>}>
              <ComponentThatSuspends />
              <h2 name={text}>{text}</h2>
            </Suspense>
          </div>
        );
      };

      return [App, resolve];
    };

    const [ServerApp, serverResolve] = makeApp();
    await act(() => {
      const {pipe} = renderToPipeableStream(<ServerApp text="initial" />);
      pipe(writable);
    });
    await act(() => {
      serverResolve();
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>A</p>
        <h2 name="initial">initial</h2>
      </div>,
    );

    // The client app is rendered with an intentionally incorrect text. The still Suspended component causes
    // hydration to fail silently (allowing for cache warming but otherwise skipping this boundary) until it
    // resolves.
    const [ClientApp, clientResolve] = makeApp();
    ReactDOMClient.hydrateRoot(container, <ClientApp text="replaced" />, {
      onRecoverableError(error) {
        Scheduler.log('Logged recoverable error: ' + error.message);
      },
    });
    await waitForAll([]);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>A</p>
        <h2 name="initial">initial</h2>
      </div>,
    );

    // Now that the boundary resolves to it's children the hydration completes and discovers that there is a mismatch requiring
    // client-side rendering.
    await clientResolve();
    await expect(async () => {
      await waitForAll([
        'Logged recoverable error: Text content does not match server-rendered HTML.',
        'Logged recoverable error: There was an error while hydrating this Suspense boundary. Switched to client rendering.',
      ]);
    }).toErrorDev(
      'Warning: Text content did not match. Server: "initial" Client: "replaced',
    );
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>A</p>
        <h2 name="replaced">replaced</h2>
      </div>,
    );

    await waitForAll([]);
  });
  function normalizeCodeLocInfo(str) {
    return (
      str &&
      String(str).replace(/\n +(?:at|in) ([\S]+)[^\n]*/g, function (m, name) {
        return '\n    in ' + name + ' (at **)';
      })
    );
  }
  // @gate enableClientRenderFallbackOnTextMismatch
  it('only warns once on hydration mismatch while within a suspense boundary', async () => {
    const originalConsoleError = console.error;
    const mockError = jest.fn();
    console.error = (...args) => {
      mockError(...args.map(normalizeCodeLocInfo));
    };

    const App = ({text}) => {
      return (
        <div>
          <Suspense fallback={<h1>Loading...</h1>}>
            <h2>{text}</h2>
            <h2>{text}</h2>
            <h2>{text}</h2>
          </Suspense>
        </div>
      );
    };

    try {
      await act(() => {
        const {pipe} = renderToPipeableStream(<App text="initial" />);
        pipe(writable);
      });

      expect(getVisibleChildren(container)).toEqual(
        <div>
          <h2>initial</h2>
          <h2>initial</h2>
          <h2>initial</h2>
        </div>,
      );

      ReactDOMClient.hydrateRoot(container, <App text="replaced" />, {
        onRecoverableError(error) {
          Scheduler.log('Logged recoverable error: ' + error.message);
        },
      });
      await waitForAll([
        'Logged recoverable error: Text content does not match server-rendered HTML.',
        'Logged recoverable error: There was an error while hydrating this Suspense boundary. Switched to client rendering.',
      ]);

      expect(getVisibleChildren(container)).toEqual(
        <div>
          <h2>replaced</h2>
          <h2>replaced</h2>
          <h2>replaced</h2>
        </div>,
      );

      await waitForAll([]);
      if (__DEV__) {
        expect(mockError.mock.calls.length).toBe(1);
        expect(mockError.mock.calls[0]).toEqual([
          'Warning: Text content did not match. Server: "%s" Client: "%s"%s',
          'initial',
          'replaced',
          '\n' +
            '    in h2 (at **)\n' +
            '    in Suspense (at **)\n' +
            '    in div (at **)\n' +
            '    in App (at **)',
        ]);
      } else {
        expect(mockError.mock.calls.length).toBe(0);
      }
    } finally {
      console.error = originalConsoleError;
    }
  });

  it('supresses hydration warnings when an error occurs within a Suspense boundary', async () => {
    let isClient = false;

    function ThrowWhenHydrating({children}) {
      // This is a trick to only throw if we're hydrating, because
      // useSyncExternalStore calls getServerSnapshot instead of the regular
      // getSnapshot in that case.
      useSyncExternalStore(
        () => {},
        t => t,
        () => {
          if (isClient) {
            throw new Error('uh oh');
          }
        },
      );
      return children;
    }

    const App = () => {
      return (
        <div>
          <Suspense fallback={<h1>Loading...</h1>}>
            <ThrowWhenHydrating>
              <h1>one</h1>
            </ThrowWhenHydrating>
            <h2>two</h2>
            <h3>{isClient ? 'five' : 'three'}</h3>
          </Suspense>
        </div>
      );
    };

    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <h1>one</h1>
        <h2>two</h2>
        <h3>three</h3>
      </div>,
    );

    isClient = true;

    ReactDOMClient.hydrateRoot(container, <App />, {
      onRecoverableError(error) {
        Scheduler.log('Logged recoverable error: ' + error.message);
      },
    });
    await waitForAll([
      'Logged recoverable error: uh oh',
      'Logged recoverable error: There was an error while hydrating this Suspense boundary. Switched to client rendering.',
    ]);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <h1>one</h1>
        <h2>two</h2>
        <h3>five</h3>
      </div>,
    );

    await waitForAll([]);
  });

  // @gate __DEV__
  it('does not invokeGuardedCallback for errors after the first hydration error', async () => {
    // We can't use the toErrorDev helper here because this is async.
    const originalConsoleError = console.error;
    const mockError = jest.fn();
    console.error = (...args) => {
      if (args.length > 1) {
        if (typeof args[1] === 'object') {
          mockError(args[0].split('\n')[0]);
          return;
        }
      }
      mockError(...args.map(normalizeCodeLocInfo));
    };
    let isClient = false;

    function ThrowWhenHydrating({children, message}) {
      // This is a trick to only throw if we're hydrating, because
      // useSyncExternalStore calls getServerSnapshot instead of the regular
      // getSnapshot in that case.
      useSyncExternalStore(
        () => {},
        t => t,
        () => {
          if (isClient) {
            Scheduler.log('throwing: ' + message);
            throw new Error(message);
          }
        },
      );
      return children;
    }

    const App = () => {
      return (
        <div>
          <Suspense fallback={<h1>Loading...</h1>}>
            <ThrowWhenHydrating message="first error">
              <h1>one</h1>
            </ThrowWhenHydrating>
            <ThrowWhenHydrating message="second error">
              <h2>two</h2>
            </ThrowWhenHydrating>
            <ThrowWhenHydrating message="third error">
              <h3>three</h3>
            </ThrowWhenHydrating>
          </Suspense>
        </div>
      );
    };

    try {
      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });

      expect(getVisibleChildren(container)).toEqual(
        <div>
          <h1>one</h1>
          <h2>two</h2>
          <h3>three</h3>
        </div>,
      );

      isClient = true;

      ReactDOMClient.hydrateRoot(container, <App />, {
        onRecoverableError(error) {
          Scheduler.log('Logged recoverable error: ' + error.message);
        },
      });
      await waitForAll([
        'throwing: first error',
        // this repeated first error is the invokeGuardedCallback throw
        'throwing: first error',

        // onRecoverableError because the UI recovered without surfacing the
        // error to the user.
        'Logged recoverable error: first error',
        'Logged recoverable error: There was an error while hydrating this Suspense boundary. Switched to client rendering.',
      ]);
      // These Uncaught error calls are the error reported by the runtime (jsdom here, browser in actual use)
      // when invokeGuardedCallback is used to replay an error in dev using event dispatching in the document
      expect(mockError.mock.calls).toEqual([
        // we only get one because we suppress invokeGuardedCallback after the first one when hydrating in a
        // suspense boundary
        ['Error: Uncaught [Error: first error]'],
      ]);
      mockError.mockClear();

      expect(getVisibleChildren(container)).toEqual(
        <div>
          <h1>one</h1>
          <h2>two</h2>
          <h3>three</h3>
        </div>,
      );

      await waitForAll([]);
      expect(mockError.mock.calls).toEqual([]);
    } finally {
      console.error = originalConsoleError;
    }
  });

  // @gate __DEV__
  it('does not invokeGuardedCallback for errors after a preceding fiber suspends', async () => {
    // We can't use the toErrorDev helper here because this is async.
    const originalConsoleError = console.error;
    const mockError = jest.fn();
    console.error = (...args) => {
      if (args.length > 1) {
        if (typeof args[1] === 'object') {
          mockError(args[0].split('\n')[0]);
          return;
        }
      }
      mockError(...args.map(normalizeCodeLocInfo));
    };
    let isClient = false;
    let promise = null;
    let unsuspend = null;
    let isResolved = false;

    function ComponentThatSuspendsOnClient() {
      if (isClient && !isResolved) {
        if (promise === null) {
          promise = new Promise(resolve => {
            unsuspend = () => {
              isResolved = true;
              resolve();
            };
          });
        }
        Scheduler.log('suspending');
        throw promise;
      }
      return null;
    }

    function ThrowWhenHydrating({children, message}) {
      // This is a trick to only throw if we're hydrating, because
      // useSyncExternalStore calls getServerSnapshot instead of the regular
      // getSnapshot in that case.
      useSyncExternalStore(
        () => {},
        t => t,
        () => {
          if (isClient) {
            Scheduler.log('throwing: ' + message);
            throw new Error(message);
          }
        },
      );
      return children;
    }

    const App = () => {
      return (
        <div>
          <Suspense fallback={<h1>Loading...</h1>}>
            <ComponentThatSuspendsOnClient />
            <ThrowWhenHydrating message="first error">
              <h1>one</h1>
            </ThrowWhenHydrating>
            <ThrowWhenHydrating message="second error">
              <h2>two</h2>
            </ThrowWhenHydrating>
            <ThrowWhenHydrating message="third error">
              <h3>three</h3>
            </ThrowWhenHydrating>
          </Suspense>
        </div>
      );
    };

    try {
      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });

      expect(getVisibleChildren(container)).toEqual(
        <div>
          <h1>one</h1>
          <h2>two</h2>
          <h3>three</h3>
        </div>,
      );

      isClient = true;

      ReactDOMClient.hydrateRoot(container, <App />, {
        onRecoverableError(error) {
          Scheduler.log('Logged recoverable error: ' + error.message);
        },
      });
      await waitForAll(['suspending']);
      expect(mockError.mock.calls).toEqual([]);

      expect(getVisibleChildren(container)).toEqual(
        <div>
          <h1>one</h1>
          <h2>two</h2>
          <h3>three</h3>
        </div>,
      );
      await unsuspend();
      await waitForAll([
        'throwing: first error',
        'throwing: first error',
        'Logged recoverable error: first error',
        'Logged recoverable error: There was an error while hydrating this Suspense boundary. Switched to client rendering.',
      ]);
      expect(getVisibleChildren(container)).toEqual(
        <div>
          <h1>one</h1>
          <h2>two</h2>
          <h3>three</h3>
        </div>,
      );
    } finally {
      console.error = originalConsoleError;
    }
  });

  // @gate __DEV__
  it('(outdated behavior) suspending after erroring will cause errors previously queued to be silenced until the boundary resolves', async () => {
    // NOTE: This test was originally written to test a scenario that doesn't happen
    // anymore. If something errors during hydration, we immediately unwind the
    // stack and revert to client rendering. I've kept the test around just to
    // demonstrate what actually happens in this sequence of events.

    // We can't use the toErrorDev helper here because this is async.
    const originalConsoleError = console.error;
    const mockError = jest.fn();
    console.error = (...args) => {
      if (args.length > 1) {
        if (typeof args[1] === 'object') {
          mockError(args[0].split('\n')[0]);
          return;
        }
      }
      mockError(...args.map(normalizeCodeLocInfo));
    };
    let isClient = false;
    let promise = null;
    let unsuspend = null;
    let isResolved = false;

    function ComponentThatSuspendsOnClient() {
      if (isClient && !isResolved) {
        if (promise === null) {
          promise = new Promise(resolve => {
            unsuspend = () => {
              isResolved = true;
              resolve();
            };
          });
        }
        Scheduler.log('suspending');
        throw promise;
      }
      return null;
    }

    function ThrowWhenHydrating({children, message}) {
      // This is a trick to only throw if we're hydrating, because
      // useSyncExternalStore calls getServerSnapshot instead of the regular
      // getSnapshot in that case.
      useSyncExternalStore(
        () => {},
        t => t,
        () => {
          if (isClient) {
            Scheduler.log('throwing: ' + message);
            throw new Error(message);
          }
        },
      );
      return children;
    }

    const App = () => {
      return (
        <div>
          <Suspense fallback={<h1>Loading...</h1>}>
            <ThrowWhenHydrating message="first error">
              <h1>one</h1>
            </ThrowWhenHydrating>
            <ThrowWhenHydrating message="second error">
              <h2>two</h2>
            </ThrowWhenHydrating>
            <ComponentThatSuspendsOnClient />
            <ThrowWhenHydrating message="third error">
              <h3>three</h3>
            </ThrowWhenHydrating>
          </Suspense>
        </div>
      );
    };

    try {
      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });

      expect(getVisibleChildren(container)).toEqual(
        <div>
          <h1>one</h1>
          <h2>two</h2>
          <h3>three</h3>
        </div>,
      );

      isClient = true;

      ReactDOMClient.hydrateRoot(container, <App />, {
        onRecoverableError(error) {
          Scheduler.log('Logged recoverable error: ' + error.message);
        },
      });
      await waitForAll([
        'throwing: first error',
        // duplicate because first error is re-done in invokeGuardedCallback
        'throwing: first error',
        'suspending',
        'Logged recoverable error: first error',
        'Logged recoverable error: There was an error while hydrating this Suspense boundary. Switched to client rendering.',
      ]);
      // These Uncaught error calls are the error reported by the runtime (jsdom here, browser in actual use)
      // when invokeGuardedCallback is used to replay an error in dev using event dispatching in the document
      expect(mockError.mock.calls).toEqual([
        // we only get one because we suppress invokeGuardedCallback after the first one when hydrating in a
        // suspense boundary
        ['Error: Uncaught [Error: first error]'],
      ]);
      mockError.mockClear();

      expect(getVisibleChildren(container)).toEqual(
        <div>
          <h1>Loading...</h1>
        </div>,
      );
      await clientAct(() => unsuspend());
      // Since our client components only throw on the very first render there are no
      // new throws in this pass
      assertLog([]);
      expect(mockError.mock.calls).toEqual([]);

      expect(getVisibleChildren(container)).toEqual(
        <div>
          <h1>one</h1>
          <h2>two</h2>
          <h3>three</h3>
        </div>,
      );
    } finally {
      console.error = originalConsoleError;
    }
  });

  it('#24578 Hydration errors caused by a suspending component should not become recoverable when nested in an ancestor Suspense that is showing primary content', async () => {
    // this test failed before because hydration errors on the inner boundary were upgraded to recoverable by
    // a codepath of the outer boundary
    function App({isClient}) {
      return (
        <Suspense fallback={'outer'}>
          <Suspense fallback={'inner'}>
            <div>
              {isClient ? <AsyncText text="A" /> : <Text text="A" />}
              <b>B</b>
            </div>
          </Suspense>
        </Suspense>
      );
    }
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });

    const errors = [];
    ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {
      onRecoverableError(error) {
        errors.push(error.message);
      },
    });

    await waitForAll([]);
    expect(errors).toEqual([]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        A<b>B</b>
      </div>,
    );

    resolveText('A');
    await waitForAll([]);
    expect(errors).toEqual([]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        A<b>B</b>
      </div>,
    );
  });

  it('hydration warnings for mismatched text with multiple text nodes caused by suspending should be suppressed', async () => {
    let resolve;
    const Lazy = React.lazy(() => {
      return new Promise(r => {
        resolve = r;
      });
    });

    function App({isClient}) {
      return (
        <div>
          {isClient ? <Lazy /> : <p>lazy</p>}
          <p>some {'text'}</p>
        </div>
      );
    }
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });

    const errors = [];
    ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {
      onRecoverableError(error) {
        errors.push(error.message);
      },
    });

    await waitForAll([]);
    expect(errors).toEqual([]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>lazy</p>
        <p>some {'text'}</p>
      </div>,
    );

    resolve({default: () => <p>lazy</p>});
    await waitForAll([]);
    expect(errors).toEqual([]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>lazy</p>
        <p>some {'text'}</p>
      </div>,
    );
  });

  // @gate enableFloat
  it('can emit the preamble even if the head renders asynchronously', async () => {
    function AsyncNoOutput() {
      readText('nooutput');
      return null;
    }
    function AsyncHead() {
      readText('head');
      return (
        <head data-foo="foo">
          <title>a title</title>
        </head>
      );
    }
    function AsyncBody() {
      readText('body');
      return (
        <body data-bar="bar">
          <link rel="preload" as="style" href="foo" />
          hello
        </body>
      );
    }
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html data-html="html">
          <AsyncNoOutput />
          <AsyncHead />
          <AsyncBody />
        </html>,
      );
      pipe(writable);
    });
    await act(() => {
      resolveText('body');
    });
    await act(() => {
      resolveText('nooutput');
    });
    await act(() => {
      resolveText('head');
    });
    expect(getVisibleChildren(document)).toEqual(
      <html data-html="html">
        <head data-foo="foo">
          <link rel="preload" as="style" href="foo" />
          <title>a title</title>
        </head>
        <body data-bar="bar">hello</body>
      </html>,
    );
  });

  // @gate enableFloat
  it('holds back body and html closing tags (the postamble) until all pending tasks are completed', async () => {
    const chunks = [];
    writable.on('data', chunk => {
      chunks.push(chunk);
    });

    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head />
          <body>
            first
            <Suspense>
              <AsyncText text="second" />
            </Suspense>
          </body>
        </html>,
      );
      pipe(writable);
    });

    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>{'first'}</body>
      </html>,
    );

    await act(() => {
      resolveText('second');
    });

    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>
          {'first'}
          {'second'}
        </body>
      </html>,
    );

    expect(chunks.pop()).toEqual('</body></html>');
  });

});
