'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { scanFile } = require('../src/spec-scan');

const fixture = (name) => path.join(__dirname, 'fixtures', name);

test('it reads every suite with its nesting and its title path', () => {
    const { suites } = scanFile(fixture('simple.cy.js'));
    assert.deepEqual(
        suites.map((s) => [s.depth, s.title]),
        [
            [0, 'Projects'],
            [1, 'Search'],
            [1, 'Pagination'],
            [2, 'Multi-page navigation'],
            [1, 'Project Details'],
        ]
    );
    assert.deepEqual(suites[3].path, ['Projects', 'Pagination', 'Multi-page navigation']);
});

test('it counts the tests in a suite, including those nested inside it', () => {
    const { suites, tests } = scanFile(fixture('simple.cy.js'));
    const byTitle = Object.fromEntries(suites.map((s) => [s.title, s.tests]));
    assert.equal(byTitle.Search, 2);
    assert.equal(byTitle.Pagination, 2);
    assert.equal(byTitle['Multi-page navigation'], 1);
    assert.equal(byTitle['Project Details'], 1);
    assert.equal(byTitle.Projects, 6);
    assert.equal(tests, 6);
});

test('it records skip and only on the suite that carries them', () => {
    const { suites } = scanFile(fixture('simple.cy.js'));
    const details = suites.find((s) => s.title === 'Project Details');
    assert.equal(details.modifier, 'skip');
    assert.equal(suites.find((s) => s.title === 'Search').modifier, null);
});

test('it ignores suite names inside comments and strings', () => {
    const { suites } = scanFile(fixture('tricky.cy.js'));
    const titles = suites.map((s) => s.title);
    assert.equal(titles.includes('Not real'), false);
    assert.equal(titles.includes('Still not real'), false);
    assert.equal(titles.includes('fake'), false);
});

test('it reads a title containing quotes of the other kind', () => {
    const { suites } = scanFile(fixture('tricky.cy.js'));
    assert.ok(suites.some((s) => s.title === 'Quoted "double" and \'single\''));
});

test('it marks a title built from a template as unreadable', () => {
    const { suites } = scanFile(fixture('tricky.cy.js'));
    const unreadable = suites.filter((s) => s.readable === false);
    assert.equal(unreadable.length, 1);
    assert.equal(unreadable[0].title, null);
    assert.equal(unreadable[0].tests, 1);
});

test('it records only, and counts specify and it.skip as tests', () => {
    const { suites, tests } = scanFile(fixture('tricky.cy.js'));
    assert.equal(suites.find((s) => s.title === 'Only this one').modifier, 'only');
    assert.equal(suites.find((s) => s.title === 'Only this one').tests, 2);
    assert.equal(tests, 5);
});

test('a suite declared with a config object is still read', () => {
    const { suites } = scanFile(fixture('tricky.cy.js'));
    assert.equal(suites[0].title, 'Root');
    assert.equal(suites[0].depth, 0);
});
