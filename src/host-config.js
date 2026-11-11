'use strict';

const fs = require('node:fs');
const path = require('node:path');

// What the picker needs to know about the project it was run inside.
//
// The Cypress config is loaded with require, which works for a CommonJS config and
// not for a TypeScript or module one. When it cannot be loaded the Cypress defaults
// are used and the caller is told, so it can say so rather than appear to have found
// nothing.

const DEFAULT_SPEC_PATTERN = 'cypress/e2e/**/*.cy.{js,jsx,ts,tsx}';
const DEFAULT_SUPPORT_FILE = 'cypress/support/e2e.js';
const CONFIG_NAMES = ['cypress.config.js', 'cypress.config.cjs', 'cypress.config.mjs', 'cypress.config.ts'];
const SUPPORT_CANDIDATES = [
    'cypress/support/e2e.js',
    'cypress/support/e2e.ts',
    'cypress/support/e2e.jsx',
    'cypress/support/e2e.tsx',
];

function asList(value, fallback) {
    if (!value) return [fallback];
    return Array.isArray(value) ? value : [value];
}

function loadConfig(cwd) {
    for (const name of CONFIG_NAMES) {
        const full = path.join(cwd, name);
        if (!fs.existsSync(full)) continue;
        try {
            // Loading the config runs the file. setupNodeEvents is not called, so
            // nothing starts a browser or a server, but a config that does work at
            // the top level will do it here too.
            const loaded = require(full);
            return loaded && loaded.default ? loaded.default : loaded;
        } catch (err) {
            return null;
        }
    }
    return null;
}

function findSupportFile(cwd, fromConfig) {
    if (fromConfig === false) return null;
    if (typeof fromConfig === 'string') return fromConfig.replace(/\\/g, '/');
    for (const candidate of SUPPORT_CANDIDATES) {
        if (fs.existsSync(path.join(cwd, candidate))) return candidate;
    }
    return DEFAULT_SUPPORT_FILE;
}

function readCypressMajor(cwd) {
    const full = path.join(cwd, 'node_modules', 'cypress', 'package.json');
    try {
        return parseInt(JSON.parse(fs.readFileSync(full, 'utf8')).version.split('.')[0], 10);
    } catch (err) {
        return null;
    }
}

function readHost(cwd) {
    const config = loadConfig(cwd);
    const e2e = (config && config.e2e) || {};
    return {
        specPattern: asList(e2e.specPattern, DEFAULT_SPEC_PATTERN),
        excludeSpecPattern: e2e.excludeSpecPattern ? asList(e2e.excludeSpecPattern, null) : [],
        supportFile: findSupportFile(cwd, e2e.supportFile),
        cypressMajor: readCypressMajor(cwd),
        configRead: config !== null,
    };
}

// Node 18 has no glob of its own, and the package takes no dependencies, so the
// pattern is turned into a regular expression. Only the parts of glob syntax that
// Cypress's own patterns use are handled: **, *, ? and {a,b}.
function globToRegExp(pattern) {
    let out = '';
    for (let i = 0; i < pattern.length; i += 1) {
        const c = pattern[i];
        if (c === '*' && pattern[i + 1] === '*') {
            out += '.*';
            i += pattern[i + 2] === '/' ? 2 : 1;
            continue;
        }
        if (c === '*') { out += '[^/]*'; continue; }
        if (c === '?') { out += '[^/]'; continue; }
        if (c === '{') {
            const close = pattern.indexOf('}', i);
            out += '(' + pattern.slice(i + 1, close).split(',').map((p) => p.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|') + ')';
            i = close;
            continue;
        }
        out += /[.+^$()|[\]\\]/.test(c) ? '\\' + c : c;
    }
    return new RegExp('^' + out + '$');
}

function walk(dir, base, found) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        const relative = path.relative(base, full).replace(/\\/g, '/');
        if (entry.isDirectory()) walk(full, base, found);
        else found.push(relative);
    }
    return found;
}

function findSpecs(cwd, host) {
    const include = host.specPattern.map(globToRegExp);
    const exclude = host.excludeSpecPattern.map(globToRegExp);
    return walk(cwd, cwd, [])
        .filter((f) => include.some((re) => re.test(f)))
        .filter((f) => !exclude.some((re) => re.test(f)))
        .sort();
}

function isSupportInstalled(cwd, host) {
    if (!host.supportFile) return false;
    try {
        return fs.readFileSync(path.join(cwd, host.supportFile), 'utf8').includes('cypress-pick/support');
    } catch (err) {
        return false;
    }
}

module.exports = { readHost, findSpecs, isSupportInstalled, globToRegExp, DEFAULT_SPEC_PATTERN };
