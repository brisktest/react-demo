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

const { resetModules, itRenders, clientCleanRender } =
    ReactDOMServerIntegrationUtils(initModules);

describe('ReactDOMServerIntegration', () => {
    beforeEach(() => {
        resetModules();
    });

    describe('property to attribute mapping', function () {
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

        const { resetModules, itRenders, clientCleanRender } =
            ReactDOMServerIntegrationUtils(initModules);

        describe('ReactDOMServerIntegration', () => {
            beforeEach(() => {
                resetModules();
            });

            describe('property to attribute mapping', function () {
             

                describe('aria attributes', function () {
                    itRenders('simple strings', async render => {
                        const e = await render(<div aria-label="hello" />);
                        expect(e.getAttribute('aria-label')).toBe('hello');
                    });

                    // this probably is just masking programmer error, but it is existing behavior.
                    itRenders('aria string prop with false value', async render => {
                        const e = await render(<div aria-label={false} />);
                        expect(e.getAttribute('aria-label')).toBe('false');
                    });

                    itRenders('no aria prop with null value', async render => {
                        const e = await render(<div aria-label={null} />);
                        expect(e.hasAttribute('aria-label')).toBe(false);
                    });

                    itRenders('"aria" attribute with a warning', async render => {
                        // Reserved for future use.
                        const e = await render(<div aria="hello" />, 1);
                        expect(e.getAttribute('aria')).toBe('hello');
                    });
                });

                describe('cased attributes', function () {
                    itRenders(
                        'badly cased aliased HTML attribute with a warning',
                        async render => {
                            const e = await render(<form acceptcharset="utf-8" />, 1);
                            expect(e.hasAttribute('accept-charset')).toBe(false);
                            expect(e.getAttribute('acceptcharset')).toBe('utf-8');
                        },
                    );

                    itRenders('badly cased SVG attribute with a warning', async render => {
                        const e = await render(
                            <svg>
                                <text textlength="10" />
                            </svg>,
                            1,
                        );
                        // The discrepancy is expected as long as we emit a warning
                        // both on the client and the server.
                        if (render === clientCleanRender) {
                            // On the client, "textlength" is treated as a case-sensitive
                            // SVG attribute so the wrong attribute ("textlength") gets set.
                            expect(e.firstChild.getAttribute('textlength')).toBe('10');
                            expect(e.firstChild.hasAttribute('textLength')).toBe(false);
                        } else {
                            // When parsing HTML (including the hydration case), the browser
                            // correctly maps "textlength" to "textLength" SVG attribute.
                            // So it happens to work on the initial render.
                            expect(e.firstChild.getAttribute('textLength')).toBe('10');
                            expect(e.firstChild.hasAttribute('textlength')).toBe(false);
                        }
                    });

                    itRenders('no badly cased aliased SVG attribute alias', async render => {
                        const e = await render(
                            <svg>
                                <text strokedasharray="10 10" />
                            </svg>,
                            1,
                        );
                        expect(e.firstChild.hasAttribute('stroke-dasharray')).toBe(false);
                        expect(e.firstChild.getAttribute('strokedasharray')).toBe('10 10');
                    });

                    itRenders(
                        'no badly cased original SVG attribute that is aliased',
                        async render => {
                            const e = await render(
                                <svg>
                                    <text stroke-dasharray="10 10" />
                                </svg>,
                                1,
                            );
                            expect(e.firstChild.getAttribute('stroke-dasharray')).toBe('10 10');
                        },
                    );
                });

                describe('unknown attributes', function () {
                    itRenders('unknown attributes', async render => {
                        const e = await render(<div foo="bar" />);
                        expect(e.getAttribute('foo')).toBe('bar');
                    });

                    itRenders('unknown data- attributes', async render => {
                        const e = await render(<div data-foo="bar" />);
                        expect(e.getAttribute('data-foo')).toBe('bar');
                    });

                    itRenders('badly cased reserved attributes', async render => {
                        const e = await render(<div CHILDREN="5" />, 1);
                        expect(e.getAttribute('CHILDREN')).toBe('5');
                    });

                    itRenders('"data" attribute', async render => {
                        // For `<object />` acts as `src`.
                        const e = await render(<object data="hello" />);
                        expect(e.getAttribute('data')).toBe('hello');
                    });

                    itRenders('no unknown data- attributes with null value', async render => {
                        const e = await render(<div data-foo={null} />);
                        expect(e.hasAttribute('data-foo')).toBe(false);
                    });

                    itRenders('unknown data- attributes with casing', async render => {
                        const e = await render(<div data-fooBar="true" />, 1);
                        expect(e.getAttribute('data-foobar')).toBe('true');
                    });

                    itRenders('unknown data- attributes with boolean true', async render => {
                        const e = await render(<div data-foobar={true} />);
                        expect(e.getAttribute('data-foobar')).toBe('true');
                    });

                    itRenders('unknown data- attributes with boolean false', async render => {
                        const e = await render(<div data-foobar={false} />);
                        expect(e.getAttribute('data-foobar')).toBe('false');
                    });

                    itRenders(
                        'no unknown data- attributes with casing and null value',
                        async render => {
                            const e = await render(<div data-fooBar={null} />, 1);
                            expect(e.hasAttribute('data-foobar')).toBe(false);
                        },
                    );

                    itRenders('custom attributes for non-standard elements', async render => {
                        // This test suite generally assumes that we get exactly
                        // the same warnings (or none) for all scenarios including
                        // SSR + innerHTML, hydration, and client-side rendering.
                        // However this particular warning fires only when creating
                        // DOM nodes on the client side. We force it to fire early
                        // so that it gets deduplicated later, and doesn't fail the test.
                        expect(() => {
                            ReactDOM.render(<nonstandard />, document.createElement('div'));
                        }).toErrorDev('The tag <nonstandard> is unrecognized in this browser.');

                        const e = await render(<nonstandard foo="bar" />);
                        expect(e.getAttribute('foo')).toBe('bar');
                    });

                    itRenders('SVG tags with dashes in them', async render => {
                        const e = await render(
                            <svg>
                                <font-face accentHeight={10} />
                            </svg>,
                        );
                        expect(e.firstChild.hasAttribute('accentHeight')).toBe(false);
                        expect(e.firstChild.getAttribute('accent-height')).toBe('10');
                    });

                    itRenders('cased custom attributes', async render => {
                        const e = await render(<div fooBar="test" />, 1);
                        expect(e.getAttribute('foobar')).toBe('test');
                    });
                });

                itRenders('no HTML events', async render => {
                    const e = await render(<div onClick={() => { }} />);
                    expect(e.getAttribute('onClick')).toBe(null);
                    expect(e.getAttribute('onClick')).toBe(null);
                    expect(e.getAttribute('click')).toBe(null);
                });

                itRenders('no unknown events', async render => {
                    const e = await render(<div onunknownevent='alert("hack")' />, 1);
                    expect(e.getAttribute('onunknownevent')).toBe(null);
                });

                itRenders('custom attribute named `on`', async render => {
                    const e = await render(<div on="tap:do-something" />);
                    expect(e.getAttribute('on')).toEqual('tap:do-something');
                });
            });


        });

    });

});
