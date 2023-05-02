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
             

                describe('props with special meaning in React', function () {
                    itRenders('no ref attribute', async render => {
                        class RefComponent extends React.Component {
                            render() {
                                return <div ref={React.createRef()} />;
                            }
                        }
                        const e = await render(<RefComponent />);
                        expect(e.getAttribute('ref')).toBe(null);
                    });

                    itRenders('no children attribute', async render => {
                        const e = await render(React.createElement('div', {}, 'foo'));
                        expect(e.getAttribute('children')).toBe(null);
                    });

                    itRenders('no key attribute', async render => {
                        const e = await render(<div key="foo" />);
                        expect(e.getAttribute('key')).toBe(null);
                    });

                    itRenders('no dangerouslySetInnerHTML attribute', async render => {
                        const e = await render(
                            <div dangerouslySetInnerHTML={{ __html: '<foo />' }} />,
                        );
                        expect(e.getAttribute('dangerouslySetInnerHTML')).toBe(null);
                    });

                    itRenders('no suppressContentEditableWarning attribute', async render => {
                        const e = await render(<div suppressContentEditableWarning={true} />);
                        expect(e.getAttribute('suppressContentEditableWarning')).toBe(null);
                    });

                    itRenders('no suppressHydrationWarning attribute', async render => {
                        const e = await render(<span suppressHydrationWarning={true} />);
                        expect(e.getAttribute('suppressHydrationWarning')).toBe(null);
                    });
                });

                describe('inline styles', function () {
                    itRenders('simple styles', async render => {
                        const e = await render(<div style={{ color: 'red', width: '30px' }} />);
                        expect(e.style.color).toBe('red');
                        expect(e.style.width).toBe('30px');
                    });

                    itRenders('relevant styles with px', async render => {
                        const e = await render(
                            <div
                                style={{
                                    left: 0,
                                    margin: 16,
                                    opacity: 0.5,
                                    padding: '4px',
                                }}
                            />,
                        );
                        expect(e.style.left).toBe('0px');
                        expect(e.style.margin).toBe('16px');
                        expect(e.style.opacity).toBe('0.5');
                        expect(e.style.padding).toBe('4px');
                    });

                    itRenders('custom properties', async render => {
                        const e = await render(<div style={{ '--foo': 5 }} />);
                        expect(e.style.getPropertyValue('--foo')).toBe('5');
                    });

                    itRenders('camel cased custom properties', async render => {
                        const e = await render(<div style={{ '--someColor': '#000000' }} />);
                        expect(e.style.getPropertyValue('--someColor')).toBe('#000000');
                    });

                    itRenders('no undefined styles', async render => {
                        const e = await render(
                            <div style={{ color: undefined, width: '30px' }} />,
                        );
                        expect(e.style.color).toBe('');
                        expect(e.style.width).toBe('30px');
                    });

                    itRenders('no null styles', async render => {
                        const e = await render(<div style={{ color: null, width: '30px' }} />);
                        expect(e.style.color).toBe('');
                        expect(e.style.width).toBe('30px');
                    });

                    itRenders('no empty styles', async render => {
                        const e = await render(<div style={{ color: null, width: null }} />);
                        expect(e.style.color).toBe('');
                        expect(e.style.width).toBe('');
                        expect(e.hasAttribute('style')).toBe(false);
                    });

                    itRenders('unitless-number rules with prefixes', async render => {
                        const { style } = await render(
                            <div
                                style={{
                                    lineClamp: 10,
                                    // TODO: requires https://github.com/jsdom/cssstyle/pull/112
                                    // WebkitLineClamp: 10,
                                    // TODO: revisit once cssstyle or jsdom figures out
                                    // if they want to support other vendors or not
                                    // MozFlexGrow: 10,
                                    // msFlexGrow: 10,
                                    // msGridRow: 10,
                                    // msGridRowEnd: 10,
                                    // msGridRowSpan: 10,
                                    // msGridRowStart: 10,
                                    // msGridColumn: 10,
                                    // msGridColumnEnd: 10,
                                    // msGridColumnSpan: 10,
                                    // msGridColumnStart: 10,
                                }}
                            />,
                        );

                        expect(style.lineClamp).toBe('10');
                        // see comment at inline styles above
                        // expect(style.WebkitLineClamp).toBe('10');
                        // expect(style.MozFlexGrow).toBe('10');
                        // jsdom is inconsistent in the style property name
                        // it uses on the client and when processing server markup.
                        // But it should be there either way.
                        //expect(style.MsFlexGrow || style.msFlexGrow).toBe('10');
                        // expect(style.MsGridRow || style.msGridRow).toBe('10');
                        // expect(style.MsGridRowEnd || style.msGridRowEnd).toBe('10');
                        // expect(style.MsGridRowSpan || style.msGridRowSpan).toBe('10');
                        // expect(style.MsGridRowStart || style.msGridRowStart).toBe('10');
                        // expect(style.MsGridColumn || style.msGridColumn).toBe('10');
                        // expect(style.MsGridColumnEnd || style.msGridColumnEnd).toBe('10');
                        // expect(style.MsGridColumnSpan || style.msGridColumnSpan).toBe('10');
                        // expect(style.MsGridColumnStart || style.msGridColumnStart).toBe('10');
                    });
                });

            });


        });

    });

});
