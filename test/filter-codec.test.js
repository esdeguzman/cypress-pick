'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { encode, decode } = require('../src/filter-codec');

test('a value survives the round trip', () => {
    const value = { 'cypress/e2e/a.cy.js': [['Root', 'A. Card structure']] };
    assert.deepEqual(decode(encode(value)), value);
});

test('the encoded text has no padding and no comma', () => {
    // Cypress splits the values on --expose at commas, and the flag is already
    // written as key=value, so a comma or an equals sign in the value can break it.
    const text = encode({ 'a/b.cy.js': [['One', 'Two'], ['One', 'Three']] });
    assert.equal(text.includes('='), false);
    assert.equal(text.includes(','), false);
    assert.equal(/^[A-Za-z0-9_-]+$/.test(text), true);
});

test('text outside plain ASCII survives', () => {
    // Suite titles in real projects contain characters such as the long dash.
    const value = { 'a.cy.js': [['Root', 'Requested by: — and é']] };
    assert.deepEqual(decode(encode(value)), value);
});

test('decode returns null for nothing, rather than throwing', () => {
    assert.equal(decode(''), null);
    assert.equal(decode(null), null);
    assert.equal(decode(undefined), null);
});

test('decode returns null for text that is not a filter, rather than throwing', () => {
    assert.equal(decode('not base64url at all !!'), null);
});

test('a value whose length is not a multiple of four decodes', () => {
    // Padding is stripped on the way out, so decode has to put it back. Each of
    // these lengths leaves a different remainder.
    for (const text of ['a', 'ab', 'abc', 'abcd']) {
        const value = { k: 'x'.repeat(text.length) };
        assert.deepEqual(decode(encode(value)), value);
    }
});

test('base64url dash and underscore characters survive the round trip', () => {
    // base64url substitutes - for + and _ for / to avoid special characters
    // on the command line where values are separated by commas. This test
    // encodes a value that produces both substituted characters and verifies
    // they survive the round trip without corruption.

    // Create a value whose UTF-8 encoding contains bytes that base64 converts
    // to both + (becomes -) and / (becomes _), confirming the command line
    // can carry both substituted characters unchanged
    const value = {
        'a.cy.js': [['Root', String.fromCharCode(0xafec, 0x21bf, 0x8a7b, 0x992f, 0x566e, 0x0506, 0x36aa, 0xda3c, 0x1be7, 0x4484, 0xd1cf, 0xe764, 0x647b, 0x41f9, 0xd5ef, 0xc035, 0x1353, 0xfbf6, 0xf488, 0x17b5)]]
    };
    const encoded = encode(value);

    // Verify both base64url substituted characters are present
    assert.equal(encoded.includes('-'), true);
    assert.equal(encoded.includes('_'), true);

    // Verify the round trip preserves the value exactly
    assert.deepEqual(decode(encoded), value);
});
