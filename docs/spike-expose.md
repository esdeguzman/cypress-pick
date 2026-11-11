# Spike: does a value on the cypress run command line reach the browser at file load time

Date: 2026-11-11. Target: Cypress 16.1.0 as installed in `konjuur-cypress`.

## Question

The whole design of cypress-pick depends on one fact: a value passed on the
`cypress run` command line with `--expose` can be read in the browser by
`Cypress.expose('cypressPick')` while a spec file is still being parsed,
before any test is registered. If that is not true, the filtering design
does not work and the rest of the plan needs rewriting.

## Method

A throwaway probe spec was added to `konjuur-cypress` at
`cypress/e2e/_expose-probe.cy.js`, then deleted once this result was
recorded. It read the exposed value twice: once in a `const` at the top
level of the file, outside any `describe` or `it` block, and once again
inside the one `it` block. Both reads were written to
`cypress/_probe/expose.json` with `cy.writeFile`.

The probe opted out of the project's login hook with
`{ expose: { skipLogin: true } }`, since it never loads a page and does not
need a session.

## Commands and results

### Run 1: a plain base64url value

```bash
cd /c/Users/User/Documents/code/konjuur-cypress
npx cypress run --spec cypress/e2e/_expose-probe.cy.js --expose cypressPick=eyJhIjoxfQ
cat cypress/_probe/expose.json
```

The test passed. `cypress/_probe/expose.json` read:

```json
{
  "readAtFileLoad": "eyJhIjoxfQ",
  "readInsideTest": "eyJhIjoxfQ",
  "hasEnvFunction": true,
  "specRelative": "cypress\\e2e\\_expose-probe.cy.js"
}
```

`eyJhIjoxfQ` is the base64url of `{"a":1}`. Both reads matched it exactly.

### Run 2: a value with more characters, to check the round trip

```bash
node -e "console.log(Buffer.from(JSON.stringify({'cypress/e2e/x.cy.js':[['Root','A. Card structure']]})).toString('base64url'))"
# -> eyJjeXByZXNzL2UyZS94LmN5LmpzIjpbWyJSb290IiwiQS4gQ2FyZCBzdHJ1Y3R1cmUiXV19

cd /c/Users/User/Documents/code/konjuur-cypress
npx cypress run --spec cypress/e2e/_expose-probe.cy.js --expose cypressPick=eyJjeXByZXNzL2UyZS94LmN5LmpzIjpbWyJSb290IiwiQS4gQ2FyZCBzdHJ1Y3R1cmUiXV19
cat cypress/_probe/expose.json
```

The test passed. `cypress/_probe/expose.json` read:

```json
{
  "readAtFileLoad": "eyJjeXByZXNzL2UyZS94LmN5LmpzIjpbWyJSb290IiwiQS4gQ2FyZCBzdHJ1Y3R1cmUiXV19",
  "readInsideTest": "eyJjeXByZXNzL2UyZS94LmN5LmpzIjpbWyJSb290IiwiQS4gQ2FyZCBzdHJ1Y3R1cmUiXV19",
  "hasEnvFunction": true,
  "specRelative": "cypress\\e2e\\_expose-probe.cy.js"
}
```

Decoded back to confirm it is the same object:

```bash
node -e "console.log(Buffer.from('eyJjeXByZXNzL2UyZS94LmN5LmpzIjpbWyJSb290IiwiQS4gQ2FyZCBzdHJ1Y3R1cmUiXV19','base64url').toString())"
# -> {"cypress/e2e/x.cy.js":[["Root","A. Card structure"]]}
```

The decoded value is byte for byte the same object that was encoded. Note:
this particular string, despite coming from a path and a label that both
contain the characters base64url is meant to protect (`/`, spaces, a
capital letter run), did not actually contain a `-` or a `_` once encoded.
That is a property of this one input, not a property of base64url, so it
does not call the round trip test into question, but it means this run did
not exercise those two characters specifically. A future run with an input
whose encoding does contain `-` or `_` would close that gap; this spike did
not need to, because the question it had to answer, whether the value
survives the round trip unchanged at all, was already answered by both
runs.

## Answers

- **Does the value arrive at file load time?** Yes. `readAtFileLoad`, read
  in a top level `const` before the `describe` call runs, matched the
  `--expose` value exactly in both runs.
- **Does it arrive inside a test?** Yes. `readInsideTest`, read inside the
  one `it` block, matched the same value.
- **Does base64url survive unchanged?** Yes, confirmed by decoding run 2's
  result back to the original object.
- **What does `Cypress.spec.relative` look like?** `cypress\e2e\_expose-probe.cy.js`.
  The slashes lean back, Windows style, not forward. Anything that builds
  or compares a spec path has to account for that on this platform.
- **Does `Cypress.env` still exist on Cypress 16?** Yes. `hasEnvFunction`
  was `true` in both runs.

## A note on the probe file's own ordering

The probe spec declares the `const` that holds the file load time read
after the `describe` block, not before it. That is deliberate: `const` is
hoisted to file scope in JavaScript, and the `describe` callback does not
run until Mocha registers the suite, which happens after the whole file has
finished being read. Reading the value inside `cy.writeFile`, which only
runs once the one `it` block executes, proves the value was already set by
the time the file had been fully parsed and registered. The run did not
hit a reference error, so this ordering worked on the first attempt and the
brief's fallback, moving the `const` to the top of the file, was not
needed.

## Conclusion

The value put on the `cypress run` command line with `--expose` is
readable in the browser at the moment a spec file is parsed, before any
test runs. The design that depends on this, reading a filter at file load
time to decide which `describe` and `context` blocks to register, is
possible on Cypress 16.1.0.
