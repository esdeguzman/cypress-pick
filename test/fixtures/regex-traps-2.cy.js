// Finding I8. Two shapes the scanner used to read wrongly, each of which dropped
// every context after it from the list.
//
// The first is a regex inside the config object of a suite. The apostrophe in it
// used to be read as the start of a string, which then ran on into the rest of the
// file.
describe('Root', { env: { pattern: /it's here/, brace: /[{]/ } }, () => {
    context('After the config object', () => {
        it('one', () => {})
    })

    // The second is a regex that follows an arrow or a return. Both used to be read
    // as a division, so the apostrophe inside the regex opened a string again.
    context('After an arrow', () => {
        it('two', () => cy.contains(/Don't panic/))
    })

    context('After a return', () => {
        it('three', () => {
            return /won't match/.test('x')
        })
    })

    context('Last one', () => {
        it('four', () => {})
    })
})
