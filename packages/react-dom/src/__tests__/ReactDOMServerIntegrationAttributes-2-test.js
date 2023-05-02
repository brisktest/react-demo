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

                describe('htmlFor property', function () {
                    itRenders('htmlFor with string value', async render => {
                        const e = await render(<div htmlFor="myFor" />);
                        expect(e.getAttribute('for')).toBe('myFor');
                    });

                    itRenders('no badly cased htmlfor', async render => {
                        const e = await render(<div htmlfor="myFor" />, 1);
                        expect(e.hasAttribute('for')).toBe(false);
                        expect(e.getAttribute('htmlfor')).toBe('myFor');
                    });

                    itRenders('htmlFor with an empty string', async render => {
                        const e = await render(<div htmlFor="" />);
                        expect(e.getAttribute('for')).toBe('');
                    });

                    itRenders('no htmlFor prop with true value', async render => {
                        const e = await render(<div htmlFor={true} />, 1);
                        expect(e.hasAttribute('for')).toBe(false);
                    });

                    itRenders('no htmlFor prop with false value', async render => {
                        const e = await render(<div htmlFor={false} />, 1);
                        expect(e.hasAttribute('for')).toBe(false);
                    });

                    itRenders('no htmlFor prop with null value', async render => {
                        const e = await render(<div htmlFor={null} />);
                        expect(e.hasAttribute('htmlFor')).toBe(false);
                    });
                });

                describe('numeric properties', function () {
                    itRenders(
                        'positive numeric property with positive value',
                        async render => {
                            const e = await render(<input size={2} />);
                            expect(e.getAttribute('size')).toBe('2');
                        },
                    );

                    itRenders('numeric property with zero value', async render => {
                        const e = await render(<ol start={0} />);
                        expect(e.getAttribute('start')).toBe('0');
                    });

                    itRenders(
                        'no positive numeric property with zero value',
                        async render => {
                            const e = await render(<input size={0} />);
                            expect(e.hasAttribute('size')).toBe(false);
                        },
                    );

                    itRenders('no numeric prop with function value', async render => {
                        const e = await render(<ol start={function () { }} />, 1);
                        expect(e.hasAttribute('start')).toBe(false);
                    });

                    itRenders('no numeric prop with symbol value', async render => {
                        const e = await render(<ol start={Symbol('foo')} />, 1);
                        expect(e.hasAttribute('start')).toBe(false);
                    });

                    itRenders(
                        'no positive numeric prop with function value',
                        async render => {
                            const e = await render(<input size={function () { }} />, 1);
                            expect(e.hasAttribute('size')).toBe(false);
                        },
                    );

                    itRenders('no positive numeric prop with symbol value', async render => {
                        const e = await render(<input size={Symbol('foo')} />, 1);
                        expect(e.hasAttribute('size')).toBe(false);
                    });
                });

            });


        });

    });

});
